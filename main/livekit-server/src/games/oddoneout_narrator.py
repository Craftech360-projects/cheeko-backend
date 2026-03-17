"""
Agentic narrator for Odd One Out game.
Injects game events into the agent's chat context, then generate_reply().
LLM responds naturally through its personality prompt.
Falls back to session.say() on error.
"""

import asyncio
import logging

logger = logging.getLogger("oddoneout_narrator")


class OddOneOutNarrator:
    """
    Real agentic narrator:
    1. Copy agent's chat_ctx
    2. Add game event as system message
    3. Update agent's chat_ctx
    4. generate_reply() → returns SpeechHandle → await for TTS completion
    """

    def __init__(self, session, agent, child_name: str = "buddy", child_age: int = 7):
        self._session = session
        self._agent = agent
        self._child_name = child_name
        self._child_age = child_age

    async def greet(self, child_name: str, game_mode: str):
        self._child_name = child_name
        await self._inject_and_speak(
            f"[GAME START] Greet {child_name}! You're playing Odd One Out in {game_mode} mode. "
            f"Explain briefly: you'll show items, they find the one that doesn't belong. "
            f"Be excited. 2-3 sentences max.",
            fallback=f"Hi {child_name}! Welcome to Odd One Out! I'll show you some items and you pick the one that doesn't belong. Let's go!",
            tag="greet",
        )

    async def announce_question(self, items: list, question_number: int, total: int):
        items_str = ", ".join(items[:-1]) + f", and {items[-1]}"
        await self._inject_and_speak(
            f"[QUESTION {question_number}/{total}] Read these items clearly: {items_str}. "
            f"Ask which one doesn't belong. Do NOT give hints. Do NOT ask if they're ready.",
            fallback=f"Question {question_number}! Here are your choices: {items_str}. Which one doesn't belong?",
            tag="announce_question",
        )

    async def react_correct(self, explanation: str, fun_fact: str, stars: int, total: int, bonus_star: bool):
        bonus_text = " BONUS STAR for 5-streak!" if bonus_star else ""
        await self._inject_and_speak(
            f"[CORRECT!]{bonus_text} Celebrate! "
            f"Explain WHY: {explanation} "
            f"Fun fact: {fun_fact} "
            f"Stars: {stars}/{total}. 2-3 sentences only. Then stop.",
            fallback=f"That's right! {explanation} And here's a cool fact — {fun_fact}",
            tag="react_correct",
        )

    async def react_wrong(self, correct_item: str, explanation: str, fun_fact: str):
        await self._inject_and_speak(
            f"[WRONG] Be gentle! The odd one out was {correct_item}. "
            f"Explain: {explanation} Fun fact: {fun_fact} "
            f"Encourage them. 2-3 sentences only. Then stop.",
            fallback=f"Not quite! The odd one out was {correct_item}. {explanation} Here's something cool — {fun_fact}",
            tag="react_wrong",
        )

    async def react_timeout(self, correct_item: str, explanation: str, fun_fact: str):
        await self._inject_and_speak(
            f"[TIMEOUT] Time's up! Be kind. The odd one out was {correct_item}. "
            f"Explain: {explanation} Fun fact: {fun_fact} "
            f"Encourage them. 2-3 sentences only. Then stop.",
            fallback=f"Time's up! The answer was {correct_item}. {explanation} {fun_fact} Let's try the next one!",
            tag="react_timeout",
        )

    async def speak_hint(self, clue: str):
        await self._inject_and_speak(
            f"[HINT] Give this clue in a fun way: {clue}. "
            f"Don't reveal the answer. 1 sentence only. Then stop.",
            fallback=f"Here's a clue! {clue}",
            tag="speak_hint",
        )

    async def announce_level_complete(self, level: int):
        await self._inject_and_speak(
            f"[LEVEL {level} COMPLETE!] Big celebration! "
            f"Harder questions coming. 2 sentences only. Then stop.",
            fallback=f"Amazing! You completed level {level}! Get ready for harder questions!",
            tag="level_complete",
        )

    async def announce_game_over(self, stars: int, total: int):
        await self._inject_and_speak(
            f"[GAME OVER] {self._child_name} got {stars}/{total} stars. "
            f"Be encouraging. 2-3 sentences only. Then stop.",
            fallback=f"Great game {self._child_name}! You got {stars} out of {total} stars! You learned so much today!",
            tag="game_over",
        )

    async def announce_streak(self, streak_count: int):
        await self._inject_and_speak(
            f"[STREAK] The child has a {streak_count}-day streak! Celebrate briefly. 1 sentence.",
            fallback=f"Day {streak_count} streak! Amazing!",
            tag="streak",
        )

    async def announce_achievement(self, achievement_name: str):
        await self._inject_and_speak(
            f"[ACHIEVEMENT] Child unlocked: '{achievement_name}'! Celebrate with excitement. 1-2 sentences.",
            fallback=f"Achievement unlocked! {achievement_name}!",
            tag="achievement",
        )

    async def announce_level_up(self, new_level: int, milestone_name: str = None):
        milestone_text = f" Milestone: '{milestone_name}'!" if milestone_name else ""
        await self._inject_and_speak(
            f"[LEVEL UP] Child reached Level {new_level}!{milestone_text} Celebrate! 1-2 sentences.",
            fallback=f"Level {new_level}!{' ' + milestone_name + '!' if milestone_name else ''} Amazing!",
            tag="level_up",
        )

    async def speak_end_prompt(self, prompt_text: str):
        await self._speak_direct(prompt_text, tag="end_prompt")

    # --- Core ---

    async def _inject_and_speak(self, game_event: str, fallback: str, tag: str):
        """
        Inject game event into agent's chat_ctx → generate_reply() → await SpeechHandle.
        SpeechHandle await blocks until TTS finishes playing.
        """
        logger.info(f"narrator.inject(tag={tag}, event={game_event[:80]})")
        try:
            ctx = self._agent.chat_ctx.copy()
            ctx.add_message(role="system", content=game_event)
            await self._agent.update_chat_ctx(ctx)

            speech_handle = self._session.generate_reply()
            await speech_handle
            logger.info(f"narrator.spoke(tag={tag})")
        except Exception as e:
            logger.error(f"narrator.error(tag={tag}, error={e}), using fallback")
            await self._speak_direct(fallback, tag=f"{tag}_fallback")

    async def _speak_direct(self, text: str, tag: str):
        """Direct TTS via session.say() — fallback only."""
        logger.info(f"narrator.speak_direct(tag={tag}, text={text[:100]})")
        try:
            speech = self._session.say(text, allow_interruptions=False)
            await asyncio.wait_for(speech, timeout=20.0)
            logger.info(f"narrator.spoke(tag={tag})")
        except asyncio.TimeoutError:
            logger.warning(f"narrator.speak_timeout(tag={tag})")
        except Exception as e:
            logger.error(f"narrator.speak_failed(tag={tag}, error={e})")
