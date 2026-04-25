"""
Cheeko Agent Worker
Main conversational agent with all features enabled

agent_name: cheeko-xai
Port: 8081
"""

import os
import sys
import json
import asyncio
import time
from datetime import datetime

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
    RunContext,
    function_tool,
    # BackgroundAudioPlayer,  # NOT used - causes separate audio track (robotic sound)
)
from livekit import rtc
from livekit.plugins import openai
import pytz
from openai.types.realtime import AudioTranscription
from openai.types.realtime.realtime_audio_input_turn_detection import ServerVad

from src.config.config_loader import ConfigLoader
from src.utils.database_helper import DatabaseHelper
from src.utils.safety_filter import contains_unsafe_content, UNSAFE_RESPONSE_TEXT
from src.services.prompt_service import PromptService
# from src.services.music_service import MusicService  # COMMENTED OUT - Music service disabled
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
# from src.features.music_tools import play_music, stop_music, next_song, previous_song  # COMMENTED OUT - Music service disabled
from src.features.mode_switching import update_agent_mode
from src.services.mem0_service import mem0_service

# Agent configuration
AGENT_NAME = "cheeko-xai"

# Keywords that trigger context-aware memory search (high-value triggers only)
# These are patterns where memory injection provides significant value
MEMORY_TRIGGER_PATTERNS = [
    ("story", ["story about", "tell me a story", "tell a story"]),  # Story requests
    ("remember", ["do you remember", "remember my", "remember when"]),  # Memory queries
    ("family", ["about my", "my dog", "my cat", "my pet", "my brother", "my sister", "my mom", "my dad", "my family"]),  # Family/pet references
    ("question", ["what's my", "who is my", "what is my"]),  # Direct memory questions
]

def should_inject_memory(text: str) -> tuple[bool, str]:
    """
    Check if the user's message should trigger memory injection.
    Returns (should_inject, trigger_category)
    """
    text_lower = text.lower()
    for category, patterns in MEMORY_TRIGGER_PATTERNS:
        for pattern in patterns:
            if pattern in text_lower:
                return True, category
    return False, ""
CHARACTER_NAME = "Cheeko"
DEFAULT_PORT = 8081
# MUSIC_TOOLS = [play_music, stop_music, next_song, previous_song]  # COMMENTED OUT - Music service disabled
MODE_SWITCH_TOOLS = [update_agent_mode]

TIMEZONE_ALIASES = {
    "asia/kolkata": ("Asia/Kolkata", "India Standard Time (IST)"),
    "india": ("Asia/Kolkata", "India Standard Time (IST)"),
    "indian time": ("Asia/Kolkata", "India Standard Time (IST)"),
    "indian standard time": ("Asia/Kolkata", "India Standard Time (IST)"),
    "ist": ("Asia/Kolkata", "India Standard Time (IST)"),
    "utc": ("UTC", "UTC"),
    "gmt": ("Etc/GMT", "GMT"),
}

DEFAULT_TIMEZONE_ID = "Asia/Kolkata"
DEFAULT_TIMEZONE_LABEL = "India Standard Time (IST)"


def build_session_prompt_vars(dispatch_metadata: dict) -> dict:
    """Extract session-level prompt variables from dispatch metadata."""
    return {
        'session_language_code': dispatch_metadata.get('session_language_code', '') or '',
        'session_language_name': dispatch_metadata.get('session_language_name', '') or '',
    }


def build_language_lock(language_name: str) -> str:
    """Append a strict session language directive."""
    if not language_name:
        return ""

    return f"""

<session_language_override>
This session language is fixed by the RFID AI card.
- You must speak only in {language_name}.
- Do not answer in any other language.
- Use natural, child-friendly {language_name}.
- Use native script by default unless the child explicitly asks for transliteration.
</session_language_override>
"""


