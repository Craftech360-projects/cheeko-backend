"""
Verbal hint manager for Yes/No Quiz game.
Two asyncio timers: hint clue at 10s, timeout at 20s.
On hint: calls LLM to generate a verbal clue (1 sentence, doesn't give away the answer).
On timeout: calls the on_timeout callback.
"""

import asyncio
import time
import logging
import os
import json
import aiohttp
from typing import Callable, Optional

logger = logging.getLogger("yesno_quiz_hints")

HINT_DELAY = 10   # seconds before giving a clue
TIMEOUT_DELAY = 20  # seconds before timing out

HINT_PROMPT = """You are a helpful game host for a yes/no trivia game for kids.
A child has been asked this question: "{question}"
They have not answered yet. Give them ONE short verbal clue (1 sentence, max 20 words) that helps them think about the answer WITHOUT directly saying yes or no.
The clue should make them think, not give away the answer.
Return ONLY the clue sentence, no quotes, no extra text."""


class YesNoHintManager:
    """
    Manages two timers per question:
    - Hint timer (10s): generates an LLM verbal clue and speaks it
    - Timeout timer (20s): calls on_timeout callback
    """

    def __init__(self, on_hint_speak: Callable, on_timeout: Callable):
        """
        Args:
            on_hint_speak: Async callable — on_hint_speak(clue: str). Called with the LLM-generated clue text.
            on_timeout: Async callable — on_timeout(). Called when time runs out.
        """
        self._on_hint_speak = on_hint_speak
        self._on_timeout = on_timeout
        self._hint_task: Optional[asyncio.Task] = None
        self._timeout_task: Optional[asyncio.Task] = None
        self._current_qid: Optional[str] = None
        self._current_question: Optional[str] = None

        # LLM client config
        self._api_key = os.getenv("OPENROUTER_API_KEY", "")
        self._model = os.getenv("YESNO_LLM_MODEL", "openai/gpt-4o-mini")
        self._base_url = "https://openrouter.ai/api/v1/chat/completions"

    def start_timers(self, question_id: str, question_text: str):
        """
        Start hint and timeout timers for the current question.
        Cancels any existing timers first.
        """
        self.cancel_timers()
        self._current_qid = question_id
        self._current_question = question_text

        self._hint_task = asyncio.create_task(
            self._hint_timer_task(question_id, question_text)
        )
        self._timeout_task = asyncio.create_task(
            self._timeout_timer_task(question_id)
        )

        logger.info(
            f"hints.timers_started(qid={question_id}, "
            f"hint_at={HINT_DELAY}s, timeout_at={TIMEOUT_DELAY}s)"
        )

    def cancel_timers(self):
        """Cancel all active timers. Safe to call when no timers are active."""
        cancelled = 0
        if self._hint_task and not self._hint_task.done():
            self._hint_task.cancel()
            cancelled += 1
        if self._timeout_task and not self._timeout_task.done():
            self._timeout_task.cancel()
            cancelled += 1
        if cancelled > 0 or self._current_qid:
            logger.info(f"hints.timers_cancelled(qid={self._current_qid}, cancelled={cancelled})")
        self._hint_task = None
        self._timeout_task = None

    async def _hint_timer_task(self, question_id: str, question_text: str):
        """Wait HINT_DELAY seconds, then generate and speak a verbal clue."""
        start = time.monotonic()
        try:
            await asyncio.sleep(HINT_DELAY)
        except asyncio.CancelledError:
            return

        elapsed = time.monotonic() - start

        # Guard: question may have changed
        if self._current_qid != question_id:
            logger.warning(f"hints.hint_stale(qid={question_id}, expected={self._current_qid})")
            return

        logger.info(f"hints.hint_fired(qid={question_id}, elapsed={elapsed:.1f}s)")

        try:
            clue = await self._generate_clue(question_text)
            await self._on_hint_speak(clue)
        except Exception as e:
            logger.error(f"hints.hint_error(qid={question_id}, error={e})")

    async def _timeout_timer_task(self, question_id: str):
        """Wait TIMEOUT_DELAY seconds, then call on_timeout."""
        start = time.monotonic()
        try:
            await asyncio.sleep(TIMEOUT_DELAY)
        except asyncio.CancelledError:
            return

        elapsed = time.monotonic() - start

        # Guard: question may have changed
        if self._current_qid != question_id:
            logger.warning(f"hints.timeout_stale(qid={question_id}, expected={self._current_qid})")
            return

        logger.info(f"hints.timeout_fired(qid={question_id}, elapsed={elapsed:.1f}s)")

        try:
            await self._on_timeout()
        except Exception as e:
            logger.error(f"hints.timeout_error(qid={question_id}, error={e})")

    async def _generate_clue(self, question_text: str) -> str:
        """Call LLM to generate a verbal clue. Returns fallback string on failure."""
        try:
            prompt = HINT_PROMPT.format(question=question_text)
            payload = {
                "model": self._model,
                "temperature": 0.8,
                "max_tokens": 60,
                "messages": [
                    {"role": "system", "content": prompt},
                    {"role": "user", "content": "Give me a clue."},
                ],
            }
            headers = {
                "Authorization": f"Bearer {self._api_key}",
                "Content-Type": "application/json",
            }

            async with aiohttp.ClientSession() as http:
                async with http.post(self._base_url, json=payload, headers=headers) as resp:
                    if resp.status != 200:
                        body = await resp.text()
                        logger.error(f"hints.clue_api_error(status={resp.status}, body={body[:200]})")
                        return "Here's a clue — think about what you know about this topic!"

                    data = await resp.json()
                    clue = data["choices"][0]["message"]["content"].strip()
                    logger.info(f"hints.clue_generated(clue={clue[:80]})")
                    return clue

        except Exception as e:
            logger.error(f"hints.clue_generate_error(error={e})")
            return "Here's a clue — think carefully about what you know!"
