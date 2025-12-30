"""
Riddle Solver Agent Worker
Game agent for riddles with answer validation

agent_name: riddle-solver-agent
Port: 8083
"""

import os
import sys
import json
import asyncio
import time

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from dotenv import load_dotenv
load_dotenv(".env")

from livekit.agents import (
    AgentSession,
    JobContext,
    JobProcess,
    WorkerOptions,
    cli,
    AutoSubscribe,
)
from livekit import rtc, api
from livekit.plugins import google

from src.config.config_loader import ConfigLoader
from src.utils.database_helper import DatabaseHelper
from src.services.prompt_service import PromptService
from src.utils.loki_agent_logger import logger
from src.shared.base_assistant import BaseAssistant
from src.shared.entrypoint_utils import (
    parse_room_name,
    render_prompt_with_profile,
    delete_livekit_room,
    create_state_handlers,
    load_game_prompt,
)
from src.features.game_tools import check_riddle_answer, set_riddle_game_state

AGENT_NAME = "riddle-solver-agent"
CHARACTER_NAME = "Riddle Solver"
DEFAULT_PORT = 8083
GAME_TOOLS = [check_riddle_answer]


class RiddleSolverAssistant(BaseAssistant):
    """Riddle Solver Assistant"""

    # Custom greeting for Riddle Solver
    GREETING_INSTRUCTION = "Greet the user as the Riddle Master. Introduce yourself mysteriously and ask if they're ready to solve some brain-teasing riddles. Be playful and intriguing."

    def __init__(self, instructions: str = None) -> None:
        super().__init__(instructions=instructions)
        logger.info("RiddleSolverAssistant initialized")


def prewarm(proc: JobProcess):
    logger.info("[PREWARM] Ready for Gemini Realtime")
    proc.userdata["ready"] = True


