"""
Math Commander Agent Worker
Visual math game with tap-to-answer, progressive hints, and age-based modes

agent_name: math-commander-agent
Port: 8085
"""

import os
import sys
import json
import asyncio
import time
import random
import platform

# Fix for Windows socket buffer exhaustion - MUST be at module level before any async code
if platform.system() == "Windows":
    # Use SelectorEventLoop instead of ProactorEventLoop to avoid socket buffer issues
    asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())

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
    render_prompt_with_profile,
    delete_livekit_room,
    create_state_handlers,
    load_game_prompt,
    init_chat_history_service,
    extract_and_send_chat_history,
)
from src.features.game_tools import (
    check_math_answer,
    register_math_question,
    set_math_game_state,
    set_game_analytics_manager,
    set_publish_callback,
)
from src.utils.helpers import UsageManager, GameAnalyticsManager

AGENT_NAME = "math-tutor-agent"
CHARACTER_NAME = "Math Commander"
DEFAULT_PORT = 8087
GAME_TOOLS = [register_math_question, check_math_answer]


class MathCommanderAssistant(BaseAssistant):
    """Math Commander Assistant — visual math game with tap and voice input"""

    GREETING_INSTRUCTION = """Namaste beta! I'm your Maths Commander! We have a MATHS EMERGENCY! Look at the screen — your first mission is ready! Can you solve it? Tell me the answer, quick!"""

    def __init__(self, instructions: str = None) -> None:
        super().__init__(instructions=instructions)
        logger.info("MathCommanderAssistant initialized")


def prewarm(proc: JobProcess):
    """Prewarm for Gemini Realtime - cache configs and db_helper"""
    yaml_config = ConfigLoader.load_yaml_config()
    realtime_config = ConfigLoader.get_gemini_realtime_config()
    proc.userdata["yaml_config"] = yaml_config
    proc.userdata["realtime_config"] = realtime_config

    manager_api_url = os.getenv("MANAGER_API_URL")
    manager_api_secret = os.getenv("MANAGER_API_SECRET")
    if manager_api_url and manager_api_secret:
        proc.userdata["db_helper"] = DatabaseHelper(manager_api_url, manager_api_secret)

    logger.info("[PREWARM] Ready for Gemini Realtime")
    proc.userdata["ready"] = True