def build_time_tool_guard() -> str:
    """Append a strict rule to use the local time tool for time/date questions."""
    return """

<time_tool_rule>
- For any question about the current time, date, day, or timezone, call the `get_time_date` tool first.
- Do not guess the time/date from memory.
- Do not rely on Google Search for basic current time/date questions when `get_time_date` can answer them.
- Default timezone is India Standard Time (Asia/Kolkata) unless the user explicitly asks for another timezone.
</time_tool_rule>
"""


def build_search_availability_guard() -> str:
    """Append a rule that disables any claim of live web search for this session."""
    return """

<search_availability_rule>
- In this session, no live web search tool is available.
- Do not say you searched the internet, browsed the web, or verified something online unless a real search tool is present.
- For current time/date questions, use the `get_time_date` tool.
</search_availability_rule>
"""


def build_identity_guard() -> str:
    """Append a strict identity directive so provider names are not mistaken for the creator."""
    return """

<identity_guard>
You are Cheeko, the AI companion for the Cheeko product.
- If asked who created, built, or made you, say: "I was created by ALTIO AI PRIVATE LIMITED for Cheeko."
- Do not say Google, Gemini, LiveKit, Cerebrium, ElevenLabs, AWS, OpenAI, or any model/provider created you.
- If asked what technology powers you, say you may use third-party AI services, but they are tools and not your creator.
</identity_guard>
"""


def resolve_timezone(timezone_name: str) -> tuple[str, str]:
    """Resolve a user-facing timezone name to a pytz timezone and display label."""
    normalized = (timezone_name or DEFAULT_TIMEZONE_ID).strip()
    if not normalized:
        normalized = DEFAULT_TIMEZONE_ID

    alias = TIMEZONE_ALIASES.get(normalized.lower())
    if alias:
        return alias

    try:
        timezone = pytz.timezone(normalized)
        return timezone.zone, timezone.zone
    except Exception:
        logger.warning(f"⏰ [TIME-TOOL] Unknown timezone '{timezone_name}', defaulting to IST")
        return DEFAULT_TIMEZONE_ID, DEFAULT_TIMEZONE_LABEL


def get_latest_user_text(context: RunContext) -> str:
    """Return the latest user text from session history, if available."""
    try:
        messages = context.session.history.messages()
        for message in reversed(messages):
            if message.role == "user" and message.text_content:
                return message.text_content
    except Exception as e:
        logger.debug(f"⏰ [TIME-TOOL] Could not inspect chat history: {e}")

    return ""


def should_force_default_timezone(user_text: str, requested_timezone_id: str) -> bool:
    """Use IST for generic time questions unless the user explicitly asked for another timezone."""
    if requested_timezone_id == DEFAULT_TIMEZONE_ID:
        return False

    normalized_text = (user_text or "").lower()
    if not normalized_text:
        return True

    explicit_non_default_markers = [
        " utc",
        "gmt",
        "greenwich",
        "universal time",
        "zulu time",
        "pst",
        "pdt",
        "est",
        "edt",
        "cst",
        "cdt",
        "mst",
        "mdt",
        "london",
        "new york",
        "tokyo",
        "dubai",
        "singapore",
        "paris",
        "in utc",
        "in gmt",
    ]
    explicit_default_markers = [
        " india",
        " indian",
        " ist",
        "kolkata",
        "asia/kolkata",
    ]

    if any(marker in normalized_text for marker in explicit_non_default_markers):
        return False

    if any(marker in normalized_text for marker in explicit_default_markers):
        return requested_timezone_id != DEFAULT_TIMEZONE_ID

    return " in " not in normalized_text


