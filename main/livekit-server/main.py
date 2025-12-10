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

# Resource monitoring imports
try:
    import psutil
    PSUTIL_AVAILABLE = True
except ImportError:
    PSUTIL_AVAILABLE = False
    logging.warning("psutil not available - install with: pip install psutil")

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

# Initialize Datadog logging (must be done before logger usage)
from src.config.datadog_config import DatadogConfig
DatadogConfig.setup_logging()

# Import required components
from src.config.config_loader import ConfigLoader
from src.utils.database_helper import DatabaseHelper
from src.services.prompt_service import PromptService
from src.mcp.device_control_service import DeviceControlService
from src.mcp.mcp_executor import LiveKitMCPExecutor
from src.utils.helpers import UsageManager
from src.handlers.chat_logger import ChatEventHandler
from src.services.chat_history_service import ChatHistoryService
# FilteredAgent removed for faster response time - using built-in Agent

# Logger
from src.utils.loki_agent_logger import logger


# ============================================================================
# RESOURCE MONITOR
# ============================================================================

class ResourceMonitor:
    """Monitor system resources and log performance metrics"""

    def __init__(self, log_interval=10):
        self.log_interval = log_interval
        self.monitoring = False
        self.monitor_thread = None
        self.start_time = time.time()
        self.client_count = 0

    def start_monitoring(self):
        """Start resource monitoring in background thread"""
        if not PSUTIL_AVAILABLE:
            logger.warning("📊 Resource monitoring disabled - psutil not available")
            return

        if self.monitoring:
            return

        self.monitoring = True
        self.monitor_thread = threading.Thread(target=self._monitor_loop, daemon=True)
        self.monitor_thread.start()
        logger.info(f"📊 Resource monitoring started (interval: {self.log_interval}s)")

    def stop_monitoring(self):
        """Stop resource monitoring"""
        self.monitoring = False
        if self.monitor_thread:
            self.monitor_thread.join(timeout=1)
        logger.info("📊 Resource monitoring stopped")

    def increment_clients(self):
        """Increment active client count"""
        self.client_count += 1
        logger.info(f"📊 Active clients: {self.client_count}")

    def decrement_clients(self):
        """Decrement active client count"""
        self.client_count = max(0, self.client_count - 1)
        logger.info(f"📊 Active clients: {self.client_count}")

    def _monitor_loop(self):
        """Main monitoring loop"""
        while self.monitoring:
            try:
                self._log_resources()
                time.sleep(self.log_interval)
            except Exception as e:
                logger.error(f"📊 Resource monitoring error: {e}")
                time.sleep(self.log_interval)

    def _log_resources(self):
        """Log current resource usage"""
        if not PSUTIL_AVAILABLE:
            return

        try:
            cpu_percent = psutil.cpu_percent(interval=1)
            memory = psutil.virtual_memory()
            process = psutil.Process()
            process_cpu = process.cpu_percent()
            process_memory = process.memory_info()
            process_threads = process.num_threads()
            net_io = psutil.net_io_counters()
            uptime = time.time() - self.start_time

            logger.info(
                f"📊 RESOURCES | "
                f"Clients: {self.client_count} | "
                f"Uptime: {uptime:.1f}s | "
                f"CPU: {cpu_percent:.1f}% (proc: {process_cpu:.1f}%) | "
                f"RAM: {memory.percent:.1f}% (proc: {process_memory.rss/1024/1024:.1f}MB) | "
                f"Threads: {process_threads} | "
                f"Net: ↓{net_io.bytes_recv/1024/1024:.1f}MB ↑{net_io.bytes_sent/1024/1024:.1f}MB"
            )
        except Exception as e:
            logger.error(f"📊 Failed to log resources: {e}")


# Global resource monitor
resource_monitor = ResourceMonitor(log_interval=10)


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
# ASSISTANT WITH FULL FUNCTION TOOLS
# ============================================================================

# Import the full Assistant class with all function tools from main_agent.py
from src.agent.main_agent import Assistant

