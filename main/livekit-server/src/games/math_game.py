"""
Math Game module for Cheeko AI Assistant
Includes MathGameState class and related function tools
Extracted from main_agent.py for better modularity
"""

import logging

logger = logging.getLogger("math_game")


class MathGameState:
    """
    Helper class to track math game state

    Manages game state for math riddles:
    - Stores question bank (5 pre-generated questions)
    - Tracks current question index
    - Tracks retry attempts (max 2 per question)
    - Tracks streak (consecutive correct answers)
    """

    def __init__(self):
        """Initialize game state"""
        self.reset()

    def reset(self):
        """Reset game to initial state"""
        self.question_bank = []        # List of {question: str, answer: float}
        self.current_index = 0         # Which question we're on (0-4)
        self.current_attempts = 0      # Attempts on current question (0-2)
        self.max_attempts = 2          # Max retry attempts per question
        self.streak = 0                # Consecutive correct answers
        self.total_questions = 0       # Total questions answered
        logger.info("🔄 Math game state reset")

    def load_question_bank(self, questions: list):
        """
        Load pre-generated question bank

        Args:
            questions: List of {question: str, answer: float/int}
        """
        self.question_bank = questions
        self.current_index = 0
        self.current_attempts = 0
        self.streak = 0  # Reset streak for new question bank
        logger.info(f"📚 Loaded {len(questions)} questions into bank")

    def get_current_question(self) -> dict:
        """
        Get current question from bank

        Returns:
            dict: {question: str, answer: float} or None if bank empty
        """
        if not self.question_bank or self.current_index >= len(self.question_bank):
            return None
        return self.question_bank[self.current_index]

    def validate_answer(self, user_answer: float) -> dict:
        """
        Validate user's answer against current question

        Args:
            user_answer: User's parsed answer

        Returns:
            dict: {
                'correct': bool,
                'retry': bool,
                'move_next': bool,
                'attempts_left': int,
                'correct_answer': float
            }
        """
        current_q = self.get_current_question()
        if not current_q:
            return {'correct': False, 'retry': False, 'move_next': False, 'error': 'No question available'}

        is_correct = abs(user_answer - current_q['answer']) < 0.01

        if is_correct:
            # Correct answer
            self.streak += 1
            self.total_questions += 1
            self.current_index += 1
            self.current_attempts = 0
            return {
                'correct': True,
                'retry': False,
                'move_next': True,
                'attempts_left': 0,
                'correct_answer': current_q['answer']
            }
        else:
            # Wrong answer
            self.streak = 0  # Reset streak on ANY wrong answer
            self.current_attempts += 1

            if self.current_attempts < self.max_attempts:
                # Still have retries left
                return {
                    'correct': False,
                    'retry': True,
                    'move_next': False,
                    'attempts_left': self.max_attempts - self.current_attempts,
                    'correct_answer': current_q['answer']
                }
            else:
                # Max attempts reached, move to next
                self.total_questions += 1
                self.current_index += 1
                self.current_attempts = 0
                return {
                    'correct': False,
                    'retry': False,
                    'move_next': True,
                    'attempts_left': 0,
                    'correct_answer': current_q['answer']
                }

    def needs_new_bank(self) -> bool:
        """Check if we need to generate new question bank"""
        return not self.question_bank or self.current_index >= len(self.question_bank)

    def is_game_complete(self) -> bool:
        """
        Check if game is complete (3 correct in a row)

        Returns:
            bool: True if streak reached 3
        """
        return self.streak >= 3

    def get_state(self) -> dict:
        """
        Get current game state

        Returns:
            dict: Current game state information
        """
        current_q = self.get_current_question()
        return {
            'streak': self.streak,
            'current_index': self.current_index,
            'current_attempts': self.current_attempts,
            'max_attempts': self.max_attempts,
            'total_questions': self.total_questions,
            'question_bank_size': len(self.question_bank),
            'current_question': current_q['question'] if current_q else None,
            'needs_new_bank': self.needs_new_bank(),
            'game_complete': self.is_game_complete()
        }
