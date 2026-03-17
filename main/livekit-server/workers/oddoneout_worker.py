"""
Odd One Out Agent Worker
"Which doesn't belong?" game with choice_select cards, agentic LLM narration.

agent_name: oddoneout-agent
Port: 8091
"""

import os
import sys
import json
import asyncio
import platform

if platform.system() == "Windows":
    asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from dotenv import load_dotenv
load_dotenv(".env")

import logging
from livekit.agents import (
    AgentSession, JobContext, JobProcess, WorkerOptions, cli, AutoSubscribe,
)
from livekit.agents import Agent

from src.config.config_loader import ConfigLoader
from src.utils.helpers import UsageManager
from src.utils.database_helper import DatabaseHelper
from src.shared.entrypoint_utils import parse_room_name
from src.features.oddoneout_game_tools import check_oddoneout_answer, set_oddoneout_game_state
from src.games.oddoneout_state import OddOneOutState
from src.games.oddoneout_pipeline import create_pipeline
from src.games.math_game_data_channel import DataChannel
from src.games.oddoneout_hints import OddOneOutHintManager
from src.games.oddoneout_narrator import OddOneOutNarrator
from src.games.oddoneout_engine import OddOneOutEngine
from src.games.oddoneout_question_generator import OddOneOutQuestionGenerator

logger = logging.getLogger("oddoneout_worker")

AGENT_NAME = "oddoneout-agent"
DEFAULT_PORT = 8091


class OddOneOutAgent(Agent):
    """Agent with llm_node override to suppress tool-call text from TTS."""

    async def llm_node(self, chat_ctx, tools, model_settings):
        has_tool_calls = False
        collected_text = []
        async for chunk in super().llm_node(chat_ctx, tools, model_settings):
            if hasattr(chunk, "delta") and chunk.delta:
                if getattr(chunk.delta, "tool_calls", None):
                    if not has_tool_calls:
                        logger.debug("agent.llm_tool_call_detected — suppressing text")
                    has_tool_calls = True
                if has_tool_calls and getattr(chunk.delta, "content", None):
                    logger.debug(f"agent.text_suppressed({chunk.delta.content[:100]})")
                    chunk.delta.content = None
                elif getattr(chunk.delta, "content", None):
                    collected_text.append(chunk.delta.content)
            yield chunk
        full_text = "".join(collected_text)
        if full_text:
            logger.info(f"agent.tts_input: {full_text[:500]}")


def prewarm(proc: JobProcess):
    logger.info("worker.prewarm_start")
    import src.games.oddoneout_pipeline  # noqa: F401
    yaml_config = ConfigLoader.load_yaml_config()
    proc.userdata["yaml_config"] = yaml_config
    proc.userdata["tts_config"] = ConfigLoader.get_tts_config()

    manager_api_url = os.getenv("MANAGER_API_URL")
    manager_api_secret = os.getenv("MANAGER_API_SECRET")
    if manager_api_url and manager_api_secret:
        proc.userdata["db_helper"] = DatabaseHelper(manager_api_url, manager_api_secret)
    logger.info("worker.prewarm_done")


