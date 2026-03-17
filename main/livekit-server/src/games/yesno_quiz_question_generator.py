"""
LLM-based question generator for Yes/No Quiz game.
Calls OpenRouter API to generate age-appropriate yes/no questions as structured JSON.
Tracks previously asked questions and recently used categories to avoid repetition.
"""

import os
import json
import logging
import random
import aiohttp

logger = logging.getLogger("yesno_quiz_qgen")

CATEGORIES = [
    "animals",
    "science",
    "geography",
    "food",
    "space",
    "nature",
    "human body",
    "history",
]

# Difficulty tier: controls category pool and complexity
YESNO_TIER_CONFIG = {
    1: {"categories": ["animals", "food"], "complexity": "very simple, obvious"},
    2: {"categories": ["animals", "food", "nature", "human body"], "complexity": "simple"},
    3: {"categories": CATEGORIES, "complexity": "moderate, school-level"},
    4: {"categories": CATEGORIES, "complexity": "challenging, requires thinking"},
    5: {"categories": CATEGORIES, "complexity": "tricky, counterintuitive facts"},
}

QUESTION_GEN_PROMPT = """You are a yes/no trivia question generator for a kids game called Yes/No Quiz.
Generate ONE yes/no trivia question for a {age}-year-old child about the category: {category}.

Rules by age:
- Ages 3-5: very simple, obvious facts about everyday things (e.g., "Do dogs bark?")
- Ages 6-9: moderate, school-level facts (e.g., "Is the Earth round?")
- Ages 10+: challenging, specific facts that require real knowledge

Requirements:
- question: A clear, single yes/no question (no ambiguity)
- correct_answer: true or false (boolean)
- fun_fact: A short, interesting 1-sentence fact related to the question
- category: The category name (same as provided)
- The question MUST have a definitive true or false answer
- Make the question fun and engaging for children
- Use DIFFERENT topics and facts each time
- The audience is primarily Indian children — prefer universal or India-relevant topics
- Avoid US/UK-specific cultural references (e.g., "Declaration of Independence")
- When asking about geography/history, prefer global or Indian context

{avoid_section}
Return ONLY valid JSON, no markdown, no explanation:
{{"question": "Do sharks sleep with their eyes open?", "correct_answer": true, "fun_fact": "Sharks cannot close their eyes as they have no eyelids!", "category": "animals"}}"""


