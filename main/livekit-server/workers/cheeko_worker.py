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
from livekit import rtc, api
from livekit.plugins import google, elevenlabs
import io
import pytz
from pydub import AudioSegment

from src.config.config_loader import ConfigLoader
from src.services.elevenlabs_tts_service import get_elevenlabs_service
from src.services.animal_audio_service import AnimalAudioService
from src.services.rhyme_cache_service import get_rhyme_cache_service
from src.utils.database_helper import DatabaseHelper
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
AGENT_NAME = "cheeko-agent"

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


class NonResumableGeminiRealtimeModel(google.realtime.RealtimeModel):
    """Disable Gemini session resumption to avoid stale-handle reconnect failures."""

    def _build_connect_config(self):
        # Force every reconnect to start as a fresh Gemini Live session.
        self._session_resumption_handle = None
        conf = super()._build_connect_config()
        conf.session_resumption = None
        return conf


async def play_elevenlabs_audio(session: AgentSession, mp3_data: bytes, title: str = ""):
    """
    Play ElevenLabs MP3 audio via session.say() with pre-synthesized audio frames.
    This plays through the agent's existing audio track.

    Args:
        session: The AgentSession to play audio through
        mp3_data: MP3 audio bytes from ElevenLabs
        title: Title for logging purposes
    """
    try:
        logger.info(f"🎵 [ELEVENLABS] Playing audio for: {title}")

        # Convert MP3 to raw PCM audio (48kHz mono for LiveKit)
        audio_segment = AudioSegment.from_mp3(io.BytesIO(mp3_data))
        audio_segment = audio_segment.set_frame_rate(48000).set_channels(1)

        # Get raw PCM data
        raw_data = audio_segment.raw_data
        sample_rate = audio_segment.frame_rate
        num_channels = audio_segment.channels
        samples_per_channel = len(audio_segment.get_array_of_samples())

        logger.info(f"🎵 [ELEVENLABS] Audio: {len(audio_segment)}ms, {sample_rate}Hz, {num_channels}ch")

        # Create AudioFrame from the raw PCM data
        audio_frame = rtc.AudioFrame(
            data=raw_data,
            sample_rate=sample_rate,
            num_channels=num_channels,
            samples_per_channel=samples_per_channel,
        )

        # Async generator that yields the audio frame
        async def audio_generator():
            yield audio_frame

        # Play using session.say with pre-synthesized audio
        # Pass title as text (for transcript), audio frames for playback
        await session.say(text=title, audio=audio_generator(), allow_interruptions=False, add_to_chat_ctx=False)

        logger.info(f"✅ [ELEVENLABS] Finished playing: {title}")

    except Exception as e:
        logger.error(f"❌ [ELEVENLABS] Error playing audio: {e}")
        raise


