"""
QuotaManager - Client-side cached quota manager for agent workers.

Fetches quota once at session start, tracks locally with fire-and-update
server increments. Re-syncs every N turns for multi-device accuracy.
Fail-open: if API is unreachable, allow the session.
"""

import asyncio
import aiohttp
import logging
from datetime import datetime, timezone
from typing import Tuple, Optional

logger = logging.getLogger("quota_manager")

# Re-sync from server every N turns to handle multi-device edge case
RESYNC_INTERVAL = 3

# Child-friendly limit messages
LIMIT_MESSAGE = (
    "Oh no! Your free questions are all used up this month! "
    "Ask your parents to get more so we can keep chatting! Bye bye for now!"
)

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

LOW_QUOTA_WARNING_THRESHOLD = 3
LOW_QUOTA_INSTRUCTION = (
    "Briefly mention that the child only has {remaining} questions left this month, "
    "then answer the child's question normally."
)


class QuotaManager:
    """
    Lightweight client-side quota cache for agent workers.

    - initialize() fetches quota once at session start (add to asyncio.gather for zero extra latency)
    - consume_question() decrements locally + fire-and-forget POST to server
    - Fail-open: if API unreachable, allow the session (don't punish children for API errors)
    """

    def __init__(self, mac_address: str, manager_api_url: str, secret: str):
        self.mac_address = mac_address.replace(":", "").replace("-", "").lower()
        self.api_url = manager_api_url.rstrip("/")
        self.secret = secret

        # Quota state
        self.remaining: int = -1  # -1 = unlimited (unbound device or not initialized)
        self.is_exhausted: bool = False
        self.is_unbound: bool = False
        self.free_limit: int = 20
        self.questions_used: int = 0
        self.extra_purchased: int = 0

        # Internal tracking
        self._initialized: bool = False
        self._local_increments: int = 0  # Turns since last server sync
        self._total_turns: int = 0
        self._month_key: str = self._get_current_month_key()

        # Game session protection
        self._in_game_session: bool = False
        self._game_session_id: Optional[str] = None
        self._game_agent_type: Optional[str] = None
        self._game_session_denied_reason: Optional[str] = None

    async def initialize(self) -> None:
        """
        Fetch quota from server. Call once at session start.
        Add to existing asyncio.gather() for zero extra latency.
        Fail-open on errors.
        """
        try:
            data = await self._api_get(f"/quota/check/{self.mac_address}")
            if data:
                self.remaining = data.get("remaining", -1)
                self.is_exhausted = data.get("isExhausted", False)
                self.is_unbound = data.get("isUnbound", False)
                self.free_limit = data.get("freeLimit", 20)
                self.questions_used = data.get("questionsUsed", 0)
                self.extra_purchased = data.get("extraPurchased", 0)
                self._initialized = True
                logger.info(
                    f"[QUOTA] Initialized for {self.mac_address}: "
                    f"remaining={self.remaining}, exhausted={self.is_exhausted}, "
                    f"unbound={self.is_unbound}"
                )
            else:
                # Fail-open: treat as unlimited
                logger.warning("[QUOTA] No data from server, fail-open (unlimited)")
                self._fail_open()
        except Exception as e:
            logger.warning(f"[QUOTA] Failed to initialize: {e}, fail-open (unlimited)")
            self._fail_open()

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
                asyncio.create_task(self._fire_and_update_increment())
                return True, 0
            return False, 0

        self._total_turns += 1
        self._local_increments += 1

        # Decrement local counter (remaining is guaranteed > 0 here)
        self.remaining -= 1
        self.questions_used += 1
        self.is_exhausted = self.remaining <= 0

        # Fire-and-update: POST to server, update local cache from response
        asyncio.create_task(self._fire_and_update_increment())

        # Re-sync from server periodically
        if self._local_increments >= RESYNC_INTERVAL:
            asyncio.create_task(self._resync())

        return True, self.remaining

    def should_warn_low_quota(self) -> bool:
        """Check if we should warn the child about low quota."""
        if self.is_unbound or self.remaining == -1:
            return False
        return self.remaining == LOW_QUOTA_WARNING_THRESHOLD

    def get_low_quota_instruction(self) -> str:
        """Get instruction for low quota warning."""
        return LOW_QUOTA_INSTRUCTION.format(remaining=self.remaining)

    def get_limit_message(self) -> str:
        """Get the child-friendly exhaustion message."""
        return LIMIT_MESSAGE

    def get_game_session_denied_message(self) -> str:
        """Get the child-friendly game session denial message based on the denial reason."""
        reason = self._game_session_denied_reason or "default"
        return GAME_SESSION_DENIED_MESSAGES.get(reason, GAME_SESSION_DENIED_MESSAGES["default"])

    @property
    def in_game_session(self) -> bool:
        """Whether a protected game session is currently active."""
        return self._in_game_session

    async def start_game_session(self, agent_type: str, session_id: str) -> Tuple[bool, str]:
        """
        Start a protected game session. Must be called before the quota gate.

        Returns:
            (allowed, reason): Whether the game session was allowed to start.
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
                    # Update remaining from response if available
                    if data.get("remaining") is not None:
                        self.remaining = data["remaining"]
                    logger.info(f"[QUOTA] Game session started: {agent_type}, remaining={self.remaining}")
                else:
                    self._game_session_denied_reason = reason
                    logger.warning(f"[QUOTA] Game session denied: {reason}")
                return allowed, reason
            else:
                # Fail-open: allow the game
                logger.warning("[QUOTA] No response from game session API, fail-open")
                self._in_game_session = True
                self._game_session_id = session_id
                self._game_agent_type = agent_type
                return True, "fail_open"
        except Exception as e:
            # Fail-open: don't punish children for API errors
            logger.warning(f"[QUOTA] Game session start failed: {e}, fail-open")
            self._in_game_session = True
            self._game_session_id = session_id
            self._game_agent_type = agent_type
            return True, "fail_open"

    async def end_game_session(self, status: str = "completed") -> None:
        """
        End a protected game session. Fire-and-forget style.

        Args:
            status: 'completed' or 'abandoned'
        """
        if not self._in_game_session:
            return

        self._in_game_session = False
        agent_type = self._game_agent_type
        session_id = self._game_session_id
        self._game_session_id = None
        self._game_agent_type = None

        # Skip API call for unbound devices
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

    async def _fire_and_update_increment(self) -> None:
        """POST increment to server, update local cache from authoritative response.
        Retry up to 2 times with backoff. Fail-open if all retries fail."""
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
                    self.extra_purchased = data.get("extraPurchased", self.extra_purchased)
                    logger.debug(f"[QUOTA] Server sync: remaining={self.remaining}")
                return
            except Exception as e:
                if attempt < len(backoff_delays):
                    logger.debug(f"[QUOTA] Increment attempt {attempt + 1} failed: {e}, retrying...")
                    await asyncio.sleep(backoff_delays[attempt])
                else:
                    logger.debug(f"[QUOTA] All increment retries failed: {e}, keeping local state")

    async def _resync(self) -> None:
        """Re-fetch quota from server to correct drift. Detects month rollover."""
        self._local_increments = 0

        # Check for month rollover
        current_month = self._get_current_month_key()
        if current_month != self._month_key:
            logger.info(f"[QUOTA] Month rollover detected: {self._month_key} -> {current_month}")
            self._month_key = current_month
            # Re-initialize with new month's quota
            await self.initialize()
            return

        try:
            data = await self._api_get(f"/quota/check/{self.mac_address}")
            if data and not data.get("isUnbound", False):
                self.remaining = data.get("remaining", self.remaining)
                self.is_exhausted = data.get("isExhausted", self.is_exhausted)
                self.questions_used = data.get("questionsUsed", self.questions_used)
                self.extra_purchased = data.get("extraPurchased", self.extra_purchased)
                logger.info(f"[QUOTA] Re-synced: remaining={self.remaining}")
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
