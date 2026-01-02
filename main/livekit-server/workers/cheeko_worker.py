"""
Cheeko Agent Worker
Main conversational agent with all features enabled

agent_name: cheeko-agent
Port: 8081
"""

import os
import sys
import json
import asyncio
import time

# Add parent directory to path for imports
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
    RoomInputOptions,
)
from livekit import rtc, api
from livekit.plugins import google

from src.config.config_loader import ConfigLoader
from src.utils.database_helper import DatabaseHelper
from src.services.prompt_service import PromptService
# from src.services.music_service import MusicService  # COMMENTED OUT - Music service disabled
from src.utils.loki_agent_logger import logger
from src.shared.base_assistant import BaseAssistant
from src.shared.entrypoint_utils import (
    parse_room_name,
    render_prompt_with_profile,
    delete_livekit_room,
    create_state_handlers,
    init_chat_history_service,
    extract_and_send_chat_history,
)
# from src.features.music_tools import play_music, stop_music, next_song, previous_song  # COMMENTED OUT - Music service disabled

# Agent configuration
AGENT_NAME = "cheeko-agent"
CHARACTER_NAME = "Cheeko"
DEFAULT_PORT = 8081
# MUSIC_TOOLS = [play_music, stop_music, next_song, previous_song]  # COMMENTED OUT - Music service disabled


class CheekoAssistant(BaseAssistant):
    """Cheeko Assistant - Main conversational agent"""

    # Custom greeting for Cheeko
    GREETING_INSTRUCTION = "Greet the user warmly as Cheeko, a friendly AI companion. Keep it brief and playful."

    def __init__(self, instructions: str = None) -> None:
        super().__init__(instructions=instructions)



def prewarm(proc: JobProcess):
    """Prewarm for Gemini Realtime - start model preloading here (not on import)"""
    # COMMENTED OUT - Music service disabled (saves ~11s startup time)
    # from src.utils import start_preloading
    # start_preloading()  # Only runs in worker process, not watcher
    logger.info("[PREWARM] Ready for Gemini Realtime")
    proc.userdata["ready"] = True


