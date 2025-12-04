from src.providers.provider_factory import ProviderFactory
import logging
import asyncio
import os
import json
import yaml
from datetime import datetime
from dotenv import load_dotenv
from livekit.agents import (
    AutoSubscribe,
    JobContext,
    WorkerOptions,
    cli,
    Agent,
    AgentSession,
)
from livekit import rtc
from livekit.plugins import google
from google.genai import types

# Load environment variables first, before importing modules
# Load environment variables first, before importing modules
# load_dotenv(".env")

# HARDCODED CREDENTIALS (Temporary for debugging)
os.environ["LIVEKIT_URL"] = "wss://cheekotest-cw0h23qc.livekit.cloud"
os.environ["LIVEKIT_API_KEY"] = "APIH7cPNdCWbjXf"
os.environ["LIVEKIT_API_SECRET"] = "RyfUil3IY1k1eKtOOnbSi0n06p4cTkayOeUVOJVewhXD"

load_dotenv(
    ".env", override=True
)  # Load other env vars, but keep hardcoded ones if we set them after?
# Actually, load_dotenv won't override existing env vars by default.
# But to be safe, let's set them AFTER load_dotenv to ensure they overwrite anything in .env
load_dotenv(".env")
os.environ["LIVEKIT_URL"] = "wss://cheekotest-cw0h23qc.livekit.cloud"
os.environ["LIVEKIT_API_KEY"] = "APIH7cPNdCWbjXf"
os.environ["LIVEKIT_API_SECRET"] = "RyfUil3IY1k1eKtOOnbSi0n06p4cTkayOeUVOJVewhXD"

# Import our organized modules


logger = logging.getLogger("agent")

# Load configuration from config.yaml
CONFIG_PATH = os.path.join(os.path.dirname(__file__), "config.yaml")
with open(CONFIG_PATH, "r", encoding="utf-8") as f:
    config = yaml.safe_load(f)

# Extract Gemini Realtime configuration
GEMINI_CONFIG = config.get("gemini_realtime", {})
GEMINI_MODEL = GEMINI_CONFIG.get("model", "gemini-2.0-flash-exp")
GEMINI_VOICE = GEMINI_CONFIG.get("voice", "Zephyr")
GEMINI_TEMPERATURE = GEMINI_CONFIG.get("temperature", 0.6)
GEMINI_PROMPT = GEMINI_CONFIG.get("prompt", "You are a helpful voice assistant.")


