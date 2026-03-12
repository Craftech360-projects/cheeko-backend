"""
Math Game Agent Worker (v2 — modular architecture)
Visual math game with tap-to-answer, progressive hints, and age-based modes.

agent_name: math-game-agent
Port: 8088
"""

import os
import sys
import json
import asyncio
import platform

# Fix for Windows socket buffer exhaustion
if platform.system() == "Windows":
    asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from dotenv import load_dotenv
load_dotenv(".env")

import logging
from livekit.agents import (
    AgentSession,
    JobContext,
    JobProcess,
    WorkerOptions,
    cli,
    AutoSubscribe,
)
from livekit.agents import Agent

from src.config.config_loader import ConfigLoader
from src.utils.helpers import UsageManager
from src.utils.database_helper import DatabaseHelper
from src.shared.entrypoint_utils import parse_room_name, load_game_prompt, render_prompt_with_profile
from src.features.game_tools import check_math_answer, set_math_game_state
from src.games.math_game import MathGameState
from src.games.math_game_pipeline import create_pipeline
from src.games.math_game_data_channel import DataChannel
from src.games.math_game_hints import HintManager
from src.games.math_game_narrator import Narrator
from src.games.math_game_engine import MathGameEngine
from src.games.math_game_question_generator import QuestionGenerator

logger = logging.getLogger("math_game_worker")

AGENT_NAME = "math-game-agent"
CHARACTER_NAME = "Math Commander"
DEFAULT_PORT = 8088


class MathCommanderAgent(Agent):
    """Agent subclass with llm_node override to suppress tool-call text from TTS."""

    async def llm_node(self, chat_ctx, tools, model_settings):
        """Suppress tool-call text from reaching TTS output and log generated text."""
        has_tool_calls = False
        collected_text = []
        async for chunk in super().llm_node(chat_ctx, tools, model_settings):
            if hasattr(chunk, "delta") and chunk.delta:
                if getattr(chunk.delta, "tool_calls", None):
                    if not has_tool_calls:
                        logger.debug("agent.llm_tool_call_detected — suppressing text to TTS")
                    has_tool_calls = True

                if has_tool_calls and getattr(chunk.delta, "content", None):
                    logger.debug(f"agent.llm_text_suppressed(text={chunk.delta.content[:100]})")
                    chunk.delta.content = None
                elif getattr(chunk.delta, "content", None):
                    collected_text.append(chunk.delta.content)

            yield chunk

        full_text = "".join(collected_text)
        if full_text:
            logger.info(f"agent.tts_input: {full_text[:500]}")


def prewarm(proc: JobProcess):
    """Prewarm: cache configs, db_helper, and register plugins on main thread."""
    logger.info("worker.prewarm_start")
    # Import pipeline module to register LiveKit plugins on the main thread
    import src.games.math_game_pipeline  # noqa: F401
    yaml_config = ConfigLoader.load_yaml_config()
    proc.userdata["yaml_config"] = yaml_config
    proc.userdata["assemblyai_config"] = ConfigLoader.get_assemblyai_config()
    proc.userdata["tts_config"] = ConfigLoader.get_tts_config()

    manager_api_url = os.getenv("MANAGER_API_URL")
    manager_api_secret = os.getenv("MANAGER_API_SECRET")
    if manager_api_url and manager_api_secret:
        proc.userdata["db_helper"] = DatabaseHelper(manager_api_url, manager_api_secret)

    logger.info("worker.prewarm_done")


