from __future__ import annotations

import asyncio

from src.services.external_text_response_service import ExternalTextResponseService
from src.services.model_capabilities import GeminiCapabilityProfile
from src.utils.loki_agent_logger import logger


class SessionActionRouter:
    """Route forced/system-driven speech through a Gemini-3.1-safe path when needed."""

    def __init__(
        self,
        *,
        session,
        capabilities: GeminiCapabilityProfile,
        text_service: ExternalTextResponseService,
    ) -> None:
        self._session = session
        self._capabilities = capabilities
        self._text_service = text_service
        self._lock = asyncio.Lock()

    @property
    def capabilities(self) -> GeminiCapabilityProfile:
        return self._capabilities

    async def _interrupt_current_speech(self) -> None:
        try:
            if self._session.current_speech is not None:
                await self._session.interrupt(force=True)
        except Exception as e:
            logger.debug(f"Could not interrupt current speech: {e}")

    async def speak_text(
        self,
        text: str,
        *,
        allow_interruptions: bool = True,
        add_to_chat_ctx: bool = True,
        interrupt_current: bool = False,
    ) -> None:
        if not text:
            return

        async with self._lock:
            if interrupt_current:
                await self._interrupt_current_speech()
            handle = self._session.say(
                text,
                allow_interruptions=allow_interruptions,
                add_to_chat_ctx=add_to_chat_ctx,
            )
            await handle

    async def generate_and_speak(
        self,
        *,
        user_text: str,
        extra_instruction: str | None = None,
        interrupt_current: bool = False,
        add_to_chat_ctx: bool = True,
    ) -> str:
        history = []
        try:
            history = self._session.history.messages()
        except Exception as e:
            logger.debug(f"Could not read session history for external generation: {e}")

        text = await self._text_service.generate_text(
            history_messages=history,
            user_text=user_text,
            extra_instruction=extra_instruction,
        )
        if text:
            await self.speak_text(
                text,
                interrupt_current=interrupt_current,
                add_to_chat_ctx=add_to_chat_ctx,
            )
        return text

    async def play_greeting(self, instruction: str) -> None:
        if self._capabilities.supports_mid_session_generate:
            handle = self._session.generate_reply(instructions=instruction)
            await handle
            return

        await self.generate_and_speak(
            user_text="The child is ready. Greet them now.",
            extra_instruction=instruction,
            add_to_chat_ctx=True,
        )

    async def speak_end_prompt(self, prompt_text: str) -> None:
        if self._capabilities.supports_mid_session_generate:
            handle = self._session.generate_reply(instructions=prompt_text)
            await handle
            return

        # The gateway already provides the goodbye copy; speak it directly.
        await self.speak_text(prompt_text, add_to_chat_ctx=True)

    async def handle_gateway_prompt_text(self, text: str) -> None:
        if self._capabilities.supports_mid_session_generate:
            handle = self._session.generate_reply(instructions=text)
            await handle
            return

        await self.generate_and_speak(
            user_text=text,
            interrupt_current=True,
            add_to_chat_ctx=True,
        )

    async def handle_memory_augmented_request(self, user_query: str, memory_context: str) -> None:
        if self._capabilities.supports_mid_session_generate:
            handle = self._session.generate_reply(
                instructions=f"{memory_context}\n\nRespond to the child's request: '{user_query}'"
            )
            await handle
            return

        await self.generate_and_speak(
            user_text=user_query,
            extra_instruction=memory_context,
            interrupt_current=True,
            add_to_chat_ctx=True,
        )

    async def speak_fallback_text(self, text: str) -> None:
        if self._capabilities.supports_mid_session_generate:
            handle = self._session.generate_reply(instructions=text)
            await handle
            return

        await self.speak_text(text, add_to_chat_ctx=False)
