"""
Word Ladder Game module for Cheeko AI Assistant
Includes WordLadderGameState class and related function tools
Extracted from main_agent.py for better modularity
"""

import logging
import random

logger = logging.getLogger("word_ladder_game")

# Word list for Word Ladder game (100 simple, kid-friendly words)
WORD_LIST = [
    "cat", "dog", "sun", "moon", "tree", "book", "fish", "bird",
    "cold", "warm", "fast", "slow", "jump", "run", "play", "toy",
    "red", "blue", "big", "small", "hot", "ice", "rain", "snow",
    "cup", "pen", "box", "car", "bus", "road", "door", "room",
    "hand", "foot", "head", "leg", "arm", "nose", "eye", "ear",
    "day", "night", "star", "sky", "hill", "lake", "sand", "rock",
    "frog", "duck", "lion", "bear", "wolf", "fox", "owl", "bee",
    "ball", "kite", "game", "fun", "sing", "dance", "clap", "wave",
    "coin", "ring", "lamp", "desk", "chair", "bed", "wall", "roof",
    "wind", "leaf", "stem", "seed", "root", "bark", "twig", "vine",
    "gold", "silk", "wool", "wood", "iron", "rope", "tile", "mesh",
    "path", "gate", "step", "yard", "pond", "well", "nest", "cave",
    "tent", "flag", "drum", "horn"
]


class WordLadderGameState:
    """
    Helper class to track Word Ladder game state

    Manages game state for Word Ladder:
    - Tracks current word, target word, and word history
    - Validates letter matching
    - Manages failure count
    """

    def __init__(self):
        """Initialize game state"""
        self.reset()

    def reset(self, start_word: str = None, target_word: str = None):
        """
        Reset game state with new words

        Args:
            start_word: Starting word for the game
            target_word: Target word to reach
        """
        self.start_word = start_word
        self.target_word = target_word
        self.current_word = start_word
        self.word_history = [start_word] if start_word else []
        self.failure_count = 0
        self.max_failures = 3
        logger.info(f"🔄 Word Ladder state reset: {start_word} → {target_word}")

    def validate_letter_match(self, user_word: str) -> tuple:
        """
        Check if user's word starts with last letter of current word

        Args:
            user_word: The word provided by user

        Returns:
            tuple: (is_valid: bool, error_message: str)
        """
        if not user_word or len(user_word) < 2:
            return False, "Word too short or empty"

        last_letter = self.current_word[-1].lower()
        first_letter = user_word[0].lower()

        if last_letter != first_letter:
            return False, f"Must start with '{last_letter}'"

        return True, ""

    def check_victory(self, user_word: str) -> bool:
        """
        Check if user reached target word

        Args:
            user_word: The word to check

        Returns:
            bool: True if user reached target
        """
        return user_word.lower() == self.target_word.lower()

    def add_valid_move(self, user_word: str):
        """
        Update state after valid move

        Args:
            user_word: The valid word to add
        """
        self.current_word = user_word.lower()
        self.word_history.append(self.current_word)
        self.failure_count = 0  # Reset failures on valid move
        logger.info(f"✅ Valid move added: {self.current_word}")

    def increment_failure(self) -> bool:
        """
        Increment failure count

        Returns:
            bool: True if max failures reached
        """
        self.failure_count += 1
        max_reached = self.failure_count >= self.max_failures
        if max_reached:
            logger.warning(f"⚠️ Max failures reached: {self.failure_count}/{self.max_failures}")
        return max_reached

    def get_next_letter(self) -> str:
        """
        Get the letter the next word must start with

        Returns:
            str: The next required starting letter
        """
        return self.current_word[-1].lower() if self.current_word else ''

    def get_state(self) -> dict:
        """
        Get current game state

        Returns:
            dict: Current game state information
        """
        return {
            'start_word': self.start_word,
            'target_word': self.target_word,
            'current_word': self.current_word,
            'word_history': self.word_history.copy(),
            'failure_count': self.failure_count,
            'max_failures': self.max_failures,
            'words_used': len(self.word_history),
            'next_letter': self.get_next_letter()
        }


def pick_valid_word_pair():
    """
    Pick two random words from WORD_LIST ensuring:
    - Words are different
    - Last letter of word1 ≠ first letter of word2 (to create a puzzle)

    Returns:
        tuple: (start_word, target_word)
    """
    while True:
        word1 = random.choice(WORD_LIST)
        word2 = random.choice(WORD_LIST)

        # Ensure words are different
        if word1 == word2:
            continue

        # CRITICAL: Ensure last letter ≠ first letter (creates puzzle)
        if word1[-1].lower() != word2[0].lower():
            logger.info(f"🎮 Generated word pair: {word1} → {word2}")
            return word1, word2