async def entrypoint(ctx: JobContext):
    """Main entrypoint — wires all modules and starts the agent session."""
    room_name = ctx.room.name
    device_mac, room_type = parse_room_name(room_name)
    logger.info(f"worker.entrypoint(room={room_name}, device_mac={device_mac})")

    yaml_config = ctx.proc.userdata.get("yaml_config") or ConfigLoader.load_yaml_config()

    # --- Config: API keys from YAML ---
    api_keys = yaml_config.get("api_keys", {})
    if "google" in api_keys and not os.getenv("GOOGLE_API_KEY"):
        os.environ["GOOGLE_API_KEY"] = api_keys["google"]

    # --- Child profile from dispatch metadata or DB ---
    child_profile = None
    dispatch_memories = []
    dispatch_relations = []
    dispatch_entities = []

    try:
        if hasattr(ctx, "job") and ctx.job and ctx.job.metadata:
            dispatch_metadata = json.loads(ctx.job.metadata)
            child_profile = dispatch_metadata.get("child_profile")
            dispatch_memories = dispatch_metadata.get("long_term_memories", [])
            dispatch_relations = dispatch_metadata.get("memory_relations", [])
            dispatch_entities = dispatch_metadata.get("memory_entities", [])
            if child_profile:
                logger.info(f"worker.child_profile(name={child_profile.get('name')}, age={child_profile.get('age')}, source=dispatch)")
    except Exception as e:
        logger.debug(f"worker.dispatch_metadata_error(error={e})")

    if not child_profile and device_mac:
        try:
            db_helper = ctx.proc.userdata.get("db_helper")
            if not db_helper:
                db_helper = DatabaseHelper(os.getenv("MANAGER_API_URL"), os.getenv("MANAGER_API_SECRET"))
            child_profile = await db_helper.get_child_profile_by_mac(device_mac)
            if child_profile:
                logger.info(f"worker.child_profile(name={child_profile.get('name')}, age={child_profile.get('age')}, source=db)")
        except Exception as e:
            logger.error(f"worker.child_profile_error(error={e})")

    # --- Prompt loading ---
    # Simple, focused prompt. The server controls ALL game flow (questions, hints, progression).
    # The LLM only: (1) reacts via generate_reply instructions, (2) calls check_math_answer on voice input.
    child_name_for_prompt = child_profile.get("name", "buddy") if child_profile else "buddy"
    child_age_for_prompt = child_profile.get("age", 5) if child_profile else 5

    agent_prompt = f"""You are Cheeko, a friendly math game buddy for {child_name_for_prompt} (age {child_age_for_prompt}).

You have TWO jobs:
1. When the child says a number, call check_math_answer with that number.
2. When you receive instructions (via generate_reply), follow them EXACTLY. Say what the instructions tell you to say. Do not add your own questions or content.

RULES:
- NEVER ask math questions yourself. The server handles all questions.
- NEVER make up stories, scenarios, or problems.
- When the child says something that is NOT a number, respond warmly in 1 short sentence.
- Keep all responses to 1-2 sentences maximum.
- When instructions say "celebrate" or "react" — do ONLY that. Do NOT ask questions."""

    logger.info(f"worker.config_loaded(prompt_len={len(agent_prompt)})")

    # --- Determine game mode ---
    game_mode = "explorer"
    if child_profile:
        age = child_profile.get("age", 5)
        game_mode = "commander" if age >= 7 else "explorer"

    # --- Create pipeline ---
    stt, llm, tts = create_pipeline(yaml_config)
    llm_provider = os.getenv("MATH_LLM_PROVIDER", "openrouter")
    llm_model = os.getenv("MATH_LLM_MODEL", "openai/gpt-4o-mini")
    logger.info(f"worker.config_loaded(llm_provider={llm_provider}, model={llm_model})")

    # --- Create game state ---
    game_state = MathGameState(game_mode=game_mode)
    set_math_game_state(game_state)  # connect to game_tools module

    # --- Create agent ---
    agent = MathCommanderAgent(instructions=agent_prompt)

    # --- Create session ---
    session = AgentSession(
        stt=stt,
        llm=llm,
        tts=tts,
        tools=[check_math_answer],
        allow_interruptions=False,
    )

    # --- Wire modules ---
    dc = DataChannel(ctx.room)
    narrator = Narrator(session)
    qgen = QuestionGenerator()  # Uses OPENROUTER_API_KEY and MATH_LLM_MODEL from env

    # Engine needs hint_manager, but hint_manager needs engine.on_hint_triggered
    # Solve with a wrapper
    engine = None

    async def _on_hint(question_id: str, level: int):
        if engine:
            await engine.on_hint_triggered(question_id, level)

    child_age = child_profile.get("age", 5) if child_profile else 5
    hint_manager = HintManager(game_state, on_hint=_on_hint)
    engine = MathGameEngine(game_state, narrator, hint_manager, dc, qgen, session, child_age=child_age)

    # --- Register data channel handlers ---
    child_name = child_profile.get("name", "buddy") if child_profile else "buddy"

    dc.on("math_answer", engine.on_tap_answer)
    dc.on("game_control", engine.on_game_control)

    # ready_for_greeting kept as optional re-trigger (frontend compat)
    async def _on_ready_for_greeting(message: dict):
        logger.info("worker.greeting_triggered(source=data_channel)")
        await engine.on_game_start(child_name, child_profile.get("age", 5) if child_profile else 5, game_mode)

    dc.on("ready_for_greeting", _on_ready_for_greeting)

    async def _on_end_prompt(message: dict):
        prompt_text = message.get("prompt", "Time flies so fast! It was wonderful learning with you. Goodbye!")
        logger.info("worker.end_prompt_received")
        await narrator.speak_end_prompt(prompt_text)

    dc.on("end_prompt", _on_end_prompt)

    async def _on_shutdown(message: dict):
        logger.info("worker.shutdown_request_received")
        if message.get("require_ack"):
            await dc.send({
                "type": "shutdown_ack",
                "session_id": message.get("session_id", ""),
            })
        hint_manager.cancel_timers()

    dc.on("shutdown_request", _on_shutdown)

    # --- Register on_tools_executed ---
    @session.on("function_tools_executed")
    def on_tools_executed(ev):
        has_check_answer = False
        check_result = None
        for call, output in ev.zipped():
            fn_name = getattr(call, "name", str(call))
            if fn_name == "check_math_answer":
                has_check_answer = True
                try:
                    raw = output.output if hasattr(output, "output") else str(output)
                    check_result = json.loads(raw)
                except (json.JSONDecodeError, TypeError, AttributeError):
                    logger.error(f"worker.tool_output_parse_error(output={str(output)[:200]})")

        if has_check_answer and check_result:
            ev.cancel_tool_reply()
            logger.info("worker.tool_reply_cancelled(tool=check_math_answer)")
            asyncio.create_task(engine.on_voice_answer(check_result))

    # --- Usage tracking ---
    usage_manager = UsageManager(mac_address=device_mac, session_id=room_name)
    usage_manager.setup_metrics_collection(session)
    logger.info("worker.usage_tracking_initialized")

    # --- Connect ---
    await ctx.connect(auto_subscribe=AutoSubscribe.AUDIO_ONLY)

    # --- Duplicate agent check ---
    my_identity = ctx.room.local_participant.identity if ctx.room.local_participant else None
    existing_agents = [
        p for p in ctx.room.remote_participants.values()
        if p.identity and "agent" in p.identity.lower() and p.identity != my_identity
    ]
    if existing_agents:
        logger.warning(f"worker.duplicate_agent_detected(identities={[a.identity for a in existing_agents]})")
        return

    # --- Start session ---
    await session.start(agent=agent, room=ctx.room)
    await dc.mark_ready()
    logger.info("worker.session_started")

    # --- Publish initial state ---
    if child_profile:
        await dc.send({"type": "child_profile", **child_profile})
    await dc.send({
        "type": "game_state",
        "state": "playing",
        "game_mode": game_mode,
        "progress": game_state._get_progress(),
    })

    # --- Auto-start game immediately ---
    logger.info("worker.auto_starting_game")
    await engine.on_game_start(child_name, child_age, game_mode)

    # --- Cleanup ---
    async def cleanup():
        logger.info("worker.cleanup")
        hint_manager.cancel_timers()
        logger.info("worker.cleanup_done")

    ctx.add_shutdown_callback(cleanup)


if __name__ == "__main__":
    cli.run_app(
        WorkerOptions(
            entrypoint_fnc=entrypoint,
            prewarm_fnc=prewarm,
            port=DEFAULT_PORT,
            agent_name=AGENT_NAME,
        )
    )
