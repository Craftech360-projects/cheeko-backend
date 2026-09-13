"""Transcript capture and the shutdown uploads picoclaw performs in post_session_persistence.go."""
from __future__ import annotations

import logging
import os
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Awaitable, Callable

logger = logging.getLogger("cheeko-gptlive.persist")
CHAT_USER, CHAT_AGENT = 1, 2
MAX_MEMORY_BYTES = 64 * 1024  # picoclaw persistSummaryToMemoryFile
SUMMARY_HEADER = "# Memory\n\n## Session Summaries\n\n"
SUMMARY_PROMPT = "Provide a concise summary of this conversation segment, preserving core context and key points.\n"

Summarize = Callable[[list[dict]], Awaitable[str]]


def openai_summarizer(model: str) -> Summarize:
    """picoclaw bridgeSummarizeBatch, on the backend Responses model."""
    async def summarize(messages: list[dict]) -> str:
        from openai import AsyncOpenAI

        prompt = SUMMARY_PROMPT + "\nCONVERSATION:\n" + "".join(f"{m['role']}: {m['content']}\n" for m in messages)
        client = AsyncOpenAI(timeout=20, max_retries=0)  # inside the worker's 60 s shutdown window
        try:
            resp = await client.responses.create(model=model, input=prompt)
            return (resp.output_text or "").strip()
        finally:
            await client.close()

    return summarize


def append_summary(memory: str, summary: str, character: str, message_count: int, now: datetime) -> str:
    """Append one bullet under ## Session Summaries, exactly as picoclaw writes it, capped at 64 KB."""
    existing = memory.strip()
    if not existing:
        out = SUMMARY_HEADER
    else:
        out = memory.rstrip("\n") + "\n"
        if "## session summaries" not in existing.lower():
            out += "\n## Session Summaries\n\n"
    stamp = now.astimezone(timezone.utc).strftime("%Y-%m-%d %H:%M:%S UTC")
    if character.strip():
        stamp += f" [{character.strip()}]"
    entry = " ".join(summary.split())
    out += f"- {stamp} ({message_count} messages): {entry}\n" if message_count > 0 else f"- {stamp}: {entry}\n"
    data = out.encode("utf-8")
    if len(data) > MAX_MEMORY_BYTES:
        tail = data[-MAX_MEMORY_BYTES:].decode("utf-8", errors="ignore")
        tail = tail[tail.find("\n") + 1:] if "\n" in tail else tail  # drop the partial first line
        out = SUMMARY_HEADER + tail.lstrip("\n")
    return out


def add_facts(memory: str, facts: list[str]) -> str:
    """remember_child_fact results go under ## Stable Memory (created before the summaries if missing)."""
    known = memory.lower()
    new = [f for f in dict.fromkeys(" ".join(f.split()) for f in facts) if f and f"- {f.lower()}" not in known]
    if not new:
        return memory
    lines = [f"- {f}" for f in new]
    rows = memory.split("\n")
    stable = next((i for i, r in enumerate(rows) if r.strip().lower() == "## stable memory"), None)
    if stable is None:
        at = next((i for i, r in enumerate(rows) if r.strip().lower() == "## session summaries"), len(rows))
        rows[at:at] = ["## Stable Memory", *lines, ""]
        return "\n".join(rows)
    end = next((i for i in range(stable + 1, len(rows)) if rows[i].startswith("#")), len(rows))
    while end > stable + 1 and not rows[end - 1].strip():
        end -= 1
    rows[end:end] = lines
    return "\n".join(rows)


class SessionRecorder:
    def __init__(self, session, manager, plan, summarize: Summarize | None = None,
                 now: Callable[[], datetime] | None = None) -> None:
        self.manager, self.plan = manager, plan
        self.room_name = getattr(plan, "room_name", "") or ""
        self.messages: list[dict] = []
        self.summarize = summarize
        self.now = now or (lambda: datetime.now(timezone.utc))
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

    async def _summary(self) -> str:
        if not self.summarize or not self.messages:
            return ""
        turns = [{"role": "user" if m["chatType"] == CHAT_USER else "assistant", "content": m["content"]} for m in self.messages]
        try:
            return (await self.summarize(turns)).strip()
        except Exception as e:  # memory is best effort; the transcript still uploads
            logger.warning("session summary failed: %s", e)
            return ""

    async def _save_memory(self, mac: str, summary: str) -> None:
        workspace = Path(getattr(self.plan, "workspace", "") or ".")
        facts_path = workspace / "memory" / "new_facts.md"
        facts = facts_path.read_text(encoding="utf-8").splitlines() if facts_path.exists() else []
        if not summary and not any(f.strip() for f in facts):
            return
        local = workspace / "memory" / "MEMORY.md"
        # the manager's copy is newer than ours if another session ended since we started
        latest = (await self.manager.workspace_files(mac)).get("memory/MEMORY.md", "")
        memory = latest if latest.strip() else (local.read_text(encoding="utf-8") if local.exists() else "")
        memory = add_facts(memory, facts)
        if summary:
            memory = append_summary(memory, summary, getattr(self.plan.meta, "character", ""), len(self.messages), self.now())
        local.parent.mkdir(parents=True, exist_ok=True)
        local.write_text(memory, encoding="utf-8")
        await self.manager.save_memory(mac, memory)
        logger.info("memory saved: summary_chars=%d facts=%d", len(summary), len(facts))

    async def flush(self, usage) -> None:
        mac = getattr(self.plan.meta, "device_mac", None)
        if not mac or not getattr(self.manager, "enabled", False):
            logger.info("persistence skipped (mac=%s manager=%s)", mac, getattr(self.manager, "enabled", False))
            return
        sid = self.room_name
        summary = await self._summary()
        await self._save_memory(mac, summary)
        if summary:
            await self.manager.send_session_summary(mac, sid, summary, len(self.messages))
        if self.messages:  # the manager rejects an empty messages array
            await self.manager.send_chat_history(mac, sid, self.snapshot())
        await self.manager.send_session_end(mac, sid, len(self.messages))
        await self.manager.send_token_usage(mac, sid, self.usage_payload(usage))


def default_summarizer() -> Summarize:
    return openai_summarizer(os.getenv("GPTLIVE_SUMMARY_MODEL") or os.getenv("GPTLIVE_BACKEND_MODEL", "gpt-5.6-luna"))
