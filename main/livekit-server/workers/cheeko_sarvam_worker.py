"""
Cheeko Sarvam Agent Worker
Conversational agent using Sarvam STT/TTS + Groq LLM pipeline

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
)
from livekit import rtc, api
from livekit.plugins import groq, sarvam

from livekit.agents import metrics as lk_metrics, MetricsCollectedEvent
from livekit.agents.metrics import STTMetrics, TTSMetrics, LLMMetrics

from src.config.config_loader import ConfigLoader
from src.utils.database_helper import DatabaseHelper
from src.services.prompt_service import PromptService
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
# from src.features.mode_switching import update_agent_mode  # COMMENTED OUT - tools disabled for testing

# Agent configuration
AGENT_NAME = "cheeko-agent"
CHARACTER_NAME = "Cheeko"
DEFAULT_PORT = 8081
# MODE_SWITCH_TOOLS = [update_agent_mode]  # COMMENTED OUT - tools disabled for testing

# Sarvam metrics output file
SARVAM_METRICS_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "logs")
SARVAM_METRICS_FILE = os.path.join(SARVAM_METRICS_DIR, "sarvam_metrics.jsonl")


class SarvamMetricsCollector:
    """Collects per-turn latency metrics: STT, LLM, TTS individually + combined turn latency.
    Grouped by model and language."""

    def __init__(self, room_name: str, device_mac: str, stt_model: str, tts_model: str, llm_model: str,
                 stt_language: str = "", tts_language: str = "", tts_speaker: str = "", tts_pace: float = 1.0):
        self.room_name = room_name
        self.device_mac = device_mac
        self.stt_model = stt_model
        self.tts_model = tts_model
        self.llm_model = llm_model
        self.stt_language = stt_language
        self.tts_language = tts_language
        self.tts_speaker = tts_speaker
        self.tts_pace = tts_pace
        self.session_start = time.time()
        self.turn_count = 0

        # LiveKit SDK metrics aggregates
        self.tts_ttfbs = []
        self.llm_ttfts = []

        # Pipeline timing using agent_state_changed:
        #   listening → thinking : user done, STT done, LLM starts
        #   thinking → speaking  : LLM+TTS done, agent speaks
        # Only thinking→speaking is meaningful (the wait time user feels)
        self._thinking_started_at = None

        # Per-session latency aggregates
        self.pipeline_response_latencies = []  # thinking → speaking (user waits this long)

        os.makedirs(SARVAM_METRICS_DIR, exist_ok=True)

    # --- Pipeline timing (from agent_state_changed) ---

    def on_agent_state_changed(self, old_state: str, new_state: str):
        now = time.time()

        if new_state == "thinking":
            # STT done, LLM starts processing
            self._thinking_started_at = now

        elif old_state == "thinking" and new_state == "speaking":
            # LLM + TTS TTFB done, agent starts speaking
            # This is the response latency the user actually feels
            if self._thinking_started_at:
                response_lat = now - self._thinking_started_at
                self.pipeline_response_latencies.append(response_lat)
                logger.info(f"[METRICS] Response latency (LLM+TTS): {response_lat:.3f}s")
                self._write({
                    "timestamp": now,
                    "type": "pipeline_turn",
                    "room": self.room_name,
                    "mac": self.device_mac,
                    "response_latency": round(response_lat, 4),
                    "stt_model": self.stt_model,
                    "tts_model": self.tts_model,
                    "llm_model": self.llm_model,
                    "stt_language": self.stt_language,
                    "tts_language": self.tts_language,
                    "tts_speaker": self.tts_speaker,
                })

    def collect(self, ev: MetricsCollectedEvent):
        """Collect LLM/TTS metrics from session-level event"""
        m = ev.metrics
        ts = time.time()
        base = {
            "timestamp": ts,
            "room": self.room_name,
            "mac": self.device_mac,
            "stt_language": self.stt_language,
            "tts_language": self.tts_language,
            "tts_speaker": self.tts_speaker,
        }

        if isinstance(m, TTSMetrics):
            base.update({
                "type": "tts",
                "tts_model": self.tts_model,
                "tts_ttfb": round(m.ttfb, 4),
                "tts_duration": round(m.duration, 4),
                "tts_audio_duration": round(m.audio_duration, 4),
                "tts_characters": m.characters_count,
            })
            if m.ttfb > 0:
                self.tts_ttfbs.append(m.ttfb)
            logger.info(f"[METRICS] TTS event: ttfb={m.ttfb:.3f}s duration={m.duration:.3f}s")
            self._write(base)

        elif isinstance(m, LLMMetrics):
            base.update({
                "type": "llm",
                "llm_model": self.llm_model,
                "llm_ttft": round(m.ttft, 4),
                "llm_duration": round(m.duration, 4),
                "llm_tokens_per_sec": round(m.tokens_per_second, 2),
                "llm_prompt_tokens": m.prompt_tokens,
                "llm_completion_tokens": m.completion_tokens,
            })
            if m.ttft > 0:
                self.llm_ttfts.append(m.ttft)
            self.turn_count += 1
            logger.info(f"[METRICS] LLM event: ttft={m.ttft:.3f}s tps={m.tokens_per_second:.1f}")
            self._write(base)

    def on_stt_metrics(self, metrics):
        """Direct STT component metrics (attached to stt.on('metrics_collected'))"""
        ts = time.time()
        record = {
            "timestamp": ts,
            "type": "stt",
            "room": self.room_name,
            "mac": self.device_mac,
            "stt_model": self.stt_model,
            "stt_language": self.stt_language,
            "stt_duration": round(metrics.duration, 4),
            "stt_audio_duration": round(metrics.audio_duration, 4),
            "stt_streamed": metrics.streamed,
            "stt_speech_id": getattr(metrics, 'speech_id', ''),
            "stt_error": str(getattr(metrics, 'error', '')) if getattr(metrics, 'error', None) else None,
        }
        logger.info(f"[METRICS] STT: duration={metrics.duration:.3f}s audio={metrics.audio_duration:.2f}s streamed={metrics.streamed}")
        self._write(record)


    def _write(self, record: dict):
        try:
            with open(SARVAM_METRICS_FILE, "a") as f:
                f.write(json.dumps(record) + "\n")
        except Exception as e:
            logger.warning(f"Failed to write metrics: {e}")

    def _percentile(self, data: list, p: int) -> float:
        if not data:
            return 0.0
        s = sorted(data)
        idx = min(int(len(s) * p / 100), len(s) - 1)
        return round(s[idx], 4)

    def get_session_summary(self) -> dict:
        duration = time.time() - self.session_start
        return {
            "timestamp": time.time(),
            "type": "session_summary",
            "session_duration": round(duration, 2),
            "room": self.room_name,
            "mac": self.device_mac,
            "turn_count": self.turn_count,
            "stt_model": self.stt_model,
            "tts_model": self.tts_model,
            "llm_model": self.llm_model,
            "stt_language": self.stt_language,
            "tts_language": self.tts_language,
            "tts_speaker": self.tts_speaker,
            "tts_ttfb_avg": round(sum(self.tts_ttfbs) / len(self.tts_ttfbs), 4) if self.tts_ttfbs else 0,
            "tts_ttfb_p50": self._percentile(self.tts_ttfbs, 50),
            "tts_ttfb_p95": self._percentile(self.tts_ttfbs, 95),
            "llm_ttft_avg": round(sum(self.llm_ttfts) / len(self.llm_ttfts), 4) if self.llm_ttfts else 0,
            "llm_ttft_p50": self._percentile(self.llm_ttfts, 50),
            "llm_ttft_p95": self._percentile(self.llm_ttfts, 95),
            "response_latency_avg": round(sum(self.pipeline_response_latencies) / len(self.pipeline_response_latencies), 4) if self.pipeline_response_latencies else 0,
            "response_latency_p50": self._percentile(self.pipeline_response_latencies, 50),
            "response_latency_p95": self._percentile(self.pipeline_response_latencies, 95),
        }

    def log_session_summary(self):
        summary = self.get_session_summary()
        logger.info("=" * 50)
        logger.info(f"[SESSION] {summary['turn_count']} turns | {summary['session_duration']}s")
        logger.info(f"[SESSION] LLM TTFT ({self.llm_model}): avg={summary['llm_ttft_avg']}s p50={summary['llm_ttft_p50']}s p95={summary['llm_ttft_p95']}s")
        logger.info(f"[SESSION] TTS TTFB ({self.tts_model}): avg={summary['tts_ttfb_avg']}s p50={summary['tts_ttfb_p50']}s p95={summary['tts_ttfb_p95']}s")
        logger.info(f"[SESSION] Response (LLM+TTS): avg={summary['response_latency_avg']}s p50={summary['response_latency_p50']}s p95={summary['response_latency_p95']}s")
        logger.info("=" * 50)
        self._write(summary)


class CheekoAssistant(BaseAssistant):
    """Cheeko Assistant - Sarvam STT/TTS conversational agent"""

    GREETING_INSTRUCTION = "ಚೀಕೋ ಆಗಿ ಒಂದು ಚಿಕ್ಕ, ಮಜಾ ಶುಭಾಶಯ ಹೇಳಿ. ಕನ್ನಡದಲ್ಲಿ ಮಾತ್ರ 1-2 ವಾಕ್ಯಗಳಲ್ಲಿ ಹೇಳಿ."

    def __init__(self, instructions: str = None) -> None:
        super().__init__(instructions=instructions)


def prewarm(proc: JobProcess):
    """Prewarm for Sarvam STT + Groq LLM + Sarvam TTS pipeline"""
    logger.info("[PREWARM] Ready for STT/LLM/TTS pipeline (Sarvam + Groq + Sarvam)")
    proc.userdata["ready"] = True


async def entrypoint(ctx: JobContext):
    """Entrypoint for Cheeko Sarvam agent worker"""

    # Load configuration
    yaml_config = ConfigLoader.load_yaml_config()

    ctx.log_context_fields = {"room": ctx.room.name}
    logger.info(f"Starting {CHARACTER_NAME} Sarvam agent in room: {ctx.room.name}")

    init_start_time = asyncio.get_event_loop().time()

    # Load Sarvam pipeline configuration from config.yaml
    sarvam_config = yaml_config.get('sarvam', {})
    sarvam_stt_config = sarvam_config.get('stt', {})
    sarvam_tts_config = sarvam_config.get('tts', {})

    # Sarvam API key: env var takes priority over config.yaml
    sarvam_api_key = os.getenv("SARVAM_API_KEY") or sarvam_config.get('api_key', '')

    # STT settings
    stt_model = sarvam_stt_config.get('model', 'saaras:v3')
    stt_language = sarvam_stt_config.get('language', 'kn-IN')
    stt_mode = sarvam_stt_config.get('mode', 'transcribe')

    # TTS settings
    tts_model = sarvam_tts_config.get('model', 'bulbul:v3-beta')
    tts_speaker = sarvam_tts_config.get('speaker', 'shubh')
    tts_language = sarvam_tts_config.get('target_language_code', 'kn-IN')
    tts_pace = sarvam_tts_config.get('pace', 1.0)
    tts_sample_rate = sarvam_tts_config.get('speech_sample_rate', 16000)

    # LLM settings (Groq)
    llm_config = yaml_config.get('groq', {})
    llm_model = llm_config.get('model', 'openai/gpt-oss-20b')
    llm_temperature = llm_config.get('temperature', 0.8)

    # Parse room name
    room_name = ctx.room.name
    device_mac, room_type = parse_room_name(room_name)

    # Initialize services
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

            # Parallel API calls
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

            # Process prompt
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
    has_placeholder = '{{' in agent_prompt or '{%' in agent_prompt
    has_child_name = 'child_name' in agent_prompt
    logger.info(f"Template analysis - Has Jinja: {has_placeholder}, Has child_name: {has_child_name}")

    if child_profile:
        agent_prompt = render_prompt_with_profile(
            agent_prompt, child_profile, dispatch_memories, dispatch_relations, dispatch_entities
        )

    logger.info(f"Final prompt length: {len(agent_prompt)} chars")
    logger.info(f"Child name '{child_profile.get('name') if child_profile else 'N/A'}' in prompt: {'Rahul' in agent_prompt}")
    logger.info(f"Prompt preview (first 500 chars): {agent_prompt[:500]}")

    # Create Sarvam + Groq pipeline components
    # STT: Sarvam
    stt_kwargs = {
        "model": stt_model,
        "language": stt_language,
    }
    if sarvam_api_key:
        stt_kwargs["api_key"] = sarvam_api_key
    stt = sarvam.STT(**stt_kwargs)
    logger.info(f"Sarvam STT created (model: {stt_model}, language: {stt_language})")

    # LLM: Groq
    llm = groq.LLM(
        model=llm_model,
        temperature=llm_temperature
    )
    logger.info(f"Groq LLM created (model: {llm_model}, temp: {llm_temperature})")

    # TTS: Sarvam
    tts_kwargs = {
        "model": tts_model,
        "speaker": tts_speaker,
        "target_language_code": tts_language,
        "pace": tts_pace,
        "speech_sample_rate": tts_sample_rate,
    }
    if sarvam_api_key:
        tts_kwargs["api_key"] = sarvam_api_key
    tts = sarvam.TTS(**tts_kwargs)
    logger.info(f"Sarvam TTS created (model: {tts_model}, speaker: {tts_speaker}, language: {tts_language})")

    # Create AgentSession with Sarvam pipeline
    session = AgentSession(
        stt=stt,
        llm=llm,
        tts=tts,
        # tools=MODE_SWITCH_TOOLS  # COMMENTED OUT - tools disabled for testing
    )
    logger.info("AgentSession created (no tools - testing mode)")

    # Initialize UsageManager for standard metrics (sends to Manager API)
    usage_manager = UsageManager(mac_address=device_mac, session_id=room_name)
    usage_manager.setup_metrics_collection(session)
    logger.info("Usage tracking initialized - subscribed to metrics_collected event")

    # Initialize Sarvam-specific metrics collector (writes to sarvam_metrics.jsonl)
    sarvam_metrics = SarvamMetricsCollector(
        room_name=room_name,
        device_mac=device_mac,
        stt_model=stt_model,
        tts_model=tts_model,
        llm_model=llm_model,
        stt_language=stt_language,
        tts_language=tts_language,
        tts_speaker=tts_speaker,
        tts_pace=tts_pace,
    )

    @session.on("metrics_collected")
    def _on_sarvam_metrics(ev: MetricsCollectedEvent):
        sarvam_metrics.collect(ev)

    # Direct STT component listener
    stt.on("metrics_collected", sarvam_metrics.on_stt_metrics)

    logger.info(f"Sarvam metrics collector initialized (output: {SARVAM_METRICS_FILE})")

    # Pipeline timing: uses agent_state_changed transitions
    # listening→thinking = STT time, thinking→speaking = LLM+TTS time
    @session.on("agent_state_changed")
    def _on_agent_state_changed(ev):
        old_state = getattr(ev, 'old_state', '')
        new_state = getattr(ev, 'new_state', '')
        sarvam_metrics.on_agent_state_changed(str(old_state), str(new_state))

    logger.info("Pipeline timing hooks registered")

    # Create state handlers
    emit_agent_state, emit_speech_created = create_state_handlers(ctx, session)
    logger.info("State management registered")

    # Debug: Track user speech and function calls
    @session.on("user_speech_committed")
    def on_user_speech(msg):
        text = getattr(msg, 'text', str(msg)) if hasattr(msg, 'text') else str(msg)
        logger.info(f"🎤 USER SAID: '{text}'")

    @session.on("function_calls_started")
    def on_function_calls_started(ev):
        logger.info(f"🔧 FUNCTION CALL STARTED: {ev}")

    @session.on("function_calls_finished")
    def on_function_calls_finished(ev):
        logger.info(f"✅ FUNCTION CALL FINISHED: {ev}")

    # Setup error handling
    error_manager = None
    try:
        from src.agent.error_handler import setup_error_handling
        error_manager = setup_error_handling(session=session, max_retries=3, custom_audio_path=None)
        logger.info("Error handling enabled")
    except Exception as e:
        logger.warning(f"Error handler not available: {e}")

    # Create assistant instance
    assistant = CheekoAssistant(instructions=agent_prompt)
    assistant.set_room_info(room_name=ctx.room.name, device_mac=device_mac)
    logger.info(f"{CHARACTER_NAME} Sarvam Assistant initialized")

    # assistant.enable_mode_switching()  # COMMENTED OUT - tools disabled for testing
    logger.info("Cheeko features: all tools disabled (testing mode)")

    # Room lifecycle management
    participant_count = len(ctx.room.remote_participants)
    cleanup_completed = False

    # Initialize chat history service
    chat_history_service = None
    if agent_id and device_mac:
        chat_history_service = init_chat_history_service(device_mac, room_name, agent_id)

    async def cleanup_room_and_session():
        nonlocal cleanup_completed
        if cleanup_completed:
            return
        cleanup_completed = True
        try:
            logger.info("Initiating cleanup")

            # Log Sarvam metrics session summary
            try:
                sarvam_metrics.log_session_summary()
            except Exception as e:
                logger.warning(f"Failed to log Sarvam session summary: {e}")

            # Log UsageManager session summary (sends to Manager API)
            try:
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

            try:
                await asyncio.shield(
                    extract_and_send_chat_history(session, chat_history_service, device_mac)
                )
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
        """Handle end prompt - say goodbye message before cleanup"""
        try:
            logger.info(f"👋 [END-PROMPT] Saying goodbye: {prompt_text[:50]}...")
            try:
                await asyncio.wait_for(
                    session.say(prompt_text),
                    timeout=10.0
                )
                logger.info("👋 [END-PROMPT] Goodbye message completed")
            except asyncio.TimeoutError:
                logger.warning("👋 [END-PROMPT] Goodbye timed out - session may be busy")
            except Exception as gen_error:
                logger.warning(f"👋 [END-PROMPT] Could not generate goodbye: {gen_error}")
        except Exception as e:
            logger.error(f"👋 [END-PROMPT] Error in goodbye handler: {e}")

    @ctx.room.on("data_received")
    def on_data_received(data_packet: rtc.DataPacket):
        """Handle data channel messages from gateway"""
        try:
            message = json.loads(data_packet.data.decode('utf-8'))
            msg_type = message.get('type')

            if msg_type == 'ready_for_greeting':
                logger.info("🎤 Device ready for greeting - triggering greeting now")
                asyncio.create_task(assistant.play_greeting())
                return

            if msg_type == 'end_prompt':
                prompt_text = message.get('prompt', "Time flies so fast! It was wonderful talking with you. Goodbye!")
                logger.info(f"👋 [END-PROMPT] Received end_prompt from gateway")
                asyncio.create_task(handle_end_prompt(prompt_text))
                return

            if msg_type == 'shutdown_request':
                logger.info("Received shutdown_request from gateway, initiating cleanup...")
                if message.get('require_ack'):
                    asyncio.create_task(send_shutdown_ack(message.get('session_id', '')))
                asyncio.create_task(cleanup_room_and_session())
                return

            if msg_type == 'user_text':
                text = (message.get('text') or '').strip()
                if not text:
                    logger.warning("⚠️ user_text message with empty text, ignoring")
                    return

                logger.info(f"💬 [USER_TEXT] Received from gateway: {text}")
                logger.info(f"🧾 [USER_TEXT-RAW] Payload: {message}")

                async def handle_user_text():
                    try:
                        await emit_agent_state("listening")
                        await session.say(text)
                    except Exception as e:
                        logger.error(f"❌ Error handling user_text: {e}")

                asyncio.create_task(handle_user_text())

        except Exception as e:
            logger.error(f"Error handling data channel message: {e}")

    ctx.add_shutdown_callback(cleanup_room_and_session)

    # Connect and start session
    await ctx.connect(auto_subscribe=AutoSubscribe.AUDIO_ONLY)

    # Duplicate agent check
    my_identity = ctx.room.local_participant.identity if ctx.room.local_participant else None
    existing_agents = [
        p for p in ctx.room.remote_participants.values()
        if p.identity and 'agent' in p.identity.lower() and p.identity != my_identity
    ]
    if existing_agents:
        logger.warning(f"⚠️ [DUPLICATE-AGENT] Another agent already in room: {[a.identity for a in existing_agents]}")
        logger.warning(f"⚠️ [DUPLICATE-AGENT] Exiting to prevent duplicate. Room: {ctx.room.name}")
        try:
            await ctx.room.disconnect()
        except Exception:
            pass
        return

    participant = await ctx.wait_for_participant()
    logger.info(f"Participant joined: {participant.identity}")

    assistant.set_agent_session(session)
    assistant.set_session_context(ctx)

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
    logger.info(f"{CHARACTER_NAME} Sarvam agent is LIVE!")

    # If greeting was missed during init (race condition), trigger it now
    if not assistant.greeting_played:
        logger.info("🎤 [GREETING-CATCHUP] Greeting not yet played - triggering now in case ready_for_greeting was missed during init")
        if not assistant.greeting_played:
            await assistant.play_greeting()


if __name__ == "__main__":
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
