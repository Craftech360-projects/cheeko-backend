"""
Game flow engine for Odd One Out.
Event-driven: agent_state_changed(listening) triggers next steps after TTS completes.
Engine controls scoring/flow. LLM agent controls voice/personality.
"""

import asyncio
import logging
import random
import time

from src.shared.progress_client import ProgressClient

logger = logging.getLogger("oddoneout_engine")

# What the engine should do when TTS finishes
NEXT_ACTION_NONE = "none"
NEXT_ACTION_START_HINTS = "start_hints"       # After question TTS → start hint timers
NEXT_ACTION_NEXT_QUESTION = "next_question"   # After reaction TTS → generate next question
NEXT_ACTION_LEVEL_COMPLETE = "level_complete"  # After reaction TTS → handle level complete
NEXT_ACTION_GAME_OVER = "game_over"           # After reaction TTS → handle game over


class OddOneOutEngine:
    """
    Event-driven game engine. All flow advances happen when TTS finishes
    (agent_state_changed → listening), not when generate_reply() returns.

    This ensures:
    - Hints start AFTER child hears the question
    - Next question loads AFTER child hears the reaction
    - No context leakage between LLM calls
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
        child_age: int = 7,
    ):
        self.state = game_state
        self.narrator = narrator
        self.hints = hint_manager
        self.dc = data_channel
        self.qgen = question_generator
        self.session = session
        self.child_name = child_name
        self.child_age = child_age
        self._answered_question_id = None
        self._next_action = NEXT_ACTION_NONE  # What to do when TTS finishes
        self._progress_client = ProgressClient()
        self._child_id = ""
        self._session_start_time = 0.0
        self._total_hints_used = 0
        self._answers = []  # bool list for sliding window

        # Central event listener: when agent stops speaking, do the next thing
        @session.on("agent_state_changed")
        def _on_state_changed(ev):
            new_state = getattr(ev, "new_state", None)
            new_state_str = new_state.name.lower() if hasattr(new_state, "name") else str(new_state)

            if new_state_str not in ("listening", "idle"):
                return

            action = self._next_action
            self._next_action = NEXT_ACTION_NONE

            if action == NEXT_ACTION_NONE:
                return

            qid = self.state.current_question_id
            q = self.state.current_question

            if action == NEXT_ACTION_START_HINTS:
                if qid and q and qid != self._answered_question_id:
                    logger.info(f"engine.tts_done→start_hints(qid={qid})")
                    self.hints.start_timers(qid, q)

            elif action == NEXT_ACTION_NEXT_QUESTION:
                logger.info("engine.tts_done→next_question")
                asyncio.ensure_future(self._generate_and_send_question())

            elif action == NEXT_ACTION_LEVEL_COMPLETE:
                logger.info("engine.tts_done→level_complete")
                asyncio.ensure_future(self._do_level_complete())

            elif action == NEXT_ACTION_GAME_OVER:
                logger.info("engine.tts_done→game_over")
                # Game over — nothing more to do, overlay shows on frontend

    # ==================== EVENT HANDLERS ====================

    async def on_game_start(self, child_name: str, age: int, game_mode: str, child_id: str = ""):
        logger.info(f"engine.game_start(name={child_name}, age={age}, mode={game_mode})")
        self.child_name = child_name
        self.child_age = age
        self._child_id = child_id or child_name
        self._session_start_time = time.time()
        self._total_hints_used = 0
        self._answers = []
        self.state.game_mode = game_mode
        self.state.reset()
        self.qgen.reset()

        # Load persisted progress
        try:
            progress = await self._progress_client.get_progress(self._child_id, "oddoneout")
            if progress and progress.get("level"):
                self.state.level = progress["level"]
                logger.info(f"engine.progress_loaded(level={self.state.level}, stars={progress.get('total_stars', 0)})")
        except Exception as e:
            logger.warning(f"engine.progress_load_failed(error={e})")

        await self.dc.send({
            "type": "game_state",
            "state": "started",
            "game_mode": game_mode,
            "progress": self.state._get_progress(),
        })

        # Greet via LLM agent (inject into chat context)
        await self.narrator.greet(child_name, game_mode)
        # Don't wait for TTS — go straight to first question
        await self._generate_and_send_question()

    async def on_tap_answer(self, message: dict):
        """Called by DataChannel when oddoneout_answer received."""
        question_id = message.get("question_id")
        value = message.get("value")
        input_method = message.get("input_method", "tap")

        logger.info(f"engine.tap_answer(qid={question_id}, value={value})")

        if question_id == self._answered_question_id:
            logger.warning(f"engine.tap_already_answered(qid={question_id})")
            return
        if question_id != self.state.current_question_id:
            logger.warning(f"engine.tap_stale(expected={self.state.current_question_id}, got={question_id})")
            return

        self._answered_question_id = question_id
        self._next_action = NEXT_ACTION_NONE  # Cancel any pending TTS action
        self.hints.cancel_timers()
        await self._process_answer(value, input_method)

    async def on_voice_answer(self, tool_result: dict):
        """Called by worker after check_oddoneout_answer tool completes."""
        action = tool_result.get("action")
        logger.info(f"engine.voice_answer(action={action})")

        if action == "prompt_retry":
            await self.narrator._speak_direct(
                "I didn't catch that! Tell me which item doesn't belong.",
                tag="prompt_retry",
            )
            return

        if action != "answer_checked":
            logger.warning(f"engine.voice_unknown_action(action={action})")
            return

        question_id = tool_result.get("question_id", self.state.current_question_id)
        if question_id == self._answered_question_id:
            logger.warning(f"engine.voice_already_answered(qid={question_id})")
            return

        self._answered_question_id = question_id
        self._next_action = NEXT_ACTION_NONE
        self.hints.cancel_timers()
        selected_item = tool_result.get("selected_item", "")
        await self._process_answer(selected_item, "voice")

    async def on_hint_triggered(self, question_id: str, clue: str):
        """Called by hint manager when clue timer fires."""
        logger.info(f"engine.hint(qid={question_id})")
        if question_id != self.state.current_question_id:
            return
        self._total_hints_used += 1
        await self.dc.send({
            "type": "oddoneout_hint",
            "question_id": question_id,
            "hint_text": clue,
        })
        # Speak hint via LLM agent
        await self.narrator.speak_hint(clue)

    async def on_timeout(self, question_id: str):
        """Called by hint manager when timeout fires."""
        logger.info(f"engine.timeout(qid={question_id})")
        if question_id != self.state.current_question_id:
            return
        if question_id == self._answered_question_id:
            return
        self._answered_question_id = question_id
        self._next_action = NEXT_ACTION_NONE
        self.hints.cancel_timers()
        asyncio.get_running_loop().call_soon(
            lambda: asyncio.ensure_future(self._process_answer(None, "timeout"))
        )

    async def on_game_control(self, message: dict):
        action = message.get("action")
        logger.info(f"engine.control(action={action})")
        if action == "restart":
            self.hints.cancel_timers()
            self._next_action = NEXT_ACTION_NONE
            self.state.reset()
            self.qgen.reset()
            await self.dc.send({
                "type": "game_state", "state": "started",
                "game_mode": self.state.game_mode,
                "progress": self.state._get_progress(),
            })
            await self._generate_and_send_question()
        elif action == "next_level":
            self.hints.cancel_timers()
            self._next_action = NEXT_ACTION_NONE
            self.state.advance_level()
            await self.dc.send({
                "type": "game_state", "state": "playing",
                "game_mode": self.state.game_mode,
                "progress": self.state._get_progress(),
            })
            await self._generate_and_send_question()
        elif action == "quit":
            self.hints.cancel_timers()
            self._next_action = NEXT_ACTION_NONE

    # ==================== INTERNAL FLOW ====================

    async def _generate_and_send_question(self):
        """Generate question, register in state, send DC, narrate via LLM agent."""
        difficulty_tier = min(5, max(1, (self.state.level + 4) // 5))  # level 1-5→tier1, 6-10→tier2, etc
        q = await self.qgen.generate(self.child_age, difficulty_tier=difficulty_tier)
        logger.info(f"engine.question(type={q['question_type']}, odd={q['odd_one_out']})")

        self.state.set_question(q)
        self._answered_question_id = None

        # Build options with IDs (randomized order)
        items = list(q["items"])
        random.shuffle(items)
        options = [{"label": item, "value": item, "id": chr(ord("a") + i)} for i, item in enumerate(items)]

        await self.dc.send({
            "type": "oddoneout_question",
            "question_id": self.state.current_question_id,
            "question_text": "Which one doesn't belong?",
            "question_type": q.get("question_type", "category"),
            "options": options,
            "game_mode": self.state.game_mode,
            "progress": self.state._get_progress(),
        })

        # Narrator reads items via LLM agent — awaits SpeechHandle (TTS completion)
        self._next_action = NEXT_ACTION_START_HINTS  # Safety net via event listener
        await self.narrator.announce_question(
            items=items,
            question_number=self.state.questions_asked,
            total=self.state.total_needed,
        )
        # narrator.announce_question awaits TTS completion → start hints now
        if self._next_action == NEXT_ACTION_START_HINTS:
            self._next_action = NEXT_ACTION_NONE
            q_data = self.state.current_question
            qid = self.state.current_question_id
            if qid and q_data and qid != self._answered_question_id:
                logger.info(f"engine.narrator_done→start_hints(qid={qid})")
                self.hints.start_timers(qid, q_data)

    async def _process_answer(self, selected_item: str | None, input_method: str):
        """Score answer, send result DC, narrate via LLM, set next action for TTS end."""
        q = self.state.current_question
        if not q:
            logger.warning("engine.process_no_question")
            return

        odd_one_out = q["odd_one_out"]
        explanation = q.get("explanation", "")
        fun_fact = q.get("fun_fact", "")

        if selected_item is None:  # timeout
            is_correct = False
        else:
            is_correct = selected_item.lower().strip() == odd_one_out.lower().strip()

        self._answers.append(is_correct)
        result_meta = self.state.record_answer(is_correct)

        # Send result to frontend IMMEDIATELY (instant visual feedback)
        result = {
            "type": "oddoneout_result",
            "question_id": self.state.current_question_id,
            "correct": is_correct,
            "user_answer": selected_item,
            "correct_answer": odd_one_out,
            "explanation": explanation,
            "fun_fact": fun_fact,
            "input_method": input_method,
            "progress": self.state._get_progress(),
            "game_complete": result_meta.get("game_complete", False),
            "game_over": result_meta.get("game_over", False),
            "bonus_star": result_meta.get("bonus_star", False),
            "consecutive_correct": self.state.consecutive_correct,
        }
        await self.dc.send(result)
        logger.info(f"engine.result(correct={is_correct}, complete={result_meta.get('game_complete')})")

        # Narrate via LLM agent — narrator awaits TTS completion (SpeechHandle)
        try:
            if input_method == "timeout":
                await self.narrator.react_timeout(odd_one_out, explanation, fun_fact)
            elif is_correct:
                await self.narrator.react_correct(
                    explanation, fun_fact,
                    self.state.stars, self.state.total_needed,
                    result_meta.get("bonus_star", False),
                )
            else:
                await self.narrator.react_wrong(odd_one_out, explanation, fun_fact)
        except Exception as e:
            logger.error(f"engine.narration_error(error={e})")

        # Advance AFTER TTS finishes — child has heard the full reaction
        try:
            if result_meta.get("game_over"):
                await self._handle_game_over()
                return
            if result_meta.get("game_complete"):
                await self._do_level_complete()
                return
            await self._generate_and_send_question()
        except Exception as e:
            logger.error(f"engine.advance_error(error={e})", exc_info=True)

    async def _do_level_complete(self):
        """Handle level complete: save progress, send DC, narrate, advance."""
        logger.info(f"engine.level_complete(level={self.state.level})")
        result = await self._save_session(completed=True)
        progress_data = self.state._get_progress()
        if result:
            progress_data["api_result"] = result.get("progress", {})
        await self.dc.send({
            "type": "game_state", "state": "completed",
            "game_mode": self.state.game_mode,
            "progress": progress_data,
        })
        self.state.advance_level()
        self._answered_question_id = None

        # Narrate level complete, then next question when TTS finishes
        self._next_action = NEXT_ACTION_NEXT_QUESTION
        await self.narrator.announce_level_complete(self.state.level - 1)

    async def _handle_game_over(self):
        """Send game over DC message, save progress, narrate."""
        logger.info(f"engine.game_over(stars={self.state.stars})")
        result = await self._save_session(completed=True)
        progress_data = self.state._get_progress()
        if result:
            progress_data["api_result"] = result.get("progress", {})
        await self.dc.send({
            "type": "game_state", "state": "game_over",
            "game_mode": self.state.game_mode,
            "progress": progress_data,
        })
        await self.narrator.announce_game_over(self.state.stars, self.state.total_needed)

    async def _save_session(self, completed: bool = True) -> dict:
        """Save game session to progression API."""
        try:
            duration = int(time.time() - self._session_start_time)
            result = await self._progress_client.end_session({
                "childId": self._child_id,
                "gameType": "oddoneout",
                "ageBand": self.state.game_mode,
                "level": self.state.level,
                "starsEarned": self.state.stars,
                "questionsAsked": self.state.questions_asked,
                "correctAnswers": sum(1 for a in self._answers if a),
                "bestStreak": self.state.consecutive_correct,
                "hintsUsed": self._total_hints_used,
                "durationSecs": duration,
                "completed": completed,
                "answers": self._answers,
            })
            if result:
                prog = result.get("progress", {})
                if prog.get("levelAdvanced"):
                    logger.info(f"engine.level_up(new={prog.get('levelAfter')}, milestone={prog.get('milestone')})")
                for ach in result.get("achievements", []):
                    logger.info(f"engine.achievement(code={ach['code']})")
            return result
        except Exception as e:
            logger.error(f"engine.save_session_error(error={e})")
            return {}
