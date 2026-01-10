"""
Riddle Game module for Cheeko AI Assistant
Includes RiddleGameState class and related function tools
Extracted from main_agent.py for better modularity
"""

import logging

logger = logging.getLogger("riddle_game")


class RiddleGameState:
    """
    Helper class to track riddle game state (same structure as MathGameState)

    Manages game state for riddles:
    - Stores riddle bank (5 pre-generated riddles)
    - Tracks current riddle index
    - Tracks retry attempts (max 2 per riddle)
    - Tracks streak (consecutive correct answers)
    """

    def __init__(self):
        """Initialize game state"""
        self.reset()

    def reset(self):
        """Reset game to initial state"""
        self.riddle_bank = []          # List of {riddle: str, answer: str}
        self.current_index = 0         # Which riddle we're on (0-4)
        self.current_attempts = 0      # Attempts on current riddle (0-2)
        self.max_attempts = 2          # Max retry attempts per riddle
        self.streak = 0                # Consecutive correct answers
        self.total_riddles = 0         # Total riddles answered
        logger.info("🔄 Riddle game state reset")

    def load_riddle_bank(self, riddles: list):
        """
        Load pre-generated riddle bank

        Args:
            riddles: List of {riddle: str, answer: str}
        """
        self.riddle_bank = riddles
        self.current_index = 0
        self.current_attempts = 0
        self.streak = 0  # Reset streak for new riddle bank
        logger.info(f"📚 Loaded {len(riddles)} riddles into bank")

    def get_current_riddle(self) -> dict:
        """
        Get current riddle from bank

        Returns:
            dict: {riddle: str, answer: str} or None if bank empty
        """
        if not self.riddle_bank or self.current_index >= len(self.riddle_bank):
            return None
        return self.riddle_bank[self.current_index]

    def get_next_riddle(self) -> dict:
        """
        Get next riddle (for previewing what comes after current)

        Returns:
            dict: {riddle: str, answer: str} or None
        """
        next_index = self.current_index + 1
        if next_index >= len(self.riddle_bank):
            return None
        return self.riddle_bank[next_index]

    def validate_answer(self, user_answer: str) -> dict:
        """
        Validate user's answer against current riddle (exact string match)

        Args:
            user_answer: User's answer (string)

        Returns:
            dict: {
                'correct': bool,
                'retry': bool,
                'move_next': bool,
                'attempts_left': int,
                'correct_answer': str
            }
        """
        current_r = self.get_current_riddle()
        if not current_r:
            return {'correct': False, 'retry': False, 'move_next': False, 'error': 'No riddle available'}

        # Exact string match (case-insensitive, strip whitespace)
        user_normalized = user_answer.lower().strip()
        correct_normalized = current_r['answer'].lower().strip()
        is_correct = user_normalized == correct_normalized

        if is_correct:
            # Correct answer
            self.streak += 1
            self.total_riddles += 1
            self.current_index += 1
            self.current_attempts = 0
            return {
                'correct': True,
                'retry': False,
                'move_next': True,
                'attempts_left': 0,
                'correct_answer': current_r['answer']
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
                    'correct_answer': current_r['answer']
                }
            else:
                # Max attempts reached, move to next
                self.total_riddles += 1
                self.current_index += 1
                self.current_attempts = 0
                return {
                    'correct': False,
                    'retry': False,
                    'move_next': True,
                    'attempts_left': 0,
                    'correct_answer': current_r['answer']
                }

    def needs_new_bank(self) -> bool:
        """Check if we need to generate new riddle bank"""
        return not self.riddle_bank or self.current_index >= len(self.riddle_bank)

    def is_game_complete(self) -> bool:
        """
        Check if game is complete (5 correct in a row)

        Returns:
            bool: True if streak reached 5
        """
        return self.streak >= 5

    def get_state(self) -> dict:
        """
        Get current game state

        Returns:
            dict: Current game state information
        """
        current_r = self.get_current_riddle()
        return {
            'streak': self.streak,
            'current_index': self.current_index,
            'current_attempts': self.current_attempts,
            'max_attempts': self.max_attempts,
            'total_riddles': self.total_riddles,
            'riddle_bank_size': len(self.riddle_bank),
            'current_riddle': current_r['riddle'] if current_r else None,
            'needs_new_bank': self.needs_new_bank(),
            'game_complete': self.is_game_complete()
        }
