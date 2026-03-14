# Yes/No Quiz Agent + Game Dashboard Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a yes/no quiz LiveKit agent (Python backend) and a game dashboard (React frontend) that lets children pick which game to play.

**Architecture:** Clone-and-adapt from math game. Backend is a new Python LiveKit worker with modular engine/state/hints/narrator/pipeline. Frontend is a new React HUD component + pre-connection game dashboard. Communication via LiveKit data channel with typed JSON messages.

**Tech Stack:** Python (LiveKit Agents SDK), React/TypeScript (Next.js), Tailwind CSS, Web Audio API

**Spec:** `docs/superpowers/specs/2026-03-14-yesno-quiz-game-dashboard-design.md`

---

## File Structure

### Backend — New Files (under `main/livekit-server/`)

| File | Responsibility |
|------|---------------|
| `src/games/yesno_quiz_state.py` | Game state class: stars, lives, level, current question, streak |
| `src/features/yesno_game_tools.py` | `check_yesno_answer` LLM tool + yes/no normalization |
| `src/games/yesno_quiz_question_generator.py` | LLM question generation + fallback bank |
| `src/games/yesno_quiz_hints.py` | Verbal hint manager (LLM clue after 10s timeout) |
| `src/games/yesno_quiz_narrator.py` | Response pools for greetings, correct/wrong reactions, fun facts |
| `src/games/yesno_quiz_pipeline.py` | STT/LLM/TTS pipeline with YESNO_LLM_* env vars |
| `src/games/yesno_quiz_engine.py` | Game loop orchestrator: wires state, hints, narrator, data channel |
| `workers/yesno_quiz_worker.py` | Worker entrypoint: prewarm, entrypoint, session setup |

### Backend — Modified Files

| File | Change |
|------|--------|
| `ecosystem.config.js` | Add yesno-quiz-agent PM2 process entry |

### Frontend — New Files (under `D:\agent-starter-react\`)

| File | Responsibility |
|------|---------------|
| `lib/yesno-quiz/types.ts` | TypeScript interfaces for data channel messages |
| `lib/yesno-quiz/sfx.ts` | Sound effects via Web Audio API |
| `hooks/yesno-quiz/use-yesno-quiz.ts` | State hook: listens to data channel, manages game state |
| `components/yesno-quiz/QuestionBubble.tsx` | Question text + category badge |
| `components/yesno-quiz/YesNoButtons.tsx` | YES/NO button panels with feedback states |
| `components/yesno-quiz/FunFactToast.tsx` | Fun fact slide-up toast |
| `components/yesno-quiz/YesNoQuizHUD.tsx` | Main overlay: composes all quiz components |
| `lib/game-dashboard/games.ts` | Game registry: id, name, icon, agent_name, color |
| `components/game-dashboard/GameCard.tsx` | Individual game card with hover/tap effects |
| `components/game-dashboard/GameDashboard.tsx` | Pre-connection game picker screen |

### Frontend — Modified Files

| File | Change |
|------|--------|
| `components/app/app.tsx` | Add `selectedGame` state, show dashboard before connecting |
| `app-config.ts` | Make AGENT_NAME a fallback, support dynamic override |
| `components/agents-ui/blocks/agent-session-view-01/components/agent-session-block.tsx` | Add `<YesNoQuizHUD />` overlay |
| `styles/globals.css` | Add `animate-slide-up` and `animate-fade-out` keyframes |

---

## Chunk 1: Backend Core (State + Tools + Question Generator)

### Task 1: Create YesNoQuizState

**Files:**
- Create: `main/livekit-server/src/games/yesno_quiz_state.py`
- Reference: `main/livekit-server/src/games/math_game.py` (MathGameState pattern)

- [ ] **Step 1: Read the math game state module**

Read `main/livekit-server/src/games/math_game.py` to understand `MathGameState` class structure: fields, `_get_progress()`, `reset()`, mode handling.

- [ ] **Step 2: Create yesno_quiz_state.py**

```python
"""Yes/No Quiz game state management."""
import uuid
import logging

logger = logging.getLogger("yesno_quiz_state")


class YesNoQuizState:
    """Tracks game progress: stars, lives, streak, current question."""

    def __init__(self, game_mode: str = "explorer"):
        self.game_mode = game_mode
        self.stars = 0
        self.total_needed = 5
        self.lives = 3 if game_mode == "commander" else None
        self.max_lives = 3 if game_mode == "commander" else None
        self.level = 1
        self.mission_number = 1
        self.current_question_id = ""
        self.current_question = None  # {question, correct_answer, fun_fact, category}
        self.consecutive_correct = 0
        self.questions_asked = 0
        self.used_categories = []

    def _get_progress(self) -> dict:
        return {
            "stars": self.stars,
            "total_needed": self.total_needed,
            "lives": self.lives,
            "max_lives": self.max_lives,
            "mission_number": self.mission_number,
            "level": self.level,
        }

    def set_question(self, question: dict):
        self.current_question_id = str(uuid.uuid4())
        self.current_question = question
        self.questions_asked += 1
        if question.get("category"):
            self.used_categories.append(question["category"])

    def record_answer(self, correct: bool) -> dict:
        """Record answer, update state, return result metadata."""
        bonus_star = False
        if correct:
            self.stars += 1
            self.consecutive_correct += 1
            if self.consecutive_correct >= 5:
                self.stars += 1
                bonus_star = True
                logger.info(f"state.bonus_star(streak={self.consecutive_correct})")
        else:
            self.consecutive_correct = 0
            if self.game_mode == "commander" and self.lives is not None:
                self.lives -= 1

        game_complete = self.stars >= self.total_needed
        game_over = (self.game_mode == "commander"
                     and self.lives is not None
                     and self.lives <= 0)

        return {
            "game_complete": game_complete,
            "game_over": game_over,
            "bonus_star": bonus_star,
            "consecutive_correct": self.consecutive_correct,
        }

    def advance_level(self):
        self.level += 1
        self.mission_number += 1
        self.stars = 0
        self.consecutive_correct = 0
        self.used_categories = []
        if self.game_mode == "commander":
            self.lives = self.max_lives

    def reset(self):
        self.__init__(game_mode=self.game_mode)
```

- [ ] **Step 3: Verify file is importable**

Run: `cd main/livekit-server && python -c "from src.games.yesno_quiz_state import YesNoQuizState; s = YesNoQuizState('explorer'); print(s._get_progress())"`
Expected: `{'stars': 0, 'total_needed': 5, 'lives': None, 'max_lives': None, 'mission_number': 1, 'level': 1}`

- [ ] **Step 4: Commit**

```bash
git add main/livekit-server/src/games/yesno_quiz_state.py
git commit -m "feat(yesno-quiz): add YesNoQuizState game state module"
```

---

### Task 2: Create check_yesno_answer Tool

**Files:**
- Create: `main/livekit-server/src/features/yesno_game_tools.py`
- Reference: `main/livekit-server/src/features/game_tools.py` (math game tool pattern)

- [ ] **Step 1: Read the math game tools module**

Read `main/livekit-server/src/features/game_tools.py` to understand: `@function_tool` usage, global state setter pattern, `_parse_number_from_text`, result JSON format.

- [ ] **Step 2: Create yesno_game_tools.py**

