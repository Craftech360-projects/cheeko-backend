"""Odd One Out game state management."""
import uuid
import logging

logger = logging.getLogger("oddoneout_state")


class OddOneOutState:
    """Tracks game progress. Engine sends DC messages directly (no queue)."""

    def __init__(self, game_mode: str = "explorer"):
        self.game_mode = game_mode
        self.stars = 0
        self.total_needed = 5
        self.lives = 3 if game_mode == "commander" else None
        self.max_lives = 3 if game_mode == "commander" else None
        self.level = 1
        self.mission_number = 1
        self.consecutive_correct = 0
        self.questions_asked = 0
        self.current_question_id = ""
        self.current_question = None
        self.used_types = []

    def _get_progress(self) -> dict:
        return {
            "stars": self.stars,
            "total_needed": self.total_needed,
            "lives": self.lives,
            "max_lives": self.max_lives,
            "mission_number": self.mission_number,
            "level": self.level,
        }

    def set_question(self, question: dict):
        """Register new question, assign ID."""
        self.current_question_id = str(uuid.uuid4())
        self.current_question = question
        self.questions_asked += 1
        if question.get("question_type"):
            self.used_types.append(question["question_type"])

    def record_answer(self, correct: bool) -> dict:
        """Score answer, return metadata dict."""
        bonus_star = False
        if correct:
            self.stars += 1
            self.consecutive_correct += 1
            if self.consecutive_correct > 0 and self.consecutive_correct % 5 == 0:
                self.stars += 1
                bonus_star = True
                logger.info(f"state.bonus_star(streak={self.consecutive_correct})")
        else:
            self.consecutive_correct = 0
            if self.game_mode == "commander" and self.lives is not None:
                self.lives -= 1

        game_complete = self.stars >= self.total_needed
        game_over = (
            self.game_mode == "commander"
            and self.lives is not None
            and self.lives <= 0
        )

        self.mission_number += 1

        return {
            "game_complete": game_complete,
            "game_over": game_over,
            "bonus_star": bonus_star,
            "consecutive_correct": self.consecutive_correct,
        }

    def advance_level(self):
        self.level += 1
        self.mission_number += 1
        self.stars = 0
        self.consecutive_correct = 0
        self.questions_asked = 0
        self.used_types = []
        if self.game_mode == "commander":
            self.lives = self.max_lives

    def reset(self):
        self.__init__(game_mode=self.game_mode)