class QuestionGenerator:
    """Generates yes/no quiz questions via LLM API calls. Tracks history to avoid repeats."""

    def __init__(self, api_key: str = None, model: str = None, base_url: str = None):
        self.api_key = api_key or os.getenv("OPENROUTER_API_KEY", "")
        self.model = model or os.getenv("YESNO_LLM_MODEL", "openai/gpt-4o-mini")
        self.base_url = base_url or "https://openrouter.ai/api/v1/chat/completions"
        self._asked_questions = []  # Track question text history
        self._recent_categories = []  # Track recently used categories
        self._fallback_index = 0
        self._fallback_questions = [
            {"question": "Do fish live in water?", "correct_answer": True, "fun_fact": "Most fish breathe through gills that extract oxygen from water.", "category": "animals"},
            {"question": "Is the Sun a star?", "correct_answer": True, "fun_fact": "The Sun is so large that about 1.3 million Earths could fit inside it!", "category": "space"},
            {"question": "Do humans have four hearts?", "correct_answer": False, "fun_fact": "Humans have one heart, but an octopus has three hearts!", "category": "human body"},
            {"question": "Is Mount Everest the tallest mountain on Earth?", "correct_answer": True, "fun_fact": "Mount Everest grows about 4 millimeters taller every year due to tectonic movement.", "category": "geography"},
            {"question": "Do bananas grow on trees?", "correct_answer": False, "fun_fact": "Bananas actually grow on giant herbs, not trees — the banana plant is the world's largest herbaceous plant.", "category": "food"},
            {"question": "Can birds fly to the Moon?", "correct_answer": False, "fun_fact": "The Moon is about 384,000 km away — no bird could survive in the vacuum of space!", "category": "space"},
            {"question": "Do plants make their own food using sunlight?", "correct_answer": True, "fun_fact": "Plants convert sunlight into sugar through photosynthesis, releasing oxygen as a byproduct.", "category": "science"},
            {"question": "Is Antarctica a desert?", "correct_answer": True, "fun_fact": "Antarctica is the world's largest desert because it receives very little precipitation each year.", "category": "geography"},
            {"question": "Do butterflies taste with their feet?", "correct_answer": True, "fun_fact": "Butterflies have taste sensors on their feet so they can taste food just by landing on it!", "category": "animals"},
            {"question": "Was the Great Wall of China built in one year?", "correct_answer": False, "fun_fact": "The Great Wall of China was built over many centuries, spanning more than 2,000 years of construction.", "category": "history"},
            {"question": "Do humans use 100% of their brain?", "correct_answer": False, "fun_fact": "Brain scans show activity throughout the entire brain — the 10% myth is not true!", "category": "human body"},
            {"question": "Is honey the only food that never spoils?", "correct_answer": True, "fun_fact": "Archaeologists have found 3,000-year-old honey in Egyptian tombs that was still edible!", "category": "food"},
        ]

    def reset(self):
        """Clear question history (on game restart)."""
        self._asked_questions.clear()
        self._recent_categories.clear()
        self._fallback_index = 0

    def _pick_category(self) -> str:
        """Pick a category, avoiding recently used ones."""
        available = [c for c in CATEGORIES if c not in self._recent_categories[-3:]]
        if not available:
            available = CATEGORIES
        category = random.choice(available)
        self._recent_categories.append(category)
        return category

    async def generate(self, age: int, difficulty_tier: int = 0) -> dict:
        """Generate a question via LLM. Falls back to hardcoded on failure."""
        if difficulty_tier > 0 and difficulty_tier in YESNO_TIER_CONFIG:
            config = YESNO_TIER_CONFIG[difficulty_tier]
            available = [c for c in config["categories"] if c not in self._recent_categories[-3:]]
            category = random.choice(available) if available else random.choice(config["categories"])
            self._recent_categories.append(category)
        else:
            category = self._pick_category()
        try:
            question = await self._call_llm(age, category)
            if question and self._validate(question):
                # Check for duplicate
                if question["question"] in self._asked_questions:
                    logger.warning(f"qgen.duplicate_detected(q={question['question']}), retrying")
                    question = await self._call_llm(age, category)
                    if not question or not self._validate(question):
                        return self._get_fallback()

                self._asked_questions.append(question["question"])
                logger.info(
                    f"qgen.generated(q={question['question']}, "
                    f"answer={question['correct_answer']}, category={question.get('category')}, "
                    f"history={len(self._asked_questions)})"
                )
                return question
            logger.warning(f"qgen.invalid_response(response={question})")
        except Exception as e:
            logger.error(f"qgen.llm_error(error={e})")

        return self._get_fallback()

    async def _call_llm(self, age: int, category: str) -> dict:
        """Call OpenRouter API for structured JSON question."""
        # Build avoid section from history
        avoid_section = ""
        if self._asked_questions:
            recent = self._asked_questions[-10:]  # Last 10 questions
            avoid_section = f"IMPORTANT: Do NOT repeat these questions (already asked): {'; '.join(recent)}\n"

        prompt = QUESTION_GEN_PROMPT.format(age=age, category=category, avoid_section=avoid_section)

        payload = {
            "model": self.model,
            "temperature": 0.9,
            "max_tokens": 200,
            "messages": [
                {"role": "system", "content": prompt},
                {"role": "user", "content": f"Generate a new yes/no question about {category}."},
            ],
        }

        headers = {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json",
        }

        async with aiohttp.ClientSession() as http:
            async with http.post(self.base_url, json=payload, headers=headers) as resp:
                if resp.status != 200:
                    body = await resp.text()
                    logger.error(f"qgen.api_error(status={resp.status}, body={body[:200]})")
                    return None

                data = await resp.json()
                content = data["choices"][0]["message"]["content"]

                # Strip markdown fences if present
                content = content.strip()
                if content.startswith("```"):
                    content = content.split("\n", 1)[1] if "\n" in content else content[3:]
                    if content.endswith("```"):
                        content = content[:-3]
                    content = content.strip()

                return json.loads(content)

    def _validate(self, q: dict) -> bool:
        """Ensure question has required fields and valid types."""
        if not isinstance(q, dict):
            return False
        if "question" not in q or "correct_answer" not in q or "fun_fact" not in q:
            return False
        if not isinstance(q["correct_answer"], bool):
            # Try to coerce string "true"/"false"
            if isinstance(q["correct_answer"], str):
                if q["correct_answer"].lower() == "true":
                    q["correct_answer"] = True
                elif q["correct_answer"].lower() == "false":
                    q["correct_answer"] = False
                else:
                    return False
            else:
                return False
        return True

    def _get_fallback(self) -> dict:
        """Return a hardcoded fallback question, skipping already-asked ones."""
        for _ in range(len(self._fallback_questions)):
            q = self._fallback_questions[self._fallback_index % len(self._fallback_questions)]
            self._fallback_index += 1
            if q["question"] not in self._asked_questions:
                self._asked_questions.append(q["question"])
                logger.warning(f"qgen.using_fallback(q={q['question']})")
                return q
        # All fallbacks exhausted, return any
        q = self._fallback_questions[0]
        logger.warning(f"qgen.fallback_exhausted(q={q['question']})")
        return q
