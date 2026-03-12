"""
Narrator module for Math Commander game.
Controls all LLM speech via generate_reply(tool_choice="none").
The LLM acts as narrator only — no tools during narration.
"""

import logging

logger = logging.getLogger("math_game_narrator")

# --- Prompt Templates ---

GREETING_PROMPT = """You are Cheeko, a fun math game buddy for kids.
The child's name is {name}. Game mode: {mode}.
Give a warm, brief greeting (2-3 sentences). Introduce the game excitedly.
Do NOT ask any math questions. Do NOT mention numbers."""

QUESTION_PROMPT = """Tell this story and ask the question at the end:
Story: {story}
Question: {question}
Keep it engaging (2-3 sentences for story, then ask the question clearly).
Do NOT give hints. Do NOT mention the answer options."""

CORRECT_PROMPT = """The child answered correctly! They now have {stars}/{total_needed} stars.
Say a brief, excited celebration (1-2 sentences).
Do NOT ask a new question. Do NOT mention numbers or math."""

CORRECT_BONUS_PROMPT = """The child answered correctly AND got a BONUS STAR for a 5-answer streak!
They now have {stars}/{total_needed} stars.
Say an extra excited celebration about the bonus (2 sentences).
Do NOT ask a new question."""

WRONG_PROMPT_RETRY = """The child answered wrong but gets another try.
Gently encourage them to try again (1 sentence).
Do NOT reveal the answer. Do NOT repeat the options."""

WRONG_PROMPT_MOVE_ON = """The child answered wrong. The correct answer was {correct_answer}.
Briefly tell them the right answer and encourage them (1-2 sentences).
Do NOT ask a new question."""

HINT_REPEAT_PROMPT = """The child hasn't answered yet. Repeat the question:
{question_text}
Rephrase it slightly to help them understand. Keep it brief."""

HINT_ELIMINATE_PROMPT = """The child is struggling. One wrong option was removed.
Encourage them - it's easier now! (1 sentence).
Do NOT reveal the answer."""

HINT_REVEAL_PROMPT = """Time's up. The correct answer was {correct_answer}.
Gently tell them the answer and encourage them (1-2 sentences).
Do NOT ask a new question."""

GAME_OVER_PROMPT = """The child lost all lives. They earned {stars} stars.
Be supportive and encouraging (2-3 sentences). Ask if they want to try again."""

LEVEL_COMPLETE_PROMPT = """The child completed level {level}! Amazing!
Celebrate enthusiastically (2-3 sentences). Tell them the next level is coming."""

END_PROMPT_TEMPLATE = """{prompt}"""


class Narrator:
    """
    Controls all LLM narration via session.generate_reply().
    Every call uses tool_choice="none" — the LLM CANNOT invoke tools during narration.
    Catches all exceptions — a silent narrator is better than a crashed game.
    """

    def __init__(self, session):
        """
        Args:
            session: AgentSession instance for generate_reply() calls.
        """
        self._session = session

    async def greet(self, child_name: str, game_mode: str):
        """Initial greeting."""
        instructions = GREETING_PROMPT.format(name=child_name, mode=game_mode)
        await self._speak(instructions, tag="greet")

    async def present_question(self, question_text: str, story_text: str):
        """Narrate the question story."""
        instructions = QUESTION_PROMPT.format(story=story_text, question=question_text)
        await self._speak(instructions, tag="present_question")

    async def react_correct(self, stars: int, total_needed: int, bonus: bool):
        """Celebrate correct answer."""
        if bonus:
            instructions = CORRECT_BONUS_PROMPT.format(stars=stars, total_needed=total_needed)
        else:
            instructions = CORRECT_PROMPT.format(stars=stars, total_needed=total_needed)
        await self._speak(instructions, tag="react_correct")

    async def react_wrong(self, retry: bool, correct_answer: float = None):
        """Encourage on wrong answer."""
        if retry:
            instructions = WRONG_PROMPT_RETRY
        else:
            instructions = WRONG_PROMPT_MOVE_ON.format(correct_answer=int(correct_answer))
        await self._speak(instructions, tag="react_wrong")

    async def give_hint(self, hint_type: str, question_text: str = "", correct_answer: float = None):
        """Narrate a hint based on type."""
        if hint_type == "repeat":
            instructions = HINT_REPEAT_PROMPT.format(question_text=question_text)
        elif hint_type == "eliminate":
            instructions = HINT_ELIMINATE_PROMPT
        elif hint_type == "reveal":
            instructions = HINT_REVEAL_PROMPT.format(correct_answer=int(correct_answer))
        else:
            logger.warning(f"narrator.unknown_hint_type(type={hint_type})")
            return
        await self._speak(instructions, tag=f"hint_{hint_type}")

    async def narrate_game_over(self, stars: int):
        """Game over narration."""
        instructions = GAME_OVER_PROMPT.format(stars=stars)
        await self._speak(instructions, tag="game_over")

    async def narrate_level_complete(self, level: int):
        """Level complete celebration."""
        instructions = LEVEL_COMPLETE_PROMPT.format(level=level)
        await self._speak(instructions, tag="level_complete")

    async def speak_end_prompt(self, prompt_text: str):
        """Speak a goodbye/end prompt from gateway."""
        instructions = END_PROMPT_TEMPLATE.format(prompt=prompt_text)
        await self._speak(instructions, tag="end_prompt")

    async def _speak(self, instructions: str, tag: str):
        """
        Core speak method. Calls session.generate_reply(tool_choice="none").
        Does NOT re-raise on failure — game flow continues even if narration fails.
        """
        logger.info(f"narrator.speaking(tag={tag}, instruction_len={len(instructions)})")
        try:
            speech_handle = self._session.generate_reply(
                instructions=instructions,
                tool_choice="none",
            )
            await speech_handle

            interrupted = getattr(speech_handle, "interrupted", False)
            logger.info(f"narrator.spoke(tag={tag}, interrupted={interrupted})")
        except Exception as e:
            logger.error(f"narrator.speak_failed(tag={tag}, error={e})")
