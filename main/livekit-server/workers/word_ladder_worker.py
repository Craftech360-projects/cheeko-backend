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
from src.memory import MEMORY_TOOLS
from src.utils.quota_manager import QuotaManager

AGENT_NAME = "word-ladder-agent"
CHARACTER_NAME = "Word Ladder"
DEFAULT_PORT = 8086
GAME_TOOLS = [validate_word_ladder_move, update_agent_mode] + MEMORY_TOOLS


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
    """Prewarm - cache configs and db_helper"""
    # Cache config once at worker startup (avoids re-parsing YAML per job)
    yaml_config = ConfigLoader.load_yaml_config()
    proc.userdata["yaml_config"] = yaml_config

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
                logger.info(f"🧠 [MEMORY] Received {len(dispatch_memories)} memories, {len(dispatch_relations)} relations, {len(dispatch_entities)} entities")
    except Exception as e:
        logger.debug(f"No dispatch metadata or error parsing: {e}")

    # Initialize QuotaManager
    manager_api_url = os.getenv("MANAGER_API_URL", "")
    manager_api_secret = os.getenv("MANAGER_API_SECRET", "")
    quota_manager = QuotaManager(
        mac_address=device_mac or "",
        manager_api_url=manager_api_url,
        secret=manager_api_secret
    )

    if device_mac:
        try:
            # Use cached DatabaseHelper from prewarm (or create new if not available)
            db_helper = ctx.proc.userdata.get("db_helper")
            if not db_helper:
                db_helper = DatabaseHelper(manager_api_url, manager_api_secret)

            # Skip child profile fetch if already have from dispatch metadata
            if dispatch_child_profile:
                logger.info("👶 Skipping child profile API call - using dispatch metadata")
                results = await asyncio.gather(
                    db_helper.get_agent_id(device_mac),
                    quota_manager.initialize(),
                    return_exceptions=True
                )
                agent_id_result = results[0]
                child_profile_result = dispatch_child_profile
            else:
                results = await asyncio.gather(
                    db_helper.get_agent_id(device_mac),
                    db_helper.get_child_profile_by_mac(device_mac),
                    quota_manager.initialize(),
                    return_exceptions=True
                )
                agent_id_result, child_profile_result = results[0], results[1]

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

    # Start protected game session (must be after quota_manager.initialize())
    game_session_allowed = True
    if not quota_manager.is_unbound:
        game_session_allowed, game_session_reason = await quota_manager.start_game_session(
            agent_type="word_ladder", session_id=room_name
        )
        logger.info(f"[QUOTA] Game session check: allowed={game_session_allowed}, reason={game_session_reason}")

    logger.info(f"Final prompt length: {len(agent_prompt)} chars")

    # Create Gemini Realtime model
    from src.utils.realtime_factory import create_realtime_model
    realtime_model, audio_sample_rate, _ = create_realtime_model(instructions=agent_prompt)

    session = AgentSession(llm=realtime_model, tools=GAME_TOOLS, userdata={"device_mac": device_mac or ""})
    logger.info(f"AgentSession created with {len(GAME_TOOLS)} game + memory tools")

    # ============================================================================
    # USAGE TRACKING: Capture prompt_tokens, completion_tokens, TTFT per response
    # ============================================================================
    usage_manager = UsageManager(mac_address=device_mac, session_id=room_name)
    usage_manager.setup_metrics_collection(session)
    logger.info("Usage tracking initialized - subscribed to metrics_collected event")

    # Start background time tracker for time-based quota plans
    quota_manager.start_time_tracker()

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

    @session.on("user_input_transcribed")
    def on_user_speech(ev):
        """Log what the user said (transcription)"""
        if not ev.is_final:
            return
        logger.info(f"🎤 USER SAID: '{ev.transcript}'")

    # ============================================================================
    # QUOTA: Track per-turn usage and enforce limits
    # ============================================================================
    @session.on("user_input_transcribed")
    def on_user_speech_quota(ev):
        """Consume a question from quota on each final user speech turn"""
        if not ev.is_final:
            return
        async def _check_quota():
            try:
                allowed, remaining = await quota_manager.consume_question()
                if not allowed:
                    logger.warning(f"[QUOTA] Exhausted mid-session for {device_mac}")
                    await session.generate_reply(
                        instructions="Say exactly: '" + quota_manager.get_limit_message() + "'"
                    )
                    await asyncio.sleep(6)
                    await delete_livekit_room(room_name)
                elif quota_manager.should_warn_low_quota():
                    logger.info(f"[QUOTA] Low quota warning: {remaining} remaining")
                    await session.generate_reply(
                        instructions=quota_manager.get_low_quota_instruction()
                    )
            except Exception as e:
                logger.error(f"[QUOTA] Error in quota check: {e}")
        asyncio.create_task(_check_quota())

    logger.info("📊 Debug logging for speech and function calls enabled")

    # ============================================================================
    # WATCHDOG: Detect when Gemini silently fails to respond
    # ============================================================================
    WATCHDOG_TIMEOUT_SECONDS = 8
    MAX_WATCHDOG_RECOVERIES = 2
    _watchdog_task = None
    _watchdog_waiting = False
    _watchdog_recovery_attempts = 0

    def _cancel_watchdog():
        nonlocal _watchdog_task, _watchdog_waiting
        if _watchdog_task and not _watchdog_task.done():
            _watchdog_task.cancel()
            logger.debug("[WATCHDOG] Timer cancelled")
        _watchdog_task = None
        _watchdog_waiting = False

    async def attempt_watchdog_recovery():
        """Try to recover from a silent Gemini failure"""
        nonlocal _watchdog_recovery_attempts
        _watchdog_recovery_attempts += 1
        logger.warning(f"[WATCHDOG] Recovery attempt {_watchdog_recovery_attempts}/{MAX_WATCHDOG_RECOVERIES}")

        try:
            await asyncio.wait_for(
                session.generate_reply(
                    instructions="The user spoke to you but you didn't respond. Please respond now."
                ),
                timeout=6.0
            )
            logger.info("[WATCHDOG] Recovery successful via generate_reply")
            return
        except asyncio.TimeoutError:
            logger.warning("[WATCHDOG] generate_reply timed out during recovery")
        except Exception as e:
            logger.warning(f"[WATCHDOG] generate_reply failed during recovery: {e}")

        try:
            await session.say("I'm sorry, could you say that again?")
            logger.info("[WATCHDOG] Recovery successful via session.say fallback")
        except Exception as e:
            logger.error(f"[WATCHDOG] session.say fallback also failed: {e}")

    async def _watchdog_timer():
        """Wait for timeout, then attempt recovery if agent hasn't responded"""
        nonlocal _watchdog_waiting
        try:
            await asyncio.sleep(WATCHDOG_TIMEOUT_SECONDS)
            if _watchdog_waiting:
                logger.warning(f"[WATCHDOG] Agent did not respond within {WATCHDOG_TIMEOUT_SECONDS}s!")
                if _watchdog_recovery_attempts < MAX_WATCHDOG_RECOVERIES:
                    await attempt_watchdog_recovery()
                else:
                    logger.warning("[WATCHDOG] Max recovery attempts reached, skipping")
        except asyncio.CancelledError:
            logger.debug("[WATCHDOG] Timer cancelled (normal)")
        except Exception as e:
            logger.error(f"[WATCHDOG] Error in watchdog timer: {e}")

    @session.on("user_input_transcribed")
    def on_user_speech_watchdog(ev):
        """Start watchdog timer when user finishes speaking"""
        if not ev.is_final:
            return
        nonlocal _watchdog_task, _watchdog_waiting, _watchdog_recovery_attempts
        _cancel_watchdog()
        _watchdog_waiting = True
        _watchdog_recovery_attempts = 0
        _watchdog_task = asyncio.create_task(_watchdog_timer())
        logger.debug("[WATCHDOG] Timer started (user spoke)")

    @session.on("agent_state_changed")
    def on_state_for_watchdog(ev):
        """Cancel watchdog when agent starts speaking"""
        nonlocal _watchdog_recovery_attempts
        new_state = getattr(ev, 'new_state', None)
        new_state_str = new_state.name.lower() if hasattr(new_state, 'name') else str(new_state)
        if new_state_str == 'speaking':
            _cancel_watchdog()
            _watchdog_recovery_attempts = 0
            logger.debug("[WATCHDOG] Timer cancelled (agent speaking)")

    @session.on("function_tools_executed")
    def on_function_tools_watchdog(ev):
        """Cancel watchdog when tools execute (not a silent failure)"""
        _cancel_watchdog()
        logger.debug("[WATCHDOG] Timer cancelled (function tools executed)")

    logger.info(f"[WATCHDOG] Enabled ({WATCHDOG_TIMEOUT_SECONDS}s timeout, max {MAX_WATCHDOG_RECOVERIES} recoveries)")

    # ============================================================================
    # IDLE REMINDER: Prompt user if no response for a while
    # ============================================================================
    IDLE_TIMEOUT_SECONDS = 15
    idle_reminder_task = None
    reminder_count = 0
    MAX_REMINDERS = 3
    waiting_for_user_response = False
    _delivering_reminder = False

    REMINDER_MESSAGES = [
        "Say ONLY this to the child and then STOP completely. Do NOT call any tools, do NOT answer questions, do NOT continue the conversation: 'Take your time! I'm here whenever you're ready with your word.'",
        "Say ONLY this to the child and then STOP completely. Do NOT call any tools, do NOT answer questions, do NOT continue the conversation: 'No rush! Would you like me to repeat the current letter?'",
        "Say ONLY this to the child and then STOP completely. Do NOT call any tools, do NOT answer questions, do NOT continue the conversation: 'Still thinking? That is okay! Word games take time. Let me know when you are ready.'",
    ]

    async def send_idle_reminder():
        """Sleep phase only - cancellable by cancel_idle_timer()"""
        try:
            await asyncio.sleep(IDLE_TIMEOUT_SECONDS)
        except asyncio.CancelledError:
            return

        asyncio.create_task(_deliver_idle_reminder())

    async def _deliver_idle_reminder():
        """Deliver the reminder - runs as separate task, not cancellable by idle timer"""
        nonlocal reminder_count, waiting_for_user_response, _delivering_reminder

        if reminder_count >= MAX_REMINDERS:
            logger.info("[IDLE] Max reminders reached, stopping idle prompts")
            waiting_for_user_response = True
            return

        _delivering_reminder = True
        waiting_for_user_response = True
        reminder_msg = REMINDER_MESSAGES[reminder_count % len(REMINDER_MESSAGES)]
        logger.info(f"[IDLE] Sending reminder #{reminder_count + 1}: {reminder_msg[:50]}...")

        try:
            await session.generate_reply(instructions=reminder_msg)
        except Exception as e:
            logger.warning(f"[IDLE] Reminder delivery error: {e}")

        _delivering_reminder = False
        reminder_count += 1
        waiting_for_user_response = False
        logger.info(f"[IDLE] Reminder delivered, scheduling next check (count={reminder_count}/{MAX_REMINDERS})")
        start_idle_timer()

    def start_idle_timer():
        nonlocal idle_reminder_task
        cancel_idle_timer()
        idle_reminder_task = asyncio.create_task(send_idle_reminder())
        logger.debug("[IDLE] Timer started")

    def cancel_idle_timer():
        nonlocal idle_reminder_task
        if idle_reminder_task and not idle_reminder_task.done():
            idle_reminder_task.cancel()
            logger.debug("[IDLE] Timer cancelled")
        idle_reminder_task = None

    def reset_reminder_count():
        nonlocal reminder_count
        reminder_count = 0

    @session.on("agent_state_changed")
    def on_state_for_idle_timer(ev):
        """Manage idle timer based on agent state"""
        nonlocal waiting_for_user_response
        new_state = getattr(ev, 'new_state', None)
        old_state = getattr(ev, 'old_state', None)
        new_state_str = new_state.name.lower() if hasattr(new_state, 'name') else str(new_state)
        old_state_str = old_state.name.lower() if hasattr(old_state, 'name') else str(old_state) if old_state else ''

        if new_state_str == 'speaking' and old_state_str == 'listening' and not _delivering_reminder:
            if waiting_for_user_response or reminder_count > 0:
                logger.info("[IDLE] User interaction detected (listening->speaking, not reminder) - resetting idle state")
                waiting_for_user_response = False
                reset_reminder_count()

        if new_state_str == 'thinking':
            # Thinking state = agent processing user input, always reset idle state
            if waiting_for_user_response or reminder_count > 0:
                logger.info("[IDLE] Agent thinking (user input detected) - resetting idle state")
                waiting_for_user_response = False
                reset_reminder_count()

        if new_state_str == 'listening':
            if not waiting_for_user_response:
                start_idle_timer()
            else:
                logger.debug("[IDLE] Skipping timer - waiting for user response")
        else:
            cancel_idle_timer()

    @session.on("user_input_transcribed")
    def on_user_speech_idle(ev):
        """Reset idle timer when user finishes speaking"""
        if not ev.is_final:
            return
        nonlocal waiting_for_user_response
        cancel_idle_timer()
        reset_reminder_count()
        waiting_for_user_response = False

    @session.on("function_tools_executed")
    def on_function_tools_idle(ev):
        """Reset idle state when tools execute (definitive proof of user interaction)"""
        nonlocal waiting_for_user_response
        logger.info(f"🔧 FUNCTION TOOLS EXECUTED: {len(ev.function_calls)} call(s)")
        waiting_for_user_response = False
        reset_reminder_count()
        cancel_idle_timer()

    logger.info(f"[IDLE] Enabled ({IDLE_TIMEOUT_SECONDS}s timeout, max {MAX_REMINDERS} reminders)")

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
            _cancel_watchdog()
            cancel_idle_timer()  # Stop any pending idle reminders

            # Stop time tracker and report final seconds
            try:
                await asyncio.wait_for(quota_manager.stop_time_tracker(), timeout=5.0)
            except asyncio.TimeoutError:
                logger.warning("Time tracker stop timed out after 5s")
            except Exception as e:
                logger.warning(f"Failed to stop time tracker: {e}")

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

            # End protected game session
            try:
                if quota_manager.in_game_session:
                    game_status = "completed" if len(assistant.word_ladder_state.word_history) >= 10 else "abandoned"
                    await asyncio.wait_for(
                        asyncio.shield(quota_manager.end_game_session(game_status)),
                        timeout=5.0
                    )
            except (asyncio.TimeoutError, asyncio.CancelledError, Exception) as e:
                logger.warning(f"Game session end issue: {e}")

            # Extract and send chat history
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

    # ============================================================================
    # TRACK MONITORING: Log audio track lifecycle for observability
    # ============================================================================
    @ctx.room.on("track_published")
    def on_track_published(publication, participant):
        logger.info(f"[TRACK] Published: kind={publication.kind}, source={publication.source}, participant={participant.identity}")

    @ctx.room.on("track_unpublished")
    def on_track_unpublished(publication, participant):
        logger.warning(f"[TRACK] Unpublished: kind={publication.kind}, source={publication.source}, participant={participant.identity}")

    @ctx.room.on("track_subscribed")
    def on_track_subscribed(track, publication, participant):
        logger.info(f"[TRACK] Subscribed: kind={track.kind}, sid={track.sid}, participant={participant.identity}")

    @ctx.room.on("track_unsubscribed")
    def on_track_unsubscribed(track, publication, participant):
        logger.warning(f"[TRACK] Unsubscribed: kind={track.kind}, sid={track.sid}, participant={participant.identity}")

    logger.info("[TRACK] Audio track monitoring enabled")

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

    # ============================================================================
    # QUOTA GATE: Block session if game session was denied (quota exhausted or active session)
    # ============================================================================
    if not game_session_allowed:
        logger.warning(f"[QUOTA] Game session denied for {device_mac} - blocking session")
        await ctx.connect(auto_subscribe=AutoSubscribe.AUDIO_ONLY)
        participant = await ctx.wait_for_participant()
        temp_session = AgentSession(llm=realtime_model, tools=[], userdata={"device_mac": device_mac or ""})
        await temp_session.start(room=ctx.room, agent=assistant)
        try:
            denied_msg = quota_manager.get_game_session_denied_message()
            await temp_session.generate_reply(instructions=f"Say exactly this to the child: '{denied_msg}'")
            await asyncio.sleep(6)
        except Exception as e:
            logger.error(f"[QUOTA] Error saying limit message: {e}")
        await delete_livekit_room(room_name)
        return

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

    # Start session with appropriate input audio sample rate
    await session.start(
        room=ctx.room,
        agent=assistant,
        room_input_options=RoomInputOptions(
            audio_sample_rate=audio_sample_rate,
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
