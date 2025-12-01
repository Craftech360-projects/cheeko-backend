#!/usr/bin/env python3
"""
Enhanced LiveKit Agent for Cheeko
Full-featured implementation with all production capabilities
Includes music, stories, memory, database integration, and advanced services
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
from jinja2 import Template

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
    function_tool,
    Agent,
    RunContext,
    RoomInputOptions,
    RoomOutputOptions,
)
from livekit.agents.llm import ChatContext
from livekit import rtc
from livekit.plugins import silero, groq, noise_cancellation

# Load environment variables first
load_dotenv(".env")

# Initialize Datadog logging (must be done before logger usage)
from src.config.datadog_config import DatadogConfig
DatadogConfig.setup_logging()

# Import all components for full functionality
from src.providers.provider_factory import ProviderFactory
from src.config.config_loader import ConfigLoader
from src.utils.model_preloader import model_preloader
from src.utils.model_cache import model_cache
from src.utils.database_helper import DatabaseHelper
from src.services.chat_history_service import ChatHistoryService
from src.services.analytics_service import AnalyticsService
from src.services.prompt_service import PromptService
from src.services.unified_audio_player import UnifiedAudioPlayer
from src.services.foreground_audio_player import ForegroundAudioPlayer
from src.services.story_service import StoryService
from src.services.music_service import MusicService
from src.services.google_search_service import GoogleSearchService
from src.mcp.device_control_service import DeviceControlService
from src.mcp.mcp_executor import LiveKitMCPExecutor
from src.utils.helpers import UsageManager
from src.handlers.chat_logger import ChatEventHandler
from src.agent.main_agent import Assistant
from src.memory.mem0_provider import Mem0MemoryProvider
from src.services.question_generator_service import QuestionGeneratorService
from src.services.riddle_generator_service import RiddleGeneratorService

logger = logging.getLogger("agent")


async def delete_livekit_room(room_name: str):
    """Delete a LiveKit room using the API"""
    try:
        # Get LiveKit credentials from environment
        livekit_url = os.getenv("LIVEKIT_URL", "").replace(
            "ws://", "http://").replace("wss://", "https://")
        api_key = os.getenv("LIVEKIT_API_KEY")
        api_secret = os.getenv("LIVEKIT_API_SECRET")

        if not all([livekit_url, api_key, api_secret]):
            logger.warning(
                "LiveKit credentials not configured for room deletion")
            return

        # For LiveKit Cloud, use the management API
        # For self-hosted, this would be different
        from livekit import api

        # Create API client
        lk_api = api.LiveKitAPI(
            url=livekit_url,
            api_key=api_key,
            api_secret=api_secret,
        )

        # Delete the room using the correct API method
        from livekit.api import DeleteRoomRequest
        request = DeleteRoomRequest(room=room_name)
        await lk_api.room.delete_room(request)
        logger.info(f"🗑️ Successfully deleted room: {room_name}")

    except ImportError:
        logger.warning(
            "LiveKit API client not available, using HTTP API directly")
        # Fallback to direct HTTP API call
        try:
            import jwt
            import time

            # Generate access token for API call
            now = int(time.time())
            token_payload = {
                "exp": now + 600,  # 10 minutes
                "iss": api_key,
                "nbf": now,
                "sub": api_key,
                "roomAdmin": True,
                "room": room_name,
            }
            token = jwt.encode(token_payload, api_secret, algorithm="HS256")

            # Make API call to delete room
            async with aiohttp.ClientSession() as session:
                try:
                    headers = {"Authorization": f"Bearer {token}"}
                    url = f"{livekit_url}/twirp/livekit.RoomService/DeleteRoom"
                    payload = {"room": room_name}

                    async with session.post(url, json=payload, headers=headers) as resp:
                        if resp.status == 200:
                            logger.info(
                                f"🗑️ Successfully deleted room via API: {room_name}")
                        else:
                            logger.error(
                                f"Failed to delete room: {resp.status}")
                finally:
                    await session.close()
        except Exception as e:
            logger.error(f"Failed to delete room via HTTP API: {e}")
    except Exception as e:
        logger.error(f"Failed to delete room: {e}")

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
            # System-wide metrics
            cpu_percent = psutil.cpu_percent(interval=1)
            memory = psutil.virtual_memory()
            disk = psutil.disk_usage('/')
            
            # Process-specific metrics
            process = psutil.Process()
            process_cpu = process.cpu_percent()
            process_memory = process.memory_info()
            process_threads = process.num_threads()
            
            # Network I/O
            net_io = psutil.net_io_counters()
            
            # Uptime
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
            
            # Enhanced alerting with performance recommendations
            if cpu_percent > 80:
                logger.warning(f"⚠️ HIGH CPU USAGE: {cpu_percent:.1f}% - Consider reducing client load")
            if memory.percent > 85:
                logger.warning(f"⚠️ HIGH MEMORY USAGE: {memory.percent:.1f}% - Memory cleanup recommended")
            if self.client_count > 4 and cpu_percent > 60:
                logger.warning(f"⚠️ PERFORMANCE RISK: {self.client_count} clients, CPU {cpu_percent:.1f}% - Audio jitter possible")
            if self.client_count > 6:
                logger.error(f"🚨 OVERLOAD: {self.client_count} clients exceeds recommended limit of 6")
            
            # Performance optimization suggestions
            if cpu_percent > 70 and self.client_count > 2:
                logger.info(f"💡 OPTIMIZATION TIP: High CPU with {self.client_count} clients - consider process scaling")
            if process_memory.rss/1024/1024 > 500:  # 500MB
                logger.info(f"💡 MEMORY TIP: Process using {process_memory.rss/1024/1024:.1f}MB - consider restart if growing")
                
        except Exception as e:
            logger.error(f"📊 Failed to log resources: {e}")

# Global resource monitor
resource_monitor = ResourceMonitor(log_interval=10)  # Log every 10 seconds (reduced thread activity)

# The Assistant class is now imported from src.agent.main_agent
# No need to define it here - it includes all the enhanced functionality

def prewarm(proc: JobProcess):
    """Enhanced prewarm function with full service preloading"""
    logger.info("[PREWARM] Enhanced prewarm: Loading all models and services")

    # Start background model loading if not already started
    if not model_preloader.is_ready():
        model_preloader.start_background_loading()

    # Load VAD model directly on main thread (required by Silero)
    if "vad_model" not in model_cache._models:
        logger.info("[PREWARM] Loading VAD model on main thread...")
        vad = ProviderFactory.create_vad()
        model_cache._models["vad_model"] = vad
        logger.info("[PREWARM] VAD model loaded and cached")
    else:
        vad = model_cache._models["vad_model"]
        logger.info("[PREWARM] Using cached VAD model")

    proc.userdata["vad"] = vad
    proc.userdata["embedding_model"] = model_cache.get_embedding_model()
    proc.userdata["qdrant_client"] = model_cache.get_qdrant_client()

    # Store service initialization info for later use
    proc.userdata["service_cache_ready"] = True

    # Log cache status
    stats = model_cache.get_cache_stats()
    logger.info(
        f"[PREWARM] Enhanced prewarm complete: {stats['cache_size']} models cached")

    # Optional: Wait briefly for background loading (non-blocking)
    if not model_preloader.is_ready():
        logger.info("[PREWARM] Background model loading in progress...")
        # Don't wait - let the session start immediately

async def entrypoint(ctx: JobContext):
    """Enhanced entrypoint with full production features"""
    ctx.log_context_fields = {"room": ctx.room.name}
    print(f"Starting enhanced agent in room: {ctx.room.name}")

    # PERFORMANCE: Track total initialization time
    init_start_time = asyncio.get_event_loop().time()

    # Start resource monitoring for this session
    resource_monitor.start_monitoring()
    resource_monitor.increment_clients()

    # Load configuration (environment variables already loaded at module level)
    groq_config = ConfigLoader.get_groq_config()
    agent_config = ConfigLoader.get_agent_config()
    # Note: TTS config will be loaded later after fetching from API

    # Extract MAC address from room name and fetch device-specific prompt
    prompt_service = PromptService()

    # Using direct API-based prompt fetching (no template system)
    logger.info("📄 Using direct API-based prompt fetching")

    room_name = ctx.room.name

    # Parse room name to extract MAC address and room type
    # Format: UUID_MAC_ROOMTYPE (e.g., "abc123_00163eacb538_conversation")
    # or legacy: UUID_MAC (e.g., "abc123_00163eacb538")
    device_mac = None
    room_type = None

    if '_' in room_name:
        parts = room_name.split('_')
        if len(parts) >= 3:
            # New format: UUID_MAC_ROOMTYPE
            room_type = parts[-1]  # Last part is room type
            mac_part = parts[-2]   # Second-to-last part is MAC without colons

            # Reconstruct MAC with colons: 00163eacb538 → 00:16:3e:ac:b5:38
            if len(mac_part) == 12 and mac_part.isalnum():  # Valid MAC length and hex
                device_mac = ':'.join(mac_part[i:i+2] for i in range(0, 12, 2))
                logger.info(f"📱 Extracted from room '{room_name}': MAC={device_mac}, Room Type={room_type}")
        elif len(parts) >= 2:
            # Legacy format: UUID_MAC (backward compatibility)
            mac_part = parts[-1]
            if len(mac_part) == 12 and mac_part.isalnum():
                device_mac = ':'.join(mac_part[i:i+2] for i in range(0, 12, 2))
                room_type = "conversation"  # Default to conversation for legacy format
                logger.info(f"📱 Extracted MAC from legacy room name: {device_mac} (defaulting to conversation)")

    # CRITICAL: Only proceed if room_type is "conversation"
    # Agents should NEVER join music or story rooms (those have media bots)
    if room_type and room_type != "conversation":
        logger.warning(f"⚠️ Agent dispatched to '{room_type}' room - this should NOT happen!")
        logger.warning(f"⚠️ Agents should only join 'conversation' rooms, not '{room_type}' rooms")
        logger.warning(f"⚠️ Exiting agent to prevent conflict with media bot in room: {room_name}")
        return  # Exit early - don't start the agent

    # Helper function for Mem0 query to run in parallel
    async def query_mem0_memories(mac: str) -> tuple:
        """Query Mem0 for existing memories - runs in parallel with API calls"""
        try:
            mem0_api_key = os.getenv("MEM0_API_KEY")
            mem0_enabled = os.getenv("MEM0_ENABLED", "false").lower() == "true"

            if not mem0_enabled or not mac:
                return None, None

            if not mem0_api_key or mem0_api_key == "your_mem0_api_key_here":
                logger.warning("💭⚠️ MEM0_API_KEY not configured properly")
                return None, None

            logger.info(f"💭 Initializing Mem0MemoryProvider for MAC: {mac}")
            provider = Mem0MemoryProvider(api_key=mem0_api_key, role_id=mac)

            logger.info("💭 Getting all memories from mem0...")
            memories = await provider.get_all_memories()

            if memories:
                logger.info(f"💭✅ Loaded memories from mem0 ({len(memories)} chars)")
            else:
                logger.info("💭 No existing memories found in mem0")

            return provider, memories
        except Exception as e:
            logger.error(f"💭❌ Failed to query mem0: {e}")
            import traceback
            logger.error(f"💭❌ Traceback: {traceback.format_exc()}")
            return None, None

    # OPTIMIZATION PHASE 1 + 1.5: Parallel API Calls + Mem0 Query
    # Fetch all API data and Mem0 memories in parallel to maximize concurrency
    chat_history_service = None
    analytics_service = None
    tts_config_from_api = None
    child_profile = None
    agent_prompt = None
    db_helper = None
    agent_id = None
    mem0_provider = None
    memories = None
    current_character = "Conversation"  # Default mode

    if device_mac:
        try:
            logger.info("⚡ Starting parallel API calls + Mem0 query...")
            start_time = asyncio.get_event_loop().time()

            # Get Manager API configuration
            manager_api_url = os.getenv("MANAGER_API_URL")
            manager_api_secret = os.getenv("MANAGER_API_SECRET")

            # Create database helper
            db_helper = DatabaseHelper(manager_api_url, manager_api_secret)

            # Clear prompt cache to ensure fresh prompt on new session
            logger.info("🔄 Clearing prompt cache for new session")
            prompt_service.clear_cache()
            prompt_service.clear_enhanced_cache(device_mac)

            # Using direct API-based prompt fetching
            logger.info("📄 Fetching prompt and config from API in parallel")

            results = await asyncio.gather(
                db_helper.get_agent_id(device_mac),                          # ~200ms
                prompt_service.get_prompt_and_config(room_name, device_mac), # ~500ms (gets prompt + TTS config)
                db_helper.get_child_profile_by_mac(device_mac),             # ~500ms
                query_mem0_memories(device_mac),                             # ~1700ms (PARALLEL!)
                db_helper.get_current_character(device_mac),                 # ~200ms
                return_exceptions=True  # Don't fail all if one fails
            )

            elapsed_time = (asyncio.get_event_loop().time() - start_time) * 1000
            logger.info(f"⚡✅ Parallel API calls + Mem0 completed in {elapsed_time:.0f}ms")

            # Unpack results from API calls
            agent_id_result, prompt_config_result, child_profile_result, mem0_result, character_result = results

            # Process agent_id result
            if isinstance(agent_id_result, Exception):
                logger.error(f"📝❌ Failed to get agent_id: {agent_id_result}")
                agent_id = None
            else:
                agent_id = agent_id_result
                logger.info(f"📝 Agent ID fetched: {agent_id}")

            # Process prompt and config result from API
            if isinstance(prompt_config_result, Exception):
                logger.warning(f"Failed to fetch config from API for MAC {device_mac}: {prompt_config_result}")
                agent_prompt = ConfigLoader.get_default_prompt()
                tts_config_from_api = None
                logger.info(f"📄 Fallback to default prompt (length: {len(agent_prompt)} chars)")
            else:
                agent_prompt, tts_config_from_api = prompt_config_result
                logger.info(f"🎯 Using device-specific prompt for MAC: {device_mac} (length: {len(agent_prompt)} chars)")
                # Log first few lines of the fetched prompt for verification
                prompt_lines = agent_prompt.split('\n')[:5]
                logger.info(f"📝 Fetched prompt preview: {' | '.join(line.strip()[:50] for line in prompt_lines if line.strip())}")

                if tts_config_from_api:
                    logger.info(f"🎤 TTS Config from API: Provider={tts_config_from_api.get('provider')}, Type={tts_config_from_api.get('type')}")
                else:
                    logger.warning(f"⚠️ No TTS config from API, will use .env defaults")

            # Process child profile result
            if isinstance(child_profile_result, Exception):
                logger.warning(f"Failed to fetch child profile for MAC {device_mac}: {child_profile_result}")
                child_profile = None
            else:
                child_profile = child_profile_result
                if child_profile:
                    logger.info(f"👶 Child profile loaded: {child_profile.get('name')}, age {child_profile.get('age')} ({child_profile.get('ageGroup')})")
                else:
                    logger.info(f"👶 No child profile assigned to device {device_mac}")
                    
                question_generator_service = QuestionGeneratorService()
                await question_generator_service.initialize()
                if question_generator_service.is_available():
                    logger.info("🧮 Question Generator Service initialized and ready")
                else:
                    logger.warning("🧮 Question Generator Service not available (check .env: GROQ_API_KEY)")
                    
                    # Initialize Riddle Generator Service (for riddle game)
                
                riddle_generator_service = RiddleGeneratorService()
                await riddle_generator_service.initialize()
                if riddle_generator_service.is_available():
                    logger.info("🧩 Riddle Generator Service initialized and ready")
                else:
                    logger.warning("🧩 Riddle Generator Service not available (check .env: GROQ_API_KEY)")



            # Process Mem0 result
            if isinstance(mem0_result, Exception):
                logger.error(f"💭❌ Mem0 query failed: {mem0_result}")
                mem0_provider = None
                memories = None
            else:
                mem0_provider, memories = mem0_result

            # Process character result
            if isinstance(character_result, Exception):
                logger.error(f"📝❌ Failed to get character: {character_result}")
                current_character = "Conversation"  # Default
            else:
                current_character = character_result if character_result else "Conversation"
                logger.info(f"📝 Current character/mode: {current_character}")

            # Create chat history service if we have agent_id
            if agent_id:
                chat_history_service = ChatHistoryService(
                    manager_api_url=manager_api_url,
                    secret=manager_api_secret,
                    device_mac=device_mac,
                    session_id=room_name,
                    agent_id=agent_id
                )
                chat_history_service.start_periodic_sending()
                logger.info(f"📝✅ Chat history service initialized for MAC: {device_mac}, Agent ID: {agent_id}")
                logger.info(f"📝📊 Service config: batch_size={chat_history_service.batch_size}, interval={chat_history_service.send_interval}s")

                # Create analytics service
                analytics_service = AnalyticsService(
                    manager_api_url=manager_api_url,
                    secret=manager_api_secret,
                    device_mac=device_mac,
                    session_id=room_name,
                    agent_id=agent_id
                )
                logger.info(f"📊✅ Analytics service initialized for MAC: {device_mac}, Session: {room_name}")

        except Exception as e:
            logger.error(f"❌ Error in parallel API calls: {e}")
            agent_prompt = ConfigLoader.get_default_prompt()
            tts_config_from_api = None
            child_profile = None
            chat_history_service = None
            analytics_service = None
    else:
        # No device MAC - use defaults
        agent_prompt = ConfigLoader.get_default_prompt()
        tts_config_from_api = None
        logger.info(f"📄 Using default prompt - no MAC in room name '{room_name}' (length: {len(agent_prompt)} chars)")

    # Initialize conversation buffer for mem0
    conversation_messages = []  # Buffer to store conversation messages
    EMOJI_List = ["😶", "🙂", "😆", "😂", "😔", "😠", "😭", "😍", "😳",
                  "😲", "😱", "🤔", "😉", "😎", "😌", "🤤", "😘", "😏", "😴", "😜", "🙄"]

    # Prepare template variables (only for legacy system)
    template_vars = {
        'emojiList': EMOJI_List,
        'child_name': child_profile.get('name', '') if child_profile else '',  # Empty string = hidden
        'child_age': child_profile.get('age', '') if child_profile else '',
        'age_group': child_profile.get('ageGroup', '') if child_profile else '',
        'child_gender': child_profile.get('gender', '') if child_profile else '',
        'child_interests': child_profile.get('interests', '') if child_profile else ''
    }

    # Render agent prompt with Jinja2 template variables (legacy system)
    if any(placeholder in agent_prompt for placeholder in ['{{', '{%']):
        template = Template(agent_prompt)
        agent_prompt = template.render(**template_vars)
        logger.info("🎨 Rendered agent prompt with template variables (legacy)")
        if child_profile:
            logger.info(f"👶 Personalized for: {template_vars['child_name']}, {template_vars['child_age']} years old")
    else:
        logger.info("📄 Using legacy prompt system")

    # Inject Mem0 memories into prompt (already fetched in parallel)
    if memories:
        # Use enhanced format for better personalization
        memory_injection = f"""<user_profile>
