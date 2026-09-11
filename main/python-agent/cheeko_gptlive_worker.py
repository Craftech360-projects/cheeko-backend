"""
Cheeko GPT-Live worker (spike)
Full-duplex OpenAI GPT-Live voice model; reasoning + tool calls delegated to a backend Responses model.

agent_name: cheeko-gptlive
Port: 8090

Run:
  python cheeko_gptlive_worker.py console   # local mic, no room
  python cheeko_gptlive_worker.py dev       # register with LIVEKIT_URL (hot-reload)
  python cheeko_gptlive_worker.py start     # production (pm2 on the dev box)
"""

import logging
import os
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

import textwrap
from dotenv import load_dotenv
from jinja2 import Template

ROOT = Path(__file__).resolve().parent
load_dotenv(ROOT / ".env")

from livekit.agents import (  # noqa: E402
    Agent,
    AgentSession,
    JobContext,
    JobProcess,
    RoomInputOptions,
    RunContext,
    WorkerOptions,
    cli,
    function_tool,
    metrics,
)
from livekit.plugins import openai, silero  # noqa: E402
from livekit.plugins.openai.realtime import GPTLiveModel  # noqa: E402

logger = logging.getLogger("cheeko-gptlive")

AGENT_NAME = "cheeko-gptlive"
DEFAULT_PORT = 8090

# ponytail: voice persona = existing Cheeko prompt rendered with no child profile (jinja drops those blocks).
# Per-child rendering from dispatch metadata can be added once the model itself checks out.
DELEGATION_RULES = """

<delegation>
You cannot look things up yourself. Delegate any question about the current time, date, or day,
and any factual question you are not sure about. While you wait, say one short cheerful filler
sentence like "Let me check that!" and then read out the result when it arrives.
Answer greetings, small talk, jokes, and simple questions yourself.
</delegation>
"""

BACKEND_INSTRUCTIONS = (
    "You handle work delegated by a voice model talking to a child aged 3 to 16. "
    "Use tools when current information is required. Reply with one or two short, "
    "friendly, child-safe sentences the voice model can read out."
)


def load_voice_prompt() -> str:
    # ponytail: file is a single `prompt: |` block with stray non-printable bytes that break yaml.safe_load
    lines = (ROOT / "prompts/cheeko.yaml").read_text(encoding="utf-8").splitlines()[1:]
    return Template(textwrap.dedent("\n".join(lines))).render() + DELEGATION_RULES


class CheekoGPTLive(Agent):
    def __init__(self) -> None:
        super().__init__(
            instructions=load_voice_prompt(),
            # runs on OpenAI's side, invoked by the backend model
            tools=[openai.tools.WebSearch()],
            llm=GPTLiveModel(
                voice=os.getenv("GPTLIVE_VOICE", "marin"),
                responses_options={
                    "model": os.getenv("GPTLIVE_BACKEND_MODEL", "gpt-5.6-luna"),
                    "instructions": BACKEND_INSTRUCTIONS,
                },
            ),
        )

    async def on_enter(self) -> None:
        handle = self.session.generate_reply(
            instructions="Greet the child warmly as Cheeko in one short sentence and ask what they want to do."
        )
        await handle
        if handle.exception() is not None:
            logger.warning("model declined the greeting: %s", handle.exception())

    @function_tool
    async def get_time_date(self, context: RunContext, timezone: str = "Asia/Kolkata") -> str:
        """Get the current date and time.

        Args:
            timezone: IANA timezone name, default India Standard Time.
        """
        now = datetime.now(ZoneInfo(timezone))
        logger.info("tool get_time_date(%s) called via backend delegation", timezone)
        return now.strftime("%A, %d %B %Y, %I:%M %p") + f" ({timezone})"


def prewarm(proc: JobProcess) -> None:
    # GPT-Live drops the session's default VAD; barge-in playback cutoff needs one passed explicitly.
    proc.userdata["vad"] = silero.VAD.load()


async def entrypoint(ctx: JobContext) -> None:
    ctx.log_context_fields = {"room": ctx.room.name}
    session = AgentSession(vad=ctx.proc.userdata["vad"])

    @session.on("metrics_collected")
    def _on_metrics(ev) -> None:
        # RealtimeModelMetrics.session_duration = voice seconds; LLMMetrics = backend tokens
        metrics.log_metrics(ev.metrics)

    @session.on("conversation_item_added")
    def _on_item(ev) -> None:
        item = ev.item
        logger.info("TRANSCRIPT %s: %s", getattr(item, "role", type(item).__name__), getattr(item, "text_content", ""))

    @session.on("agent_state_changed")
    def _on_state(ev) -> None:
        logger.info("STATE %s -> %s", ev.old_state, ev.new_state)

    @session.on("function_tools_executed")
    def _on_tools(ev) -> None:
        logger.info("TOOLS %s", [(c.name, c.arguments) for c in ev.function_calls])

    @session.on("speech_created")
    def _on_speech(ev) -> None:
        logger.info("SPEECH created source=%s", ev.source)

    @session.on("error")
    def _on_error(ev) -> None:
        logger.error("SESSION ERROR %s", ev.error)

    async def log_usage() -> None:
        logger.info("usage: %s", session.usage)

    ctx.add_shutdown_callback(log_usage)

    await session.start(
        room=ctx.room,
        agent=CheekoGPTLive(),
        room_input_options=RoomInputOptions(audio_sample_rate=16000, audio_num_channels=1),
    )
    logger.info("%s is LIVE in %s", AGENT_NAME, ctx.room.name)


if __name__ == "__main__":
    cli.run_app(
        WorkerOptions(
            entrypoint_fnc=entrypoint,
            prewarm_fnc=prewarm,
            agent_name=AGENT_NAME,
            port=int(os.getenv("GPTLIVE_PORT", DEFAULT_PORT)),
        )
    )
