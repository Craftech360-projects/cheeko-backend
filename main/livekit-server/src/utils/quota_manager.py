"""
QuotaManager - Client-side cached quota manager for agent workers.

Supports multiple quota types dispatched from a unified endpoint:
  - "question": 1 speech turn = 1 question consumed
  - "token": weighted LLM tokens consumed per turn (audio*weight + text*weight)

Fetches quota once at session start, tracks locally with fire-and-update
server increments. Re-syncs every N turns for multi-device accuracy.
Fail-open: if API is unreachable, allow the session.
"""

import asyncio
import aiohttp
import logging
import math
import time as time_module
from datetime import datetime, timezone
from typing import Tuple, Optional

logger = logging.getLogger("quota_manager")

# Re-sync from server every N turns to handle multi-device edge case
RESYNC_INTERVAL = 3

# Child-friendly limit messages per quota type
LIMIT_MESSAGES = {
    "question": (
        "Oh no! Your free questions are all used up this month! "
        "Ask your parents to get more so we can keep chatting! Bye bye for now!"
    ),
    "token": (
        "Oh no! We've used up all our chat energy this month! "
        "Ask your parents to get more so we can keep talking! Bye bye for now!"
    ),
    "time": (
        "Oh no! Our playtime is all used up this month! "
        "Ask your parents to get more time so we can keep playing! Bye bye for now!"
    ),
}

GAME_SESSION_DENIED_MESSAGES = {
    "quota_exhausted": (
        "Oh no! Your free questions are all used up this month! "
        "Ask your parents to get more so we can play again! Bye bye for now!"
    ),
    "active_session_exists": (
        "Oops! It looks like you already have a game going! "
        "Please wait a little bit and try again. See you soon!"
    ),
    "default": (
        "Oh no! We can't start a new game right now. "
        "Please try again in a little while! Bye bye for now!"
    ),
}

LOW_QUOTA_INSTRUCTIONS = {
    "question": (
        "Briefly mention that the child only has {remaining} questions left this month, "
        "then answer the child's question normally."
    ),
    "token": (
        "Briefly mention that the child's chat energy is running low, "
        "then answer the child's question normally."
    ),
    "time": (
        "Briefly mention that the child only has {remaining_minutes} minutes of playtime left this month, "
        "then answer the child's question normally."
    ),
}

# Low quota warning thresholds per type
LOW_QUOTA_THRESHOLDS = {
    "question": 3,         # warn at 3 questions left
    "token": 0.10,         # warn at 10% remaining
    "time": 300,           # warn at 5 minutes (300 seconds) remaining
}

# How often to report time to server (seconds)
TIME_REPORT_INTERVAL = 30