@function_tool
async def get_time_date(
    context: RunContext,
    query_type: str = "time",
    timezone_name: str = DEFAULT_TIMEZONE_ID,
) -> str:
    """
    Get the current time and/or date using the server clock in a requested timezone.

    Use this tool for questions like:
    - "What time is it?"
    - "What's today's date?"
    - "Tell me the date and time in India"
    - "What time is it in UTC?"

    Args:
        query_type: One of "time", "date", "both", or "calendar"
        timezone_name: Timezone name like "Asia/Kolkata", "IST", "India", or "UTC"
    """
    try:
        tz_id, display_name = resolve_timezone(timezone_name)
        latest_user_text = get_latest_user_text(context)
        if should_force_default_timezone(latest_user_text, tz_id):
            logger.info(
                f"⏰ [TIME-TOOL] Overriding requested timezone '{tz_id}' to default IST for generic query: '{latest_user_text}'"
            )
            tz_id, display_name = DEFAULT_TIMEZONE_ID, DEFAULT_TIMEZONE_LABEL
        now = datetime.now(pytz.timezone(tz_id))
        query_type = (query_type or "time").strip().lower()

        logger.info(
            f"⏰ [TIME-TOOL] get_time_date called with query_type='{query_type}', timezone='{tz_id}'"
        )

        if query_type == "date":
            return f"Today's date in {display_name} is {now.strftime('%A, %B %d, %Y')}."

        if query_type == "both":
            return (
                f"In {display_name}, today is {now.strftime('%A, %B %d, %Y')} "
                f"and the current time is {now.strftime('%I:%M %p')}."
            )

        if query_type == "calendar":
            vikram_year = now.year + 57
            hindu_months = [
                "Paush", "Magh", "Falgun", "Chaitra", "Vaishakh", "Jyeshtha",
                "Ashadh", "Shravan", "Bhadrapada", "Ashwin", "Kartik", "Margashirsha",
            ]
            hindu_month = hindu_months[now.month - 1]
            return (
                f"In {display_name}, today is {now.strftime('%A, %B %d, %Y')} "
                f"and the current time is {now.strftime('%I:%M %p')}. "
                f"In the Hindu calendar, this is {hindu_month} in Vikram Samvat year {vikram_year}."
            )

        return f"The current time in {display_name} is {now.strftime('%I:%M %p')}."

    except Exception as e:
        logger.error(f"⏰ [TIME-TOOL] Error getting time/date: {e}")
        return "Sorry, I couldn't get the current time right now."


class CheekoAssistant(BaseAssistant):
    """Cheeko Assistant - Main conversational agent"""

    # Custom greeting for Cheeko
    GREETING_INSTRUCTION = "Greet the user warmly as Cheeko, a friendly AI companion. Keep it brief and playful."

    def __init__(self, instructions: str = None) -> None:
        super().__init__(instructions=instructions)



def prewarm(proc: JobProcess):
    """Prewarm for xAI realtime."""
    # COMMENTED OUT - Music service disabled (saves ~11s startup time)
    # from src.utils import start_preloading
    # start_preloading()  # Only runs in worker process, not watcher
    logger.info("[PREWARM] Ready for xAI realtime")
    proc.userdata["ready"] = True