async def play_local_mp3_audio(session: AgentSession, file_path: str, title: str = ""):
    """
    Play a local MP3 file via session.say() on the same audio track as TTS.
    This ensures all audio plays on a single track (no robotic mixing).

    Args:
        session: The AgentSession to play audio through
        file_path: Absolute path to the MP3 file
        title: Title for logging purposes
    """
    try:
        logger.info(f"🔊 [LOCAL-MP3] Playing audio from: {file_path}")

        # Read the MP3 file
        with open(file_path, 'rb') as f:
            mp3_data = f.read()

        # Convert MP3 to raw PCM audio (48kHz mono for LiveKit)
        audio_segment = AudioSegment.from_mp3(io.BytesIO(mp3_data))
        audio_segment = audio_segment.set_frame_rate(48000).set_channels(1)

        # Get raw PCM data
        raw_data = audio_segment.raw_data
        sample_rate = audio_segment.frame_rate
        num_channels = audio_segment.channels
        samples_per_channel = len(audio_segment.get_array_of_samples())

        logger.info(f"🔊 [LOCAL-MP3] Audio: {len(audio_segment)}ms, {sample_rate}Hz, {num_channels}ch")

        # Create AudioFrame from the raw PCM data
        audio_frame = rtc.AudioFrame(
            data=raw_data,
            sample_rate=sample_rate,
            num_channels=num_channels,
            samples_per_channel=samples_per_channel,
        )

        # Async generator that yields the audio frame
        async def audio_generator():
            yield audio_frame

        # Play using session.say with pre-synthesized audio (same track as TTS)
        await session.say(text=title, audio=audio_generator(), allow_interruptions=False, add_to_chat_ctx=False)

        logger.info(f"✅ [LOCAL-MP3] Finished playing: {title}")

    except Exception as e:
        logger.error(f"❌ [LOCAL-MP3] Error playing audio: {e}")
        raise


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

    # Create Gemini Realtime model
    realtime_model = NonResumableGeminiRealtimeModel(
        model=gemini_model,
        voice=gemini_voice,
        instructions=agent_prompt,
        temperature=gemini_temperature,
        modalities=["AUDIO"],
    )
    logger.info("Gemini Realtime model created with session resumption disabled")

    # Create ElevenLabs TTS for session.say() with pre-synthesized audio
    # This is needed because realtime models don't have built-in TTS for session.say()
    elevenlabs_voice_id = os.getenv("ELEVENLABS_VOICE_ID", "ecp3DWciuUyW7BYM7II1")
    elevenlabs_tts = elevenlabs.TTS(voice_id=elevenlabs_voice_id)
    logger.info(f"ElevenLabs TTS created with voice: {elevenlabs_voice_id}")

    # Create AgentSession with mode switching, deterministic time/date, and TTS for session.say()
    session_tools = [*MODE_SWITCH_TOOLS, get_time_date]
    session = AgentSession(llm=realtime_model, tts=elevenlabs_tts, tools=session_tools)
    logger.info(
        f"AgentSession created with {len(MODE_SWITCH_TOOLS)} mode switching tools + 1 time/date tool + ElevenLabs TTS"
    )

    # Initialize animal audio service
    animal_audio_service = AnimalAudioService()
    logger.info(f"Animal audio service initialized: {animal_audio_service.sounds_dir}")
    
    # NOTE: BackgroundAudioPlayer is NOT used - it plays on a separate track causing robotic audio
    # All audio (TTS + animal sounds) now plays via session.say() on a single track
    # background_audio = BackgroundAudioPlayer()
    # logger.info("BackgroundAudioPlayer created for animal sounds")

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

    # ============================================================================
    # WATCHDOG: Detect when Gemini silently fails to respond
    # ============================================================================
    WATCHDOG_TIMEOUT_SECONDS = 8  # Time to wait for agent response after user speech
    MAX_WATCHDOG_RECOVERIES = 2  # Max recovery attempts per silence event
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

        # Attempt 1: Ask Gemini to generate a reply
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

        # Attempt 2: Fallback to ElevenLabs TTS
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

    @session.on("user_speech_committed")
    def on_user_speech_watchdog(msg):
        """Start watchdog timer when user speaks"""
        nonlocal _watchdog_task, _watchdog_waiting, _watchdog_recovery_attempts
        _cancel_watchdog()
        _watchdog_waiting = True
        _watchdog_recovery_attempts = 0
        _watchdog_task = asyncio.create_task(_watchdog_timer())
        logger.debug("[WATCHDOG] Timer started (user spoke)")

    @session.on("agent_speech_committed")
    def on_agent_speech_watchdog(msg):
        """Cancel watchdog when agent responds"""
        nonlocal _watchdog_recovery_attempts
        _cancel_watchdog()
        _watchdog_recovery_attempts = 0
        logger.debug("[WATCHDOG] Timer cancelled (agent responded)")

    @session.on("agent_state_changed")
    def on_state_for_watchdog(ev):
        """Cancel watchdog when agent starts speaking"""
        new_state = getattr(ev, 'new_state', None)
        new_state_str = new_state.name.lower() if hasattr(new_state, 'name') else str(new_state)
        if new_state_str == 'speaking':
            _cancel_watchdog()
            logger.debug("[WATCHDOG] Timer cancelled (agent speaking)")

    @session.on("function_calls_started")
    def on_function_calls_watchdog(ev):
        """Cancel watchdog when a tool call starts (not a silent failure)"""
        _cancel_watchdog()
        logger.debug("[WATCHDOG] Timer cancelled (function call in progress)")

    logger.info(f"[WATCHDOG] Enabled ({WATCHDOG_TIMEOUT_SECONDS}s timeout, max {MAX_WATCHDOG_RECOVERIES} recoveries)")

    # ============================================================================
    # IDLE REMINDER: Prompt user if no response for a while
    # ============================================================================
    IDLE_TIMEOUT_SECONDS = 20  # Relaxed vs game workers' 15s (open conversation)
    idle_reminder_task = None
    reminder_count = 0
    MAX_REMINDERS = 3
    waiting_for_user_response = False
    _delivering_reminder = False  # True while _deliver_idle_reminder is running

    IDLE_REMINDER_MESSAGES = [
        "Hey, I'm still here! What would you like to talk about?",
        "Take your time! I'm here whenever you want to chat.",
        "Still there? I'd love to keep talking whenever you're ready!",
    ]

    async def send_idle_reminder():
        """Sleep phase only - cancellable by cancel_idle_timer()"""
        try:
            await asyncio.sleep(IDLE_TIMEOUT_SECONDS)
        except asyncio.CancelledError:
            return  # Timer cancelled during sleep (user spoke, etc.) - that's fine

        # Spawn delivery as separate task so it survives cancel_idle_timer()
        # (the speaking state change from generate_reply triggers cancel_idle_timer,
        #  which would kill this task mid-delivery if we didn't separate them)
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
        reminder_msg = IDLE_REMINDER_MESSAGES[reminder_count % len(IDLE_REMINDER_MESSAGES)]
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

        # Detect user interaction: agent starts speaking from listening state
        # and we're NOT delivering a reminder. This means the user triggered it.
        # (Gemini Realtime may skip 'thinking' and not emit user_speech_committed)
        if new_state_str == 'speaking' and old_state_str == 'listening' and not _delivering_reminder:
            if waiting_for_user_response or reminder_count > 0:
                logger.info(f"[IDLE] User interaction detected (listening->speaking, not reminder) - resetting idle state")
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

    @session.on("user_speech_committed")
    def on_user_speech_idle(msg):
        """Reset idle timer when user speaks"""
        nonlocal waiting_for_user_response
        cancel_idle_timer()
        reset_reminder_count()
        waiting_for_user_response = False

    @session.on("agent_speech_committed")
    def on_agent_speech_idle(msg):
        """Safety net: clear waiting flag if agent_speech_committed fires (may not fire for Gemini Realtime)"""
        nonlocal waiting_for_user_response
        if waiting_for_user_response:
            waiting_for_user_response = False

    @session.on("function_calls_started")
    def on_function_calls_idle_start(ev):
        """Reset idle state when function call starts (definitive proof of user interaction)"""
        nonlocal waiting_for_user_response
        waiting_for_user_response = False
        reset_reminder_count()
        cancel_idle_timer()

    @session.on("function_calls_finished")
    def on_function_calls_idle_finish(ev):
        """Reset idle state after tool execution"""
        nonlocal waiting_for_user_response
        waiting_for_user_response = False
        reset_reminder_count()

    logger.info(f"[IDLE] Enabled ({IDLE_TIMEOUT_SECONDS}s timeout, max {MAX_REMINDERS} reminders)")

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

            # Cancel watchdog and idle timers
            _cancel_watchdog()
            cancel_idle_timer()

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

            # For Gemini Realtime, use generate_reply with instructions
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
                        # Mark agent as listening/processing for LED state
                        await emit_agent_state("listening")

                        if content_type == 'animal' and content_text:
                            # ANIMAL mode: Play TTS description + animal sound
                            # audio_file can be explicit or derived from title (e.g., "Cow" → "cow.mp3")
                            audio_filename = message.get('audio_file', '')
                            if not audio_filename and title:
                                # Derive audio filename from title: "Cow" → "cow.mp3"
                                audio_filename = f"{title.lower().strip().replace(' ', '_')}.mp3"
                                logger.info(f"🐾 [ANIMAL] Derived audio_file from title: {audio_filename}")
                            logger.info(f"🐾 [ANIMAL] Processing animal: {title}, audio_file={audio_filename}")

                            try:
                                # Step 1: Generate and play TTS for the description
                                logger.info(f"📖 [ANIMAL] Step 1: Speaking description for {title}")
                                elevenlabs_svc = get_elevenlabs_service()
                                audio_data, error = await elevenlabs_svc.generate_rhyme_speech(content_text, title)

                                if audio_data and not error:
                                    logger.info(f"🎵 [ANIMAL] Generated {len(audio_data)} bytes of TTS audio")
                                    await emit_agent_state("speaking")
                                    await play_elevenlabs_audio(session, audio_data, title)
                                    await emit_agent_state("listening")
                                    logger.info(f"✅ [ANIMAL] Finished speaking description")
                                else:
                                    # Fallback to Gemini if ElevenLabs fails
                                    logger.warning(f"⚠️ [ANIMAL] ElevenLabs failed: {error}, using Gemini")
                                    await session.generate_reply(instructions=f"Say this: {content_text}")

                                # Step 2: Play the animal sound (if audio_file provided)
                                if audio_filename:
                                    logger.info(f"🔊 [ANIMAL] Step 2: Playing animal sound: {audio_filename}")

                                    # Small pause between TTS and animal sound
                                    await asyncio.sleep(0.5)

                                    # Get the sound file path
                                    sound_path = animal_audio_service.get_animal_sound_path(audio_filename)

                                    if sound_path:
                                        logger.info(f"🎵 [ANIMAL] Playing sound from: {sound_path}")
                                        # Play the animal sound on the SAME track as TTS (no robotic mixing)
                                        await play_local_mp3_audio(session, sound_path, f"{title} sound")
                                        logger.info(f"✅ [ANIMAL] Animal sound playback completed")
                                    else:
                                        logger.warning(f"⚠️ [ANIMAL] Sound file not found: {audio_filename}")
                                else:
                                    logger.info(f"ℹ️ [ANIMAL] No audio_file provided, skipping sound playback")

                            except Exception as animal_error:
                                logger.error(f"❌ [ANIMAL] Error in animal playback: {animal_error}")
                        
                        elif content_type == 'read_only' and content_text:
                            # RAG mode: Use ElevenLabs TTS for high-quality rhyme playback
                            pack_code = message.get('pack_code', '')
                            generate_and_cache = message.get('generate_and_cache', False)
                            notify_firmware = message.get('notify_firmware', False)
                            client_id = message.get('client_id', '')

                            logger.info(f"[RFID-RAG] Generating ElevenLabs audio for: {title}, pack={pack_code}, seq={sequence}, cache={generate_and_cache}")

                            try:
                                # Get ElevenLabs service and generate audio
                                elevenlabs_svc = get_elevenlabs_service()
                                audio_data, error = await elevenlabs_svc.generate_rhyme_speech(content_text, title)

                                if audio_data and not error:
                                    logger.info(f"[RFID-RAG] ElevenLabs audio generated: {len(audio_data)} bytes")

                                    # Cache to S3 if requested (async, don't block playback)
                                    if generate_and_cache and pack_code and sequence:
                                        async def cache_and_notify():
                                            try:
                                                rhyme_cache = get_rhyme_cache_service()
                                                url = await rhyme_cache.cache_rhyme_audio(audio_data, pack_code, sequence)
                                                if url:
                                                    logger.info(f"[RHYME-CACHE] Cached: {url}")

                                                    # Notify firmware that URL is ready via data channel
                                                    if notify_firmware and client_id:
                                                        notification = {
                                                            "type": "rhyme_cached",
                                                            "pack_code": pack_code,
                                                            "sequence": sequence,
                                                            "audio_url": url,
                                                            "title": title,
                                                            "client_id": client_id
                                                        }
                                                        await ctx.room.local_participant.publish_data(
                                                            json.dumps(notification).encode('utf-8'),
                                                            reliable=True
                                                        )
                                                        logger.info(f"[RHYME-CACHE] Notified firmware: {url}")
                                            except Exception as cache_err:
                                                logger.error(f"[RHYME-CACHE] Error: {cache_err}")

                                        asyncio.create_task(cache_and_notify())

                                    # Play audio using session.say with pre-synthesized frames
                                    await emit_agent_state("speaking")
                                    await play_elevenlabs_audio(session, audio_data, title)
                                    await emit_agent_state("listening")
                                    logger.info(f"[RFID-RAG] Finished playing rhyme: {title}")
                                else:
                                    # Fallback to Gemini if ElevenLabs fails
                                    logger.warning(f"[RFID-RAG] ElevenLabs failed: {error}, falling back to Gemini")
                                    read_instruction = f"Recite this nursery rhyme in a sweet voice for a child: {content_text}"
                                    await session.generate_reply(instructions=read_instruction)

                            except Exception as tts_error:
                                logger.error(f"[RFID-RAG] ElevenLabs error: {tts_error}, falling back to Gemini")
                                read_instruction = f"Recite this nursery rhyme in a sweet voice for a child: {content_text}"
                                await session.generate_reply(instructions=read_instruction)
                        else:
                            # Prompt mode: Send to Gemini for generation (current behavior)
                            logger.info(f"🤖 [RFID-PROMPT] Sending to Gemini: {text[:100]}...")
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
