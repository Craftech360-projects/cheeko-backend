import asyncio
import logging
from livekit.agents import metrics, MetricsCollectedEvent, AgentSession

logger = logging.getLogger("livekit_agent")


class UsageManager:
    """Utility class for managing usage metrics and logging"""

    def __init__(self):
        self.usage_collector = metrics.UsageCollector()

    def log_turn_metrics(self, ev: MetricsCollectedEvent):
        """Log metrics for each interaction (LLM/STT/TTS)"""
        m = ev.metrics
        metric_type = type(m).__name__

        if hasattr(m, 'prompt_tokens'):
            # LLM metrics
            logger.info(
                f"📊 [METRICS-LLM] prompt_tokens={m.prompt_tokens}, "
                f"completion_tokens={m.completion_tokens}, "
                f"total_tokens={m.total_tokens}, "
                f"ttft={m.ttft:.3f}s, "
                f"duration={m.duration:.3f}s, "
                f"tokens_per_second={m.tokens_per_second:.1f}"
            )
        elif hasattr(m, 'characters_count'):
            # TTS metrics
            logger.info(
                f"📊 [METRICS-TTS] characters={m.characters_count}, "
                f"audio_duration={m.audio_duration:.2f}s, "
                f"ttfb={m.ttfb:.3f}s, "
                f"duration={m.duration:.3f}s, "
                f"streamed={m.streamed}"
            )
        elif hasattr(m, 'audio_duration') and not hasattr(m, 'characters_count'):
            # STT metrics
            logger.info(
                f"📊 [METRICS-STT] audio_duration={m.audio_duration:.2f}s, "
                f"duration={m.duration:.3f}s, "
                f"streamed={m.streamed}"
            )
        else:
            # Other metrics (VAD, EOU, etc.)
            logger.info(f"📊 [METRICS-{metric_type}] {m}")

        # Collect for session summary
        self.usage_collector.collect(m)

    async def log_session_summary(self):
        """Log session usage summary on shutdown"""
        try:
            summary = self.usage_collector.get_summary()
            logger.info("=" * 60)
            logger.info("📊 [SESSION-METRICS] Final Usage Summary")
            logger.info("=" * 60)
            logger.info(f"📊 [SESSION-METRICS] LLM - prompt_tokens: {summary.llm_prompt_tokens}")
            logger.info(f"📊 [SESSION-METRICS] LLM - completion_tokens: {summary.llm_completion_tokens}")
            logger.info(f"📊 [SESSION-METRICS] TTS - characters: {summary.tts_characters_count}")
            logger.info(f"📊 [SESSION-METRICS] STT - audio_duration: {summary.stt_audio_duration:.2f}s")
            logger.info("=" * 60)

            return {
                "type": "usage_summary",
                "llm_prompt_tokens": summary.llm_prompt_tokens,
                "llm_completion_tokens": summary.llm_completion_tokens,
                "tts_characters": summary.tts_characters_count,
                "stt_audio_duration": summary.stt_audio_duration,
            }
        except Exception as e:
            logger.error(f"📊 [SESSION-METRICS] Failed to log usage summary: {e}")
            return None

    def setup_metrics_collection(self, session: AgentSession):
        """Setup metrics collection event handler on the session"""
        @session.on("metrics_collected")
        def _on_metrics_collected(ev: MetricsCollectedEvent):
            self.log_turn_metrics(ev)

        logger.info("📊 Metrics collection enabled (per-turn + session summary)")

    def get_collector(self):
        """Get the usage collector instance"""
        return self.usage_collector

    # Legacy method for backwards compatibility
    async def log_usage(self):
        """Log usage summary (legacy method)"""
        return await self.log_session_summary()
