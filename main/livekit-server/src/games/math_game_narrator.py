"""
Narrator module for Math Commander game.
Uses session.say() for direct TTS narration — no LLM involved.
This ensures predictable, exact speech output every time.
"""

import random
import logging

logger = logging.getLogger("math_game_narrator")

# --- Response pools (randomly selected for variety) ---

GREETINGS = [
    "Hi {name}! I'm Cheeko, your math buddy! Let's play!",
    "Hey {name}! Ready for some fun math? Let's go!",
    "Namaste {name}! I'm Cheeko! Let's do some cool math together!",
    "Hello {name}! Welcome to Math Commander! Let's have fun!",
]

CORRECT_RESPONSES = [
    "Amazing! You got it right! You now have {stars} out of {total} stars!",
    "Brilliant! That's correct! {stars} out of {total} stars!",
    "Wah! Super job! You earned a star! {stars} out of {total} now!",
    "Correct! You're a math champion! {stars} out of {total} stars!",
    "Yes! That's right! Keep going! {stars} out of {total} stars!",
]

CORRECT_BONUS_RESPONSES = [
    "Incredible! 5 in a row! You got a BONUS star! {stars} out of {total} stars!",
    "What a streak! BONUS star earned! {stars} out of {total} stars! You're on fire!",
    "Amazing combo! 5 correct in a row! Bonus star! {stars} out of {total} stars!",
]

WRONG_RETRY_RESPONSES = [
    "Oops! Not quite. Try again, you can do it!",
    "Hmm, that's not right. Give it another shot!",
    "Almost! Think again, I believe in you!",
    "Not this time. Try once more!",
]

WRONG_MOVE_ON_RESPONSES = [
    "The answer was {answer}. Don't worry, let's try the next one!",
    "It was {answer}. No problem, you'll get the next one!",
    "The correct answer was {answer}. Keep going, you're doing great!",
]

HINT_REPEAT_RESPONSES = [
    "Let me repeat the question. {question}",
    "Here's the question again. {question}",
    "Think about this one. {question}",
]

HINT_ELIMINATE_RESPONSES = [
    "I removed one wrong option. It's easier now! Try again!",
    "One wrong answer is gone! You've got better chances now!",
    "I took away a wrong choice. Give it a try!",
]

HINT_REVEAL_RESPONSES = [
    "Time's up! The answer was {answer}. Let's move to the next one!",
    "The correct answer was {answer}. No worries, here comes another question!",
]

GAME_OVER_RESPONSES = [
    "Oh no, all lives used! You earned {stars} stars. Want to try again?",
    "Game over! You collected {stars} stars. Great effort! Want another round?",
]

LEVEL_COMPLETE_RESPONSES = [
    "Level {level} complete! You're amazing! Get ready for the next level!",
    "You did it! Level {level} cleared! The next challenge is coming!",
    "Fantastic! Level {level} done! Ready for more?",
]


def _pick(pool: list, **kwargs) -> str:
    """Pick a random response from pool and format with kwargs."""
    return random.choice(pool).format(**kwargs)


class Narrator:
    """
    All narration via session.say() — direct TTS, no LLM.
    Predictable, fast, and always says exactly what we want.
    """

    def __init__(self, session):
        self._session = session

    async def greet(self, child_name: str, game_mode: str):
        """Initial greeting."""
        text = _pick(GREETINGS, name=child_name)
        await self._say(text, tag="greet")

    async def react_correct(self, stars: int, total_needed: int, bonus: bool):
        """Celebrate correct answer."""
        if bonus:
            text = _pick(CORRECT_BONUS_RESPONSES, stars=stars, total=total_needed)
        else:
            text = _pick(CORRECT_RESPONSES, stars=stars, total=total_needed)
        await self._say(text, tag="react_correct")

    async def react_wrong(self, retry: bool, correct_answer: float = None):
        """Encourage on wrong answer."""
        if retry:
            text = _pick(WRONG_RETRY_RESPONSES)
        else:
            text = _pick(WRONG_MOVE_ON_RESPONSES, answer=int(correct_answer))
        await self._say(text, tag="react_wrong")

    async def give_hint(self, hint_type: str, question_text: str = "", correct_answer: float = None):
        """Narrate a hint."""
        if hint_type == "repeat":
            text = _pick(HINT_REPEAT_RESPONSES, question=question_text)
        elif hint_type == "eliminate":
            text = _pick(HINT_ELIMINATE_RESPONSES)
        elif hint_type == "reveal":
            text = _pick(HINT_REVEAL_RESPONSES, answer=int(correct_answer))
        else:
            logger.warning(f"narrator.unknown_hint_type(type={hint_type})")
            return
        await self._say(text, tag=f"hint_{hint_type}")

    async def narrate_game_over(self, stars: int):
        """Game over narration."""
        text = _pick(GAME_OVER_RESPONSES, stars=stars)
        await self._say(text, tag="game_over")

    async def narrate_level_complete(self, level: int):
        """Level complete celebration."""
        text = _pick(LEVEL_COMPLETE_RESPONSES, level=level)
        await self._say(text, tag="level_complete")

    async def speak_end_prompt(self, prompt_text: str):
        """Speak a goodbye/end prompt from gateway."""
        await self._say(prompt_text, tag="end_prompt")

    async def _say(self, text: str, tag: str):
        """
        Speak text directly via session.say() — no LLM involved.
        Does NOT re-raise on failure — game flow continues even if narration fails.
        """
        logger.info(f"narrator.say(tag={tag}, text={text[:100]})")
        try:
            speech = self._session.say(text, allow_interruptions=False)
            await speech
            logger.info(f"narrator.spoke(tag={tag})")
        except Exception as e:
            logger.error(f"narrator.say_failed(tag={tag}, error={e})")