async def entrypoint(ctx: JobContext):
    """Entrypoint for Math Commander agent worker"""

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
    gemini_temperature = realtime_config.get('temperature', 0.6)

    room_name = ctx.room.name
    device_mac, room_type = parse_room_name(room_name)

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
                logger.info(f"Using child profile from dispatch: {dispatch_child_profile.get('name')}, age: {dispatch_child_profile.get('age')}")
            if dispatch_memories:
                logger.info(f"[MEM0] Received {len(dispatch_memories)} memories, {len(dispatch_relations)} relations, {len(dispatch_entities)} entities")
    except Exception as e:
        logger.debug(f"No dispatch metadata or error parsing: {e}")

    if device_mac:
        try:
            db_helper = ctx.proc.userdata.get("db_helper")
            if not db_helper:
                manager_api_url = os.getenv("MANAGER_API_URL")
                manager_api_secret = os.getenv("MANAGER_API_SECRET")
                db_helper = DatabaseHelper(manager_api_url, manager_api_secret)

            if dispatch_child_profile:
                logger.info("Skipping child profile API call - using dispatch metadata")
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
            game_prompt = load_game_prompt(
                CHARACTER_NAME,
                child_profile,
                long_term_memories=dispatch_memories,
                memory_relations=dispatch_relations,
                memory_entities=dispatch_entities
            )
            if game_prompt:
                agent_prompt = game_prompt
                logger.info(f"Loaded {CHARACTER_NAME} prompt ({len(agent_prompt)} chars)")

        except Exception as e:
            logger.error(f"Error in API calls: {e}")

    if child_profile:
        agent_prompt = render_prompt_with_profile(
            agent_prompt, child_profile, dispatch_memories, dispatch_relations, dispatch_entities
        )

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
    # USAGE TRACKING
    # ============================================================================
    usage_manager = UsageManager(mac_address=device_mac, session_id=room_name)
    usage_manager.setup_metrics_collection(session)
    logger.info("Usage tracking initialized")

    # ============================================================================
    # GAME ANALYTICS
    # ============================================================================
    game_analytics_manager = GameAnalyticsManager(
        mac_address=device_mac,
        session_id=room_name,
        mode_type="math_commander",
        agent_id=agent_id
    )
    set_game_analytics_manager(game_analytics_manager)
    logger.info("Game analytics initialized")

    emit_agent_state, emit_speech_created = create_state_handlers(ctx, session)
    logger.info("State management registered")

    # ============================================================================
    # PUBLISH GAME DATA HELPERS
    # ============================================================================

    async def publish_game_data(data: dict):
        """Publish JSON data to frontend via LiveKit data channel."""
        try:
            payload = json.dumps(data).encode("utf-8")
            await ctx.room.local_participant.publish_data(payload, reliable=True)
            logger.info(f"Published {data.get('type', 'unknown')} to frontend")
        except Exception as e:
            logger.error(f"Failed to publish game data: {e}")

    # ============================================================================
    # CONVERSATION LOG
    # ============================================================================
    conversation_log_path = os.path.join("logs", f"conversation_{room_name}.log")
    os.makedirs("logs", exist_ok=True)

    def log_conversation(role: str, text: str, event_type: str = "speech"):
        """Append a line to the conversation log file."""
        try:
            timestamp = time.strftime("%Y-%m-%d %H:%M:%S")
            with open(conversation_log_path, "a", encoding="utf-8") as f:
                f.write(f"[{timestamp}] [{role.upper()}] ({event_type}) {text}\n")
        except Exception as e:
            logger.debug(f"Failed to write conversation log: {e}")

    def log_game_event(event: str, details: str = ""):
        """Log a game event (question registered, answer, hint, etc.)."""
        log_conversation("system", f"{event}: {details}" if details else event, event_type="game")

    logger.info(f"Conversation log: {conversation_log_path}")

    async def flush_game_messages():
        """Pop pending messages from game state and publish to frontend."""
        if assistant.math_game_state:
            msgs = assistant.math_game_state.pop_messages()
            for msg in msgs:
                await publish_game_data(msg)

    # Wire up immediate publish from tools
    set_publish_callback(publish_game_data)

    async def play_sfx(sfx_type: str):
        """Play sound effect based on result type."""
        sfx_map = {
            "correct": "correct_chime",
            "wrong": "wrong_buzz",
            "complete": "game_complete_fanfare",
        }
        sfx_name = sfx_map.get(sfx_type)
        if sfx_name and assistant.audio_player:
            try:
                await assistant.audio_player.play_sfx(sfx_name)
            except Exception as e:
                logger.debug(f"SFX {sfx_name} not available: {e}")

    # ============================================================================
    # FUNCTION CALL HANDLERS
    # ============================================================================

    @session.on("function_calls_started")
    def on_function_calls_started(ev):
        """Reset hints when function calls start (user responded)."""
        nonlocal waiting_for_user_response
        logger.info(f"FUNCTION CALL STARTED: {ev}")
        if waiting_for_user_response:
            logger.info("Function call detected - resetting hint state")
            waiting_for_user_response = False
            reset_hints()

    @session.on("function_calls_finished")
    def on_function_calls_finished(ev):
        """Flush game messages to frontend and play SFX after tool execution."""
        nonlocal waiting_for_user_response
        logger.info(f"FUNCTION CALL FINISHED: {ev}")

        if waiting_for_user_response:
            logger.info("Function finished - resetting hints")
            waiting_for_user_response = False
            reset_hints()

        # Flush pending game messages to frontend and trigger SFX
        if assistant.math_game_state:
            msgs = assistant.math_game_state.pop_messages()
            logger.info(f"Flushing {len(msgs)} game messages to frontend")
            for msg in msgs:
                asyncio.create_task(publish_game_data(msg))
                # Log game events
                if msg.get("type") == "math_question":
                    log_game_event("question_registered", f"q={msg.get('question_id')} '{msg.get('question_text')}'")
                if msg.get("type") == "math_result":
                    log_game_event("voice_answer", f"correct={msg.get('correct')} stars={msg.get('progress', {}).get('stars')}")
                # SFX triggers based on message content
                if msg.get("type") == "math_result":
                    if msg.get("correct"):
                        asyncio.create_task(play_sfx("correct"))
                    else:
                        asyncio.create_task(play_sfx("wrong"))
                    if msg.get("game_complete"):
                        asyncio.create_task(play_sfx("complete"))

    logger.info("Function call handlers registered")

    # ============================================================================
    # PROGRESSIVE HINT SYSTEM (replaces idle reminders)
    # ============================================================================
    HINT_TIMEOUTS = [15, 25, 35]  # seconds: repeat, eliminate, reveal
    hint_timer_task = None
    current_hint_index = 0
    waiting_for_user_response = False

    async def send_progressive_hint():
        """Send escalating hints when kid is silent."""
        nonlocal current_hint_index, waiting_for_user_response
        try:
            if current_hint_index >= len(HINT_TIMEOUTS):
                logger.info("All hints exhausted")
                return

            timeout = HINT_TIMEOUTS[current_hint_index]
            await asyncio.sleep(timeout)

            game_state = assistant.math_game_state
            if not game_state or game_state.answer_locked:
                return
            # Guard: don't send hints if no question is registered yet
            if not game_state.current_question_id:
                return

            hint = game_state.escalate_hint()
            if not hint:
                return

            waiting_for_user_response = True
            current_hint_index += 1

            # Flush any messages (e.g., math_hint for eliminate)
            await flush_game_messages()

            if hint["action"] == "repeat":
                logger.info("Hint: repeating question")
                log_game_event("hint", "repeat question")
                await session.generate_reply(
                    instructions=f"The child is silent. Repeat the question with emphasis: '{hint['question_text']}'. Speak slowly and clearly."
                )
            elif hint["action"] == "eliminate":
                logger.info(f"Hint: eliminated option {hint['eliminated']}")
                log_game_event("hint", f"eliminate option {hint['eliminated']}")
                await session.generate_reply(
                    instructions=f"The child is still thinking. One wrong option has been removed from the screen. Encourage them: 'I've removed one wrong answer to help you! Look at the screen!'"
                )
            elif hint["action"] == "reveal":
                logger.info(f"Hint: revealing answer {hint['correct_answer']}")
                log_game_event("hint", f"reveal answer {int(hint['correct_answer'])}")
                await session.generate_reply(
                    instructions=f"The child didn't answer in time. The answer was {int(hint['correct_answer'])}. Say 'The answer was {int(hint['correct_answer'])}! Let's try another one!' Then register and ask a new question."
                )

            # Schedule next hint if available
            if current_hint_index < len(HINT_TIMEOUTS):
                start_hint_timer()

        except asyncio.CancelledError:
            logger.debug("Hint timer cancelled")
        except Exception as e:
            logger.warning(f"Hint error: {e}")

    def start_hint_timer():
        """Start the progressive hint timer."""
        nonlocal hint_timer_task
        cancel_hint_timer()
        hint_timer_task = asyncio.create_task(send_progressive_hint())

    def cancel_hint_timer():
        """Cancel the hint timer."""
        nonlocal hint_timer_task
        if hint_timer_task and not hint_timer_task.done():
            hint_timer_task.cancel()
        hint_timer_task = None

    def reset_hints():
        """Reset hint state for a new question."""
        nonlocal current_hint_index, waiting_for_user_response
        current_hint_index = 0
        waiting_for_user_response = False
        cancel_hint_timer()

    # ============================================================================
    # STATE AND SPEECH HANDLERS
    # ============================================================================

    # ============================================================================
    # AUTO-NEXT QUESTION (for voice answers — Gemini doesn't chain tools from tool responses)
    # ============================================================================

    async def prompt_next_question():
        """Inject instruction for LLM to generate and register the next question."""
        logger.info("Prompting LLM to register next question (voice follow-up)")
        log_game_event("voice_auto_next", "injecting generate_reply for next question")
        await session.generate_reply(
            instructions="The child just answered. Now create a NEW math question with a fun Indian story. Call register_math_question with your new question, then speak it aloud. Do NOT read the answer options — the screen shows them."
        )

    @session.on("agent_state_changed")
    def on_state_for_hints(ev):
        """Manage hint timer based on agent state. Also auto-prompt next question for voice answers."""
        nonlocal waiting_for_user_response
        new_state = getattr(ev, 'new_state', None)
        new_state_str = new_state.name.lower() if hasattr(new_state, 'name') else str(new_state)

        if new_state_str == 'thinking':
            if waiting_for_user_response:
                logger.info("Agent thinking (user input) - resetting hints")
                waiting_for_user_response = False
                reset_hints()

        if new_state_str == 'listening':
            # Check if voice answer needs LLM to generate next question
            game_state = assistant.math_game_state
            if game_state and game_state.voice_needs_next:
                game_state.voice_needs_next = False
                logger.info("Voice answer detected — prompting LLM for next question")
                asyncio.create_task(prompt_next_question())
                return  # Skip hint timer — generate_reply will handle it

            if not waiting_for_user_response:
                logger.info("Agent listening - starting hint timer")
                start_hint_timer()
        else:
            cancel_hint_timer()

    @session.on("user_speech_committed")
    def on_user_speech(msg):
        """Reset hints and log user speech."""
        nonlocal waiting_for_user_response
        text = getattr(msg, 'text', str(msg)) if hasattr(msg, 'text') else str(msg)
        logger.info(f"USER SAID: '{text}'")
        log_conversation("child", text)
        cancel_hint_timer()
        reset_hints()
        waiting_for_user_response = False

    @session.on("agent_speech_committed")
    def on_agent_speech(msg):
        """Log agent speech to conversation log."""
        text = getattr(msg, 'text', str(msg)) if hasattr(msg, 'text') else str(msg)
        if text and text.strip():
            logger.info(f"AGENT SAID: '{text}'")
            log_conversation("agent", text)

    logger.info(f"Progressive hint system enabled ({HINT_TIMEOUTS}s timeouts)")

    try:
        from src.agent.error_handler import setup_error_handling
        setup_error_handling(session=session, max_retries=3, custom_audio_path=None)
    except Exception as e:
        logger.warning(f"Error handler not available: {e}")

    assistant = MathCommanderAssistant(instructions=agent_prompt)
    assistant.set_room_info(room_name=ctx.room.name, device_mac=device_mac)

    from src.services.unified_audio_player import UnifiedAudioPlayer
    audio_player = UnifiedAudioPlayer()
    audio_player.set_context(ctx)
    assistant.audio_player = audio_player
    logger.info("UnifiedAudioPlayer initialized")

    assistant.enable_battery_tools()
    assistant.enable_volume_tools()
    assistant.enable_math_game()

    # Set game mode based on child age
    child_age = None
    if child_profile:
        child_age = child_profile.get('age')
    game_mode = "commander" if child_age and child_age >= 7 else "explorer"

    # Re-create game state with correct mode (enable_math_game creates a default)
    from src.games.math_game import MathGameState
    assistant.math_game_state = MathGameState(game_mode=game_mode)
    set_math_game_state(assistant.math_game_state)
    logger.info(f"Game mode set to: {game_mode} (child_age={child_age})")

    logger.info("Math Commander features enabled (with mode switching)")

    participant_count = len(ctx.room.remote_participants)
    cleanup_completed = False
    cleanup_task = None

    # Initialize chat history service
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
            cancel_hint_timer()

            try:
                logger.info("About to log usage summary...")
                if usage_manager:
                    await asyncio.wait_for(
                        asyncio.shield(usage_manager.log_session_summary()),
                        timeout=5.0
                    )
                logger.info("Usage summary completed")
            except asyncio.TimeoutError:
                logger.warning("Usage logging timed out after 5s")
            except asyncio.CancelledError:
                logger.warning("Usage logging was cancelled but should complete")
            except Exception as e:
                logger.warning(f"Failed to log usage summary: {e}")

            try:
                logger.info(f"About to send game analytics, manager exists: {game_analytics_manager is not None}")
                if game_analytics_manager:
                    await asyncio.wait_for(
                        asyncio.shield(game_analytics_manager.send_analytics(completion_status='completed')),
                        timeout=10.0
                    )
                logger.info("Game analytics completed")
            except asyncio.TimeoutError:
                logger.warning("Game analytics timed out after 5s")
            except asyncio.CancelledError:
                logger.warning("Game analytics was cancelled but should complete")
            except Exception as e:
                logger.warning(f"Failed to send game analytics: {e}")

            try:
                await asyncio.wait_for(
                    asyncio.shield(extract_and_send_chat_history(session, chat_history_service, device_mac)),
                    timeout=20.0
                )
            except asyncio.TimeoutError:
                logger.warning("Chat history extraction timed out after 5s")
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
            logger.info(f"[END-PROMPT] Saying goodbye: {prompt_text[:50]}...")
            try:
                await asyncio.wait_for(
                    session.generate_reply(instructions=prompt_text),
                    timeout=10.0
                )
                logger.info("[END-PROMPT] Goodbye message completed")
            except asyncio.TimeoutError:
                logger.warning("[END-PROMPT] Goodbye timed out - session may be busy")
            except Exception as gen_error:
                logger.warning(f"[END-PROMPT] Could not generate goodbye: {gen_error}")
        except Exception as e:
            logger.error(f"[END-PROMPT] Error in goodbye handler: {e}")

    async def handle_skip():
        try:
            if assistant.audio_player:
                await assistant.audio_player.stop()
        except Exception as e:
            logger.error(f"Error in skip: {e}")

    # ============================================================================
    # TAP ANSWER HANDLER
    # ============================================================================
    TAP_COOLDOWN_MS = 500
    _last_tap_time = 0

    async def handle_tap_answer(question_id: str, value, input_method: str = "tap"):
        """Handle tap answer from frontend — validate directly, inject result into LLM."""
        nonlocal _last_tap_time

        # Tap cooldown (prevent spam)
        now = int(time.time() * 1000)
        if now - _last_tap_time < TAP_COOLDOWN_MS:
            logger.info("Tap cooldown active, ignoring")
            return
        _last_tap_time = now

        game_state = assistant.math_game_state
        if not game_state or game_state.answer_locked:
            logger.info("Answer already locked, ignoring tap")
            return

        if game_state.current_question_id != question_id:
            logger.info(f"Tap for wrong question: got {question_id}, expected {game_state.current_question_id}")
            return

        try:
            user_answer = float(value)
        except (ValueError, TypeError):
            logger.warning(f"Invalid tap value: {value}")
            return

        # Validate directly against game state (bypass LLM tool call)
        result = game_state.check_answer(user_answer, input_method=input_method)
        if result is None:
            return

        # Log game event
        correct_str = "CORRECT" if result["correct"] else "WRONG"
        log_game_event("tap_answer", f"q={question_id} value={int(user_answer)} {correct_str} stars={result['progress']['stars']}/{result['progress']['total_needed']}")

        # Record analytics
        if game_analytics_manager:
            game_analytics_manager.record_attempt(
                game_type="math_commander",
                is_correct=result["correct"],
                attempt_number=1,
                response_time_ms=0,
            )

        # Flush result messages to frontend
        await flush_game_messages()

        # Play SFX
        if result["correct"]:
            asyncio.create_task(play_sfx("correct"))
        else:
            asyncio.create_task(play_sfx("wrong"))

        if result.get("game_complete"):
            asyncio.create_task(play_sfx("complete"))

        # Inject result into LLM so it can react
        if result["correct"]:
            if result.get("game_complete"):
                inject = f"The child tapped the correct answer {int(user_answer)}! They now have {result['progress']['stars']}/{result['progress']['total_needed']} stars. MISSION ACCOMPLISHED! Celebrate!"
            elif result.get("bonus_star"):
                inject = f"The child tapped {int(user_answer)} — CORRECT! 5 in a row COMBO! Bonus star! Stars: {result['progress']['stars']}/{result['progress']['total_needed']}. Celebrate the combo, then register and ask a new question."
            else:
                inject = f"The child tapped the correct answer {int(user_answer)}! Stars: {result['progress']['stars']}/{result['progress']['total_needed']}. Say well done, then register and ask a new question."
        else:
            if result.get("game_over"):
                inject = f"The child tapped {int(user_answer)} — wrong. All lives lost! Game over. Say 'Mission failed, but let's try again!' The game will restart."
                game_state.restart()
                game_state.queue_message({
                    "type": "game_state",
                    "state": "restarted",
                    "game_mode": game_state.game_mode,
                    "progress": game_state._get_progress(),
                })
                await flush_game_messages()
            elif result.get("retry"):
                inject = f"The child tapped {int(user_answer)} — wrong. They can try again. Encourage them to try once more."
            else:
                inject = f"The child tapped {int(user_answer)} — wrong. The answer was {result['correct_answer']}. Tell them the answer, then register and ask a new question."

        await session.generate_reply(instructions=inject)

    # ============================================================================
    # DATA CHANNEL HANDLER
    # ============================================================================

    @ctx.room.on("data_received")
    def on_data_received(data_packet: rtc.DataPacket):
        try:
            message = json.loads(data_packet.data.decode('utf-8'))
            msg_type = message.get('type')

            # Handle greeting trigger from device
            if msg_type == 'ready_for_greeting':
                logger.info("Device ready for greeting - triggering greeting now")
                asyncio.create_task(assistant.play_greeting())
                return

            # Handle tap answer from frontend
            if msg_type == 'math_answer':
                question_id = message.get('question_id')
                value = message.get('value')
                input_method = message.get('input_method', 'tap')
                logger.info(f"Tap answer received: q={question_id}, value={value}")
                asyncio.create_task(handle_tap_answer(question_id, value, input_method))
                return

            # Handle end prompt - say goodbye message
            if msg_type == 'end_prompt':
                prompt_text = message.get('prompt', "Time flies so fast! It was wonderful learning with you. Goodbye!")
                logger.info(f"[END-PROMPT] Received end_prompt from gateway")
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

    ctx.add_shutdown_callback(cleanup_room_and_session)

    await ctx.connect(auto_subscribe=AutoSubscribe.AUDIO_ONLY)

    # DUPLICATE AGENT CHECK
    my_identity = ctx.room.local_participant.identity if ctx.room.local_participant else None
    existing_agents = [
        p for p in ctx.room.remote_participants.values()
        if p.identity and 'agent' in p.identity.lower() and p.identity != my_identity
    ]
    if existing_agents:
        logger.warning(f"[DUPLICATE-AGENT] Another agent already in room: {[a.identity for a in existing_agents]}")
        logger.warning(f"[DUPLICATE-AGENT] Exiting to prevent duplicate. Room: {ctx.room.name}")
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

    # Publish initial game state to frontend
    if assistant.math_game_state:
        start_payload = {
            "type": "game_state",
            "state": "started",
            "game_mode": assistant.math_game_state.game_mode,
            "progress": assistant.math_game_state._get_progress(),
        }
        asyncio.create_task(publish_game_data(start_payload))
        logger.info(f"Published game_state 'started' ({game_mode} mode)")

        # Auto-register first question so UI shows immediately with greeting
        first_questions = [
            ("8 - 4 = ?", "8 parrots on a tree, 4 fly away!", 4),
            ("5 + 3 = ?", "5 samosas on a plate, Mummy brings 3 more!", 8),
            ("10 - 6 = ?", "10 balloons at the mela, 6 pop!", 4),
            ("3 + 4 = ?", "3 monkeys on a wall, 4 more jump up!", 7),
            ("9 - 5 = ?", "9 laddoos in a box, you ate 5!", 4),
        ]
        q_text, s_text, answer = random.choice(first_questions)
        payload = assistant.math_game_state.register_question(q_text, s_text, answer)
        msgs = assistant.math_game_state.pop_messages()
        for msg in msgs:
            asyncio.create_task(publish_game_data(msg))
        logger.info(f"Auto-registered first question: {q_text}")

    init_elapsed = (asyncio.get_event_loop().time() - init_start_time) * 1000
    logger.info(f"Total initialization: {init_elapsed:.0f}ms")
    logger.info(f"{CHARACTER_NAME} agent is LIVE!")


if __name__ == "__main__":
    port = int(os.getenv("MATH_COMMANDER_PORT", DEFAULT_PORT))
    logger.info(f"Starting {AGENT_NAME} on port {port}")

    cli.run_app(WorkerOptions(
        entrypoint_fnc=entrypoint,
        prewarm_fnc=prewarm,
        agent_name=AGENT_NAME,
        num_idle_processes=0,  # Disable idle processes to avoid Windows socket buffer exhaustion
        initialize_process_timeout=120.0,
        job_memory_warn_mb=2000,
        port=port,
    ))