async def entrypoint(ctx: JobContext):
    """Entrypoint for Riddle Solver agent worker"""

    yaml_config = ConfigLoader.load_yaml_config()
    api_keys = yaml_config.get('api_keys', {})
    if 'google' in api_keys and not os.getenv('GOOGLE_API_KEY'):
        os.environ['GOOGLE_API_KEY'] = api_keys['google']

    ctx.log_context_fields = {"room": ctx.room.name}
    logger.info(f"Starting {CHARACTER_NAME} agent in room: {ctx.room.name}")

    init_start_time = asyncio.get_event_loop().time()

    realtime_config = ConfigLoader.get_gemini_realtime_config()
    gemini_model = realtime_config.get('model', 'gemini-live-2.5-flash-native-audio')
    gemini_voice = realtime_config.get('voice', 'Zephyr')
    gemini_temperature = realtime_config.get('temperature', 0.8)

    room_name = ctx.room.name
    device_mac, room_type = parse_room_name(room_name)

    prompt_service = PromptService()
    agent_prompt = ConfigLoader.get_default_prompt()
    child_profile = None
    agent_id = None

    # Check if child profile is in dispatch metadata (passed from MQTT gateway)
    dispatch_child_profile = None
    try:
        if hasattr(ctx, 'job') and ctx.job and ctx.job.metadata:
            dispatch_metadata = json.loads(ctx.job.metadata)
            dispatch_child_profile = dispatch_metadata.get('child_profile')
            if dispatch_child_profile:
                logger.info(f"👶 Using child profile from dispatch metadata: {dispatch_child_profile.get('name')}, age: {dispatch_child_profile.get('age')}")
    except Exception as e:
        logger.debug(f"No dispatch metadata or error parsing: {e}")

    if device_mac:
        try:
            manager_api_url = os.getenv("MANAGER_API_URL")
            manager_api_secret = os.getenv("MANAGER_API_SECRET")
            db_helper = DatabaseHelper(manager_api_url, manager_api_secret)

            prompt_service.clear_cache()
            prompt_service.clear_enhanced_cache(device_mac)

            # Skip child profile fetch if already have from dispatch metadata
            if dispatch_child_profile:
                logger.info("👶 Skipping child profile API call - using dispatch metadata")
                results = await asyncio.gather(
                    db_helper.get_agent_id(device_mac),
                    return_exceptions=True
                )
                agent_id_result = results[0]
                child_profile_result = dispatch_child_profile
            else:
                results = await asyncio.gather(
                    db_helper.get_agent_id(device_mac),
                    db_helper.get_child_profile_by_mac(device_mac),
                    return_exceptions=True
                )
                agent_id_result, child_profile_result = results

            if not isinstance(agent_id_result, Exception):
                agent_id = agent_id_result

            if not isinstance(child_profile_result, Exception):
                child_profile = child_profile_result

            # Load game-specific prompt
            game_prompt = load_game_prompt(CHARACTER_NAME, child_profile)
            if game_prompt:
                agent_prompt = game_prompt
                logger.info(f"Loaded {CHARACTER_NAME} prompt ({len(agent_prompt)} chars)")

        except Exception as e:
            logger.error(f"Error in API calls: {e}")

    if child_profile:
        agent_prompt = render_prompt_with_profile(agent_prompt, child_profile)

    logger.info(f"Final prompt length: {len(agent_prompt)} chars")

    realtime_model = google.realtime.RealtimeModel(
        model=gemini_model,
        voice=gemini_voice,
        instructions=agent_prompt,
        temperature=gemini_temperature,
        modalities=["AUDIO"],
    )

    session = AgentSession(llm=realtime_model, tools=GAME_TOOLS)
    logger.info(f"AgentSession created with {len(GAME_TOOLS)} game tools")

    emit_agent_state, emit_speech_created = create_state_handlers(ctx, session)

    try:
        from src.agent.error_handler import setup_error_handling
        setup_error_handling(session=session, max_retries=3, custom_audio_path=None)
    except Exception as e:
        logger.warning(f"Error handler not available: {e}")

    assistant = RiddleSolverAssistant(instructions=agent_prompt)
    assistant.set_room_info(room_name=ctx.room.name, device_mac=device_mac)

    from src.services.unified_audio_player import UnifiedAudioPlayer
    audio_player = UnifiedAudioPlayer()
    audio_player.set_context(ctx)
    assistant.audio_player = audio_player

    assistant.enable_battery_tools()
    assistant.enable_volume_tools()
    assistant.enable_riddle_game()
    set_riddle_game_state(assistant.riddle_game_state)
    logger.info("Riddle Solver features enabled")

    participant_count = len(ctx.room.remote_participants)
    cleanup_completed = False

    async def cleanup_room_and_session():
        nonlocal cleanup_completed
        if cleanup_completed:
            return
        cleanup_completed = True
        try:
            if session and hasattr(session, 'aclose'):
                await session.aclose()
            if ctx.room and hasattr(ctx.room, 'disconnect'):
                await ctx.room.disconnect()
            await delete_livekit_room(ctx.room.name if ctx.room else "unknown")
        except Exception as e:
            logger.error(f"Error during cleanup: {e}")

    @ctx.room.on("participant_disconnected")
    def on_participant_disconnected(participant: rtc.RemoteParticipant):
        nonlocal participant_count
        participant_count -= 1
        if participant_count == 0:
            asyncio.create_task(cleanup_room_and_session())

    @ctx.room.on("disconnected")
    def on_room_disconnected():
        asyncio.create_task(cleanup_room_and_session())

    ctx.add_shutdown_callback(cleanup_room_and_session)

    await ctx.connect(auto_subscribe=AutoSubscribe.AUDIO_ONLY)
    participant = await ctx.wait_for_participant()
    logger.info(f"Participant joined: {participant.identity}")

    assistant.set_agent_session(session)
    assistant.set_session_context(ctx)
    audio_player.set_session(session)

    await session.start(room=ctx.room, agent=assistant)

    init_elapsed = (asyncio.get_event_loop().time() - init_start_time) * 1000
    logger.info(f"Total initialization: {init_elapsed:.0f}ms")
    logger.info(f"{CHARACTER_NAME} agent is LIVE!")


if __name__ == "__main__":
    # Use fixed port (ignore PORT env var to avoid conflicts with other workers)
    logger.info(f"Starting {AGENT_NAME} on port {DEFAULT_PORT}")

    cli.run_app(WorkerOptions(
        entrypoint_fnc=entrypoint,
        prewarm_fnc=prewarm,
        agent_name=AGENT_NAME,
        num_idle_processes=1,
        initialize_process_timeout=120.0,
        job_memory_warn_mb=2000,
        port=DEFAULT_PORT,
    ))
