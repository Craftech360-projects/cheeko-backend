"""
Game flow engine for Math Commander.
Central hub that receives all events and coordinates modules.
"""

import random
import logging
from typing import Optional

logger = logging.getLogger("math_game_engine")


class MathGameEngine:
    """
    Central game flow controller. Receives events from:
    - DataChannel: tap answers, game control messages
    - Worker: voice answer results (via on_tools_executed)
    - HintManager: hint timeouts

    Coordinates:
    - MathGameState: answer validation, question registration
    - Narrator: LLM speech (reactions, questions, hints)
    - HintManager: timer lifecycle
    - DataChannel: frontend messaging
    """

    def __init__(self, game_state, narrator, hint_manager, data_channel, question_pool: list):
        self.state = game_state
        self.narrator = narrator
        self.hints = hint_manager
        self.dc = data_channel
        self.questions = list(question_pool)  # copy so we can shuffle
        self._question_index = 0

    # ==================== EVENT HANDLERS ====================

    async def on_game_start(self, child_name: str, age: int, game_mode: str):
        """Called when game should begin (after greeting or on start control)."""
        logger.info(f"engine.game_start(name={child_name}, age={age}, mode={game_mode})")

        self.state.game_mode = game_mode
        self.state.max_lives = 3 if game_mode == "commander" else None
        self.state.reset()

        await self.narrator.greet(child_name, game_mode)
        await self._present_next_question()

    async def on_tap_answer(self, message: dict):
        """
        Called by DataChannel when math_answer message received.
        Tap answers bypass LLM entirely — server validates directly.
        """
        question_id = message.get("question_id")
        value = message.get("value")
        input_method = message.get("input_method", "tap")

        logger.info(f"engine.tap_answer(qid={question_id}, value={value})")

        # Guard: stale question
        if question_id != self.state.current_question_id:
            logger.warning(
                f"engine.tap_stale(expected={self.state.current_question_id}, got={question_id})"
            )
            return

        # Guard: already locked
        if self.state.answer_locked:
            logger.warning(f"engine.tap_locked(qid={question_id})")
            return

        # Cancel hint timers — child is responding
        self.hints.cancel_timers()

        # Validate answer via game state
        result = self.state.check_answer(value, input_method=input_method)
        if result is None:
            logger.warning(f"engine.tap_null_result(qid={question_id})")
            return

        # Flush result messages to frontend
        await self._flush_game_messages()

        # Handle the result (narrate + next question)
        await self._handle_result(result)

    async def on_voice_answer(self, tool_result: dict):
        """
        Called by worker's on_tools_executed after check_math_answer completes.
        tool_result is the parsed JSON from the tool output.
        """
        logger.info(
            f"engine.voice_answer(correct={tool_result.get('correct')}, "
            f"stars={tool_result.get('stars')})"
        )

        # Cancel hint timers
        self.hints.cancel_timers()

        # Flush result messages to frontend (game state queued them during check_answer)
        await self._flush_game_messages()

        # Build a result dict compatible with _handle_result
        # The tool returns a simplified dict; map it to what _handle_result expects
        result = {
            "correct": tool_result.get("correct", False),
            "retry": tool_result.get("retry", False),
            "move_next": tool_result.get("move_next", False),
            "game_complete": tool_result.get("game_complete", False),
            "game_over": tool_result.get("game_over", False),
            "bonus_star": tool_result.get("bonus_star", False),
            "correct_answer": tool_result.get("correct_answer"),
            "consecutive_correct": tool_result.get("consecutive_correct", 0),
            "progress": {"stars": tool_result.get("stars", 0), "total_needed": self.state.stars_to_win},
        }

        await self._handle_result(result)

    async def on_hint_triggered(self, question_id: str, level: int):
        """Called by HintManager when a timer fires or attempt threshold is hit."""
        logger.info(f"engine.hint_triggered(qid={question_id}, level={level})")

        # Idempotency guard: if hint_level already past requested level, skip.
        # Prevents double-escalation when attempt hints and silence timers race.
        if level < self.state.hint_level:
            logger.warning(
                f"engine.hint_already_escalated(qid={question_id}, level={level}, "
                f"current={self.state.hint_level})"
            )
            return

        hint = self.state.escalate_hint()
        if hint is None:
            logger.warning(f"engine.hint_escalate_none(qid={question_id}, level={level})")
            return

        action = hint.get("action")
        logger.info(f"engine.hint_action(qid={question_id}, action={action})")

        # Flush any messages (e.g., math_hint with eliminated option)
        await self._flush_game_messages()

        # Narrate the hint
        await self.narrator.give_hint(
            hint_type=action,
            question_text=self.state.current_question_text or "",
            correct_answer=self.state.current_expected_answer,
        )

        # If reveal: answer was shown, move to next question
        if action == "reveal":
            await self._present_next_question()

    async def on_game_control(self, message: dict):
        """Called by DataChannel when game_control message received."""
        action = message.get("action")
        logger.info(f"engine.control(action={action})")

        if action == "restart":
            self.state.restart()
            await self._present_next_question()
        elif action == "quit":
            self.hints.cancel_timers()
            logger.info("engine.quit")

    # ==================== INTERNAL FLOW ====================

    async def _present_next_question(self):
        """Pick next question, register in state, send to frontend, narrate."""
        q = self._get_next_question()
        if q is None:
            # Pool exhausted — shuffle and restart
            logger.info("engine.questions_exhausted_cycling")
            random.shuffle(self.questions)
            self._question_index = 0
            q = self._get_next_question()

        remaining = len(self.questions) - self._question_index
        logger.info(f"engine.next_question(index={self._question_index - 1}, remaining={remaining})")

        # Register in game state (generates options, queues math_question message)
        self.state.register_question(
            q["question_text"], q["story_text"], q["correct_answer"]
        )

        # Send question to frontend
        await self._flush_game_messages()

        # Start hint timers
        self.hints.start_timers(self.state.current_question_id)

        # Narrate the question
        await self.narrator.present_question(q["question_text"], q["story_text"])

    async def _handle_result(self, result: dict):
        """React to correct/wrong/game_over/game_complete."""
        progress = result.get("progress", {})
        stars = progress.get("stars", self.state.stars)
        total_needed = progress.get("total_needed", self.state.stars_to_win)

        if result.get("game_over"):
            await self.narrator.narrate_game_over(stars)
            return

        if result.get("game_complete"):
            await self.narrator.narrate_level_complete(self.state.level)
            await self._present_next_question()
            return

        if result.get("correct"):
            await self.narrator.react_correct(stars, total_needed, result.get("bonus_star", False))
            await self._present_next_question()
            return

        # Wrong answer
        if result.get("retry"):
            # Explorer: trigger attempt-based hint
            self.hints.on_wrong_attempt(self.state.current_attempts)
            await self.narrator.react_wrong(retry=True)
            # Restart silence timers for the retry
            self.hints.start_timers(self.state.current_question_id)
        else:
            # Max attempts reached — tell correct answer, move on
            await self.narrator.react_wrong(
                retry=False, correct_answer=result.get("correct_answer")
            )
            await self._present_next_question()

    async def _flush_game_messages(self):
        """Pop all queued messages from game state and send via data channel."""
        msgs = self.state.pop_messages()
        for msg in msgs:
            await self.dc.send(msg)
            logger.info(
                f"engine.flushed(type={msg.get('type')}, qid={msg.get('question_id', '')})"
            )

    def _get_next_question(self) -> Optional[dict]:
        """Get next question from pool, or None if exhausted."""
        if self._question_index >= len(self.questions):
            return None
        q = self.questions[self._question_index]
        self._question_index += 1
        return q
