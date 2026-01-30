"""
Word Ladder Agent Worker
Game agent for word ladder with move validation

agent_name: word-ladder-agent
Port: 8086
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
from livekit.plugins import google

from src.config.config_loader import ConfigLoader
from src.utils.database_helper import DatabaseHelper
from src.services.prompt_service import PromptService
from src.utils.loki_agent_logger import logger
from src.shared.base_assistant import BaseAssistant
from src.shared.entrypoint_utils import (
    parse_room_name,
    delete_livekit_room,
    create_state_handlers,
    load_game_prompt,
    init_chat_history_service,
    extract_and_send_chat_history,
)
from src.features.game_tools import validate_word_ladder_move, set_word_ladder_state, set_game_analytics_manager
from src.games.word_ladder_game import pick_valid_word_pair
from src.features.mode_switching import update_agent_mode
from src.utils.helpers import UsageManager, GameAnalyticsManager

AGENT_NAME = "word-ladder-agent"
CHARACTER_NAME = "Word Ladder"
DEFAULT_PORT = 8086
GAME_TOOLS = [validate_word_ladder_move, update_agent_mode]


class WordLadderAssistant(BaseAssistant):
    """Word Ladder Assistant"""

    # Default greeting - will be overridden with word pair in __init__
    GREETING_INSTRUCTION = "Greet the user as the Word Pilot and announce the starting word and required letter."

    def __init__(self, instructions: str = None, start_word: str = "road", target_word: str = "root") -> None:
        super().__init__(instructions=instructions)
        self.start_word = start_word
        self.target_word = target_word
        # Dynamic greeting that includes the actual word pair
        self.GREETING_INSTRUCTION = f"""Greet the user as the Word Pilot. Then IMMEDIATELY announce the starting word and required letter.