```python
"""Yes/No Quiz game tools — LLM function tools for voice answer processing."""
import json
import logging
import time
from livekit.agents import function_tool

logger = logging.getLogger("yesno_game_tools")

# Module-level game state (set by worker at startup)
_yesno_game_state = None


def set_yesno_game_state(state):
    global _yesno_game_state
    _yesno_game_state = state


# Normalization tables
YES_WORDS = {
    "yes", "yeah", "yep", "yup", "sure", "correct", "true", "right",
    "uh huh", "mm hmm", "yah", "ya", "si", "of course", "definitely",
    # Hindi
    "haan", "ha", "haji", "sahi", "bilkul",
}

NO_WORDS = {
    "no", "nah", "nope", "naw", "nuh", "false", "wrong", "never",
    "uh uh", "mm mm", "nay", "not",
    # Hindi
    "nahi", "nahin", "naa", "galat", "bilkul nahi",
}

UNKNOWN_WORDS = {"i don't know", "don't know", "not sure", "maybe", "idk"}


def _normalize_yesno(text: str) -> str | None:
    """Normalize spoken text to 'yes', 'no', or None (unknown)."""
    cleaned = text.strip().lower().rstrip(".,!?")

    # Direct match
    if cleaned in YES_WORDS:
        return "yes"
    if cleaned in NO_WORDS:
        return "no"

    # Check if any YES/NO word appears in the text
    for word in YES_WORDS:
        if word in cleaned:
            return "yes"
    for word in NO_WORDS:
        if word in cleaned:
            return "no"

    # Unknown / ambiguous
    return None


@function_tool
async def check_yesno_answer(answer: str) -> str:
    """Check if the child's yes/no answer is correct.

    Args:
        answer: The child's spoken answer, e.g. "yes", "no", "yeah", "nahi"
    """
    state = _yesno_game_state
    if not state or not state.current_question:
        return json.dumps({"error": "no_active_question"})

    normalized = _normalize_yesno(answer)

    if normalized is None:
        # Ambiguous — prompt child to try again
        return json.dumps({
            "action": "prompt_retry",
            "message": "I didn't catch that! Try saying YES or NO.",
            "original_text": answer,
        })

    correct_answer = state.current_question.get("correct_answer", True)
    user_said_yes = (normalized == "yes")
    is_correct = (user_said_yes == correct_answer)

    result_meta = state.record_answer(is_correct)

    result = {
        "action": "answer_checked",
        "correct": is_correct,
        "user_answer": normalized,
        "correct_answer": correct_answer,
        "fun_fact": state.current_question.get("fun_fact", ""),
        "question_id": state.current_question_id,
        "input_method": "voice",
        "progress": state._get_progress(),
        **result_meta,
    }

    logger.info(f"tool.check_yesno(answer={normalized}, correct={is_correct}, "
                f"stars={state.stars}, streak={state.consecutive_correct})")

    return json.dumps(result)
```

- [ ] **Step 3: Verify normalization works**

Run: `cd main/livekit-server && python -c "from src.features.yesno_game_tools import _normalize_yesno; print(_normalize_yesno('yeah')); print(_normalize_yesno('nahi')); print(_normalize_yesno('banana'))"`
Expected: `yes`, `no`, `None`

- [ ] **Step 4: Commit**

```bash
git add main/livekit-server/src/features/yesno_game_tools.py
git commit -m "feat(yesno-quiz): add check_yesno_answer tool with voice normalization"
```

---

### Task 3: Create Question Generator

**Files:**
- Create: `main/livekit-server/src/games/yesno_quiz_question_generator.py`
- Reference: `main/livekit-server/src/games/math_game_question_generator.py`

- [ ] **Step 1: Read the math game question generator**

Read `main/livekit-server/src/games/math_game_question_generator.py` to understand: LLM client setup, prompt structure, JSON parsing, error handling, fallback pattern.

- [ ] **Step 2: Create yesno_quiz_question_generator.py**

```python
"""Yes/No Quiz question generator — uses LLM to create fun-fact yes/no questions."""
import os
import json
import random
import logging
from openai import AsyncOpenAI

logger = logging.getLogger("yesno_quiz_question_generator")

CATEGORIES = ["animals", "science", "geography", "food", "space", "nature", "human body", "history"]

FALLBACK_QUESTIONS = [
    {"question": "Do fish live in water?", "correct_answer": True, "fun_fact": "Fish breathe using gills!", "category": "animals"},
    {"question": "Is the sun a star?", "correct_answer": True, "fun_fact": "The sun is the closest star to Earth!", "category": "space"},
    {"question": "Do penguins fly?", "correct_answer": False, "fun_fact": "Penguins are great swimmers instead!", "category": "animals"},
    {"question": "Is ice cream hot?", "correct_answer": False, "fun_fact": "Ice cream is frozen and usually around -15 degrees!", "category": "food"},
    {"question": "Does the Earth go around the Sun?", "correct_answer": True, "fun_fact": "It takes 365 days to go all the way around!", "category": "space"},
    {"question": "Do elephants have wings?", "correct_answer": False, "fun_fact": "Elephants are the largest land animals!", "category": "animals"},
    {"question": "Is water wet?", "correct_answer": True, "fun_fact": "Water covers about 71 percent of Earth!", "category": "science"},
    {"question": "Do trees make oxygen?", "correct_answer": True, "fun_fact": "One big tree can make enough oxygen for 4 people!", "category": "nature"},
    {"question": "Is the moon made of cheese?", "correct_answer": False, "fun_fact": "The moon is made of rock and dust!", "category": "space"},
    {"question": "Do cats have tails?", "correct_answer": True, "fun_fact": "A cat uses its tail for balance!", "category": "animals"},
    {"question": "Does it snow in the desert?", "correct_answer": True, "fun_fact": "The Sahara Desert has had snow! It happened in 2018.", "category": "geography"},
    {"question": "Do humans have more than 200 bones?", "correct_answer": True, "fun_fact": "Adults have 206 bones, but babies have about 270!", "category": "human body"},
]

SYSTEM_PROMPT = """You are generating fun yes/no trivia questions for children.
Return ONLY valid JSON with no extra text, no markdown, no explanation.
Format: {{"question": "...", "correct_answer": true/false, "fun_fact": "...", "category": "..."}}"""


def _get_user_prompt(age: int, topic: str, used_categories: list[str] = None) -> str:
    avoid = ""
    if used_categories:
        avoid = f"\nAvoid these recently used categories: {', '.join(used_categories[-3:])}"
    return f"""Generate a fun yes/no trivia question for a {age}-year-old child about {topic}.

Rules:
- The question MUST be answerable with YES or NO
- Use simple, age-appropriate language
- Make it fun and educational
- Include a short fun fact (1-2 sentences) to reveal after answering
- Difficulty: {"very simple, obvious facts" if age <= 5 else "moderate, interesting facts" if age <= 9 else "challenging, surprising facts"}
{avoid}"""


class QuestionGenerator:
    """Generates yes/no questions via LLM with fallback bank."""

    def __init__(self):
        provider = os.getenv("YESNO_LLM_PROVIDER", "openrouter")
        model = os.getenv("YESNO_LLM_MODEL", "openai/gpt-4o-mini")

        if provider == "openrouter":
            self.client = AsyncOpenAI(
                api_key=os.getenv("OPENROUTER_API_KEY"),
                base_url="https://openrouter.ai/api/v1",
            )
        else:
            self.client = AsyncOpenAI(api_key=os.getenv("OPENAI_API_KEY"))

        self.model = model
        self._fallback_index = 0
        random.shuffle(FALLBACK_QUESTIONS)

    async def generate(self, age: int, used_categories: list[str] = None) -> dict:
        """Generate a yes/no question. Falls back to bank on LLM failure."""
        # Pick topic, avoiding recently used categories
        available = [c for c in CATEGORIES if c not in (used_categories or [])[-3:]]
        topic = random.choice(available) if available else random.choice(CATEGORIES)

        try:
            response = await self.client.chat.completions.create(
                model=self.model,
                messages=[
                    {"role": "system", "content": SYSTEM_PROMPT},
                    {"role": "user", "content": _get_user_prompt(age, topic, used_categories)},
                ],
                temperature=0.9,
                max_tokens=200,
                timeout=8,
            )
            text = response.choices[0].message.content.strip()
            # Strip markdown code fences if present
            if text.startswith("```"):
                text = text.split("\n", 1)[1] if "\n" in text else text[3:]
                if text.endswith("```"):
                    text = text[:-3]
                text = text.strip()

            question = json.loads(text)
            # Validate required fields
            if not all(k in question for k in ("question", "correct_answer", "fun_fact")):
                raise ValueError(f"Missing fields in LLM response: {text[:200]}")
            if "category" not in question:
                question["category"] = topic

            logger.info(f"qgen.generated(category={question['category']}, q={question['question'][:60]})")
            return question

        except Exception as e:
            logger.warning(f"qgen.fallback(error={e})")
            return self._get_fallback()

    def _get_fallback(self) -> dict:
        """Return next fallback question, cycling through the bank."""
        q = FALLBACK_QUESTIONS[self._fallback_index % len(FALLBACK_QUESTIONS)]
        self._fallback_index += 1
        return dict(q)  # return copy
