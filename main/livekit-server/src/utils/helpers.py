import asyncio
import logging
import os
import httpx
from livekit.agents import metrics, MetricsCollectedEvent, AgentSession

logger = logging.getLogger("livekit_agent")

MANAGER_API_URL = os.environ.get("MANAGER_API_URL", "http://localhost:8002/toy")


class UsageManager:
    """Utility class for managing usage metrics and logging"""

    def __init__(self, mac_address: str = None):
        self.usage_collector = metrics.UsageCollector()
        self.mac_address = mac_address
        # Track realtime model tokens separately
        self.total_input_tokens = 0
        self.total_output_tokens = 0

    def set_mac_address(self, mac_address: str):
        """Set the MAC address for this session"""
        self.mac_address = mac_address

    def log_turn_metrics(self, ev: MetricsCollectedEvent):
        """Log metrics for each interaction (LLM/STT/TTS/Realtime)"""
        m = ev.metrics
        metric_type = type(m).__name__

        # Handle RealtimeModelMetrics (Gemini Realtime)
        if hasattr(m, 'input_tokens') and hasattr(m, 'output_tokens'):
            self.total_input_tokens += m.input_tokens
            self.total_output_tokens += m.output_tokens
            logger.info(
                f"📊 [METRICS-REALTIME] input={m.input_tokens}, "
                f"output={m.output_tokens}, "
                f"total={m.total_tokens}, "
                f"ttft={m.ttft:.2f}s, "
                f"duration={m.duration:.2f}s, "
                f"tokens/s={m.tokens_per_second:.1f}"
            )
        elif hasattr(m, 'prompt_tokens'):
            # Traditional LLM metrics
            self.total_input_tokens += m.prompt_tokens
            self.total_output_tokens += m.completion_tokens
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
            # Other metrics (VAD, EOU, etc.) - skip logging
            pass

        # Collect for session summary
        self.usage_collector.collect(m)

    async def log_session_summary(self):
        """Log session usage summary on shutdown and send to Manager API"""
        try:
            logger.info("=" * 60)
            logger.info("📊 [SESSION-METRICS] Final Usage Summary")
            logger.info("=" * 60)
            logger.info(f"📊 [SESSION-METRICS] Input Tokens: {self.total_input_tokens}")
            logger.info(f"📊 [SESSION-METRICS] Output Tokens: {self.total_output_tokens}")
            logger.info(f"📊 [SESSION-METRICS] Total Tokens: {self.total_input_tokens + self.total_output_tokens}")
            logger.info(f"📊 [SESSION-METRICS] MAC Address: {self.mac_address}")
            logger.info("=" * 60)

            # Send to Manager API if we have a MAC address
            if self.mac_address and (self.total_input_tokens > 0 or self.total_output_tokens > 0):
                await self._send_usage_to_api()

            return {
                "type": "usage_summary",
                "mac_address": self.mac_address,
                "input_tokens": self.total_input_tokens,
                "output_tokens": self.total_output_tokens,
                "total_tokens": self.total_input_tokens + self.total_output_tokens,
            }
        except Exception as e:
            logger.error(f"📊 [SESSION-METRICS] Failed to log usage summary: {e}")
            return None

    async def _send_usage_to_api(self):
        """Send usage data to Manager API"""
        try:
            url = f"{MANAGER_API_URL}/api/usage/tokens"
            payload = {
                "macAddress": self.mac_address,
                "inputTokens": self.total_input_tokens,
                "outputTokens": self.total_output_tokens
            }

            async with httpx.AsyncClient(timeout=10.0) as client:
                response = await client.post(url, json=payload)

                if response.status_code == 200:
                    logger.info(f"📊 [SESSION-METRICS] Successfully sent usage to Manager API: {payload}")
                else:
                    logger.error(f"📊 [SESSION-METRICS] Failed to send usage to Manager API: {response.status_code} - {response.text}")

        except Exception as e:
            logger.error(f"📊 [SESSION-METRICS] Error sending usage to Manager API: {e}")

    def setup_metrics_collection(self, session: AgentSession):
        """Setup metrics collection event handler on the session"""
        @session.on("metrics_collected")
        def _on_metrics_collected(ev: MetricsCollectedEvent):
            self.log_turn_metrics(ev)

        logger.info("📊 Metrics collection enabled (per-turn + session summary)")

    def get_collector(self):
        """Get the usage collector instance"""
        return self.usage_collector

    def get_total_tokens(self):
        """Get total tokens used in this session"""
        return {
            "input_tokens": self.total_input_tokens,
            "output_tokens": self.total_output_tokens,
            "total_tokens": self.total_input_tokens + self.total_output_tokens
        }

    # Legacy method for backwards compatibility
    async def log_usage(self):
        """Log usage summary (legacy method)"""
        return await self.log_session_summary()