You MUST clearly say: "Our starting word is '{start_word.upper()}'! It ends with the letter '{start_word[-1].upper()}'. So give me a word that STARTS with '{start_word[-1].upper()}'!"
Do NOT wait for them to say "yes" or "ready" - announce the starting word right after greeting.
After announcing, STOP and wait silently for their word."""
        logger.info(f"WordLadderAssistant initialized with words: {start_word} -> {target_word}")


def prewarm(proc: JobProcess):
    """Prewarm for Gemini Realtime - cache configs and db_helper"""
    # Cache config once at worker startup (avoids re-parsing YAML per job)
    yaml_config = ConfigLoader.load_yaml_config()
    realtime_config = ConfigLoader.get_gemini_realtime_config()
    proc.userdata["yaml_config"] = yaml_config
    proc.userdata["realtime_config"] = realtime_config

    # Cache DatabaseHelper instance (avoids creating new instance per job)
    manager_api_url = os.getenv("MANAGER_API_URL")
    manager_api_secret = os.getenv("MANAGER_API_SECRET")
    if manager_api_url and manager_api_secret:
        proc.userdata["db_helper"] = DatabaseHelper(manager_api_url, manager_api_secret)

    logger.info("[PREWARM] Ready for Gemini Realtime")
    proc.userdata["ready"] = True


async def entrypoint(ctx: JobContext):
    """Entrypoint for Word Ladder agent worker"""

    # Use cached config from prewarm (or fallback to loading)
    yaml_config = ctx.proc.userdata.get("yaml_config") or ConfigLoader.load_yaml_config()
    api_keys = yaml_config.get('api_keys', {})
    if 'google' in api_keys and not os.getenv('GOOGLE_API_KEY'):
        os.environ['GOOGLE_API_KEY'] = api_keys['google']

    ctx.log_context_fields = {"room": ctx.room.name}
    logger.info(f"Starting {CHARACTER_NAME} agent in room: {ctx.room.name}")

    init_start_time = asyncio.get_event_loop().time()

    # Use cached realtime config from prewarm
    realtime_config = ctx.proc.userdata.get("realtime_config") or ConfigLoader.get_gemini_realtime_config()
    gemini_model = realtime_config.get('model', 'gemini-2.5-flash-native-audio-preview-12-2025')
    gemini_voice = realtime_config.get('voice', 'Zephyr')
    # Lower temperature for more consistent game behavior (was 0.8)
    gemini_temperature = realtime_config.get('temperature', 0.6)

    room_name = ctx.room.name
    device_mac, room_type = parse_room_name(room_name)

    prompt_service = PromptService()
    agent_prompt = ConfigLoader.get_default_prompt()
    child_profile = None
    agent_id = None

    # Generate word pair EARLY so we can include it in the prompt
    start_word, target_word = pick_valid_word_pair()
    logger.info(f"🎮 Pre-generated word pair: {start_word} → {target_word}")

    # Check if child profile and memories are in dispatch metadata (passed from MQTT gateway)
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
            # Use cached DatabaseHelper from prewarm (or create new if not available)
            db_helper = ctx.proc.userdata.get("db_helper")
            if not db_helper:
                manager_api_url = os.getenv("MANAGER_API_URL")
                manager_api_secret = os.getenv("MANAGER_API_SECRET")
                db_helper = DatabaseHelper(manager_api_url, manager_api_secret)

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

            # Load game-specific prompt WITH word pair and memories
            game_prompt = load_game_prompt(
                CHARACTER_NAME,
                child_profile,
                extra_vars={'start_word': start_word, 'target_word': target_word},
                long_term_memories=dispatch_memories,
                memory_relations=dispatch_relations,
                memory_entities=dispatch_entities
            )
            if game_prompt:
                agent_prompt = game_prompt
                logger.info(f"✅ Loaded {CHARACTER_NAME} prompt with words: {start_word} → {target_word}")

        except Exception as e:
            logger.error(f"Error in API calls: {e}")

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

    # ============================================================================
    # USAGE TRACKING: Capture prompt_tokens, completion_tokens, TTFT per response
    # ============================================================================
    usage_manager = UsageManager(mac_address=device_mac, session_id=room_name)
    usage_manager.setup_metrics_collection(session)
    logger.info("Usage tracking initialized - subscribed to metrics_collected event")

    # ============================================================================
    # GAME ANALYTICS: Track game attempts locally, send on session close
    # ============================================================================
    game_analytics_manager = GameAnalyticsManager(
        mac_address=device_mac,
        session_id=room_name,
        mode_type='word_ladder',
        agent_id=agent_id
    )
    set_game_analytics_manager(game_analytics_manager)
    logger.info("Game analytics tracking initialized")

    emit_agent_state, emit_speech_created = create_state_handlers(ctx, session)
    logger.info("State management registered")

    # ============================================================================
    # DEBUG: Track user speech and function calls
    # ============================================================================



    @session.on("function_calls_started")
    def on_function_calls_started(ev):
        """Log when function calls are initiated - also reset idle state"""
        nonlocal waiting_for_user_response
        logger.info(f"🔧 FUNCTION CALL STARTED: {ev}")
        # User spoke and triggered a tool - reset idle state
        if waiting_for_user_response:
            logger.info("⏰ Function call detected - resetting idle state")
            waiting_for_user_response = False
            reset_reminder_count()
            cancel_idle_timer()

    @session.on("function_calls_finished")
    def on_function_calls_finished(ev):
        """Log when function calls complete"""
        nonlocal waiting_for_user_response
        logger.info(f"✅ FUNCTION CALL FINISHED: {ev}")
        # Redundant reset to ensure we don't get stuck
        if waiting_for_user_response:
             logger.info("⏰ Function finished - forcing idle state reset")
             waiting_for_user_response = False
             reset_reminder_count()
             cancel_idle_timer()

    logger.info("📊 Debug logging for speech and function calls enabled")

    # ============================================================================
    # IDLE REMINDER: Prompt user if no response for a while
    # ============================================================================
    IDLE_TIMEOUT_SECONDS = 15  # Time to wait before reminding
    idle_reminder_task = None
    reminder_count = 0
    MAX_REMINDERS = 3  # Max reminders before giving up
    waiting_for_user_response = False  # Flag to prevent timer restart after reminder

    REMINDER_MESSAGES = [
        "Take your time! I'm here whenever you're ready with your word.",
        "No rush! Would you like me to repeat the current letter?",
        "Still thinking? That's okay! Word games take time. Let me know when you're ready.",
    ]

    async def send_idle_reminder():
        """Send a gentle reminder if user hasn't responded"""
        nonlocal reminder_count, waiting_for_user_response
        try:
            await asyncio.sleep(IDLE_TIMEOUT_SECONDS)

            if reminder_count < MAX_REMINDERS:
                waiting_for_user_response = True  # Set flag BEFORE sending reminder
                reminder_msg = REMINDER_MESSAGES[reminder_count % len(REMINDER_MESSAGES)]
                logger.info(f"⏰ Sending idle reminder #{reminder_count + 1}: {reminder_msg[:50]}...")
                await session.generate_reply(instructions=reminder_msg)
                reminder_count += 1
            else:
                logger.info("⏰ Max reminders reached, stopping idle prompts")
                waiting_for_user_response = True  # Also stop after max reminders
        except asyncio.CancelledError:
            logger.debug("⏰ Idle reminder cancelled (user responded)")
        except Exception as e:
            logger.warning(f"⏰ Idle reminder error: {e}")

    def start_idle_timer():
        """Start the idle reminder timer"""
        nonlocal idle_reminder_task
        cancel_idle_timer()
        idle_reminder_task = asyncio.create_task(send_idle_reminder())
        logger.debug("⏰ Idle timer started")

    def cancel_idle_timer():
        """Cancel the idle reminder timer"""
        nonlocal idle_reminder_task
        if idle_reminder_task and not idle_reminder_task.done():
            idle_reminder_task.cancel()
            logger.debug("⏰ Idle timer cancelled")
        idle_reminder_task = None

    def reset_reminder_count():
        """Reset reminder count when user responds"""
        nonlocal reminder_count
        reminder_count = 0

    @session.on("agent_state_changed")
    def on_state_for_idle_timer(ev):
        """Manage idle timer based on agent state"""
        nonlocal waiting_for_user_response
        new_state = getattr(ev, 'new_state', None)
        new_state_str = new_state.name.lower() if hasattr(new_state, 'name') else str(new_state)

        if new_state_str == 'thinking':
            # Agent only goes to 'thinking' when processing USER input
            # (Direct generation calls like reminders go straight to 'speaking')
            if waiting_for_user_response:
                logger.info("⏰ Agent thinking (user input detected) - resetting idle state")
                waiting_for_user_response = False
                reset_reminder_count()

        if new_state_str == 'listening':
            # Only start timer if not waiting for user response after a reminder
            logger.info(f"⏰ Agent listening, waiting_for_user={waiting_for_user_response}")
            if not waiting_for_user_response:
                logger.info("⏰ Starting idle timer (agent now listening)")
                start_idle_timer()
            else:
                logger.info("⏰ Skipping idle timer - waiting for user response")
        else:
            # Agent is speaking/thinking, cancel idle timer
            cancel_idle_timer()

    @session.on("user_speech_committed")
    def on_user_speech(msg):
        """Reset idle timer and log user speech"""
        nonlocal waiting_for_user_response
        
        # Log what the user said
        text = getattr(msg, 'text', str(msg)) if hasattr(msg, 'text') else str(msg)
        logger.info(f"🎤 USER SAID: '{text}'")
        
        logger.info(f"⏰ User speech detected - resetting idle state (was waiting={waiting_for_user_response})")
        cancel_idle_timer()
        reset_reminder_count()
        waiting_for_user_response = False  # Reset flag - timer will start when agent goes to listening

    @session.on("agent_speech_committed")
    def on_agent_speech(msg):
        """Ensure idle timer is reset when agent finishes speaking"""
        nonlocal waiting_for_user_response
        pass  # We don't necessarily reset here because we might want to wait for 'listening' state
        # But if agent just spoke, we are definitely interacting.
        # Actually, let's rely on 'on_state_changed' -> 'listening' to start the timer.
        # But we should ensure 'waiting_for_user_response' is False if the AGENT spoke (meaning it responded).
        
        if waiting_for_user_response:
             logger.info("⏰ Agent spoke - forcing idle state reset")
             waiting_for_user_response = False
             reset_reminder_count()

    logger.info(f"⏰ Idle reminder enabled ({IDLE_TIMEOUT_SECONDS}s timeout, max {MAX_REMINDERS} reminders)")

    try:
        from src.agent.error_handler import setup_error_handling
        setup_error_handling(session=session, max_retries=3, custom_audio_path=None)
    except Exception as e:
        logger.warning(f"Error handler not available: {e}")

    # Pass word pair to assistant for dynamic greeting
    assistant = WordLadderAssistant(instructions=agent_prompt, start_word=start_word, target_word=target_word)
    assistant.set_room_info(room_name=ctx.room.name, device_mac=device_mac)

    from src.services.unified_audio_player import UnifiedAudioPlayer
    audio_player = UnifiedAudioPlayer()
    audio_player.set_context(ctx)
    assistant.audio_player = audio_player
    logger.info("UnifiedAudioPlayer initialized")

    assistant.enable_battery_tools()
    assistant.enable_volume_tools()

    # Enable word ladder game but reset with our pre-generated words
    assistant.enable_word_ladder_game()
    assistant.enable_mode_switching()
    # Override with the pre-generated word pair (same as in prompt)
    assistant.word_ladder_state.reset(start_word, target_word)
    logger.info(f"🎮 Word Ladder state synced with prompt: {start_word} → {target_word}")

    set_word_ladder_state(assistant.word_ladder_state)
    logger.info("Word Ladder features enabled (with mode switching)")

    participant_count = len(ctx.room.remote_participants)
    cleanup_completed = False
    cleanup_task = None

    # Initialize chat history service
    chat_history_service = None
    if agent_id and device_mac:
        chat_history_service = init_chat_history_service(device_mac, room_name, agent_id)
    else:
        logger.warning(f"❌ Chat history service skipped: agent_id={agent_id}, device_mac={device_mac}")

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
            cancel_idle_timer()  # Stop any pending idle reminders

            # Log usage summary FIRST (before chat history which takes longer)
            try:
                if usage_manager:
                    await asyncio.wait_for(
                        asyncio.shield(usage_manager.log_session_summary()),
                        timeout=5.0
                    )
            except asyncio.TimeoutError:
                logger.warning("Usage logging timed out after 5s")
            except asyncio.CancelledError:
                logger.warning("Usage logging was cancelled but should complete")
            except Exception as e:
                logger.warning(f"Failed to log usage summary: {e}")

            # Send game analytics (batch send all attempts)
            try:
                if game_analytics_manager:
                    await asyncio.wait_for(
                        asyncio.shield(game_analytics_manager.send_analytics('completed')),
                        timeout=10.0
                    )
            except asyncio.TimeoutError:
                logger.warning("Game analytics timed out after 10s")
            except asyncio.CancelledError:
                logger.warning("Game analytics was cancelled but should complete")
            except Exception as e:
                logger.warning(f"Failed to send game analytics: {e}")

            # Extract and send chat history (takes 2-3 seconds due to Mem0)
            try:
                await asyncio.wait_for(
                    asyncio.shield(extract_and_send_chat_history(session, chat_history_service, device_mac)),
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
        """Handle end prompt - say goodbye message before cleanup using Gemini Realtime"""
        try:
            logger.info(f"👋 [END-PROMPT] Saying goodbye: {prompt_text[:50]}...")
            try:
                await asyncio.wait_for(
                    session.generate_reply(instructions=prompt_text),
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
        try:
            message = json.loads(data_packet.data.decode('utf-8'))
            msg_type = message.get('type')

            # Handle greeting trigger from device
            if msg_type == 'ready_for_greeting':
                logger.info("🎤 Device ready for greeting - triggering greeting now")
                asyncio.create_task(assistant.play_greeting())
                return

            # Handle end prompt - say goodbye message
            if msg_type == 'end_prompt':
                prompt_text = message.get('prompt', "Time flies so fast! It was wonderful playing with you. Goodbye!")
                logger.info(f"👋 [END-PROMPT] Received end_prompt from gateway")
                asyncio.create_task(handle_end_prompt(prompt_text))
                return

            # Handle shutdown request from gateway
            if msg_type == 'shutdown_request':
                logger.info("Received shutdown_request from gateway, initiating cleanup...")
                if message.get('require_ack'):
                    asyncio.create_task(send_shutdown_ack(message.get('session_id', '')))
                asyncio.create_task(cleanup_room_and_session())
                return

            # Handle playback control
            if msg_type == 'playback_control':
                action = message.get('action')
                if action == 'next':
                    asyncio.create_task(handle_skip())
        except Exception as e:
            logger.error(f"Error handling data: {e}")

    async def handle_skip():
        try:
            if assistant.audio_player:
                await assistant.audio_player.stop()
        except Exception as e:
            logger.error(f"Error in skip: {e}")

    ctx.add_shutdown_callback(cleanup_room_and_session)

    await ctx.connect(auto_subscribe=AutoSubscribe.AUDIO_ONLY)

    # DUPLICATE AGENT CHECK: Prevent multiple agents in same room
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
    audio_player.set_session(session)

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
    logger.info(f"{CHARACTER_NAME} agent is LIVE!")


if __name__ == "__main__":
    # Use worker-specific port (ignore global PORT env var from Cerebrium)
    port = int(os.getenv("WORD_LADDER_PORT", DEFAULT_PORT))
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