Here is what I know about the child:
{memories}
</user_profile>
IMPORTANT: Use these facts to personalize the conversation. Ask about their specific interests, pets, or friends mentioned in the profile."""
        agent_prompt = agent_prompt.replace("<memory>", memory_injection)
        logger.info(f"💭 Injected memories into prompt ({len(memories)} chars)")
        logger.debug(f"💭 Memory content:\n{memories}")

    # Log the full prompt after memory injection
    logger.info(f"📝 Full prompt after memory injection:\n{'-'*50}\n{agent_prompt}\n{'-'*50}")

    # Get VAD first as it's needed for STT
    vad = ctx.proc.userdata["vad"]

    # Create providers using factory
    llm = ProviderFactory.create_llm(groq_config)

    # Log LLM info for debugging (but don't hook into it - use conversation events instead)
    if chat_history_service:
        logger.debug(
            f"🧠 Using LLM type: {type(llm)} (will capture responses via conversation_item_added event)")

    # Determine if VAD should be used based on config
    stt_provider_name = groq_config.get('stt_provider', 'groq')
    stt_use_vad_config = groq_config.get('stt_use_vad', 'auto')

    # Auto mode: disable VAD for streaming STT providers (chirp, google)
    if stt_use_vad_config == 'auto':
        use_vad = stt_provider_name not in ('chirp', 'google')
    else:
        use_vad = stt_use_vad_config == 'true'

    session_vad = vad if use_vad else None
    logger.info(f"🎤 VAD config: stt_use_vad={stt_use_vad_config}, use_vad={use_vad}")

    # STT Provider via ProviderFactory (supports chirp, groq, deepgram, openai, etc.)
    stt = ProviderFactory.create_stt(groq_config, session_vad)
    logger.info(f"🎤 Final STT Provider: {stt_provider_name}")

    # Get STT wrapper reference for mute control (only for chirp/google)
    stt_wrapper = None
    if stt_provider_name in ('chirp', 'google'):
        # Try to get the wrapper from FallbackAdapter or direct reference
        from src.providers.google_chirp_stt_wrapper import GoogleChirpSTTWrapper
        if isinstance(stt, GoogleChirpSTTWrapper):
            stt_wrapper = stt
        elif hasattr(stt, '_adapters'):
            # FallbackAdapter - get first adapter which should be our wrapper
            for adapter in stt._adapters:
                if isinstance(adapter, GoogleChirpSTTWrapper):
                    stt_wrapper = adapter
                    break
        if stt_wrapper:
            logger.info("🎤 STT wrapper reference obtained for mute control")

    # Get TTS config, with API override if available
    tts_config = ConfigLoader.get_tts_config(api_config=tts_config_from_api)
    tts = ProviderFactory.create_tts(groq_config, tts_config)

    logger.info(f"🎤 Final TTS Provider: {tts_config.get('provider')}")

    # Disable turn detection to avoid timeout issues
    turn_detection = ProviderFactory.create_turn_detection()

    # Set up voice AI pipeline with interruption handling
    session = AgentSession(
        llm=llm,
        stt=stt,
        tts=tts,
        turn_detection=turn_detection,  # Disabled to avoid timeout
        vad=session_vad,
        preemptive_generation=agent_config['preemptive_generation'],
        # Interruption settings
        allow_interruptions=False,  # Don't allow user to interrupt agent mid-turn
        discard_audio_if_uninterruptible=False,  # Keep False to allow audio recording for debugging
        min_interruption_duration=0.8,  # Minimum speech duration (0.8s) before triggering interruption
        min_interruption_words=2,  # Require at least 2 words to consider an interruption
        # Endpointing settings (turn completion)
        min_endpointing_delay=0.8,  # Wait 0.8s of silence before considering turn complete
        max_endpointing_delay=6.0,  # Max wait for user to continue speaking
        # False interruption handling
        false_interruption_timeout=2.0,  # Wait 2s before signaling false interruption
        resume_false_interruption=True,  # Resume agent speech after false interruption
    )

    # Add comprehensive error handling using our error handler module
    from src.agent.error_handler import setup_error_handling
    
    # Set up comprehensive error handling with retry logic
    error_manager = setup_error_handling(
        session=session,
        max_retries=3,
        custom_audio_path=None  # Will use default path
    )
    
    logger.info("🛡️ Comprehensive error handling enabled with retry logic")

    # Get preloaded models from prewarm
    preloaded_embedding_model = ctx.proc.userdata.get("embedding_model")
    preloaded_qdrant_client = ctx.proc.userdata.get("qdrant_client")

    # Try to use cached services first, otherwise create new ones
    music_service = model_cache.get_cached_service("music_service")
    story_service = model_cache.get_cached_service("story_service")

    services_from_cache = False

    if music_service and story_service:
        logger.info("[FAST] Using cached music and story services")
        services_from_cache = True
    else:
        logger.info("[INIT] Creating new music and story services...")
        # Create new services with preloaded models

        music_service = MusicService(
            preloaded_embedding_model, preloaded_qdrant_client)
        story_service = StoryService(
            preloaded_embedding_model, preloaded_qdrant_client)

    audio_player = ForegroundAudioPlayer()
    unified_audio_player = UnifiedAudioPlayer()

    # Create device control service and MCP executor
    device_control_service = DeviceControlService()
    mcp_executor = LiveKitMCPExecutor()
    logger.info("🎛️ Device control service and MCP executor created")

    # Initialize Google Search service (Wikipedia-only)
    google_search_service = GoogleSearchService()
    if google_search_service.is_available():
        logger.info("📚 Wikipedia search service initialized and ready")
    else:
        logger.info("📚 Wikipedia search service disabled (check .env: GOOGLE_SEARCH_ENABLED, GOOGLE_API_KEY, GOOGLE_SEARCH_ENGINE_ID)")

    # Create enhanced assistant with dynamic prompt and inject services
    assistant = Assistant(instructions=agent_prompt, tts_provider=tts)
    assistant.set_services(music_service, story_service,
                           audio_player, unified_audio_player, device_control_service, mcp_executor,
                           google_search_service, question_generator_service, riddle_generator_service, analytics_service)
    # Pass room name and device MAC to assistant
    assistant.set_room_info(room_name=room_name, device_mac=device_mac)
    # Log session info (responses will be captured via conversation_item_added event)
    if chat_history_service:
        logger.debug(
            "🎯 Chat history service ready - will capture via conversation_item_added and session.history")

    # Setup event handlers and pass assistant reference for abort handling
    ChatEventHandler.set_assistant(assistant)
    ChatEventHandler.set_stt_provider(stt_provider_name)
    if stt_wrapper:
        ChatEventHandler.set_stt_wrapper(stt_wrapper)
        logger.info("🎤 STT wrapper connected for mute control")
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
    usage_manager = UsageManager()

    async def log_usage():
        """Log usage summary on shutdown"""
        await usage_manager.log_usage()
        logger.info("Sent usage_summary via data channel")

    ctx.add_shutdown_callback(log_usage)

    # OPTIMIZATION PHASE 2: Initialize services in parallel (cold start only)
    if not services_from_cache:
        logger.info("[INIT] Initializing music and story services in parallel...")
        init_services_start = asyncio.get_event_loop().time()

        try:
            # Run both service initializations in parallel
            init_results = await asyncio.gather(
                music_service.initialize(),
                story_service.initialize(),
                return_exceptions=True
            )

            init_elapsed = (asyncio.get_event_loop().time() - init_services_start) * 1000
            logger.info(f"[INIT] Parallel service initialization completed in {init_elapsed:.0f}ms")

            # Process results
            music_init_result, story_init_result = init_results

            # Handle music service initialization
            if isinstance(music_init_result, Exception):
                logger.error(f"[INIT] Music service initialization failed: {music_init_result}")
                music_initialized = False
            else:
                music_initialized = music_init_result

            # Handle story service initialization
            if isinstance(story_init_result, Exception):
                logger.error(f"[INIT] Story service initialization failed: {story_init_result}")
                story_initialized = False
            else:
                story_initialized = story_init_result

            # Now fetch metadata in parallel for successfully initialized services
            if music_initialized or story_initialized:
                logger.info("[INIT] Fetching service metadata in parallel...")
                metadata_start = asyncio.get_event_loop().time()

                metadata_results = await asyncio.gather(
                    music_service.get_all_languages() if music_initialized else None,
                    story_service.get_all_categories() if story_initialized else None,
                    return_exceptions=True
                )

                metadata_elapsed = (asyncio.get_event_loop().time() - metadata_start) * 1000
                logger.info(f"[INIT] Parallel metadata fetch completed in {metadata_elapsed:.0f}ms")

                # Process metadata results
                languages_result, categories_result = metadata_results

                if music_initialized:
                    # Cache the initialized service
                    model_cache.cache_service("music_service", music_service)
                    if languages_result and not isinstance(languages_result, Exception):
                        logger.info(f"[INIT] Music service initialized with {len(languages_result)} languages")
                    else:
                        logger.warning("[INIT] Failed to fetch music languages")
                else:
                    logger.warning("[INIT] Music service initialization failed")

                if story_initialized:
                    # Cache the initialized service
                    model_cache.cache_service("story_service", story_service)
                    if categories_result and not isinstance(categories_result, Exception):
                        logger.info(f"[INIT] Story service initialized with {len(categories_result)} categories")
                    else:
                        logger.warning("[INIT] Failed to fetch story categories")
                else:
                    logger.warning("[INIT] Story service initialization failed")

        except Exception as e:
            logger.error(f"[INIT] Failed to initialize music/story services: {e}")
    else:
        # OPTIMIZATION: Services are from cache, check status in parallel
        try:
            logger.info("[FAST] Checking cached services status in parallel...")
            check_start = asyncio.get_event_loop().time()

            # Run service status checks in parallel
            status_results = await asyncio.gather(
                music_service.get_all_languages() if (music_service and music_service.is_initialized) else None,
                story_service.get_all_categories() if (story_service and story_service.is_initialized) else None,
                return_exceptions=True
            )

            check_elapsed = (asyncio.get_event_loop().time() - check_start) * 1000
            logger.info(f"[FAST] Service status checks completed in {check_elapsed:.0f}ms")

            # Process results
            languages_result, categories_result = status_results

            if languages_result and not isinstance(languages_result, Exception):
                logger.info(f"[FAST] Music service ready with {len(languages_result)} languages")

            if categories_result and not isinstance(categories_result, Exception):
                logger.info(f"[FAST] Story service ready with {len(categories_result)} categories")

        except Exception as e:
            logger.warning(f"[FAST] Error checking cached services: {e}")

    # Create room input options with 16kHz sample rate to match MQTT gateway
    # This ensures audio from ESP32 devices (16kHz) is not resampled unnecessarily
    room_input_options = RoomInputOptions(
        audio_sample_rate=16000,  # Match MQTT gateway's 16kHz audio
        audio_num_channels=1,     # Mono audio from ESP32
    )
    logger.info("Room input configured: 16kHz mono audio to match MQTT gateway")

    # Create room output options - CRITICAL: audio_enabled must be True to publish TTS audio
    room_output_options = RoomOutputOptions(
        audio_enabled=True,       # Enable audio output (TTS to room)
        audio_sample_rate=24000,  # Match EdgeTTS output sample rate
        audio_num_channels=1,     # Mono audio output
    )
    logger.info("Room output configured: 24kHz mono audio output enabled")

    # Add noise cancellation if enabled
    if agent_config['noise_cancellation']:
        try:
            room_input_options = RoomInputOptions(
                audio_sample_rate=16000,
                audio_num_channels=1,
                # noise_cancellation=noise_cancellation.BVC()
            )
            logger.info("Noise cancellation enabled (requires LiveKit Cloud)")
        except Exception as e:
            logger.warning(f"Could not enable noise cancellation: {e}")
            logger.info("Continuing without noise cancellation (local server mode)")
    else:
        logger.info("Noise cancellation disabled by configuration")

    # Track participants and manage room lifecycle
    participant_count = len(ctx.room.remote_participants)
    cleanup_completed = False

    async def cleanup_room_and_session():
        """Cleanup room and session when participant leaves"""
        nonlocal cleanup_completed
        if cleanup_completed:
            return
        cleanup_completed = True

        try:
            logger.info("🔴 Initiating room and session cleanup")

            # 1. Save conversation to mem0 cloud (using captured messages buffer)
            try:
                if mem0_provider and conversation_messages:
                    message_count = len(conversation_messages)

                    logger.info(
                        f"💭 Saving {message_count} messages to mem0 cloud")

                    # Create history dict from conversation buffer
                    history_dict = {'messages': conversation_messages}

                    # Get child name from child_profile for proper identification
                    child_name = child_profile.get('name') if child_profile else None

                    # Save to mem0 with child name context
                    await mem0_provider.save_memory(history_dict, child_name=child_name)

                    logger.info(
                        f"💭✅ Session saved to mem0 cloud ({message_count} messages)")

                    # Log sample for verification
                    if message_count > 0:
                        for i, msg in enumerate(conversation_messages[-3:]):
                            role = msg.get('role', 'unknown')
                            content = msg.get('content', '')
                            if isinstance(content, list):
                                content = ' '.join(str(item)
                                                   for item in content)
                            logger.debug(
                                f"💭 Message {i}: {role} - '{str(content)[:50]}...'")
                else:
                    if mem0_provider:
                        logger.warning(
                            f"💭⚠️ No conversation messages captured (buffer size: {len(conversation_messages)})")
                    else:
                        logger.info("💭 Mem0 not enabled")
            except Exception as e:
                logger.error(f"💭❌ Failed to save to mem0: {e}")
                import traceback
                logger.debug(f"💭❌ Traceback: {traceback.format_exc()}")

            # 2. Log error statistics from our error handler
            try:
                error_stats = error_manager.get_error_stats()
                if error_stats:
                    logger.info(f"📊 Session error statistics: {error_stats}")
                    total_errors = sum(error_stats.values())
                    if total_errors > 0:
                        logger.warning(f"⚠️ Total errors encountered: {total_errors}")
                    else:
                        logger.info("✅ No errors encountered during session")
                else:
                    logger.info("📊 No error statistics available")
            except Exception as e:
                logger.warning(f"📊 Could not retrieve error statistics: {e}")

            # 3. Cleanup chat history service
            try:
                if chat_history_service:
                    logger.info("📝 Cleaning up chat history service")
                    await chat_history_service.cleanup()
            except Exception as e:
                logger.warning(f"📝❌ Chat history cleanup error: {e}")

            # 3.5. End analytics session
            try:
                if analytics_service:
                    logger.info("📊 Ending analytics session")
                    await analytics_service.end_session(completion_status="completed")
                    logger.info("📊✅ Analytics session ended")
            except Exception as e:
                logger.warning(f"📊❌ Analytics session end error: {e}")

            # 4. End the agent session (use aclose() method)
            try:
                if session and hasattr(session, 'aclose'):
                    logger.info("Ending agent session")
                    await session.aclose()
            except Exception as e:
                logger.warning(
                    f"Session close error (expected during shutdown): {e}")

            # 5. Stop audio services and clear audio state
            try:
                if audio_player:
                    await audio_player.stop()
                if unified_audio_player:
                    await unified_audio_player.stop()

                # CRITICAL: Force clear audio state manager to prevent stuck state
                from src.utils.audio_state_manager import audio_state_manager
                audio_state_manager.force_stop_music()
                logger.info("🎵 Cleared audio state manager on disconnect")
            except Exception as e:
                logger.warning(f"Audio service stop error: {e}")

            # 6. Clean up music and story services (if cleanup methods exist)
            try:
                if music_service and hasattr(music_service, 'cleanup'):
                    await music_service.cleanup()
                if story_service and hasattr(story_service, 'cleanup'):
                    await story_service.cleanup()
            except Exception as e:
                logger.warning(f"Service cleanup error: {e}")

            # 7. Disconnect from room (gracefully handle already disconnected)
            try:
                if ctx.room and hasattr(ctx.room, 'disconnect'):
                    logger.info("Disconnecting from LiveKit room")
                    await ctx.room.disconnect()
            except Exception as e:
                logger.warning(
                    f"Room disconnect error (may already be disconnected): {e}")

            # 8. Request room deletion via API (requires admin token)
            try:
                room_name = ctx.room.name if ctx.room else "unknown"
                await delete_livekit_room(room_name)
            except Exception as e:
                logger.warning(f"Room deletion error: {e}")

            # 9. Stop resource monitoring
            resource_monitor.decrement_clients()
            resource_monitor.stop_monitoring()

            logger.info("✅ Room and session cleanup completed")
        except Exception as e:
            logger.error(f"Error during cleanup: {e}")
            # Continue cleanup even if there are errors

    # Monitor participant events
    @ctx.room.on("participant_disconnected")
    def on_participant_disconnected(participant: rtc.RemoteParticipant):
        nonlocal participant_count
        participant_count -= 1
        logger.info(
            f"👤 Participant disconnected: {participant.identity}, remaining: {participant_count}")

        # If no participants left, cleanup room and session
        if participant_count == 0:
            logger.info("🔴 No participants remaining, initiating cleanup")
            asyncio.create_task(cleanup_room_and_session())

    @ctx.room.on("participant_connected")
    def on_participant_connected(participant: rtc.RemoteParticipant):
        nonlocal participant_count
        participant_count += 1
        logger.info(
            f"👤 Participant connected: {participant.identity}, total: {participant_count}")

    # Monitor room disconnection
    @ctx.room.on("disconnected")
    def on_room_disconnected():
        logger.info("🔴 Room disconnected, initiating cleanup")
        asyncio.create_task(cleanup_room_and_session())

    # # Handle data channel messages (for start_greeting signal)
    # @ctx.room.on("data_received")
    # def on_data_received(data_packet: rtc.DataPacket):
    #     try:
    #         data_bytes = bytes(data_packet.data)

    # # Add cleanup to shutdown callback
    # ctx.add_shutdown_callback(cleanup_room_and_session)

    @ctx.room.on("data_received")
    def on_data_received(data_packet: rtc.DataPacket):
        try:
            data_bytes = bytes(data_packet.data)
            data_str = data_bytes.decode('utf-8')
            data_json = json.loads(data_str)

            logger.info(f"📡 [DATA-CHANNEL] Received: {data_json.get('type', 'unknown')}")

            # Handle start_greeting message for conversation mode
            # Fresh boot: sent after user presses button → greet
            # Mode switch: sent automatically after switching to conversation → greet
            if data_json.get('type') == 'start_greeting' and room_type == "conversation":
                is_mode_switch = data_json.get('is_mode_switch', False)
                logger.info(f"▶️ [START-GREETING] Received start_greeting signal (is_mode_switch: {is_mode_switch})")

                async def send_greeting():
                    try:
                        await asyncio.sleep(0.3)  # Small delay for stability

                        if is_mode_switch:
                            # Mode switch - user just switched from music/story to conversation
                            logger.info("▶️ [START-GREETING] Mode switch detected - sending greeting")
                            await session.say("Hello! How can I help you today?", allow_interruptions=True)
                            logger.info("✅ [START-GREETING] Greeting sent successfully (mode switch)")
                        else:
                            # Fresh boot - user pressed button to start conversation
                            logger.info("▶️ [START-GREETING] Fresh boot + button press - sending greeting")
                            await session.say("Hi there! I'm ready to chat. What would you like to talk about?", allow_interruptions=True)
                            logger.info("✅ [START-GREETING] Greeting sent successfully (fresh boot)")
                    except Exception as e:
                        logger.error(f"❌ [START-GREETING] Failed to send greeting: {e}")

                asyncio.create_task(send_greeting())

        except json.JSONDecodeError as e:
            logger.debug(f"📡 [DATA-CHANNEL] Non-JSON data received: {e}")
        except Exception as e:
            logger.error(f"❌ [DATA-CHANNEL] Error processing data: {e}")

    # Add cleanup to shutdown callback
    ctx.add_shutdown_callback(cleanup_room_and_session)


    # Start agent session
    await session.start(
        agent=assistant,
        room=ctx.room,
        room_input_options=room_input_options,
        room_output_options=room_output_options,  # CRITICAL: Enable audio output to room
    )

    # Start analytics session tracking
    if analytics_service:
        try:
            # Use current character/mode from database
            mode_type = current_character
            await analytics_service.start_session(mode_type)
            logger.info(f"📊✅ Analytics session started for mode: {mode_type}")
        except Exception as e:
            logger.error(f"📊❌ Failed to start analytics session: {e}")

    # PERFORMANCE: Log total initialization time
    init_elapsed_time = (asyncio.get_event_loop().time() - init_start_time) * 1000
    logger.info(f"⚡ Total room initialization completed in {init_elapsed_time:.0f}ms")

    # Pass session reference to assistant for dynamic updates
    assistant.set_agent_session(session)
    logger.info(
        "🔗 Session reference passed to assistant for dynamic prompt updates")

    # Pass context to assistant for emotion publishing via data channel
    assistant._session_context = ctx
    logger.info(
        "😊 Context reference passed to assistant for emotion publishing")

    # Set up music/story integration with session and context
    try:
        # Pass session and context to both audio players
        audio_player.set_session(session)
        audio_player.set_context(ctx)
        unified_audio_player.set_session(session)
        unified_audio_player.set_context(ctx)
        logger.info("Audio players integrated with session and context")
    except Exception as e:
        logger.warning(
            f"Failed to integrate audio players with session/context: {e}")

    await ctx.connect()

    logger.info("✅ Enhanced agent started successfully")

    # GREETING: Agent waits for start_greeting signal from MQTT gateway (via data channel)
    # This is triggered when ESP32 sends action: "start_agent" in playback_control message
    # The data_received handler above listens for this signal and triggers session.say()
    if room_type == "conversation":
        logger.info("⏸️ [GREETING] Conversation agent ready, waiting for start_agent signal to greet")
    

if __name__ == "__main__":
    # Set high priority for audio processing
    import os
    if os.name == 'nt':  # Windows
        try:
            import psutil
            p = psutil.Process()
            p.nice(psutil.HIGH_PRIORITY_CLASS)
            logger.info("🚀 Set high priority for audio processing")
        except:
            pass
    
    cli.run_app(WorkerOptions(
        entrypoint_fnc=entrypoint,
        prewarm_fnc=prewarm,
        num_idle_processes=1,  # Optimized for enhanced functionality
        initialize_process_timeout=120.0,  # Increased timeout for heavy model loading
        job_memory_warn_mb=2000,
        agent_name="cheeko-agent",  # Named agent for explicit dispatch
    ))