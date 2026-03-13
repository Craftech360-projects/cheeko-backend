"""
Per-mode hint system for Math Commander game.
Explorer: generous timers + attempt-based hints.
Commander: strict timers only, no attempt hints.
"""

import asyncio
import time
import logging
from typing import Callable, Optional

logger = logging.getLogger("math_game_hints")

# Per-mode hint configuration
EXPLORER_CONFIG = {
    "silence_timers": [20, 30, 45],   # seconds: repeat -> eliminate -> reveal
    "on_wrong_attempt": "repeat",      # after 1st wrong: repeat question
    "on_second_wrong": "eliminate",    # after 2nd wrong: eliminate option
}

COMMANDER_CONFIG = {
    "silence_timers": [12, 20, 30],   # seconds: repeat -> eliminate -> reveal
    "on_wrong_attempt": None,          # no hint on wrong - just lose a life
    "on_second_wrong": None,
}


class HintManager:
    """
    Manages hint timers and attempt-based hints for the math game.
    Calls on_hint(question_id, level) when a hint should fire.
    """

    def __init__(self, game_state, on_hint: Callable):
        """
        Args:
            game_state: MathGameState instance (for reading game_mode).
            on_hint: Async callback — on_hint(question_id: str, level: int).
        """
        self._game_state = game_state
        self._on_hint = on_hint
        self._timers: dict[int, asyncio.Task] = {}  # level -> Task
        self._current_qid: Optional[str] = None

    def _get_config(self) -> dict:
        """Get hint config for current game mode."""
        if self._game_state.game_mode == "commander":
            return COMMANDER_CONFIG
        return EXPLORER_CONFIG

    def start_timers(self, question_id: str):
        """
        Start all silence timers concurrently for current question.
        Cancels existing timers first.
        """
        self.cancel_timers()
        self._current_qid = question_id

        config = self._get_config()
        intervals = config["silence_timers"]

        for level, delay in enumerate(intervals):
            task = asyncio.create_task(self._timer_task(question_id, level, delay))
            self._timers[level] = task

        logger.info(
            f"hints.timers_started(qid={question_id}, mode={self._game_state.game_mode}, "
            f"intervals={intervals})"
        )

    def cancel_timers(self):
        """Cancel all active timers. Safe to call when no timers are active."""
        active_count = 0
        for level, task in self._timers.items():
            if not task.done():
                task.cancel()
                active_count += 1
        if active_count > 0 or self._current_qid:
            logger.info(f"hints.timers_cancelled(qid={self._current_qid}, active_count={active_count})")
        self._timers.clear()

    def on_wrong_attempt(self, attempt_number: int):
        """
        Handle attempt-based hints (Explorer only).
        Called by engine after a wrong answer with retry=True.

        NOTE: Does NOT restart silence timers here — the engine calls
        start_timers() separately after this returns. This avoids a
        double-escalation bug where both the attempt hint and the
        restarted silence timer would call escalate_hint().
        """
        config = self._get_config()

        if attempt_number == 1 and config["on_wrong_attempt"]:
            action = config["on_wrong_attempt"]
            logger.info(f"hints.attempt_hint(attempt={attempt_number}, action={action})")
            # Fire hint via callback — engine handles narration
            asyncio.create_task(self._on_hint(self._current_qid, 0))  # level 0 = repeat

        elif attempt_number == 2 and config["on_second_wrong"]:
            action = config["on_second_wrong"]
            logger.info(f"hints.attempt_hint(attempt={attempt_number}, action={action})")
            asyncio.create_task(self._on_hint(self._current_qid, 1))  # level 1 = eliminate

        else:
            logger.info(f"hints.attempt_hint_skipped(mode={self._game_state.game_mode})")

    async def _timer_task(self, question_id: str, level: int, delay: float):
        """Sleep for delay seconds, then fire hint if still valid."""
        start = time.monotonic()
        try:
            await asyncio.sleep(delay)
        except asyncio.CancelledError:
            return

        elapsed = time.monotonic() - start

        # Guard: question may have changed
        if self._current_qid != question_id:
            logger.warning(f"hints.timeout_stale(qid={question_id}, expected={self._current_qid})")
            return

        # Guard: answer may have been locked
        if self._game_state.answer_locked:
            logger.warning(f"hints.timeout_locked(qid={question_id})")
            return

        logger.info(f"hints.timeout_fired(qid={question_id}, level={level}, elapsed={elapsed:.1f}s)")

        try:
            await self._on_hint(question_id, level)
        except Exception as e:
            logger.error(f"hints.timer_error(qid={question_id}, level={level}, error={e})")
