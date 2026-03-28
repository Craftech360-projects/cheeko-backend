"""
Cheeko Astronaut Agent Worker
Conversational agent themed as a space explorer/astronaut companion

agent_name: cheeko-astronaut-agent
Port: 8088
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
    RoomInputOptions,
)
from livekit import rtc, api
from livekit.plugins import google, elevenlabs
import io
from pydub import AudioSegment

from src.config.config_loader import ConfigLoader
from src.services.elevenlabs_tts_service import get_elevenlabs_service
from src.utils.database_helper import DatabaseHelper
from src.services.prompt_service import PromptService
from src.utils.loki_agent_logger import logger
from src.utils.helpers import UsageManager
from src.shared.base_assistant import BaseAssistant
from src.shared.entrypoint_utils import (
    parse_room_name,
    render_prompt_with_profile,
    delete_livekit_room,
    create_state_handlers,
    init_chat_history_service,
    extract_and_send_chat_history,
)
from src.features.mode_switching import update_agent_mode
from src.services.mem0_service import mem0_service

# Agent configuration
AGENT_NAME = "cheeko-astronaut-agent"
CHARACTER_NAME = "Cheeko Astronaut"
DEFAULT_PORT = 8088
MODE_SWITCH_TOOLS = [update_agent_mode]

# Keywords that trigger context-aware memory search
MEMORY_TRIGGER_PATTERNS = [
    ("story", ["story about", "tell me a story", "tell a story"]),
    ("remember", ["do you remember", "remember my", "remember when"]),
    ("family", ["about my", "my dog", "my cat", "my pet", "my brother", "my sister", "my mom", "my dad", "my family"]),
    ("question", ["what's my", "who is my", "what is my"]),
    ("space", ["tell me about space", "about the moon", "about mars", "about planets", "about stars", "about rockets"]),
]


def should_inject_memory(text: str) -> tuple[bool, str]:
    """Check if the user's message should trigger memory injection."""
    text_lower = text.lower()
    for category, patterns in MEMORY_TRIGGER_PATTERNS:
        for pattern in patterns:
            if pattern in text_lower:
                return True, category
    return False, ""


async def play_elevenlabs_audio(session: AgentSession, mp3_data: bytes, title: str = ""):
    """Play ElevenLabs MP3 audio via session.say() with pre-synthesized audio frames."""
    try:
        logger.info(f"[ELEVENLABS] Playing audio for: {title}")
        audio_segment = AudioSegment.from_mp3(io.BytesIO(mp3_data))
        audio_segment = audio_segment.set_frame_rate(48000).set_channels(1)

        raw_data = audio_segment.raw_data
        sample_rate = audio_segment.frame_rate
        num_channels = audio_segment.channels
        samples_per_channel = len(audio_segment.get_array_of_samples())

        audio_frame = rtc.AudioFrame(
            data=raw_data,
            sample_rate=sample_rate,
            num_channels=num_channels,
            samples_per_channel=samples_per_channel,
        )

        async def audio_generator():
            yield audio_frame

        await session.say(text=title, audio=audio_generator(), allow_interruptions=False, add_to_chat_ctx=False)
        logger.info(f"[ELEVENLABS] Finished playing: {title}")
    except Exception as e:
        logger.error(f"[ELEVENLABS] Error playing audio: {e}")
        raise


class CheekoAstronautAssistant(BaseAssistant):
    """Cheeko Astronaut Assistant - Space explorer companion"""

    GREETING_INSTRUCTION = (
        "Greet the child as Cheeko the Astronaut! "
        "You are a brave, curious space explorer who has traveled to many planets. "
        "Keep it brief, exciting, and use space-themed language like 'mission control', 'blast off', and 'stellar'."
    )

    def __init__(self, instructions: str = None) -> None:
        super().__init__(instructions=instructions)


def prewarm(proc: JobProcess):
    """Prewarm for Gemini Realtime"""
    logger.info("[PREWARM] Ready for Gemini Realtime")
    proc.userdata["ready"] = True


