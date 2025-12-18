"""
Game Tools module for Cheeko AI Assistant
Contains function tools for Math Tutor, Riddle Solver, and Word Ladder games
"""

import logging
from typing import Optional
from livekit.agents import function_tool, RunContext

logger = logging.getLogger("game_tools")

# Module-level state references (set by assistant)
_math_game_state = None
_riddle_game_state = None
_word_ladder_state = None


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
    global _math_game_state
    import json
    
    try:
        logger.info(f"🧮 Checking math answer: user='{user_answer}', expected='{expected_answer}'")
        
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
                
                result = {
                    'correct': True,
                    'retry': False,
                    'move_next': True,
                    'streak': _math_game_state.streak,
                    'game_complete': _math_game_state.streak >= 5,
                    'message': f"Correct! Streak: {_math_game_state.streak}"
                }
                return json.dumps(result)
            else:
                _math_game_state.streak = 0
                _math_game_state.current_attempts += 1
                
                if _math_game_state.current_attempts < _math_game_state.max_attempts:
                    result = {
                        'correct': False,
                        'retry': True,
                        'move_next': False,
                        'streak': 0,
                        'game_complete': False,
                        'message': f"Try again! Attempts left: {_math_game_state.max_attempts - _math_game_state.current_attempts}"
                    }
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
    global _riddle_game_state
    import json
    
    try:
        logger.info(f"🤔 Checking riddle answer: user='{user_answer}', expected='{expected_answer}'")
        
        # Normalize both answers for comparison
        user_normalized = user_answer.lower().strip()
        expected_normalized = expected_answer.lower().strip()
        
        # Check if correct (exact match or contained)
        is_correct = (user_normalized == expected_normalized or 
                     expected_normalized in user_normalized or
                     user_normalized in expected_normalized)
        
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
        return json.dumps(result)


# ============================================================================
# WORD LADDER TOOLS
# ============================================================================

@function_tool
async def validate_word_ladder_move(context: RunContext, user_word: str) -> str:
    """
    Validate user's word in the Word Ladder game.
    
    Args:
        user_word: The word spoken by the child
        
    Returns:
        JSON string with result: success, next_letter, expected_letter, game_status, words_used, message
    """
    global _word_ladder_state
    import json
    
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
            return json.dumps(result)
        
        user_word = user_word.strip().lower()
        
        if len(user_word) < 2:
            result = {
                'success': False,
                'expected_letter': _word_ladder_state.get_next_letter(),
                'next_letter': _word_ladder_state.get_next_letter(),
                'game_status': 'playing',
                'words_used': len(_word_ladder_state.word_history),
                'message': 'Word too short!'
            }
            return json.dumps(result)
        
        # Validate letter match
        is_valid, error_msg = _word_ladder_state.validate_letter_match(user_word)
        
        if not is_valid:
            # Increment failure
            max_reached = _word_ladder_state.increment_failure()
            
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
                return json.dumps(result)
        
        # Valid move - add to chain
        _word_ladder_state.add_valid_move(user_word)
        
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
            return json.dumps(result)
        
        result = {
            'success': True,
            'next_letter': _word_ladder_state.get_next_letter(),
            'expected_letter': '',
            'game_status': 'playing',
            'words_used': len(_word_ladder_state.word_history),
            'message': f'Great! Next letter: {_word_ladder_state.get_next_letter()}'
        }
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
        return json.dumps(result)


# ============================================================================
# HELPER FUNCTIONS
# ============================================================================

def _parse_number_from_text(text: str) -> Optional[float]:
    """
    Parse a number from text (handles words like 'eight', 'twenty-one', etc.)
    """
    if text is None:
        return None
        
    text = str(text).lower().strip()
    
    # First try direct number parsing
    try:
        return float(text)
    except ValueError:
        pass
    
    # Word to number mapping
    word_to_num = {
        'zero': 0, 'one': 1, 'two': 2, 'three': 3, 'four': 4,
        'five': 5, 'six': 6, 'seven': 7, 'eight': 8, 'nine': 9,
        'ten': 10, 'eleven': 11, 'twelve': 12, 'thirteen': 13,
        'fourteen': 14, 'fifteen': 15, 'sixteen': 16, 'seventeen': 17,
        'eighteen': 18, 'nineteen': 19, 'twenty': 20,
        'thirty': 30, 'forty': 40, 'fifty': 50, 'sixty': 60,
        'seventy': 70, 'eighty': 80, 'ninety': 90, 'hundred': 100
    }
    
    # Check for exact word match
    if text in word_to_num:
        return float(word_to_num[text])
    
    # Handle compound numbers (e.g., "twenty-one", "twenty one")
    text = text.replace('-', ' ')
    parts = text.split()
    
    if len(parts) == 2:
        if parts[0] in word_to_num and parts[1] in word_to_num:
            return float(word_to_num[parts[0]] + word_to_num[parts[1]])
    
    # Try to extract first number from text
    import re
    numbers = re.findall(r'\d+\.?\d*', text)
    if numbers:
        return float(numbers[0])
    
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
