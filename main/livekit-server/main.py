"""
Simplified LiveKit Agent for Cheeko
Focused on conversation mode with PTT support
Stripped down from full-featured implementation to core functionality
"""

import os
import logging
import asyncio
import json
import time
import threading
import aiohttp
from datetime import datetime
from dotenv import load_dotenv

# Note: ResourceMonitor removed for faster startup and lower overhead

from livekit.agents import (
    AgentSession,
    JobContext,
    JobProcess,
    WorkerOptions,
    cli,
    Agent,
    AutoSubscribe,
    RoomInputOptions,
)
from livekit import rtc, api
from livekit.plugins import google
from google.genai import types

# Load environment variables first
load_dotenv(".env")
print(f"🔍 DEBUG: LIVEKIT_URL={os.getenv('LIVEKIT_URL')}")

# Datadog removed for faster startup - using Loki instead

# Import required components
from src.config.config_loader import ConfigLoader
from src.utils.database_helper import DatabaseHelper
from src.services.prompt_service import PromptService
from src.services.music_service import MusicService
# Device control services moved to lazy imports for faster startup
# from src.mcp.device_control_service import DeviceControlService
# from src.mcp.mcp_executor import LiveKitMCPExecutor
# ChatEventHandler removed - disabled and not used
# from src.handlers.chat_logger import ChatEventHandler
# Usage tracking moved to lazy import
# from src.utils.helpers import UsageManager
# Chat history moved to lazy import
# from src.services.chat_history_service import ChatHistoryService
# FilteredAgent removed for faster response time - using built-in Agent

# Logger (Loki only - Datadog removed for faster startup)
from src.utils.loki_agent_logger import logger

# Global Jinja2 template cache for faster rendering
_jinja_template_cache = {}

# Game prompt file mapping
_GAME_PROMPT_FILES = {
    "Math Tutor": "math_tutor.yaml",
    "Riddle Solver": "riddle_solver.yaml",
    "Word Ladder": "word_ladder.yaml"
}

def _load_game_prompt(agent_name: str, child_profile: dict = None) -> str:
    """
    Load game-specific prompt from YAML file and render with child profile.
    
    Args:
        agent_name: The game name ("Math Tutor", "Riddle Solver", "Word Ladder")
        child_profile: Optional child profile for personalization
        
    Returns:
        str: Rendered prompt or None if file not found
    """
    import os
    import yaml
    from jinja2 import Template
    
    if agent_name not in _GAME_PROMPT_FILES:
        logger.warning(f"⚠️ Unknown game: {agent_name}")
        return None
    
    # Get the prompt file path
    prompt_file = os.path.join(
        os.path.dirname(__file__), 
        "src", "prompts", 
        _GAME_PROMPT_FILES[agent_name]
    )
    
    try:
        if not os.path.exists(prompt_file):
            logger.error(f"❌ Game prompt file not found: {prompt_file}")
            return None
            
        with open(prompt_file, 'r') as f:
            prompt_data = yaml.safe_load(f)
        
        prompt_template = prompt_data.get('prompt', '')
        
        if not prompt_template:
            logger.error(f"❌ No 'prompt' key in {prompt_file}")
            return None
        
        # Render with child profile if available
        if child_profile and ('{{' in prompt_template or '{%' in prompt_template):
            template = Template(prompt_template)
            template_vars = {
                'child_name': child_profile.get('name', ''),
                'child_age': child_profile.get('age', ''),
                'child_interests': child_profile.get('interests', ''),
                'age_group': child_profile.get('ageGroup', ''),
            }
            prompt_template = template.render(**template_vars)
        
        logger.info(f"✅ Loaded game prompt: {agent_name} ({len(prompt_template)} chars)")
        return prompt_template
        
    except Exception as e:
        logger.error(f"❌ Error loading game prompt: {e}")
        import traceback
        logger.error(traceback.format_exc())
        return None

# ============================================================================
# RESOURCE MONITOR - REMOVED
# ============================================================================
# ResourceMonitor removed for faster startup and lower CPU overhead
# Use external monitoring (Datadog, Cloud Run metrics) instead


