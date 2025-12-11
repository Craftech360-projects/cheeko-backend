import asyncio
import logging
import os
import time
import httpx
from livekit.agents import metrics, MetricsCollectedEvent, AgentSession
from livekit.agents.metrics import RealtimeModelMetrics

logger = logging.getLogger("livekit_agent")

MANAGER_API_URL = os.environ.get("MANAGER_API_URL", "http://localhost:8002/toy")


class UsageManager:
    """Utility class for managing usage metrics and logging"""

    def __init__(self, mac_address: str = None, session_id: str = None):
        self.usage_collector = metrics.UsageCollector()
        self.mac_address = mac_address
        self.session_id = session_id

        # Track billable input/output tokens (excluding cached tokens)
        self.total_input_tokens = 0  # Billable input tokens only
        self.total_output_tokens = 0

        # Track detailed token breakdown for Gemini cost calculation
        self.input_audio_tokens = 0
        self.input_text_tokens = 0
        self.input_cached_tokens = 0  # Tracked separately, not included in total
        self.output_audio_tokens = 0
        self.output_text_tokens = 0

        # Track session metrics
        self.session_start_time = time.time()
        self.message_count = 0
        self.total_ttft = 0.0  # Sum of all TTFT values
        self.total_response_duration = 0.0  # Sum of all response durations

    def set_mac_address(self, mac_address: str):
        """Set the MAC address for this session"""
        self.mac_address = mac_address

    def set_session_id(self, session_id: str):
        """Set the session ID for this session"""
        self.session_id = session_id

    def log_turn_metrics(self, ev: MetricsCollectedEvent):
        """Log metrics for Gemini Realtime model"""
        m = ev.metrics

        if isinstance(m, RealtimeModelMetrics):
            # Get cached tokens count
            cached_tokens = m.input_token_details.cached_tokens

            # Billable input tokens = total input - cached (cached tokens are free/discounted)
            billable_input = m.input_tokens - cached_tokens
            self.total_input_tokens += billable_input
            self.total_output_tokens += m.output_tokens

            # Detailed breakdown from input_token_details
            self.input_audio_tokens += m.input_token_details.audio_tokens
            self.input_text_tokens += m.input_token_details.text_tokens
            self.input_cached_tokens += cached_tokens

            # Detailed breakdown from output_token_details
            self.output_audio_tokens += m.output_token_details.audio_tokens
            self.output_text_tokens += m.output_token_details.text_tokens

            # Track TTFT and duration for analytics (ttft = -1 means no audio token was sent)
            if m.ttft is not None and m.ttft != -1:
                self.total_ttft += m.ttft
            if m.duration is not None:
                self.total_response_duration += m.duration

            # Count this as a message/turn
            self.message_count += 1

            logger.info(
                f"[METRICS-REALTIME] input={m.input_tokens} (billable={billable_input}, "
                f"audio={m.input_token_details.audio_tokens}, text={m.input_token_details.text_tokens}, "
                f"cached={cached_tokens}), output={m.output_tokens} "
                f"(audio={m.output_token_details.audio_tokens}, text={m.output_token_details.text_tokens}), "
                f"total={m.total_tokens}, ttft={m.ttft:.2f}s, duration={m.duration:.2f}s, "
                f"tokens/s={m.tokens_per_second:.1f}"
            )

            # Collect for session summary
            self.usage_collector.collect(m)

    async def log_session_summary(self):
        """Log session usage summary on shutdown and send to Manager API"""
        try:
            # Calculate session duration
            session_duration = time.time() - self.session_start_time

            # Calculate average TTFT
            avg_ttft = self.total_ttft / self.message_count if self.message_count > 0 else 0.0

            # logger.info("=" * 60)
            # logger.info("📊 [SESSION-METRICS] Final Usage Summary")
            # logger.info("=" * 60)
            # logger.info(f"📊 [SESSION-METRICS] Session ID: {self.session_id}")
            # logger.info(f"📊 [SESSION-METRICS] MAC Address: {self.mac_address}")
            # logger.info(f"📊 [SESSION-METRICS] Session Duration: {session_duration:.2f}s")
            # logger.info(f"📊 [SESSION-METRICS] Message Count: {self.message_count}")
            # logger.info(f"📊 [SESSION-METRICS] Average TTFT: {avg_ttft:.3f}s")
            # logger.info(f"📊 [SESSION-METRICS] Total Response Duration: {self.total_response_duration:.2f}s")
            # logger.info(f"📊 [SESSION-METRICS] Billable Input Tokens: {self.total_input_tokens}")
            # logger.info(f"📊 [SESSION-METRICS]   - Audio: {self.input_audio_tokens}")
            # logger.info(f"📊 [SESSION-METRICS]   - Text: {self.input_text_tokens}")
            # logger.info(f"📊 [SESSION-METRICS]   - Cached (excluded): {self.input_cached_tokens}")
            # logger.info(f"📊 [SESSION-METRICS] Output Tokens: {self.total_output_tokens}")
            # logger.info(f"📊 [SESSION-METRICS]   - Audio: {self.output_audio_tokens}")
            # logger.info(f"📊 [SESSION-METRICS]   - Text: {self.output_text_tokens}")
            # logger.info(f"📊 [SESSION-METRICS] Total Billable Tokens: {self.total_input_tokens + self.total_output_tokens}")
            # logger.info("=" * 60)

            # Send to Manager API if we have MAC address and session_id
            if self.mac_address and self.session_id and (self.total_input_tokens > 0 or self.total_output_tokens > 0):
                await self._send_usage_to_api(session_duration, avg_ttft)

            return {
                "type": "usage_summary",
                "mac_address": self.mac_address,
                "session_id": self.session_id,
                "session_duration_seconds": session_duration,
                "message_count": self.message_count,
                "avg_ttft_seconds": avg_ttft,
                "total_response_duration_seconds": self.total_response_duration,
                "input_tokens": self.total_input_tokens,
                "input_audio_tokens": self.input_audio_tokens,
                "input_text_tokens": self.input_text_tokens,
                "input_cached_tokens": self.input_cached_tokens,
                "output_tokens": self.total_output_tokens,
                "output_audio_tokens": self.output_audio_tokens,
                "output_text_tokens": self.output_text_tokens,
                "total_tokens": self.total_input_tokens + self.total_output_tokens,
            }
        except Exception as e:
            logger.error(f"📊 [SESSION-METRICS] Failed to log usage summary: {e}")
            return None

    async def _send_usage_to_api(self, session_duration: float, avg_ttft: float):
        """Send usage data to Manager API"""
        try:
            url = f"{MANAGER_API_URL}/usage/tokens"
            payload = {
                "macAddress": self.mac_address,
                "sessionId": self.session_id,
                "inputAudioTokens": self.input_audio_tokens,
                "inputTextTokens": self.input_text_tokens,
                "inputCachedTokens": self.input_cached_tokens,
                "inputTokens": self.total_input_tokens,
                "outputAudioTokens": self.output_audio_tokens,
                "outputTextTokens": self.output_text_tokens,
                "outputTokens": self.total_output_tokens,
                "sessionDurationSeconds": round(session_duration, 3),
                "avgTtftSeconds": round(avg_ttft, 3),
                "messageCount": self.message_count,
                "totalResponseDurationSeconds": round(self.total_response_duration, 3)
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
            "input_audio_tokens": self.input_audio_tokens,
            "input_text_tokens": self.input_text_tokens,
            "input_cached_tokens": self.input_cached_tokens,
            "output_tokens": self.total_output_tokens,
            "output_audio_tokens": self.output_audio_tokens,
            "output_text_tokens": self.output_text_tokens,
            "total_tokens": self.total_input_tokens + self.total_output_tokens,
            "message_count": self.message_count,
            "avg_ttft_seconds": self.total_ttft / self.message_count if self.message_count > 0 else 0.0
        }

    # Legacy method for backwards compatibility
    async def log_usage(self):
        """Log usage summary (legacy method)"""
        return await self.log_session_summary()
