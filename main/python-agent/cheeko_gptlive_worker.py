"""
Cheeko GPT-Live worker (agent name: $GPTLIVE_AGENT_NAME, default cheeko-agent; port 8090)

Full-duplex OpenAI GPT-Live voice model; reasoning + tool calls delegated to a backend Responses model.
Persona comes from the manager as AGENT.md / SOUL.md / USER.md files in an ephemeral workspace, like picoclaw.

Run:
  python cheeko_gptlive_worker.py console   # local mic, no room
  python cheeko_gptlive_worker.py dev       # register with LIVEKIT_URL (hot-reload)
  python cheeko_gptlive_worker.py start     # production (pm2 on the dev box)
"""
from __future__ import annotations

import asyncio
import json
import logging
import os
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path
from typing import Callable

from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parent
load_dotenv(ROOT / ".env")

from livekit import rtc  # noqa: E402
from livekit.agents import Agent, AgentSession, JobContext, JobProcess, RoomInputOptions, WorkerOptions, cli, metrics  # noqa: E402
from livekit.plugins import openai, silero  # noqa: E402
from livekit.plugins.openai.realtime import GPTLiveModel  # noqa: E402

from agent.manager import ManagerClient  # noqa: E402
from agent.metadata import DEFAULT_VOICE, SessionMeta, choose_voice, parse_dispatch_metadata  # noqa: E402
from agent.persistence import SessionRecorder, openai_summarizer  # noqa: E402
from agent.persona import backend_instructions, greeting_instruction, session_start_block, strip_expression_tags, voice_instructions  # noqa: E402
from agent.placeholders import quiz_block, render_placeholders, wants_quiz  # noqa: E402
from agent.quiz import QuizTracker, memo_type_for  # noqa: E402
from agent.tools import tools_for  # noqa: E402
from agent.workspace import build_system_prompt, cap_summaries, hydrate_workspace, persona_from_manager, remove_workspace  # noqa: E402

logger = logging.getLogger("cheeko-gptlive")


class _ShowGPTLiveError(logging.Filter):
    """The plugin puts the error body in the lk.pii.error extra, which the log formatter drops; surface it."""

    def filter(self, record: logging.LogRecord) -> bool:
        body = getattr(record, "lk.pii.error", None)
        if body is not None and "gpt-live returned an error" in str(record.msg):
            record.msg = f"{record.msg}: {body}"
        return True


logging.getLogger("livekit.plugins.openai").addFilter(_ShowGPTLiveError())
# Same name as picoclaw-livekit, so the manager's character routing reaches this worker. Run only one of the
# two under a name: LiveKit spreads dispatches across every worker registered with it. GPTLIVE_AGENT_NAME=cheeko-gptlive for side by side.
AGENT_NAME = os.getenv("GPTLIVE_AGENT_NAME", "cheeko-agent")
DEFAULT_PORT = 8090
WORKSPACES = ROOT / "workspaces"
GREETING_FALLBACK_S = 3.0
MAX_INSTRUCTION_TOKENS = 8192  # GPT-Live startup cap; a single append is capped at 500
# ponytail: chars/4 token estimate with ~600 tokens of headroom; use a tokenizer if sessions start failing
MAX_VOICE_CHARS = (MAX_INSTRUCTION_TOKENS - 600) * 4


@dataclass
class SessionPlan:
    meta: SessionMeta
    workspace: Path
    voice_instructions: str
    backend_instructions: str
    greeting: str
    tools: list
    quiz_tracker: QuizTracker | None
    has_quiz: bool
    room_name: str = ""
    voice: str = DEFAULT_VOICE
    realtime: dict = field(default_factory=dict)  # active Runtime Providers → Realtime row; {} = use .env


async def _nothing(value):
    return value