```

- [ ] **Step 3: Verify import and fallback**

Run: `cd main/livekit-server && python -c "from src.games.yesno_quiz_question_generator import QuestionGenerator; qg = QuestionGenerator(); print(qg._get_fallback())"`
Expected: One of the fallback questions printed as dict.

- [ ] **Step 4: Commit**

```bash
git add main/livekit-server/src/games/yesno_quiz_question_generator.py
git commit -m "feat(yesno-quiz): add LLM question generator with fallback bank"
```

---

## Chunk 2: Backend Modules (Hints + Narrator + Pipeline + Engine)

### Task 4: Create Hint Manager

**Files:**
- Create: `main/livekit-server/src/games/yesno_quiz_hints.py`
- Reference: `main/livekit-server/src/games/math_game_hints.py`

- [ ] **Step 1: Read the math game hints module**

Read `main/livekit-server/src/games/math_game_hints.py` to understand: timer-based hint system, `HintManager` class, `asyncio.get_event_loop().call_later()` pattern, cancellation.

- [ ] **Step 2: Create yesno_quiz_hints.py**

The yes/no hint manager uses two timers:
- Timer 1 (10s): Trigger verbal hint via LLM
- Timer 2 (20s): Timeout, mark wrong

```python
"""Yes/No Quiz hint manager — verbal hints via LLM after silence timeout."""
import os
import json
import asyncio
import logging
from typing import Callable, Awaitable
from openai import AsyncOpenAI

logger = logging.getLogger("yesno_quiz_hints")

HINT_PROMPT = """The child was asked: "{question}"
The correct answer is: {answer}
Give a short, fun hint (1 sentence max) that helps the child think about the answer without directly saying YES or NO. Make it playful and encouraging."""


class YesNoHintManager:
    """Manages silence timers and generates verbal hints via LLM."""

    HINT_DELAY_S = 10
    TIMEOUT_DELAY_S = 20

    def __init__(self, game_state, on_hint: Callable, on_timeout: Callable):
        self._state = game_state
        self._on_hint = on_hint      # async callback(question_id, hint_text)
        self._on_timeout = on_timeout  # async callback(question_id)
        self._hint_timer = None
        self._timeout_timer = None
        self._current_question_id = None

        provider = os.getenv("YESNO_LLM_PROVIDER", "openrouter")
        if provider == "openrouter":
            self._llm = AsyncOpenAI(
                api_key=os.getenv("OPENROUTER_API_KEY"),
                base_url="https://openrouter.ai/api/v1",
            )
        else:
            self._llm = AsyncOpenAI(api_key=os.getenv("OPENAI_API_KEY"))
        self._model = os.getenv("YESNO_LLM_MODEL", "openai/gpt-4o-mini")

    def start_timers(self, question_id: str):
        """Start hint and timeout timers for a new question."""
        self.cancel_timers()
        self._current_question_id = question_id

        loop = asyncio.get_event_loop()
        self._hint_timer = loop.call_later(
            self.HINT_DELAY_S,
            lambda: asyncio.ensure_future(self._trigger_hint(question_id))
        )
        self._timeout_timer = loop.call_later(
            self.TIMEOUT_DELAY_S,
            lambda: asyncio.ensure_future(self._trigger_timeout(question_id))
        )
        logger.info(f"hints.timers_started(question_id={question_id})")

    def cancel_timers(self):
        """Cancel all active timers (called when answer received)."""
        if self._hint_timer:
            self._hint_timer.cancel()
            self._hint_timer = None
        if self._timeout_timer:
            self._timeout_timer.cancel()
            self._timeout_timer = None

    async def _trigger_hint(self, question_id: str):
        """Generate and deliver verbal hint via LLM."""
        if question_id != self._current_question_id:
            return
        if not self._state.current_question:
            return

        q = self._state.current_question
        answer_text = "YES" if q.get("correct_answer", True) else "NO"

        try:
            response = await self._llm.chat.completions.create(
                model=self._model,
                messages=[
                    {"role": "user", "content": HINT_PROMPT.format(
                        question=q["question"], answer=answer_text
                    )}
                ],
                temperature=0.8,
                max_tokens=60,
                timeout=5,
            )
            hint_text = response.choices[0].message.content.strip()
        except Exception as e:
            logger.warning(f"hints.llm_error(error={e})")
            hint_text = "Think about it carefully! What do you think?"

        logger.info(f"hints.verbal_hint(question_id={question_id}, hint={hint_text[:60]})")
        await self._on_hint(question_id, hint_text)

    async def _trigger_timeout(self, question_id: str):
        """Handle answer timeout — mark as wrong, move on."""
        if question_id != self._current_question_id:
            return
        logger.info(f"hints.timeout(question_id={question_id})")
        await self._on_timeout(question_id)
```

- [ ] **Step 3: Verify import**

Run: `cd main/livekit-server && python -c "from src.games.yesno_quiz_hints import YesNoHintManager; print('OK')"`

- [ ] **Step 4: Commit**

```bash
git add main/livekit-server/src/games/yesno_quiz_hints.py
git commit -m "feat(yesno-quiz): add verbal hint manager with LLM clue generation"
```

---

### Task 5: Create Narrator

**Files:**
- Create: `main/livekit-server/src/games/yesno_quiz_narrator.py`
- Reference: `main/livekit-server/src/games/math_game_narrator.py`

- [ ] **Step 1: Read the math game narrator**

Read `main/livekit-server/src/games/math_game_narrator.py` to understand: response pools, `speak()` method, `generate_reply()` usage, agent session integration.

- [ ] **Step 2: Create yesno_quiz_narrator.py**

Adapt the narrator with yes/no-specific response pools. Key difference: includes fun fact narration and verbal hint speaking.

```python
"""Yes/No Quiz narrator — speaks questions, results, hints, and fun facts."""
import random
import logging

logger = logging.getLogger("yesno_quiz_narrator")

GREETINGS = [
    "Hey {name}! I'm Cheeko, your fun facts buddy! Let's see how much you know!",
    "Hi {name}! Ready for some amazing facts? Let's play!",
    "Welcome {name}! I've got some cool questions for you. Let's go!",
]

CORRECT_RESPONSES = [
    "That's right! Great job! Here's a fun fact: {fun_fact}",
    "You got it! And did you know? {fun_fact}",
    "Correct! Here's something cool: {fun_fact}",
    "Yes! You're so smart! Listen to this: {fun_fact}",
    "Awesome! And here's a fun fact for you: {fun_fact}",
]

WRONG_RESPONSES = [
    "Oops, that's not quite right! But here's something cool: {fun_fact}",
    "Not this time! But did you know? {fun_fact}",
    "Almost! The answer was {answer}. Here's a fun fact: {fun_fact}",
    "Good try! It was actually {answer}. And listen to this: {fun_fact}",
]

