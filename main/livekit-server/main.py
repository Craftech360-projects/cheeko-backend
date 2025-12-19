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
    JobExecutorType
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
    """Prewarm: Load heavy models before agents connect"""
    # Load environment variables in worker process (critical for LIVEKIT_URL)
    load_dotenv(".env")
    logger.info("[PREWARM] Starting model preloading...")

    # Preload embedding model and Qdrant client during prewarm
    # This ensures first agent connection is fast
    from src.utils.model_cache import model_cache

    # Load embedding model (takes ~2-3s)
    embedding_model = model_cache.get_embedding_model()
    if embedding_model:
        logger.info("[PREWARM] ✅ Embedding model preloaded")

    # Load Qdrant client
    qdrant_client = model_cache.get_qdrant_client()
    if qdrant_client:
        logger.info("[PREWARM] ✅ Qdrant client preloaded")

    proc.userdata["ready"] = True
    logger.info("[PREWARM] ✅ Prewarm complete - models ready")


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

    # =========================================================================
    # CONNECT TO ROOM FIRST (required to access room metadata)
    # =========================================================================
    logger.info("🔌 Connecting to room to access metadata...")
    await ctx.connect(auto_subscribe=AutoSubscribe.AUDIO_ONLY)
    logger.info("✅ Connected to room")

    # =========================================================================
    # READ CHILD PROFILE FROM ROOM METADATA (set by mqtt-gateway during room creation)
    # This is faster and more reliable than making an API call
    # =========================================================================
    if ctx.room.metadata:
        try:
            child_profile = json.loads(ctx.room.metadata)
            logger.info(f"👶 Child: {child_profile.get('child_name', 'N/A')}, Age: {child_profile.get('child_age', 'N/A')}")

            # Normalize field names to match expected format (metadata uses snake_case)
            child_profile = {
                'name': child_profile.get('child_name', ''),
                'age': child_profile.get('child_age', ''),
                'ageGroup': child_profile.get('age_group', ''),
                'gender': child_profile.get('child_gender', ''),
                'interests': child_profile.get('child_interests', ''),
                'primaryLanguage': child_profile.get('primary_language', 'English'),
                'additionalNotes': child_profile.get('additional_notes', ''),
            }
        except json.JSONDecodeError as e:
            logger.warning(f"⚠️ Failed to parse room metadata: {e}")
            child_profile = None

    # =========================================================================
    # EARLY MEM0 INITIALIZATION (start memory retrieval in background)
    # =========================================================================
    mem0_provider = None
    mem0_task = None  # Background task for memory retrieval
    conversation_messages = []

    if device_mac:
        try:
            from src.memory.mem0_provider import Mem0MemoryProvider
            mem0_api_key = os.getenv("MEM0_API_KEY")
            if mem0_api_key:
                mem0_provider = Mem0MemoryProvider(api_key=mem0_api_key, role_id=device_mac)
                # Start memory retrieval as background task (runs in parallel with API calls)
                mem0_task = asyncio.create_task(mem0_provider.get_all_memories(limit=15))
        except Exception as e:
            logger.warning(f"💭 Mem0 init failed: {e}")

    if device_mac:
        try:
            start_time = asyncio.get_event_loop().time()

            manager_api_url = os.getenv("MANAGER_API_URL")
            manager_api_secret = os.getenv("MANAGER_API_SECRET")
            db_helper = DatabaseHelper(manager_api_url, manager_api_secret)

            # Clear prompt cache for fresh session
            prompt_service.clear_cache()
            prompt_service.clear_enhanced_cache(device_mac)

            # Parallel API calls (reduced to 2 - child_profile now comes from room metadata)
            results = await asyncio.gather(
                db_helper.get_agent_id(device_mac),
                prompt_service.get_prompt_and_config(room_name, device_mac),
                return_exceptions=True
            )

            elapsed_time = (asyncio.get_event_loop().time() - start_time) * 1000
            logger.info(f"⚡ API calls: {elapsed_time:.0f}ms")

            # Unpack results (now only 2 results)
            agent_id_result, prompt_config_result = results

            # Process agent_id
            if isinstance(agent_id_result, Exception):
                logger.error(f"Failed to get agent_id: {agent_id_result}")
            else:
                agent_id = agent_id_result

            # Process prompt
            if isinstance(prompt_config_result, Exception):
                logger.warning(f"Failed to fetch config: {prompt_config_result}")
                agent_prompt = ConfigLoader.get_default_prompt()
            else:
                agent_prompt, _ = prompt_config_result  # Ignore TTS config (Gemini has built-in TTS)

        except Exception as e:
            logger.error(f"❌ API calls error: {e}")
            agent_prompt = ConfigLoader.get_default_prompt()

    # Build prompt with child profile using Jinja2 templates
    if child_profile:
        # Check if prompt uses Jinja2 templates ({{ or {%)
        if '{{' in agent_prompt or '{%' in agent_prompt:
            try:
                from jinja2 import Template, Undefined

                # Build template variables from child profile
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

                template = Template(agent_prompt)
                agent_prompt = template.render(**template_vars)

            except Exception as e:
                logger.error(f"❌ Jinja2 template error: {e}")
                # Fallback to simple string replacement
                agent_prompt = agent_prompt.replace("{{ child_name }}", child_profile.get('name', ''))
                agent_prompt = agent_prompt.replace("{{child_name}}", child_profile.get('name', ''))
                agent_prompt = agent_prompt.replace("{{ child_age }}", str(child_profile.get('age', '')))
                agent_prompt = agent_prompt.replace("{{child_age}}", str(child_profile.get('age', '')))

    # ============================================================================
    # APPEND CHARACTER CHANGE INSTRUCTIONS
    # ============================================================================
    # This is critical for the agent to know it can change characters using the update_agent_mode function

    CHARACTER_CHANGE_INSTRUCTIONS = """

<character_switching>
【Character/Mode Switching - USE WITH EXTREME CAUTION】

You can switch to different character modes, but ONLY when EXPLICITLY requested.

**Available Characters:**
- "Cheeko" - Default fun, playful friend
- "Math Tutor" - Math games and practice
- "Riddle Solver" - Riddle and puzzle games
- "Word Ladder" - Word and vocabulary games

**⚠️ CRITICAL: When to Switch (ONLY these exact situations):**
ONLY call update_agent_mode when the child EXPLICITLY says:
- "Change to [character name]" or "Switch to [character name]"
- "I want to talk to Math Tutor" or "I want to talk to Riddle Solver"
- "Change character to [name]"
- "Switch mode to [name]"
- "Can you become [character name]?"

**🚫 DO NOT SWITCH for these situations:**
- Greetings like "Hi", "Hello", "Hey", "Good morning" → Just greet back normally
- General questions like "How are you?", "What's your name?" → Just answer normally
- "Let's play" or "I want to play" WITHOUT mentioning a character → Play games as current character
- "Tell me a joke", "Tell me a story" → Do it as current character
- Any conversation that doesn't EXPLICITLY mention changing/switching character

**How to Switch (ONLY when conditions above are met):**
- update_agent_mode(mode_name="Math Tutor") - For explicit request to switch to Math Tutor
- update_agent_mode(mode_name="Riddle Solver") - For explicit request to switch to Riddle Solver
- update_agent_mode(mode_name="Word Ladder") - For explicit request to switch to Word Ladder
- update_agent_mode(mode_name="Cheeko") - For explicit request to switch to Cheeko

**RULES:**
1. NEVER call update_agent_mode for greetings or general conversation
2. When switching, say "Switching to [mode]..." then call the function
3. If already in the requested mode, just continue as that character

**Correct Examples:**
- Child: "Hi!" → Greet them warmly, DO NOT call update_agent_mode
- Child: "Hello, how are you?" → Answer the question, DO NOT call update_agent_mode
- Child: "Let's play a game" → Play a game as current character, DO NOT switch
- Child: "Change to Math Tutor" → Call update_agent_mode(mode_name="Math Tutor")
- Child: "I want to talk to Riddle Solver" → Call update_agent_mode(mode_name="Riddle Solver")
</character_switching>
"""

    # Append character change instructions to the prompt
    agent_prompt = agent_prompt + CHARACTER_CHANGE_INSTRUCTIONS

    # ============================================================================
    # GEMINI REALTIME MODEL SETUP
    # ============================================================================

    # Google Search grounding - DISABLED to allow function tools (update_agent_mode, play_music, etc.)
    # Gemini Realtime only supports ONE type of tool - either Google Search OR function tools
    # google_search_grounding = types.GoogleSearch()
    # logger.info("🔍 Google Search grounding enabled")

    # Create Gemini Realtime model - NO custom VAD config (use Gemini's default for faster response)
    # This matches the fast test project (gemini_live-api-livekit/agent.py)
    # Note: _gemini_tools=[] (empty) allows generate_reply to work while using LiveKit function tools
    realtime_model = google.realtime.RealtimeModel(
        model=gemini_model,
        voice=gemini_voice,
        temperature=gemini_temperature,
        modalities=["AUDIO"],
        _gemini_tools=[],  # Empty list - no native Gemini tools, using LiveKit @function_tool instead
    )

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
        except Exception as e:
            logger.error(f"Failed to emit speech_created: {e}")

    @session.on("agent_state_changed")
    def on_agent_state_changed_for_tts(ev):
        """Emit speech_created when agent starts speaking and notify livekit-bridge of state changes"""
        try:
            old_state = getattr(ev, 'old_state', None)
            new_state = getattr(ev, 'new_state', None)

            # Convert states to strings for data channel
            old_state_str = str(old_state).split('.')[-1] if old_state else "unknown"
            new_state_str = str(new_state).split('.')[-1] if new_state else "unknown"

            # Send state change to livekit-bridge via data channel
            async def send_state_change():
                try:
                    payload = json.dumps({
                        "type": "agent_state_changed",
                        "data": {"old_state": old_state_str, "new_state": new_state_str}
                    })
                    await ctx.room.local_participant.publish_data(
                        payload.encode("utf-8"), reliable=True
                    )
                except Exception as e:
                    logger.error(f"Failed to send state change: {e}")

            asyncio.create_task(send_state_change())

            # Also emit speech_created when agent starts speaking
            if new_state_str == 'speaking' and old_state_str != 'speaking':
                asyncio.create_task(emit_speech_created())

        except Exception as e:
            logger.error(f"❌ Error in agent_state_changed handler: {e}")

    # ============================================================================
    # ERROR HANDLING
    # ============================================================================

    from src.agent.error_handler import setup_error_handling
    error_manager = setup_error_handling(
        session=session,
        max_retries=3,
        custom_audio_path=None
    )

    # ============================================================================
    # INITIALIZE ALL SERVICES FOR FUNCTION TOOLS
    # ============================================================================

    # Import additional services needed by Assistant's function tools
    from src.services.music_service import MusicService
    from src.services.story_service import StoryService
    from src.services.semantic_search import QdrantSemanticSearch
    from src.services.unified_audio_player import UnifiedAudioPlayer
    from src.services.google_search_service import GoogleSearchService
    from src.services.question_generator_service import QuestionGeneratorService
    from src.services.riddle_generator_service import RiddleGeneratorService
    from src.services.analytics_service import AnalyticsService

    # Device control services (instant - no async init needed)
    device_control_service = DeviceControlService()
    mcp_executor = LiveKitMCPExecutor()

    # Get preloaded models from cache (loaded during prewarm)
    from src.utils.model_cache import model_cache
    preloaded_embedding = model_cache.get_embedding_model()
    preloaded_qdrant = model_cache.get_qdrant_client()

    # =========================================================================
    # PARALLEL SERVICE INITIALIZATION (optimized for speed)
    # =========================================================================
    parallel_init_start = asyncio.get_event_loop().time()

    # Create service instances (instant)
    shared_semantic_search = QdrantSemanticSearch(preloaded_embedding, preloaded_qdrant)
    unified_audio_player = UnifiedAudioPlayer()
    google_search_service = GoogleSearchService()
    question_generator_service = QuestionGeneratorService()
    riddle_generator_service = RiddleGeneratorService()

    # Analytics service (instant - no async init)
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
        except Exception as e:
            logger.warning(f"Analytics service initialization failed: {e}")

    # Define async init functions
    async def init_semantic_search():
        try:
            await shared_semantic_search.initialize()
            return shared_semantic_search
        except Exception as e:
            logger.warning(f"Semantic search init failed: {e}")
            return None

    async def init_question_generator():
        try:
            await question_generator_service.initialize()
            return question_generator_service
        except Exception as e:
            logger.warning(f"Question generator init failed: {e}")
            return None

    async def init_riddle_generator():
        try:
            await riddle_generator_service.initialize()
            return riddle_generator_service
        except Exception as e:
            logger.warning(f"Riddle generator init failed: {e}")
            return None

    # Run all async initializations in parallel
    init_results = await asyncio.gather(
        init_semantic_search(),
        init_question_generator(),
        init_riddle_generator(),
        return_exceptions=True
    )

    # Unpack results
    shared_semantic_search = init_results[0] if not isinstance(init_results[0], Exception) else None
    question_generator_service = init_results[1] if not isinstance(init_results[1], Exception) else None
    riddle_generator_service = init_results[2] if not isinstance(init_results[2], Exception) else None

    parallel_init_elapsed = (asyncio.get_event_loop().time() - parallel_init_start) * 1000
    logger.info(f"⚡ Services init: {parallel_init_elapsed:.0f}ms")

    # Initialize Music and Story services (depend on semantic search)
    music_service = None
    story_service = None
    if shared_semantic_search:
        music_service = MusicService(shared_semantic_search=shared_semantic_search)
        story_service = StoryService(shared_semantic_search=shared_semantic_search)

        # Parallel init for music and story
        async def init_music():
            try:
                await music_service.initialize()
                return music_service
            except Exception as e:
                logger.warning(f"Music service init failed: {e}")
                return None

        async def init_story():
            try:
                await story_service.initialize()
                return story_service
            except Exception as e:
                logger.warning(f"Story service init failed: {e}")
                return None

        music_story_results = await asyncio.gather(init_music(), init_story(), return_exceptions=True)
        music_service = music_story_results[0] if not isinstance(music_story_results[0], Exception) else None
        story_service = music_story_results[1] if not isinstance(music_story_results[1], Exception) else None

    # ============================================================================
    # CHAT HISTORY SERVICE (instant initialization)
    # ============================================================================
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
        except Exception as e:
            logger.warning(f"Chat history service init failed: {e}")

    # ============================================================================
    # AWAIT MEM0 MEMORIES (background task started earlier)
    # ============================================================================
    retrieved_memories = ""
    if mem0_task:
        try:
            retrieved_memories = await mem0_task
        except Exception as e:
            logger.warning(f"💭 Mem0 retrieval failed: {e}")

    # Inject memories into agent prompt if available
    if retrieved_memories:
        memory_block = f"""
<long_term_memory>
You remember these things about this child from previous conversations:
{retrieved_memories}

Use these memories naturally in conversation - reference their interests, remember their name,
recall previous topics you discussed. This helps build a personal connection with the child.
</long_term_memory>
"""
        agent_prompt = memory_block + "\n" + agent_prompt

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

    # DISABLED: ChatEventHandler event handlers interfere with PTT even without generate_reply()
    # The event handlers themselves seem to be causing state changes during speech
    # ChatEventHandler.set_assistant(assistant)
    # if chat_history_service:
    #     ChatEventHandler.set_chat_history_service(chat_history_service)
    #     logger.info(f"📝🔗 Chat history service connected to event handlers")
    # else:
    #     logger.warning(
    #         f"📝⚠️ No chat history service available - events will not be captured")
    # ChatEventHandler.setup_session_handlers(session, ctx)
    # logger.info("💬 ChatEventHandler configured (PTT-safe mode)")

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
            except Exception as e:
                logger.error(f"💭 Failed to capture message for mem0: {e}")

    # Setup usage tracking
    usage_manager = UsageManager(mac_address=device_mac, session_id=room_name)
    usage_manager.setup_metrics_collection(session)

    async def log_usage():
        """Log usage summary on shutdown"""
        await usage_manager.log_usage()

    ctx.add_shutdown_callback(log_usage)

    # Create room options with 16kHz sample rate to match MQTT gateway
    room_input_options = RoomInputOptions(
        audio_sample_rate=16000,  # Match MQTT gateway's 16kHz audio
        audio_num_channels=1,     # Mono audio from ESP32
    )

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
            # Save conversation to mem0 for long-term memory
            if mem0_provider and conversation_messages:
                try:
                    child_name = child_profile.get('name', '') if child_profile else None
                    history_dict = {'messages': conversation_messages}
                    await mem0_provider.save_memory(history_dict, child_name=child_name)
                except Exception as e:
                    logger.warning(f"💭 Failed to save to mem0: {e}")

            # Close agent session
            try:
                if session and hasattr(session, 'aclose'):
                    await session.aclose()
            except Exception as e:
                pass

            # Disconnect from room
            try:
                if ctx.room and hasattr(ctx.room, 'disconnect'):
                    await ctx.room.disconnect()
            except Exception as e:
                pass

            # Delete room
            try:
                await delete_livekit_room(ctx.room.name if ctx.room else "unknown")
            except Exception as e:
                pass

            # Stop resource monitoring
            resource_monitor.decrement_clients()
            resource_monitor.stop_monitoring()
        except Exception as e:
            logger.error(f"Error during cleanup: {e}")

    @ctx.room.on("participant_disconnected")
    def on_participant_disconnected(participant: rtc.RemoteParticipant):
        nonlocal participant_count
        participant_count -= 1
        if participant_count == 0:
            asyncio.create_task(cleanup_room_and_session())

    @ctx.room.on("participant_connected")
    def on_participant_connected(participant: rtc.RemoteParticipant):
        nonlocal participant_count
        participant_count += 1

    @ctx.room.on("disconnected")
    def on_room_disconnected():
        asyncio.create_task(cleanup_room_and_session())

    ctx.add_shutdown_callback(cleanup_room_and_session)

    # ============================================================================
    # WAIT FOR PARTICIPANT AND START SESSION
    # (Already connected earlier to access room metadata)
    # ============================================================================

    participant = await ctx.wait_for_participant()

    # Pass references to assistant
    assistant.set_agent_session(session)
    assistant._session_context = ctx

    # Set session and context on unified audio player (needed for music/story playback)
    if unified_audio_player:
        unified_audio_player.set_session(session)
        unified_audio_player.set_context(ctx)

    # Start session
    await session.start(
        room=ctx.room,
        agent=assistant,
    )

    # Log initialization time
    init_elapsed_time = (asyncio.get_event_loop().time() - init_start_time) * 1000
    logger.info(f"✅ Agent LIVE in {init_elapsed_time:.0f}ms")

    # Agent speaks first - greet the child
    # Optimized: No fixed sleep, uses event-based readiness check
    async def trigger_greeting():
        """Trigger greeting with minimal delay using session readiness check"""
        greeting_audio_started = asyncio.Event()
        session_ready = asyncio.Event()

        # Listen for agent state changes
        def on_state_for_greeting(ev):
            new_state = str(getattr(ev, 'new_state', '')).split('.')[-1]
            old_state = str(getattr(ev, 'old_state', '')).split('.')[-1]

            # Session is ready when we see first state transition (usually initializing -> listening)
            if old_state == 'initializing' and new_state == 'listening':
                session_ready.set()

            if new_state == 'speaking':
                greeting_audio_started.set()

        # Add listener
        session.on("agent_state_changed", on_state_for_greeting)

        try:
            # Wait for session to be ready (max 500ms, usually instant since session.start() already completed)
            try:
                await asyncio.wait_for(session_ready.wait(), timeout=0.5)
            except asyncio.TimeoutError:
                pass  # Session might already be past initializing state

            # Small buffer for WebSocket stability (reduced from 2.5s to 200ms)
            await asyncio.sleep(0.2)

            # Get child's name for personalized greeting
            child_name = child_profile.get('name', '') if child_profile else ''

            # Try generate_reply first (uses Gemini's native voice)
            try:
                await session.generate_reply(
                    instructions=f"""Start the conversation now! Say hello to {child_name or 'the child'}.
Introduce yourself briefly and ask how they're doing today.
Be warm, friendly and enthusiastic! Speak naturally."""
                )

                # Wait up to 2 seconds for audio to actually start
                try:
                    await asyncio.wait_for(greeting_audio_started.wait(), timeout=2.0)
                    return  # Success, exit
                except asyncio.TimeoutError:
                    pass  # Try fallback

            except Exception as e:
                pass  # Try fallback

            # Fallback: Use session.say() with Edge TTS
            fallback_greeting = f"Hey {child_name}! " if child_name else "Hey there! "
            fallback_greeting += "I'm so happy to see you! How are you doing today?"
            await session.say(fallback_greeting, allow_interruptions=True)

        except Exception as e:
            logger.warning(f"⚠️ Greeting failed: {e}")

    asyncio.create_task(trigger_greeting())


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
        job_executor_type=JobExecutorType.THREAD

    ))
