"""
Game flow engine for Yes/No Quiz.
Central hub that receives all events and coordinates modules.
Questions are generated dynamically by the LLM via OpenRouter API.
"""

import logging

logger = logging.getLogger("yesno_quiz_engine")


class YesNoQuizEngine:
    """
    Central game flow controller. Receives events from:
    - DataChannel: tap answers (yesno_answer), game control messages
    - Worker: voice answer results (via on_tools_executed / on_voice_answer)
    - YesNoHintManager: hint clues and timeouts

    Coordinates:
    - YesNoQuizState: answer recording, progress tracking
    - YesNoNarrator: LLM speech (greetings, reactions, hints)
    - QuestionGenerator: LLM-generated yes/no questions
    - session.say(): direct TTS for question narration
    - YesNoHintManager: timer lifecycle
    - DataChannel: frontend messaging
    """

    def __init__(
        self,
        game_state,
        narrator,
        hint_manager,
        data_channel,
        question_generator,
        session,
        child_name: str = "buddy",
        child_age: int = 5,
    ):
        self.state = game_state
        self.narrator = narrator
        self.hints = hint_manager
        self.dc = data_channel
        self.qgen = question_generator
        self.session = session
        self.child_name = child_name
        self.child_age = child_age
        self._answered_question_id = None  # Guard against double-answering

    # ==================== EVENT HANDLERS ====================

    async def on_game_start(self, child_name: str, age: int, game_mode: str):
        """Called when game should begin (after greeting or on start control)."""
        logger.info(f"engine.game_start(name={child_name}, age={age}, mode={game_mode})")

        self.child_name = child_name
        self.child_age = age
        self.state.game_mode = game_mode
        self.state.reset()
        self.qgen.reset()  # Clear question history

        # Send game_state "started" to frontend
        await self.dc.send({
            "type": "game_state",
            "state": "started",
            "game_mode": game_mode,
            "progress": self.state._get_progress(),
        })

        await self.narrator.greet(child_name)
        await self._generate_and_send_question()

    async def on_tap_answer(self, message: dict):
        """
        Called by DataChannel when yesno_answer message received.
        Tap answers bypass LLM entirely — server validates directly.
        message format: {type: "yesno_answer", question_id, value: "yes"|"no"}
        """
        question_id = message.get("question_id")
        value = message.get("value")
        input_method = message.get("input_method", "tap")

        logger.info(f"engine.tap_answer(qid={question_id}, value={value})")

        # Guard: already answered this question
        if question_id == self._answered_question_id:
            logger.warning(f"engine.tap_already_answered(qid={question_id})")
            return

        # Guard: stale question
        if question_id != self.state.current_question_id:
            logger.warning(
                f"engine.tap_stale(expected={self.state.current_question_id}, got={question_id})"
            )
            return

        # Cancel hint timers — child is responding
        self.hints.cancel_timers()

        # Validate answer
        if value not in ("yes", "no"):
            logger.warning(f"engine.tap_invalid_value(value={value})")
            return

        await self._process_answer(value, input_method)

    async def on_voice_answer(self, tool_result: dict):
        """
        Called by worker's on_tools_executed after check_yesno_answer completes.
        tool_result is the parsed JSON from the tool output.

        Handles two actions:
        - "answer_checked": valid yes/no answer was processed
        - "prompt_retry": unrecognized speech, ask child to try again
        """
        action = tool_result.get("action")
        logger.info(f"engine.voice_answer(action={action})")

        if action == "prompt_retry":
            # Unrecognized speech — ask child to say yes or no clearly
            logger.info("engine.voice_prompt_retry")
            await self.narrator._speak(
                "I didn't catch that! Please say YES or NO clearly.",
                tag="prompt_retry",
            )
            return

        if action != "answer_checked":
            logger.warning(f"engine.voice_unknown_action(action={action})")
            return

        # Guard: already answered this question (tap may have beaten voice)
        question_id = tool_result.get("question_id", self.state.current_question_id)
        if question_id == self._answered_question_id:
            logger.warning(f"engine.voice_already_answered(qid={question_id})")
            return

        # Mark as answered and cancel hint timers
        self._answered_question_id = question_id
        self.hints.cancel_timers()

        # Score the answer in the engine (tool no longer modifies state)
        user_answer = tool_result.get("user_answer", "")
        await self._process_answer(user_answer, "voice")

    async def on_hint_triggered(self, question_id: str, hint_text: str):
        """
        Called by YesNoHintManager when the hint timer fires.
        Sends yesno_hint DC message and speaks the clue via narrator.
        """
        logger.info(f"engine.hint_triggered(qid={question_id}, text={hint_text[:60]})")

        # Guard: stale question
        if question_id != self.state.current_question_id:
            logger.warning(
                f"engine.hint_stale(expected={self.state.current_question_id}, got={question_id})"
            )
            return

        # Send hint to frontend
        await self.dc.send({
            "type": "yesno_hint",
            "question_id": question_id,
            "hint_text": hint_text,
        })

        # Narrator speaks the clue
        await self.narrator.speak_hint(hint_text)

    async def on_timeout(self, question_id: str):
        """
        Called by YesNoHintManager when the timeout timer fires.
        Marks the question wrong, narrates, then advances.
        """
        logger.info(f"engine.timeout(qid={question_id})")

        # Guard: stale question or already answered
        if question_id != self.state.current_question_id:
            logger.warning(
                f"engine.timeout_stale(expected={self.state.current_question_id}, got={question_id})"
            )
            return
        if question_id == self._answered_question_id:
            logger.warning(f"engine.timeout_already_answered(qid={question_id})")
            return

        # Mark as answered and cancel any remaining timers
        self._answered_question_id = question_id
        self.hints.cancel_timers()

        # Record a wrong answer for timeout
        try:
            current_q = self.state.current_question
            if not current_q:
                logger.warning("engine.timeout_no_question")
                return

            correct_answer = current_q.get("correct_answer", True)
            fun_fact = current_q.get("fun_fact", "")
            result_meta = self.state.record_answer(False)

            result = {
                "correct": False,
                "user_answer": None,
                "correct_answer": correct_answer,
                "fun_fact": fun_fact,
                "question_id": question_id,
                "input_method": "timeout",
                "game_complete": result_meta.get("game_complete", False),
                "game_over": result_meta.get("game_over", False),
                "bonus_star": False,
                "consecutive_correct": self.state.consecutive_correct,
                "progress": self.state._get_progress(),
            }

            # Send result to frontend
            await self.dc.send({
                "type": "yesno_result",
                **result,
            })
            logger.info(f"engine.timeout_result_sent(qid={question_id})")

            # Narrator: timeout reaction
            await self.narrator.react_timeout(correct_answer, fun_fact)

            # Check end conditions
            if result.get("game_over"):
                await self._handle_game_over()
                return
            if result.get("game_complete"):
                await self._handle_level_complete()
                return

            # Next question
            await self._generate_and_send_question()
        except Exception as e:
            logger.error(f"engine.timeout_error(qid={question_id}, error={e})", exc_info=True)

    async def on_game_control(self, message: dict):
        """Called by DataChannel when game_control message received."""
        action = message.get("action")
        logger.info(f"engine.control(action={action})")

        if action == "restart":
            self.hints.cancel_timers()
            self.state.reset()
            self.qgen.reset()
            await self.dc.send({
                "type": "game_state",
                "state": "started",
                "game_mode": self.state.game_mode,
                "progress": self.state._get_progress(),
            })
            await self._generate_and_send_question()
        elif action == "next_level":
            self.hints.cancel_timers()
            self.state.advance_level()
            await self.dc.send({
                "type": "game_state",
                "state": "playing",
                "game_mode": self.state.game_mode,
                "progress": self.state._get_progress(),
            })
            await self._generate_and_send_question()
        elif action == "quit":
            self.hints.cancel_timers()
            logger.info("engine.quit")

    # ==================== INTERNAL FLOW ====================

    async def _generate_and_send_question(self):
        """
        Generate a question via LLM, register in state, send yesno_question via DC,
        start hint timers, then narrate via narrator.announce_question().
        """
        q = await self.qgen.generate(self.child_age)
        logger.info(
            f"engine.generated_question(q={q['question']}, "
            f"answer={q['correct_answer']}, category={q.get('category')})"
        )

        # Register in game state (assigns question_id, tracks history)
        self.state.set_question(q)
        self._answered_question_id = None  # Reset for new question

        # Progress snapshot
        progress = self.state._get_progress()
        question_number = self.state.questions_asked
        total_needed = self.state.total_needed

        # Send question to frontend
        await self.dc.send({
            "type": "yesno_question",
            "question_id": self.state.current_question_id,
            "question_text": q["question"],
            "category": q.get("category", ""),
            "game_mode": self.state.game_mode,
            "progress": progress,
        })

        logger.info(f"engine.question_sent(qid={self.state.current_question_id})")

        # Narrator reads the question aloud
        try:
            await self.narrator.announce_question(
                question=q["question"],
                question_number=question_number,
                total=total_needed,
            )
        except Exception as e:
            logger.error(f"engine.narration_failed(error={e})")

        # Start hint timers after child has heard the question
        self.hints.start_timers(self.state.current_question_id, q["question"])

    async def _process_answer(self, answer: str, input_method: str):
        """
        Score a tap answer via state.record_answer(), build result dict,
        and forward to _send_result_and_advance().
        """
        current_q = self.state.current_question
        if not current_q:
            logger.warning("engine.process_answer_no_question")
            return

        # Mark this question as answered to prevent voice/tap race
        self._answered_question_id = self.state.current_question_id

        correct_answer_bool = current_q.get("correct_answer", True)
        user_said_yes = (answer == "yes")
        is_correct = (user_said_yes == correct_answer_bool)
        fun_fact = current_q.get("fun_fact", "")

        result_meta = self.state.record_answer(is_correct)

        result = {
            "correct": is_correct,
            "user_answer": answer,
            "correct_answer": correct_answer_bool,
            "fun_fact": fun_fact,
            "question_id": self.state.current_question_id,
            "input_method": input_method,
            "game_complete": result_meta.get("game_complete", False),
            "game_over": result_meta.get("game_over", False),
            "bonus_star": result_meta.get("bonus_star", False),
            "consecutive_correct": self.state.consecutive_correct,
            "progress": self.state._get_progress(),
        }

        await self._send_result_and_advance(result)

    async def _send_result_and_advance(self, result: dict):
        """
        Send yesno_result DC message, narrate the outcome, check for
        game_complete / game_over, else generate next question.
        """
        # Send result to frontend
        await self.dc.send({
            "type": "yesno_result",
            "question_id": result.get("question_id", self.state.current_question_id),
            "correct": result.get("correct", False),
            "user_answer": result.get("user_answer", ""),
            "correct_answer": result.get("correct_answer", True),
            "fun_fact": result.get("fun_fact", ""),
            "input_method": result.get("input_method", "tap"),
            "progress": result.get("progress", self.state._get_progress()),
            "game_complete": result.get("game_complete", False),
            "game_over": result.get("game_over", False),
            "consecutive_correct": result.get("consecutive_correct", 0),
            "bonus_star": result.get("bonus_star", False),
        })

        logger.info(
            f"engine.result_sent(correct={result.get('correct')}, "
            f"game_complete={result.get('game_complete')}, "
            f"game_over={result.get('game_over')})"
        )

        # Narrate the result
        if result.get("correct"):
            await self.narrator.react_correct(result.get("fun_fact", ""))
        else:
            await self.narrator.react_wrong(
                correct_answer=result.get("correct_answer", True),
                fun_fact=result.get("fun_fact", ""),
            )

        # Check end conditions
        if result.get("game_over"):
            await self._handle_game_over()
            return
        if result.get("game_complete"):
            await self._handle_level_complete()
            return

        # Next question (no retry on wrong in yes/no quiz)
        await self._generate_and_send_question()

    async def _handle_level_complete(self):
        """Announce level complete, send game_state 'completed', advance level."""
        logger.info(f"engine.level_complete(level={self.state.level})")

        await self.dc.send({
            "type": "game_state",
            "state": "completed",
            "game_mode": self.state.game_mode,
            "progress": self.state._get_progress(),
        })

        await self.narrator.announce_level_complete(self.state.level)

        # Advance level and start next question
        self.state.advance_level()
        self._answered_question_id = None  # Reset for new level
        await self._generate_and_send_question()

    async def _handle_game_over(self):
        """Announce game over, send game_state 'game_over'."""
        logger.info(f"engine.game_over(stars={self.state.stars})")

        await self.dc.send({
            "type": "game_state",
            "state": "game_over",
            "game_mode": self.state.game_mode,
            "progress": self.state._get_progress(),
        })

        await self.narrator.announce_game_over(
            child_name=self.child_name,
            stars=self.state.stars,
            total=self.state.total_needed,
        )
