"""
Game Tools module for Cheeko AI Assistant
Contains function tools for Math Tutor, Riddle Solver, and Word Ladder games
"""

import logging
import time
from typing import Optional
from livekit.agents import function_tool, RunContext

logger = logging.getLogger("game_tools")

# Module-level state references (set by assistant)
_math_game_state = None
_riddle_game_state = None
_word_ladder_state = None
_game_analytics_manager = None


def set_game_analytics_manager(manager):
    """Set the game analytics manager reference for recording attempts"""
    global _game_analytics_manager
    _game_analytics_manager = manager
    logger.info("📊 Game analytics manager connected to tools")


def set_math_game_state(state):
    """Set the math game state reference"""
    global _math_game_state
    _math_game_state = state
    logger.info("🧮 Math game state connected to tools")


def set_riddle_game_state(state):
    """Set the riddle game state reference"""
    global _riddle_game_state
    _riddle_game_state = state
    logger.info("🤔 Riddle game state connected to tools")


def set_word_ladder_state(state):
    """Set the word ladder state reference"""
    global _word_ladder_state
    _word_ladder_state = state
    logger.info("🎮 Word ladder state connected to tools")


# ============================================================================
# MATH TUTOR TOOLS
# ============================================================================

@function_tool
async def check_math_answer(context: RunContext, user_answer: str, expected_answer: str) -> str:
    """
    Validate user's math answer against the expected answer.

    Args:
        user_answer: The child's spoken answer (e.g., "eight", "8")
        expected_answer: The correct answer you invented (e.g., "8", "4")

    Returns:
        JSON string with result: correct, retry, move_next, streak, game_complete, message
    """
    global _math_game_state, _game_analytics_manager
    import json

    start_time = time.perf_counter()

    try:
        logger.info(f"{'=' * 60}")
        logger.info(f"🧮 [MATH-TOOL] check_math_answer CALLED")
        logger.info(f"🧮 [MATH-TOOL] INPUT: user_answer='{user_answer}', expected_answer='{expected_answer}'")
        
        # Parse user answer to number
        parsed_user = _parse_number_from_text(user_answer)
        parsed_expected = _parse_number_from_text(expected_answer)
        
        if parsed_user is None:
            logger.warning(f"⚠️ Could not parse user answer: {user_answer}")
            result = {
                'correct': False,
                'retry': True,
                'move_next': False,
                'streak': _math_game_state.streak if _math_game_state else 0,
                'game_complete': False,
                'message': "I couldn't understand that number. Try again!"
            }
            elapsed_ms = (time.perf_counter() - start_time) * 1000
            logger.info(f"⏱️ check_math_answer completed in {elapsed_ms:.2f}ms (parse failed)")
            return json.dumps(result)
        
        if parsed_expected is None:
            logger.error(f"❌ Could not parse expected answer: {expected_answer}")
            parsed_expected = 0
        
        # Check if correct (allow small float tolerance)
        is_correct = abs(parsed_user - parsed_expected) < 0.01
        
        if _math_game_state:
            # Use game state to track attempts and streak
            if is_correct:
                _math_game_state.streak += 1
                _math_game_state.current_attempts = 0

                game_complete = _math_game_state.streak >= 5
                result = {
                    'correct': True,
                    'retry': False,
                    'move_next': True,
                    'streak': _math_game_state.streak,
                    'game_complete': game_complete,
                    'message': f"Correct! Streak: {_math_game_state.streak}"
                }
                elapsed_ms = (time.perf_counter() - start_time) * 1000

                # Record attempt to analytics manager
                if _game_analytics_manager:
                    _game_analytics_manager.record_attempt(
                        game_type='math_tutor',
                        is_correct=True,
                        attempt_number=1,
                        response_time_ms=int(elapsed_ms)
                    )

                logger.info(f"🧮 [MATH-TOOL] RESULT: correct=True, streak={_math_game_state.streak}, game_complete={game_complete}")
                logger.info(f"🧮 [MATH-TOOL] Returning: {result}")
                logger.info(f"{'=' * 60}")
                return json.dumps(result)
            else:
                _math_game_state.streak = 0
                _math_game_state.current_attempts += 1
                logger.info(f"🧮 [MATH-TOOL] WRONG: parsed_user={parsed_user}, parsed_expected={parsed_expected}, attempts={_math_game_state.current_attempts}/{_math_game_state.max_attempts}")

                if _math_game_state.current_attempts < _math_game_state.max_attempts:
                    result = {
                        'correct': False,
                        'retry': True,
                        'move_next': False,
                        'streak': 0,
                        'game_complete': False,
                        'message': f"Try again! Attempts left: {_math_game_state.max_attempts - _math_game_state.current_attempts}"
                    }
                    elapsed_ms = (time.perf_counter() - start_time) * 1000

                    # Record attempt to analytics manager
                    if _game_analytics_manager:
                        _game_analytics_manager.record_attempt(
                            game_type='math_tutor',
                            is_correct=False,
                            attempt_number=_math_game_state.current_attempts,
                            response_time_ms=int(elapsed_ms)
                        )

                    logger.info(f"🧮 [MATH-TOOL] RESULT: correct=False, retry=True, streak=0")
                    logger.info(f"🧮 [MATH-TOOL] Returning: {result}")
                    logger.info(f"{'=' * 60}")
                    return json.dumps(result)
                else:
                    _math_game_state.current_attempts = 0
                    result = {
                        'correct': False,
                        'retry': False,
                        'move_next': True,
                        'streak': 0,
                        'game_complete': False,
                        'correct_answer': str(parsed_expected),
                        'message': f"The answer was {parsed_expected}. Let's try a new one!"
                    }
                    elapsed_ms = (time.perf_counter() - start_time) * 1000

                    # Record attempt to analytics manager (final attempt before moving on)
                    if _game_analytics_manager:
                        _game_analytics_manager.record_attempt(
                            game_type='math_tutor',
                            is_correct=False,
                            attempt_number=_math_game_state.max_attempts,
                            response_time_ms=int(elapsed_ms)
                        )

                    logger.info(f"🧮 [MATH-TOOL] RESULT: correct=False, move_next=True, streak=0")
                    logger.info(f"🧮 [MATH-TOOL] Returning: {result}")
                    logger.info(f"{'=' * 60}")
                    return json.dumps(result)
        else:
            # No state, simple check
            result = {
                'correct': is_correct,
                'retry': not is_correct,
                'move_next': is_correct,
                'streak': 1 if is_correct else 0,
                'game_complete': False,
                'message': "Correct!" if is_correct else "Try again!"
            }
            elapsed_ms = (time.perf_counter() - start_time) * 1000
            logger.info(f"⏱️ check_math_answer completed in {elapsed_ms:.2f}ms (no state)")
            return json.dumps(result)

    except Exception as e:
        logger.error(f"❌ Error in check_math_answer: {e}")
        result = {
            'correct': False,
            'retry': True,
            'move_next': False,
            'streak': 0,
            'game_complete': False,
            'message': f"Error checking answer: {str(e)}"
        }
        elapsed_ms = (time.perf_counter() - start_time) * 1000
        logger.info(f"⏱️ check_math_answer completed in {elapsed_ms:.2f}ms (error)")
        return json.dumps(result)