async def entrypoint(ctx: JobContext):
    """Minimal Gemini Realtime entrypoint for MQTT toy integration"""

    logger.info(f"Starting agent in room: {ctx.room.name}")

    # Extract MAC address from room name (format: UUID_MAC)
    device_mac = None
    room_name = ctx.room.name
    if "_" in room_name:
        parts = room_name.split("_")
        if len(parts) >= 2:
            mac_part = parts[-1]
            if len(mac_part) == 12 and mac_part.isalnum():
                device_mac = ":".join(mac_part[i : i + 2] for i in range(0, 12, 2))
                logger.info(f"📱 Device MAC: {device_mac}")

    # Use prompt from config.yaml
    agent_prompt = GEMINI_PROMPT
    logger.info(f"🎭 Using voice: {GEMINI_VOICE}")


    # ============================================================================
    # INITIALIZE SERVICES FOR FUNCTION CALLING
    # ============================================================================
    
    # Import the full Assistant class with function tools
    from src.agent.main_agent import Assistant
    from src.services.music_service import MusicService
    from src.services.unified_audio_player import UnifiedAudioPlayer
    from src.services.story_service import StoryService
    from src.mcp.device_control_service import DeviceControlService
    from src.mcp.mcp_executor import LiveKitMCPExecutor
    from src.services.google_search_service import GoogleSearchService
    from src.services.question_generator_service import QuestionGeneratorService
    from src.services.riddle_generator_service import RiddleGeneratorService
    from src.utils.database_helper import DatabaseHelper
    from src.services.analytics_service import AnalyticsService
    from src.services.chat_history_service import ChatHistoryService

    # Get Manager API configuration
    manager_api_url = os.getenv("MANAGER_API_URL")
    manager_api_secret = os.getenv("MANAGER_API_SECRET")

    # Initialize Database Helper
    db_helper = DatabaseHelper(manager_api_url, manager_api_secret)

    # Fetch Agent ID and Child Profile
    agent_id = await db_helper.get_agent_id(device_mac) if device_mac else None
    child_profile = await db_helper.get_child_profile_by_mac(device_mac) if device_mac else None

    # Initialize Services
    music_service = MusicService()
    await music_service.initialize()

    story_service = StoryService()
    await story_service.initialize()

    device_control_service = DeviceControlService()
    mcp_executor = LiveKitMCPExecutor()

    # Initialize Google Search Service
    google_search_service = GoogleSearchService()

    # Initialize Game Generators
    question_generator_service = QuestionGeneratorService()
    await question_generator_service.initialize()

    riddle_generator_service = RiddleGeneratorService()
    await riddle_generator_service.initialize()

    # Initialize Analytics & Chat History
    analytics_service = None
    chat_history_service = None
    if agent_id:
        analytics_service = AnalyticsService(
            manager_api_url=manager_api_url,
            secret=manager_api_secret,
            device_mac=device_mac,
            session_id=room_name,
            agent_id=agent_id
        )
        chat_history_service = ChatHistoryService(
            manager_api_url=manager_api_url,
            secret=manager_api_secret,
            device_mac=device_mac,
            session_id=room_name,
            agent_id=agent_id
        )
        chat_history_service.start_periodic_sending()

    # Initialize Unified Audio Player
    unified_audio_player = UnifiedAudioPlayer()

    # Create Assistant with function tools
    assistant = Assistant(instructions=agent_prompt)
    assistant.set_room_info(room_name=room_name, device_mac=device_mac)

    # Set services on assistant
    assistant.set_services(
        music_service=music_service,
        story_service=story_service,
        audio_player=None,
        unified_audio_player=unified_audio_player,
        device_control_service=device_control_service,
        mcp_executor=mcp_executor,
        google_search_service=google_search_service,
        question_generator_service=question_generator_service,
        riddle_generator_service=riddle_generator_service,
        analytics_service=analytics_service
    )

    logger.info("🔧 Function tools enabled: play_music, play_story, device_control, games, etc.")

    # Create Gemini Realtime model using config.yaml settings
    logger.info(
        f"🎙️ Initializing Gemini Realtime (model: {GEMINI_MODEL}, voice: {GEMINI_VOICE})..."
    )

    # VAD configuration optimized for kids' voices
    vad_config = types.RealtimeInputConfig(
        automatic_activity_detection=types.AutomaticActivityDetection(
            disabled=False,
            start_of_speech_sensitivity=types.StartSensitivity.START_SENSITIVITY_HIGH,
            end_of_speech_sensitivity=types.EndSensitivity.END_SENSITIVITY_HIGH,
            prefix_padding_ms=10,
            silence_duration_ms=200,
        )
    )

    # Enable Google Search for real-time information
    google_search = types.GoogleSearch()

    session = AgentSession(
        llm=google.realtime.RealtimeModel(
            model=GEMINI_MODEL,
            voice=GEMINI_VOICE,
            temperature=GEMINI_TEMPERATURE,
            realtime_input_config=vad_config,
            _gemini_tools=[google_search],
        ),
    )

    
    # Set session and context on audio player (needed for playback to work)
    unified_audio_player.set_session(session)
    unified_audio_player.set_context(ctx)
    assistant.set_agent_session(session)

    # ============================================================================
    # STATE MANAGEMENT
    # ============================================================================

    current_state = "idle"
    last_state_change_time = 0.0
    STATE_DEBOUNCE_MS = (
        350  # Minimum time between state changes to prevent LED flickering
    )

    async def emit_agent_state(new_state: str):
        """Emit agent state via data channel for MQTT gateway with debouncing"""
        nonlocal current_state, last_state_change_time
        import time

        try:
            # Debounce: prevent rapid state changes from causing LED flickering
            current_time = time.time() * 1000  # Convert to ms
            if current_time - last_state_change_time < STATE_DEBOUNCE_MS:
                logger.debug(
                    f"🚫 State change debounced: {current_state} → {new_state} (too fast)"
                )
                return

            if new_state == current_state:
                return

            old_state = current_state

            # Skip listening → thinking for Gemini Realtime (no separate thinking phase)
            if old_state == "listening" and new_state == "thinking":
                logger.info(
                    f"🧠 Skipping listening → thinking state change (Gemini Realtime mode)"
                )
                return

            current_state = new_state
            last_state_change_time = current_time

            payload = json.dumps(
                {
                    "type": "agent_state_changed",
                    "data": {"old_state": old_state, "new_state": new_state},
                }
            )

            await ctx.room.local_participant.publish_data(
                payload.encode("utf-8"), reliable=True
            )
            logger.info(f"📊 State: {old_state} → {new_state}")
        except Exception as e:
            logger.error(f"Failed to emit state: {e}")

    async def emit_speech_created(text: str = ""):
        """Emit speech_created event via data channel - triggers TTS start in MQTT gateway"""
        try:
            payload = json.dumps(
                {
                    "type": "speech_created",
                    "data": {"text": text},
                }
            )

            await ctx.room.local_participant.publish_data(
                payload.encode("utf-8"), reliable=True
            )
            logger.info(f"📢 speech_created event emitted")
        except Exception as e:
            logger.error(f"Failed to emit speech_created: {e}")

    # Hook into agent_state_changed to emit speech_created when agent starts speaking
    # This is needed because Gemini Realtime doesn't fire agent_speech_started events
    @session.on("agent_state_changed")
    def on_agent_state_changed_for_tts(ev):
        """Emit speech_created when agent transitions to speaking state"""
        try:
            # Get old and new state from the event
            old_state = getattr(ev, 'old_state', None)
            new_state = getattr(ev, 'new_state', None)

            logger.info(f"🔊 EVENT: agent_state_changed - {old_state} → {new_state}")

            # When transitioning TO speaking, emit speech_created for TTS start
            if new_state == 'speaking' and old_state != 'speaking':
                logger.info(f"📢 Emitting speech_created (state: {old_state} → speaking)")
                asyncio.create_task(emit_speech_created())

        except Exception as e:
            logger.error(f"❌ Error in agent_state_changed handler: {e}")

    # ============================================================================
    # PARTICIPANT TRACKING & CLEANUP
    # ============================================================================

    participant_count = len(ctx.room.remote_participants)
    cleanup_completed = False

    async def cleanup_session():
        """Minimal cleanup on disconnect"""
        nonlocal cleanup_completed
        if cleanup_completed:
            return
        cleanup_completed = True

        logger.info("🔴 Cleaning up session...")

        try:
            if ctx.room and hasattr(ctx.room, "disconnect"):
                await ctx.room.disconnect()
        except Exception as e:
            logger.warning(f"Disconnect error: {e}")

        logger.info("✅ Cleanup complete")

    @ctx.room.on("participant_disconnected")
    def on_participant_disconnected(participant: rtc.RemoteParticipant):
        nonlocal participant_count
        participant_count -= 1
        logger.info(
            f"👤 Participant left: {participant.identity}, remaining: {participant_count}"
        )
        if participant_count == 0:
            asyncio.create_task(cleanup_session())

    @ctx.room.on("participant_connected")
    def on_participant_connected(participant: rtc.RemoteParticipant):
        nonlocal participant_count
        participant_count += 1
        logger.info(
            f"👤 Participant joined: {participant.identity}, total: {participant_count}"
        )

    @ctx.room.on("disconnected")
    def on_room_disconnected():
        logger.info("🔴 Room disconnected")
        asyncio.create_task(cleanup_session())

    # ============================================================================
    # DATA CHANNEL HANDLERS
    # ============================================================================

    @ctx.room.on("data_received")
    def on_data_received(packet: rtc.DataPacket):
        try:
            payload = packet.data.decode('utf-8')
            data = json.loads(payload)
            logger.debug(f"📨 Received: {data.get('type')}")

            if data.get("type") in ["start_greeting", "agent_ready"]:
                logger.info(f"👋 Greeting request received")
                asyncio.create_task(trigger_greeting())
            elif data.get("type") == "end_prompt":
                logger.info(f"👋 End prompt received, will disconnect naturally")
                # Let the gateway handle the goodbye, we just acknowledge
            elif data.get("type") == "abort_playback":
                logger.info(f"🛑 Abort signal received - interrupting agent and stopping audio")
                try:
                    # Interrupt current speech/response
                    session.interrupt()
                    logger.info(f"✅ Agent interrupted successfully")
                    
                    # Also stop any music/story playback
                    if unified_audio_player:
                        asyncio.create_task(unified_audio_player.stop())
                        logger.info(f"🛑 Unified audio player stop requested")
                except Exception as abort_error:
                    logger.error(f"❌ Failed to interrupt agent: {abort_error}")

        except Exception as e:
            logger.warning(f"Failed to handle data: {e}")

    async def trigger_greeting():
        """Generate initial greeting"""
        await asyncio.sleep(2.0)  # Brief delay for session stability
        try:
            logger.info("👋 Generating greeting...")
            logger.info(f"🔍 Session state before greeting: {session}")

            # Try to generate greeting
            result = await session.generate_reply(
                instructions="Say hello and introduce yourself as a funny goofy friend."
            )

            logger.info(f"🔍 Generate reply result: {result}")
            logger.info("✅ Greeting sent")
        except Exception as e:
            logger.error(f"❌ Greeting error: {e}")
            import traceback

            logger.error(f"❌ Traceback: {traceback.format_exc()}")

    # ============================================================================
    # START SESSION
    # ============================================================================

    # Connect to room first
    await ctx.connect(auto_subscribe=AutoSubscribe.AUDIO_ONLY)

    # Wait for a participant to join (critical for Gemini Realtime!)
    participant = await ctx.wait_for_participant()
    logger.info(f"👤 Participant joined: {participant.identity}")

    # Start Gemini session with the room and participant
    await session.start(
        room=ctx.room,
        agent=assistant,  # Using Assistant with function tools
    )

    logger.info("✅ Gemini Realtime agent is LIVE!")


if __name__ == "__main__":
    cli.run_app(
        WorkerOptions(
            entrypoint_fnc=entrypoint,
            # Use default prewarm, no custom function needed
        )
    )
