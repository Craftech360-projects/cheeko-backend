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
from dataclasses import dataclass
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
from agent.metadata import SessionMeta, parse_dispatch_metadata  # noqa: E402
from agent.persistence import SessionRecorder  # noqa: E402
from agent.persona import backend_instructions, greeting_instruction, voice_instructions  # noqa: E402
from agent.placeholders import quiz_block, render_placeholders, wants_quiz  # noqa: E402
from agent.quiz import QuizTracker, memo_type_for  # noqa: E402
from agent.tools import tools_for  # noqa: E402
from agent.workspace import build_system_prompt, hydrate_workspace, persona_from_manager, remove_workspace  # noqa: E402

logger = logging.getLogger("cheeko-gptlive")
# Same name as picoclaw-livekit, so the manager's character routing reaches this worker. Run only one of the
# two under a name: LiveKit spreads dispatches across every worker registered with it. GPTLIVE_AGENT_NAME=cheeko-gptlive for side by side.
AGENT_NAME = os.getenv("GPTLIVE_AGENT_NAME", "cheeko-agent")
DEFAULT_PORT = 8090
WORKSPACES = ROOT / "workspaces"
GREETING_FALLBACK_S = 3.0


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


async def _no_states() -> list[dict]:
    return []


async def assemble_session(room_name: str, metadata: str | None, manager: ManagerClient, workspaces_root: Path,
                           now: Callable[[], datetime] | None = None) -> SessionPlan:
    now = now or datetime.now
    meta = parse_dispatch_metadata(metadata, room_name)
    persona_data, states = None, []
    if manager.enabled:
        persona_data, states = await asyncio.gather(
            manager.character_session(meta.character, meta.character_id),
            manager.progress_state(meta.device_mac) if meta.device_mac else _no_states(),
        )
    persona = persona_from_manager(persona_data, meta)
    workspace = hydrate_workspace(workspaces_root, room_name, persona, meta, states)

    batch = None
    if wants_quiz(persona.greeting) and manager.enabled and meta.device_mac:
        batch = await manager.quiz_batch(meta.device_mac, meta.character)
    tracker = None
    if batch and memo_type_for(meta.character):
        tracker = QuizTracker(batch, workspace, memo_type_for(meta.character), manager, meta.device_mac or "", now=now)
    has_quiz = tracker is not None
    bank = quiz_block(batch) if wants_quiz(persona.greeting) else ""
    memos = [str(s.get("memo") or "") for s in states if s.get("memo")]
    return SessionPlan(
        meta=meta, workspace=workspace,
        # meta.language is the session choice from dispatch; AGENT.md uses the same value
        voice_instructions=voice_instructions(build_system_prompt(workspace), meta.language, meta.accent, bank, has_quiz),
        backend_instructions=backend_instructions(bank, memos, has_quiz),
        greeting=greeting_instruction(meta.character, render_placeholders(persona.greeting, batch, now())),
        tools=tools_for(meta.character, workspace, tracker),
        quiz_tracker=tracker, has_quiz=has_quiz, room_name=room_name,
    )


class CheekoGPTLive(Agent):
    def __init__(self, plan: SessionPlan) -> None:
        self.plan = plan
        self._greeted = False
        super().__init__(
            instructions=plan.voice_instructions,
            tools=plan.tools + [openai.tools.WebSearch()],  # WebSearch runs on OpenAI's side, invoked by the backend model
            llm=GPTLiveModel(
                voice=plan.meta.voice,
                responses_options={"model": os.getenv("GPTLIVE_BACKEND_MODEL", "gpt-5.6-luna"), "instructions": plan.backend_instructions},
            ),
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
    logger.info("session: character=%s voice=%s accent=%s rate=%s quiz=%s tools=%s",
                plan.meta.character, plan.meta.voice, plan.meta.accent, plan.meta.sample_rate, plan.has_quiz,
                [t.info.name for t in plan.tools])

    session = AgentSession(vad=ctx.proc.userdata["vad"])
    agent = CheekoGPTLive(plan)
    recorder = SessionRecorder(session, manager, plan)

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
                              port=int(os.getenv("GPTLIVE_PORT", DEFAULT_PORT))))