async def entrypoint(ctx: JobContext):
    """Entrypoint for Cheeko agent worker"""

    ctx.log_context_fields = {"room": ctx.room.name}
    logger.info(f"Starting {CHARACTER_NAME} agent in room: {ctx.room.name}")

    init_start_time = asyncio.get_event_loop().time()

    # Parse room name
    room_name = ctx.room.name
    device_mac, room_type = parse_room_name(room_name)

    # Initialize services
    prompt_service = PromptService()
    agent_prompt = ConfigLoader.get_default_prompt()
    child_profile = None
    agent_id = None

    # Check if child profile and memories are in dispatch metadata (passed from MQTT gateway)
    dispatch_child_profile = None
    dispatch_memories = []
    dispatch_relations = []
    dispatch_entities = []
    dispatch_metadata = {}
    session_prompt_vars = {}
    try:
        if hasattr(ctx, 'job') and ctx.job and ctx.job.metadata:
            dispatch_metadata = json.loads(ctx.job.metadata)
            dispatch_child_profile = dispatch_metadata.get('child_profile')
            dispatch_memories = dispatch_metadata.get('long_term_memories', [])
            dispatch_relations = dispatch_metadata.get('memory_relations', [])
            dispatch_entities = dispatch_metadata.get('memory_entities', [])
            session_prompt_vars = build_session_prompt_vars(dispatch_metadata)
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
    
    agent_prompt = render_prompt_with_profile(
        agent_prompt,
        child_profile,
        dispatch_memories,
        dispatch_relations,
        dispatch_entities,
        extra_vars=session_prompt_vars,
    )

    if session_prompt_vars.get('session_language_name'):
        agent_prompt += build_language_lock(session_prompt_vars['session_language_name'])

    agent_prompt += build_time_tool_guard()
    agent_prompt += build_search_availability_guard()
    agent_prompt += build_identity_guard()

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

    xai_voice = os.getenv("XAI_REALTIME_VOICE", "Ara")
    xai_model_name = os.getenv("XAI_REALTIME_MODEL", "grok-voice-think-fast-1.0")
    xai_api_key = os.getenv("XAI_API_KEY")
    if not xai_api_key:
        raise ValueError("XAI_API_KEY is required for the xAI realtime worker")

    realtime_model = openai.realtime.RealtimeModel(
        base_url="wss://api.x.ai/v1/realtime",
        api_key=xai_api_key,
        model=xai_model_name,
        voice=xai_voice,
        modalities=["audio"],
        input_audio_transcription=AudioTranscription(),
        turn_detection=ServerVad(
            type="server_vad",
            threshold=0.5,
            prefix_padding_ms=300,
            silence_duration_ms=200,
            create_response=True,
            interrupt_response=True,
        ),
    )
    realtime_model._capabilities.per_response_tool_choice = False
    realtime_model._provider_label = "xAI Realtime API"
    logger.info(f"xAI realtime model created with model={xai_model_name}, voice={xai_voice}")

    # Create AgentSession with xAI realtime, mode switching, and deterministic time/date.
    session_tools = [*MODE_SWITCH_TOOLS, get_time_date]
    session = AgentSession(llm=realtime_model, tools=session_tools)
    logger.info(
        f"AgentSession created with xAI realtime, {len(MODE_SWITCH_TOOLS)} mode switching tools, and 1 time/date tool"
    )

    # Create state handlers
    emit_agent_state, emit_speech_created = create_state_handlers(ctx, session)
    logger.info("State management registered")

    # ============================================================================
    # USAGE TRACKING: Capture prompt_tokens, completion_tokens, TTFT per response
    # ============================================================================
    usage_manager = UsageManager(mac_address=device_mac, session_id=room_name)
    usage_manager.setup_metrics_collection(session)
    logger.info("Usage tracking initialized - subscribed to metrics_collected event")

    # ============================================================================
    # DEBUG: Track user speech and function calls
    # ============================================================================

    # Track if we're currently injecting memory to avoid conflicts
    memory_injection_in_progress = False
    last_memory_injection_time = 0

    @session.on("user_speech_committed")
    def on_user_speech(msg):
        """Log what the user said and inject memory context if relevant"""
        nonlocal memory_injection_in_progress, last_memory_injection_time

        text = getattr(msg, 'text', str(msg)) if hasattr(msg, 'text') else str(msg)
        logger.info(f"🎤 USER SAID: '{text}'")

        if contains_unsafe_content(text):
            logger.warning("ðŸ›¡ï¸ [SAFETY] Unsafe speech detected; bypassing model response")

            async def handle_unsafe_speech():
                try:
                    await session.interrupt(force=True)
                except Exception as interrupt_error:
                    logger.debug(f"ðŸ›¡ï¸ [SAFETY] Interrupt skipped: {interrupt_error}")

                try:
                    session.say(
                        UNSAFE_RESPONSE_TEXT,
                        allow_interruptions=True,
                        add_to_chat_ctx=False,
                    )
                except Exception as say_error:
                    logger.error(f"ðŸ›¡ï¸ [SAFETY] Failed to deliver safe refusal: {say_error}")

            asyncio.create_task(handle_unsafe_speech())
            return

        # Skip memory injection if one is already in progress or happened recently
        current_time = time.time()
        if memory_injection_in_progress or (current_time - last_memory_injection_time) < 5:
            logger.debug(f"🧠 [MEM0] Skipping memory check - recent injection or in progress")
            return

        # Check if this message should trigger memory injection
        inject, category = should_inject_memory(text)

        if inject and device_mac and mem0_service.is_ready():
            logger.info(f"🧠 [MEM0] Memory trigger detected: category='{category}'")
            memory_injection_in_progress = True
            last_memory_injection_time = current_time
            # Search for relevant memories and inject context
            asyncio.create_task(inject_memory_context(text, device_mac, category))

    async def inject_memory_context(user_query: str, mac_address: str, category: str):
        """Search for relevant memories and inject them into the conversation"""
        nonlocal memory_injection_in_progress

        try:
            # Small delay to let any automatic response start
            # This helps us decide whether to interrupt or not
            await asyncio.sleep(0.3)

            # Search for memories relevant to what the user just said
            relevant_memories = await mem0_service.search_relevant_memories(
                user_id=mac_address,
                query=user_query,
                limit=3  # Keep it small for low latency
            )

            if relevant_memories:
                logger.info(f"🧠 [MEM0-INJECT] Found {len(relevant_memories)} relevant memories for '{category}': '{user_query[:30]}...'")

                # Format the memory context
                memory_context = mem0_service.format_relevant_memories_for_injection(
                    user_query, relevant_memories
                )

                # For high-value triggers like stories, inject with generate_reply
                # This will guide the response to use the memories
                if category in ["story", "remember", "question"]:
                    try:
                        logger.info(f"🧠 [MEM0-INJECT] Injecting memory context for {category} request")
                        await session.generate_reply(
                            instructions=f"{memory_context}\n\nRespond to the child's request: '{user_query}'"
                        )
                        logger.info(f"🧠 [MEM0-INJECT] Memory context injected successfully")
                    except Exception as gen_err:
                        # This is expected if the model is already responding
                        logger.debug(f"🧠 [MEM0-INJECT] Could not inject (model may be responding): {gen_err}")
                else:
                    # For other categories, just log - rely on prompt instructions
                    logger.info(f"🧠 [MEM0-INJECT] Relevant memories available for '{category}' - relying on prompt")
            else:
                logger.debug(f"🧠 [MEM0-INJECT] No relevant memories found for: '{user_query[:30]}...'")

        except Exception as e:
            logger.error(f"🧠 [MEM0-INJECT] Error searching memories: {e}")
        finally:
            memory_injection_in_progress = False

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
    # assistant.enable_battery_tools()  # COMMENTED OUT - Battery tools disabled
    # assistant.enable_volume_tools()  # COMMENTED OUT - Volume tools disabled
    assistant.enable_mode_switching()
    # assistant.enable_music_tools(music_service)  # COMMENTED OUT - Music service disabled
    logger.info("Cheeko features enabled (mode switching only)")

    # Room lifecycle management
    participant_count = len(ctx.room.remote_participants)
    cleanup_completed = False
    cleanup_task = None

    # Initialize chat history service (sends on room close)
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

            # Log usage summary before closing session (sends to Manager API)
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

            # Extract and send chat history before closing session (also sends to Mem0)
            # Use asyncio.shield to protect from cancellation during job shutdown
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
        """Handle end prompt - say goodbye message before cleanup using xAI realtime."""
        try:
            logger.info(f"👋 [END-PROMPT] Saying goodbye: {prompt_text[:50]}...")

            # For realtime models, use generate_reply with instructions.
            # Add timeout to prevent hanging if session is in bad state
            try:
                await asyncio.wait_for(
                    session.generate_reply(instructions=prompt_text),
                    timeout=10.0  # 10 second timeout for goodbye
                )
                logger.info("👋 [END-PROMPT] Goodbye message completed")
            except asyncio.TimeoutError:
                logger.warning("👋 [END-PROMPT] Goodbye timed out - session may be busy")
            except Exception as gen_error:
                # RealtimeError or other generation errors - log and continue
                logger.warning(f"👋 [END-PROMPT] Could not generate goodbye: {gen_error}")

        except Exception as e:
            logger.error(f"👋 [END-PROMPT] Error in goodbye handler: {e}")

    @ctx.room.on("data_received")
    def on_data_received(data_packet: rtc.DataPacket):
        """Handle data channel messages from gateway"""
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
                prompt_text = message.get('prompt', "Time flies so fast! It was wonderful talking with you. Goodbye!")
                logger.info(f"👋 [END-PROMPT] Received end_prompt from gateway")
                asyncio.create_task(handle_end_prompt(prompt_text))
                return

            # Handle shutdown request from gateway
            if msg_type == 'shutdown_request':
                logger.info("Received shutdown_request from gateway, initiating cleanup...")

                # Send ack if requested
                if message.get('require_ack'):
                    asyncio.create_task(send_shutdown_ack(message.get('session_id', '')))

                # Trigger cleanup
                asyncio.create_task(cleanup_room_and_session())
                return

            # Handle text input forwarded from MQTT gateway (RFID text)
            # Supports RAG system with read_only content and legacy prompt mode
            if msg_type == 'user_text':
                # Extract RAG content fields first (needed for validation)
                content_type = message.get('content_type', 'prompt')  # "animal", "read_only", or "prompt"
                title = message.get('title', '')
                content_text = message.get('content_text', '')
                sequence = message.get('sequence')
                rfid_uid = message.get('rfid_uid', '')
                text = (message.get('text') or '').strip()

                # For animal/read_only, content is in content_text; for prompt, it's in text
                has_content = bool(content_text) if content_type in ('animal', 'read_only') else bool(text)
                if not has_content:
                    logger.warning(f"⚠️ user_text message with empty content (type={content_type}), ignoring")
                    return

                logger.info(f"💬 [USER_TEXT] Received from gateway: content_type={content_type}, title={title}")
                logger.info(f"🧾 [USER_TEXT-RAW] Payload: {message}")

                async def handle_user_text():
                    try:
                        source_text = content_text if content_type in ('animal', 'read_only') else text
                        if contains_unsafe_content(source_text):
                            logger.warning("ðŸ›¡ï¸ [SAFETY] Unsafe gateway text detected; refusing locally")
                            session.say(
                                UNSAFE_RESPONSE_TEXT,
                                allow_interruptions=True,
                                add_to_chat_ctx=False,
                            )
                            return

                        # Mark agent as listening/processing for LED state
                        await emit_agent_state("listening")

                        if content_type == 'animal' and content_text:
                            instruction = (
                                f"Speak this animal-card content for a child. Keep it warm and clear. "
                                f"Title: {title}. Content: {content_text}"
                            )
                            logger.info(f"[ANIMAL] Sending animal card to xAI realtime: {title}")
                            await session.generate_reply(instructions=instruction)
                        elif content_type == 'read_only' and content_text:
                            instruction = (
                                f"Recite this child-friendly content exactly and naturally. "
                                f"Title: {title}. Content: {content_text}"
                            )
                            logger.info(f"[RFID-RAG] Sending read-only content to xAI realtime: {title}")
                            await session.generate_reply(instructions=instruction)
                        else:
                            logger.info(f"[RFID-PROMPT] Sending to xAI realtime: {text[:100]}...")
                            await session.generate_reply(instructions=text)
                    except Exception as e:
                        logger.error(f"❌ Error handling user_text: {e}")

                asyncio.create_task(handle_user_text())

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

    # NOTE: BackgroundAudioPlayer NOT started - all audio plays via session.say() on single track
    # await background_audio.start(room=ctx.room, agent_session=session)
    # logger.info("✅ BackgroundAudioPlayer started")

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
    # Use worker-specific port (ignore global PORT env var from Cerebrium)
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
