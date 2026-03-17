"""
HTTP client for game progression API (manager-api-node).
Used by all game engines to load/save progress.
"""

import os
import logging
import aiohttp

logger = logging.getLogger("progress_client")

DEFAULT_BASE_URL = os.getenv("MANAGER_API_URL", "http://localhost:8002/toy")
DEFAULT_SERVICE_KEY = os.getenv("MANAGER_API_SECRET", os.getenv("SERVICE_SECRET_KEY", ""))


class ProgressClient:
    """Async HTTP client for game progression endpoints."""

    def __init__(self, base_url: str = None, service_key: str = None):
        self.base_url = (base_url or DEFAULT_BASE_URL).rstrip("/")
        self.service_key = service_key or DEFAULT_SERVICE_KEY
        self._headers = {
            "Content-Type": "application/json",
            "X-Service-Key": self.service_key,
        }

    async def get_progress(self, child_id: str, game_type: str) -> dict:
        """Load progress for a child + game type. Creates default if none exists."""
        url = f"{self.base_url}/game/progress/{child_id}/{game_type}"
        return await self._get(url, "get_progress")

    async def end_session(self, session_data: dict) -> dict:
        """
        Save session results. Returns updated progress, streak, achievements, missions.

        session_data keys:
          childId, gameType, ageBand, level, starsEarned, questionsAsked,
          correctAnswers, bestStreak, hintsUsed, avgResponseMs, durationSecs,
          completed, answers
        """
        url = f"{self.base_url}/game/session/end"
        return await self._post(url, session_data, "end_session")

    async def get_streak(self, child_id: str) -> dict:
        url = f"{self.base_url}/game/streak/{child_id}"
        return await self._get(url, "get_streak")

    async def get_unannounced_achievements(self, child_id: str) -> list:
        url = f"{self.base_url}/game/achievements/{child_id}/unannounced"
        result = await self._get(url, "get_unannounced")
        return result if isinstance(result, list) else []

    async def mark_achievements_announced(self, child_id: str, codes: list) -> None:
        url = f"{self.base_url}/game/achievements/{child_id}/announce"
        await self._post(url, {"codes": codes}, "mark_announced")

    async def get_daily_missions(self, child_id: str, age_band: str = "explorer") -> dict:
        url = f"{self.base_url}/game/missions/{child_id}?ageBand={age_band}"
        return await self._get(url, "get_missions")

    # ── Internal HTTP methods ───────────────────────────

    async def _get(self, url: str, tag: str) -> dict | list:
        try:
            async with aiohttp.ClientSession() as session:
                async with session.get(url, headers=self._headers, timeout=aiohttp.ClientTimeout(total=10)) as resp:
                    if resp.status != 200:
                        body = await resp.text()
                        logger.error(f"progress.{tag}_failed(status={resp.status}, body={body[:200]})")
                        return {}
                    data = await resp.json()
                    return data.get("data", {})
        except Exception as e:
            logger.error(f"progress.{tag}_error(error={e})")
            return {}

    async def _post(self, url: str, payload: dict, tag: str) -> dict:
        try:
            async with aiohttp.ClientSession() as session:
                async with session.post(url, json=payload, headers=self._headers, timeout=aiohttp.ClientTimeout(total=15)) as resp:
                    if resp.status != 200:
                        body = await resp.text()
                        logger.error(f"progress.{tag}_failed(status={resp.status}, body={body[:200]})")
                        return {}
                    data = await resp.json()
                    return data.get("data", {})
        except Exception as e:
            logger.error(f"progress.{tag}_error(error={e})")
            return {}
