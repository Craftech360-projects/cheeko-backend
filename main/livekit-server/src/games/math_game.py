"""
Math Game State for Cheeko AI Assistant
Manages game state with age-based modes (Explorer/Commander),
star-based progression, lives, question registry, and distractor generation.
"""

import logging
import random

logger = logging.getLogger("math_game")


class MathGameState:
    EXPLORER = "explorer"
    COMMANDER = "commander"

    def __init__(self, game_mode: str = "explorer"):
        self.game_mode = game_mode
        self.stars_to_win = 5
        self.max_lives = 3 if game_mode == self.COMMANDER else None
        self.max_attempts = 2
        self._pending_messages = []
        self.reset()

    def reset(self):
        """Full reset to initial state (keeps mode config)."""
        self.level = 0
        self.stars = 0
        self.lives = self.max_lives  # None for Explorer
        self.mission_number = 1
        self.total_questions = 0
        self.consecutive_correct = 0

        # Current question state
        self.current_question_id = None
        self.current_expected_answer = None
        self.current_options = []
        self.current_question_text = None
        self.current_story_text = None
        self.current_attempts = 0
        self.answer_locked = False
        self.hint_level = 0  # 0=none, 1=repeat, 2=eliminate, 3=reveal

        # Flag: voice answer needs auto-registration of next question
        self.voice_needs_next = False

        # Question bank (legacy compat)
        self.question_bank = []
        self.current_index = 0

        # Legacy compat: streak field used by old math_tutor_worker
        self.streak = 0

        self._pending_messages = []
        logger.info(f"Game reset: mode={self.game_mode}")

    def advance_level(self):
        """Advance to next level after completing a round — reset stars, keep level."""
        self.level += 1
        self.stars = 0
        self.lives = self.max_lives
        self.consecutive_correct = 0
        self.current_question_id = None
        self.current_expected_answer = None
        self.current_options = []
        self.current_question_text = None
        self.current_story_text = None
        self.current_attempts = 0
        self.answer_locked = False
        self.hint_level = 0
        self.voice_needs_next = False
        logger.info(f"Level advanced to {self.level}: stars reset, lives={self.lives}")

    def restart(self):
        """Restart after game over — keep stars earned, reset lives."""
        self.lives = self.max_lives
        self.current_question_id = None
        self.current_expected_answer = None
        self.current_options = []
        self.current_question_text = None
        self.current_story_text = None
        self.current_attempts = 0
        self.answer_locked = False
        self.consecutive_correct = 0
        self.hint_level = 0
        self.voice_needs_next = False
        logger.info(f"Game restarted: stars={self.stars}, lives={self.lives}")

    # ------------------------------------------------------------------
    # Message queue (worker pops and publishes via data channel)
    # ------------------------------------------------------------------

    def queue_message(self, data: dict):
        """Queue a JSON message for the worker to publish to frontend."""
        self._pending_messages.append(data)

    def pop_messages(self) -> list:
        """Pop all pending messages. Worker calls this after tool execution."""
        msgs = self._pending_messages[:]
        self._pending_messages.clear()
        return msgs

    # ------------------------------------------------------------------
    # Question registration
    # ------------------------------------------------------------------

    def register_question(self, question_text: str, story_text: str, correct_answer: float) -> dict:
        """
        Register a new question: generate ID, options, queue JSON for frontend.
        Called by register_math_question tool BEFORE LLM speaks the question.
        Returns the queued payload.
        """
        self.current_question_id = f"q_{self.mission_number}"
        self.current_expected_answer = correct_answer
        self.current_question_text = question_text
        self.current_story_text = story_text
        self.current_attempts = 0
        self.answer_locked = False
        self.hint_level = 0

        num_options = 2 if self.game_mode == self.EXPLORER else 4
        self.current_options = self._generate_options(correct_answer, num_options)

        payload = {
            "type": "game_question", "game_type": "math_quiz",
            "question_id": self.current_question_id,
            "question_text": question_text,
            "story_text": story_text,
            "display_mode": "multiple_choice",
            "options": self.current_options,
            "game_mode": self.game_mode,
            "progress": self._get_progress(),
            "time_limit_seconds": None if self.game_mode == self.EXPLORER else 30,
        }
        # Safety check: ensure correct answer is in options
        option_values = [o["value"] for o in self.current_options]
        if int(correct_answer) not in option_values:
            logger.error(f"BUG: correct answer {correct_answer} NOT in options {option_values}! Forcing inclusion.")
            self.current_options[0] = {"label": str(int(correct_answer)), "value": int(correct_answer)}
            random.shuffle(self.current_options)
            payload["options"] = self.current_options

        self.queue_message(payload)
        logger.info(f"Registered question {self.current_question_id}: {question_text} = {correct_answer}, options={option_values}")
        return payload

    # ------------------------------------------------------------------
    # Answer validation
    # ------------------------------------------------------------------

    def check_answer(self, user_answer: float, input_method: str = "voice") -> dict | None:
        """
        Validate answer against current question. Update stars/lives.
        Returns result dict, or None if answer_locked (duplicate).
        """
        if self.answer_locked:
            logger.info(f"Answer locked for {self.current_question_id}, ignoring")
            return None

        if self.current_expected_answer is None:
            logger.warning("No question registered, cannot check answer")
            return None

        is_correct = abs(user_answer - self.current_expected_answer) < 0.01

        if is_correct:
            self.answer_locked = True
            self.stars += 1
            self.streak += 1  # Legacy compat
            self.consecutive_correct += 1
            self.total_questions += 1
            self.current_attempts = 0

            game_complete = self.stars >= self.stars_to_win

            # Streak combo: Commander 5-in-a-row = bonus star
            bonus_star = False
            if self.game_mode == self.COMMANDER and self.consecutive_correct >= 5:
                self.stars += 1
                bonus_star = True
                self.consecutive_correct = 0
                game_complete = self.stars >= self.stars_to_win

            self.mission_number += 1

            # Flag for worker: voice answers need auto-registration of next question
            if input_method == "voice":
                self.voice_needs_next = True

            result = {
                "type": "game_result", "game_type": "math_quiz",
                "question_id": self.current_question_id,
                "correct": True,
                "user_answer": user_answer,
                "correct_answer": self.current_expected_answer,
                "input_method": input_method,
                "progress": self._get_progress(),
                "game_complete": game_complete,
                "game_over": False,
                "retry": False,
                "move_next": True,
                "consecutive_correct": self.consecutive_correct,
                "bonus_star": bonus_star,
            }
            self.queue_message(result)

            if game_complete:
                self.queue_message({
                    "type": "game_state",
                    "state": "completed",
                    "game_mode": self.game_mode,
                    "progress": self._get_progress(),
                })
                # Advance to next level — reset stars for new round
                self.advance_level()

            return result

        # Wrong answer
        self.consecutive_correct = 0
        self.streak = 0  # Legacy compat
        self.current_attempts += 1

        # Commander: lose a life on wrong answer
        if self.game_mode == self.COMMANDER and self.lives is not None:
            self.lives -= 1

        game_over = self.is_game_over()
        retry = self.current_attempts < self.max_attempts and not game_over
        move_next = not retry

        if move_next and not game_over:
            self.answer_locked = True
            self.mission_number += 1
            self.total_questions += 1
            self.current_attempts = 0

        # Flag for worker: voice answers with move_next or game_over need auto-next
        if input_method == "voice" and (move_next or game_over):
            self.voice_needs_next = True

        result = {
            "type": "game_result", "game_type": "math_quiz",
            "question_id": self.current_question_id,
            "correct": False,
            "user_answer": user_answer,
            "correct_answer": self.current_expected_answer if move_next else None,
            "input_method": input_method,
            "progress": self._get_progress(),
            "game_complete": False,
            "game_over": game_over,
            "retry": retry,
            "move_next": move_next,
            "consecutive_correct": 0,
            "bonus_star": False,
        }
        self.queue_message(result)

        if game_over:
            self.queue_message({
                "type": "game_state",
                "state": "game_over",
                "game_mode": self.game_mode,
                "progress": self._get_progress(),
            })

        return result

    # ------------------------------------------------------------------
    # Hint support
    # ------------------------------------------------------------------

    def escalate_hint(self) -> dict | None:
        """
        Escalate hint level. Returns hint action dict or None if max reached.
        Levels: 0->1 repeat, 1->2 eliminate option, 2->3 reveal answer.
        """
        self.hint_level += 1

        if self.hint_level == 1:
            return {"action": "repeat", "question_text": self.current_question_text}

        if self.hint_level == 2:
            eliminated = self._eliminate_one_option()
            if eliminated:
                payload = {
                    "type": "game_hint", "game_type": "math_quiz",
                    "question_id": self.current_question_id,
                    "hint_type": "eliminate",
                    "eliminated_value": eliminated["value"],
                    "remaining_options": self.current_options,
                }
                self.queue_message(payload)
                return {"action": "eliminate", "eliminated": eliminated}
            return {"action": "repeat", "question_text": self.current_question_text}

        if self.hint_level == 3:
            # Auto-reveal: show correct answer, no star, move on
            self.answer_locked = True
            self.mission_number += 1
            self.total_questions += 1
            self.current_attempts = 0

            result = {
                "type": "game_result", "game_type": "math_quiz",
                "question_id": self.current_question_id,
                "correct": False,
                "user_answer": None,
                "correct_answer": self.current_expected_answer,
                "input_method": "timeout",
                "progress": self._get_progress(),
                "game_complete": False,
                "game_over": False,
                "retry": False,
                "move_next": True,
                "consecutive_correct": 0,
                "bonus_star": False,
            }
            self.queue_message(result)
            return {"action": "reveal", "correct_answer": self.current_expected_answer}

        return None

    # ------------------------------------------------------------------
    # State queries
    # ------------------------------------------------------------------

    def is_game_complete(self) -> bool:
        return self.stars >= self.stars_to_win

    def is_game_over(self) -> bool:
        return self.game_mode == self.COMMANDER and self.lives is not None and self.lives <= 0

    def needs_new_bank(self) -> bool:
        return not self.question_bank or self.current_index >= len(self.question_bank)

    def load_question_bank(self, questions: list):
        """Load pre-generated questions. Resets index only."""
        self.question_bank = questions
        self.current_index = 0
        logger.info(f"Loaded {len(questions)} questions into bank")

    def get_next_bank_question(self) -> dict | None:
        """Pop next question from bank, or None if exhausted."""
        if self.needs_new_bank():
            return None
        q = self.question_bank[self.current_index]
        self.current_index += 1
        return q

    def _get_progress(self) -> dict:
        return {
            "stars": self.stars,
            "total_needed": self.stars_to_win,
            "lives": self.lives,
            "max_lives": self.max_lives,
            "mission_number": self.mission_number,
            "level": self.level,
        }

    def get_state(self) -> dict:
        return {
            "game_mode": self.game_mode,
            "stars": self.stars,
            "streak": self.streak,
            "lives": self.lives,
            "mission_number": self.mission_number,
            "total_questions": self.total_questions,
            "consecutive_correct": self.consecutive_correct,
            "game_complete": self.is_game_complete(),
            "game_over": self.is_game_over(),
            "current_question_id": self.current_question_id,
            "answer_locked": self.answer_locked,
        }

    # ------------------------------------------------------------------
    # Legacy compat: validate_answer (used by old check_math_answer tool)
    # ------------------------------------------------------------------

    def validate_answer(self, user_answer: float) -> dict:
        """Legacy method for old math_tutor_worker compatibility."""
        current_q = self.get_current_question()
        if not current_q:
            return {'correct': False, 'retry': False, 'move_next': False, 'error': 'No question available'}

        is_correct = abs(user_answer - current_q['answer']) < 0.01

        if is_correct:
            self.streak += 1
            self.total_questions += 1
            self.current_index += 1
            self.current_attempts = 0
            return {
                'correct': True, 'retry': False, 'move_next': True,
                'attempts_left': 0, 'correct_answer': current_q['answer']
            }
        else:
            self.streak = 0
            self.current_attempts += 1
            if self.current_attempts < self.max_attempts:
                return {
                    'correct': False, 'retry': True, 'move_next': False,
                    'attempts_left': self.max_attempts - self.current_attempts,
                    'correct_answer': current_q['answer']
                }
            else:
                self.total_questions += 1
                self.current_index += 1
                self.current_attempts = 0
                return {
                    'correct': False, 'retry': False, 'move_next': True,
                    'attempts_left': 0, 'correct_answer': current_q['answer']
                }

    def get_current_question(self) -> dict:
        """Legacy: get current question from bank."""
        if not self.question_bank or self.current_index >= len(self.question_bank):
            return None
        return self.question_bank[self.current_index]

    # ------------------------------------------------------------------
    # Distractor generation
    # ------------------------------------------------------------------

    def _generate_options(self, correct_answer: float, num_options: int) -> list:
        """Generate multiple-choice options with plausible distractors."""
        correct = int(correct_answer)
        distractors = set()

        candidates = [
            correct + 1, correct - 1,
            correct + 2, correct - 2,
        ]

        # Larger offsets for Commander
        if self.game_mode == self.COMMANDER:
            candidates.extend([correct + 10, correct - 10])
            # Swapped digits for 2-digit numbers
            if correct >= 10:
                s = str(correct)
                if len(s) == 2:
                    swapped = int(s[1] + s[0])
                    if swapped != correct and swapped > 0:
                        candidates.append(swapped)

        # Filter: positive, not equal to correct
        candidates = [c for c in candidates if c > 0 and c != correct]
        random.shuffle(candidates)

        for c in candidates:
            if len(distractors) >= num_options - 1:
                break
            distractors.add(c)

        # Fill remaining if pool exhausted
        offset = 3
        while len(distractors) < num_options - 1:
            d = correct + offset
            if d > 0 and d != correct and d not in distractors:
                distractors.add(d)
            offset = -offset if offset > 0 else (-offset + 1)

        options = [{"label": str(correct), "value": correct}]
        for d in list(distractors)[:num_options - 1]:
            options.append({"label": str(d), "value": d})

        random.shuffle(options)
        return options

    def _eliminate_one_option(self) -> dict | None:
        """Remove one wrong option for hint. Returns removed option or None."""
        wrong = [o for o in self.current_options
                 if o["value"] != int(self.current_expected_answer)]
        if not wrong:
            return None
        eliminated = random.choice(wrong)
        self.current_options.remove(eliminated)
        return eliminated