# ============================================================================
# ROOM DELETION
# ============================================================================

async def delete_livekit_room(room_name: str):
    """Delete a LiveKit room using the API"""
    try:
        livekit_url = os.getenv("LIVEKIT_URL", "").replace(
            "ws://", "http://").replace("wss://", "https://")
        api_key = os.getenv("LIVEKIT_API_KEY")
        api_secret = os.getenv("LIVEKIT_API_SECRET")

        if not all([livekit_url, api_key, api_secret]):
            logger.warning("LiveKit credentials not configured for room deletion")
            return

        lk_api = api.LiveKitAPI(
            url=livekit_url,
            api_key=api_key,
            api_secret=api_secret,
        )

        from livekit.api import DeleteRoomRequest
        request = DeleteRoomRequest(room=room_name)
        await lk_api.room.delete_room(request)
        logger.info(f"🗑️ Successfully deleted room: {room_name}")

    except Exception as e:
        logger.error(f"Failed to delete room: {e}")


# ============================================================================
# ASSISTANT - Now using refactored modular architecture
# ============================================================================

from src.agent.assistant import Assistant


# ============================================================================
# PREWARM
# ============================================================================

def prewarm(proc: JobProcess):
    """Minimal prewarm for Gemini Realtime"""
    logger.info("[PREWARM] Prewarm: Ready for Gemini Realtime")
    proc.userdata["ready"] = True


# ============================================================================
# ENTRYPOINT
# ============================================================================

