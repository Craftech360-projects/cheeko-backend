import logging
import json
import requests
import xml.etree.ElementTree as ET
from datetime import datetime
from typing import Optional, Dict, Any
import pytz
import random
import inspect
import asyncio
import os
from pathlib import Path
from livekit.agents import (
    Agent,
    RunContext,
    function_tool,
)
from .filtered_agent import FilteredAgent
from src.utils.database_helper import DatabaseHelper
from src.services.google_search_service import GoogleSearchService
logger = logging.getLogger("agent")

# Mode name aliases for handling transcript variations
# Keys must match EXACT database mode names
MODE_ALIASES = {
    "Cheeko": [
        "chiko", "chico", "cheeko", "cheek o", "checo", "cheako",
        "default", "default mode", "normal", "normal mode", "regular", "regular mode"
    ],
    "Math Tutor": [
        "math tutor", "math", "maths", "math mode", "maths mode",
        "tutor", "tutor mode", "math teacher", "maths teacher",
        "study", "study mode", "learning", "learn", "teach", "teaching",
        "mathematics", "numbers", "calculation", "calculate"
    ],
    "Riddle Solver": [
        "riddle solver", "riddle", "riddles", "riddle mode",
        "puzzle", "puzzles", "puzzle mode", "brain teaser", "brain teasers",
        "quiz", "quiz mode", "guessing", "guess", "riddle game"
    ],
    "Word Ladder": [
        "word ladder", "word game", "word", "words", "word mode",
        "ladder", "ladder game", "spelling", "spelling game",
        "vocabulary", "vocab", "word chain", "word play"
    ],
}

def normalize_mode_name(mode_input: str) -> str:
    """
    Normalize mode name input to handle transcript variations

    Args:
        mode_input: Raw mode name from speech transcript

    Returns:
        Normalized canonical mode name or original input if no match
    """
    if not mode_input:
        return mode_input

    # Normalize: lowercase, strip whitespace, remove special chars
    normalized = mode_input.lower().strip()
    normalized = normalized.replace("-", " ").replace("_", " ")

    # Direct match first (case-insensitive comparison with canonical names)
    for canonical_name in MODE_ALIASES.keys():
        if normalized == canonical_name.lower():
            return canonical_name

    # Check aliases
    for canonical_name, aliases in MODE_ALIASES.items():
        if normalized in [alias.lower() for alias in aliases]:
            logger.info(f"🔍 Matched '{mode_input}' → '{canonical_name}' via alias")
            return canonical_name

    # Check if input matches canonical name when spaces are removed
    # (e.g., "music maestro" -> "musicmaestro" -> "MusicMaestro")
    normalized_no_space = normalized.replace(" ", "")
    for canonical_name in MODE_ALIASES.keys():
        if normalized_no_space == canonical_name.lower():
            logger.info(f"🔍 Matched '{mode_input}' → '{canonical_name}' via space removal")
            return canonical_name

    # No match found - return original for backend to handle
    logger.warning(f"⚠️ No alias match found for '{mode_input}', passing as-is")
    return mode_input


class MathGameState:
    """
    Helper class to track math game state (like TicTacToeBoard structure).

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
        Check if game is complete (3 correct in a row).

        Returns:
            bool: True if streak reached 3
        """
        return self.streak >= 3

    def get_state(self) -> dict:
        """
        Get current game state.

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


class RiddleGameState:
    """
    Helper class to track riddle game state (same structure as MathGameState).

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
        Check if game is complete (3 correct in a row).

        Returns:
            bool: True if streak reached 3
        """
        return self.streak >= 3

    def get_state(self) -> dict:
        """
        Get current game state.

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