TIMEOUT_RESPONSES = [
    "Time's up! The answer was {answer}. Here's a fun fact: {fun_fact}",
    "Let me tell you — it was {answer}! And did you know? {fun_fact}",
]

LEVEL_COMPLETE = [
    "Amazing! You completed the level! You're a fun facts champion!",
    "Level done! You really know your stuff, {name}!",
    "Wow, you got all the stars! Ready for the next challenge?",
]

GAME_OVER = [
    "Good try, {name}! You learned so many cool facts today!",
    "That was fun! You discovered so many amazing things!",
]

STREAK_RESPONSES = [
    "You're on fire! {streak} in a row!",
    "Incredible streak — {streak} correct!",
    "Unstoppable! {streak} right answers!",
]

NEXT_QUESTION_TRANSITIONS = [
    "Here's the next one!",
    "Ready? Next question!",
    "Let's try another one!",
    "Okay, here we go!",
]


class YesNoNarrator:
    """Speaks game events via the agent session's generate_reply."""

    def __init__(self, session):
        self._session = session

    async def speak(self, text: str):
        """Send text to the agent to speak via TTS."""
        logger.info(f"narrator.speak(text={text[:80]})")
        await self._session.generate_reply(instructions=text)

    async def greet(self, child_name: str):
        text = random.choice(GREETINGS).format(name=child_name)
        await self.speak(text)

    async def announce_question(self, question_text: str):
        await self.speak(question_text)

    async def react_correct(self, fun_fact: str, streak: int = 0):
        text = random.choice(CORRECT_RESPONSES).format(fun_fact=fun_fact)
        if streak >= 3:
            text += " " + random.choice(STREAK_RESPONSES).format(streak=streak)
        await self.speak(text)

    async def react_wrong(self, fun_fact: str, correct_answer: bool):
        answer_text = "YES" if correct_answer else "NO"
        text = random.choice(WRONG_RESPONSES).format(fun_fact=fun_fact, answer=answer_text)
        await self.speak(text)

    async def react_timeout(self, fun_fact: str, correct_answer: bool):
        answer_text = "YES" if correct_answer else "NO"
        text = random.choice(TIMEOUT_RESPONSES).format(fun_fact=fun_fact, answer=answer_text)
        await self.speak(text)

    async def speak_hint(self, hint_text: str):
        await self.speak(f"Here's a little hint: {hint_text}")

    async def announce_level_complete(self, child_name: str):
        text = random.choice(LEVEL_COMPLETE).format(name=child_name)
        await self.speak(text)

    async def announce_game_over(self, child_name: str):
        text = random.choice(GAME_OVER).format(name=child_name)
        await self.speak(text)

    async def transition_to_next(self):
        text = random.choice(NEXT_QUESTION_TRANSITIONS)
        await self.speak(text)

    async def speak_end_prompt(self, text: str):
        await self.speak(text)
```

- [ ] **Step 3: Verify import**

Run: `cd main/livekit-server && python -c "from src.games.yesno_quiz_narrator import YesNoNarrator; print('OK')"`

- [ ] **Step 4: Commit**

```bash
git add main/livekit-server/src/games/yesno_quiz_narrator.py
git commit -m "feat(yesno-quiz): add narrator with fun-fact response pools"
```

---

### Task 6: Create Pipeline

**Files:**
- Create: `main/livekit-server/src/games/yesno_quiz_pipeline.py`
- Reference: `main/livekit-server/src/games/math_game_pipeline.py`

- [ ] **Step 1: Read the math game pipeline**

Read `main/livekit-server/src/games/math_game_pipeline.py` to understand: plugin imports, STT/LLM/TTS creation, provider selection, keyterms, env var usage.

- [ ] **Step 2: Create yesno_quiz_pipeline.py**

Clone the math game pipeline but:
- Use `YESNO_LLM_PROVIDER` and `YESNO_LLM_MODEL` env vars
- Use yes/no-specific STT keyterms (yes, no, haan, nahi, etc.)
- Same TTS config

```python
"""Yes/No Quiz pipeline — STT, LLM, TTS configuration."""
import os
import logging

logger = logging.getLogger("yesno_quiz_pipeline")

# NOTE: Copy the math_game_pipeline.py structure exactly, changing:
# 1. MATH_LLM_PROVIDER → YESNO_LLM_PROVIDER
# 2. MATH_LLM_MODEL → YESNO_LLM_MODEL
# 3. keyterms_prompt → ["yes", "no", "yeah", "nah", "haan", "nahi", "true", "false"]
# 4. Logger name → "yesno_quiz_pipeline"
```

The actual implementation should be a direct copy of `math_game_pipeline.py` with the above substitutions. Read the source file and replicate.

- [ ] **Step 3: Verify import**

Run: `cd main/livekit-server && python -c "from src.games.yesno_quiz_pipeline import create_pipeline; print('OK')"`

- [ ] **Step 4: Commit**

```bash
git add main/livekit-server/src/games/yesno_quiz_pipeline.py
git commit -m "feat(yesno-quiz): add STT/LLM/TTS pipeline with YESNO env vars"
```

---

### Task 7: Create Game Engine

**Files:**
- Create: `main/livekit-server/src/games/yesno_quiz_engine.py`
- Reference: `main/livekit-server/src/games/math_game_engine.py`

- [ ] **Step 1: Read the math game engine**

Read `main/livekit-server/src/games/math_game_engine.py` thoroughly. Understand: game loop, `on_game_start`, question flow, answer processing, hint callbacks, data channel sends, level/game-over handling.

- [ ] **Step 2: Create yesno_quiz_engine.py**

This is the core orchestrator. Key differences from math engine:
- Questions are yes/no (not multiple choice)
- No option elimination hints (verbal hints instead)
- Fun fact revealed after each answer
- No retry on wrong answer (always move to next)

```python
"""Yes/No Quiz game engine — orchestrates game loop."""
import asyncio
import logging
import time

logger = logging.getLogger("yesno_quiz_engine")