async def entrypoint(ctx: JobContext):
    """Entrypoint for Cheeko Astronaut agent worker"""

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

    # Check dispatch metadata from MQTT gateway
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
                logger.info(f"Using child profile from dispatch: {dispatch_child_profile.get('name')}, age: {dispatch_child_profile.get('age')}")
            if dispatch_memories:
                logger.info(f"[MEM0] Received {len(dispatch_memories)} memories")
    except Exception as e:
        logger.debug(f"No dispatch metadata or error parsing: {e}")

    if device_mac:
        try:
            logger.info("Starting parallel API calls...")
            start_time = asyncio.get_event_loop().time()

            manager_api_url = os.getenv("MANAGER_API_URL")
            manager_api_secret = os.getenv("MANAGER_API_SECRET")
            db_helper = DatabaseHelper(manager_api_url, manager_api_secret)

            prompt_service.clear_cache()
            prompt_service.clear_enhanced_cache(device_mac)

            if dispatch_child_profile:
                logger.info("Skipping child profile API call - using dispatch metadata")
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

            if isinstance(agent_id_result, Exception):
                logger.error(f"Failed to get agent_id: {agent_id_result}")
            else:
                agent_id = agent_id_result
                logger.info(f"Agent ID: {agent_id}")

            if isinstance(prompt_config_result, Exception):
                logger.warning(f"Failed to fetch config: {prompt_config_result}")
                agent_prompt = ConfigLoader.get_default_prompt()
            else:
                agent_prompt, _ = prompt_config_result
                logger.info(f"Using device-specific prompt (length: {len(agent_prompt)} chars)")

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
    if child_profile:
        agent_prompt = render_prompt_with_profile(
            agent_prompt, child_profile, dispatch_memories, dispatch_relations, dispatch_entities
        )

    logger.info(f"Final prompt length: {len(agent_prompt)} chars")

    # Create Gemini Realtime model
    realtime_model = google.realtime.RealtimeModel(
        model=gemini_model,
        voice=gemini_voice,
        instructions=agent_prompt,
        temperature=gemini_temperature,
        modalities=["AUDIO"],
    )
    google_search_tool = google.tools.GoogleSearch()
    logger.info("Gemini Realtime model created")

    # Create ElevenLabs TTS for session.say()
    elevenlabs_voice_id = os.getenv("ELEVENLABS_VOICE_ID", "ecp3DWciuUyW7BYM7II1")
    elevenlabs_tts = elevenlabs.TTS(voice_id=elevenlabs_voice_id)

    # Create AgentSession
    session = AgentSession(llm=realtime_model, tts=elevenlabs_tts, tools=[*MODE_SWITCH_TOOLS, google_search_tool])
    logger.info(f"AgentSession created with mode switching tools + Google Search + ElevenLabs TTS")

    # Create state handlers
    emit_agent_state, emit_speech_created = create_state_handlers(ctx, session)

    # Usage tracking
    usage_manager = UsageManager(mac_address=device_mac, session_id=room_name)
    usage_manager.setup_metrics_collection(session)

    # Memory injection
    memory_injection_in_progress = False
    last_memory_injection_time = 0

    @session.on("user_speech_committed")
    def on_user_speech(msg):
        nonlocal memory_injection_in_progress, last_memory_injection_time
        text = getattr(msg, 'text', str(msg)) if hasattr(msg, 'text') else str(msg)
        logger.info(f"USER SAID: '{text}'")

        current_time = time.time()
        if memory_injection_in_progress or (current_time - last_memory_injection_time) < 5:
            return

        inject, category = should_inject_memory(text)
        if inject and device_mac and mem0_service.is_ready():
            logger.info(f"[MEM0] Memory trigger detected: category='{category}'")
            memory_injection_in_progress = True
            last_memory_injection_time = current_time
            asyncio.create_task(inject_memory_context(text, device_mac, category))

    async def inject_memory_context(user_query: str, mac_address: str, category: str):
        nonlocal memory_injection_in_progress
        try:
            await asyncio.sleep(0.3)
            relevant_memories = await mem0_service.search_relevant_memories(
                user_id=mac_address, query=user_query, limit=3
            )
            if relevant_memories:
                logger.info(f"[MEM0-INJECT] Found {len(relevant_memories)} relevant memories for '{category}'")
                memory_context = mem0_service.format_relevant_memories_for_injection(user_query, relevant_memories)
                if category in ["story", "remember", "question", "space"]:
                    try:
                        await session.generate_reply(
                            instructions=f"{memory_context}\n\nRespond to the child's request: '{user_query}'"
                        )
                    except Exception as gen_err:
                        logger.debug(f"[MEM0-INJECT] Could not inject: {gen_err}")
        except Exception as e:
            logger.error(f"[MEM0-INJECT] Error searching memories: {e}")
        finally:
            memory_injection_in_progress = False

    @session.on("function_calls_started")
    def on_function_calls_started(ev):
        logger.info(f"FUNCTION CALL STARTED: {ev}")

    @session.on("function_calls_finished")
    def on_function_calls_finished(ev):
        logger.info(f"FUNCTION CALL FINISHED: {ev}")

    # Error handling
    try:
        from src.agent.error_handler import setup_error_handling
        setup_error_handling(session=session, max_retries=3, custom_audio_path=None)
    except Exception as e:
        logger.warning(f"Error handler not available: {e}")

    # Create assistant
    assistant = CheekoAstronautAssistant(instructions=agent_prompt)
    assistant.set_room_info(room_name=ctx.room.name, device_mac=device_mac)
    assistant.enable_mode_switching()
    logger.info(f"{CHARACTER_NAME} Assistant initialized (mode switching enabled)")

    # Room lifecycle
    participant_count = len(ctx.room.remote_participants)
    cleanup_completed = False
    cleanup_task = None

    chat_history_service = None
    if agent_id and device_mac:
        chat_history_service = init_chat_history_service(device_mac, room_name, agent_id)
    else:
        logger.warning(f"Chat history service skipped: agent_id={agent_id}, device_mac={device_mac}")

    async def cleanup_room_and_session():
        nonlocal cleanup_completed, cleanup_task
        current_t = asyncio.current_task()
        if cleanup_task is not None and cleanup_task != current_t:
            try:
                await asyncio.shield(cleanup_task)
            except Exception:
                pass
            return

        if cleanup_completed:
            return

        cleanup_completed = True
        cleanup_task = current_t

        try:
            logger.info("Initiating cleanup")

            try:
                if usage_manager:
                    await asyncio.wait_for(
                        asyncio.shield(usage_manager.log_session_summary()),
                        timeout=5.0
                    )
            except asyncio.TimeoutError:
                logger.warning("Usage logging timed out after 5s")
            except asyncio.CancelledError:
                logger.warning("Usage logging was cancelled")
            except Exception as e:
                logger.warning(f"Failed to log usage summary: {e}")

            try:
                await asyncio.wait_for(
                    asyncio.shield(
                        extract_and_send_chat_history(session, chat_history_service, device_mac)
                    ),
                    timeout=20.0
                )
            except asyncio.TimeoutError:
                logger.warning("Chat history extraction timed out after 20s")
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
        try:
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
        try:
            logger.info(f"[END-PROMPT] Saying goodbye: {prompt_text[:50]}...")
            try:
                await asyncio.wait_for(
                    session.generate_reply(instructions=prompt_text),
                    timeout=10.0
                )
            except asyncio.TimeoutError:
                logger.warning("[END-PROMPT] Goodbye timed out")
            except Exception as gen_error:
                logger.warning(f"[END-PROMPT] Could not generate goodbye: {gen_error}")
        except Exception as e:
            logger.error(f"[END-PROMPT] Error in goodbye handler: {e}")

    @ctx.room.on("data_received")
    def on_data_received(data_packet: rtc.DataPacket):
        try:
            message = json.loads(data_packet.data.decode('utf-8'))
            msg_type = message.get('type')

            if msg_type == 'ready_for_greeting':
                logger.info("Device ready for greeting - triggering greeting now")
                asyncio.create_task(assistant.play_greeting())
                return

            if msg_type == 'end_prompt':
                prompt_text = message.get('prompt', "Mission complete for today, space cadet! It was out of this world talking with you. See you next time!")
                logger.info(f"[END-PROMPT] Received end_prompt from gateway")
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
                content_type = message.get('content_type', 'prompt')
                content_text = message.get('content_text', '')
                title = message.get('title', '')

                has_content = bool(content_text) if content_type in ('animal', 'read_only') else bool(text)
                if not has_content:
                    logger.warning(f"user_text message with empty content (type={content_type}), ignoring")
                    return

                logger.info(f"[USER_TEXT] Received: content_type={content_type}, title={title}")

                async def handle_user_text():
                    try:
                        await emit_agent_state("listening")

                        if content_type == 'read_only' and content_text:
                            logger.info(f"[RFID-RAG] Generating ElevenLabs audio for: {title}")
                            try:
                                elevenlabs_svc = get_elevenlabs_service()
                                audio_data, error = await elevenlabs_svc.generate_rhyme_speech(content_text, title)
                                if audio_data and not error:
                                    await emit_agent_state("speaking")
                                    await play_elevenlabs_audio(session, audio_data, title)
                                    await emit_agent_state("listening")
                                else:
                                    logger.warning(f"[RFID-RAG] ElevenLabs failed: {error}, falling back to Gemini")
                                    await session.generate_reply(instructions=f"Read this aloud like a space captain telling a tale: {content_text}")
                            except Exception as tts_error:
                                logger.error(f"[RFID-RAG] ElevenLabs error: {tts_error}, falling back to Gemini")
                                await session.generate_reply(instructions=f"Read this aloud like a space captain telling a tale: {content_text}")
                        else:
                            logger.info(f"[RFID-PROMPT] Sending to Gemini: {text[:100]}...")
                            await session.generate_reply(instructions=text)
                    except Exception as e:
                        logger.error(f"Error handling user_text: {e}")

                asyncio.create_task(handle_user_text())

        except Exception as e:
            logger.error(f"Error handling data channel message: {e}")

    ctx.add_shutdown_callback(cleanup_room_and_session)

    await ctx.connect(auto_subscribe=AutoSubscribe.AUDIO_ONLY)

    # Duplicate agent check
    my_identity = ctx.room.local_participant.identity if ctx.room.local_participant else None
    existing_agents = [
        p for p in ctx.room.remote_participants.values()
        if p.identity and 'agent' in p.identity.lower() and p.identity != my_identity
    ]
    if existing_agents:
        logger.warning(f"[DUPLICATE-AGENT] Another agent already in room: {[a.identity for a in existing_agents]}")
        try:
            await ctx.room.disconnect()
        except Exception:
            pass
        return

    participant = await ctx.wait_for_participant()
    logger.info(f"Participant joined: {participant.identity}")

    assistant.set_agent_session(session)
    assistant.set_session_context(ctx)

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
    logger.info(f"{CHARACTER_NAME} agent is LIVE!")


if __name__ == "__main__":
    port = int(os.getenv("CHEEKO_ASTRONAUT_PORT", DEFAULT_PORT))
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
