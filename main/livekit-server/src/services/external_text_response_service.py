from __future__ import annotations

import os
from typing import Iterable

from livekit.agents import llm
from livekit.plugins import google

from src.utils.loki_agent_logger import logger


class ExternalTextResponseService:
    """Generate text responses outside the realtime session for models like Gemini 3.1."""

    def __init__(
        self,
        *,
        system_prompt: str,
        model: str | None = None,
        temperature: float = 0.7,
        recent_history_limit: int = 8,
    ) -> None:
        self._system_prompt = system_prompt
        self._recent_history_limit = recent_history_limit
        self._llm = google.LLM(
            model=model or os.getenv("GEMINI_FORCED_TEXT_MODEL", "gemini-2.5-flash"),
            temperature=temperature,
        )

    @staticmethod
    def _to_text(value) -> str:
        if value is None:
            return ""
        if isinstance(value, str):
            return value
        return str(value)

    def _build_context(
        self,
        *,
        history_messages: Iterable,
        user_text: str,
        extra_instruction: str | None = None,
    ) -> llm.ChatContext:
        ctx = llm.ChatContext.empty()
        ctx.add_message(role="system", content=self._system_prompt)

        history = list(history_messages or [])
        if self._recent_history_limit > 0:
            history = history[-self._recent_history_limit :]

        for msg in history:
            role = getattr(msg, "role", None)
            text = self._to_text(getattr(msg, "text_content", ""))
            if role in {"user", "assistant", "system"} and text:
                ctx.add_message(role=role, content=text)

        if extra_instruction:
            ctx.add_message(role="system", content=extra_instruction)

        ctx.add_message(role="user", content=user_text)
        return ctx

    async def generate_text(
        self,
        *,
        history_messages: Iterable,
        user_text: str,
        extra_instruction: str | None = None,
    ) -> str:
        chat_ctx = self._build_context(
            history_messages=history_messages,
            user_text=user_text,
            extra_instruction=extra_instruction,
        )
        response = await self._llm.chat(chat_ctx=chat_ctx, tool_choice="none").collect()
        text = (response.text or "").strip()
        if not text:
            logger.warning("External text response returned empty output")
        return text