async def entrypoint(ctx: JobContext):
    """Entrypoint for Cheeko agent worker"""

    # Ensure GOOGLE_API_KEY is available
    yaml_config = ConfigLoader.load_yaml_config()
    api_keys = yaml_config.get('api_keys', {})
    if 'google' in api_keys and not os.getenv('GOOGLE_API_KEY'):
        os.environ['GOOGLE_API_KEY'] = api_keys['google']
        logger.info("Loaded GOOGLE_API_KEY from config.yaml")

    ctx.log_context_fields = {"room": ctx.room.name}
    logger.info(f"Starting {CHARACTER_NAME} agent in room: {ctx.room.name}")

    init_start_time = asyncio.get_event_loop().time()

    # Load configuration
    realtime_config = ConfigLoader.get_gemini_realtime_config()
    gemini_model = realtime_config.get('model', 'gemini-2.5-flash-native-audio-preview-12-2025')
    gemini_voice = realtime_config.get('voice', 'Zephyr')
    gemini_temperature = realtime_config.get('temperature', 0.8)

    # Parse room name
    room_name = ctx.room.name
    device_mac, room_type = parse_room_name(room_name)

    # Initialize services
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
            logger.info("Starting parallel API calls...")
            start_time = asyncio.get_event_loop().time()

            manager_api_url = os.getenv("MANAGER_API_URL")
            manager_api_secret = os.getenv("MANAGER_API_SECRET")
            db_helper = DatabaseHelper(manager_api_url, manager_api_secret)

            # Clear prompt cache
            prompt_service.clear_cache()
            prompt_service.clear_enhanced_cache(device_mac)

            # Parallel API calls - skip child profile fetch if already have from dispatch metadata
            if dispatch_child_profile:
                logger.info("👶 Skipping child profile API call - using dispatch metadata")
                results = await asyncio.gather(
                    db_helper.get_agent_id(device_mac),
                    prompt_service.get_prompt_and_config(room_name, device_mac),
                    return_exceptions=True
                )
                agent_id_result, prompt_config_result = results
                child_profile_result = dispatch_child_profile
            else:
                results = await asyncio.gather(
                    db_helper.get_agent_id(device_mac),
                    prompt_service.get_prompt_and_config(room_name, device_mac),
                    db_helper.get_child_profile_by_mac(device_mac),
                    return_exceptions=True
                )
                agent_id_result, prompt_config_result, child_profile_result = results

            elapsed_time = (asyncio.get_event_loop().time() - start_time) * 1000
            logger.info(f"Parallel API calls completed in {elapsed_time:.0f}ms")

            # Process agent_id
            if isinstance(agent_id_result, Exception):
                logger.error(f"Failed to get agent_id: {agent_id_result}")
            else:
                agent_id = agent_id_result
                logger.info(f"Agent ID: {agent_id}")

            # Process prompt (Cheeko uses regular prompt)
            if isinstance(prompt_config_result, Exception):
                logger.warning(f"Failed to fetch config: {prompt_config_result}")
                agent_prompt = ConfigLoader.get_default_prompt()
            else:
                agent_prompt, _ = prompt_config_result
                logger.info(f"Using device-specific prompt (length: {len(agent_prompt)} chars)")

            # Process child profile
            if isinstance(child_profile_result, Exception):
                logger.warning(f"Failed to fetch child profile: {child_profile_result}")
            else:
                child_profile = child_profile_result
                if child_profile:
                    logger.info(f"Child profile: {child_profile.get('name')}, age {child_profile.get('age')}")

        except Exception as e:
            logger.error(f"Error in API calls: {e}")
            agent_prompt = ConfigLoader.get_default_prompt()

    # Render prompt with child profile
    # Debug: Check if prompt template has child_name placeholder
    has_placeholder = '{{' in agent_prompt or '{%' in agent_prompt
    has_child_name = 'child_name' in agent_prompt
    logger.info(f"Template analysis - Has Jinja: {has_placeholder}, Has child_name: {has_child_name}")
    
    if child_profile:
        agent_prompt = render_prompt_with_profile(agent_prompt, child_profile)

    logger.info(f"Final prompt length: {len(agent_prompt)} chars")

    # COMMENTED OUT - Music service disabled
    # # CRITICAL: Append silence instructions for music/story tools
    # # This prevents the agent from speaking after audio playback starts
    # silence_instructions = """
    #
    # 🔇 AUDIO TOOL RESPONSE RULE:
    # When play_music() or play_story() function returns:
    # - Do NOT generate any spoken response for THAT specific function call
    # - The audio is already playing - speaking would interrupt it
    # - Once the user speaks AGAIN with a NEW question or request, respond normally as usual
    # This only applies to the immediate response after play_music/play_story - continue normal conversation when user speaks next.
    # """
    # agent_prompt = agent_prompt + silence_instructions
    # logger.info("Added silence instructions for audio tools")

    # Debug: Check if Rahul appears in final prompt
    logger.info(f"Child name '{child_profile.get('name') if child_profile else 'N/A'}' in prompt: {'Rahul' in agent_prompt}")
    # Debug: Show first 500 chars of prompt to verify child name
    logger.info(f"Prompt preview (first 500 chars): {agent_prompt[:500]}")

    # Create Gemini Realtime model
    realtime_model = google.realtime.RealtimeModel(
        model=gemini_model,
        voice=gemini_voice,
        instructions=agent_prompt,
        temperature=gemini_temperature,
        modalities=["AUDIO"],
    )
    logger.info("Gemini Realtime model created")

    # Create AgentSession (music tools disabled)
    # session = AgentSession(llm=realtime_model, tools=MUSIC_TOOLS)  # COMMENTED OUT - Music service disabled
    # logger.info(f"AgentSession created with {len(MUSIC_TOOLS)} music tools")
    session = AgentSession(llm=realtime_model)
    logger.info("AgentSession created (no music tools)")

    # Create state handlers
    emit_agent_state, emit_speech_created = create_state_handlers(ctx, session)
    logger.info("State management registered")

    # ============================================================================
    # DEBUG: Track user speech and function calls
    # ============================================================================

    @session.on("user_speech_committed")
    def on_user_speech(msg):
        """Log what the user said (transcription)"""
        text = getattr(msg, 'text', str(msg)) if hasattr(msg, 'text') else str(msg)
        logger.info(f"🎤 USER SAID: '{text}'")

    @session.on("function_calls_started")
    def on_function_calls_started(ev):
        """Log when function calls are initiated"""
        logger.info(f"🔧 FUNCTION CALL STARTED: {ev}")

    @session.on("function_calls_finished")
    def on_function_calls_finished(ev):
        """Log when function calls complete"""
        logger.info(f"✅ FUNCTION CALL FINISHED: {ev}")

    logger.info("📊 Debug logging for speech and function calls enabled")

    # Setup error handling
    error_manager = None
    try:
        from src.agent.error_handler import setup_error_handling
        error_manager = setup_error_handling(session=session, max_retries=3, custom_audio_path=None)
        logger.info("Error handling enabled")
    except Exception as e:
        logger.warning(f"Error handler not available: {e}")

    # COMMENTED OUT - Music service disabled
    # # Initialize music service
    # music_service = MusicService()
    # asyncio.create_task(music_service.initialize())
    # logger.info("Music service initialized (async)")

    # Create assistant instance
    assistant = CheekoAssistant(instructions=agent_prompt)
    assistant.set_room_info(room_name=ctx.room.name, device_mac=device_mac)
    logger.info(f"{CHARACTER_NAME} Assistant initialized")

    # COMMENTED OUT - Music service disabled
    # # Initialize audio player
    # from src.services.unified_audio_player import UnifiedAudioPlayer
    # audio_player = UnifiedAudioPlayer()
    # audio_player.set_context(ctx)
    # assistant.audio_player = audio_player

    # Enable Cheeko features (no games - use mode_switching to dispatch to game workers)
    assistant.enable_battery_tools()
    assistant.enable_volume_tools()
    assistant.enable_mode_switching()
    # assistant.enable_music_tools(music_service)  # COMMENTED OUT - Music service disabled
    logger.info("Cheeko features enabled (battery, volume, mode switching)")

    # Room lifecycle management
    participant_count = len(ctx.room.remote_participants)
    cleanup_completed = False

    # Initialize chat history service (sends on room close)
    chat_history_service = None
    if agent_id and device_mac:
        chat_history_service = init_chat_history_service(device_mac, room_name, agent_id)

    async def cleanup_room_and_session():
        nonlocal cleanup_completed
        if cleanup_completed:
            return
        cleanup_completed = True
        try:
            logger.info("Initiating cleanup")

            # Extract and send chat history before closing session
            await extract_and_send_chat_history(session, chat_history_service)

            if session and hasattr(session, 'aclose'):
                await session.aclose()
            if ctx.room and hasattr(ctx.room, 'disconnect'):
                await ctx.room.disconnect()
            await delete_livekit_room(ctx.room.name if ctx.room else "unknown")
            logger.info("Cleanup completed")
        except Exception as e:
            logger.error(f"Error during cleanup: {e}")

    @ctx.room.on("participant_disconnected")
    def on_participant_disconnected(participant: rtc.RemoteParticipant):
        nonlocal participant_count
        participant_count -= 1
        logger.info(f"Participant disconnected: {participant.identity}, remaining: {participant_count}")
        if participant_count == 0:
            asyncio.create_task(cleanup_room_and_session())

    @ctx.room.on("participant_connected")
    def on_participant_connected(participant: rtc.RemoteParticipant):
        nonlocal participant_count
        participant_count += 1
        logger.info(f"Participant connected: {participant.identity}, total: {participant_count}")

    @ctx.room.on("disconnected")
    def on_room_disconnected():
        logger.info("Room disconnected, initiating cleanup")
        asyncio.create_task(cleanup_room_and_session())

    async def send_shutdown_ack(session_id: str):
        """Send shutdown acknowledgment back to gateway"""
        try:
            import time
            ack_message = {
                "type": "shutdown_ack",
                "session_id": session_id,
                "timestamp": int(time.time() * 1000),
                "source": "livekit_agent"
            }
            await ctx.room.local_participant.publish_data(
                json.dumps(ack_message).encode("utf-8"),
                reliable=True
            )
            logger.info("Sent shutdown_ack to gateway")
        except Exception as e:
            logger.error(f"Failed to send shutdown_ack: {e}")

    @ctx.room.on("data_received")
    def on_data_received(data_packet: rtc.DataPacket):
        """Handle data channel messages from gateway"""
        try:
            message = json.loads(data_packet.data.decode('utf-8'))
            msg_type = message.get('type')

            # Handle shutdown request from gateway
            if msg_type == 'shutdown_request':
                logger.info("Received shutdown_request from gateway, initiating cleanup...")

                # Send ack if requested
                if message.get('require_ack'):
                    asyncio.create_task(send_shutdown_ack(message.get('session_id', '')))

                # Trigger cleanup
                asyncio.create_task(cleanup_room_and_session())
                return

        except Exception as e:
            logger.error(f"Error handling data channel message: {e}")

    # COMMENTED OUT - Music service disabled
    # @ctx.room.on("data_received") - OLD HANDLER
    # def on_data_received(data_packet: rtc.DataPacket):
    #     try:
    #         message = json.loads(data_packet.data.decode('utf-8'))
    #         if message.get('type') == 'playback_control':
    #             action = message.get('action')
    #             if action == 'next':
    #                 asyncio.create_task(handle_skip())
    #     except Exception as e:
    #         logger.error(f"Error handling data: {e}")
    #
    # async def handle_skip():
    #     try:
    #         if assistant.audio_player:
    #             await assistant.audio_player.stop()
    #         from src.features.music_tools import play_next_in_playlist
    #         song = await play_next_in_playlist()
    #         if song and assistant.audio_player:
    #             await asyncio.sleep(0.3)
    #             await assistant.audio_player.play_from_url(song['url'], song['title'])
    #     except Exception as e:
    #         logger.error(f"Error in skip: {e}")

    ctx.add_shutdown_callback(cleanup_room_and_session)

    # Connect and start session
    await ctx.connect(auto_subscribe=AutoSubscribe.AUDIO_ONLY)

    # DUPLICATE AGENT CHECK: Prevent multiple agents in same room
    # Check if another agent is already in the room
    my_identity = ctx.room.local_participant.identity if ctx.room.local_participant else None
    existing_agents = [
        p for p in ctx.room.remote_participants.values()
        if p.identity and 'agent' in p.identity.lower() and p.identity != my_identity
    ]
    if existing_agents:
        logger.warning(f"⚠️ [DUPLICATE-AGENT] Another agent already in room: {[a.identity for a in existing_agents]}")
        logger.warning(f"⚠️ [DUPLICATE-AGENT] Exiting to prevent duplicate. Room: {ctx.room.name}")
        # Disconnect and exit gracefully
        try:
            await ctx.room.disconnect()
        except Exception:
            pass
        return  # Exit entrypoint - don't start session

    participant = await ctx.wait_for_participant()
    logger.info(f"Participant joined: {participant.identity}")

    assistant.set_agent_session(session)
    assistant.set_session_context(ctx)
    # audio_player.set_session(session)  # COMMENTED OUT - Music service disabled

    await session.start(room=ctx.room, agent=assistant)

    init_elapsed = (asyncio.get_event_loop().time() - init_start_time) * 1000
    logger.info(f"Total initialization: {init_elapsed:.0f}ms")
    logger.info(f"{CHARACTER_NAME} agent is LIVE!")

    # COMMENTED OUT - Music service disabled
    # # Auto-start music if in Music Mode
    # if room_type == "music":
    #     logger.info("[MUSIC MODE] Auto-starting music playback")
    #     try:
    #         from src.features.music_tools import start_music_mode
    #         song = await start_music_mode()
    #         if song:
    #             logger.info(f"[MUSIC MODE] Now playing: {song['title']}")
    #     except Exception as e:
    #         logger.error(f"[MUSIC MODE] Failed to start music: {e}")



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
