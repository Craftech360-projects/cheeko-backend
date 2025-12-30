"""
Shared entrypoint utilities for multi-agent workers
Contains common patterns extracted from main.py
"""

import os
import json
import asyncio
import time
import logging
from typing import Optional, Type, List, Callable
from dotenv import load_dotenv

from livekit.agents import (
    AgentSession,
    JobContext,
    JobProcess,
    AutoSubscribe,
    RoomInputOptions,
)
from livekit import rtc, api
from livekit.plugins import google

from src.config.config_loader import ConfigLoader
from src.utils.database_helper import DatabaseHelper
from src.services.prompt_service import PromptService
from src.services.music_service import MusicService
from src.utils.loki_agent_logger import logger

from .agent_configs import GAME_PROMPT_FILES, is_game_mode

# Load environment variables
load_dotenv(".env")

# Global Jinja2 template cache
_jinja_template_cache = {}

# Global registry for entrypoint configurations (needed for pickling on Windows)
_entrypoint_registry = {}


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
        logger.info(f"Successfully deleted room: {room_name}")

    except Exception as e:
        logger.error(f"Failed to delete room: {e}")


# ============================================================================
# PROMPT LOADING
# ============================================================================

def load_game_prompt(agent_name: str, child_profile: dict = None, extra_vars: dict = None) -> Optional[str]:
    """
    Load game-specific prompt from YAML file and render with child profile.

    Args:
        agent_name: The game name ("Math Tutor", "Riddle Solver", "Word Ladder")
        child_profile: Optional child profile for personalization
        extra_vars: Optional extra template variables (e.g., start_word, target_word)

    Returns:
        str: Rendered prompt or None if file not found
    """
    import yaml
    from jinja2 import Template

    if agent_name not in GAME_PROMPT_FILES:
        logger.warning(f"Unknown game: {agent_name}")
        return None

    # Get the prompt file path (relative to livekit-server root)
    prompt_file = os.path.join(
        os.path.dirname(os.path.dirname(os.path.dirname(__file__))),
        "src", "prompts",
        GAME_PROMPT_FILES[agent_name]
    )

    try:
        if not os.path.exists(prompt_file):
            logger.error(f"Game prompt file not found: {prompt_file}")
            return None

        with open(prompt_file, 'r') as f:
            prompt_data = yaml.safe_load(f)

        prompt_template = prompt_data.get('prompt', '')

        if not prompt_template:
            logger.error(f"No 'prompt' key in {prompt_file}")
            return None

        # Render with extra vars and child profile if template has variables
        if '{{' in prompt_template or '{%' in prompt_template:
            template = Template(prompt_template)
            template_vars = {}

            # Add extra vars first (e.g., start_word, target_word for Word Ladder)
            if extra_vars:
                template_vars.update(extra_vars)
                logger.info(f"Added extra template vars: {list(extra_vars.keys())}")

            # Add child profile vars
            if child_profile:
                # Parse interests if JSON string
                interests = child_profile.get('interests', '')
                if isinstance(interests, str) and interests.startswith('['):
                    try:
                        interests_list = json.loads(interests)
                        interests = ', '.join(interests_list)
                    except json.JSONDecodeError:
                        pass

                template_vars.update({
                    'child_name': child_profile.get('name', ''),
                    'child_age': child_profile.get('age', ''),
                    'child_interests': interests,
                    'age_group': child_profile.get('ageGroup', ''),
                    'child_gender': child_profile.get('gender', ''),
                    'primary_language': child_profile.get('primaryLanguage', 'English'),
                    'additional_notes': child_profile.get('additionalNotes', ''),
                })
                logger.info(f"Added child profile: {child_profile.get('name')}, age {child_profile.get('age')}")
            else:
                logger.warning("No child profile available for prompt rendering")

            prompt_template = template.render(**template_vars)

        logger.info(f"Loaded game prompt: {agent_name} ({len(prompt_template)} chars)")
        return prompt_template

    except Exception as e:
        logger.error(f"Error loading game prompt: {e}")
        import traceback
        logger.error(traceback.format_exc())
        return None