# ============================================================================
# RIDDLE SOLVER TOOLS
# ============================================================================

@function_tool
async def check_riddle_answer(context: RunContext, user_answer: str, expected_answer: str) -> str:
    """
    Validate user's riddle answer against the expected answer.

    Args:
        user_answer: The child's spoken answer
        expected_answer: The correct answer to the riddle

    Returns:
        JSON string with result: correct, retry, move_next, streak, game_complete, message
    """
    global _riddle_game_state, _game_analytics_manager
    import json

    start_time = time.perf_counter()

    try:
        logger.info(f"🤔 Checking riddle answer: user='{user_answer}', expected='{expected_answer}'")

        # Normalize both answers for comparison
        user_normalized = user_answer.lower().strip()
        expected_normalized = expected_answer.lower().strip()

        # Remove common prefixes from user answer
        prefixes_to_remove = ["it's a ", "it is a ", "it's an ", "it is an ", "it's ", "it is ",
                              "a ", "an ", "the ", "is it a ", "is it an ", "is it "]
        for prefix in prefixes_to_remove:
            if user_normalized.startswith(prefix):
                user_normalized = user_normalized[len(prefix):]
                break

        # Also clean expected answer
        for prefix in prefixes_to_remove:
            if expected_normalized.startswith(prefix):
                expected_normalized = expected_normalized[len(prefix):]
                break

        logger.info(f"🤔 Normalized: user='{user_normalized}', expected='{expected_normalized}'")

        # Check if correct with improved matching
        is_correct = False

        # Exact match
        if user_normalized == expected_normalized:
            is_correct = True
        # Expected is IN user's answer (they said more than needed, e.g., "a clock" when answer is "clock")
        elif expected_normalized in user_normalized:
            is_correct = True
        # User's core answer is in expected (partial but meaningful match)
        # Only if user's answer is substantial (at least 3 chars) and not too short compared to expected
        elif len(user_normalized) >= 3 and user_normalized in expected_normalized:
            # Require user's answer to be at least 50% of expected length to avoid false positives
            if len(user_normalized) >= len(expected_normalized) * 0.5:
                is_correct = True
        
        if _riddle_game_state:
            if is_correct:
                _riddle_game_state.streak += 1
                _riddle_game_state.current_attempts = 0

                result = {
                    'correct': True,
                    'retry': False,
                    'move_next': True,
                    'streak': _riddle_game_state.streak,
                    'game_complete': _riddle_game_state.streak >= 5,
                    'message': f"Correct! It's a {expected_answer}!"
                }
                elapsed_ms = (time.perf_counter() - start_time) * 1000

                # Record attempt to analytics manager
                if _game_analytics_manager:
                    _game_analytics_manager.record_attempt(
                        game_type='riddle_solver',
                        is_correct=True,
                        attempt_number=1,
                        response_time_ms=int(elapsed_ms)
                    )

                logger.info(f"⏱️ check_riddle_answer completed in {elapsed_ms:.2f}ms (correct)")
                return json.dumps(result)
            else:
                _riddle_game_state.streak = 0
                _riddle_game_state.current_attempts += 1

                if _riddle_game_state.current_attempts < _riddle_game_state.max_attempts:
                    result = {
                        'correct': False,
                        'retry': True,
                        'move_next': False,
                        'streak': 0,
                        'game_complete': False,
                        'message': "Think harder! Try again!"
                    }
                    elapsed_ms = (time.perf_counter() - start_time) * 1000

                    # Record attempt to analytics manager
                    if _game_analytics_manager:
                        _game_analytics_manager.record_attempt(
                            game_type='riddle_solver',
                            is_correct=False,
                            attempt_number=_riddle_game_state.current_attempts,
                            response_time_ms=int(elapsed_ms)
                        )

                    logger.info(f"⏱️ check_riddle_answer completed in {elapsed_ms:.2f}ms (retry)")
                    return json.dumps(result)
                else:
                    _riddle_game_state.current_attempts = 0
                    result = {
                        'correct': False,
                        'retry': False,
                        'move_next': True,
                        'streak': 0,
                        'game_complete': False,
                        'correct_answer': expected_answer,
                        'message': f"It was a {expected_answer}! Let's try another!"
                    }
                    elapsed_ms = (time.perf_counter() - start_time) * 1000

                    # Record attempt to analytics manager
                    if _game_analytics_manager:
                        _game_analytics_manager.record_attempt(
                            game_type='riddle_solver',
                            is_correct=False,
                            attempt_number=_riddle_game_state.max_attempts,
                            response_time_ms=int(elapsed_ms)
                        )

                    logger.info(f"⏱️ check_riddle_answer completed in {elapsed_ms:.2f}ms (move_next)")
                    return json.dumps(result)
        else:
            result = {
                'correct': is_correct,
                'retry': not is_correct,
                'move_next': is_correct,
                'streak': 1 if is_correct else 0,
                'game_complete': False,
                'message': f"Correct! It's a {expected_answer}!" if is_correct else "Try again!"
            }
            elapsed_ms = (time.perf_counter() - start_time) * 1000
            logger.info(f"⏱️ check_riddle_answer completed in {elapsed_ms:.2f}ms (no state)")
            return json.dumps(result)

    except Exception as e:
        logger.error(f"❌ Error in check_riddle_answer: {e}")
        result = {
            'correct': False,
            'retry': True,
            'move_next': False,
            'streak': 0,
            'game_complete': False,
            'message': f"Error checking answer: {str(e)}"
        }
        elapsed_ms = (time.perf_counter() - start_time) * 1000
        logger.info(f"⏱️ check_riddle_answer completed in {elapsed_ms:.2f}ms (error)")
        return json.dumps(result)