logger.info("✅ Imported Assistant from main_agent.py with all function tools (update_agent_mode, games, device control, etc.)")


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

    # Start resource monitoring
    resource_monitor.start_monitoring()
    resource_monitor.increment_clients()

    # Load configuration
    realtime_config = ConfigLoader.get_gemini_realtime_config()
    gemini_model = realtime_config.get('model', 'gemini-2.5-flash-native-audio-preview-09-2025')
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

    # Guard: Only proceed for conversation rooms
    if room_type and room_type != "conversation":
        logger.warning(f"⚠️ Agent dispatched to '{room_type}' room - exiting (agents only join conversation rooms)")
        return

    # Initialize services
    prompt_service = PromptService()
    agent_prompt = ConfigLoader.get_default_prompt()
    child_profile = None
    agent_id = None

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

            # Parallel API calls (reduced from 5 to 3)
            results = await asyncio.gather(
                db_helper.get_agent_id(device_mac),
                prompt_service.get_prompt_and_config(room_name, device_mac),
                db_helper.get_child_profile_by_mac(device_mac),
                return_exceptions=True
            )

            elapsed_time = (asyncio.get_event_loop().time() - start_time) * 1000
            logger.info(f"⚡✅ Parallel API calls completed in {elapsed_time:.0f}ms")

            # Unpack results
            agent_id_result, prompt_config_result, child_profile_result = results

            # Process agent_id
            if isinstance(agent_id_result, Exception):
                logger.error(f"Failed to get agent_id: {agent_id_result}")
            else:
                agent_id = agent_id_result
                logger.info(f"📝 Agent ID: {agent_id}")

            # Process prompt
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

    # Build prompt with child profile using Jinja2 templates
    if child_profile:
        logger.info(f"👶 Child profile data: {json.dumps(child_profile, indent=2)}")

        # Check if prompt uses Jinja2 templates ({{ or {%)
        if '{{' in agent_prompt or '{%' in agent_prompt:
            try:
                from jinja2 import Template, Undefined

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

                logger.info(f"👶 Template variables: {json.dumps(template_vars, indent=2)}")

                template = Template(agent_prompt)
                agent_prompt = template.render(**template_vars)
                logger.info(f"✅ Rendered Jinja2 template for: {child_profile.get('name')}")

            except Exception as e:
                logger.error(f"❌ Jinja2 template error: {e}")
                import traceback
                logger.error(traceback.format_exc())
                # Fallback to simple string replacement
                agent_prompt = agent_prompt.replace("{{ child_name }}", child_profile.get('name', ''))
                agent_prompt = agent_prompt.replace("{{child_name}}", child_profile.get('name', ''))
                agent_prompt = agent_prompt.replace("{{ child_age }}", str(child_profile.get('age', '')))
                agent_prompt = agent_prompt.replace("{{child_age}}", str(child_profile.get('age', '')))
        else:
            # No template variables found - prompt might already be personalized from API
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

    logger.info(f"🎙️ Initializing Gemini Realtime (model: {gemini_model}, voice: {gemini_voice})...")

    # Google Search grounding
    google_search_grounding = types.GoogleSearch()
    logger.info("🔍 Google Search grounding enabled")

    # Create Gemini Realtime model - NO custom VAD config (use Gemini's default for faster response)
    # This matches the fast test project (gemini_live-api-livekit/agent.py)
    realtime_model = google.realtime.RealtimeModel(
        model=gemini_model,
        voice=gemini_voice,
        temperature=gemini_temperature,
        modalities=["AUDIO"],
        _gemini_tools=[google_search_grounding],
    )

    logger.info(f"✅ Gemini Realtime model created")

    # Create AgentSession - LLM is now passed to Agent constructor for function tools to work
    session = AgentSession()

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
    # ERROR HANDLING
    # ============================================================================

    from src.agent.error_handler import setup_error_handling
    error_manager = setup_error_handling(
        session=session,
        max_retries=3,
        custom_audio_path=None
    )
    logger.info("🛡️ Error handling enabled")

    # ============================================================================
    # INITIALIZE ALL SERVICES FOR FUNCTION TOOLS
    # ============================================================================

    # Import additional services needed by Assistant's function tools
    from src.services.music_service import MusicService
    from src.services.story_service import StoryService
    from src.services.unified_audio_player import UnifiedAudioPlayer
    from src.services.google_search_service import GoogleSearchService
    from src.services.question_generator_service import QuestionGeneratorService
    from src.services.riddle_generator_service import RiddleGeneratorService
    from src.services.analytics_service import AnalyticsService

    # Device control services
    device_control_service = DeviceControlService()
    mcp_executor = LiveKitMCPExecutor()
    logger.info("🎛️ Device control service created")

    # Initialize Music Service
    music_service = MusicService()
    try:
        await music_service.initialize()
        logger.info("🎵 Music service initialized")
    except Exception as e:
        logger.warning(f"Music service initialization failed: {e}")
        music_service = None

    # Initialize Story Service
    story_service = StoryService()
    try:
        await story_service.initialize()
        logger.info("📖 Story service initialized")
    except Exception as e:
        logger.warning(f"Story service initialization failed: {e}")
        story_service = None

    # Initialize Unified Audio Player
    unified_audio_player = UnifiedAudioPlayer()
    logger.info("🔊 Unified audio player created")

    # Initialize Google Search Service
    google_search_service = GoogleSearchService()
    logger.info("🔍 Google search service created")

    # Initialize Question Generator Service
    question_generator_service = QuestionGeneratorService()
    try:
        await question_generator_service.initialize()
        logger.info("🧮 Question generator service initialized")
    except Exception as e:
        logger.warning(f"Question generator service initialization failed: {e}")
        question_generator_service = None

    # Initialize Riddle Generator Service
    riddle_generator_service = RiddleGeneratorService()
    try:
        await riddle_generator_service.initialize()
        logger.info("🤔 Riddle generator service initialized")
    except Exception as e:
        logger.warning(f"Riddle generator service initialization failed: {e}")
        riddle_generator_service = None

    # Initialize Analytics Service
    analytics_service = None
    if device_mac and agent_id:
        try:
            analytics_service = AnalyticsService(
                manager_api_url=os.getenv("MANAGER_API_URL"),
                secret=os.getenv("MANAGER_API_SECRET"),
                device_mac=device_mac,
                session_id=room_name,
                agent_id=agent_id
            )
            logger.info("📊 Analytics service initialized")
        except Exception as e:
            logger.warning(f"Analytics service initialization failed: {e}")

    # ============================================================================
    # CHAT HISTORY & MEM0 SERVICES
    # ============================================================================

    # Initialize chat history service if agent_id is available
    chat_history_service = None

    if device_mac and agent_id:
        try:
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
            logger.info(f"📝 Chat history service initialized for agent_id: {agent_id}")
        except Exception as e:
            logger.warning(f"Failed to initialize chat history service: {e}")

    # Initialize mem0 provider and conversation messages
    mem0_provider = None
    conversation_messages = []

    try:
        from src.memory.mem0_provider import Mem0MemoryProvider
        mem0_api_key = os.getenv("MEM0_API_KEY")
        if mem0_api_key and device_mac:
            mem0_provider = Mem0MemoryProvider(api_key=mem0_api_key, role_id=device_mac)
            logger.info(f"💭 Mem0 provider initialized for device: {device_mac}")
        else:
            logger.warning(f"💭 Mem0 provider not initialized - missing API key or device MAC")
    except Exception as e:
        logger.warning(f"Mem0 provider not available: {e}")

    # ============================================================================
    # CREATE ASSISTANT WITH ALL FUNCTION TOOLS
    # ============================================================================

    # Pass LLM to Assistant constructor - this enables @function_tool decorators to work with Realtime models
    assistant = Assistant(instructions=agent_prompt, llm=realtime_model)

    # Set all services for function tools (music, story, games, device control, etc.)
    assistant.set_services(
        music_service=music_service,
        story_service=story_service,
        audio_player=None,  # Legacy audio player - not used
        unified_audio_player=unified_audio_player,
        device_control_service=device_control_service,
        mcp_executor=mcp_executor,
        google_search_service=google_search_service,
        question_generator_service=question_generator_service,
        riddle_generator_service=riddle_generator_service,
        analytics_service=analytics_service
    )

    assistant.set_room_info(room_name=room_name, device_mac=device_mac)
    logger.info("🔧 Assistant created with ALL function tools (update_agent_mode, games, music, story, device control)")
    # Log session info (responses will be captured via conversation_item_added event)
    if chat_history_service:
        logger.debug(
            "🎯 Chat history service ready - will capture via conversation_item_added and session.history")

    # Setup event handlers and pass assistant reference for abort handling
    ChatEventHandler.set_assistant(assistant)
    if chat_history_service:
        ChatEventHandler.set_chat_history_service(chat_history_service)
        logger.info(f"📝🔗 Chat history service connected to event handlers")
    else:
        logger.warning(
            f"📝⚠️ No chat history service available - events will not be captured")
    ChatEventHandler.setup_session_handlers(session, ctx)

    # Add mem0 conversation capture event handler
    if mem0_provider:
        @session.on("conversation_item_added")
        def _on_mem0_conversation_item(ev):
            try:
                item = ev.item
                if hasattr(item, 'role') and hasattr(item, 'content'):
                    role = item.role
                    content = item.content
                    # Extract text from content (might be list or string)
                    if isinstance(content, list):
                        content = ' '.join(str(c) for c in content)

                    if role in ['user', 'assistant'] and content:
                        conversation_messages.append({
                            'role': role,
                            'content': content
                        })
                        logger.debug(
                            f"💭 Captured {role} message for mem0 (buffer size: {len(conversation_messages)})")
            except Exception as e:
                logger.error(f"💭 Failed to capture message for mem0: {e}")

        logger.info("💭 Mem0 conversation capture enabled")

    # Setup usage tracking
    usage_manager = UsageManager(mac_address=device_mac, session_id=room_name)
    usage_manager.setup_metrics_collection(session)

    async def log_usage():
        """Log usage summary on shutdown"""
        await usage_manager.log_usage()
        logger.info("Sent usage_summary via data channel")

    ctx.add_shutdown_callback(log_usage)

    # Create room options with 16kHz sample rate to match MQTT gateway
    # This ensures audio from ESP32 devices (16kHz) is not resampled unnecessarily
    room_input_options = RoomInputOptions(
        audio_sample_rate=16000,  # Match MQTT gateway's 16kHz audio
        audio_num_channels=1,     # Mono audio from ESP32
    )
    logger.info("Room input configured: 16kHz mono audio to match MQTT gateway")

    # Track participants and manage room lifecycle
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

            # Stop resource monitoring
            resource_monitor.decrement_clients()
            resource_monitor.stop_monitoring()

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

    # Set session and context on unified audio player (needed for music/story playback)
    if unified_audio_player:
        unified_audio_player.set_session(session)
        unified_audio_player.set_context(ctx)
        logger.info("🔊 Unified audio player connected to session")

    # Start session
    await session.start(
        room=ctx.room,
        agent=assistant,
    )

    # Log initialization time
    init_elapsed_time = (asyncio.get_event_loop().time() - init_start_time) * 1000
    logger.info(f"⚡ Total initialization: {init_elapsed_time:.0f}ms")
    logger.info("✅ Gemini Realtime agent is LIVE!")


# ============================================================================
# MAIN
# ============================================================================

if __name__ == "__main__":
    cli.run_app(WorkerOptions(
        entrypoint_fnc=entrypoint,
        prewarm_fnc=prewarm,
        num_idle_processes=1,
        initialize_process_timeout=120.0,
        job_memory_warn_mb=2000,
    ))