def render_prompt_with_profile(agent_prompt: str, child_profile: dict) -> str:
    """
    Render prompt template with child profile using Jinja2

    Args:
        agent_prompt: Prompt template string
        child_profile: Child profile data

    Returns:
        str: Rendered prompt
    """
    if not child_profile:
        return agent_prompt

    if '{{' not in agent_prompt and '{%' not in agent_prompt:
        return agent_prompt

    try:
        from jinja2 import Template

        # Use cached template if available
        template_cache_key = hash(agent_prompt)
        if template_cache_key not in _jinja_template_cache:
            _jinja_template_cache[template_cache_key] = Template(agent_prompt)
            logger.info("Compiled and cached Jinja2 template")
        else:
            logger.info("Using cached Jinja2 template")

        template = _jinja_template_cache[template_cache_key]

        # Parse interests if JSON string
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

        rendered = template.render(**template_vars)
        logger.info(f"Rendered template for: {child_profile.get('name')}")
        return rendered

    except Exception as e:
        logger.error(f"Jinja2 template error: {e}")
        # Fallback to simple string replacement
        agent_prompt = agent_prompt.replace("{{ child_name }}", child_profile.get('name', ''))
        agent_prompt = agent_prompt.replace("{{child_name}}", child_profile.get('name', ''))
        return agent_prompt


# ============================================================================
# ROOM PARSING
# ============================================================================

def parse_room_name(room_name: str) -> tuple:
    """
    Parse room name to extract device MAC and room type

    Args:
        room_name: LiveKit room name (format: uuid_macaddress_roomtype)

    Returns:
        tuple: (device_mac, room_type)
    """
    device_mac = None
    room_type = None

    if '_' in room_name:
        parts = room_name.split('_')
        if len(parts) >= 3:
            room_type = parts[-1]
            mac_part = parts[-2]
            if len(mac_part) == 12 and mac_part.isalnum():
                device_mac = ':'.join(mac_part[i:i+2] for i in range(0, 12, 2))
                logger.info(f"Extracted: MAC={device_mac}, Room Type={room_type}")
        elif len(parts) >= 2:
            mac_part = parts[-1]
            if len(mac_part) == 12 and mac_part.isalnum():
                device_mac = ':'.join(mac_part[i:i+2] for i in range(0, 12, 2))
                room_type = "conversation"
                logger.info(f"Extracted MAC from legacy room: {device_mac}")

    return device_mac, room_type


# ============================================================================
# PREWARM
# ============================================================================

def create_prewarm():
    """Create prewarm function for worker"""
    def prewarm(proc: JobProcess):
        """Minimal prewarm for Gemini Realtime"""
        logger.info("[PREWARM] Ready for Gemini Realtime")
        proc.userdata["ready"] = True
    return prewarm


# ============================================================================
# STATE MANAGEMENT
# ============================================================================

def create_state_handlers(ctx: JobContext, session: AgentSession):
    """
    Create state management handlers for LED feedback

    Returns:
        tuple: (emit_agent_state, emit_speech_created)
    """
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
            logger.info(f"State: {old_state} -> {new_state}")
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
            logger.info("speech_created event emitted")
        except Exception as e:
            logger.error(f"Failed to emit speech_created: {e}")

    # Register session event handler for TTS start/stop detection
    @session.on("agent_state_changed")
    def on_agent_state_changed_for_tts(ev):
        """Emit agent_state_changed for all transitions and speech_created when speaking"""
        try:
            old_state = getattr(ev, 'old_state', None)
            new_state = getattr(ev, 'new_state', None)
            logger.info(f"EVENT: agent_state_changed - {old_state} -> {new_state}")

            # Emit agent_state_changed for ALL state transitions (for TTS stop on speaking -> listening)
            asyncio.create_task(emit_agent_state(new_state))

            # Also emit speech_created when starting to speak (for TTS start)
            if new_state == 'speaking' and old_state != 'speaking':
                logger.info(f"Emitting speech_created (state: {old_state} -> speaking)")
                asyncio.create_task(emit_speech_created())

        except Exception as e:
            logger.error(f"Error in agent_state_changed handler: {e}")

    return emit_agent_state, emit_speech_created


# ============================================================================
# CHAT HISTORY UTILITIES
# ============================================================================

