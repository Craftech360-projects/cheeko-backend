"""The manager API as picoclaw's worker uses it: service-key auth, {code,data} envelope, best effort."""
from __future__ import annotations

import logging
import time
from datetime import datetime, timezone
from typing import Any, Awaitable, Callable
from urllib.parse import quote

import aiohttp

logger = logging.getLogger("cheeko-gptlive.manager")

Fetch = Callable[[str, str, "dict | None"], Awaitable[tuple[int, dict]]]
TIMEOUT = aiohttp.ClientTimeout(total=3)


class ManagerClient:
    def __init__(self, base_url: str, secret: str, fetch: Fetch | None = None) -> None:
        self.base_url = (base_url or "").rstrip("/")
        self.secret = secret or ""
        self._fetch = fetch or self._http_fetch
        self._http: aiohttp.ClientSession | None = None

    @property
    def enabled(self) -> bool:
        return bool(self.base_url)

    async def _http_fetch(self, method: str, url: str, body: dict | None) -> tuple[int, dict]:
        if self._http is None or self._http.closed:
            self._http = aiohttp.ClientSession(timeout=TIMEOUT)
        headers = {"X-Service-Key": self.secret, "Authorization": f"Bearer {self.secret}", "Content-Type": "application/json"}
        async with self._http.request(method, url, json=body, headers=headers) as resp:
            try:
                data = await resp.json(content_type=None)
            except Exception:
                data = {}
            return resp.status, data if isinstance(data, dict) else {}

    async def aclose(self) -> None:
        if self._http is not None and not self._http.closed:
            await self._http.close()

    async def _call(self, method: str, path: str, body: dict | None = None, *, what: str) -> Any | None:
        """Returns the envelope's data (or True for a bare success), None on any failure."""
        if not self.enabled:
            return None
        try:
            status, payload = await self._fetch(method, self.base_url + path, body)
        except Exception as e:  # network, timeout, bad JSON: degrade, never block the session
            logger.warning("manager %s failed: %s", what, e)
            return None
        if status >= 300 or payload.get("code", 0) not in (0, 200):
            logger.warning("manager %s rejected: status=%s code=%s msg=%s", what, status, payload.get("code"), payload.get("msg"))
            return None
        return payload.get("data", True)

    # persona
    async def character_session(self, name: str, character_id: str) -> dict | None:
        if name:
            data = await self._call("GET", f"/agent/character/by-name/{quote(name, safe='')}/session", what="character by name")
            if isinstance(data, dict):
                return data
        if character_id:
            data = await self._call("GET", f"/agent/character/{quote(character_id, safe='')}/session", what="character by id")
            if isinstance(data, dict):
                return data
        return None

    # memory: the device workspace picoclaw keeps in sync (USER.md, memory/MEMORY.md with session summaries)
    async def workspace_files(self, device_mac: str) -> dict[str, str]:
        data = await self._call("GET", f"/agent/device/{device_mac}/workspace-files", what="workspace files")
        if not isinstance(data, dict):
            return {}
        return {path: str(f.get("content") or "") for path, f in data.items() if isinstance(f, dict)}

    async def save_memory(self, device_mac: str, content: str) -> None:
        """workspace-sync, not workspace-files: it bumps the manifest revision, so picoclaw re-downloads this
        MEMORY.md instead of uploading its stale copy over it. No baseRevision: our write wins a race."""
        # ponytail: no workspace lock; a picoclaw session ending in the same second on this device can overwrite it
        body = {"newRevision": str(int(time.time() * 1000)), "deleted": [],
                "files": [{"relativePath": "memory/MEMORY.md", "content": content, "contentType": "text/markdown"}],
                "manifest": {"source": "cheeko-gptlive", "changedCount": 1, "deletedCount": 0}}
        await self._call("PUT", f"/agent/device/{device_mac}/workspace-sync", body, what="memory sync")

    async def send_session_summary(self, device_mac: str, session_id: str, summary: str, source_message_count: int) -> None:
        body = {"summary": summary, "sourceMessageCount": source_message_count}
        await self._call("PUT", f"/agent/device/{device_mac}/sessions/{quote(session_id, safe='')}/summary", body, what="session summary")

    # quiz
    async def quiz_batch(self, device_mac: str, character: str) -> dict | None:
        path = f"/quiz/next-questions?device_mac={quote(device_mac, safe='')}&character={quote(character, safe='')}"
        data = await self._call("GET", path, what="quiz batch")
        return data if isinstance(data, dict) else None

    async def progress_state(self, device_mac: str) -> list[dict]:
        data = await self._call("GET", f"/progress/state?device_mac={quote(device_mac, safe='')}", what="progress state")
        states = data.get("states") if isinstance(data, dict) else None
        return [s for s in (states or []) if isinstance(s, dict)]

    async def post_quiz_answer(self, device_mac: str, question_id: str, result: str, bank: str, attempts: list[dict]) -> None:
        body: dict[str, Any] = {"device_mac": device_mac, "question_id": str(question_id), "result": result}
        if bank:
            body["bank"] = bank
        if attempts:
            body["attempts"] = attempts
        await self._call("POST", "/quiz/answer", body, what="quiz answer")

    async def post_quiz_attempts(self, device_mac: str, question_id: str, attempts: list[dict]) -> None:
        await self._call("POST", "/quiz/attempts", {"device_mac": device_mac, "question_id": str(question_id), "attempts": attempts}, what="quiz attempts")

    async def post_wonder(self, device_mac: str, question: str, answer: str, code: str) -> None:
        await self._call("POST", "/quiz/wonder", {"device_mac": device_mac, "question": question.strip(), "answer": answer.strip(), "code": code.strip()}, what="wonder question")

    # persistence
    async def send_chat_history(self, device_mac: str, session_id: str, messages: list[dict]) -> None:
        await self._call("POST", "/agent/chat-history/session", {"macAddress": device_mac, "sessionId": session_id, "messages": messages}, what="chat history")

    async def send_session_end(self, device_mac: str, session_id: str, message_count: int) -> None:
        body = {"status": "ended", "endedAt": datetime.now(timezone.utc).isoformat(), "messageCount": message_count}
        await self._call("POST", f"/agent/device/{device_mac}/sessions/{quote(session_id, safe='')}/end", body, what="session end")

    async def send_token_usage(self, device_mac: str, session_id: str, usage: dict) -> None:
        await self._call("POST", "/device/token-usage", {"mac": device_mac, "sessionId": session_id, **usage}, what="token usage")
