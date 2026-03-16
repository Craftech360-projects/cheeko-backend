"""
Hint manager for Odd One Out game.
Two timers: clue hint + timeout. LLM generates contextual clues.
"""

import asyncio
import time
import logging
import os
import json
import aiohttp
from typing import Callable, Optional

logger = logging.getLogger("oddoneout_hints")

EXPLORER_HINT_DELAY = 15
EXPLORER_TIMEOUT_DELAY = 30
COMMANDER_HINT_DELAY = 10
COMMANDER_TIMEOUT_DELAY = 20

HINT_PROMPT = """You are a game host for a kids "Odd One Out" game.
The child was shown these items: {items}
One of them doesn't belong. The odd one out is: {odd_one_out} (because: {category_label})
The child hasn't answered yet. Give ONE short verbal clue (max 15 words) that helps them THINK about what the others have in common, WITHOUT saying the answer.
Return ONLY the clue, no quotes."""


class OddOneOutHintManager:
    """Two timers per question: hint clue + timeout."""

    def __init__(self, on_hint_speak: Callable, on_timeout: Callable, game_mode: str = "explorer"):
        self._on_hint_speak = on_hint_speak
        self._on_timeout = on_timeout
        self._game_mode = game_mode
        self._hint_task: Optional[asyncio.Task] = None
        self._current_qid: Optional[str] = None

        self._api_key = os.getenv("OPENROUTER_API_KEY", "")
        self._model = os.getenv("ODDONEOUT_LLM_MODEL", os.getenv("YESNO_LLM_MODEL", "openai/gpt-4o-mini"))
        self._base_url = "https://openrouter.ai/api/v1/chat/completions"

    @property
    def _hint_delay(self):
        return COMMANDER_HINT_DELAY if self._game_mode == "commander" else EXPLORER_HINT_DELAY

    @property
    def _timeout_delay(self):
        return COMMANDER_TIMEOUT_DELAY if self._game_mode == "commander" else EXPLORER_TIMEOUT_DELAY

    def start_timers(self, question_id: str, question_data: dict):
        """
        Start sequential timers: hint first, then timeout AFTER hint speech finishes.
        Flow: [hint_delay] → speak clue → [timeout_delay] → timeout
        """
        self.cancel_timers()
        self._current_qid = question_id
        self._hint_task = asyncio.create_task(
            self._sequential_timer(question_id, question_data)
        )
        logger.info(f"hints.started(qid={question_id}, hint={self._hint_delay}s, timeout={self._timeout_delay}s)")

    def cancel_timers(self):
        if self._hint_task and not self._hint_task.done():
            self._hint_task.cancel()
            logger.info(f"hints.cancelled(qid={self._current_qid})")
        self._hint_task = None

    async def _sequential_timer(self, question_id: str, question_data: dict):
        """
        Sequential flow:
        1. Wait hint_delay seconds
        2. Generate and speak hint clue (awaits TTS completion via engine)
        3. Wait timeout_delay seconds MORE
        4. Fire timeout

        Child gets full time after each speech event.
        """
        # Phase 1: Wait for hint
        try:
            await asyncio.sleep(self._hint_delay)
        except asyncio.CancelledError:
            return
        if self._current_qid != question_id:
            return

        # Phase 2: Speak hint (engine narrates, which awaits TTS)
        logger.info(f"hints.hint_fired(qid={question_id})")
        try:
            clue = await self._generate_clue(question_data)
            await self._on_hint_speak(clue)  # This awaits narrator TTS
        except Exception as e:
            logger.error(f"hints.hint_error(qid={question_id}, error={e})")

        # Guard: child may have answered during hint speech
        if self._current_qid != question_id:
            return

        # Phase 3: Wait for timeout AFTER hint speech finished
        logger.info(f"hints.timeout_timer_start(qid={question_id}, delay={self._timeout_delay}s)")
        try:
            await asyncio.sleep(self._timeout_delay)
        except asyncio.CancelledError:
            return
        if self._current_qid != question_id:
            return

        # Phase 4: Timeout
        logger.info(f"hints.timeout_fired(qid={question_id})")
        try:
            await self._on_timeout()
        except Exception as e:
            logger.error(f"hints.timeout_error(qid={question_id}, error={e})")

    async def _generate_clue(self, question_data: dict) -> str:
        """LLM generates a contextual clue. Falls back to generic hint."""
        try:
            items_str = ", ".join(question_data.get("items", []))
            prompt = HINT_PROMPT.format(
                items=items_str,
                odd_one_out=question_data.get("odd_one_out", ""),
                category_label=question_data.get("category_label", ""),
            )
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
                        return "Think about what the other items have in common!"
                    data = await resp.json()
                    clue = data["choices"][0]["message"]["content"].strip()
                    logger.info(f"hints.clue_generated(clue={clue[:60]})")
                    return clue
        except Exception as e:
            logger.error(f"hints.clue_error(error={e})")
            return "Think about what the other items have in common!"
