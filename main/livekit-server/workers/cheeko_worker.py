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
    # BackgroundAudioPlayer,  # NOT used - causes separate audio track (robotic sound)
)
from livekit import rtc, api
from livekit.plugins import groq as groq_plugin
import io
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
from src.features.openclaw_tools import OPENCLAW_TOOLS
from src.memory import get_memory_service, MEMORY_TOOLS
from src.utils.quota_manager import QuotaManager

# Agent configuration
AGENT_NAME = "cheeko-agent"

# Keywords that trigger context-aware memory search (high-value triggers only)
# These are patterns where memory injection provides significant value
MEMORY_TRIGGER_PATTERNS = [
    ("story", ["story about", "tell me a story", "tell a story"]),  # Story requests
    ("remember", ["do you remember", "remember my", "remember when", "about me", "tell me about me", "you know me", "know about me", "know my name"]),  # Memory queries
    ("family", ["about my", "my dog", "my cat", "my pet", "my brother", "my sister", "my mom", "my dad", "my family"]),  # Family/pet references
    ("question", ["what's my", "who is my", "what is my", "what do you know"]),  # Direct memory questions
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
# Combine mode switching, OpenClaw tools, and memory tools
ALL_AGENT_TOOLS = MODE_SWITCH_TOOLS + OPENCLAW_TOOLS + MEMORY_TOOLS

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
    """Prewarm - preload embedding model so first session is fast"""
    # Preload the sentence-transformers embedding model (~16s cold load)
    # This runs BEFORE any session starts, so the first child doesn't wait
    try:
        from src.utils.model_cache import model_cache
        model_cache.get_embedding_model("all-MiniLM-L6-v2")
        logger.info("[PREWARM] Embedding model preloaded")
    except Exception as e:
        logger.warning(f"[PREWARM] Failed to preload embedding model: {e}")

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

    # Initialize self-hosted memory service
    memory_config = ConfigLoader.get_memory_config()
    memory_service = get_memory_service(memory_config)

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
                    quota_manager.initialize(),
                    return_exceptions=True
                )
                agent_id_result, prompt_config_result = results[0], results[1]
                child_profile_result = dispatch_child_profile
            else:
                results = await asyncio.gather(
                    db_helper.get_agent_id(device_mac),
                    prompt_service.get_prompt_and_config(room_name, device_mac),
                    db_helper.get_child_profile_by_mac(device_mac),
                    quota_manager.initialize(),
                    return_exceptions=True
                )
                agent_id_result, prompt_config_result, child_profile_result = results[0], results[1], results[2]

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

    # Memory initialization runs in background AFTER session starts (see below)
    # This avoids blocking agent startup with the 90s embedding model load

    # Render prompt with child profile
    # Debug: Check if prompt template has child_name placeholder
    has_placeholder = '{{' in agent_prompt or '{%' in agent_prompt
    has_child_name = 'child_name' in agent_prompt
    logger.info(f"Template analysis - Has Jinja: {has_placeholder}, Has child_name: {has_child_name}")

    if child_profile:
        agent_prompt = render_prompt_with_profile(
            agent_prompt, child_profile, dispatch_memories, dispatch_relations, dispatch_entities
        )

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
    from src.utils.realtime_factory import create_realtime_model
    realtime_model, audio_sample_rate, provider_tools = create_realtime_model(
        instructions=agent_prompt,
        enable_google_search=True,
    )

    # Create Groq TTS for session.say() with pre-synthesized audio
    # This is needed because realtime models don't have built-in TTS for session.say()
    groq_tts = groq_plugin.TTS(model="canopylabs/orpheus-v1-english", voice="autumn")
    logger.info("Groq TTS created (model=canopylabs/orpheus-v1-english, voice=autumn)")

    # Create AgentSession with all tools (agent tools + provider tools like GoogleSearch)
    # Provider tools (e.g. GoogleSearch) are now passed via AgentSession in SDK v1.4+
    # userdata must be passed in constructor (v1.3+ raises ValueError if set after creation)
    all_tools = ALL_AGENT_TOOLS + provider_tools
    session = AgentSession(
        llm=realtime_model,
        tts=groq_tts,
        tools=all_tools,
        userdata={"device_mac": device_mac or ""},
    )
    logger.info(f"AgentSession created with {len(all_tools)} tools ({len(ALL_AGENT_TOOLS)} agent + {len(provider_tools)} provider) + ElevenLabs TTS")

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

    @session.on("user_input_transcribed")
    def on_user_speech(ev):
        """Log what the user said and inject memory context if relevant"""
        if not ev.is_final or _quota_session_ending:
            return
        nonlocal memory_injection_in_progress, last_memory_injection_time

        text = ev.transcript
        logger.info(f"🎤 USER SAID: '{text}'")

        # Skip memory injection if one is already in progress or happened recently
        current_time = time.time()
        if memory_injection_in_progress or (current_time - last_memory_injection_time) < 5:
            logger.debug(f"[MEMORY] Skipping memory check - recent injection or in progress")
            return

        # Check if this message should trigger memory injection
        inject, category = should_inject_memory(text)

        if inject and device_mac and memory_service.is_ready():
            logger.info(f"[MEMORY] Memory trigger detected: category='{category}'")
            memory_injection_in_progress = True
            last_memory_injection_time = current_time
            # Search for relevant memories and inject context
            asyncio.create_task(inject_memory_context(text, device_mac, category))

    async def inject_memory_context(user_query: str, mac_address: str, category: str):
        """Search for relevant memories and inject them into the conversation"""
        nonlocal memory_injection_in_progress

        try:
            # Small delay to let any automatic response start
            await asyncio.sleep(0.3)

            # Search for memories relevant to what the user just said
            relevant_memories = await memory_service.search(
                mac=mac_address,
                query=user_query,
                limit=3
            )

            if relevant_memories:
                logger.info(f"[MEMORY-INJECT] Found {len(relevant_memories)} relevant memories for '{category}': '{user_query[:30]}...'")

                # Format the memory context
                memory_context = memory_service.format_memories_for_injection(
                    user_query, relevant_memories
                )

                # For high-value triggers like stories, inject with generate_reply
                if category in ["story", "remember", "question"]:
                    try:
                        logger.info(f"[MEMORY-INJECT] Injecting memory context for {category} request")
                        await session.generate_reply(
                            instructions=f"{memory_context}\n\nRespond to the child's request: '{user_query}'"
                        )
                        logger.info(f"[MEMORY-INJECT] Memory context injected successfully")
                    except Exception as gen_err:
                        logger.debug(f"[MEMORY-INJECT] Could not inject (model may be responding): {gen_err}")
                else:
                    logger.info(f"[MEMORY-INJECT] Relevant memories available for '{category}' - relying on prompt")
            else:
                logger.debug(f"[MEMORY-INJECT] No relevant memories found for: '{user_query[:30]}...'")

        except Exception as e:
            logger.error(f"[MEMORY-INJECT] Error searching memories: {e}")
        finally:
            memory_injection_in_progress = False

    @session.on("function_tools_executed")
    def on_function_tools_executed(ev):
        """Log when function tools are executed"""
        logger.info(f"🔧 FUNCTION TOOLS EXECUTED: {len(ev.function_calls)} call(s)")

    logger.info("📊 Debug logging for speech and function calls enabled")

    # ============================================================================
    # QUOTA: Track per-turn usage and enforce limits
    # ============================================================================
    _quota_session_ending = False  # Flag to block further interaction after exhaustion

    @session.on("user_input_transcribed")
    def on_user_speech_quota(ev):
        """Consume a question from quota on each final user speech turn"""
        if not ev.is_final or _quota_session_ending:
            return
        async def _check_quota():
            nonlocal _quota_session_ending
            try:
                allowed, remaining = await quota_manager.consume_question()
                if not allowed:
                    _quota_session_ending = True
                    logger.warning(f"[QUOTA] Exhausted mid-session for {device_mac}")
                    limit_msg = quota_manager.get_limit_message()
                    try:
                        logger.info(f"[QUOTA] Saying limit message via generate_reply")
                        await session.generate_reply(
                            instructions=f"Say exactly this to the child: '{limit_msg}'"
                        )
                        # Wait for Gemini to finish speaking
                        await asyncio.sleep(10)
                    except Exception as e:
                        logger.error(f"[QUOTA] generate_reply failed: {e}")
                    # Close session gracefully before deleting room
                    try:
                        await session.aclose()
                    except Exception:
                        pass
                    await asyncio.sleep(1)
                    await delete_livekit_room(room_name)
                elif quota_manager.should_warn_low_quota():
                    logger.info(f"[QUOTA] Low quota warning: {remaining} remaining")
                    await session.generate_reply(
                        instructions=quota_manager.get_low_quota_instruction()
                    )
            except Exception as e:
                logger.error(f"[QUOTA] Error in quota check: {e}")
        asyncio.create_task(_check_quota())

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

    @session.on("user_input_transcribed")
    def on_user_speech_watchdog(ev):
        """Start watchdog timer when user finishes speaking"""
        if not ev.is_final or _quota_session_ending:
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
        # (Realtime models go directly listening->speaking without 'thinking')
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
        waiting_for_user_response = False
        reset_reminder_count()
        cancel_idle_timer()

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
    
    # Set device MAC for OpenClaw tools
    from src.features.openclaw_tools import set_device_mac
    set_device_mac(device_mac)
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

            # Extract and send chat history before closing session
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

    async def _deliver_quota_limit_and_disconnect():
        """Deliver quota limit message using the same session.generate_reply() as greeting,
        then disconnect. Called from ready_for_greeting when quota is exhausted."""
        nonlocal _quota_session_ending
        _quota_session_ending = True
        limit_msg = quota_manager.get_limit_message()

        # Try to import RealtimeError, fallback to Exception if not available
        try:
            from livekit.agents.llm.realtime import RealtimeError
        except ImportError:
            RealtimeError = Exception

        # Retry logic matching play_greeting() pattern in base_assistant.py
        max_retries = 3
        delivered = False
        for attempt in range(max_retries):
            try:
                logger.info(f"[QUOTA] Delivering limit message via session.generate_reply() (attempt {attempt + 1}/{max_retries})")
                await session.generate_reply(
                    instructions=f"Say exactly this to the child: '{limit_msg}'"
                )
                delivered = True
                logger.info("[QUOTA] Limit message delivered successfully")
                # Wait for Gemini to finish speaking
                await asyncio.sleep(10)
                break  # Success, exit retry loop
            except RealtimeError as e:
                logger.warning(f"[QUOTA] Attempt {attempt + 1} encountered RealtimeError: {e}")
                if attempt < max_retries - 1:
                    await asyncio.sleep(0.5)
            except Exception as e:
                logger.warning(f"[QUOTA] Attempt {attempt + 1} failed: {e}")
                if attempt < max_retries - 1:
                    await asyncio.sleep(1.0)
                else:
                    logger.error(f"[QUOTA] Failed to deliver limit message after {max_retries} attempts")

        # Clean up
        try:
            await session.aclose()
        except Exception:
            pass
        await asyncio.sleep(1)
        await delete_livekit_room(room_name)

    @ctx.room.on("data_received")
    def on_data_received(data_packet: rtc.DataPacket):
        """Handle data channel messages from gateway"""
        try:
            message = json.loads(data_packet.data.decode('utf-8'))
            msg_type = message.get('type')

            # Handle greeting trigger from device
            if msg_type == 'ready_for_greeting':
                if quota_manager.is_exhausted:
                    logger.info("🎤 Device ready but quota exhausted - delivering limit message")
                    asyncio.create_task(_deliver_quota_limit_and_disconnect())
                    return
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

            # Handle text input forwarded from MQTT gateway (RFID text or reminders)
            # Supports RAG system with read_only content and legacy prompt mode
            if msg_type == 'user_text':
                # Check if this is a reminder notification (not a request to set one)
                source = message.get('source', '')
                text = (message.get('text') or '').strip()
                
                if source == 'reminder' and text.startswith('Reminder:'):
                    # This is a reminder notification - announce it directly
                    reminder_text = text.replace('Reminder:', '').strip()
                    logger.info(f"🔔 [REMINDER] Announcing reminder: {reminder_text}")
                    
                    # Generate a natural reminder announcement
                    reminder_prompt = f"Announce this reminder to the user in a friendly, natural way: '{reminder_text}'. Keep it brief and cheerful!"
                    asyncio.create_task(session.generate_reply(instructions=reminder_prompt))
                    return
                
                # Extract RAG content fields first (needed for validation)
                content_type = message.get('content_type', 'prompt')  # "animal", "read_only", or "prompt"
                title = message.get('title', '')
                content_text = message.get('content_text', '')
                sequence = message.get('sequence')
                rfid_uid = message.get('rfid_uid', '')

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
                            await session.generate_reply(user_input=text)
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

    # Initialize memory in background (embedding model load can take 90s on first run)
    # This runs AFTER the session is live so the child can start talking immediately
    # After init, loads memory context and updates the agent's instructions via update_agent()
    async def _init_memory_background():
        try:
            if device_mac and memory_service.is_ready():
                await memory_service.initialize(device_mac, child_profile)
                logger.info(f"[MEMORY] Device initialized in background")

                # Load memory context and inject into the live session
                try:
                    context = await memory_service.load_context(device_mac)
                    memories = context.get("long_term_memories", [])
                    today_log = context.get("today_context", "")

                    memory_block = ""
                    if memories:
                        memory_block += "\n\n## What you know about this child (from past conversations):\n"
                        for mem in memories:
                            memory_block += f"- {mem}\n"

                    if today_log:
                        memory_block += f"\n## Today's conversation log:\n{today_log}\n"

                    if memory_block:
                        # Use the proper async API to update instructions on the live realtime session
                        updated_instructions = (assistant.instructions or "") + memory_block
                        await assistant.update_instructions(updated_instructions)
                        logger.info(f"[MEMORY] Injected {len(memories)} memories + today's log into live agent instructions")
                    else:
                        logger.info(f"[MEMORY] No existing memories to inject for this device")
                except Exception as ctx_e:
                    logger.warning(f"[MEMORY] Failed to load/inject context: {ctx_e}")
        except Exception as e:
            logger.warning(f"[MEMORY] Background init failed: {e}")

    asyncio.create_task(_init_memory_background())

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