class YesNoQuizEngine:
    """Wires state, narrator, hints, data channel, and question generator."""

    def __init__(self, state, narrator, hint_manager, data_channel, question_generator, session, child_age=5):
        self._state = state
        self._narrator = narrator
        self._hints = hint_manager
        self._dc = data_channel
        self._qgen = question_generator
        self._session = session
        self._child_age = child_age
        self._child_name = "buddy"
        self._processing_answer = False
        self._answer_timestamp = None

    async def on_game_start(self, child_name: str, age: int, game_mode: str):
        """Start the game: greet and send first question."""
        self._child_name = child_name
        self._child_age = age
        logger.info(f"engine.game_start(name={child_name}, age={age}, mode={game_mode})")

        await self._dc.send({
            "type": "game_state",
            "state": "started",
            "game_mode": game_mode,
            "progress": self._state._get_progress(),
        })

        await self._narrator.greet(child_name)
        await self._generate_and_send_question()

    async def _generate_and_send_question(self):
        """Generate a new question and send to frontend."""
        question = await self._qgen.generate(
            self._child_age,
            used_categories=self._state.used_categories,
        )
        self._state.set_question(question)
        self._processing_answer = False
        self._answer_timestamp = time.time()

        await self._dc.send({
            "type": "yesno_question",
            "question_id": self._state.current_question_id,
            "question_text": question["question"],
            "category": question.get("category", "general"),
            "game_mode": self._state.game_mode,
            "progress": self._state._get_progress(),
        })

        # Start hint/timeout timers
        self._hints.start_timers(self._state.current_question_id)

        # Narrator reads the question
        await self._narrator.announce_question(question["question"])

    async def on_tap_answer(self, message: dict):
        """Handle answer from frontend tap (YES/NO button)."""
        if self._processing_answer:
            return
        question_id = message.get("question_id")
        if question_id != self._state.current_question_id:
            logger.warning(f"engine.stale_answer(got={question_id}, expected={self._state.current_question_id})")
            return

        value = message.get("value")  # "yes" or "no"
        logger.info(f"engine.tap_answer(value={value}, question_id={question_id})")
        await self._process_answer(value, "tap")

    async def on_voice_answer(self, result: dict):
        """Handle answer from voice (LLM tool result)."""
        if self._processing_answer:
            return
        action = result.get("action")
        if action == "prompt_retry":
            # Ambiguous voice input — prompt child
            await self._narrator.speak(result.get("message", "Try saying YES or NO!"))
            return
        if action != "answer_checked":
            return

        logger.info(f"engine.voice_answer(answer={result.get('user_answer')}, correct={result.get('correct')})")
        # State already updated by the tool — just send result and advance
        self._processing_answer = True
        self._hints.cancel_timers()
        await self._send_result_and_advance(result)

    async def _process_answer(self, answer: str, input_method: str):
        """Score the answer, send result, advance game."""
        self._processing_answer = True
        self._hints.cancel_timers()

        correct_answer = self._state.current_question.get("correct_answer", True)
        user_said_yes = (answer == "yes")
        is_correct = (user_said_yes == correct_answer)

        result_meta = self._state.record_answer(is_correct)

        result = {
            "action": "answer_checked",
            "correct": is_correct,
            "user_answer": answer,
            "correct_answer": correct_answer,
            "fun_fact": self._state.current_question.get("fun_fact", ""),
            "question_id": self._state.current_question_id,
            "input_method": input_method,
            "progress": self._state._get_progress(),
            **result_meta,
        }

        await self._send_result_and_advance(result)

    async def _send_result_and_advance(self, result: dict):
        """Send result to frontend and handle game progression."""
        await self._dc.send({
            "type": "yesno_result",
            **{k: v for k, v in result.items() if k != "action"},
        })

        fun_fact = result.get("fun_fact", "")
        correct = result.get("correct", False)
        correct_answer = result.get("correct_answer", True)
        streak = result.get("consecutive_correct", 0)

        # Narrate result
        if result.get("input_method") == "timeout":
            await self._narrator.react_timeout(fun_fact, correct_answer)
        elif correct:
            await self._narrator.react_correct(fun_fact, streak)
        else:
            await self._narrator.react_wrong(fun_fact, correct_answer)

        # Check game end conditions
        if result.get("game_complete"):
            await self._handle_level_complete()
        elif result.get("game_over"):
            await self._handle_game_over()
        else:
            # Brief pause, then next question
            await asyncio.sleep(1.0)
            await self._narrator.transition_to_next()
            await self._generate_and_send_question()

    async def on_hint_triggered(self, question_id: str, hint_text: str):
        """Handle verbal hint from hint manager."""
        if question_id != self._state.current_question_id:
            return
        if self._processing_answer:
            return

        await self._dc.send({
            "type": "yesno_hint",
            "question_id": question_id,
            "hint_text": hint_text,
        })
        await self._narrator.speak_hint(hint_text)

    async def on_timeout(self, question_id: str):
        """Handle answer timeout — mark wrong and move on."""
        if question_id != self._state.current_question_id:
            return
        if self._processing_answer:
            return

        logger.info(f"engine.timeout(question_id={question_id})")

        correct_answer = self._state.current_question.get("correct_answer", True)
        result_meta = self._state.record_answer(False)

        result = {
            "action": "answer_checked",
            "correct": False,
            "user_answer": None,
            "correct_answer": correct_answer,
            "fun_fact": self._state.current_question.get("fun_fact", ""),
            "question_id": question_id,
            "input_method": "timeout",
            "progress": self._state._get_progress(),
            **result_meta,
        }
        await self._send_result_and_advance(result)

    async def _handle_level_complete(self):
        """Handle level completion."""
        logger.info(f"engine.level_complete(level={self._state.level})")
        await self._dc.send({
            "type": "game_state",
            "state": "completed",
            "game_mode": self._state.game_mode,
            "progress": self._state._get_progress(),
        })
        await self._narrator.announce_level_complete(self._child_name)
        self._state.advance_level()

    async def _handle_game_over(self):
        """Handle game over (commander mode, 0 lives)."""
        logger.info("engine.game_over")
        await self._dc.send({
            "type": "game_state",
            "state": "game_over",
            "game_mode": self._state.game_mode,
            "progress": self._state._get_progress(),
        })
        await self._narrator.announce_game_over(self._child_name)

    async def on_game_control(self, message: dict):
        """Handle game control messages (restart, next_level)."""
        action = message.get("action")
        logger.info(f"engine.game_control(action={action})")
        if action == "restart":
            self._state.reset()
            await self._dc.send({
                "type": "game_state",
                "state": "restarted",
                "game_mode": self._state.game_mode,
                "progress": self._state._get_progress(),
            })
            await self.on_game_start(self._child_name, self._child_age, self._state.game_mode)
        elif action == "next_level":
            await self._generate_and_send_question()
```

- [ ] **Step 3: Verify import**

Run: `cd main/livekit-server && python -c "from src.games.yesno_quiz_engine import YesNoQuizEngine; print('OK')"`

- [ ] **Step 4: Commit**

```bash
git add main/livekit-server/src/games/yesno_quiz_engine.py
git commit -m "feat(yesno-quiz): add game engine orchestrator"
```

---

### Task 8: Create Worker Entrypoint

**Files:**
- Create: `main/livekit-server/workers/yesno_quiz_worker.py`
- Reference: `main/livekit-server/workers/math_game_worker.py`

- [ ] **Step 1: Re-read the math game worker**

Read `main/livekit-server/workers/math_game_worker.py` one more time to ensure exact structural parity.

- [ ] **Step 2: Create yesno_quiz_worker.py**

Direct adaptation of math_game_worker.py:
- Import yesno modules instead of math modules
- Use `check_yesno_answer` tool
- Wire `YesNoQuizEngine` with `YesNoHintManager`, `YesNoNarrator`, `DataChannel`, `QuestionGenerator`
- Register `yesno_answer` data channel handler
- Agent prompt instructs LLM to call `check_yesno_answer` on voice input

```python
"""
Yes/No Quiz Agent Worker
Fun facts quiz with yes/no answers, progressive hints, and age-based modes.

agent_name: yesno-quiz-agent
Port: 8090
"""

import os
import sys
import json
import asyncio
import platform

if platform.system() == "Windows":
    asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from dotenv import load_dotenv
load_dotenv(".env")

import logging
from livekit.agents import (
    AgentSession, JobContext, JobProcess, WorkerOptions, cli, AutoSubscribe,
)
from livekit.agents import Agent

from src.config.config_loader import ConfigLoader
from src.utils.helpers import UsageManager
from src.utils.database_helper import DatabaseHelper
from src.shared.entrypoint_utils import parse_room_name
from src.features.yesno_game_tools import check_yesno_answer, set_yesno_game_state
from src.games.yesno_quiz_state import YesNoQuizState
from src.games.yesno_quiz_pipeline import create_pipeline
from src.games.math_game_data_channel import DataChannel
from src.games.yesno_quiz_hints import YesNoHintManager
from src.games.yesno_quiz_narrator import YesNoNarrator
from src.games.yesno_quiz_engine import YesNoQuizEngine
from src.games.yesno_quiz_question_generator import QuestionGenerator

logger = logging.getLogger("yesno_quiz_worker")

AGENT_NAME = "yesno-quiz-agent"
CHARACTER_NAME = "Fact Finder"
DEFAULT_PORT = 8090


