"""
QuotaManager - Client-side cached quota manager for agent workers.

Fetches quota once at session start, tracks locally with fire-and-forget
server increments. Re-syncs every N turns for multi-device accuracy.
Fail-open: if API is unreachable, allow the session.
"""

import asyncio
import aiohttp
import logging
from typing import Tuple, Optional

logger = logging.getLogger("quota_manager")

# Re-sync from server every N turns to handle multi-device edge case
RESYNC_INTERVAL = 5

# Child-friendly limit messages
LIMIT_MESSAGE = (
    "Oh no! Your free questions are all used up this month! "
    "Ask your parents to get more so we can keep chatting! Bye bye for now!"
)

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

        self._total_turns += 1
        self._local_increments += 1

        # Decrement local counter
        self.remaining = max(0, self.remaining - 1)
        self.questions_used += 1
        self.is_exhausted = self.remaining <= 0

        # Fire-and-forget server increment
        asyncio.create_task(self._fire_and_forget_increment())

        # Re-sync from server periodically
        if self._local_increments >= RESYNC_INTERVAL:
            asyncio.create_task(self._resync())

        return not self.is_exhausted, self.remaining

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

    def _fail_open(self) -> None:
        """Set fail-open state - allow everything."""
        self.remaining = -1
        self.is_exhausted = False
        self.is_unbound = True
        self._initialized = True

    async def _fire_and_forget_increment(self) -> None:
        """POST increment to server, ignore failures."""
        try:
            await self._api_post(f"/quota/increment/{self.mac_address}")
        except Exception as e:
            logger.debug(f"[QUOTA] Fire-and-forget increment failed (ok): {e}")

    async def _resync(self) -> None:
        """Re-fetch quota from server to correct drift."""
        self._local_increments = 0
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