# ============================================================================
# WORD LADDER TOOLS
# ============================================================================

@function_tool
async def validate_word_ladder_move(context: RunContext, user_word: str) -> str:
    """
    Validate user's word in the Word Ladder game.
    IMPORTANT: This game is played in English only. Always transcribe the child's spoken word into English letters (ASCII) before calling this tool. If the child speaks in another language, ask them to say an English word instead.

    Args:
        user_word: The English word spoken by the child (must be in English/ASCII letters only)

    Returns:
        JSON string with result: success, next_letter, expected_letter, game_status, words_used, message
    """
    global _word_ladder_state, _game_analytics_manager
    import json

    start_time = time.perf_counter()

    try:
        logger.info(f"🎮 Validating word ladder move: '{user_word}'")
        
        if not _word_ladder_state:
            logger.error("❌ Word ladder state not initialized")
            result = {
                'success': False,
                'expected_letter': '',
                'next_letter': '',
                'game_status': 'error',
                'words_used': 0,
                'message': 'Game not initialized'
            }
            elapsed_ms = (time.perf_counter() - start_time) * 1000
            logger.info(f"⏱️ validate_word_ladder_move completed in {elapsed_ms:.2f}ms (no state)")
            return json.dumps(result)

        user_word = user_word.strip().lower()

        # Reject non-English input (Gemini may transcribe in other scripts)
        if not user_word.isascii():
            logger.warning(f"⚠️ Non-English word detected: '{user_word}' - asking child to repeat in English")
            result = {
                'success': False,
                'expected_letter': _word_ladder_state.get_next_letter(),
                'next_letter': _word_ladder_state.get_next_letter(),
                'game_status': 'playing',
                'words_used': len(_word_ladder_state.word_history),
                'message': f"I couldn't understand that word. Please say an English word that starts with the letter '{_word_ladder_state.get_next_letter().upper()}'."
            }
            elapsed_ms = (time.perf_counter() - start_time) * 1000
            logger.info(f"⏱️ validate_word_ladder_move completed in {elapsed_ms:.2f}ms (non-english)")
            return json.dumps(result)

        if len(user_word) < 2:
            result = {
                'success': False,
                'expected_letter': _word_ladder_state.get_next_letter(),
                'next_letter': _word_ladder_state.get_next_letter(),
                'game_status': 'playing',
                'words_used': len(_word_ladder_state.word_history),
                'message': 'Word too short!'
            }
            elapsed_ms = (time.perf_counter() - start_time) * 1000
            logger.info(f"⏱️ validate_word_ladder_move completed in {elapsed_ms:.2f}ms (too short)")
            return json.dumps(result)
        
        # Validate letter match
        is_valid, error_msg = _word_ladder_state.validate_letter_match(user_word)
        
        if not is_valid:
            # Increment failure
            max_reached = _word_ladder_state.increment_failure()
            elapsed_ms = (time.perf_counter() - start_time) * 1000

            # Record invalid attempt
            if _game_analytics_manager:
                _game_analytics_manager.record_attempt(
                    game_type='word_ladder',
                    is_correct=False,
                    attempt_number=1,
                    response_time_ms=int(elapsed_ms)
                )

            if max_reached:
                # Restart game with new words
                from src.games.word_ladder_game import pick_valid_word_pair
                new_start, new_target = pick_valid_word_pair()
                _word_ladder_state.reset(new_start, new_target)

                result = {
                    'success': False,
                    'expected_letter': new_start[-1],
                    'next_letter': new_start[-1],
                    'game_status': 'restart',
                    'new_start': new_start,
                    'new_target': new_target,
                    'words_used': 1,
                    'message': f'Let\'s restart! New game: {new_start} → {new_target}'
                }
                logger.info(f"⏱️ validate_word_ladder_move completed in {elapsed_ms:.2f}ms (restart)")
                return json.dumps(result)
            else:
                result = {
                    'success': False,
                    'expected_letter': _word_ladder_state.get_next_letter(),
                    'next_letter': _word_ladder_state.get_next_letter(),
                    'game_status': 'playing',
                    'words_used': len(_word_ladder_state.word_history),
                    'message': error_msg
                }
                logger.info(f"⏱️ validate_word_ladder_move completed in {elapsed_ms:.2f}ms (invalid)")
                return json.dumps(result)
        
        # Valid move - add to chain
        _word_ladder_state.add_valid_move(user_word)
        elapsed_ms = (time.perf_counter() - start_time) * 1000

        # Record valid attempt
        if _game_analytics_manager:
            _game_analytics_manager.record_attempt(
                game_type='word_ladder',
                is_correct=True,
                attempt_number=1,
                response_time_ms=int(elapsed_ms)
            )

        # Check victory (10 words in chain)
        if len(_word_ladder_state.word_history) >= 10:
            result = {
                'success': True,
                'next_letter': '',
                'expected_letter': '',
                'game_status': 'victory',
                'words_used': len(_word_ladder_state.word_history),
                'message': 'Victory! You built the rope!'
            }
            logger.info(f"⏱️ validate_word_ladder_move completed in {elapsed_ms:.2f}ms (victory)")
            return json.dumps(result)

        result = {
            'success': True,
            'next_letter': _word_ladder_state.get_next_letter(),
            'expected_letter': '',
            'game_status': 'playing',
            'words_used': len(_word_ladder_state.word_history),
            'message': f'Great! Next letter: {_word_ladder_state.get_next_letter()}'
        }
        logger.info(f"⏱️ validate_word_ladder_move completed in {elapsed_ms:.2f}ms (valid)")
        return json.dumps(result)

    except Exception as e:
        logger.error(f"❌ Error in validate_word_ladder_move: {e}")
        import traceback
        logger.error(traceback.format_exc())
        result = {
            'success': False,
            'expected_letter': '',
            'next_letter': '',
            'game_status': 'error',
            'words_used': 0,
            'message': f'Error: {str(e)}'
        }
        elapsed_ms = (time.perf_counter() - start_time) * 1000
        logger.info(f"⏱️ validate_word_ladder_move completed in {elapsed_ms:.2f}ms (error)")
        return json.dumps(result)