def init_chat_history_service(device_mac: str, room_name: str, agent_id: str = None):
    """
    Initialize chat history service for a session

    Args:
        device_mac: Device MAC address
        room_name: Room/session name
        agent_id: Optional agent ID

    Returns:
        ChatHistoryService instance or None if initialization fails
    """
    try:
        from src.services.chat_history_service import ChatHistoryService
        chat_history_service = ChatHistoryService(
            manager_api_url=os.getenv("MANAGER_API_URL"),
            secret=os.getenv("MANAGER_API_SECRET"),
            device_mac=device_mac,
            session_id=room_name,
            agent_id=agent_id
        )
        logger.info(f"Chat history service initialized for agent_id: {agent_id}")
        return chat_history_service
    except Exception as e:
        logger.warning(f"Failed to initialize chat history: {e}")
        return None


async def extract_and_send_chat_history(session, chat_history_service):
    """
    Extract chat history from session and send to API

    Args:
        session: AgentSession instance
        chat_history_service: ChatHistoryService instance

    Returns:
        bool: True if successful, False otherwise
    """
    if not chat_history_service or not session:
        return False

    try:
        chat_ctx = getattr(session, 'history', None)
        items = getattr(chat_ctx, 'items', []) if chat_ctx else []

        if items:
            for item in items:
                # Extract role and content from ChatItem
                role = getattr(item, 'role', None)
                content = getattr(item, 'content', None)

                # Handle content that might be a list of parts
                if isinstance(content, list):
                    text = "".join(
                        part if isinstance(part, str) else getattr(part, "text", "")
                        for part in content
                    )
                elif hasattr(content, 'text'):
                    text = content.text
                elif isinstance(content, str):
                    text = content
                else:
                    text = str(content) if content else ""

                if text and text.strip():
                    chat_type = 1 if role == 'user' else 2
                    chat_history_service.add_message(chat_type, text)

            logger.info(f"📝 Extracted {len(items)} items from session.history")

        await chat_history_service.cleanup()
        return True
    except Exception as e:
        logger.warning(f"Error extracting chat history: {e}")
        return False


# ============================================================================
# ENTRYPOINT FACTORY
# ============================================================================

