"""
Sarvam REST API STT Benchmark Worker
Tests STT latency using REST API (non-streaming) for accurate latency measurement.

Usage:
    python workers/sarvam_rest_benchmark.py dev

This worker uses the same pipeline as cheeko_sarvam_worker but forces REST API
for STT instead of WebSocket streaming, so we get actual request-response latency.
"""

import os
import sys
import json
import asyncio
import time

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
from src.utils.loki_agent_logger import logger
from src.shared.base_assistant import BaseAssistant
from src.shared.entrypoint_utils import (
    parse_room_name,
    delete_livekit_room,
    create_state_handlers,
)

AGENT_NAME = "sarvam-rest-benchmark"
DEFAULT_PORT = 8082

# Metrics output
METRICS_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "logs")
METRICS_FILE = os.path.join(METRICS_DIR, "sarvam_rest_metrics.jsonl")


class RestMetricsCollector:
    """Collects latency metrics. Same as streaming collector but writes to separate file."""

    def __init__(self, room_name, stt_model, tts_model, llm_model,
                 stt_language="", tts_language="", tts_speaker=""):
        self.room_name = room_name
        self.stt_model = stt_model
        self.tts_model = tts_model
        self.llm_model = llm_model
        self.stt_language = stt_language
        self.tts_language = tts_language
        self.tts_speaker = tts_speaker
        self.session_start = time.time()
        self.turn_count = 0
        self.tts_ttfbs = []
        self.llm_ttfts = []
        self.stt_durations = []
        self._thinking_started_at = None
        self.pipeline_response_latencies = []
        os.makedirs(METRICS_DIR, exist_ok=True)

    def on_agent_state_changed(self, old_state, new_state):
        now = time.time()
        if new_state == "thinking":
            self._thinking_started_at = now
        elif old_state == "thinking" and new_state == "speaking":
            if self._thinking_started_at:
                response_lat = now - self._thinking_started_at
                self.pipeline_response_latencies.append(response_lat)
                logger.info(f"[REST-METRICS] Response latency: {response_lat:.3f}s")
                self._write({
                    "timestamp": now,
                    "type": "pipeline_turn",
                    "room": self.room_name,
                    "response_latency": round(response_lat, 4),
                    "stt_model": self.stt_model,
                    "tts_model": self.tts_model,
                    "llm_model": self.llm_model,
                    "stt_language": self.stt_language,
                    "tts_language": self.tts_language,
                    "tts_speaker": self.tts_speaker,
                    "stt_mode": "rest",
                })

    def on_stt_metrics(self, metrics):
        """STT metrics from stt.on('metrics_collected') — REST gives real duration"""
        duration = metrics.duration
        audio_duration = metrics.audio_duration
        if duration > 0:
            self.stt_durations.append(duration)
        logger.info(f"[REST-METRICS] STT: duration={duration:.3f}s audio={audio_duration:.2f}s")
        self._write({
            "timestamp": time.time(),
            "type": "stt",
            "room": self.room_name,
            "stt_model": self.stt_model,
            "stt_language": self.stt_language,
            "stt_duration": round(duration, 4),
            "stt_audio_duration": round(audio_duration, 4),
            "stt_streamed": metrics.streamed,
            "stt_mode": "rest",
        })

    def collect(self, ev: MetricsCollectedEvent):
        m = ev.metrics
        ts = time.time()
        base = {
            "timestamp": ts,
            "room": self.room_name,
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
            logger.info(f"[REST-METRICS] TTS: ttfb={m.ttfb:.3f}s")
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
            logger.info(f"[REST-METRICS] LLM: ttft={m.ttft:.3f}s")
            self._write(base)

    def _write(self, record):
        try:
            with open(METRICS_FILE, "a") as f:
                f.write(json.dumps(record) + "\n")
        except Exception as e:
            logger.warning(f"Failed to write metrics: {e}")

    def _percentile(self, data, p):
        if not data:
            return 0.0
        s = sorted(data)
        idx = min(int(len(s) * p / 100), len(s) - 1)
        return round(s[idx], 4)

    def log_session_summary(self):
        duration = time.time() - self.session_start
        summary = {
            "timestamp": time.time(),
            "type": "session_summary",
            "session_duration": round(duration, 2),
            "room": self.room_name,
            "turn_count": self.turn_count,
            "stt_model": self.stt_model,
            "tts_model": self.tts_model,
            "llm_model": self.llm_model,
            "stt_language": self.stt_language,
            "tts_speaker": self.tts_speaker,
            "stt_mode": "rest",
            "stt_duration_avg": round(sum(self.stt_durations) / len(self.stt_durations), 4) if self.stt_durations else 0,
            "stt_duration_p50": self._percentile(self.stt_durations, 50),
            "stt_duration_p95": self._percentile(self.stt_durations, 95),
            "llm_ttft_avg": round(sum(self.llm_ttfts) / len(self.llm_ttfts), 4) if self.llm_ttfts else 0,
            "llm_ttft_p50": self._percentile(self.llm_ttfts, 50),
            "tts_ttfb_avg": round(sum(self.tts_ttfbs) / len(self.tts_ttfbs), 4) if self.tts_ttfbs else 0,
            "tts_ttfb_p50": self._percentile(self.tts_ttfbs, 50),
            "response_latency_avg": round(sum(self.pipeline_response_latencies) / len(self.pipeline_response_latencies), 4) if self.pipeline_response_latencies else 0,
            "response_latency_p50": self._percentile(self.pipeline_response_latencies, 50),
        }
        logger.info("=" * 50)
        logger.info(f"[REST-SESSION] {self.turn_count} turns | {round(duration, 1)}s | REST mode")
        logger.info(f"[REST-SESSION] STT ({self.stt_model}): avg={summary['stt_duration_avg']}s p50={summary['stt_duration_p50']}s p95={summary['stt_duration_p95']}s")
        logger.info(f"[REST-SESSION] LLM ({self.llm_model}): avg={summary['llm_ttft_avg']}s p50={summary['llm_ttft_p50']}s")
        logger.info(f"[REST-SESSION] TTS ({self.tts_model}): avg={summary['tts_ttfb_avg']}s p50={summary['tts_ttfb_p50']}s")
        logger.info(f"[REST-SESSION] Response: avg={summary['response_latency_avg']}s p50={summary['response_latency_p50']}s")
        logger.info("=" * 50)
        self._write(summary)


class BenchmarkAssistant(BaseAssistant):
    GREETING_INSTRUCTION = "Say a short greeting in the user's language. 1-2 sentences only."

    def __init__(self, instructions=None):
        super().__init__(instructions=instructions)


def prewarm(proc: JobProcess):
    logger.info("[PREWARM] Sarvam REST benchmark ready")
    proc.userdata["ready"] = True


async def entrypoint(ctx: JobContext):
    yaml_config = ConfigLoader.load_yaml_config()
    logger.info(f"Starting Sarvam REST benchmark in room: {ctx.room.name}")

    # Load config
    sarvam_config = yaml_config.get('sarvam', {})
    sarvam_stt_config = sarvam_config.get('stt', {})
    sarvam_tts_config = sarvam_config.get('tts', {})
    sarvam_api_key = os.getenv("SARVAM_API_KEY") or sarvam_config.get('api_key', '')

    stt_model = sarvam_stt_config.get('model', 'saaras:v3')
    stt_language = sarvam_stt_config.get('language', 'te-IN')

    tts_model = sarvam_tts_config.get('model', 'bulbul:v3-beta')
    tts_speaker = sarvam_tts_config.get('speaker', 'ishita')
    tts_language = sarvam_tts_config.get('target_language_code', 'te-IN')
    tts_pace = sarvam_tts_config.get('pace', 1.0)
    tts_sample_rate = sarvam_tts_config.get('speech_sample_rate', 24000)

    llm_config = yaml_config.get('groq', {})
    llm_model = llm_config.get('model', 'openai/gpt-oss-20b')
    llm_temperature = llm_config.get('temperature', 0.6)

    room_name = ctx.room.name
    device_mac, _ = parse_room_name(room_name)

    # Create pipeline — STT uses REST (non-streaming) by setting streaming capability off
    # The Sarvam plugin's _recognize_impl handles REST calls
    stt_kwargs = {"model": stt_model, "language": stt_language}
    if sarvam_api_key:
        stt_kwargs["api_key"] = sarvam_api_key
    stt_instance = sarvam.STT(**stt_kwargs)

    # Override streaming capability to force REST mode
    stt_instance._capabilities = type(stt_instance._capabilities)(
        streaming=False,
        interim_results=False,
        aligned_transcript=False,
    )
    logger.info(f"STT: {stt_model} | {stt_language} | REST mode (non-streaming)")

    llm = groq.LLM(model=llm_model, temperature=llm_temperature)
    logger.info(f"LLM: {llm_model}")

    tts_kwargs = {
        "model": tts_model, "speaker": tts_speaker,
        "target_language_code": tts_language, "pace": tts_pace,
        "speech_sample_rate": tts_sample_rate,
    }
    if sarvam_api_key:
        tts_kwargs["api_key"] = sarvam_api_key
    tts = sarvam.TTS(**tts_kwargs)
    logger.info(f"TTS: {tts_model} | {tts_speaker} | {tts_language}")

    session = AgentSession(stt=stt_instance, llm=llm, tts=tts)

    # Metrics
    metrics_collector = RestMetricsCollector(
        room_name=room_name,
        stt_model=stt_model, tts_model=tts_model, llm_model=llm_model,
        stt_language=stt_language, tts_language=tts_language, tts_speaker=tts_speaker,
    )

    @session.on("metrics_collected")
    def _on_metrics(ev: MetricsCollectedEvent):
        metrics_collector.collect(ev)

    stt_instance.on("metrics_collected", metrics_collector.on_stt_metrics)

    @session.on("agent_state_changed")
    def _on_state(ev):
        old_state = getattr(ev, 'old_state', '')
        new_state = getattr(ev, 'new_state', '')
        metrics_collector.on_agent_state_changed(str(old_state), str(new_state))

    logger.info(f"REST metrics → {METRICS_FILE}")

    emit_agent_state, emit_speech_created = create_state_handlers(ctx, session)

    # Cleanup
    cleanup_done = False

    async def cleanup():
        nonlocal cleanup_done
        if cleanup_done:
            return
        cleanup_done = True
        try:
            metrics_collector.log_session_summary()
            if session and hasattr(session, 'aclose'):
                await session.aclose()
            if ctx.room and hasattr(ctx.room, 'disconnect'):
                await ctx.room.disconnect()
            await delete_livekit_room(ctx.room.name)
            logger.info("Cleanup done")
        except Exception as e:
            logger.error(f"Cleanup error: {e}")

    @ctx.room.on("participant_disconnected")
    def on_disconnect(p):
        if len(ctx.room.remote_participants) == 0:
            asyncio.create_task(cleanup())

    @ctx.room.on("disconnected")
    def on_room_disconnect():
        asyncio.create_task(cleanup())

    ctx.add_shutdown_callback(cleanup)

    await ctx.connect(auto_subscribe=AutoSubscribe.AUDIO_ONLY)
    participant = await ctx.wait_for_participant()
    logger.info(f"Participant: {participant.identity}")

    prompt = ConfigLoader.get_default_prompt()
    assistant = BenchmarkAssistant(instructions=prompt)
    assistant.set_room_info(room_name=ctx.room.name, device_mac=device_mac)
    assistant.set_agent_session(session)
    assistant.set_session_context(ctx)

    await session.start(
        room=ctx.room,
        agent=assistant,
        room_input_options=RoomInputOptions(
            audio_sample_rate=16000,
            audio_num_channels=1,
        )
    )
    logger.info("Sarvam REST benchmark LIVE!")


if __name__ == "__main__":
    port = int(os.getenv("BENCHMARK_PORT", DEFAULT_PORT))
    logger.info(f"Starting {AGENT_NAME} on port {port}")
    cli.run_app(WorkerOptions(
        entrypoint_fnc=entrypoint,
        prewarm_fnc=prewarm,
        agent_name=AGENT_NAME,
        num_idle_processes=1,
        port=port,
    ))
