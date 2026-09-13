"""Transcript capture and the shutdown uploads picoclaw performs in post_session_persistence.go."""
from __future__ import annotations

import logging
import time

logger = logging.getLogger("cheeko-gptlive.persist")
CHAT_USER, CHAT_AGENT = 1, 2


class SessionRecorder:
    def __init__(self, session, manager, plan) -> None:
        self.manager, self.plan = manager, plan
        self.room_name = getattr(plan, "room_name", "") or ""
        self.messages: list[dict] = []
        self._register(session)

    def _register(self, session) -> None:
        @session.on("conversation_item_added")
        def _on_item(ev) -> None:
            item = ev.item
            role, text = getattr(item, "role", None), (getattr(item, "text_content", "") or "").strip()
            logger.info("TRANSCRIPT %s: %s", role or type(item).__name__, text)
            if role == "user" and text:
                self.record_user(text)
            elif role == "assistant" and text:
                self.record_agent(text)

        @session.on("agent_state_changed")
        def _on_state(ev) -> None:
            logger.info("STATE %s -> %s", ev.old_state, ev.new_state)

        @session.on("function_tools_executed")
        def _on_tools(ev) -> None:
            logger.info("TOOLS %s", [(c.name, c.arguments) for c in ev.function_calls])

        @session.on("error")
        def _on_error(ev) -> None:
            logger.error("SESSION ERROR %s", ev.error)

    def _add(self, chat_type: int, text: str) -> None:
        # epoch seconds: the manager multiplies a numeric timestamp by 1000
        self.messages.append({"chatType": chat_type, "content": text, "timestamp": round(time.time(), 3)})

    def record_user(self, text: str) -> None:
        self._add(CHAT_USER, text)

    def record_agent(self, text: str) -> None:
        self._add(CHAT_AGENT, text)

    def snapshot(self) -> list[dict]:
        return list(self.messages)

    def usage_payload(self, usage) -> dict:
        seconds, in_tok, out_tok, total = 0.0, 0, 0, 0
        for u in getattr(usage, "model_usage", []) or []:
            if str(getattr(u, "model", "")).startswith("gpt-live"):
                seconds += float(getattr(u, "session_duration", 0) or 0)
            else:
                in_tok += int(getattr(u, "input_tokens", 0) or 0)
                out_tok += int(getattr(u, "output_tokens", 0) or 0)
                total += int(getattr(u, "total_tokens", 0) or 0)
        return {"inputTokens": in_tok, "outputTokens": out_tok, "totalTokens": total,
                "sessionDurationSeconds": round(seconds, 3), "messageCount": len(self.messages)}

    async def flush(self, usage) -> None:
        mac = getattr(self.plan.meta, "device_mac", None)
        if not mac or not getattr(self.manager, "enabled", False):
            logger.info("persistence skipped (mac=%s manager=%s)", mac, getattr(self.manager, "enabled", False))
            return
        sid = self.room_name
        if self.messages:  # the manager rejects an empty messages array
            await self.manager.send_chat_history(mac, sid, self.snapshot())
        await self.manager.send_session_end(mac, sid, len(self.messages))
        await self.manager.send_token_usage(mac, sid, self.usage_payload(usage))