async def entrypoint(ctx: JobContext):
    room_name = ctx.room.name
    device_mac, room_type = parse_room_name(room_name)
    logger.info(f"worker.entrypoint(room={room_name}, mac={device_mac})")

    yaml_config = ctx.proc.userdata.get("yaml_config") or ConfigLoader.load_yaml_config()
    api_keys = yaml_config.get("api_keys", {})
    if "google" in api_keys and not os.getenv("GOOGLE_API_KEY"):
        os.environ["GOOGLE_API_KEY"] = api_keys["google"]

    # Child profile
    child_profile = None
    try:
        if hasattr(ctx, "job") and ctx.job and ctx.job.metadata:
            dispatch_metadata = json.loads(ctx.job.metadata)
            child_profile = dispatch_metadata.get("child_profile")
            if child_profile:
                logger.info(f"worker.child_profile(name={child_profile.get('name')}, age={child_profile.get('age')}, src=dispatch)")
    except Exception as e:
        logger.debug(f"worker.dispatch_error({e})")

    if not child_profile and device_mac:
        try:
            db_helper = ctx.proc.userdata.get("db_helper")
            if not db_helper:
                db_helper = DatabaseHelper(os.getenv("MANAGER_API_URL"), os.getenv("MANAGER_API_SECRET"))
            child_profile = await db_helper.get_child_profile_by_mac(device_mac)
            if child_profile:
                logger.info(f"worker.child_profile(name={child_profile.get('name')}, age={child_profile.get('age')}, src=db)")
        except Exception as e:
            logger.error(f"worker.profile_error({e})")

    child_name = child_profile.get("name", "buddy") if child_profile else "buddy"
    child_age = child_profile.get("age", 7) if child_profile else 7
    game_mode = "commander" if child_age >= 9 else "explorer"

    # Agentic prompt — LLM IS the narrator personality
    # The system prompt MUST be strict enough that the LLM follows [GAME] tagged instructions exactly
    agent_prompt = f"""You are Cheeko, a fun quiz buddy for {child_name} (age {child_age}).
You're hosting "Odd One Out" — kids find the item that doesn't belong.

CRITICAL BEHAVIOR:
You will receive system messages tagged with [GAME START], [QUESTION], [CORRECT!], [WRONG], [TIMEOUT], [HINT], [LEVEL COMPLETE], [GAME OVER].

When you receive a [GAME] tagged message:
1. You MUST respond with EXACTLY what the tag asks for — no more, no less
2. You MUST include ALL the specific content mentioned (items, explanations, fun facts)
3. You MUST NOT ask questions back like "are you ready?" or "want to play?"
4. You MUST NOT add extra content beyond what's requested
5. Keep to 2-3 sentences maximum
6. Rephrase naturally but preserve ALL factual content from the instruction

When the child speaks:
- If they name an item, call check_oddoneout_answer with their answer
- If unrelated, respond in 1 sentence and wait for the next game event

EXAMPLES:
System: [QUESTION 1/5] Read these items: Cat, Dog, Banana. Ask which doesn't belong.
You: "Alright, here we go! We have Cat, Dog, and Banana. Which one do you think doesn't belong?"

System: [CORRECT!] Celebrate! Explain WHY: Banana is a fruit, not an animal. Fun fact: Bananas are technically berries.
You: "Amazing job! You got it! Banana is the odd one out because it's a fruit, while Cat and Dog are animals. And here's a cool fact — bananas are technically berries!"

System: [WRONG] Be gentle! The odd one out was Banana. Explain: It's a fruit, not an animal. Fun fact: Bananas are berries.
You: "Good try! The odd one out was Banana — it's a fruit, while Cat and Dog are animals. Fun fact: bananas are actually berries! Let's try the next one."

NEVER say: "Let me know when you're ready", "Want to play another round?", "Ready for the next one?"
The game advances automatically. Just respond to the [GAME] tag and stop.

Accept answers in any language: English, Hindi, or mixed."""

    # Pipeline
    stt, llm, tts = create_pipeline(yaml_config)

    # State
    game_state = OddOneOutState(game_mode=game_mode)
    set_oddoneout_game_state(game_state)

    # Agent & Session
    agent = OddOneOutAgent(instructions=agent_prompt)
    session = AgentSession(
        stt=stt, llm=llm, tts=tts,
        tools=[check_oddoneout_answer],
        allow_interruptions=False,
    )

    # Modules
    dc = DataChannel(ctx.room)
    narrator = OddOneOutNarrator(session, agent, child_name=child_name, child_age=child_age)
    qgen = OddOneOutQuestionGenerator()

    engine = None

    async def _on_hint(clue: str):
        if engine:
            await engine.on_hint_triggered(game_state.current_question_id, clue)

    async def _on_timeout():
        if engine:
            await engine.on_timeout(game_state.current_question_id)

    hint_manager = OddOneOutHintManager(
        on_hint_speak=_on_hint, on_timeout=_on_timeout, game_mode=game_mode,
    )
    engine = OddOneOutEngine(
        game_state=game_state, narrator=narrator, hint_manager=hint_manager,
        data_channel=dc, question_generator=qgen, session=session,
        child_name=child_name, child_age=child_age,
    )

    # DC handlers
    dc.on("game_answer", engine.on_tap_answer)
    dc.on("game_control", engine.on_game_control)

    async def _on_ready(msg):
        logger.info("worker.greeting_triggered(src=dc)")
        await engine.on_game_start(child_name, child_age, game_mode)
    dc.on("ready_for_greeting", _on_ready)

    async def _on_end_prompt(msg):
        await narrator.speak_end_prompt(msg.get("prompt", "Great game! Goodbye!"))
    dc.on("end_prompt", _on_end_prompt)

    async def _on_shutdown(msg):
        logger.info("worker.shutdown_request")
        if msg.get("require_ack"):
            await dc.send({"type": "shutdown_ack", "session_id": msg.get("session_id", "")})
        hint_manager.cancel_timers()
    dc.on("shutdown_request", _on_shutdown)

    # Voice tool -> engine
    @session.on("function_tools_executed")
    def on_tools_executed(ev):
        has_check = False
        check_result = None
        for call, output in ev.zipped():
            fn_name = getattr(call, "name", str(call))
            if fn_name == "check_oddoneout_answer":
                has_check = True
                try:
                    raw = output.output if hasattr(output, "output") else str(output)
                    check_result = json.loads(raw)
                except (json.JSONDecodeError, TypeError, AttributeError):
                    logger.error(f"worker.tool_parse_error({str(output)[:200]})")
        if has_check and check_result:
            ev.cancel_tool_reply()
            logger.info("worker.tool_reply_cancelled(tool=check_oddoneout_answer)")
            asyncio.create_task(engine.on_voice_answer(check_result))

    # Usage tracking
    usage_manager = UsageManager(mac_address=device_mac, session_id=room_name)
    usage_manager.setup_metrics_collection(session)

    # Connect
    await ctx.connect(auto_subscribe=AutoSubscribe.AUDIO_ONLY)

    my_id = ctx.room.local_participant.identity if ctx.room.local_participant else None
    existing = [p for p in ctx.room.remote_participants.values()
                if p.identity and "agent" in p.identity.lower() and p.identity != my_id]
    if existing:
        logger.warning(f"worker.duplicate_agent({[a.identity for a in existing]})")
        return

    await session.start(agent=agent, room=ctx.room)
    await dc.mark_ready()
    logger.info("worker.session_started")

    if child_profile:
        await dc.send({"type": "child_profile", **child_profile})
    await dc.send({
        "type": "game_state", "state": "playing",
        "game_mode": game_mode, "progress": game_state._get_progress(),
    })

    async def cleanup():
        logger.info("worker.cleanup")
        hint_manager.cancel_timers()
    ctx.add_shutdown_callback(cleanup)


if __name__ == "__main__":
    cli.run_app(WorkerOptions(
        entrypoint_fnc=entrypoint, prewarm_fnc=prewarm,
        port=DEFAULT_PORT, agent_name=AGENT_NAME,
    ))