class QuotaManager:
    """
    Lightweight client-side quota cache for agent workers.

    - initialize() fetches unified quota at session start
    - consume() dispatches to question or token consumption based on quota_type
    - Fail-open: if API unreachable, allow the session (don't punish children)
    """

    def __init__(self, mac_address: str, manager_api_url: str, secret: str):
        self.mac_address = mac_address.replace(":", "").replace("-", "").lower()
        self.api_url = manager_api_url.rstrip("/")
        self.secret = secret

        # AI Card context (set when session is for an AI card)
        self.rfid_uid: Optional[str] = None  # Normalized uppercase RFID UID
        self._ai_card_initialized: bool = False
        self._on_quota_exhausted_callback = None  # Callback for mid-session exhaustion

        # Fail-open configuration
        self._fail_mode: str = "open"  # "open" or "capped"
        self._fail_local_cap_seconds: int = 600  # 10 minutes cap for fail-capped mode
        self._fail_local_seconds_used: int = 0  # Local tracking when API unreachable

        # Quota state (populated by initialize)
        self.quota_type: str = "question"  # "question" or "token"
        self.remaining: int = -1           # -1 = unlimited
        self.is_exhausted: bool = False
        self.is_unbound: bool = False
        self.limit: int = 20
        self.used: int = 0
        self.extra_purchased: int = 0

        # Token-specific state
        self.audio_token_weight: float = 1.5
        self.text_token_weight: float = 1.0
        self._last_reported_audio: int = 0   # cumulative audio tokens last sent to server
        self._last_reported_text: int = 0    # cumulative text tokens last sent to server

        # Plan info
        self.plan_name: str = "Free"
        self.plan_code: str = ""

        # Backward compat aliases
        self.free_limit: int = 20
        self.questions_used: int = 0

        # Internal tracking
        self._initialized: bool = False
        self._local_increments: int = 0
        self._total_turns: int = 0
        self._month_key: str = self._get_current_month_key()

        # Time-specific state
        self._session_start_time: Optional[float] = None  # time.monotonic() at session start
        self._total_seconds_reported: int = 0              # cumulative seconds sent to server
        self._time_tracker_task: Optional[asyncio.Task] = None  # background timer task
        self._time_tracker_running: bool = False

        # Game session protection
        self._in_game_session: bool = False
        self._game_session_id: Optional[str] = None
        self._game_agent_type: Optional[str] = None
        self._game_session_denied_reason: Optional[str] = None

    async def initialize(self) -> None:
        """
        Fetch unified quota from server. Call once at session start.
        Uses GET /subscription/quota/:mac which returns quota_type + remaining + weights.
        Falls back to legacy GET /quota/check/:mac if unified endpoint unavailable.
        """
        try:
            data = await self._api_get(f"/subscription/quota/{self.mac_address}")
            if data:
                self._apply_unified_quota(data)
                self._initialized = True
                logger.info(
                    f"[QUOTA] Initialized for {self.mac_address}: "
                    f"type={self.quota_type}, remaining={self.remaining}, "
                    f"limit={self.limit}, unbound={self.is_unbound}"
                )
                return

            # Fallback to legacy endpoint
            data = await self._api_get(f"/quota/check/{self.mac_address}")
            if data:
                self._apply_legacy_quota(data)
                self._initialized = True
                logger.info(
                    f"[QUOTA] Initialized (legacy) for {self.mac_address}: "
                    f"remaining={self.remaining}, exhausted={self.is_exhausted}"
                )
            else:
                logger.warning("[QUOTA] No data from server, fail-open (unlimited)")
                self._fail_open()
        except Exception as e:
            logger.warning(f"[QUOTA] Failed to initialize: {e}, fail-open (unlimited)")
            self._fail_open()

    async def set_ai_card_context(self, rfid_uid: str) -> None:
        """
        Set AI card context and fetch quota. Call when an AI card tap is received.

        This switches the QuotaManager from device-level (MAC) quota tracking
        to per-card quota tracking. The time tracker will report to the
        AI card endpoint.

        Args:
            rfid_uid: Normalized RFID UID (uppercase, no separators)
        """
        # Normalize UID to uppercase
        self.rfid_uid = rfid_uid.strip().upper().replace(":", "").replace("-", "")

        if not self.rfid_uid:
            logger.warning("[QUOTA] Empty rfid_uid passed to set_ai_card_context")
            return

        if self._ai_card_initialized:
            logger.debug(f"[QUOTA] AI card context already set for {self.rfid_uid}")
            return

        self._ai_card_initialized = True

        try:
            data = await self._api_get(f"/subscription/quota/ai-card/{self.rfid_uid}")
            if data:
                self.quota_type = "time"
                self.remaining = data.get("remaining", 0)
                self.is_exhausted = data.get("isExhausted", False)
                self.limit = data.get("limit", 0)
                self.used = data.get("used", 0)
                self.extra_purchased = data.get("extraPurchased", 0)
                self.plan_name = data.get("cardName", "AI Card")

                if not self.is_exhausted:
                    self.start_time_tracker()

                logger.info(
                    f"[QUOTA] AI card context set: rfid={self.rfid_uid}, "
                    f"remaining={self.remaining}s, limit={self.limit}s"
                )
            else:
                logger.warning(f"[QUOTA] No AI card quota data for {self.rfid_uid}, fail-open")
                self._fail_open()
        except Exception as e:
            logger.warning(f"[QUOTA] Failed to fetch AI card quota: {e}, fail-open")
            self._fail_open()

    def _fail_open(self) -> None:
        """
        Handle API unreachable scenario based on fail_mode config.

        - "open": Allow unlimited access (current default behavior)
        - "capped": Allow up to _fail_local_cap_seconds locally, then hard stop
        """
        if self._fail_mode == "capped":
            # Fail-capped mode: allow limited local time then hard stop
            self.remaining = self._fail_local_cap_seconds
            self.is_exhausted = False
            self._initialized = True
            logger.info(
                f"[QUOTA] Fail-capped mode: allowing {self._fail_local_cap_seconds}s "
                f"local session for {self.rfid_uid or self.mac_address}"
            )
            # Start time tracker to count down local cap
            if not self._time_tracker_running:
                self._session_start_time = time_module.monotonic()
                self._time_tracker_running = True
                self._time_tracker_task = asyncio.create_task(self._fail_capped_tracker_loop())
        else:
            # Fail-open mode: unlimited access
            self.remaining = -1
            self.is_exhausted = False
            self.is_unbound = True
            self._initialized = True

    async def _fail_capped_tracker_loop(self) -> None:
        """
        Tracker for fail-capped mode. Counts down local cap seconds
        and hard stops when exhausted.
        """
        try:
            while self._time_tracker_running:
                await asyncio.sleep(TIME_REPORT_INTERVAL)

                if not self._time_tracker_running:
                    break

                # Count elapsed seconds since last tick
                delta = min(TIME_REPORT_INTERVAL, self.remaining) if self.remaining > 0 else TIME_REPORT_INTERVAL
                self._fail_local_seconds_used += delta
                self.remaining = max(0, self._fail_local_cap_seconds - self._fail_local_seconds_used)

                if self.remaining <= 0:
                    logger.warning(
                        f"[QUOTA] Fail-capped local cap exhausted: "
                        f"rfid={self.rfid_uid or 'N/A'}, mac={self.mac_address}"
                    )
                    self.is_exhausted = True
                    # Trigger MQTT exhaust and callback
                    asyncio.create_task(self._publish_mqtt_exhaust())
                    if self._on_quota_exhausted_callback:
                        asyncio.create_task(self._on_quota_exhausted_callback())
                    break

        except asyncio.CancelledError:
            pass

    def _apply_unified_quota(self, data: dict) -> None:
        """Apply data from unified quota endpoint."""
        self.quota_type = data.get("quotaType", "question")
        self.remaining = data.get("remaining", -1)
        self.is_exhausted = data.get("isExhausted", False)
        self.is_unbound = data.get("isUnbound", False)
        self.limit = data.get("limit", 20)
        self.used = data.get("used", 0)
        self.extra_purchased = data.get("extraPurchased", 0)
        self.audio_token_weight = data.get("audioTokenWeight", 1.5)
        self.text_token_weight = data.get("textTokenWeight", 1.0)
        self.plan_name = data.get("planName", "Free")
        self.plan_code = data.get("planCode", "")

        # Backward compat
        self.free_limit = self.limit
        self.questions_used = self.used

    def _apply_legacy_quota(self, data: dict) -> None:
        """Apply data from legacy /quota/check endpoint (question-only)."""
        self.quota_type = "question"
        self.remaining = data.get("remaining", -1)
        self.is_exhausted = data.get("isExhausted", False)
        self.is_unbound = data.get("isUnbound", False)
        self.free_limit = data.get("freeLimit", 20)
        self.limit = self.free_limit + data.get("extraPurchased", 0)
        self.used = data.get("questionsUsed", 0)
        self.questions_used = self.used
        self.extra_purchased = data.get("extraPurchased", 0)

    # ==================== UNIFIED CONSUME ====================

    async def consume(
        self,
        audio_input: int = 0,
        audio_output: int = 0,
        text_input: int = 0,
        text_output: int = 0,
    ) -> Tuple[bool, int]:
        """
        Consume quota based on quota_type.

        For question-based: ignores token params, decrements by 1.
        For token-based: calculates weighted delta from cumulative token counts.

        Args:
            audio_input: Cumulative audio input tokens (from UsageManager)
            audio_output: Cumulative audio output tokens
            text_input: Cumulative text input tokens
            text_output: Cumulative text output tokens

        Returns:
            (is_allowed, remaining)
        """
        if self.quota_type == "time":
            return await self._consume_time()
        elif self.quota_type == "token":
            return await self._consume_token(
                audio_input, audio_output, text_input, text_output
            )
        else:
            return await self.consume_question()

    async def consume_question(self) -> Tuple[bool, int]:
        """
        Consume one question from quota.

        Returns:
            (is_allowed, remaining): Whether the question is allowed and how many remain.
        """
        # Unbound or uninitialized = unlimited
        if self.is_unbound or not self._initialized or self.remaining == -1:
            return True, -1

        # Already exhausted
        if self.remaining <= 0:
            self.is_exhausted = True
            # GAME SESSION PROTECTION: allow questions within active game
            if self._in_game_session:
                self._total_turns += 1
                self._local_increments += 1
                self.questions_used += 1
                self.used = self.questions_used
                asyncio.create_task(self._fire_and_update_question())
                return True, 0
            return False, 0

        self._total_turns += 1
        self._local_increments += 1

        # Decrement local counter
        self.remaining -= 1
        self.questions_used += 1
        self.used = self.questions_used
        self.is_exhausted = self.remaining <= 0

        # Fire-and-update
        asyncio.create_task(self._fire_and_update_question())

        # Re-sync periodically
        if self._local_increments >= RESYNC_INTERVAL:
            asyncio.create_task(self._resync())

        return True, self.remaining

    async def _consume_token(
        self,
        audio_input: int,
        audio_output: int,
        text_input: int,
        text_output: int,
    ) -> Tuple[bool, int]:
        """
        Consume weighted tokens from quota.

        Calculates delta from last reported cumulative counts, applies weights,
        decrements locally, and fires POST to server.
        """
        # Unbound or uninitialized = unlimited
        if self.is_unbound or not self._initialized or self.remaining == -1:
            return True, -1

        # Calculate delta since last report
        total_audio = audio_input + audio_output
        total_text = text_input + text_output
        delta_audio = max(0, total_audio - self._last_reported_audio)
        delta_text = max(0, total_text - self._last_reported_text)

        # No new tokens = no consumption
        if delta_audio == 0 and delta_text == 0:
            return (not self.is_exhausted), self.remaining

        # Calculate weighted tokens
        weighted = math.ceil(
            delta_audio * self.audio_token_weight +
            delta_text * self.text_token_weight
        )

        # Update last reported
        self._last_reported_audio = total_audio
        self._last_reported_text = total_text

        self._total_turns += 1
        self._local_increments += 1

        # Already exhausted
        if self.remaining <= 0:
            self.is_exhausted = True
            if self._in_game_session:
                self.used += weighted
                asyncio.create_task(self._fire_and_update_token(
                    weighted, delta_audio, delta_text
                ))
                return True, 0
            return False, 0

        # Decrement locally
        self.remaining = max(0, self.remaining - weighted)
        self.used += weighted
        self.is_exhausted = self.remaining <= 0

        # Fire-and-update
        asyncio.create_task(self._fire_and_update_token(
            weighted, delta_audio, delta_text
        ))

        # Re-sync periodically
        if self._local_increments >= RESYNC_INTERVAL:
            asyncio.create_task(self._resync())

        return True, self.remaining

    def start_time_tracker(self) -> None:
        """
        Start the background time tracker. Call after initialize() for time-based plans.
        Runs a background loop that ticks every TIME_REPORT_INTERVAL seconds,
        updates local remaining, and reports consumed seconds to the server.
        Connected time = consumed time (fair billing).
        """
        if self.quota_type != "time":
            return
        if self.is_unbound or self.remaining == -1:
            return
        if self._time_tracker_running:
            return

        self._session_start_time = time_module.monotonic()
        self._time_tracker_running = True
        self._time_tracker_task = asyncio.create_task(self._time_tracker_loop())
        logger.info(f"[QUOTA] Time tracker started for {self.mac_address} (limit={self.limit}s)")

    async def stop_time_tracker(self) -> None:
        """
        Stop the background time tracker. Call when session ends / participant disconnects.
        Reports any remaining unreported seconds to the server.
        """
        self._time_tracker_running = False

        if self._time_tracker_task and not self._time_tracker_task.done():
            self._time_tracker_task.cancel()
            try:
                await self._time_tracker_task
            except asyncio.CancelledError:
                pass

        # Report any remaining unreported seconds
        if self._session_start_time is not None:
            elapsed_total = int(time_module.monotonic() - self._session_start_time)
            delta = elapsed_total - self._total_seconds_reported
            if delta > 0:
                self._total_seconds_reported = elapsed_total
                self._update_local_time(elapsed_total)
                await self._fire_and_update_time(delta)
                logger.info(f"[QUOTA] Time tracker stopped, final report: {delta}s (total={elapsed_total}s)")

    async def _time_tracker_loop(self) -> None:
        """Background loop that ticks every TIME_REPORT_INTERVAL seconds."""
        try:
            while self._time_tracker_running:
                await asyncio.sleep(TIME_REPORT_INTERVAL)

                if not self._time_tracker_running:
                    break

                elapsed_total = int(time_module.monotonic() - self._session_start_time)
                delta = elapsed_total - self._total_seconds_reported

                if delta <= 0:
                    continue

                # Update local state
                was_exhausted = self.is_exhausted
                self._update_local_time(elapsed_total)
                self._total_seconds_reported = elapsed_total

                # Report to server
                asyncio.create_task(self._fire_and_update_time(delta))

                logger.debug(
                    f"[QUOTA] Time tick: elapsed={elapsed_total}s, "
                    f"remaining={self.remaining}s, exhausted={self.is_exhausted}"
                )

                # If just became exhausted, stop the loop and trigger MQTT
                if self.is_exhausted and not was_exhausted and not self._in_game_session:
                    logger.info(
                        f"[QUOTA] Time exhausted in tracker loop: "
                        f"rfid={self.rfid_uid or 'N/A'}, mac={self.mac_address}"
                    )
                    # Trigger MQTT exhaust message
                    asyncio.create_task(self._publish_mqtt_exhaust())
                    # Signal worker to disconnect via callback
                    if self._on_quota_exhausted_callback:
                        asyncio.create_task(self._on_quota_exhausted_callback())
                    break

        except asyncio.CancelledError:
            pass

    def _update_local_time(self, elapsed_total: int) -> None:
        """Update local quota state based on total elapsed seconds."""
        self.used = elapsed_total
        self.remaining = max(0, self.limit - elapsed_total)
        self.is_exhausted = self.remaining <= 0

    async def _consume_time(self) -> Tuple[bool, int]:
        """
        Check time quota status (called on each speech turn).

        The actual time tracking is done by the background timer (_time_tracker_loop).
        This method just returns the current state so the worker can decide
        whether to allow the turn or disconnect.

        Returns:
            (is_allowed, remaining_seconds)
        """
        # Unbound or uninitialized = unlimited
        if self.is_unbound or not self._initialized or self.remaining == -1:
            return True, -1

        # Start tracker if not already running (safety net)
        if not self._time_tracker_running:
            self.start_time_tracker()

        # Update local state from elapsed time
        if self._session_start_time is not None:
            elapsed_total = int(time_module.monotonic() - self._session_start_time)
            self._update_local_time(elapsed_total)

        if self.is_exhausted:
            if self._in_game_session:
                return True, 0
            return False, 0

        return True, self.remaining

    # ==================== WARNING & MESSAGES ====================

    def should_warn_low_quota(self) -> bool:
        """Check if we should warn the child about low quota."""
        if self.is_unbound or self.remaining == -1:
            return False

        if self.quota_type == "token":
            # Warn at 10% remaining
            if self.limit <= 0:
                return False
            ratio = self.remaining / self.limit
            return ratio <= LOW_QUOTA_THRESHOLDS["token"] and ratio > 0
        elif self.quota_type == "time":
            # Warn at 5 minutes remaining
            return 0 < self.remaining <= LOW_QUOTA_THRESHOLDS["time"]
        else:
            return self.remaining == LOW_QUOTA_THRESHOLDS["question"]

    def get_low_quota_instruction(self) -> str:
        """Get instruction for low quota warning."""
        template = LOW_QUOTA_INSTRUCTIONS.get(
            self.quota_type, LOW_QUOTA_INSTRUCTIONS["question"]
        )
        remaining_minutes = max(1, self.remaining // 60) if self.quota_type == "time" else 0
        return template.format(remaining=self.remaining, remaining_minutes=remaining_minutes)

    def get_limit_message(self) -> str:
        """Get the child-friendly exhaustion message."""
        return LIMIT_MESSAGES.get(self.quota_type, LIMIT_MESSAGES["question"])

    def get_game_session_denied_message(self) -> str:
        """Get the child-friendly game session denial message."""
        reason = self._game_session_denied_reason or "default"
        return GAME_SESSION_DENIED_MESSAGES.get(reason, GAME_SESSION_DENIED_MESSAGES["default"])

    # ==================== GAME SESSION PROTECTION ====================

    @property
    def in_game_session(self) -> bool:
        """Whether a protected game session is currently active."""
        return self._in_game_session

    async def start_game_session(self, agent_type: str, session_id: str) -> Tuple[bool, str]:
        """
        Start a protected game session.

        Returns:
            (allowed, reason)
        """
        # Unbound/unlimited devices - always allow
        if self.is_unbound or self.remaining == -1:
            self._in_game_session = True
            self._game_session_id = session_id
            self._game_agent_type = agent_type
            return True, "unbound_device"

        try:
            data = await self._api_post(
                f"/quota/game-session/start/{self.mac_address}",
                body={"agent_type": agent_type, "session_id": session_id}
            )
            if data:
                allowed = data.get("allowed", False)
                reason = data.get("reason", "unknown")
                if allowed:
                    self._in_game_session = True
                    self._game_session_id = session_id
                    self._game_agent_type = agent_type
                    if data.get("remaining") is not None:
                        self.remaining = data["remaining"]
                    logger.info(f"[QUOTA] Game session started: {agent_type}, remaining={self.remaining}")
                else:
                    self._game_session_denied_reason = reason
                    logger.warning(f"[QUOTA] Game session denied: {reason}")
                return allowed, reason
            else:
                logger.warning("[QUOTA] No response from game session API, fail-open")
                self._in_game_session = True
                self._game_session_id = session_id
                self._game_agent_type = agent_type
                return True, "fail_open"
        except Exception as e:
            logger.warning(f"[QUOTA] Game session start failed: {e}, fail-open")
            self._in_game_session = True
            self._game_session_id = session_id
            self._game_agent_type = agent_type
            return True, "fail_open"

    async def end_game_session(self, status: str = "completed") -> None:
        """End a protected game session."""
        if not self._in_game_session:
            return

        self._in_game_session = False
        agent_type = self._game_agent_type
        session_id = self._game_session_id
        self._game_session_id = None
        self._game_agent_type = None

        if self.is_unbound:
            return

        try:
            await self._api_post(
                f"/quota/game-session/end/{self.mac_address}",
                body={"agent_type": agent_type, "session_id": session_id, "status": status}
            )
            logger.info(f"[QUOTA] Game session ended: {agent_type}, status={status}")
        except Exception as e:
            logger.warning(f"[QUOTA] Failed to end game session: {e}")

    # ==================== INTERNALS ====================

    @staticmethod
    def _get_current_month_key() -> str:
        """Get current month key in YYYY-MM format (UTC)."""
        now = datetime.now(timezone.utc)
        return f"{now.year}-{now.month:02d}"

    def _fail_open(self) -> None:
        """Set fail-open state - allow everything."""
        self.remaining = -1
        self.is_exhausted = False
        self.is_unbound = True
        self._initialized = True

    async def _fire_and_update_question(self) -> None:
        """POST question increment to server with retry."""
        backoff_delays = [0.5, 1.0]
        for attempt in range(3):
            try:
                data = await self._api_post(
                    f"/quota/increment/{self.mac_address}",
                    body={"month_key": self._month_key}
                )
                if data:
                    self.remaining = data.get("remaining", self.remaining)
                    self.is_exhausted = data.get("isExhausted", self.is_exhausted)
                    self.questions_used = data.get("questionsUsed", self.questions_used)
                    self.used = self.questions_used
                    self.extra_purchased = data.get("extraPurchased", self.extra_purchased)
                    logger.debug(f"[QUOTA] Server sync (question): remaining={self.remaining}")
                return
            except Exception as e:
                if attempt < len(backoff_delays):
                    logger.debug(f"[QUOTA] Question increment attempt {attempt + 1} failed: {e}, retrying...")
                    await asyncio.sleep(backoff_delays[attempt])
                else:
                    logger.debug(f"[QUOTA] All question increment retries failed: {e}")

    async def _fire_and_update_token(self, weighted: int, raw_input: int, raw_output: int) -> None:
        """POST token consumption to server with retry."""
        backoff_delays = [0.5, 1.0]
        for attempt in range(3):
            try:
                data = await self._api_post(
                    f"/quota/consume/token/{self.mac_address}",
                    body={
                        "weightedTokens": weighted,
                        "rawInput": raw_input,
                        "rawOutput": raw_output,
                        "monthKey": self._month_key,
                    }
                )
                if data:
                    self.remaining = data.get("remaining", self.remaining)
                    self.is_exhausted = data.get("isExhausted", self.is_exhausted)
                    self.used = data.get("tokensUsed", self.used)
                    self.extra_purchased = data.get("extraPurchased", self.extra_purchased)
                    logger.debug(f"[QUOTA] Server sync (token): remaining={self.remaining}")
                return
            except Exception as e:
                if attempt < len(backoff_delays):
                    logger.debug(f"[QUOTA] Token consume attempt {attempt + 1} failed: {e}, retrying...")
                    await asyncio.sleep(backoff_delays[attempt])
                else:
                    logger.debug(f"[QUOTA] All token consume retries failed: {e}")

    async def _fire_and_update_time(self, seconds: int) -> None:
        """POST time consumption to server with retry. Routes to AI card endpoint if applicable."""
        # Choose endpoint based on session type
        if self.rfid_uid:
            endpoint = f"/subscription/consume/ai-card-time/{self.rfid_uid}"
        else:
            endpoint = f"/quota/consume/time/{self.mac_address}"

        backoff_delays = [0.5, 1.0]
        for attempt in range(3):
            try:
                data = await self._api_post(
                    endpoint,
                    body={
                        "seconds": seconds,
                        "monthKey": self._month_key,
                    }
                )
                if data:
                    was_exhausted = self.is_exhausted
                    self.remaining = data.get("remaining", self.remaining)
                    self.is_exhausted = data.get("isExhausted", self.is_exhausted)
                    self.used = data.get("secondsUsed", self.used)
                    self.extra_purchased = data.get("extraPurchased", self.extra_purchased)
                    logger.debug(f"[QUOTA] Server sync (time): remaining={self.remaining}s")

                    # If just became exhausted, trigger MQTT exhaust message to device
                    if self.is_exhausted and not was_exhausted and self.rfid_uid:
                        logger.warning(
                            f"[QUOTA] AI card time just exhausted mid-session: "
                            f"rfid={self.rfid_uid}, mac={self.mac_address}"
                        )
                        # Fire-and-forget: trigger MQTT exhaust without blocking
                        asyncio.create_task(self._publish_mqtt_exhaust())
                        # Signal worker to disconnect via callback
                        if self._on_quota_exhausted_callback:
                            asyncio.create_task(self._on_quota_exhausted_callback())

                    # If already exhausted, log
                    if self.is_exhausted:
                        logger.warning(
                            f"[QUOTA] Time exhausted: rfid={self.rfid_uid or 'N/A'}, "
                            f"mac={self.mac_address}"
                        )
                return
            except Exception as e:
                if attempt < len(backoff_delays):
                    logger.debug(f"[QUOTA] Time consume attempt {attempt + 1} failed: {e}, retrying...")
                    await asyncio.sleep(backoff_delays[attempt])
                else:
                    logger.debug(f"[QUOTA] All time consume retries failed: {e}")

    async def _publish_mqtt_exhaust(self) -> None:
        """Trigger MQTT exhaust message to device when quota runs out mid-session."""
        try:
            await self._api_post(
                "/subscription/publish-mqtt-exhaust",
                body={
                    "macAddress": self.mac_address.replace(":", "").lower(),
                    "rfidUid": self.rfid_uid,
                    "cardName": self.plan_name or "AI Card",
                }
            )
            logger.info(f"[QUOTA] MQTT exhaust message triggered for {self.mac_address}")
        except Exception as e:
            logger.warning(f"[QUOTA] Failed to trigger MQTT exhaust: {e}")

    async def _resync(self) -> None:
        """Re-fetch quota from server to correct drift. Detects month rollover."""
        self._local_increments = 0

        # Check for month rollover
        current_month = self._get_current_month_key()
        if current_month != self._month_key:
            logger.info(f"[QUOTA] Month rollover detected: {self._month_key} -> {current_month}")
            self._month_key = current_month
            await self.initialize()
            return

        try:
            data = await self._api_get(f"/subscription/quota/{self.mac_address}")
            if not data:
                # Fallback to legacy
                data = await self._api_get(f"/quota/check/{self.mac_address}")
            if data and not data.get("isUnbound", False):
                self.remaining = data.get("remaining", self.remaining)
                self.is_exhausted = data.get("isExhausted", self.is_exhausted)
                self.used = data.get("used", data.get("questionsUsed", self.used))
                self.extra_purchased = data.get("extraPurchased", self.extra_purchased)
                logger.info(f"[QUOTA] Re-synced ({self.quota_type}): remaining={self.remaining}")
        except Exception as e:
            logger.debug(f"[QUOTA] Re-sync failed (ok, using local): {e}")

    async def _api_get(self, path: str) -> Optional[dict]:
        """GET request to manager API."""
        url = f"{self.api_url}{path}"
        headers = {"X-Service-Key": self.secret}
        try:
            async with aiohttp.ClientSession() as session:
                async with session.get(url, headers=headers, timeout=aiohttp.ClientTimeout(total=5)) as resp:
                    if resp.status == 200:
                        result = await resp.json()
                        return result.get("data")
                    else:
                        logger.warning(f"[QUOTA] GET {path} returned {resp.status}")
                        return None
        except asyncio.TimeoutError:
            logger.warning(f"[QUOTA] GET {path} timed out")
            return None

    async def _api_post(self, path: str, body: dict = None) -> Optional[dict]:
        """POST request to manager API."""
        url = f"{self.api_url}{path}"
        headers = {"X-Service-Key": self.secret, "Content-Type": "application/json"}
        try:
            async with aiohttp.ClientSession() as session:
                async with session.post(url, headers=headers, json=body or {}, timeout=aiohttp.ClientTimeout(total=5)) as resp:
                    if resp.status == 200:
                        result = await resp.json()
                        return result.get("data")
                    else:
                        logger.warning(f"[QUOTA] POST {path} returned {resp.status}")
                        return None
        except asyncio.TimeoutError:
            logger.warning(f"[QUOTA] POST {path} timed out")
            return None