class WordLadderGameState:
    """
    Helper class to track Word Ladder game state (like MathGameState structure).

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


class Assistant(FilteredAgent):
    """Main AI Assistant agent class with TTS text filtering"""

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

    # Audio directory path (relative to project root)
    AUDIO_DIR = Path(__file__).parent.parent.parent / "audio"

    def __init__(self, instructions: str = None, tts_provider=None, llm=None) -> None:
        # Use provided instructions or fallback to a basic prompt
        if instructions is None:
            instructions = "You are a helpful AI assistant."

         # Word Ladder game state (using clean WordLadderGameState structure)
        self.word_ladder_state = WordLadderGameState()
        # Pick random word pair for the game
        start, target = self._pick_valid_word_pair()
        self.word_ladder_state.reset(start, target)
        # Keep old variables for backward compatibility with prompts
        self.start_word = start
        self.target_word = target
        self.current_word = start
        self.word_history = [start]
        self.failure_count = 0
        self.max_failures = 3
        logger.info(f"🎮 Word Ladder initialized: {start} → {target}")

        # Math Tutor game state (using clean MathGameState structure)
        self.math_game_state = MathGameState()
        # Keep old variables for backward compatibility with prompts
        self.current_riddle = ""
        self.current_answer = None
        self.correct_streak = 0
        logger.info(f"🧮 Math Tutor initialized with MathGameState")

        # Riddle Solver game state (using clean RiddleGameState structure)
        self.riddle_game_state = RiddleGameState()
        logger.info(f"🤔 Riddle Solver initialized with RiddleGameState")

        # Store original instructions template for later re-formatting
        self._original_instructions = instructions

        # Format the prompt with actual game state values
        formatted_instructions = self._format_instructions(instructions)

        # Store LLM reference for later use
        self._llm = llm

        # Pass LLM to parent constructor - this enables function tools with Realtime models
        super().__init__(instructions=formatted_instructions, tts_provider=tts_provider, llm=llm)
        # These will be injected by main.py
        self.music_service = None
        self.story_service = None
        self.audio_player = None
        self.unified_audio_player = None
        self.device_control_service = None
        self.mcp_executor = None
        self.google_search_service = None
        self.praison_math_service = None

        # Room and device information
        self.room_name = None
        self.device_mac = None

        # Session reference for dynamic updates
        self._agent_session = None

        # Log registered function tools (for debugging)
        logger.info("🔧 Assistant initialized, checking function tools...")
        try:
            # Log check_battery_level function signature specifically
            if hasattr(self, 'check_battery_level'):
                battery_func = getattr(self, 'check_battery_level')
                sig = inspect.signature(battery_func)
                logger.info(f"🔋 check_battery_level signature: {sig}")
                logger.info(f"🔋 check_battery_level parameters: {sig.parameters}")
                for param_name, param in sig.parameters.items():
                    if param_name not in ['self', 'context']:
                        logger.info(f"🔋   - {param_name}: default={param.default}, annotation={param.annotation}")
                logger.info(f"🔋 check_battery_level return annotation: {sig.return_annotation}")
                logger.info(f"🔋 check_battery_level docstring: {battery_func.__doc__}")

            # Try to access function tools from the agent's internal attributes
            if hasattr(self, '_function_tools'):
                logger.info(f"🔧 Found {len(self._function_tools)} function tools")
                for tool_name, tool in self._function_tools.items():
                    logger.info(f"🔧   - {tool_name}: {tool}")
                    if tool_name == 'check_battery_level':
                        logger.info(f"🔋 DETAILED check_battery_level tool info: {dir(tool)}")
                        if hasattr(tool, 'schema'):
                            logger.info(f"🔋 check_battery_level schema: {tool.schema}")
                        if hasattr(tool, 'parameters'):
                            logger.info(f"🔋 check_battery_level parameters: {tool.parameters}")
            else:
                logger.info("🔧 No _function_tools attribute found")
        except Exception as e:
            logger.warning(f"🔧 Error inspecting function tools: {e}")
            import traceback
            logger.warning(f"🔧 Traceback: {traceback.format_exc()}")

    def _format_instructions(self, prompt: str) -> str:
        """
        Internal method to format prompt by replacing game state placeholders with actual values.

        Replaces:
        - {self.start_word} with actual start_word
        - {self.target_word} with actual target_word
        - {self.current_word} with actual current_word
        - {self.failure_count} with actual failure_count
        - {self.max_failures} with actual max_failures

        Args:
            prompt: The prompt string with placeholders

        Returns:
            Formatted prompt with actual game state values
        """
        try:
            # Use string.Template for safer partial replacement
            # This allows us to replace {self.xxx} without requiring other placeholders
            import re

            # Replace {self.xxx} patterns manually to avoid KeyError from format()
            def replace_self_placeholders(match):
                attr_name = match.group(1)
                try:
                    value = getattr(self, attr_name)
                    return str(value)
                except AttributeError:
                    logger.warning(f"⚠️ Attribute not found: self.{attr_name}")
                    return match.group(0)  # Keep original if attribute doesn't exist

            # Pattern to match {self.attribute_name}
            pattern = r'\{self\.([a-zA-Z_][a-zA-Z0-9_]*)\}'
            formatted_prompt = re.sub(pattern, replace_self_placeholders, prompt)

            logger.info(f"📝 Formatted prompt with game state: start_word={self.start_word}, target_word={self.target_word}, failure_count={self.failure_count}/{self.max_failures}")

            # DEBUG: Log a sample of the formatted prompt to verify placeholders are replaced
            if "{self.start_word}" in formatted_prompt or "{self.target_word}" in formatted_prompt:
                logger.error(f"❌ PLACEHOLDERS NOT REPLACED! Sample: {formatted_prompt[:500]}")
            else:
                logger.info(f"✅ Placeholders successfully replaced. Sample: {formatted_prompt[300:500]}")

            return formatted_prompt
        except Exception as e:
            logger.error(f"❌ Error formatting prompt: {e}")
            import traceback
            logger.error(f"Traceback: {traceback.format_exc()}")
            return prompt

    async def update_prompt_with_game_state(self):
        """
        Update the agent's instructions with current game state values.
        Call this method whenever game state changes (start_word, target_word, failure_count).
        """
        try:
            # Get the original prompt (unformatted) from _instructions
            # Since we need the original template, we'll store it
            if not hasattr(self, '_original_instructions'):
                logger.warning("⚠️ No original instructions template available for formatting")
                return

            # Format with current game state
            formatted_prompt = self._format_instructions(self._original_instructions)

            # Update agent's instructions
            self._instructions = formatted_prompt

            # Update session if available (for immediate effect)
            if self._agent_session:
                try:
                    # Update session's agent internal instructions
                    self._agent_session._agent._instructions = formatted_prompt

                    # Also update session chat context if possible
                    if hasattr(self._agent_session, 'history') and hasattr(self._agent_session.history, 'messages'):
                        # Update the system message in history
                        if len(self._agent_session.history.messages) > 0:
                            if hasattr(self._agent_session.history.messages[0], 'content'):
                                self._agent_session.history.messages[0].content = formatted_prompt
                                logger.info(f"🔄 Session chat context updated with new game state!")

                    logger.info(f"🔄 Session instructions updated with game state in real-time!")
                except Exception as e:
                    logger.warning(f"⚠️ Could not update session directly: {e}")

        except Exception as e:
            logger.error(f"❌ Error updating prompt with game state: {e}")
            import traceback
            logger.error(f"Traceback: {traceback.format_exc()}")



    def set_services(self, music_service, story_service, audio_player, unified_audio_player=None, device_control_service=None, mcp_executor=None, google_search_service=None, question_generator_service=None, riddle_generator_service=None, analytics_service=None):
        """Set the music, story, device control services, MCP executor, Google Search service, Question Generator service, Riddle Generator service, and Analytics service"""
        self.music_service = music_service
        self.story_service = story_service
        self.audio_player = audio_player
        self.unified_audio_player = unified_audio_player
        self.device_control_service = device_control_service
        self.mcp_executor = mcp_executor
        self.google_search_service = google_search_service
        self.question_generator_service = question_generator_service
        self.riddle_generator_service = riddle_generator_service
        self.analytics_service = analytics_service

    def set_room_info(self, room_name: str = None, device_mac: str = None):
        """Set room name and device MAC address"""
        self.room_name = room_name
        self.device_mac = device_mac
        logger.info(f"📍 Room info set - Room: {room_name}, MAC: {device_mac}")

    def set_agent_session(self, session):
        """Set session reference for dynamic updates"""
        self._agent_session = session
        logger.info(f"🔗 Session reference stored for dynamic updates")

    def _pick_valid_word_pair(self):
        """
        Pick two random words from WORD_LIST ensuring:
        - Words are different
        - Last letter of word1 ≠ first letter of word2 (to create a puzzle)

        Returns:
            tuple: (start_word, target_word)
        """
        while True:
            word1 = random.choice(self.WORD_LIST)
            word2 = random.choice(self.WORD_LIST)

            # Ensure words are different
            if word1 == word2:
                continue

            # CRITICAL: Ensure last letter ≠ first letter (creates puzzle)
            if word1[-1].lower() != word2[0].lower():
                logger.info(f"🎮 Generated word pair: {word1} → {word2}")
                return word1, word2

    @function_tool
    async def update_agent_mode(self, context: RunContext, mode_name: str) -> str:
        """Update agent configuration mode by applying a template

        Args:
            mode_name: Template mode name (e.g., "Cheeko", "StudyHelper")

        Returns:
            Success or error message
        """
        try:
            import os
            import aiohttp
            from src.services.prompt_service import PromptService

            # 1. Validate device MAC
            if not self.device_mac:
                return "Device MAC address is not available"

            # 2. Get Manager API configuration
            manager_api_url = os.getenv("MANAGER_API_URL")
            manager_api_secret = os.getenv("MANAGER_API_SECRET")

            if not manager_api_url or not manager_api_secret:
                return "Manager API is not configured"

            # 3. Fetch agent_id using DatabaseHelper
            db_helper = DatabaseHelper(manager_api_url, manager_api_secret)
            agent_id = await db_helper.get_agent_id(self.device_mac)

            if not agent_id:
                return f"No agent found for device MAC: {self.device_mac}"

            # Normalize mode name to handle transcript variations
            normalized_mode = normalize_mode_name(mode_name)
            if normalized_mode != mode_name:
                logger.info(f"🔄 Mode name normalized: '{mode_name}' → '{normalized_mode}'")

            logger.info(f"🔄 Updating agent {agent_id} to mode: {normalized_mode}")

            # 4. Call update-mode API (updates template_id in database)
            url = f"{manager_api_url}/agent/update-mode"
            headers = {
                "Authorization": f"Bearer {manager_api_secret}",
                "Content-Type": "application/json"
            }
            payload = {
                "agentId": agent_id,
                "modeName": normalized_mode
            }

            timeout = aiohttp.ClientTimeout(total=10)
            async with aiohttp.ClientSession(timeout=timeout) as session:
                async with session.put(url, json=payload, headers=headers) as response:
                    if response.status == 200:
                        result = await response.json()
                        logger.info(f"✅ Agent mode updated in database to '{normalized_mode}' for agent: {agent_id}")

                        # 5. Get prompt from API response
                        logger.info("📄 Using prompt from API response")
                        if result.get('code') == 0 and result.get('data'):
                            new_prompt = result.get('data')
                            logger.info(f"📄 Retrieved prompt from API (length: {len(new_prompt)} chars)")

                            # Log the new prompt content for debugging
                            logger.info(f"🎭 ========== CHARACTER SWITCH: {normalized_mode} ==========")
                            logger.info(f"🎭 NEW PROMPT PREVIEW (first 500 chars):")
                            logger.info(f"🎭 {new_prompt[:500]}...")
                            logger.info(f"🎭 =================================================")
                        else:
                            logger.warning(f"⚠️ No prompt data in response")
                            return f"Mode updated to '{normalized_mode}' in database. Please reconnect to apply changes."

                        # 7. Inject memory into new prompt (if available)
                        try:
                            if self._agent_session and hasattr(self._agent_session, '_memory_provider'):
                                memory_provider = self._agent_session._memory_provider
                                if memory_provider:
                                    memories = await memory_provider.query_memory("conversation history")
                                    if memories:
                                        new_prompt = new_prompt.replace("<memory>", f"<memory>\n{memories}")
                                        logger.info(f"💭 Injected memories into new prompt ({len(memories)} chars)")
                        except Exception as e:
                            logger.warning(f"Could not inject memories: {e}")

                        # 8. Update the agent's instructions dynamically
                        self._instructions = new_prompt
                        logger.info(f"📝 Instructions updated dynamically (length: {len(new_prompt)} chars)")

                        # 9. Update session if available (for immediate effect)
                        # For Gemini Realtime, we need to use the AgentActivity.update_instructions method
                        # which properly updates the realtime session via _rt_session.update_instructions()
                        if self._agent_session:
                            try:
                                # Access the AgentActivity from the session
                                # AgentSession has _activity which is an AgentActivity instance
                                activity = getattr(self._agent_session, '_activity', None)
                                if activity is not None:
                                    # AgentActivity.update_instructions() handles Realtime sessions properly
                                    await activity.update_instructions(new_prompt)
                                    logger.info(f"🔄 Session instructions updated via AgentActivity.update_instructions()!")
                                    logger.info(f"🎭 ✅ CHARACTER SWITCH COMPLETE: Now acting as '{normalized_mode}'")
                                else:
                                    # Fallback: update agent instructions directly
                                    self._agent_session._agent._instructions = new_prompt
                                    logger.info(f"🔄 Fallback: Updated agent instructions directly (no activity)")
                            except Exception as e:
                                logger.warning(f"⚠️ Could not update session via activity: {e}")
                                import traceback
                                logger.warning(f"⚠️ Traceback: {traceback.format_exc()}")
                                # Fallback: try direct update
                                try:
                                    self._agent_session._agent._instructions = new_prompt
                                    logger.info(f"🔄 Fallback: Updated agent instructions directly")
                                except Exception as e2:
                                    logger.warning(f"⚠️ Fallback also failed: {e2}")

                        logger.info(f"🎭 ========== CHARACTER '{normalized_mode}' ACTIVE ==========")
                        return f"Successfully updated agent mode to '{normalized_mode}' and reloaded the new prompt! The changes are now active in this conversation."

                    else:
                        error_text = await response.text()
                        logger.error(f"❌ Failed to update mode: {response.status} - {error_text}")
                        return f"Failed to update mode: {error_text}"

        except aiohttp.ClientError as e:
            logger.error(f"Network error updating agent mode: {e}")
            return f"Network error: Unable to connect to server"
        except Exception as e:
            logger.error(f"Error updating agent mode: {e}")
            import traceback
            logger.error(f"Traceback: {traceback.format_exc()}")
            return f"Error updating agent mode: {str(e)}"

    @function_tool
    async def lookup_weather(self, context: RunContext, location: str):
        """Look up weather information for a specific location"""
        logger.info(f"Looking up weather for {location}")
        return "sunny with a temperature of 70 degrees."

    # @function_tool  # DISABLED: Using native Gemini Google Search grounding instead
    async def search_wikipedia(
        self,
        context: RunContext,
        query: str
    ) -> str:
        """Search Wikipedia for current information and events after January 2025

        ⚠️ CRITICAL DECISION RULES - Read carefully and follow exactly:

        ═══════════════════════════════════════════════════════════════════
        🟡 FIRST CHECK: CONFIDENCE & ACCURACY
        ═══════════════════════════════════════════════════════════════════

        🚨 CRITICAL RULE: If you are NOT 100% CONFIDENT about factual information,
        USE WIKIPEDIA to verify! It's BETTER to search than give WRONG information!

        ⚠️ ALWAYS USE WIKIPEDIA if:
        1. You're uncertain about specific facts (scores, winners, dates, names)
        2. The query asks for precise data (scorecards, statistics, results)
        3. You're not confident in your answer
        4. The information could have multiple versions or interpretations

        Examples where you SHOULD use Wikipedia even for old events:
        ✅ "Who won 2021 IPL?" → If unsure, USE WIKIPEDIA (verify the winner!)
        ✅ "2008 cricket scorecard" → If unsure about exact scores, USE WIKIPEDIA
        ✅ "2019 election results" → If unsure about exact numbers, USE WIKIPEDIA
        ✅ "List of IPL winners" → USE WIKIPEDIA (precise list needed!)

        💡 RULE OF THUMB:
        - Factual queries requiring 100% accuracy → USE WIKIPEDIA to verify
        - Uncertain or could be wrong → USE WIKIPEDIA to verify
        - Confident and simple fact → Answer directly

        ═══════════════════════════════════════════════════════════════════
        🟡 SECOND CHECK: HISTORICAL vs CURRENT QUERY
        ═══════════════════════════════════════════════════════════════════

        ❌ ONLY skip Wikipedia if you are COMPLETELY CONFIDENT about historical data:
           - Simple, well-known facts you're 100% sure about
           - General knowledge questions with clear answers
           - NOT specific statistics, scorecards, or detailed results

        ✅ USE WIKIPEDIA for 2024, 2025, or temporal keywords:
           - "2024 elections" → USE Wikipedia (recent!)
           - "2025 IPL winner" → USE Wikipedia (beyond cutoff!)
           - "Current president" → USE Wikipedia (could have changed!)
           - "Latest news" → USE Wikipedia (after your training!)

        ═══════════════════════════════════════════════════════════════════
        🔴 MANDATORY WIKIPEDIA SEARCH (You MUST use this tool):
        ═══════════════════════════════════════════════════════════════════

        1. KEYWORD TRIGGERS (If query contains ANY of these words):
           ✅ "latest" → ALWAYS use Wikipedia (NO EXCEPTIONS)
           ✅ "recent" → ALWAYS use Wikipedia (NO EXCEPTIONS)
           ✅ "current" → ALWAYS use Wikipedia (NO EXCEPTIONS)
           ✅ "now" → ALWAYS use Wikipedia (NO EXCEPTIONS)
           ✅ "today" → ALWAYS use Wikipedia (NO EXCEPTIONS)
           ✅ "yesterday" → ALWAYS use Wikipedia (NO EXCEPTIONS)
           ✅ "this week/month/year" → ALWAYS use Wikipedia (NO EXCEPTIONS)
           ✅ "last week/month" → ALWAYS use Wikipedia (NO EXCEPTIONS)
           ✅ "news" → ALWAYS use Wikipedia (NO EXCEPTIONS)
           ✅ "updates" → ALWAYS use Wikipedia (NO EXCEPTIONS)
           ✅ "developments" → ALWAYS use Wikipedia (NO EXCEPTIONS)
           ✅ "happening" → ALWAYS use Wikipedia (NO EXCEPTIONS)

           ⚠️ CRITICAL EXAMPLES THAT MUST TRIGGER WIKIPEDIA:
           - "Who is the current president of America?" → USE WIKIPEDIA (current = could have changed!)
           - "What's the current population of India?" → USE WIKIPEDIA (current = needs latest data!)
           - "Who is the latest CEO of Tesla?" → USE WIKIPEDIA (latest = might have changed!)
           - "What's the recent news about SpaceX?" → USE WIKIPEDIA (recent = after your cutoff!)
           - "What's happening now in politics?" → USE WIKIPEDIA (now = beyond your knowledge!)
           - "What's the latest GDP of USA?" → USE WIKIPEDIA (latest = new data!)
           - "Who won the recent elections?" → USE WIKIPEDIA (recent = you don't know!)
           - "What's the current stock price?" → USE WIKIPEDIA (current = live data!)
           - "Tell me today's weather" → USE WIKIPEDIA (today = you don't know!)
           - "Give me yesterday's news" → USE WIKIPEDIA (yesterday = Oct 23, 2025!)

           🚨 IMPORTANT: Even if you THINK you know the answer, these keywords mean
           the information could have CHANGED after January 2025. ALWAYS use Wikipedia!

        2. ANY 2025 DATES (explicit or implicit):
           ✅ "What happened in June 2025?" → USE WIKIPEDIA
           ✅ "Tell me about 2025" → USE WIKIPEDIA
           ✅ "Events this year" (it's Oct 2025) → USE WIKIPEDIA
           ✅ "What happened last month?" (Sept 2025) → USE WIKIPEDIA
           ✅ "Yesterday's news" (Oct 23, 2025) → USE WIKIPEDIA

        3. EXPLICIT WIKIPEDIA REQUESTS:
           ✅ "Search Wikipedia for..." → USE WIKIPEDIA
           ✅ "Look up on Wikipedia..." → USE WIKIPEDIA
           ✅ "Check Wikipedia about..." → USE WIKIPEDIA

        4. STATISTICS/DATA QUERIES:
           ✅ "What's the current population of..." → USE WIKIPEDIA
           ✅ "Latest GDP of..." → USE WIKIPEDIA
           ✅ "Recent stock prices..." → USE WIKIPEDIA

        5. BIOGRAPHICAL QUERIES - PATTERN MATCHING (CRITICAL):
           🚨 ANY query matching these patterns → ALWAYS use Wikipedia FIRST:

           Pattern: "Who is [PERSON_NAME]?"
           Pattern: "Tell me about [PERSON_NAME]"
           Pattern: "What do you know about [PERSON_NAME]?"
           Pattern: "Give me information about [PERSON_NAME]"

           ✅ EXAMPLES (but NOT limited to these names):
           - "Who is Charlie Chaplin?" → USE WIKIPEDIA
           - "Who is Rohit Sharma?" → USE WIKIPEDIA
           - "Who is Elon Musk?" → USE WIKIPEDIA
           - "Tell me about Albert Einstein" → USE WIKIPEDIA
           - "Who is Narendra Modi?" → USE WIKIPEDIA
           - "Who is Taylor Swift?" → USE WIKIPEDIA
           - "What do you know about Steve Jobs?" → USE WIKIPEDIA

           🔴 IMPORTANT: These are just EXAMPLES. The rule applies to ANY person's name!
           "Who is [ANY_NAME]?" → ALWAYS search Wikipedia first!

           💡 WHY Wikipedia for people?
           - Career changes (team, company, position)
           - Recent achievements and awards
           - Current projects and activities
           - Biographical updates and life events
           - Death/retirement information (if applicable)

           Even if you think you know the person, Wikipedia has MORE CURRENT information!

        ═══════════════════════════════════════════════════════════════════
        🟢 DO NOT USE WIKIPEDIA (Only if you are 100% CONFIDENT):
        ═══════════════════════════════════════════════════════════════════

        ⚠️ IMPORTANT: Only skip Wikipedia if you are ABSOLUTELY CERTAIN!

        ❌ Simple, well-known general knowledge (if 100% confident):
           - "What is the capital of France?" → Paris (you know this!)
           - "Who invented the telephone?" → Alexander Graham Bell (you know this!)
           - "When did WW2 end?" → 1945 (you know this!)

        🟡 Historical sports/events (ONLY if 100% confident, otherwise USE WIKIPEDIA):
           - "Who won 2010 World Cup?" → Spain (if 100% sure!)
           - BUT if asking for scorecards, detailed results, statistics → USE WIKIPEDIA!
           - Better safe than sorry - when in doubt, USE WIKIPEDIA!

        ❌ Conceptual explanations:
           - "What is artificial intelligence?" → Don't use Wikipedia
           - "How does a computer work?" → Don't use Wikipedia
           - "Explain quantum physics" → Don't use Wikipedia

        ❌ Conversational/Creative:
           - "Tell me a joke" → Don't use Wikipedia
           - "How are you?" → Don't use Wikipedia
           - "I'm sad" → Don't use Wikipedia

        ═══════════════════════════════════════════════════════════════════
        ⚡ DECISION FRAMEWORK:
        ═══════════════════════════════════════════════════════════════════

        Your knowledge cutoff: January 2025
        Current date: October 2025

        📊 USE WIKIPEDIA if ANY of these are true:
        1. 🎯 NOT 100% confident in your answer
        2. 📅 Year 2024 or 2025 mentioned
        3. 🔑 Temporal keywords (current, latest, recent, now, today)
        4. 📈 Specific statistics, scorecards, or detailed results requested
        5. 👤 Biographical queries (people's current status/position)
        6. ❓ Any uncertainty about facts

        ✅ ONLY answer directly if:
        - 100% confident AND
        - Simple general knowledge AND
        - NOT asking for detailed/precise data

        💡 GOLDEN RULE: When in doubt → USE WIKIPEDIA!
        Better to verify than give wrong information!

        ═══════════════════════════════════════════════════════════════════

        Args:
            query: Topic to search (e.g., "latest AI news", "current affairs", "what happened today")

        Returns:
            Current verified information from Wikipedia with temporal context warnings
        """
        try:
            logger.info(f"📚 Wikipedia search request: '{query}'")

            # Check if search service is available
            if not self.google_search_service:
                logger.warning("⚠️ Wikipedia search requested but service not initialized")
                return "Sorry, Wikipedia search is not available right now."

            if not self.google_search_service.is_available():
                logger.warning("⚠️ Wikipedia search requested but service not configured")
                return "Sorry, Wikipedia search is not configured. Please ask the administrator to enable it."

            # Perform Wikipedia search
            search_result = await self.google_search_service.search_wikipedia(query)

            # Check if search was successful
            if not search_result.get("success"):
                error_msg = search_result.get("error", "Unknown error")
                logger.warning(f"⚠️ Wikipedia search failed: {error_msg}")

                # Instead of blocking with error, instruct LLM to use its own knowledge
                return f"WIKIPEDIA_UNAVAILABLE: {error_msg}. Please answer the question using your own knowledge base instead."

            # Format results for voice output
            voice_response = self.google_search_service.format_results_for_voice(
                search_result,
                max_items=2  # Limit to top 2 results for voice clarity
            )

            logger.info(f"✅ Wikipedia search completed for '{query}': {len(search_result.get('results', []))} results found")

            return voice_response

        except Exception as e:
            logger.error(f"❌ Error during Wikipedia search: {e}")
            import traceback
            logger.error(f"Traceback: {traceback.format_exc()}")

            # Fallback to LLM knowledge on exception
            return f"WIKIPEDIA_UNAVAILABLE: Search error occurred. Please answer the question using your own knowledge base instead."

    @function_tool
    async def play_music(
        self,
        context: RunContext,
        song_name: Optional[str] = None,
        language: Optional[str] = None
    ):
        """Play music - either a specific song or random music

        Args:
            song_name: Optional specific song to search for
            language: Optional language preference (English, Hindi, Telugu, etc.)
        """
        try:
            logger.info(f"Music request - song: '{song_name}', language: '{language}'")

            if not self.music_service:
                return "Sorry, music service is not available right now."

            # Use unified audio player which injects music into TTS queue
            player = self.unified_audio_player if self.unified_audio_player else self.audio_player
            if not player:
                return "Sorry, audio player is not available right now."

            if song_name:
                # Search for specific song
                songs = await self.music_service.search_songs(song_name, language)
                if songs:
                    song = songs[0]  # Take first match
                    logger.info(f"Found song: {song['title']} in {song['language']}")
                else:
                    logger.info(f"No songs found for '{song_name}', playing random song")
                    song = await self.music_service.get_random_song(language)
            else:
                # Play random song
                song = await self.music_service.get_random_song(language)

            if not song:
                return "Sorry, I couldn't find any music to play right now."

            # Send music start signal to device via data channel FIRST
            try:
                import json
                music_start_data = {
                    "type": "music_playback_started",
                    "title": song['title'],
                    "language": song.get('language', 'Unknown'),
                    "message": f"Now playing: {song['title']}"
                }
                # Try different ways to access the room
                room = None
                if hasattr(context, 'room'):
                    room = context.room
                elif self.unified_audio_player and self.unified_audio_player.context:
                    room = self.unified_audio_player.context.room
                elif self.audio_player and self.audio_player.context:
                    room = self.audio_player.context.room

                if room:
                    await room.local_participant.publish_data(
                        json.dumps(music_start_data).encode(),
                        topic="music_control"
                    )
                    logger.info(f"Sent music_playback_started via data channel: {song['title']}")
            except Exception as e:
                logger.warning(f"Failed to send music start signal: {e}")

            # Start playing the song through TTS channel - this will queue it
            await player.play_from_url(song['url'], song['title'])

            # Return special instruction to suppress immediate response
            # The agent should stay silent while music plays
            return "[MUSIC_PLAYING - STAY_SILENT]"

        except Exception as e:
            logger.error(f"Error playing music: {e}")
            return "Sorry, I encountered an error while trying to play music."

    def _extract_and_solve_math(self, question: str) -> Optional[float]:
        """
        Universal math expression extractor and solver.
        Converts natural language questions to mathematical expressions and solves them.

        Args:
            question: Natural language math question

        Returns:
            The numerical answer, or None if cannot be solved
        """
        try:
            import sympy
            import re

            # Normalize the question
            q = question.lower().strip()

            # Step 1: Convert word operators to symbols
            replacements = {
                ' plus ': '+', ' add ': '+', ' and ': '+',
                ' minus ': '-', ' subtract ': '-', ' take away ': '-',
                ' times ': '*', ' multiply ': '*', ' multiplied by ': '*',
                ' divided by ': '/', ' divide ': '/', ' over ': '/',
                ' percent of ': '*0.01*',
                ' squared ': '**2', ' cubed ': '**3',
                'square root of ': 'sqrt(',
            }

            for word, symbol in replacements.items():
                q = q.replace(word, symbol)

            # Handle special patterns
            # "How many more than X is Y?" → Y - X
            more_pattern = r'how\s+many\s+more\s+than\s+(\d+\.?\d*)\s+is\s+(\d+\.?\d*)'
            match = re.search(more_pattern, q)
            if match:
                return float(match.group(2)) - float(match.group(1))

            # "How much is X more than Y?" → Y + X
            more_than = r'how\s+much\s+is\s+(\d+\.?\d*)\s+more\s+than\s+(\d+\.?\d*)'
            match = re.search(more_than, q)
            if match:
                return float(match.group(2)) + float(match.group(1))

            # Step 2: Extract mathematical expression (numbers and operators)
            # Check for squared/cubed first
            squared_pattern = r'(\d+\.?\d*)\s*\*\*2'
            match = re.search(squared_pattern, q)
            if match:
                num = float(match.group(1))
                return num ** 2

            cubed_pattern = r'(\d+\.?\d*)\s*\*\*3'
            match = re.search(cubed_pattern, q)
            if match:
                num = float(match.group(1))
                return num ** 3

            # Find all numbers and operators
            expr_pattern = r'[\d\.]+[\s\+\-\*/\^×÷\(\)]+[\d\.\s\+\-\*/\^×÷\(\)]*[\d\.]+'
            match = re.search(expr_pattern, q)

            if match:
                expression = match.group(0)
            else:
                # Try to find just a simple number operation
                simple_pattern = r'(\d+\.?\d*)\s*[\+\-\*/×÷]\s*(\d+\.?\d*)'
                match = re.search(simple_pattern, q)
                if match:
                    expression = match.group(0)
                else:
                    logger.warning(f"Could not extract math expression from: {q}")
                    return None

            # Step 3: Clean and normalize expression
            expression = expression.replace('×', '*').replace('÷', '/').replace('^', '**')

            # Handle square root if not already handled
            if 'sqrt(' in q and ')' not in expression:
                expression = expression + ')'

            # Step 4: Solve using sympy (safe evaluation)
            logger.debug(f"Extracted expression: {expression}")
            result = sympy.sympify(expression)
            answer = float(result.evalf())

            logger.info(f"✅ Solved: {expression} = {answer}")
            return answer

        except Exception as e:
            logger.warning(f"⚠️ Error solving math expression: {e}")
            return None

    def _parse_user_answer(self, answer: str) -> Optional[float]:
        """
        Parse user's answer (handles both numeric and word forms)

        Args:
            answer: User's answer as string

        Returns:
            Numeric value, or None if cannot parse
        """
        try:
            # Try direct number conversion
            return float(answer.strip())
        except ValueError:
            pass

        # Normalize the answer
        answer_lower = answer.lower().strip()

        # Try simple word-to-number conversion
        word_to_num = {
            'zero': 0, 'one': 1, 'two': 2, 'three': 3, 'four': 4,
            'five': 5, 'six': 6, 'seven': 7, 'eight': 8, 'nine': 9,
            'ten': 10, 'eleven': 11, 'twelve': 12, 'thirteen': 13,
            'fourteen': 14, 'fifteen': 15, 'sixteen': 16, 'seventeen': 17,
            'eighteen': 18, 'nineteen': 19, 'twenty': 20,
            'thirty': 30, 'forty': 40, 'fifty': 50, 'sixty': 60,
            'seventy': 70, 'eighty': 80, 'ninety': 90, 'hundred': 100
        }

        # Check if it's a single word number
        if answer_lower in word_to_num:
            return word_to_num[answer_lower]

        # Handle compound numbers like "fifty four", "twenty one", etc.
        # Split by space and try to combine
        words = answer_lower.split()
        if len(words) == 2:
            # Check if both words are valid numbers
            if words[0] in word_to_num and words[1] in word_to_num:
                # Handle cases like "fifty four" = 50 + 4 = 54
                tens = word_to_num[words[0]]
                ones = word_to_num[words[1]]

                # Only combine if first word is a tens value (20, 30, 40, etc.)
                if tens >= 20 and tens % 10 == 0 and ones < 10:
                    return tens + ones
                # Handle "X hundred Y" like "one hundred five" = 105
                elif words[0] in word_to_num and words[1] == 'hundred':
                    return word_to_num[words[0]] * 100
        elif len(words) == 3:
            # Handle "X hundred Y" like "two hundred fifty"
            if words[1] == 'hundred' and words[0] in word_to_num and words[2] in word_to_num:
                return word_to_num[words[0]] * 100 + word_to_num[words[2]]
        elif len(words) == 4:
            # Handle "X hundred Y Z" like "two hundred fifty four"
            if words[1] == 'hundred' and words[0] in word_to_num and words[2] in word_to_num and words[3] in word_to_num:
                hundreds = word_to_num[words[0]] * 100
                tens = word_to_num[words[2]]
                ones = word_to_num[words[3]]
                if tens >= 20 and tens % 10 == 0 and ones < 10:
                    return hundreds + tens + ones

        # Handle comparison question responses like "three plus four is bigger"
        # or "seven minus two" or "5 + 3"
        try:
            # Remove common phrases
            for phrase in ['is bigger', 'is smaller', 'is larger', 'is less', 'is greater',
                          'is the answer', 'is correct', 'that is', 'equals', '=']:
                answer_lower = answer_lower.replace(phrase, '')

            answer_lower = answer_lower.strip()

            # Convert word numbers to digits
            for word, num in word_to_num.items():
                answer_lower = answer_lower.replace(word, str(num))

            # Convert word operators to symbols
            replacements = {
                ' plus ': '+', ' add ': '+',
                ' minus ': '-', ' subtract ': '-',
                ' times ': '*', ' multiply by ': '*', ' multiplied by ': '*',
                ' divided by ': '/', ' divide ': '/',
            }

            for word, symbol in replacements.items():
                answer_lower = answer_lower.replace(word, symbol)

            # Extract expression with numbers and operators
            import re
            expression = re.findall(r'[\d+\-*/\.\s()]+', answer_lower)

            if expression:
                expr_str = ''.join(expression).strip()
                if expr_str:
                    # Evaluate the expression
                    import sympy
                    result = sympy.sympify(expr_str)
                    return float(result.evalf())

        except Exception as e:
            logger.debug(f"Could not parse as expression: {answer} - {e}")
            pass

        return None

    @function_tool
    async def generate_question_bank(
        self,
        context: RunContext,
        count: int = 5,
        difficulty: str = "easy"
    ):
        """
        Generate a bank of math questions for the game.

        Call this when:
        - Starting a new math game session
        - Running out of questions (question bank empty)

        Args:
            count: Number of questions to generate (default 5)
            difficulty: "easy", "medium", or "hard"

        Returns:
            dict: Status and generated questions
        """
        try:
            logger.info(f"🎲 Generating {count} {difficulty} questions...")

            # Check if question generator service is available
            if hasattr(self, 'question_generator_service') and self.question_generator_service and self.question_generator_service.is_available():
                result = await self.question_generator_service.generate_question_bank(count, difficulty)

                if result['success'] and result['questions']:
                    # Load questions into MathGameState
                    self.math_game_state.load_question_bank(result['questions'])

                    logger.info(f"✅ Loaded {len(result['questions'])} questions into game state")

                    return {
                        'success': True,
                        'count': len(result['questions']),
                        'first_question': result['questions'][0]['question'] if result['questions'] else None,
                        'message': f"Generated {len(result['questions'])} new questions. Let's start!"
                    }
                else:
                    logger.warning(f"⚠️ Question generation failed: {result.get('error')}")
                    return {
                        'success': False,
                        'count': 0,
                        'message': f"Could not generate questions. Error: {result.get('error')}"
                    }
            else:
                logger.warning("⚠️ Question generator service not available")
                return {
                    'success': False,
                    'count': 0,
                    'message': "Question generator service not available"
                }

        except Exception as e:
            logger.error(f"❌ Error in generate_question_bank: {e}")
            import traceback
            logger.error(f"Traceback: {traceback.format_exc()}")
            return {
                'success': False,
                'count': 0,
                'message': f"Error generating questions: {str(e)}"
            }

    @function_tool
    async def generate_riddle_bank(
        self,
        context: RunContext,
        count: int = 5,
        difficulty: str = "easy"
    ):
        """
        Generate a bank of riddles for the game.

        Call this when:
        - Starting a new riddle game session
        - Running out of riddles (riddle bank empty)

        Args:
            count: Number of riddles to generate (default 5)
            difficulty: "easy", "medium", or "hard"

        Returns:
            dict: Status and generated riddles
        """
        try:
            logger.info(f"🤔 Generating {count} {difficulty} riddles...")

            # Check if riddle generator service is available
            if hasattr(self, 'riddle_generator_service') and self.riddle_generator_service and self.riddle_generator_service.is_available():
                result = await self.riddle_generator_service.generate_riddle_bank(count, difficulty)

                if result['success'] and result['riddles']:
                    # Load riddles into RiddleGameState
                    self.riddle_game_state.load_riddle_bank(result['riddles'])

                    logger.info(f"✅ Loaded {len(result['riddles'])} riddles into game state")

                    return {
                        'success': True,
                        'count': len(result['riddles']),
                        'first_riddle': result['riddles'][0]['riddle'] if result['riddles'] else None,
                        'message': f"Generated {len(result['riddles'])} new riddles. Let's start!"
                    }
                else:
                    logger.warning(f"⚠️ Riddle generation failed: {result.get('error')}")
                    return {
                        'success': False,
                        'count': 0,
                        'message': f"Could not generate riddles. Error: {result.get('error')}"
                    }
            else:
                logger.warning("⚠️ Riddle generator service not available")
                return {
                    'success': False,
                    'count': 0,
                    'message': "Riddle generator service not available"
                }

        except Exception as e:
            logger.error(f"❌ Error in generate_riddle_bank: {e}")
            import traceback
            logger.error(f"Traceback: {traceback.format_exc()}")
            return {
                'success': False,
                'count': 0,
                'message': f"Error generating riddles: {str(e)}"
            }

    @function_tool
    async def check_math_answer(
        self,
        context: RunContext,
        user_answer: str
    ):
        """
        Validate math answer using pre-generated question bank with retry logic.

        Flow:
        1. Parse user's answer (handles any format: "8", "eight", etc.)
        2. Compare with answer from question bank
        3. Handle retry logic (2 attempts per question)
        4. Update MathGameState (streak, index, attempts)
        5. Return clear result with retry/move_next flags

        Args:
            user_answer: User's answer in any format (e.g., "8", "eight", "Eight.")

        Returns:
            dict: {
                'correct': bool,
                'retry': bool,
                'move_next': bool,
                'attempts_left': int,
                'current_question': str,
                'next_question': str or None,
                'correct_answer': float,
                'streak': int,
                'game_complete': bool,
                'needs_new_bank': bool,
                'message': str
            }
        """
        try:
            logger.info(f"🧮 Validating answer: '{user_answer}'")

            # Check if we need to generate questions first
            if self.math_game_state.needs_new_bank():
                logger.warning("⚠️ No questions in bank! Need to call generate_question_bank first")
                return {
                    'correct': False,
                    'retry': False,
                    'move_next': False,
                    'needs_new_bank': True,
                    'message': "No questions available. Please generate questions first."
                }

            # Get current question from bank
            current_q = self.math_game_state.get_current_question()
            if not current_q:
                logger.warning("⚠️ No current question available")
                return {
                    'correct': False,
                    'retry': False,
                    'move_next': False,
                    'needs_new_bank': True,
                    'message': "Questions ran out. Need new question bank."
                }

            logger.info(f"📝 Current Q: '{current_q['question']}', Expected: {current_q['answer']}")

            # Step 1: Parse user's answer
            user_number = self._parse_user_answer(user_answer)

            if user_number is None:
                logger.warning(f"⚠️ Could not parse: '{user_answer}'")
                # Treat as wrong answer, increase attempt count
                validation = self.math_game_state.validate_answer(-999999)  # Dummy wrong value
            else:
                # Step 2: Validate answer
                validation = self.math_game_state.validate_answer(user_number)

            # Step 3: Check if game complete
            game_complete = self.math_game_state.is_game_complete()

            # Step 3a: Handle game completion (streak of 3) - Clear context
            if game_complete:
                logger.info(f"🏆 MATH STREAK COMPLETE! User achieved 3 correct answers in a row")
                await self._clear_chat_context("Math streak completed")
                return await self._restart_math_game("Streak completed", is_victory=True)

            # Step 3b: Check if question bank exhausted - Clear context
            if self.math_game_state.needs_new_bank():
                logger.info(f"📚 Math question bank exhausted, need new questions")
                await self._clear_chat_context("Math question bank exhausted")
                return await self._restart_math_game("Question bank exhausted", is_victory=False)

            # Step 4: Get next question if moving forward
            next_q = None
            if validation['move_next']:
                next_q = self.math_game_state.get_current_question()

            # Step 5: Format answer for display
            correct_answer_display = str(int(validation['correct_answer']) if validation['correct_answer'] == int(validation['correct_answer']) else validation['correct_answer'])

            # Step 6: Generate message
            if validation['correct']:
                message = "Correct!"
            elif validation['retry']:
                message = f"Not quite. Try again!"
            else:
                # Max attempts reached, move to next
                message = f"The answer is {correct_answer_display}. Let's try another!"

            logger.info(f"Result: correct={validation['correct']}, retry={validation['retry']}, attempts_left={validation['attempts_left']}, streak={self.math_game_state.streak}")

            return {
                'correct': validation['correct'],
                'retry': validation['retry'],
                'move_next': validation['move_next'],
                'attempts_left': validation['attempts_left'],
                'current_question': current_q['question'],
                'next_question': next_q['question'] if next_q else None,
                'correct_answer': validation['correct_answer'],
                'correct_answer_display': correct_answer_display,
                'user_parsed': user_number,
                'streak': self.math_game_state.streak,
                'game_complete': game_complete,
                'needs_new_bank': self.math_game_state.needs_new_bank(),
                'message': message
            }

        except Exception as e:
            logger.error(f"❌ Error in check_math_answer: {e}")
            import traceback
            logger.error(f"Traceback: {traceback.format_exc()}")
            return {
                'correct': False,
                'retry': False,
                'move_next': False,
                'message': "Error validating answer. Let's try another!",
                'error': str(e)
            }

    @function_tool
    async def check_riddle_answer(
        self,
        context: RunContext,
        user_answer: str
    ):
        """
        Validate riddle answer using pre-generated riddle bank with retry logic.

        Args:
            user_answer: User's answer to current riddle

        Returns:
            dict: Validation result with retry/move_next flags
        """
        try:
            logger.info(f"🤔 Checking riddle answer: '{user_answer}'")

            # Check if we need to generate riddles first
            if self.riddle_game_state.needs_new_bank():
                logger.warning("⚠️ No riddle bank loaded")
                return {
                    'correct': False,
                    'retry': False,
                    'move_next': False,
                    'needs_new_bank': True,
                    'message': "Please generate riddles first by calling generate_riddle_bank()."
                }

            # Get current riddle
            current_r = self.riddle_game_state.get_current_riddle()
            if not current_r:
                return {
                    'correct': False,
                    'retry': False,
                    'move_next': False,
                    'needs_new_bank': True,
                    'message': "No more riddles. Generate new ones!"
                }

            logger.info(f"📝 Current Riddle: '{current_r['riddle']}', Expected: '{current_r['answer']}'")

            # Validate answer (exact string match, case-insensitive)
            validation = self.riddle_game_state.validate_answer(user_answer)

            # Check if game complete
            game_complete = self.riddle_game_state.is_game_complete()

            # Handle game completion (streak of 3) - Clear context
            if game_complete:
                logger.info(f"🏆 RIDDLE STREAK COMPLETE! User achieved 3 correct answers in a row")
                await self._clear_chat_context("Riddle streak completed")
                return await self._restart_riddle_game("Streak completed", is_victory=True)

            # Check if riddle bank exhausted - Clear context
            if self.riddle_game_state.needs_new_bank():
                logger.info(f"📚 Riddle bank exhausted, need new riddles")
                await self._clear_chat_context("Riddle bank exhausted")
                return await self._restart_riddle_game("Riddle bank exhausted", is_victory=False)

            # Get next riddle if moving forward
            next_r = None
            if validation['move_next']:
                next_r = self.riddle_game_state.get_current_riddle()

            # Generate message
            if validation['correct']:
                message = "Correct!"
            elif validation['retry']:
                message = "Not quite. Try again!"
            else:
                message = f"The answer is '{validation['correct_answer']}'. Let's try another!"

            logger.info(f"Result: correct={validation['correct']}, retry={validation['retry']}, attempts_left={validation['attempts_left']}, streak={self.riddle_game_state.streak}")

            return {
                'correct': validation['correct'],
                'retry': validation['retry'],
                'move_next': validation['move_next'],
                'attempts_left': validation['attempts_left'],
                'current_riddle': current_r['riddle'],
                'next_riddle': next_r['riddle'] if next_r else None,
                'correct_answer': validation['correct_answer'],
                'user_answer': user_answer,
                'streak': self.riddle_game_state.streak,
                'game_complete': game_complete,
                'needs_new_bank': self.riddle_game_state.needs_new_bank(),
                'message': message
            }

        except Exception as e:
            logger.error(f"❌ Error in check_riddle_answer: {e}")
            import traceback
            logger.error(f"Traceback: {traceback.format_exc()}")
            return {
                'correct': False,
                'retry': False,
                'move_next': False,
                'message': "Error validating answer. Let's try another!",
                'error': str(e)
            }

    async def _solve_question(self, question: str) -> tuple[Optional[float], str]:
        """
        Solve math question using sympy solver.

        Args:
            question: Math question to solve

        Returns:
            tuple: (answer: float or None, solving_method: str)
        """
        logger.info("📐 Using sympy solver...")
        answer = self._extract_and_solve_math(question)
        if answer is not None:
            return answer, "sympy"
        else:
            return None, "failed"

    @function_tool
    async def play_story(
        self,
        context: RunContext,
        story_name: Optional[str] = None,
        category: Optional[str] = None
    ):
        """Play a story - either a specific story or random story

        Args:
            story_name: Optional specific story to search for
            category: Optional category preference (Adventure, Bedtime, Educational, etc.)
        """
        try:
            logger.info(f"Story request - story: '{story_name}', category: '{category}'")

            if not self.story_service:
                return "Sorry, story service is not available right now."

            # Use unified audio player which injects music into TTS queue
            player = self.unified_audio_player if self.unified_audio_player else self.audio_player
            if not player:
                return "Sorry, audio player is not available right now."

            if story_name:
                # Search for specific story
                stories = await self.story_service.search_stories(story_name, category)
                if stories:
                    story = stories[0]  # Take first match
                    logger.info(f"Found story: {story['title']} in {story['category']}")
                else:
                    logger.info(f"No stories found for '{story_name}', playing random story")
                    story = await self.story_service.get_random_story(category)
            else:
                # Play random story
                story = await self.story_service.get_random_story(category)

            if not story:
                return "Sorry, I couldn't find any stories to play right now."

            # Start playing the story through TTS channel
            await player.play_from_url(story['url'], story['title'])

            # Return special instruction to suppress immediate response
            # The agent should stay silent while story plays
            return "[STORY_PLAYING - STAY_SILENT]"

        except Exception as e:
            logger.error(f"Error playing story: {e}")
            return "Sorry, I encountered an error while trying to play the story."

    @function_tool
    async def stop_audio(self, context: RunContext, unused: str = ""):
        """Stop any currently playing audio (music or story) and return to listening state"""
        try:
            from ..utils.audio_state_manager import audio_state_manager
            import json

            # Send music stop signal to device via data channel
            try:
                music_stop_data = {
                    "type": "music_playback_stopped"
                }
                # Try different ways to access the room
                room = None
                if hasattr(context, 'room'):
                    room = context.room
                elif self.unified_audio_player and self.unified_audio_player.context:
                    room = self.unified_audio_player.context.room
                elif self.audio_player and self.audio_player.context:
                    room = self.audio_player.context.room

                if room:
                    await room.local_participant.publish_data(
                        json.dumps(music_stop_data).encode(),
                        topic="music_control"
                    )
                    logger.info("Sent music_playback_stopped via data channel")
                else:
                    logger.warning("Could not access room for data channel")
            except Exception as e:
                logger.warning(f"Failed to send music stop signal: {e}")

            # Stop both audio players
            stopped_any = False

            if self.unified_audio_player:
                try:
                    await self.unified_audio_player.stop()
                    stopped_any = True
                    logger.info("Stopped unified audio player")
                except Exception as e:
                    logger.warning(f"Error stopping unified audio player: {e}")

            if self.audio_player:
                try:
                    await self.audio_player.stop()
                    stopped_any = True
                    logger.info("Stopped foreground audio player")
                except Exception as e:
                    logger.warning(f"Error stopping foreground audio player: {e}")

            # Force the system back to listening state
            was_playing = audio_state_manager.force_listening_state()

            if was_playing or stopped_any:
                # Send explicit agent state change to ensure device returns to listening
                try:
                    agent_state_data = {
                        "type": "agent_state_changed",
                        "data": {
                            "old_state": "speaking",
                            "new_state": "listening"
                        }
                    }
                    # Try different ways to access the room
                    room = None
                    if hasattr(context, 'room'):
                        room = context.room
                    elif self.unified_audio_player and self.unified_audio_player.context:
                        room = self.unified_audio_player.context.room
                    elif self.audio_player and self.audio_player.context:
                        room = self.audio_player.context.room

                    if room:
                        await room.local_participant.publish_data(
                            json.dumps(agent_state_data).encode(),
                            reliable=True
                        )
                        logger.info("Sent forced agent_state_changed to listening")
                    else:
                        logger.warning("Could not access room for listening state signal")
                except Exception as e:
                    logger.warning(f"Failed to send listening state signal: {e}")

                return "Stopped playing audio. Ready to listen."
            else:
                return "No audio is currently playing."

        except Exception as e:
            logger.error(f"Error stopping audio: {e}")
            return "Sorry, I encountered an error while trying to stop audio."

    @function_tool
    async def set_device_volume(self, context: RunContext, volume: int):
        """Set device volume to a specific level (0-100)

        Args:
            volume: Volume level from 0 (mute) to 100 (maximum)
        """
        if not self.mcp_executor:
            return "Sorry, device control is not available right now."

        # Always set context for each call to ensure correct room access
        self.mcp_executor.set_context(context, self.audio_player, self.unified_audio_player)

        return await self.mcp_executor.set_volume(volume)

    @function_tool
    async def adjust_device_volume(self, context: RunContext, action: str, step: int = 10):
        """Adjust device volume up or down

        Args:
            action: Either "up", "down", "increase", "decrease"
            step: Volume step size (default 10)
        """
        if not self.mcp_executor:
            return "Volume control is not available right now."

        # Always set context for each call to ensure correct room access
        self.mcp_executor.set_context(context, self.audio_player, self.unified_audio_player)

        return await self.mcp_executor.adjust_volume(action, step)

    @function_tool
    async def get_device_volume(self, context: RunContext, unused: str = ""):
        """Get current device volume level"""
        if not self.mcp_executor:
            return "Volume control is not available right now."

        # Always set context for each call to ensure correct room access
        self.mcp_executor.set_context(context, self.audio_player, self.unified_audio_player)

        return await self.mcp_executor.get_volume()


    @function_tool
    async def get_time_date(
        self,
        context: RunContext,
        query_type: str = "time"
    ) -> str:
        """
        Get current time, date, or calendar information.

        Args:
            query_type: "time", "date", "calendar", or "both"

        Examples:
            - "what time is it?" -> query_type="time"
            - "what's today's date?" -> query_type="date"
            - "tell me date and time" -> query_type="both"
        """
        try:
            # Get Indian Standard Time
            ist = pytz.timezone('Asia/Kolkata')
            now = datetime.now(ist)

            if query_type == "time":
                time_str = now.strftime('%I:%M %p IST')
                return f"The current time is {time_str}"

            elif query_type == "date":
                date_str = now.strftime('%A, %B %d, %Y')
                return f"Today's date is {date_str}"

            elif query_type == "both":
                time_str = now.strftime('%I:%M %p IST')
                date_str = now.strftime('%A, %B %d, %Y')
                return f"Today is {date_str} and the time is {time_str}"

            elif query_type == "calendar":
                # Basic Hindu calendar info
                vikram_year = now.year + 57
                hindu_months = [
                    "Paush", "Magh", "Falgun", "Chaitra", "Vaishakh", "Jyeshtha",
                    "Ashadh", "Shravan", "Bhadrapada", "Ashwin", "Kartik", "Margashirsha"
                ]
                hindu_month = hindu_months[now.month - 1]

                calendar_info = (
                    f"Today is {now.strftime('%A, %B %d, %Y')} ({now.strftime('%I:%M %p IST')}). "
                    f"According to the Hindu calendar, this is {hindu_month} in Vikram Samvat year {vikram_year}."
                )
                return calendar_info

            else:
                # Default to both
                time_str = now.strftime('%I:%M %p IST')
                date_str = now.strftime('%A, %B %d, %Y')
                return f"Today is {date_str} and the time is {time_str}"

        except Exception as e:
            logger.error(f"Time/date tool error: {e}")
            return f"Sorry, I encountered an error getting the time and date: {str(e)}"

    @function_tool
    async def get_weather(
        self,
        context: RunContext,
        location: Optional[str] = None
    ) -> str:
        """
        Get weather for specified or default location.

        Args:
            location: City name (optional, defaults to Bangalore)

        Examples:
            - "weather in bangalore" -> location="bangalore"
            - "how's the weather?" -> location=None (uses default)
            - "mumbai weather" -> location="mumbai"
        """
        try:
            import os

            # Get API key from environment
            api_key = os.getenv('WEATHER_API')
            if not api_key:
                return "Weather service is not configured. Please set the WEATHER_API environment variable."

            # Default location if none specified
            if not location:
                location = "Bangalore"

            # Normalize location name for Indian cities
            location = self._normalize_indian_city_name(location)

            # Fetch weather data
            weather_data = await self._fetch_weather_data(location, api_key)

            if weather_data:
                return self._format_weather_response(weather_data, location)
            else:
                return f"Unable to get weather data for {location}. Please check the city name and try again."

        except Exception as e:
            logger.error(f"Weather tool error: {e}")
            return f"Sorry, I encountered an error getting the weather: {str(e)}"

    def _normalize_indian_city_name(self, city_name: str) -> str:
        """Normalize Indian city names for better API recognition"""
        if not city_name:
            return city_name

        # Indian city mappings
        city_mappings = {
            "bombay": "Mumbai",
            "calcutta": "Kolkata",
            "madras": "Chennai",
            "bangalore": "Bengaluru",
            "poona": "Pune",
            "delhi": "New Delhi"
        }

        city_lower = city_name.lower().strip()
        return city_mappings.get(city_lower, city_name.title())

    async def _fetch_weather_data(self, location: str, api_key: str) -> Optional[Dict]:
        """Fetch weather data from OpenWeatherMap API"""
        try:
            url = "https://api.openweathermap.org/data/2.5/weather"
            params = {
                "q": location,
                "appid": api_key,
                "units": "metric",
                "lang": "en"
            }

            response = requests.get(url, params=params, timeout=10)
            response.raise_for_status()
            return response.json()

        except Exception as e:
            logger.error(f"Error fetching weather data: {e}")
            return None

    def _format_weather_response(self, weather_data: Dict, location: str) -> str:
        """Format weather data into a readable response"""
        try:
            temp = round(weather_data["main"]["temp"])
            feels_like = round(weather_data["main"]["feels_like"])
            humidity = weather_data["main"]["humidity"]
            description = weather_data["weather"][0]["description"].title()

            weather_report = (
                f"The weather in {location} is currently {temp}°C with {description}. "
                f"It feels like {feels_like}°C and the humidity is {humidity}%."
            )

            return weather_report

        except Exception as e:
            logger.error(f"Error formatting weather response: {e}")
            return f"Weather data received for {location} but formatting failed."

    @function_tool
    async def get_news(
        self,
        context: RunContext,
        source: str = "random"
    ) -> str:
        """
        Get latest Indian news from major sources.

        Args:
            source: News source name or "random" for random source

        Examples:
            - "tell me news" -> source="random"
            - "latest news" -> source="random"
            - "times of india news" -> source="times of india"
        """
        try:
            # Indian news sources
            news_sources = {
                "times_of_india": "https://timesofindia.indiatimes.com/rssfeedstopstories.cms",
                "hindu": "https://www.thehindu.com/feeder/default.rss",
                "indian_express": "https://indianexpress.com/feed/",
                "ndtv": "https://feeds.feedburner.com/ndtvnews-top-stories"
            }

            # Select source
            if source == "random":
                source_key = random.choice(list(news_sources.keys()))
            else:
                source_key = None
                source_lower = source.lower().replace(" ", "_")
                for key in news_sources.keys():
                    if key.replace("_", " ") in source.lower() or source.lower() in key.replace("_", " "):
                        source_key = key
                        break
                if not source_key:
                    source_key = "times_of_india"

            # Fetch news
            news_data = await self._fetch_news_data(news_sources[source_key])

            if news_data:
                # Select random news item
                selected_news = random.choice(news_data)
                return self._format_news_response(selected_news, source_key.replace("_", " ").title())
            else:
                return "Unable to fetch news. Please try again later."

        except Exception as e:
            logger.error(f"News tool error: {e}")
            return f"Sorry, I encountered an error getting the news: {str(e)}"

    async def _fetch_news_data(self, rss_url: str) -> Optional[list]:
        """Fetch news from RSS feed"""
        try:
            headers = {
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
            }
            response = requests.get(rss_url, headers=headers, timeout=15)
            response.raise_for_status()

            # Parse XML
            root = ET.fromstring(response.content)
            news_items = []

            for item in root.findall(".//item"):
                title = item.find("title").text if item.find("title") is not None else "No title"
                description = item.find("description").text if item.find("description") is not None else "No description"
                pubDate = item.find("pubDate").text if item.find("pubDate") is not None else "Unknown time"

                # Clean HTML from description if present
                if description and description != "No description":
                    try:
                        # Simple HTML tag removal
                        import re
                        description = re.sub('<[^<]+?>', '', description).strip()
                    except:
                        pass  # Use as is if regex fails
                #jsadkjha
                news_items.append({
                    "title": title,
                    "description": description,
                    "pubDate": pubDate
                })

            return news_items[:10]  # Return top 10 news items

        except Exception as e:
            logger.error(f"Error fetching news data: {e}")
            return None

    def _format_news_response(self, news_item: Dict, source: str) -> str:
        """Format news item into a readable response"""
        try:
            title = news_item.get("title", "Unknown title") or "Unknown title"
            description = news_item.get("description", "No description available") or "No description available"

            # Ensure description is a string and limit length
            if description and isinstance(description, str) and len(description) > 200:
                description = description[:200] + "..."
            elif not isinstance(description, str):
                description = "No description available"

            news_report = (
                f"Here's a news update from {source}: {title}. "
                f"{description}"
            )

            return news_report

        except Exception as e:
            logger.error(f"Error formatting news response: {e}")
            return f"News item received from {source} but formatting failed."

    # Volume Control Function Tools
    @function_tool
    async def self_set_volume(self, context: RunContext, volume: int):
        """Set device volume to a specific level (0-100)

        Args:
            volume: Volume level between 0 and 100
        """
        if not self.mcp_executor:
            return "Volume control is not available right now."

        # Always set context for each call to ensure correct room access
        self.mcp_executor.set_context(context, self.audio_player, self.unified_audio_player)

        return await self.mcp_executor.set_volume(volume)

    @function_tool
    async def self_get_volume(self, context: RunContext, unused: str = ""):
        """Get current device volume level"""
        if not self.mcp_executor:
            return "Volume control is not available right now."

        # Always set context for each call to ensure correct room access
        self.mcp_executor.set_context(context, self.audio_player, self.unified_audio_player)

        return await self.mcp_executor.get_volume()

    @function_tool
    async def self_volume_up(self, context: RunContext, unused: str = ""):
        """Increase device volume"""
        if not self.mcp_executor:
            return "Volume control is not available right now."

        # Always set context for each call to ensure correct room access
        self.mcp_executor.set_context(context, self.audio_player, self.unified_audio_player)

        return await self.mcp_executor.adjust_volume("up")

    @function_tool
    async def self_volume_down(self, context: RunContext, unused: str = ""):
        """Decrease device volume"""
        if not self.mcp_executor:
            return "Volume control is not available right now."

        # Always set context for each call to ensure correct room access
        self.mcp_executor.set_context(context, self.audio_player, self.unified_audio_player)

        return await self.mcp_executor.adjust_volume("down")

    @function_tool
    async def self_mute(self, context: RunContext, unused: str = ""):
        """Mute the device"""
        if not self.mcp_executor:
            return "Volume control is not available right now."

        # Always set context for each call to ensure correct room access
        self.mcp_executor.set_context(context, self.audio_player, self.unified_audio_player)

        return await self.mcp_executor.mute_device()

    @function_tool
    async def self_unmute(self, context: RunContext, unused: str = ""):
        """Unmute the device"""
        if not self.mcp_executor:
            return "Volume control is not available right now."

        # Always set context for each call to ensure correct room access
        self.mcp_executor.set_context(context, self.audio_player, self.unified_audio_player)

        return await self.mcp_executor.unmute_device()

    @function_tool
    async def set_light_color(self, context: RunContext, color: str):
        """Set device light color

        Args:
            color: Color name (red, blue, green, white, yellow, purple, pink, etc.)
        """
        if not self.mcp_executor:
            return "Light control is not available right now."

        self.mcp_executor.set_context(context, self.audio_player, self.unified_audio_player)
        return await self.mcp_executor.set_light_color(color)

    @function_tool
    async def check_battery_level(self, context: RunContext, unused: str = ""):
        """Check the device battery percentage.

        Use this to find out how much battery charge remains on the device.
        Call this function without any parameters.

        Args:
            unused: Internal parameter, leave empty or omit

        Returns:
            str: Battery percentage status message
        """
        logger.info("🔋 check_battery_level called")
        logger.info(f"🔋 context type: {type(context)}")
        logger.info(f"🔋 unused parameter received: '{unused}'")
        logger.info(f"🔋 mcp_executor available: {self.mcp_executor is not None}")

        if not self.mcp_executor:
            logger.warning("🔋 mcp_executor is not available")
            return "Battery status is not available right now."

        # Always set context for each call to ensure correct room access
        self.mcp_executor.set_context(context, self.audio_player, self.unified_audio_player)
        logger.info("🔋 Context set on mcp_executor, calling get_battery_status")

        result = await self.mcp_executor.get_battery_status()
        logger.info(f"🔋 check_battery_level result: {result}")
        return result
    
    
    @function_tool
    async def set_light_mode(self, context: RunContext, mode: str):
        """Set device light mode

        Args:
            mode: Mode name (rainbow, default, custom)
        """
        if not self.mcp_executor:
            return "Light Mode control is not available right now."

        self.mcp_executor.set_context(context, self.audio_player, self.unified_audio_player)
        return await self.mcp_executor.set_light_mode(mode)
    
    @function_tool
    async def set_rainbow_speed(self, context: RunContext, speed_ms: str):
        """Set rainbow mode speed

       Args:
            mode: Mode speed (integer, 50-1000)
        """
        if not self.mcp_executor:
            return "rainbow Mode speed control is not available right now."

        self.mcp_executor.set_context(context, self.audio_player, self.unified_audio_player)
        return await self.mcp_executor.set_rainbow_speed(speed_ms)

    @function_tool
    async def validate_word_ladder_move(self, context: RunContext, user_word: str) -> str:
        """
        Validate user's word in the Word Ladder game.

        Uses WordLadderGameState class for clean state management.

        Flow:
        1. Check letter matching (WordLadderGameState)
        2. Check victory condition
        3. Update state and return JSON result

        Args:
            user_word: The word the user just said

        Returns:
            JSON string with validation result
        """
        try:
            import json

            # Normalize input
            user_word = user_word.lower().strip()

            logger.info(f"🎮 Validating: '{user_word}' | Current: '{self.word_ladder_state.current_word}' | Target: '{self.word_ladder_state.target_word}'")
            logger.info(f"🎮 History: {self.word_ladder_state.word_history} | Failures: {self.word_ladder_state.failure_count}/{self.word_ladder_state.max_failures}")

            # Step 1: Check letter matching using WordLadderGameState
            is_letter_match, error_msg = self.word_ladder_state.validate_letter_match(user_word)

            if not is_letter_match:
                max_reached = self.word_ladder_state.increment_failure()
                logger.warning(f"❌ Letter mismatch: {error_msg}")

                if max_reached:
                    # Clear context before restarting due to max failures
                    await self._clear_chat_context("Max failures reached")
                    return await self._restart_word_ladder_game("Too many failures")

                state = self.word_ladder_state.get_state()
                result = {
                    "success": False,
                    "game_status": "in_progress",
                    **state,
                    "message": error_msg,
                    "error_type": "wrong_letter"
                }
                return json.dumps(result)

            # Step 2: Check victory (skip English word validation)
            if self.word_ladder_state.check_victory(user_word):
                logger.info(f"🏆 VICTORY! User reached target: {self.word_ladder_state.target_word}")
                self.word_ladder_state.add_valid_move(user_word)
                # Clear context before restarting due to victory
                await self._clear_chat_context("Victory achieved")
                return await self._restart_word_ladder_game("Victory!", is_victory=True)

            # Step 3: Valid move! Update state
            self.word_ladder_state.add_valid_move(user_word)
            logger.info(f"✅ Valid move! New current word: '{self.word_ladder_state.current_word}'")

            # Update backward-compatible variables
            self.current_word = self.word_ladder_state.current_word
            self.word_history = self.word_ladder_state.word_history.copy()
            self.failure_count = self.word_ladder_state.failure_count

            # Update prompt with new state
            await self.update_prompt_with_game_state()

            state = self.word_ladder_state.get_state()
            result = {
                "success": True,
                "game_status": "in_progress",
                **state,
                "message": "Valid move",
                "error_type": None
            }
            return json.dumps(result)

        except Exception as e:
            logger.error(f"❌ Error validating word: {e}")
            import traceback
            logger.error(f"Traceback: {traceback.format_exc()}")

            state = self.word_ladder_state.get_state()
            result = {
                "success": False,
                "game_status": "error",
                **state,
                "message": "System error",
                "error_type": "system_error"
            }
            return json.dumps(result)

    async def _clear_chat_context(self, reason: str):
        """
        Clear chat context/history to prevent agent confusion.
        
        This method clears the accumulated conversation history while preserving
        essential system instructions and current game state.
        
        Args:
            reason: Reason for clearing context (for logging)
        """
        try:
            logger.info(f"🧹 Clearing chat context - Reason: {reason}")
            
            # Method 1: Try to clear via agent session if available
            if self._agent_session and hasattr(self._agent_session, 'history'):
                try:
                    # Store the system message (first message) before clearing
                    system_message = None
                    if (hasattr(self._agent_session.history, 'messages') and 
                        len(self._agent_session.history.messages) > 0):
                        system_message = self._agent_session.history.messages[0]
                        logger.info(f"🧹 Preserved system message: {len(system_message.content) if hasattr(system_message, 'content') else 'N/A'} chars")
                    
                    # Clear all messages
                    if hasattr(self._agent_session.history, 'messages'):
                        original_count = len(self._agent_session.history.messages)
                        self._agent_session.history.messages.clear()
                        logger.info(f"🧹 Cleared {original_count} messages from session history")
                        
                        # Restore system message with updated game state
                        if system_message:
                            # Update system message with current game state
                            updated_instructions = self._format_instructions(self._original_instructions)
                            if hasattr(system_message, 'content'):
                                system_message.content = updated_instructions
                            self._agent_session.history.messages.append(system_message)
                            logger.info(f"🧹 Restored system message with updated game state")
                    
                    logger.info(f"✅ Successfully cleared chat context via session history")
                    return
                    
                except Exception as e:
                    logger.warning(f"⚠️ Failed to clear via session history: {e}")
            
            # Method 2: Try to clear via ChatContext if available in the session
            if self._agent_session and hasattr(self._agent_session, 'chat_ctx'):
                try:
                    # Check if there's a clear method
                    if hasattr(self._agent_session.chat_ctx, 'clear'):
                        self._agent_session.chat_ctx.clear()
                        logger.info(f"✅ Successfully cleared chat context via chat_ctx.clear()")
                        return
                    elif hasattr(self._agent_session.chat_ctx, 'messages'):
                        # Clear messages manually
                        original_count = len(self._agent_session.chat_ctx.messages)
                        self._agent_session.chat_ctx.messages.clear()
                        logger.info(f"✅ Successfully cleared {original_count} messages via chat_ctx.messages")
                        return
                except Exception as e:
                    logger.warning(f"⚠️ Failed to clear via chat_ctx: {e}")
            
            # Method 3: Try to access context through other session attributes
            if self._agent_session:
                try:
                    # Look for other possible context attributes
                    for attr_name in ['_chat_ctx', 'context', '_context', 'conversation']:
                        if hasattr(self._agent_session, attr_name):
                            attr = getattr(self._agent_session, attr_name)
                            if hasattr(attr, 'clear'):
                                attr.clear()
                                logger.info(f"✅ Successfully cleared context via {attr_name}.clear()")
                                return
                            elif hasattr(attr, 'messages') and hasattr(attr.messages, 'clear'):
                                original_count = len(attr.messages) if hasattr(attr.messages, '__len__') else 'unknown'
                                attr.messages.clear()
                                logger.info(f"✅ Successfully cleared {original_count} messages via {attr_name}.messages")
                                return
                except Exception as e:
                    logger.warning(f"⚠️ Failed to clear via session attributes: {e}")
            
            # If all methods fail, log warning but continue
            logger.warning(f"⚠️ Could not clear chat context - no accessible clearing method found")
            logger.info(f"🔄 Game will continue with accumulated context")
            
        except Exception as e:
            logger.error(f"❌ Error in _clear_chat_context: {e}")
            import traceback
            logger.error(f"Traceback: {traceback.format_exc()}")

    async def _restart_word_ladder_game(self, reason: str, is_victory: bool = False) -> str:
        """
        Restart Word Ladder game with new words (uses WordLadderGameState)

        Args:
            reason: Why restarting
            is_victory: If this is due to victory

        Returns:
            JSON string announcing new game
        """
        import json

        try:
            old_start = self.word_ladder_state.start_word
            old_target = self.word_ladder_state.target_word

            # Pick new word pair
            new_start, new_target = self._pick_valid_word_pair()

            # Reset state with new words
            self.word_ladder_state.reset(new_start, new_target)

            # Update backward-compatible variables
            self.start_word = new_start
            self.target_word = new_target
            self.current_word = new_start
            self.word_history = [new_start]
            self.failure_count = 0

            logger.info(f"🔄 Game restarted: {new_start} → {new_target} (Reason: {reason})")

            # Update prompt
            await self.update_prompt_with_game_state()

            state = self.word_ladder_state.get_state()
            result = {
                "success": is_victory,
                "game_status": "victory" if is_victory else "restart",
                **state,
                "message": f"{'Victory!' if is_victory else 'Game over!'} New game: {new_start} → {new_target}",
                "reason": reason,
                "previous_game": {
                    "start": old_start,
                    "target": old_target
                }
            }
            return json.dumps(result)

        except Exception as e:
            logger.error(f"❌ Error restarting game: {e}")
            import traceback
            logger.error(f"Traceback: {traceback.format_exc()}")

            result = {
                "success": False,
                "game_status": "error",
                "message": "Failed to restart game",
                "error_type": "restart_error"
            }
            return json.dumps(result)

    async def _restart_math_game(self, reason: str, is_victory: bool = False) -> dict:
        """
        Restart Math game with new question bank (uses MathGameState)

        Args:
            reason: Why restarting
            is_victory: If this is due to victory (streak completion)

        Returns:
            dict: Result with new game status
        """
        try:
            logger.info(f"🔄 Math game restarting - Reason: {reason}")
            
            # Store previous game stats
            previous_streak = self.math_game_state.streak
            previous_total = self.math_game_state.total_questions
            
            # Reset game state
            self.math_game_state.reset()
            
            logger.info(f"🔄 Math game reset complete - Previous streak: {previous_streak}, Total questions: {previous_total}")
            
            # Update prompt with new state
            await self.update_prompt_with_game_state()
            
            result = {
                "success": is_victory,
                "game_status": "victory" if is_victory else "restart",
                "game_type": "math",
                "message": f"{'🏆 Streak completed!' if is_victory else '📚 New questions needed!'} Math game restarted.",
                "reason": reason,
                "previous_game": {
                    "streak": previous_streak,
                    "total_questions": previous_total
                },
                "needs_new_bank": True,
                "streak": self.math_game_state.streak
            }
            return result
            
        except Exception as e:
            logger.error(f"❌ Error restarting math game: {e}")
            import traceback
            logger.error(f"Traceback: {traceback.format_exc()}")
            
            result = {
                "success": False,
                "game_status": "error",
                "game_type": "math",
                "message": "Failed to restart math game",
                "error_type": "restart_error"
            }
            return result

    async def _restart_riddle_game(self, reason: str, is_victory: bool = False) -> dict:
        """
        Restart Riddle game with new riddle bank (uses RiddleGameState)

        Args:
            reason: Why restarting
            is_victory: If this is due to victory (streak completion)

        Returns:
            dict: Result with new game status
        """
        try:
            logger.info(f"🔄 Riddle game restarting - Reason: {reason}")
            
            # Store previous game stats
            previous_streak = self.riddle_game_state.streak
            previous_total = self.riddle_game_state.total_riddles
            
            # Reset game state
            self.riddle_game_state.reset()
            
            logger.info(f"🔄 Riddle game reset complete - Previous streak: {previous_streak}, Total riddles: {previous_total}")
            
            # Update prompt with new state
            await self.update_prompt_with_game_state()
            
            result = {
                "success": is_victory,
                "game_status": "victory" if is_victory else "restart",
                "game_type": "riddle",
                "message": f"{'🏆 Streak completed!' if is_victory else '📚 New riddles needed!'} Riddle game restarted.",
                "reason": reason,
                "previous_game": {
                    "streak": previous_streak,
                    "total_riddles": previous_total
                },
                "needs_new_bank": True,
                "streak": self.riddle_game_state.streak
            }
            return result
            
        except Exception as e:
            logger.error(f"❌ Error restarting riddle game: {e}")
            import traceback
            logger.error(f"Traceback: {traceback.format_exc()}")
            
            result = {
                "success": False,
                "game_status": "error",
                "game_type": "riddle",
                "message": "Failed to restart riddle game",
                "error_type": "restart_error"
            }
            return result
