"""
Cheeko Sarvam Agent Worker
Conversational agent using Sarvam STT/TTS + Groq LLM pipeline

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
from livekit.plugins import groq, sarvam

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
    init_chat_history_service,
    extract_and_send_chat_history,
)
# from src.features.mode_switching import update_agent_mode  # COMMENTED OUT - tools disabled for testing

# Agent configuration
AGENT_NAME = "cheeko-agent"
CHARACTER_NAME = "Cheeko"
DEFAULT_PORT = 8081
# MODE_SWITCH_TOOLS = [update_agent_mode]  # COMMENTED OUT - tools disabled for testing


class CheekoAssistant(BaseAssistant):
    """Cheeko Assistant - Sarvam STT/TTS conversational agent"""

    GREETING_INSTRUCTION = "Greet the user warmly as Cheeko, a friendly AI companion. Keep it brief and playful."

    def __init__(self, instructions: str = None) -> None:
        super().__init__(instructions=instructions)


def prewarm(proc: JobProcess):
    """Prewarm for Sarvam STT + Groq LLM + Sarvam TTS pipeline"""
    logger.info("[PREWARM] Ready for STT/LLM/TTS pipeline (Sarvam + Groq + Sarvam)")
    proc.userdata["ready"] = True


async def entrypoint(ctx: JobContext):
    """Entrypoint for Cheeko Sarvam agent worker"""

    # Load configuration
    yaml_config = ConfigLoader.load_yaml_config()

    ctx.log_context_fields = {"room": ctx.room.name}
    logger.info(f"Starting {CHARACTER_NAME} Sarvam agent in room: {ctx.room.name}")

    init_start_time = asyncio.get_event_loop().time()

    # Load Sarvam pipeline configuration from config.yaml
    sarvam_config = yaml_config.get('sarvam', {})
    sarvam_stt_config = sarvam_config.get('stt', {})
    sarvam_tts_config = sarvam_config.get('tts', {})

    # Sarvam API key: env var takes priority over config.yaml
    sarvam_api_key = os.getenv("SARVAM_API_KEY") or sarvam_config.get('api_key', '')

    # STT settings
    stt_model = sarvam_stt_config.get('model', 'saaras:v3')
    stt_language = sarvam_stt_config.get('language', 'kn-IN')
    stt_mode = sarvam_stt_config.get('mode', 'transcribe')

    # TTS settings
    tts_model = sarvam_tts_config.get('model', 'bulbul:v3-beta')
    tts_speaker = sarvam_tts_config.get('speaker', 'shubh')
    tts_language = sarvam_tts_config.get('target_language_code', 'kn-IN')
    tts_pace = sarvam_tts_config.get('pace', 1.0)
    tts_sample_rate = sarvam_tts_config.get('speech_sample_rate', 16000)

    # LLM settings (Groq)
    llm_config = yaml_config.get('groq', {})
    llm_model = llm_config.get('model', 'openai/gpt-oss-20b')
    llm_temperature = llm_config.get('temperature', 0.8)

    # Parse room name
    room_name = ctx.room.name
    device_mac, room_type = parse_room_name(room_name)

    # Initialize services
    prompt_service = PromptService()
    agent_prompt = ConfigLoader.get_default_prompt()
    child_profile = None
    agent_id = None

    # Check if child profile and memories are in dispatch metadata
    dispatch_child_profile = None
    dispatch_memories = []
    dispatch_relations = []
    dispatch_entities = []
    try:
        if hasattr(ctx, 'job') and ctx.job and ctx.job.metadata:
            dispatch_metadata = json.loads(ctx.job.metadata)
            dispatch_child_profile = dispatch_metadata.get('child_profile')
            dispatch_memories = dispatch_metadata.get('long_term_memories', [])
            dispatch_relations = dispatch_metadata.get('memory_relations', [])
            dispatch_entities = dispatch_metadata.get('memory_entities', [])
            if dispatch_child_profile:
                logger.info(f"👶 Using child profile from dispatch metadata: {dispatch_child_profile.get('name')}, age: {dispatch_child_profile.get('age')}")
            if dispatch_memories:
                logger.info(f"🧠 [MEM0] Received {len(dispatch_memories)} memories, {len(dispatch_relations)} relations, {len(dispatch_entities)} entities")
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

            # Parallel API calls
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

            # Process prompt
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
    has_placeholder = '{{' in agent_prompt or '{%' in agent_prompt
    has_child_name = 'child_name' in agent_prompt
    logger.info(f"Template analysis - Has Jinja: {has_placeholder}, Has child_name: {has_child_name}")

    if child_profile:
        agent_prompt = render_prompt_with_profile(
            agent_prompt, child_profile, dispatch_memories, dispatch_relations, dispatch_entities
        )

    logger.info(f"Final prompt length: {len(agent_prompt)} chars")
    logger.info(f"Child name '{child_profile.get('name') if child_profile else 'N/A'}' in prompt: {'Rahul' in agent_prompt}")
    logger.info(f"Prompt preview (first 500 chars): {agent_prompt[:500]}")

    # Create Sarvam + Groq pipeline components
    # STT: Sarvam
    stt_kwargs = {
        "model": stt_model,
        "language": stt_language,
    }
    if sarvam_api_key:
        stt_kwargs["api_key"] = sarvam_api_key
    stt = sarvam.STT(**stt_kwargs)
    logger.info(f"Sarvam STT created (model: {stt_model}, language: {stt_language})")

    # LLM: Groq
    llm = groq.LLM(
        model=llm_model,
        temperature=llm_temperature
    )
    logger.info(f"Groq LLM created (model: {llm_model}, temp: {llm_temperature})")

    # TTS: Sarvam
    tts_kwargs = {
        "model": tts_model,
        "speaker": tts_speaker,
        "target_language_code": tts_language,
        "pace": tts_pace,
        "speech_sample_rate": tts_sample_rate,
    }
    if sarvam_api_key:
        tts_kwargs["api_key"] = sarvam_api_key
    tts = sarvam.TTS(**tts_kwargs)
    logger.info(f"Sarvam TTS created (model: {tts_model}, speaker: {tts_speaker}, language: {tts_language})")

    # Create AgentSession with Sarvam pipeline
    session = AgentSession(
        stt=stt,
        llm=llm,
        tts=tts,
        # tools=MODE_SWITCH_TOOLS  # COMMENTED OUT - tools disabled for testing
    )
    logger.info("AgentSession created (no tools - testing mode)")

    # Create state handlers
    emit_agent_state, emit_speech_created = create_state_handlers(ctx, session)
    logger.info("State management registered")

    # Debug: Track user speech and function calls
    @session.on("user_speech_committed")
    def on_user_speech(msg):
        text = getattr(msg, 'text', str(msg)) if hasattr(msg, 'text') else str(msg)
        logger.info(f"🎤 USER SAID: '{text}'")

    @session.on("function_calls_started")
    def on_function_calls_started(ev):
        logger.info(f"🔧 FUNCTION CALL STARTED: {ev}")

    @session.on("function_calls_finished")
    def on_function_calls_finished(ev):
        logger.info(f"✅ FUNCTION CALL FINISHED: {ev}")

    # Setup error handling
    error_manager = None
    try:
        from src.agent.error_handler import setup_error_handling
        error_manager = setup_error_handling(session=session, max_retries=3, custom_audio_path=None)
        logger.info("Error handling enabled")
    except Exception as e:
        logger.warning(f"Error handler not available: {e}")

    # Create assistant instance
    assistant = CheekoAssistant(instructions=agent_prompt)
    assistant.set_room_info(room_name=ctx.room.name, device_mac=device_mac)
    logger.info(f"{CHARACTER_NAME} Sarvam Assistant initialized")

    # assistant.enable_mode_switching()  # COMMENTED OUT - tools disabled for testing
    logger.info("Cheeko features: all tools disabled (testing mode)")

    # Room lifecycle management
    participant_count = len(ctx.room.remote_participants)
    cleanup_completed = False

    # Initialize chat history service
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
            try:
                await asyncio.shield(
                    extract_and_send_chat_history(session, chat_history_service, device_mac)
                )
            except asyncio.CancelledError:
                logger.warning("Cleanup was cancelled but chat history send should complete")

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

    async def handle_end_prompt(prompt_text: str):
        """Handle end prompt - say goodbye message before cleanup"""
        try:
            logger.info(f"👋 [END-PROMPT] Saying goodbye: {prompt_text[:50]}...")
            try:
                await asyncio.wait_for(
                    session.say(prompt_text),
                    timeout=10.0
                )
                logger.info("👋 [END-PROMPT] Goodbye message completed")
            except asyncio.TimeoutError:
                logger.warning("👋 [END-PROMPT] Goodbye timed out - session may be busy")
            except Exception as gen_error:
                logger.warning(f"👋 [END-PROMPT] Could not generate goodbye: {gen_error}")
        except Exception as e:
            logger.error(f"👋 [END-PROMPT] Error in goodbye handler: {e}")

    @ctx.room.on("data_received")
    def on_data_received(data_packet: rtc.DataPacket):
        """Handle data channel messages from gateway"""
        try:
            message = json.loads(data_packet.data.decode('utf-8'))
            msg_type = message.get('type')

            if msg_type == 'ready_for_greeting':
                logger.info("🎤 Device ready for greeting - triggering greeting now")
                asyncio.create_task(assistant.play_greeting())
                return

            if msg_type == 'end_prompt':
                prompt_text = message.get('prompt', "Time flies so fast! It was wonderful talking with you. Goodbye!")
                logger.info(f"👋 [END-PROMPT] Received end_prompt from gateway")
                asyncio.create_task(handle_end_prompt(prompt_text))
                return

            if msg_type == 'shutdown_request':
                logger.info("Received shutdown_request from gateway, initiating cleanup...")
                if message.get('require_ack'):
                    asyncio.create_task(send_shutdown_ack(message.get('session_id', '')))
                asyncio.create_task(cleanup_room_and_session())
                return

            if msg_type == 'user_text':
                text = (message.get('text') or '').strip()
                if not text:
                    logger.warning("⚠️ user_text message with empty text, ignoring")
                    return

                logger.info(f"💬 [USER_TEXT] Received from gateway: {text}")
                logger.info(f"🧾 [USER_TEXT-RAW] Payload: {message}")

                async def handle_user_text():
                    try:
                        await emit_agent_state("listening")
                        await session.say(text)
                    except Exception as e:
                        logger.error(f"❌ Error handling user_text: {e}")

                asyncio.create_task(handle_user_text())

        except Exception as e:
            logger.error(f"Error handling data channel message: {e}")

    ctx.add_shutdown_callback(cleanup_room_and_session)

    # Connect and start session
    await ctx.connect(auto_subscribe=AutoSubscribe.AUDIO_ONLY)

    # Duplicate agent check
    my_identity = ctx.room.local_participant.identity if ctx.room.local_participant else None
    existing_agents = [
        p for p in ctx.room.remote_participants.values()
        if p.identity and 'agent' in p.identity.lower() and p.identity != my_identity
    ]
    if existing_agents:
        logger.warning(f"⚠️ [DUPLICATE-AGENT] Another agent already in room: {[a.identity for a in existing_agents]}")
        logger.warning(f"⚠️ [DUPLICATE-AGENT] Exiting to prevent duplicate. Room: {ctx.room.name}")
        try:
            await ctx.room.disconnect()
        except Exception:
            pass
        return

    participant = await ctx.wait_for_participant()
    logger.info(f"Participant joined: {participant.identity}")

    assistant.set_agent_session(session)
    assistant.set_session_context(ctx)

    # Start session with 16kHz input audio to match MQTT gateway
    await session.start(
        room=ctx.room,
        agent=assistant,
        room_input_options=RoomInputOptions(
            audio_sample_rate=16000,
            audio_num_channels=1
        )
    )

    init_elapsed = (asyncio.get_event_loop().time() - init_start_time) * 1000
    logger.info(f"Total initialization: {init_elapsed:.0f}ms")
    logger.info(f"{CHARACTER_NAME} Sarvam agent is LIVE!")


if __name__ == "__main__":
    port = int(os.getenv("CHEEKO_PORT", DEFAULT_PORT))
    logger.info(f"Starting {AGENT_NAME} on port {port}")

    cli.run_app(WorkerOptions(
        entrypoint_fnc=entrypoint,
        prewarm_fnc=prewarm,
        agent_name=AGENT_NAME,
        num_idle_processes=1,
        initialize_process_timeout=120.0,
        job_memory_warn_mb=2000,
        port=port,
    ))