def create_entrypoint(character_name: str, assistant_class: Type, game_tools: List = None):
    """
    Factory function to create an entrypoint for a specific character

    Args:
        character_name: Character name ("Cheeko", "Math Tutor", etc.)
        assistant_class: Assistant class to instantiate
        game_tools: Optional list of game tools for game modes

    Returns:
        Callable: entrypoint function for the worker
    """

    async def entrypoint(ctx: JobContext):
        """Entrypoint for the agent worker"""

        # Ensure GOOGLE_API_KEY is available
        yaml_config = ConfigLoader.load_yaml_config()
        api_keys = yaml_config.get('api_keys', {})
        if 'google' in api_keys and not os.getenv('GOOGLE_API_KEY'):
            os.environ['GOOGLE_API_KEY'] = api_keys['google']
            logger.info("Loaded GOOGLE_API_KEY from config.yaml")

        ctx.log_context_fields = {"room": ctx.room.name}
        logger.info(f"Starting {character_name} agent in room: {ctx.room.name}")

        init_start_time = asyncio.get_event_loop().time()

        # Load configuration
        realtime_config = ConfigLoader.get_gemini_realtime_config()
        gemini_model = realtime_config.get('model', 'gemini-live-2.5-flash-native-audio')
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
                    logger.info(f"Using child profile from dispatch metadata: {dispatch_child_profile.get('name')}, age: {dispatch_child_profile.get('age')}")
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

                # Process agent_id
                if isinstance(agent_id_result, Exception):
                    logger.error(f"Failed to get agent_id: {agent_id_result}")
                else:
                    agent_id = agent_id_result
                    logger.info(f"Agent ID: {agent_id}")

                # Process prompt based on character type
                if is_game_mode(character_name):
                    # Load game-specific prompt
                    game_prompt = load_game_prompt(character_name, child_profile_result)
                    if game_prompt:
                        agent_prompt = game_prompt
                        logger.info(f"Loaded {character_name} game prompt ({len(agent_prompt)} chars)")
                    else:
                        logger.warning(f"Failed to load {character_name} prompt, using default")
                        if not isinstance(prompt_config_result, Exception):
                            agent_prompt, _ = prompt_config_result
                else:
                    # Normal mode - use regular prompt
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
        if child_profile:
            agent_prompt = render_prompt_with_profile(agent_prompt, child_profile)

        # Log prompt info
        logger.info(f"Final prompt length: {len(agent_prompt)} chars")

        # Create Gemini Realtime model
        realtime_model = google.realtime.RealtimeModel(
            model=gemini_model,
            voice=gemini_voice,
            instructions=agent_prompt,
            temperature=gemini_temperature,
            modalities=["AUDIO"],
        )
        logger.info("Gemini Realtime model created")

        # Create AgentSession with game tools if applicable
        session_kwargs = {"llm": realtime_model}
        if game_tools:
            session_kwargs["tools"] = game_tools
            logger.info(f"Creating AgentSession with {len(game_tools)} game tools")

        session = AgentSession(**session_kwargs)

        # Create state handlers
        emit_agent_state, emit_speech_created = create_state_handlers(ctx, session)
        logger.info("State management registered")

        # Setup error handling
        error_manager = None
        try:
            from src.agent.error_handler import setup_error_handling
            error_manager = setup_error_handling(
                session=session,
                max_retries=3,
                custom_audio_path=None
            )
            logger.info("Error handling enabled")
        except Exception as e:
            logger.warning(f"Error handler not available: {e}")

        # Initialize music service
        music_service = MusicService()
        asyncio.create_task(music_service.initialize())
        logger.info("Music service initialized (async)")

        # Create assistant instance
        assistant = assistant_class(instructions=agent_prompt)
        assistant.set_room_info(room_name=ctx.room.name, device_mac=device_mac)
        logger.info(f"{character_name} Assistant initialized")

        # Initialize audio player
        from src.services.unified_audio_player import UnifiedAudioPlayer
        audio_player = UnifiedAudioPlayer()
        audio_player.set_context(ctx)
        assistant.audio_player = audio_player
        logger.info("UnifiedAudioPlayer initialized")

        # Enable features based on character
        assistant.enable_battery_tools()
        assistant.enable_volume_tools()

        if character_name == "Cheeko":
            assistant.enable_mode_switching()
            assistant.enable_music_tools(music_service)
            # Initialize game states for potential switching
            assistant.enable_math_game()
            assistant.enable_riddle_game()
            assistant.enable_word_ladder_game()
        elif is_game_mode(character_name):
            # Initialize and connect game state
            if character_name == "Math Tutor":
                assistant.enable_math_game()
                from src.features.game_tools import set_math_game_state
                set_math_game_state(assistant.math_game_state)
                logger.info("Math Tutor state initialized")
            elif character_name == "Riddle Solver":
                assistant.enable_riddle_game()
                from src.features.game_tools import set_riddle_game_state
                set_riddle_game_state(assistant.riddle_game_state)
                logger.info("Riddle Solver state initialized")
            elif character_name == "Word Ladder":
                assistant.enable_word_ladder_game()
                from src.features.game_tools import set_word_ladder_state
                set_word_ladder_state(assistant.word_ladder_state)
                logger.info("Word Ladder state initialized")

        # Room lifecycle management
        participant_count = len(ctx.room.remote_participants)
        cleanup_completed = False

        async def cleanup_room_and_session():
            """Cleanup on disconnect"""
            nonlocal cleanup_completed
            if cleanup_completed:
                return
            cleanup_completed = True

            try:
                logger.info("Initiating cleanup")

                # Log error statistics
                if error_manager:
                    try:
                        error_stats = error_manager.get_error_stats()
                        if error_stats:
                            total_errors = sum(error_stats.values())
                            if total_errors > 0:
                                logger.warning(f"Total errors: {total_errors}")
                    except Exception:
                        pass

                # Close session
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

                logger.info("Cleanup completed")
            except Exception as e:
                logger.error(f"Error during cleanup: {e}")

        @ctx.room.on("participant_disconnected")
        def on_participant_disconnected(participant: rtc.RemoteParticipant):
            nonlocal participant_count
            participant_count -= 1
            logger.info(f"Participant disconnected: {participant.identity}, remaining: {participant_count}")
            if participant_count == 0:
                logger.info("No participants remaining, initiating cleanup")
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

        @ctx.room.on("data_received")
        def on_data_received(data_packet: rtc.DataPacket):
            """Handle data channel messages"""
            try:
                message = json.loads(data_packet.data.decode('utf-8'))
                logger.info(f"Data channel message: {message}")

                if message.get('type') == 'playback_control':
                    action = message.get('action')
                    if action == 'next':
                        asyncio.create_task(handle_skip_next())
                    elif action == 'previous':
                        asyncio.create_task(handle_skip_previous())
            except Exception as e:
                logger.error(f"Error handling data channel message: {e}")

        async def handle_skip_next():
            """Handle skip to next song"""
            try:
                if hasattr(assistant, 'audio_player') and assistant.audio_player:
                    await assistant.audio_player.stop()
                from src.features.music_tools import play_next_in_playlist
                next_song = await play_next_in_playlist()
                if next_song and assistant.audio_player:
                    await asyncio.sleep(0.3)
                    await assistant.audio_player.play_from_url(next_song['url'], next_song['title'])
            except Exception as e:
                logger.error(f"Error in handle_skip_next: {e}")

        async def handle_skip_previous():
            """Handle skip to previous song"""
            try:
                if hasattr(assistant, 'audio_player') and assistant.audio_player:
                    await assistant.audio_player.stop()
                from src.features.music_tools import play_next_in_playlist
                song = await play_next_in_playlist()
                if song and assistant.audio_player:
                    await asyncio.sleep(0.3)
                    await assistant.audio_player.play_from_url(song['url'], song['title'])
            except Exception as e:
                logger.error(f"Error in handle_skip_previous: {e}")

        ctx.add_shutdown_callback(cleanup_room_and_session)

        # Room input options (16kHz to match MQTT gateway)
        room_input_options = RoomInputOptions(
            audio_sample_rate=16000,
            audio_num_channels=1,
        )
        logger.info("Room input configured: 16kHz mono audio")

        # Connect and start session
        await ctx.connect(auto_subscribe=AutoSubscribe.AUDIO_ONLY)
        participant = await ctx.wait_for_participant()
        logger.info(f"Participant joined: {participant.identity}")

        # Pass references to assistant
        assistant.set_agent_session(session)
        assistant.set_session_context(ctx)
        audio_player.set_session(session)

        # Start session
        await session.start(
            room=ctx.room,
            agent=assistant,
        )

        # Log initialization time
        init_elapsed_time = (asyncio.get_event_loop().time() - init_start_time) * 1000
        logger.info(f"Total initialization: {init_elapsed_time:.0f}ms")
        logger.info(f"{character_name} agent is LIVE!")

        # Auto-start music if in Music Mode (Cheeko only)
        if character_name == "Cheeko" and room_type == "music":
            logger.info("[MUSIC MODE] Auto-starting music playback")
            try:
                from src.features.music_tools import start_music_mode
                song = await start_music_mode()
                if song:
                    logger.info(f"[MUSIC MODE] Now playing: {song['title']}")
            except Exception as e:
                logger.error(f"[MUSIC MODE] Failed to start music: {e}")

        # Initialize background services
        async def init_background_services():
            """Initialize non-critical services in background"""
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
                    logger.info(f"Chat history service initialized for agent_id: {agent_id}")
                except Exception as e:
                    logger.warning(f"Failed to initialize chat history service: {e}")

        asyncio.create_task(init_background_services())

    return entrypoint


def create_game_entrypoint(character_name: str, assistant_class: Type, game_tools: List):
    """
    Factory function to create an entrypoint for a game mode

    Args:
        character_name: Game character name ("Math Tutor", "Riddle Solver", "Word Ladder")
        assistant_class: Assistant class to instantiate
        game_tools: List of game tools for the game mode

    Returns:
        Callable: entrypoint function for the worker
    """
    return create_entrypoint(character_name, assistant_class, game_tools)
