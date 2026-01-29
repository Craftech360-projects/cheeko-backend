import asyncio
import logging
import os
import time
import httpx
from livekit.agents import metrics, MetricsCollectedEvent, AgentSession

logger = logging.getLogger("livekit_agent")

MANAGER_API_URL = os.environ.get("MANAGER_API_URL", "http://localhost:8002/toy")


class UsageManager:
    """Utility class for managing usage metrics and logging"""

    def __init__(self, mac_address: str = None, session_id: str = None):
        self.usage_collector = metrics.UsageCollector()
        self.mac_address = mac_address
        self.session_id = session_id

        # Track total input/output tokens
        self.total_input_tokens = 0
        self.total_output_tokens = 0

        # Track detailed token breakdown for Gemini cost calculation
        self.input_audio_tokens = 0
        self.input_text_tokens = 0
        self.input_cached_tokens = 0
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
        """Log metrics for each interaction (LLM/STT/TTS/Realtime)"""
        m = ev.metrics
        metric_type = type(m).__name__

        # Handle RealtimeModelMetrics (Gemini Realtime)
        if hasattr(m, 'input_tokens') and hasattr(m, 'output_tokens') and hasattr(m, 'input_token_details'):
            # Total tokens
            self.total_input_tokens += m.input_tokens
            self.total_output_tokens += m.output_tokens

            # Detailed breakdown from input_token_details
            if m.input_token_details:
                self.input_audio_tokens += getattr(m.input_token_details, 'audio_tokens', 0) or 0
                self.input_text_tokens += getattr(m.input_token_details, 'text_tokens', 0) or 0
                self.input_cached_tokens += getattr(m.input_token_details, 'cached_tokens', 0) or 0

            # Detailed breakdown from output_token_details
            if m.output_token_details:
                self.output_audio_tokens += getattr(m.output_token_details, 'audio_tokens', 0) or 0
                self.output_text_tokens += getattr(m.output_token_details, 'text_tokens', 0) or 0

            # Track TTFT and duration for analytics
            if hasattr(m, 'ttft') and m.ttft is not None:
                self.total_ttft += m.ttft
            if hasattr(m, 'duration') and m.duration is not None:
                self.total_response_duration += m.duration

            # Count this as a message/turn
            self.message_count += 1

            logger.info(
                f"📊 [METRICS-REALTIME] input={m.input_tokens} (audio={getattr(m.input_token_details, 'audio_tokens', 0)}, "
                f"text={getattr(m.input_token_details, 'text_tokens', 0)}, cached={getattr(m.input_token_details, 'cached_tokens', 0)}), "
                f"output={m.output_tokens} (audio={getattr(m.output_token_details, 'audio_tokens', 0)}, "
                f"text={getattr(m.output_token_details, 'text_tokens', 0)}), "
                f"total={m.total_tokens}, ttft={m.ttft:.2f}s, duration={m.duration:.2f}s, tokens/s={m.tokens_per_second:.1f}"
            )
        elif hasattr(m, 'input_tokens') and hasattr(m, 'output_tokens'):
            # Realtime metrics without detailed breakdown
            self.total_input_tokens += m.input_tokens
            self.total_output_tokens += m.output_tokens

            # Track TTFT and duration
            if hasattr(m, 'ttft') and m.ttft is not None:
                self.total_ttft += m.ttft
            if hasattr(m, 'duration') and m.duration is not None:
                self.total_response_duration += m.duration

            self.message_count += 1

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
            # For traditional LLM, treat all tokens as text tokens
            self.input_text_tokens += m.prompt_tokens
            self.output_text_tokens += m.completion_tokens

            # Track TTFT and duration
            if hasattr(m, 'ttft') and m.ttft is not None:
                self.total_ttft += m.ttft
            if hasattr(m, 'duration') and m.duration is not None:
                self.total_response_duration += m.duration

            self.message_count += 1

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
            # Calculate session duration
            session_duration = time.time() - self.session_start_time

            # Calculate average TTFT
            avg_ttft = self.total_ttft / self.message_count if self.message_count > 0 else 0.0

            logger.info("=" * 60)
            logger.info("📊 [SESSION-METRICS] Final Usage Summary")
            logger.info("=" * 60)
            logger.info(f"📊 [SESSION-METRICS] Session ID: {self.session_id}")
            logger.info(f"📊 [SESSION-METRICS] MAC Address: {self.mac_address}")
            logger.info(f"📊 [SESSION-METRICS] Session Duration: {session_duration:.2f}s")
            logger.info(f"📊 [SESSION-METRICS] Message Count: {self.message_count}")
            logger.info(f"📊 [SESSION-METRICS] Average TTFT: {avg_ttft:.3f}s")
            logger.info(f"📊 [SESSION-METRICS] Total Response Duration: {self.total_response_duration:.2f}s")
            logger.info(f"📊 [SESSION-METRICS] Input Tokens: {self.total_input_tokens}")
            logger.info(f"📊 [SESSION-METRICS]   - Audio: {self.input_audio_tokens}")
            logger.info(f"📊 [SESSION-METRICS]   - Text: {self.input_text_tokens}")
            logger.info(f"📊 [SESSION-METRICS]   - Cached: {self.input_cached_tokens}")
            logger.info(f"📊 [SESSION-METRICS] Output Tokens: {self.total_output_tokens}")
            logger.info(f"📊 [SESSION-METRICS]   - Audio: {self.output_audio_tokens}")
            logger.info(f"📊 [SESSION-METRICS]   - Text: {self.output_text_tokens}")
            logger.info(f"📊 [SESSION-METRICS] Total Tokens: {self.total_input_tokens + self.total_output_tokens}")
            logger.info("=" * 60)

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
            url = f"{MANAGER_API_URL}/device/token-usage"
            payload = {
                "mac": self.mac_address,
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

            async with httpx.AsyncClient(timeout=5.0) as client:
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


class GameAnalyticsManager:
    """
    Utility class for managing game analytics metrics locally and sending on session close.
    Similar pattern to UsageManager - stores metrics locally, sends batch on cleanup.
    """

    # Mode type normalization map
    MODE_TYPE_MAP = {
        'cheeko': 'conversation',
        'math tutor': 'math_tutor',
        'riddle solver': 'riddle_solver',
        'word ladder': 'word_ladder',
        'music': 'music',
        'story': 'story',
        'conversation': 'conversation',
        'math_tutor': 'math_tutor',
        'riddle_solver': 'riddle_solver',
        'word_ladder': 'word_ladder'
    }

    def __init__(self, mac_address: str, session_id: str, mode_type: str, agent_id: str = None):
        """
        Initialize game analytics manager.

        Args:
            mac_address: Device MAC address
            session_id: Session identifier (room name)
            mode_type: Game mode (math_tutor, riddle_solver, word_ladder, etc.)
            agent_id: Agent identifier (optional)
        """
        self.mac_address = mac_address
        self.session_id = session_id
        self.agent_id = agent_id
        self.mode_type = self._normalize_mode_type(mode_type)

        # Session tracking
        self.session_start_time = time.time()
        self.interaction_count = 0

        # Game attempts storage (batch send on close)
        self.attempts = []

        # Streak tracking
        self.current_streak = 0
        self.longest_streak = 0
        self.streak_count = 0

        logger.info(f"🎮 [GAME-ANALYTICS] Initialized - MAC: {mac_address}, Mode: {self.mode_type}, Session: {session_id}")

    def _normalize_mode_type(self, mode_name: str) -> str:
        """Normalize mode type to consistent snake_case format"""
        if not mode_name:
            return 'conversation'
        mode_lower = mode_name.lower()
        if mode_lower in self.MODE_TYPE_MAP:
            return self.MODE_TYPE_MAP[mode_lower]
        return mode_lower.replace(' ', '_')

    def record_attempt(
        self,
        game_type: str,
        is_correct: bool,
        attempt_number: int = 1,
        response_time_ms: int = None,
        question_type: str = None,
        difficulty_level: str = None
    ):
        """
        Record a game attempt locally (will be sent on session close).

        Args:
            game_type: Game type (math_tutor, riddle_solver, word_ladder)
            is_correct: Whether answer was correct
            attempt_number: Attempt number (1 or 2)
            response_time_ms: Response time in milliseconds
            question_type: Question type (addition, subtraction, etc.)
            difficulty_level: Difficulty level (easy, medium, hard)
        """
        attempt = {
            'game_type': game_type,
            'is_correct': is_correct,
            'attempt_number': attempt_number,
            'response_time_ms': response_time_ms,
            'question_type': question_type,
            'difficulty_level': difficulty_level,
            'answered_at': time.time()
        }
        self.attempts.append(attempt)
        self.interaction_count += 1

        # Update streak tracking
        if is_correct:
            self.current_streak += 1
            if self.current_streak > self.longest_streak:
                self.longest_streak = self.current_streak
        else:
            if self.current_streak > 0:
                self.streak_count += 1
            self.current_streak = 0

        logger.info(f"🎮 [GAME-ANALYTICS] Attempt recorded - Game: {game_type}, Correct: {is_correct}, Streak: {self.current_streak}")

    def get_stats(self):
        """Get current session statistics"""
        total_attempts = len(self.attempts)
        correct_attempts = sum(1 for a in self.attempts if a['is_correct'])
        accuracy = (correct_attempts / total_attempts * 100) if total_attempts > 0 else 0

        return {
            'total_attempts': total_attempts,
            'correct_attempts': correct_attempts,
            'accuracy': round(accuracy, 1),
            'current_streak': self.current_streak,
            'longest_streak': self.longest_streak,
            'streak_count': self.streak_count
        }

    async def send_analytics(self, completion_status: str = 'completed'):
        """
        Send all accumulated analytics to Manager API on session close.

        Args:
            completion_status: Session completion status (completed, interrupted, switched, victory, failure)
        """
        logger.info(f"🎮 [GAME-ANALYTICS] send_analytics() called with status={completion_status}, attempts={len(self.attempts)}")
        try:
            session_duration = int(time.time() - self.session_start_time)
            stats = self.get_stats()

            logger.info("=" * 60)
            logger.info("🎮 [GAME-ANALYTICS] Session Summary")
            logger.info("=" * 60)
            logger.info(f"🎮 [GAME-ANALYTICS] Session ID: {self.session_id}")
            logger.info(f"🎮 [GAME-ANALYTICS] MAC Address: {self.mac_address}")
            logger.info(f"🎮 [GAME-ANALYTICS] Mode: {self.mode_type}")
            logger.info(f"🎮 [GAME-ANALYTICS] Duration: {session_duration}s")
            logger.info(f"🎮 [GAME-ANALYTICS] Total Attempts: {stats['total_attempts']}")
            logger.info(f"🎮 [GAME-ANALYTICS] Correct: {stats['correct_attempts']}")
            logger.info(f"🎮 [GAME-ANALYTICS] Accuracy: {stats['accuracy']}%")
            logger.info(f"🎮 [GAME-ANALYTICS] Longest Streak: {stats['longest_streak']}")
            logger.info(f"🎮 [GAME-ANALYTICS] Status: {completion_status}")
            logger.info("=" * 60)

            # Only send if we have attempts
            if len(self.attempts) == 0:
                logger.info("🎮 [GAME-ANALYTICS] No attempts to send, skipping API call")
                return

            # Send session and attempts in one batch request
            await self._send_batch_to_api(session_duration, completion_status)

        except Exception as e:
            logger.error(f"🎮 [GAME-ANALYTICS] Failed to send analytics: {e}")

    async def _send_batch_to_api(self, session_duration: int, completion_status: str):
        """Send batch analytics data to Manager API"""
        try:
            # Get service secret from environment
            service_secret = os.environ.get("MANAGER_API_SECRET", "")

            headers = {
                "X-Service-Key": service_secret,
                "Content-Type": "application/json"
            }

            async with httpx.AsyncClient(timeout=5.0) as client:
                # 1. Start session (API expects 'mac' not 'macAddress')
                # API generates its own sessionId, we'll use that for attempts
                session_payload = {
                    "mac": self.mac_address,
                    "agentId": self.agent_id,
                    "modeType": self.mode_type,
                    "metadata": None
                }

                session_url = f"{MANAGER_API_URL}/analytics/session/start"
                response = await client.post(session_url, json=session_payload, headers=headers)

                # Get the API-generated sessionId from response
                api_session_id = self.session_id  # fallback to our session_id
                if response.status_code == 200:
                    try:
                        resp_data = response.json()
                        if resp_data.get('data') and resp_data['data'].get('session_id'):
                            api_session_id = resp_data['data']['session_id']
                            logger.info(f"🎮 [GAME-ANALYTICS] Session started with ID: {api_session_id}")
                    except Exception as e:
                        logger.warning(f"🎮 [GAME-ANALYTICS] Could not parse session response: {e}")
                else:
                    resp_text = response.text
                    logger.warning(f"🎮 [GAME-ANALYTICS] Failed to start session: {response.status_code} - {resp_text}")

                # 2. Send all attempts using the API-generated sessionId
                attempt_url = f"{MANAGER_API_URL}/analytics/game-attempt"
                success_count = 0
                for attempt in self.attempts:
                    attempt_payload = {
                        "sessionId": api_session_id,
                        "mac": self.mac_address,
                        "gameType": attempt['game_type'],
                        "isCorrect": attempt['is_correct'],
                        "attemptNumber": attempt['attempt_number'],
                        "responseTimeMs": attempt['response_time_ms'],
                        "questionType": attempt['question_type'],
                        "difficultyLevel": attempt['difficulty_level'],
                        "answeredAt": time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime(attempt['answered_at'])),
                        # Privacy: don't send question/answer text
                        "questionText": None,
                        "correctAnswer": None,
                        "userAnswer": None,
                        "metadata": None
                    }
                    logger.info(f"🎮 [GAME-ANALYTICS] Sending attempt payload: {attempt_payload}")

                    resp = await client.post(attempt_url, json=attempt_payload, headers=headers)
                    if resp.status_code == 200:
                        success_count += 1
                    else:
                        logger.warning(f"🎮 [GAME-ANALYTICS] Failed to send attempt: {resp.status_code}")

                # 3. End session (use API-generated sessionId, send as JSON body not query params)
                end_url = f"{MANAGER_API_URL}/analytics/session/end"
                end_payload = {
                    "sessionId": api_session_id,
                    "completionStatus": completion_status,
                    "interactionCount": len(self.attempts)
                }
                response = await client.post(end_url, json=end_payload, headers=headers)

                if response.status_code == 200:
                    logger.info(f"🎮 [GAME-ANALYTICS] Successfully sent {success_count}/{len(self.attempts)} attempts to API")
                else:
                    resp_text = response.text
                    logger.warning(f"🎮 [GAME-ANALYTICS] Failed to end session: {response.status_code} - {resp_text}")

        except Exception as e:
            import traceback
            logger.error(f"🎮 [GAME-ANALYTICS] Error sending batch to API: {e}")
            logger.error(f"🎮 [GAME-ANALYTICS] Traceback: {traceback.format_exc()}")
