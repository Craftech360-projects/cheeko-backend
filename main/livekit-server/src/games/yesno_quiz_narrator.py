"""
Narrator module for Yes/No Quiz game.
Uses session.say() for direct TTS narration — no LLM involved.
Response pools provide variety while fun_fact and answer placeholders add context.
"""

import random
import logging

logger = logging.getLogger("yesno_quiz_narrator")

# --- Response pools (randomly selected for variety) ---

GREETINGS = [
    "Hi {name}! I'm Cheeko, your quiz buddy! We're going to explore amazing facts together! Ready?",
    "Hey {name}! Welcome to Yes/No Quiz! I've got some really cool facts to share with you! Let's go!",
    "Hello {name}! Did you know the world is full of amazing surprises? Let's find out how many you know!",
    "Namaste {name}! I'm Cheeko! Time to test your knowledge with some super fun yes or no questions!",
    "Hi {name}! Get ready for the Yes/No Quiz — some questions will surprise you! Let's begin!",
]

CORRECT_RESPONSES = [
    "Yes! You got it! {fun_fact} Amazing, right?",
    "Correct! That's right! And here's something cool — {fun_fact}",
    "Brilliant! You knew that one! Did you also know that {fun_fact}",
    "That's exactly right! Great thinking! {fun_fact}",
    "Wah! Spot on! Here's a fun fact for you — {fun_fact}",
]

WRONG_RESPONSES = [
    "Oops! The answer is actually {answer}! But here's the cool thing — {fun_fact}",
    "Not quite! The correct answer is {answer}. And here's why — {fun_fact}",
    "Hmm, this one was tricky! It's {answer}! {fun_fact}",
    "Good try! The answer is {answer}. Did you know — {fun_fact}",
    "Almost! It's {answer}! Here's something interesting — {fun_fact}",
]

TIMEOUT_RESPONSES = [
    "Time's up! The answer was {answer}! {fun_fact} Let's try the next one!",
    "Oops, time ran out! It was {answer}! {fun_fact} On to the next question!",
    "No worries — the answer was {answer}! {fun_fact} Let's keep going!",
    "Time's up! Here's what you needed to know — the answer is {answer}. {fun_fact}",
]

LEVEL_COMPLETE = [
    "Fantastic! You've completed level {level}! You're a trivia superstar! Get ready for harder questions!",
    "Wow! Level {level} cleared! You're on a roll! The next level has even cooler facts!",
    "Level {level} complete! You're crushing it! Ready for the next challenge?",
    "Amazing! You passed level {level}! More exciting questions are coming your way!",
]

GAME_OVER = [
    "Great game {name}! You scored {stars} out of {total} stars! You learned so many cool facts today!",
    "That was awesome {name}! You got {stars} out of {total} stars! Want to try again and beat your score?",
    "Well done {name}! {stars} stars out of {total}! Every question you missed teaches you something new!",
    "Game over {name}! You earned {stars} out of {total} stars! You're getting smarter every time you play!",
]

STREAK_RESPONSES = [
    "Wow, {streak} in a row! You're on fire! Keep it up!",
    "Amazing streak! {streak} correct answers! You're unstoppable!",
    "{streak} in a row! You're a trivia champion!",
    "Hot streak alert! {streak} correct! Nothing can stop you!",
]

NEXT_QUESTION_TRANSITIONS = [
    "Okay, here comes the next question!",
    "Ready? Here's your next question!",
    "Great, let's try another one!",
    "Alright, next question coming up!",
    "Here we go, question time!",
]


def _pick(pool: list, **kwargs) -> str:
    """Pick a random response from pool and format with kwargs."""
    return random.choice(pool).format(**kwargs)


class YesNoNarrator:
    """
    All narration via session.say() — direct TTS, no LLM.
    Provides fun, fact-filled responses that educate while entertaining.
    """

    def __init__(self, session):
        self._session = session

    async def greet(self, child_name: str):
        """Initial greeting."""
        text = _pick(GREETINGS, name=child_name)
        await self._speak(text, tag="greet")

    async def announce_question(self, question: str, question_number: int, total: int):
        """Announce the question number and read the question."""
        text = f"Question {question_number} of {total}. {question} Is that yes or no?"
        await self._speak(text, tag="announce_question")

    async def react_correct(self, fun_fact: str):
        """Celebrate correct answer and share fun fact."""
        text = _pick(CORRECT_RESPONSES, fun_fact=fun_fact)
        await self._speak(text, tag="react_correct")

    async def react_wrong(self, correct_answer: bool, fun_fact: str):
        """React to wrong answer, reveal correct answer and share fun fact."""
        answer_word = "Yes" if correct_answer else "No"
        text = _pick(WRONG_RESPONSES, answer=answer_word, fun_fact=fun_fact)
        await self._speak(text, tag="react_wrong")

    async def react_timeout(self, correct_answer: bool, fun_fact: str):
        """React to timeout — reveal answer and share fun fact."""
        answer_word = "Yes" if correct_answer else "No"
        text = _pick(TIMEOUT_RESPONSES, answer=answer_word, fun_fact=fun_fact)
        await self._speak(text, tag="react_timeout")

    async def speak_hint(self, clue: str):
        """Speak an LLM-generated clue hint."""
        text = f"Here's a little clue for you! {clue}"
        await self._speak(text, tag="speak_hint")

    async def announce_level_complete(self, level: int):
        """Level complete celebration."""
        text = _pick(LEVEL_COMPLETE, level=level)
        await self._speak(text, tag="level_complete")

    async def announce_game_over(self, child_name: str, stars: int, total: int):
        """Game over narration with score."""
        text = _pick(GAME_OVER, name=child_name, stars=stars, total=total)
        await self._speak(text, tag="game_over")

    async def announce_streak(self, streak: int):
        """Celebrate a correct answer streak."""
        text = _pick(STREAK_RESPONSES, streak=streak)
        await self._speak(text, tag="streak")

    async def transition_to_next(self):
        """Bridge phrase between questions."""
        text = _pick(NEXT_QUESTION_TRANSITIONS)
        await self._speak(text, tag="transition")

    async def speak_end_prompt(self, prompt_text: str):
        """Speak a goodbye/end prompt from gateway."""
        await self._speak(prompt_text, tag="end_prompt")

    async def _speak(self, text: str, tag: str):
        """
        Speak text directly via session.say() — no LLM involved.
        Does NOT re-raise on failure — game flow continues even if narration fails.
        Times out after 15s to prevent game from hanging.
        """
        import asyncio
        logger.info(f"narrator.speak(tag={tag}, text={text[:100]})")
        try:
            speech = self._session.say(text, allow_interruptions=False)
            await asyncio.wait_for(speech, timeout=15.0)
            logger.info(f"narrator.spoke(tag={tag})")
        except asyncio.TimeoutError:
            logger.warning(f"narrator.speak_timeout(tag={tag}, text={text[:60]})")
        except Exception as e:
            logger.error(f"narrator.speak_failed(tag={tag}, error={e})")