async def entrypoint(ctx: JobContext):
    """Simplified entrypoint for conversation mode"""

    # Ensure GOOGLE_API_KEY is available
    yaml_config = ConfigLoader.load_yaml_config()
    api_keys = yaml_config.get('api_keys', {})
    if 'google' in api_keys and not os.getenv('GOOGLE_API_KEY'):
        os.environ['GOOGLE_API_KEY'] = api_keys['google']
        logger.info("🔑 Loaded GOOGLE_API_KEY from config.yaml")

    ctx.log_context_fields = {"room": ctx.room.name}
    logger.info(f"Starting simplified agent in room: {ctx.room.name}")

    # Track initialization time
    init_start_time = asyncio.get_event_loop().time()

    # Resource monitoring removed - use Cloud Run metrics instead

    # Load configuration
    realtime_config = ConfigLoader.get_gemini_realtime_config()
    gemini_model = realtime_config.get('model', 'gemini-live-2.5-flash-native-audio')   
    # gemini-2.5-flash-native-audio-preview-09-2025
    gemini_voice = realtime_config.get('voice', 'Zephyr')
    gemini_temperature = realtime_config.get('temperature', 0.8)

    # Parse room name to extract MAC address and room type
    room_name = ctx.room.name
    device_mac = None
    room_type = None

    if '_' in room_name:
        parts = room_name.split('_')
        if len(parts) >= 3:
            room_type = parts[-1]
            mac_part = parts[-2]
            if len(mac_part) == 12 and mac_part.isalnum():
                device_mac = ':'.join(mac_part[i:i+2] for i in range(0, 12, 2))
                logger.info(f"📱 Extracted: MAC={device_mac}, Room Type={room_type}")
        elif len(parts) >= 2:
            mac_part = parts[-1]
            if len(mac_part) == 12 and mac_part.isalnum():
                device_mac = ':'.join(mac_part[i:i+2] for i in range(0, 12, 2))
                room_type = "conversation"
                logger.info(f"📱 Extracted MAC from legacy room: {device_mac}")

    # Extract room type for mode-specific handling
    # Music mode will trigger auto-play, conversation mode uses standard agent
    if room_type:
        logger.info(f"🎯 Room mode detected: {room_type}")

    # Initialize services
    prompt_service = PromptService()
    agent_prompt = ConfigLoader.get_default_prompt()
    child_profile = None
    agent_id = None  # Initialize here to avoid UnboundLocalError

    if device_mac:
        try:
            logger.info("⚡ Starting parallel API calls...")
            start_time = asyncio.get_event_loop().time()

            manager_api_url = os.getenv("MANAGER_API_URL")
            manager_api_secret = os.getenv("MANAGER_API_SECRET")
            db_helper = DatabaseHelper(manager_api_url, manager_api_secret)

            # Clear prompt cache for fresh session
            prompt_service.clear_cache()
            prompt_service.clear_enhanced_cache(device_mac)

            # Parallel API calls (4 calls including agent_name for game detection)
            results = await asyncio.gather(
                db_helper.get_agent_id(device_mac),
                prompt_service.get_prompt_and_config(room_name, device_mac),
                db_helper.get_child_profile_by_mac(device_mac),
                db_helper.get_agent_name(device_mac),  # For game mode detection
                return_exceptions=True
            )

            elapsed_time = (asyncio.get_event_loop().time() - start_time) * 1000
            logger.info(f"⚡✅ Parallel API calls completed in {elapsed_time:.0f}ms")

            # Unpack results (4 results now)
            agent_id_result, prompt_config_result, child_profile_result, agent_name_result = results

            # Process agent_id
            agent_id = None
            if isinstance(agent_id_result, Exception):
                logger.error(f"Failed to get agent_id: {agent_id_result}")
            else:
                agent_id = agent_id_result
                logger.info(f"📝 Agent ID: {agent_id}")

            # Process agent_name (for game mode detection)
            agent_name = "Cheeko"  # Default
            if isinstance(agent_name_result, Exception):
                logger.warning(f"Failed to get agent_name: {agent_name_result}")
            else:
                agent_name = agent_name_result or "Cheeko"
                logger.info(f"🎮 Agent name: {agent_name}")
            
            # Store agent_name in ctx for later use
            ctx.agent_name = agent_name

            # Process prompt - check if we need game-specific prompt
            if agent_name in ["Math Tutor", "Riddle Solver", "Word Ladder"]:
                # Load game-specific prompt from YAML file
                game_prompt = _load_game_prompt(agent_name, child_profile_result)
                if game_prompt:
                    agent_prompt = game_prompt
                    logger.info(f"🎮 Loaded {agent_name} game prompt ({len(agent_prompt)} chars)")
                else:
                    # Fallback to default if game prompt not found
                    logger.warning(f"⚠️ Failed to load {agent_name} prompt, using default")
                    if isinstance(prompt_config_result, Exception):
                        agent_prompt = ConfigLoader.get_default_prompt()
                    else:
                        agent_prompt, _ = prompt_config_result
            else:
                # Normal Cheeko mode - use regular prompt
                if isinstance(prompt_config_result, Exception):
                    logger.warning(f"Failed to fetch config: {prompt_config_result}")
                    agent_prompt = ConfigLoader.get_default_prompt()
                else:
                    agent_prompt, _ = prompt_config_result  # Ignore TTS config (Gemini has built-in TTS)
                    logger.info(f"🎯 Using device-specific prompt (length: {len(agent_prompt)} chars)")

            # Process child profile
            if isinstance(child_profile_result, Exception):
                logger.warning(f"Failed to fetch child profile: {child_profile_result}")
            else:
                child_profile = child_profile_result
                if child_profile:
                    logger.info(f"👶 Child profile: {child_profile.get('name')}, age {child_profile.get('age')}")

        except Exception as e:
            logger.error(f"❌ Error in API calls: {e}")
            agent_prompt = ConfigLoader.get_default_prompt()

        # Chat history service will be initialized in background after session starts

    # Build prompt with child profile using cached Jinja2 templates
    if child_profile:
        logger.info(f"👶 Child profile data: {json.dumps(child_profile, indent=2)}")

        # Check if prompt uses Jinja2 templates ({{ or {%)
        if '{{' in agent_prompt or '{%' in agent_prompt:
            try:
                from jinja2 import Template

                # Use cached template if available
                template_cache_key = hash(agent_prompt)
                if template_cache_key not in _jinja_template_cache:
                    _jinja_template_cache[template_cache_key] = Template(agent_prompt)
                    logger.info("📝 Compiled and cached Jinja2 template")
                else:
                    logger.info("⚡ Using cached Jinja2 template")

                template = _jinja_template_cache[template_cache_key]

                # Build template variables from child profile
                # Parse interests if it's a JSON string
                interests = child_profile.get('interests', '')
                if isinstance(interests, str) and interests.startswith('['):
                    try:
                        interests_list = json.loads(interests)
                        interests = ', '.join(interests_list)
                    except json.JSONDecodeError:
                        pass

                template_vars = {
                    'child_name': child_profile.get('name', ''),
                    'child_age': child_profile.get('age', ''),
                    'age_group': child_profile.get('ageGroup', ''),
                    'child_gender': child_profile.get('gender', ''),
                    'child_interests': interests,
                    'primary_language': child_profile.get('primaryLanguage', 'English'),
                    'additional_notes': child_profile.get('additionalNotes', ''),
                }

                agent_prompt = template.render(**template_vars)
                logger.info(f"✅ Rendered template for: {child_profile.get('name')}")

            except Exception as e:
                logger.error(f"❌ Jinja2 template error: {e}")
                # Fallback to simple string replacement
                agent_prompt = agent_prompt.replace("{{ child_name }}", child_profile.get('name', ''))
                agent_prompt = agent_prompt.replace("{{child_name}}", child_profile.get('name', ''))
                agent_prompt = agent_prompt.replace("{{ child_age }}", str(child_profile.get('age', '')))
                agent_prompt = agent_prompt.replace("{{child_age}}", str(child_profile.get('age', '')))
        else:
            logger.info(f"📝 Prompt has no template variables - using as-is")
    else:
        logger.warning("⚠️ No child profile available - prompt will not be personalized")

    # Log prompt info for debugging
    logger.info(f"📝 Final prompt length: {len(agent_prompt)} chars")
    if '{{' in agent_prompt or '{%' in agent_prompt:
        logger.warning("⚠️ Prompt still contains unrendered template variables!")
    else:
        logger.info("✅ Prompt fully rendered (no template variables remaining)")

    # ============================================================================
    # GEMINI REALTIME MODEL SETUP
    # ============================================================================

    # logger.info(f"🎙️ Initializing Gemini Realtime (model: {gemini_model}, voice: {gemini_voice})...")

    # Google Search grounding
    # google_search_grounding = types.GoogleSearch()
    # logger.info("🔍 Google Search grounding enabled")

    # Create Gemini Realtime model - NO custom VAD config (use Gemini's default for faster response)
    # This matches the fast test project (gemini_live-api-livekit/agent.py)
    realtime_model = google.realtime.RealtimeModel(
        model=gemini_model,
        voice=gemini_voice,
        instructions=agent_prompt,
        temperature=gemini_temperature,
        modalities=["AUDIO"],
        # realtime_input_config={
        #     "automatic_activity_detection": {
        #         "disabled": False,
        #         "start_of_speech_sensitivity": types.StartSensitivity.START_SENSITIVITY_HIGH,
        #         "end_of_speech_sensitivity": types.EndSensitivity.END_SENSITIVITY_HIGH,
        #         "prefix_padding_ms": 100, # Increased for a softer start
        #         "silence_duration_ms": 300, # Increased to allow for longer pauses
        #     }
        # }
    )

    logger.info(f"✅ Gemini Realtime model created")

    # ============================================================================
    # DETERMINE GAME TOOLS BEFORE SESSION CREATION
    # ============================================================================
    
    # Determine game tools based on agent_name (we need these for AgentSession)
    game_tools_list = []
    if hasattr(ctx, 'agent_name') and ctx.agent_name:
        active_game = ctx.agent_name
    else:
        active_game = "Cheeko"  # Default
    
    # Store active_game back to ctx for later use
    ctx.active_game = active_game
        
    if active_game in ["Math Tutor", "Riddle Solver", "Word Ladder"]:
        # Import game tools
        from src.features.game_tools import (
            check_math_answer,
            check_riddle_answer,
            validate_word_ladder_move,
            set_math_game_state,
            set_riddle_game_state,
            set_word_ladder_state
        )
        
        if active_game == "Math Tutor":
            game_tools_list = [check_math_answer]
            logger.info("🧮 Math Tutor tool prepared for session")
        elif active_game == "Riddle Solver":
            game_tools_list = [check_riddle_answer]
            logger.info("🤔 Riddle Solver tool prepared for session")
        elif active_game == "Word Ladder":
            game_tools_list = [validate_word_ladder_move]
            logger.info("🎮 Word Ladder tool prepared for session")

    # Create AgentSession with game tools if applicable
    session_kwargs = {
        "llm": realtime_model,
    }
    
    if game_tools_list:
        session_kwargs["tools"] = game_tools_list
        logger.info(f"🎮 Creating AgentSession with {len(game_tools_list)} game tools")
    
    session = AgentSession(**session_kwargs)

    # ============================================================================
    # STATE MANAGEMENT FOR LED FEEDBACK
    # ============================================================================

    current_state = "idle"
    last_state_change_time = 0.0
    STATE_DEBOUNCE_MS = 350

    async def emit_agent_state(new_state: str):
        """Emit agent state via data channel for LED feedback"""
        nonlocal current_state, last_state_change_time

        try:
            current_time = time.time() * 1000
            if current_time - last_state_change_time < STATE_DEBOUNCE_MS:
                return

            if new_state == current_state:
                return

            old_state = current_state
            current_state = new_state
            last_state_change_time = current_time

            payload = json.dumps({
                "type": "agent_state_changed",
                "data": {"old_state": old_state, "new_state": new_state},
            })

            await ctx.room.local_participant.publish_data(
                payload.encode("utf-8"), reliable=True
            )
            logger.info(f"📊 State: {old_state} → {new_state}")
        except Exception as e:
            logger.error(f"Failed to emit state: {e}")

    async def emit_speech_created(text: str = ""):
        """Emit speech_created event for TTS start"""
        try:
            payload = json.dumps({
                "type": "speech_created",
                "data": {"text": text},
            })
            await ctx.room.local_participant.publish_data(
                payload.encode("utf-8"), reliable=True
            )
            logger.info("📢 speech_created event emitted")
        except Exception as e:
            logger.error(f"Failed to emit speech_created: {e}")

    @session.on("agent_state_changed")
    def on_agent_state_changed_for_tts(ev):
        """Emit speech_created when agent starts speaking"""
        try:
            old_state = getattr(ev, 'old_state', None)
            new_state = getattr(ev, 'new_state', None)
            logger.info(f"🔊 EVENT: agent_state_changed - {old_state} → {new_state}")

            if new_state == 'speaking' and old_state != 'speaking':
                logger.info(f"📢 Emitting speech_created (state: {old_state} → speaking)")
                asyncio.create_task(emit_speech_created())

        except Exception as e:
            logger.error(f"❌ Error in agent_state_changed handler: {e}")

    logger.info("📊 State management registered")

    # ============================================================================
    # ERROR HANDLING (Simplified)
    # ============================================================================

    # Error handling will be lazy-loaded when needed
    # Gemini Live API has built-in error handling
    error_manager = None
    try:
        from src.agent.error_handler import setup_error_handling
        error_manager = setup_error_handling(
            session=session,
            max_retries=3,
            custom_audio_path=None
        )
        logger.info("🛡️ Error handling enabled")
    except Exception as e:
        logger.warning(f"⚠️ Error handler not available: {e} - using default error handling")

    # ============================================================================
    # DEVICE CONTROL SERVICE (Lazy-loaded)
    # ============================================================================

    # Device control services are now lazy-loaded via Assistant properties
    # They will be initialized only when first accessed
    logger.info("🎛️ Device control services set to lazy-load on first use")

    # ============================================================================
    # MUSIC SERVICE (Async initialization)
    # ============================================================================
    
    music_service = MusicService()
    asyncio.create_task(music_service.initialize())
    logger.info("🎵 Music service initialized (async)")
    
    # ============================================================================
    # CREATE ASSISTANT
    # ============================================================================

    assistant = Assistant(instructions=agent_prompt)
    assistant.set_room_info(room_name=ctx.room.name, device_mac=device_mac)
    logger.info("✅ Lightweight Assistant initialized")
    
    # Initialize UnifiedAudioPlayer for music/story playback
    from src.services.unified_audio_player import UnifiedAudioPlayer
    audio_player = UnifiedAudioPlayer()
    audio_player.set_context(ctx)
    assistant.audio_player = audio_player
    logger.info("🎵 UnifiedAudioPlayer initialized and attached to Assistant")
    # ============================================================================
    # ENABLE FEATURES (Lazy-loaded modules)
    # ============================================================================
    
    # Enable device control features
    assistant.enable_battery_tools()
    assistant.enable_volume_tools()
    logger.info("🎛️ Device control features enabled")
    
    # Enable mode switching
    assistant.enable_mode_switching()
    logger.info("🔄 Mode switching feature enabled")
    
    # Initialize game states based on active_game (tools already passed to AgentSession)
    active_game = getattr(ctx, 'active_game', 'Cheeko')
        
    if active_game in ["Math Tutor", "Riddle Solver", "Word Ladder"]:
        # Initialize the appropriate game state and connect to tools
        if active_game == "Math Tutor":
            assistant.enable_math_game()
            from src.features.game_tools import set_math_game_state
            set_math_game_state(assistant.math_game_state)
            logger.info("🧮 Math Tutor state initialized and connected to tools")
        elif active_game == "Riddle Solver":
            assistant.enable_riddle_game()
            from src.features.game_tools import set_riddle_game_state
            set_riddle_game_state(assistant.riddle_game_state)
            logger.info("🤔 Riddle Solver state initialized and connected to tools")
        elif active_game == "Word Ladder":
            assistant.enable_word_ladder_game()
            from src.features.game_tools import set_word_ladder_state
            set_word_ladder_state(assistant.word_ladder_state)
            logger.info("🎮 Word Ladder state initialized and connected to tools")
        
        logger.info(f"🎮 Game mode active: {active_game}")
    else:
        # Not a game mode, just initialize states for potential later use
        assistant.enable_math_game()
        assistant.enable_riddle_game()
        assistant.enable_word_ladder_game()
        logger.info("🎮 Game state modules initialized (Cheeko mode)")
    
    # Enable music playback tools
    assistant.enable_music_tools(music_service)
    logger.info("🎵 Music playback tools enabled")

    # ============================================================================
    # CHAT EVENT HANDLER SETUP
    # ============================================================================

    # DISABLED: ChatEventHandler event handlers interfere with PTT even without generate_reply()
    # The event handlers themselves seem to be causing state changes during speech
    # ChatEventHandler.set_assistant(assistant)
    # ChatEventHandler.setup_session_handlers(session, ctx)
    # logger.info("💬 ChatEventHandler configured (PTT-safe mode)")

    # ============================================================================
    # USAGE TRACKING (Async initialization)
    # ============================================================================

    # Usage tracking will be initialized in background after session starts
    usage_manager = None

    async def initialize_usage_tracking():
        """Initialize usage tracking in background"""
        nonlocal usage_manager
        try:
            from src.utils.helpers import UsageManager
            usage_manager = UsageManager(mac_address=device_mac, session_id=room_name)
            usage_manager.setup_metrics_collection(session)
            logger.info("📊 Usage tracking initialized (async)")
        except Exception as e:
            logger.warning(f"Failed to initialize usage tracking: {e}")

    async def log_usage():
        """Log usage summary on shutdown"""
        if usage_manager:
            await usage_manager.log_usage()
            logger.info("Sent usage_summary via data channel")

    ctx.add_shutdown_callback(log_usage)

    # ============================================================================
    # ROOM INPUT OPTIONS
    # ============================================================================

    # Create room options with 16kHz sample rate to match MQTT gateway
    # This ensures audio from ESP32 devices (16kHz) is not resampled unnecessarily
    room_input_options = RoomInputOptions(
        audio_sample_rate=16000,  # Match MQTT gateway's 16kHz audio
        audio_num_channels=1,     # Mono audio from ESP32
    )
    logger.info("🎙️ Room input configured: 16kHz mono audio to match MQTT gateway")

    # ============================================================================
    # ROOM LIFECYCLE
    # ============================================================================

    participant_count = len(ctx.room.remote_participants)
    cleanup_completed = False

    async def cleanup_room_and_session():
        """Cleanup on disconnect"""
        nonlocal cleanup_completed
        if cleanup_completed:
            return
        cleanup_completed = True

        try:
            logger.info("🔴 Initiating cleanup")

            # Log error statistics
            try:
                if error_manager:
                    error_stats = error_manager.get_error_stats()
                    if error_stats:
                        total_errors = sum(error_stats.values())
                        if total_errors > 0:
                            logger.warning(f"⚠️ Total errors: {total_errors}")
                        else:
                            logger.info("✅ No errors during session")
            except Exception as e:
                logger.warning(f"Could not get error stats: {e}")

            # Close agent session
            try:
                if session and hasattr(session, 'aclose'):
                    await session.aclose()
            except Exception as e:
                logger.warning(f"Session close error: {e}")

            # Disconnect from room
            try:
                if ctx.room and hasattr(ctx.room, 'disconnect'):
                    await ctx.room.disconnect()
            except Exception as e:
                logger.warning(f"Room disconnect error: {e}")

            # Delete room
            try:
                await delete_livekit_room(ctx.room.name if ctx.room else "unknown")
            except Exception as e:
                logger.warning(f"Room deletion error: {e}")

            # Resource monitoring removed

            logger.info("✅ Cleanup completed")
        except Exception as e:
            logger.error(f"Error during cleanup: {e}")

    @ctx.room.on("participant_disconnected")
    def on_participant_disconnected(participant: rtc.RemoteParticipant):
        nonlocal participant_count
        participant_count -= 1
        logger.info(f"👤 Participant disconnected: {participant.identity}, remaining: {participant_count}")

        if participant_count == 0:
            logger.info("🔴 No participants remaining, initiating cleanup")
            asyncio.create_task(cleanup_room_and_session())

    @ctx.room.on("participant_connected")
    def on_participant_connected(participant: rtc.RemoteParticipant):
        nonlocal participant_count
        participant_count += 1
        logger.info(f"👤 Participant connected: {participant.identity}, total: {participant_count}")

    @ctx.room.on("disconnected")
    def on_room_disconnected():
        logger.info("🔴 Room disconnected, initiating cleanup")
        asyncio.create_task(cleanup_room_and_session())
    
    @ctx.room.on("data_received")
    def on_data_received(data_packet: rtc.DataPacket):
        """Handle data channel messages from firmware/mqtt-gateway"""
        try:
            import json
            message = json.loads(data_packet.data.decode('utf-8'))
            logger.info(f"📨 Data channel message: {message}")
            
            # Handle playback control messages
            if message.get('type') == 'playback_control':
                action = message.get('action')
                
                if action == 'next':
                    logger.info("⏭️ Skip to next song requested")
                    # Stop current song and play next
                    asyncio.create_task(handle_skip_next())
                elif action == 'previous':
                    logger.info("⏮️ Skip to previous song requested")
                    # Stop current song and play previous
                    asyncio.create_task(handle_skip_previous())
        except Exception as e:
            logger.error(f"❌ Error handling data channel message: {e}")
    
    async def handle_skip_next():
        """Handle skip to next song"""
        try:
            # Stop current playback
            if hasattr(assistant, 'audio_player') and assistant.audio_player:
                await assistant.audio_player.stop()
                logger.info("🛑 Stopped current song for skip")
            
            # Get next song
            from src.features.music_tools import play_next_in_playlist
            next_song = await play_next_in_playlist()
            
            if next_song and hasattr(assistant, 'audio_player'):
                logger.info(f"⏭️ Playing next song: {next_song['title']}")
                await asyncio.sleep(0.3)  # Small delay for clean transition
                await assistant.audio_player.play_from_url(next_song['url'], next_song['title'])
        except Exception as e:
            logger.error(f"❌ Error in handle_skip_next: {e}")
    
    async def handle_skip_previous():
        """Handle skip to previous song"""
        try:
            # Stop current playback
            if hasattr(assistant, 'audio_player') and assistant.audio_player:
                await assistant.audio_player.stop()
                logger.info("🛑 Stopped current song for skip")
            
            # Get previous song (currently not implemented - would need playlist history)
            logger.warning("⏮️ Previous song not yet implemented - playing next song instead")
            from src.features.music_tools import play_next_in_playlist
            song = await play_next_in_playlist()
            
            if song and hasattr(assistant, 'audio_player'):
                logger.info(f"⏭️ Playing song: {song['title']}")
                await asyncio.sleep(0.3)
                await assistant.audio_player.play_from_url(song['url'], song['title'])
        except Exception as e:
            logger.error(f"❌ Error in handle_skip_previous: {e}")

    ctx.add_shutdown_callback(cleanup_room_and_session)

    # ============================================================================
    # CONNECT AND START SESSION
    # ============================================================================

    await ctx.connect(auto_subscribe=AutoSubscribe.AUDIO_ONLY)
    participant = await ctx.wait_for_participant()
    logger.info(f"👤 Participant joined: {participant.identity}")

    # Pass references to assistant
    assistant.set_agent_session(session)
    assistant._session_context = ctx
    
    # Set session on audio_player for playback
    audio_player.set_session(session)

    # Start session (tools already passed to AgentSession constructor)
    await session.start(
        room=ctx.room,
        agent=assistant,
    )

    # Log initialization time
    init_elapsed_time = (asyncio.get_event_loop().time() - init_start_time) * 1000
    logger.info(f"⚡ Total initialization: {init_elapsed_time:.0f}ms")
    logger.info("✅ Gemini Realtime agent is LIVE!")

    # Auto-start music if in Music Mode
    if room_type == "music":
        logger.info("🎵 [MUSIC MODE] Auto-starting music playback")
        try:
            from src.features.music_tools import start_music_mode
            song = await start_music_mode()
            if song:
                logger.info(f"🎵 [MUSIC MODE] Now playing: {song['title']}")
            else:
                logger.warning("⚠️ [MUSIC MODE] No song available to play")
        except Exception as e:
            logger.error(f"❌ [MUSIC MODE] Failed to start music: {e}")
            import traceback
            logger.error(f"Traceback: {traceback.format_exc()}")

    # Initialize background services asynchronously (non-blocking)
    async def init_background_services():
        """Initialize non-critical services in background"""
        # Start usage tracking
        await initialize_usage_tracking()

        # Start chat history service
        if agent_id and device_mac:
            try:
                from src.services.chat_history_service import ChatHistoryService
                manager_api_url = os.getenv("MANAGER_API_URL")
                manager_api_secret = os.getenv("MANAGER_API_SECRET")

                chat_history_service = ChatHistoryService(
                    manager_api_url=manager_api_url,
                    secret=manager_api_secret,
                    device_mac=device_mac,
                    session_id=room_name,
                    agent_id=agent_id
                )
                chat_history_service.start_periodic_sending()
                logger.info(f"📝 Chat history service initialized (async) for agent_id: {agent_id}")
            except Exception as e:
                logger.warning(f"Failed to initialize chat history service: {e}")

    # Start background initialization (fire and forget)
    asyncio.create_task(init_background_services())


# ============================================================================
# MAIN
# ============================================================================

if __name__ == "__main__":
    # Cloud Run requires listening on the PORT env var (default 8080)
    # LiveKit agents use this port for health checks
    # Local dev can use 8081 as default
    health_check_port = int(os.environ.get("PORT", "8081"))
    logger.info(f"🏥 Health check port: {health_check_port}")
    
    cli.run_app(WorkerOptions(
        entrypoint_fnc=entrypoint,
        prewarm_fnc=prewarm,
        num_idle_processes=1,
        initialize_process_timeout=120.0,
        job_memory_warn_mb=2000,
        port=health_check_port,  # Cloud Run health check port
    ))