class FactFinderAgent(Agent):
    """Agent subclass that suppresses tool-call text from TTS."""

    async def llm_node(self, chat_ctx, tools, model_settings):
        has_tool_calls = False
        collected_text = []
        async for chunk in super().llm_node(chat_ctx, tools, model_settings):
            if hasattr(chunk, "delta") and chunk.delta:
                if getattr(chunk.delta, "tool_calls", None):
                    if not has_tool_calls:
                        logger.debug("agent.llm_tool_call_detected")
                    has_tool_calls = True
                if has_tool_calls and getattr(chunk.delta, "content", None):
                    chunk.delta.content = None
                elif getattr(chunk.delta, "content", None):
                    collected_text.append(chunk.delta.content)
            yield chunk

        full_text = "".join(collected_text)
        if full_text:
            logger.info(f"agent.tts_input: {full_text[:500]}")


def prewarm(proc: JobProcess):
    logger.info("worker.prewarm_start")
    import src.games.yesno_quiz_pipeline  # noqa: F401
    yaml_config = ConfigLoader.load_yaml_config()
    proc.userdata["yaml_config"] = yaml_config
    proc.userdata["tts_config"] = ConfigLoader.get_tts_config()

    manager_api_url = os.getenv("MANAGER_API_URL")
    manager_api_secret = os.getenv("MANAGER_API_SECRET")
    if manager_api_url and manager_api_secret:
        proc.userdata["db_helper"] = DatabaseHelper(manager_api_url, manager_api_secret)

    logger.info("worker.prewarm_done")


async def entrypoint(ctx: JobContext):
    room_name = ctx.room.name
    device_mac, room_type = parse_room_name(room_name)
    logger.info(f"worker.entrypoint(room={room_name}, device_mac={device_mac})")

    yaml_config = ctx.proc.userdata.get("yaml_config") or ConfigLoader.load_yaml_config()

    api_keys = yaml_config.get("api_keys", {})
    if "google" in api_keys and not os.getenv("GOOGLE_API_KEY"):
        os.environ["GOOGLE_API_KEY"] = api_keys["google"]

    # Child profile
    child_profile = None
    try:
        if hasattr(ctx, "job") and ctx.job and ctx.job.metadata:
            dispatch_metadata = json.loads(ctx.job.metadata)
            child_profile = dispatch_metadata.get("child_profile")
            if child_profile:
                logger.info(f"worker.child_profile(name={child_profile.get('name')}, source=dispatch)")
    except Exception as e:
        logger.debug(f"worker.dispatch_metadata_error(error={e})")

    if not child_profile and device_mac:
        try:
            db_helper = ctx.proc.userdata.get("db_helper")
            if not db_helper:
                db_helper = DatabaseHelper(os.getenv("MANAGER_API_URL"), os.getenv("MANAGER_API_SECRET"))
            child_profile = await db_helper.get_child_profile_by_mac(device_mac)
        except Exception as e:
            logger.error(f"worker.child_profile_error(error={e})")

    # Prompt
    child_name = child_profile.get("name", "buddy") if child_profile else "buddy"
    child_age = child_profile.get("age", 5) if child_profile else 5

    agent_prompt = f"""You are Cheeko, a friendly fun facts quiz buddy for {child_name} (age {child_age}).

You have TWO jobs:
1. When the child says "yes", "no", "yeah", "nah", "haan", "nahi", or similar, call check_yesno_answer with their answer.
2. When you receive instructions (via generate_reply), follow them EXACTLY.

RULES:
- NEVER ask questions yourself. The server handles all questions.
- NEVER make up your own content.
- When the child says something unrelated, respond warmly in 1 short sentence.
- Keep all responses to 1-2 sentences maximum."""

    # Game mode
    game_mode = "commander" if child_age >= 7 else "explorer"

    # Pipeline
    stt, llm, tts = create_pipeline(yaml_config)

    # State
    game_state = YesNoQuizState(game_mode=game_mode)
    set_yesno_game_state(game_state)

    # Agent & Session
    agent = FactFinderAgent(instructions=agent_prompt)
    session = AgentSession(stt=stt, llm=llm, tts=tts, tools=[check_yesno_answer], allow_interruptions=False)

    # Modules
    dc = DataChannel(ctx.room)
    narrator = YesNoNarrator(session)
    qgen = QuestionGenerator()

    # Engine + Hints
    engine = None

    async def _on_hint(question_id: str, hint_text: str):
        if engine:
            await engine.on_hint_triggered(question_id, hint_text)

    async def _on_timeout(question_id: str):
        if engine:
            await engine.on_timeout(question_id)

    hint_manager = YesNoHintManager(game_state, on_hint=_on_hint, on_timeout=_on_timeout)
    engine = YesNoQuizEngine(game_state, narrator, hint_manager, dc, qgen, session, child_age=child_age)

    # Data channel handlers
    dc.on("yesno_answer", engine.on_tap_answer)
    dc.on("game_control", engine.on_game_control)

    async def _on_ready_for_greeting(message: dict):
        logger.info("worker.greeting_triggered(source=data_channel)")
        await engine.on_game_start(child_name, child_age, game_mode)

    dc.on("ready_for_greeting", _on_ready_for_greeting)

    async def _on_end_prompt(message: dict):
        prompt_text = message.get("prompt", "That was so much fun! See you next time!")
        await narrator.speak_end_prompt(prompt_text)

    dc.on("end_prompt", _on_end_prompt)

    async def _on_shutdown(message: dict):
        logger.info("worker.shutdown_request_received")
        if message.get("require_ack"):
            await dc.send({"type": "shutdown_ack", "session_id": message.get("session_id", "")})
        hint_manager.cancel_timers()

    dc.on("shutdown_request", _on_shutdown)

    # Tool execution handler
    @session.on("function_tools_executed")
    def on_tools_executed(ev):
        has_check = False
        check_result = None
        for call, output in ev.zipped():
            fn_name = getattr(call, "name", str(call))
            if fn_name == "check_yesno_answer":
                has_check = True
                try:
                    raw = output.output if hasattr(output, "output") else str(output)
                    check_result = json.loads(raw)
                except (json.JSONDecodeError, TypeError, AttributeError):
                    logger.error(f"worker.tool_output_parse_error(output={str(output)[:200]})")

        if has_check and check_result:
            ev.cancel_tool_reply()
            asyncio.create_task(engine.on_voice_answer(check_result))

    # Usage tracking
    usage_manager = UsageManager(mac_address=device_mac, session_id=room_name)
    usage_manager.setup_metrics_collection(session)

    # Connect
    await ctx.connect(auto_subscribe=AutoSubscribe.AUDIO_ONLY)

    # Duplicate agent check
    my_identity = ctx.room.local_participant.identity if ctx.room.local_participant else None
    existing_agents = [
        p for p in ctx.room.remote_participants.values()
        if p.identity and "agent" in p.identity.lower() and p.identity != my_identity
    ]
    if existing_agents:
        logger.warning(f"worker.duplicate_agent_detected(identities={[a.identity for a in existing_agents]})")
        return

    # Start
    await session.start(agent=agent, room=ctx.room)
    await dc.mark_ready()
    logger.info("worker.session_started")

    # Publish initial state
    if child_profile:
        await dc.send({"type": "child_profile", **child_profile})
    await dc.send({
        "type": "game_state",
        "state": "playing",
        "game_mode": game_mode,
        "progress": game_state._get_progress(),
    })

    # Cleanup
    async def cleanup():
        logger.info("worker.cleanup")
        hint_manager.cancel_timers()

    ctx.add_shutdown_callback(cleanup)


if __name__ == "__main__":
    cli.run_app(
        WorkerOptions(
            entrypoint_fnc=entrypoint,
            prewarm_fnc=prewarm,
            port=DEFAULT_PORT,
            agent_name=AGENT_NAME,
        )
    )