# ============================================================================
# HELPER FUNCTIONS
# ============================================================================

def _parse_number_from_text(text: str) -> Optional[float]:
    """
    Parse a number from text (handles words like 'eight', 'twenty-one', etc.)
    Also handles common STT errors and variations.
    """
    if text is None:
        return None

    text = str(text).lower().strip()

    # First try direct number parsing
    try:
        return float(text)
    except ValueError:
        pass

    # Word to number mapping (including common STT errors)
    word_to_num = {
        'zero': 0, 'one': 1, 'two': 2, 'three': 3, 'four': 4,
        'five': 5, 'six': 6, 'seven': 7, 'eight': 8, 'nine': 9,
        'ten': 10, 'eleven': 11, 'twelve': 12, 'thirteen': 13,
        'fourteen': 14, 'fifteen': 15, 'sixteen': 16, 'seventeen': 17,
        'eighteen': 18, 'nineteen': 19, 'twenty': 20,
        'thirty': 30, 'forty': 40, 'fifty': 50, 'sixty': 60,
        'seventy': 70, 'eighty': 80, 'ninety': 90, 'hundred': 100,
        # Common STT errors
        'to': 2, 'too': 2, 'tu': 2,
        'for': 4, 'fore': 4,
        'won': 1, 'wan': 1,
        'ate': 8, 'ait': 8,
        'tree': 3, 'free': 3,
        'sex': 6, 'sax': 6,
        'nein': 9, 'nain': 9,
        'tin': 10, 'tan': 10,
        # Hindi/Indian English variations
        'ek': 1, 'do': 2, 'teen': 3, 'char': 4, 'paanch': 5, 'panch': 5,
        'chhe': 6, 'che': 6, 'saat': 7, 'sat': 7, 'aath': 8, 'ath': 8,
        'nau': 9, 'das': 10,
    }

    # Check for exact word match
    if text in word_to_num:
        return float(word_to_num[text])

    # Handle compound numbers (e.g., "twenty-one", "twenty one")
    text = text.replace('-', ' ')
    parts = text.split()

    # Handle "hundred" properly (e.g., "two hundred", "one hundred five")
    if 'hundred' in parts:
        try:
            hundred_idx = parts.index('hundred')
            multiplier = 1
            if hundred_idx > 0 and parts[hundred_idx - 1] in word_to_num:
                multiplier = word_to_num[parts[hundred_idx - 1]]
            result = multiplier * 100

            # Check for remainder after "hundred"
            remainder_parts = parts[hundred_idx + 1:]
            if remainder_parts:
                for part in remainder_parts:
                    if part in word_to_num:
                        result += word_to_num[part]
            return float(result)
        except Exception:
            pass

    # Handle two-part compound numbers (e.g., "twenty one")
    if len(parts) == 2:
        if parts[0] in word_to_num and parts[1] in word_to_num:
            return float(word_to_num[parts[0]] + word_to_num[parts[1]])

    # Try single parts
    if len(parts) == 1 and parts[0] in word_to_num:
        return float(word_to_num[parts[0]])

    # Try to extract first number from text using regex
    import re
    numbers = re.findall(r'\d+\.?\d*', text)
    if numbers:
        return float(numbers[0])

    # Last resort: check if any word in text maps to a number
    for part in parts:
        if part in word_to_num:
            return float(word_to_num[part])

    return None


# ============================================================================
# TOOL REGISTRATION HELPERS
# ============================================================================

def get_math_tools():
    """Get list of math tutor function tools"""
    return [check_math_answer]


def get_riddle_tools():
    """Get list of riddle solver function tools"""
    return [check_riddle_answer]


def get_word_ladder_tools():
    """Get list of word ladder function tools"""
    return [validate_word_ladder_move]