async def assemble_session(room_name: str, metadata: str | None, manager: ManagerClient, workspaces_root: Path,
                           now: Callable[[], datetime] | None = None) -> SessionPlan:
    now = now or datetime.now
    meta = parse_dispatch_metadata(metadata, room_name)
    persona_data, states, files, realtime = None, [], {}, {}
    if manager.enabled:
        mac = meta.device_mac
        persona_data, states, files, realtime = await asyncio.gather(
            manager.character_session(meta.character, meta.character_id),
            manager.progress_state(mac) if mac else _nothing([]),
            manager.workspace_files(mac) if mac else _nothing({}),
            manager.realtime_provider(),
        )
    persona = persona_from_manager(persona_data, meta)
    workspace = hydrate_workspace(workspaces_root, room_name, persona, meta, states, files)

    batch = None
    if wants_quiz(persona.greeting) and manager.enabled and meta.device_mac:
        batch = await manager.quiz_batch(meta.device_mac, meta.character)
    tracker = None
    if batch and memo_type_for(meta.character):
        tracker = QuizTracker(batch, workspace, memo_type_for(meta.character), manager, meta.device_mac or "", now=now)
    has_quiz = tracker is not None
    bank = quiz_block(batch) if wants_quiz(persona.greeting) else ""
    memos = [str(s.get("memo") or "") for s in states if s.get("memo")]
    today = now()
    greeting_prompt = strip_expression_tags(render_placeholders(persona.greeting, batch, today))
    session_start = session_start_block(greeting_prompt)  # carries the quiz block
    def voice_with_memory(memory_chars: int | None) -> str:
        # meta.language is the session choice from dispatch; AGENT.md uses the same value
        return voice_instructions(build_system_prompt(workspace, memory_chars), meta.language, meta.accent, session_start,
                                  has_quiz, today=today.strftime("%A, %d %B %Y"))

    spare = MAX_VOICE_CHARS - len(voice_with_memory(0)) - 40  # 40: the section heading and separator
    instructions = voice_with_memory(spare)
    if len(instructions) > MAX_VOICE_CHARS:
        logger.warning("voice instructions ~%d tokens, over the ~%d budget under GPT-Live's %d cap",
                       len(instructions) // 4, MAX_VOICE_CHARS // 4, MAX_INSTRUCTION_TOKENS)
    memory_path = workspace / "memory" / "MEMORY.md"
    return SessionPlan(
        meta=meta, workspace=workspace,
        voice=choose_voice(meta.voice, persona.voice, realtime.get("voice")), realtime=realtime,
        voice_instructions=instructions,
        # capped: every delegation re-sends this, and the account's backend TPM limit is 60k
        backend_instructions=backend_instructions(bank, memos, has_quiz, cap_summaries(memory_path.read_text(encoding="utf-8"))),
        greeting=greeting_instruction(meta.character, has_session_start=bool(session_start)),
        tools=tools_for(meta.character, workspace, tracker),
        quiz_tracker=tracker, has_quiz=has_quiz, room_name=room_name,
    )


def backend_model(plan: SessionPlan) -> str:
    return plan.realtime.get("backend_model") or os.getenv("GPTLIVE_BACKEND_MODEL", "gpt-5.6-luna")


def gptlive_options(plan: SessionPlan) -> dict:
    """The DB row (manager-web Runtime Providers → Realtime) wins; blank fields fall back to .env and defaults."""
    rt = plan.realtime
    options = {
        "voice": plan.voice,
        "responses_options": {"model": backend_model(plan), "instructions": plan.backend_instructions},
        "api_key": rt.get("api_key") or None,  # None: the plugin reads OPENAI_API_KEY
    }
    if rt.get("model"):
        options["model"] = rt["model"]
    if rt.get("api_base"):
        options["base_url"] = rt["api_base"]
    return options


class CheekoGPTLive(Agent):
    def __init__(self, plan: SessionPlan) -> None:
        self.plan = plan
        self._greeted = False
        super().__init__(
            instructions=plan.voice_instructions,
            tools=plan.tools + [openai.tools.WebSearch()],  # WebSearch runs on OpenAI's side, invoked by the backend model
            llm=GPTLiveModel(**gptlive_options(plan)),
        )

    async def on_enter(self) -> None:
        if self.plan.quiz_tracker is not None:
            self.plan.quiz_tracker.on_directive = lambda d: asyncio.create_task(self.push_rule(d))
        await asyncio.sleep(GREETING_FALLBACK_S)
        await self.greet()

    async def greet(self) -> None:
        if self._greeted:
            return
        self._greeted = True
        handle = self.session.generate_reply(instructions=self.plan.greeting)
        await handle
        if handle.exception() is not None:
            logger.warning("model declined the greeting: %s", handle.exception())

    async def push_rule(self, text: str) -> None:
        """A standing rule for the voice model: a system message appended after start becomes session.instructions.append."""
        chat_ctx = self.chat_ctx.copy()
        chat_ctx.add_message(role="system", content=text)
        try:
            await self.update_chat_ctx(chat_ctx)
        except Exception as e:  # the directive also travels in the tool result, so this is best effort
            logger.warning("append_instructions failed: %s", e)


def prewarm(proc: JobProcess) -> None:
    proc.userdata["vad"] = silero.VAD.load()  # GPT-Live drops the default VAD; barge-in playback cutoff needs one


async def entrypoint(ctx: JobContext) -> None:
    ctx.log_context_fields = {"room": ctx.room.name}
    manager = ManagerClient(os.getenv("MANAGER_API_URL", ""), os.getenv("MANAGER_API_SECRET", ""))
    metadata = ctx.job.metadata if ctx.job else None
    plan = await assemble_session(ctx.room.name, metadata, manager, WORKSPACES)
    logger.info("session: character=%s voice=%s accent=%s rate=%s quiz=%s key=%s tools=%s",
                plan.meta.character, plan.voice, plan.meta.accent, plan.meta.sample_rate, plan.has_quiz,
                "db" if plan.realtime.get("api_key") else "env", [t.info.name for t in plan.tools])

    session = AgentSession(vad=ctx.proc.userdata["vad"])
    agent = CheekoGPTLive(plan)
    recorder = SessionRecorder(session, manager, plan,
                               summarize=openai_summarizer(backend_model(plan), plan.realtime.get("api_key") or None,
                                                           plan.realtime.get("api_base") or None))

    @session.on("metrics_collected")
    def _on_metrics(ev) -> None:
        # RealtimeModelMetrics.session_duration = voice seconds; LLMMetrics = backend tokens
        metrics.log_metrics(ev.metrics)

    @session.on("speech_created")
    def _on_speech(ev) -> None:
        logger.info("SPEECH created source=%s", ev.source)

    @ctx.room.on("data_received")
    def _on_data(packet: rtc.DataPacket) -> None:
        try:
            msg = json.loads(packet.data.decode("utf-8"))
        except Exception:
            return
        if isinstance(msg, dict) and msg.get("type") == "ready_for_greeting":
            asyncio.create_task(agent.greet())
        # ptt_event, speech_end, abort: the model owns turns; ignored on purpose

    async def shutdown() -> None:
        logger.info("usage: %s", session.usage)
        await recorder.flush(session.usage)
        await manager.aclose()
        remove_workspace(plan.workspace)

    ctx.add_shutdown_callback(shutdown)
    await session.start(
        room=ctx.room, agent=agent,
        room_input_options=RoomInputOptions(audio_sample_rate=plan.meta.sample_rate, audio_num_channels=1),
    )
    logger.info("%s is LIVE in %s", AGENT_NAME, ctx.room.name)


if __name__ == "__main__":
    cli.run_app(WorkerOptions(entrypoint_fnc=entrypoint, prewarm_fnc=prewarm, agent_name=AGENT_NAME,
                              port=int(os.getenv("GPTLIVE_PORT", DEFAULT_PORT)),
                              # default 10 s kills the shutdown mid-upload: summary (<= 20 s) + memory + transcript
                              shutdown_process_timeout=60.0))