```

- [ ] **Step 3: Verify worker can parse (syntax check)**

Run: `cd main/livekit-server && python -c "import ast; ast.parse(open('workers/yesno_quiz_worker.py').read()); print('Syntax OK')"`

- [ ] **Step 4: Add PM2 config**

Modify `ecosystem.config.js` — add a new entry in the `apps` array:

```js
{
  name: "yesno-quiz-agent",
  script: "python",
  args: "workers/yesno_quiz_worker.py dev",
  cwd: "./main/livekit-server",
  env: {
    PORT: 8090,
    YESNO_LLM_PROVIDER: "openrouter",
    YESNO_LLM_MODEL: "openai/gpt-4o-mini",
  }
}
```

- [ ] **Step 5: Commit**

```bash
git add main/livekit-server/workers/yesno_quiz_worker.py ecosystem.config.js
git commit -m "feat(yesno-quiz): add worker entrypoint and PM2 config"
```

---

## Chunk 3: Frontend — Yes/No Quiz HUD

### Task 9: Create TypeScript Types

**Files:**
- Create: `D:\agent-starter-react\lib\yesno-quiz\types.ts`
- Reference: `D:\agent-starter-react\lib\math-game\types.ts`

- [ ] **Step 1: Read math game types**

Read `D:\agent-starter-react\lib\math-game\types.ts` for the existing type patterns.

- [ ] **Step 2: Create types.ts**

```typescript
export type GameMode = "explorer" | "commander";

export interface GameProgress {
  stars: number;
  total_needed: number;
  lives: number | null;
  max_lives: number | null;
  mission_number: number;
  level: number;
}

export interface YesNoQuestionMessage {
  type: "yesno_question";
  question_id: string;
  question_text: string;
  category: string;
  game_mode: GameMode;
  progress: GameProgress;
}

export interface YesNoResultMessage {
  type: "yesno_result";
  question_id: string;
  correct: boolean;
  user_answer: "yes" | "no" | null;
  correct_answer: boolean;
  fun_fact: string;
  input_method: "tap" | "voice" | "timeout";
  progress: GameProgress;
  game_complete: boolean;
  game_over: boolean;
  consecutive_correct: number;
  bonus_star: boolean;
}

export interface YesNoHintMessage {
  type: "yesno_hint";
  question_id: string;
  hint_text: string;
}

export interface GameStateMessage {
  type: "game_state";
  state: "playing" | "started" | "completed" | "game_over" | "restarted";
  game_mode: GameMode;
  progress: GameProgress;
}

export interface ChildProfile {
  name: string;
  age: number | null;
  gender: string;
  language: string;
  game_mode: GameMode;
}

export interface YesNoQuizHookState {
  gameActive: boolean;
  gameMode: GameMode;
  currentQuestion: YesNoQuestionMessage | null;
  progress: GameProgress;
  feedback: YesNoResultMessage | null;
  funFact: string | null;
  consecutiveCorrect: number;
  gameComplete: boolean;
  gameOver: boolean;
  showingResult: boolean;
  agentSpeaking: boolean;
  childProfile: ChildProfile | null;
  sendAnswer: (value: "yes" | "no") => void;
}
```

- [ ] **Step 3: Commit**

```bash
cd D:\agent-starter-react && git add lib/yesno-quiz/types.ts
git commit -m "feat(yesno-quiz): add TypeScript type definitions"
```

---

### Task 10: Create Sound Effects

**Files:**
- Create: `D:\agent-starter-react\lib\yesno-quiz\sfx.ts`
- Reference: `D:\agent-starter-react\lib\math-game\sfx.ts`

- [ ] **Step 1: Read math game sfx.ts**

Read `D:\agent-starter-react\lib\math-game\sfx.ts` for the Web Audio API pattern.

- [ ] **Step 2: Create sfx.ts**

Reuse the same correct/wrong/complete/game-over SFX. Add a new `playFactRevealSfx()` — a gentle "ding" for the fun fact reveal.

Copy the math game SFX file and add:

```typescript
// Add to the existing pattern:
export function playFactRevealSfx() {
  const ctx = new AudioContext();
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.type = "sine";
  osc.frequency.value = 880; // A5 - gentle high ding
  gain.gain.setValueAtTime(0.15, ctx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.4);
  osc.start();
  osc.stop(ctx.currentTime + 0.4);
}
```

- [ ] **Step 3: Commit**

```bash
cd D:\agent-starter-react && git add lib/yesno-quiz/sfx.ts
git commit -m "feat(yesno-quiz): add sound effects with fact reveal ding"
```

---

### Task 11: Create State Hook

**Files:**
- Create: `D:\agent-starter-react\hooks\yesno-quiz\use-yesno-quiz.ts`
- Reference: `D:\agent-starter-react\hooks\math-game\use-math-game.ts`

- [ ] **Step 1: Read use-math-game.ts thoroughly**

This is the most important reference. Understand: state variables, RoomEvent.DataReceived listener, message routing, handler functions, sendAnswer, timing, agent speaking detection, cleanup.

- [ ] **Step 2: Create use-yesno-quiz.ts**

Clone the math game hook structure. Key changes:
- Listen for `yesno_question` / `yesno_result` / `yesno_hint` message types
- `sendAnswer` sends `{ type: "yesno_answer", value: "yes"|"no" }` instead of numeric value
- Add `funFact` state for the fun fact toast
- Use `RESULT_DISPLAY_MS = 3000` instead of 1500
- Handle `yesno_hint` by updating `agentSpeaking` state

The full implementation should mirror `use-math-game.ts` closely. Read it and adapt line by line.

- [ ] **Step 3: Commit**

```bash
cd D:\agent-starter-react && git add hooks/yesno-quiz/use-yesno-quiz.ts
git commit -m "feat(yesno-quiz): add state management hook"
```

---

### Task 12: Create UI Components

**Files:**
- Create: `D:\agent-starter-react\components\yesno-quiz\QuestionBubble.tsx`
- Create: `D:\agent-starter-react\components\yesno-quiz\YesNoButtons.tsx`
- Create: `D:\agent-starter-react\components\yesno-quiz\FunFactToast.tsx`
- Create: `D:\agent-starter-react\components\yesno-quiz\YesNoQuizHUD.tsx`
- Reference: Math game components in `D:\agent-starter-react\components\math-game\`

- [ ] **Step 1: Read all math game components**

Read `QuestionCard.tsx`, `OptionGrid.tsx`, `MathGameHUD.tsx` to understand component patterns, styling, animations.

- [ ] **Step 2: Create QuestionBubble.tsx**

```typescript
// Displays question text with category badge
// Props: questionText: string, category: string
// Category badge: small pill with category emoji + name
// Question text: large, centered, white on dark background
// Rounded container with subtle border
```

Category emoji mapping: `{ animals: "🐾", science: "🔬", geography: "🌍", food: "🍕", space: "🚀", nature: "🌿", "human body": "🫀", history: "📜" }`

- [ ] **Step 3: Create YesNoButtons.tsx**

```typescript
// Two large side-by-side buttons: YES (left) and NO (right)
// Props: onSelect(value: "yes"|"no"), disabled: boolean, feedback: YesNoResultMessage | null
// Button states: normal, selected, correct (green bounce), wrong (red shake), disabled
// YES button has green accent, NO button has red accent
// Min size: 120x100px each
```

Follow the `OptionGrid.tsx` pattern for button state styling and animations.

- [ ] **Step 4: Create FunFactToast.tsx**

```typescript
// Slides up from bottom when funFact is non-null
// Props: funFact: string | null, category: string
// Shows category emoji + fun fact text
// Light background (#1c2333), rounded, padding
// Uses animate-slide-up on enter, auto-dismisses
```

- [ ] **Step 5: Create YesNoQuizHUD.tsx**

```typescript
// Main overlay component — composes all sub-components
// Uses useYesNoQuiz() hook for state
// Returns null if !gameActive && !currentQuestion
// Layout: top bar (mode, level, lives, stars) + question + buttons + fun fact + progress
// Reuses StarProgress, LivesDisplay, GameOverlay from math game
```

Follow `MathGameHUD.tsx` structure exactly.

- [ ] **Step 6: Commit**

```bash
cd D:\agent-starter-react && git add components/yesno-quiz/
git commit -m "feat(yesno-quiz): add QuestionBubble, YesNoButtons, FunFactToast, YesNoQuizHUD"
```

---

### Task 13: Add Animations + Wire HUD into Session Block

**Files:**
- Modify: `D:\agent-starter-react\styles\globals.css`
- Modify: `D:\agent-starter-react\components\agents-ui\blocks\agent-session-view-01\components\agent-session-block.tsx`

- [ ] **Step 1: Add animations to globals.css**

Read `globals.css`, find where existing game animations are defined. Add after them:

```css
@keyframes slide-up {
  from { transform: translateY(100%); opacity: 0; }
  to { transform: translateY(0); opacity: 1; }
}

@keyframes fade-out {
  from { opacity: 1; }
  to { opacity: 0; }
}
```

And in the Tailwind `@theme` or utilities section:

```css
.animate-slide-up {
  animation: slide-up 0.3s ease-out forwards;
}
.animate-fade-out {
  animation: fade-out 0.3s ease-out forwards;
}
```

- [ ] **Step 2: Add YesNoQuizHUD to agent-session-block.tsx**

Read `agent-session-block.tsx`. Add import and render:

```typescript
import { YesNoQuizHUD } from '@/components/yesno-quiz/YesNoQuizHUD';
```

Add `<YesNoQuizHUD />` right after `<MathGameHUD />`:

```typescript
{/* Math Game HUD overlay */}
<MathGameHUD />
{/* Yes/No Quiz HUD overlay */}
<YesNoQuizHUD />
```

- [ ] **Step 3: Commit**

```bash
cd D:\agent-starter-react && git add styles/globals.css components/agents-ui/blocks/agent-session-view-01/components/agent-session-block.tsx
git commit -m "feat(yesno-quiz): wire HUD into session block, add animations"
```

---

## Chunk 4: Frontend — Game Dashboard + Integration

### Task 14: Create Game Registry

**Files:**
- Create: `D:\agent-starter-react\lib\game-dashboard\games.ts`

- [ ] **Step 1: Create games.ts**

```typescript
export interface GameDefinition {
  id: string;
  name: string;
  icon: string;
  agent_name: string;
  description: string;
  color: string;
  minAge?: number;
}

export const GAMES: GameDefinition[] = [
  {
    id: "math_quiz",
    name: "Math Quest",
    icon: "🧮",
    agent_name: "math-game-agent",
    description: "Solve math puzzles!",
    color: "#238636",
  },
  {
    id: "yesno_quiz",
    name: "Fun Facts",
    icon: "🤔",
    agent_name: "yesno-quiz-agent",
    description: "True or false?",
    color: "#1f6feb",
  },
];
```

- [ ] **Step 2: Commit**

```bash
cd D:\agent-starter-react && git add lib/game-dashboard/games.ts
git commit -m "feat(game-dashboard): add game registry"
```

---

### Task 15: Create GameCard Component

**Files:**
- Create: `D:\agent-starter-react\components\game-dashboard\GameCard.tsx`

- [ ] **Step 1: Create GameCard.tsx**

```typescript
// Props: game: GameDefinition, onSelect: () => void
// Rounded card with colored left border accent (game.color)
// Large icon centered, game name below, description in muted text
// Hover: scale(1.03) transition
// Active/tap: scale(0.97) transition
// Dark background (#161b22), border (#30363d)
// Min size: 140x140px for touch targets
// Use motion/react for animations if available, otherwise CSS transitions
```

- [ ] **Step 2: Commit**

```bash
cd D:\agent-starter-react && git add components/game-dashboard/GameCard.tsx
git commit -m "feat(game-dashboard): add GameCard component"
```

---

### Task 16: Create GameDashboard Component

**Files:**
- Create: `D:\agent-starter-react\components\game-dashboard\GameDashboard.tsx`

- [ ] **Step 1: Create GameDashboard.tsx**

```typescript
// Props: onSelectGame: (agentName: string) => void
// Full-screen dark background
// Title: "🎮 Pick a Game!" centered
// Optional: "Hi, {childName}!" if available from sessionStorage
// Grid of GameCards (2 columns on mobile, responsive)
// Each card calls onSelectGame(game.agent_name) on tap
```

- [ ] **Step 2: Commit**

```bash
cd D:\agent-starter-react && git add components/game-dashboard/GameDashboard.tsx
git commit -m "feat(game-dashboard): add GameDashboard pre-connection screen"
```

---

### Task 17: Integrate Dashboard into app.tsx

**Files:**
- Modify: `D:\agent-starter-react\components\app\app.tsx`
- Modify: `D:\agent-starter-react\app-config.ts`

- [ ] **Step 1: Read app.tsx and app-config.ts**

Read both files to understand the current connection flow, token source creation, `useSession` usage, and how `agentName` flows through.

- [ ] **Step 2: Modify app-config.ts**

Make `AGENT_NAME` a fallback default that can be overridden:

```typescript
// Change agentName from required to optional with fallback
agentName: process.env.AGENT_NAME || undefined,
```

- [ ] **Step 3: Modify app.tsx**

Add game selection state and conditional rendering:

1. Add state: `const [selectedGame, setSelectedGame] = useState<string | null>(null);`
2. Add import: `import { GameDashboard } from '@/components/game-dashboard/GameDashboard';`
3. Before the LiveKit connection section, add:
   ```typescript
   if (!selectedGame && !appConfig.agentName) {
     return <GameDashboard onSelectGame={setSelectedGame} />;
   }
   ```
4. Update `agentName` usage to prefer `selectedGame` over `appConfig.agentName`:
   ```typescript
   const activeAgentName = selectedGame || appConfig.agentName;
   ```
5. Update `tokenSource` useMemo to include `selectedGame` in deps
6. Update `roomConfig` to use `activeAgentName`
7. Add a back-to-dashboard handler that sets `selectedGame(null)` and disconnects

- [ ] **Step 4: Verify app builds**

Run: `cd D:\agent-starter-react && npm run build`
Expected: Build succeeds with no TypeScript errors.

- [ ] **Step 5: Commit**

```bash
cd D:\agent-starter-react && git add components/app/app.tsx app-config.ts
git commit -m "feat(game-dashboard): integrate dashboard into app with dynamic agent selection"
```

---

## Chunk 5: Integration + Smoke Test

### Task 18: End-to-End Verification

- [ ] **Step 1: Verify backend worker starts**

Run: `cd main/livekit-server && python workers/yesno_quiz_worker.py dev`
Expected: Worker starts, logs "worker.prewarm_done", listens on port 8090, registers as "yesno-quiz-agent"
(Ctrl+C to stop after verifying)

- [ ] **Step 2: Verify frontend builds clean**

Run: `cd D:\agent-starter-react && npm run build`
Expected: No errors.

- [ ] **Step 3: Verify game dashboard renders**

Run: `cd D:\agent-starter-react && npm run dev`
Open browser → should see game dashboard with Math Quest and Fun Facts cards.

- [ ] **Step 4: Final commit (if any fixes needed)**

```bash
git add -A && git commit -m "fix: integration fixes for yesno-quiz + game dashboard"
```
