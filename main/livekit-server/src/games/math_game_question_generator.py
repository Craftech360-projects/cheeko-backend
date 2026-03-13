"""
LLM-based question generator for Math Commander game.
Calls OpenRouter API to generate age-appropriate math questions as structured JSON.
Tracks previously asked questions to avoid repetition.
"""

import os
import json
import logging
import aiohttp

logger = logging.getLogger("math_game_qgen")

QUESTION_GEN_PROMPT = """You are a math question generator for a kids game called Math Commander.
Generate ONE math question for a {age}-year-old child.

Rules by age:
- Ages 4-6: simple addition or subtraction, numbers up to 20
- Ages 7-9: addition, subtraction, or multiplication, numbers up to 100
- Ages 10+: all four operations, larger numbers

Requirements:
- story_text: A fun 1-2 sentence story involving Indian cultural elements (samosas, laddoos, parrots, auto-rickshaws, cricket, Diwali, mangoes, etc.)
- question_text: The math equation ending with "= ?" (e.g., "8 + 3 = ?")
- correct_answer: The numerical answer (integer)
- The story must naturally lead to the math question
- Use DIFFERENT numbers, operations, and themes each time

{avoid_section}
Return ONLY valid JSON, no markdown, no explanation:
{{"question_text": "8 + 3 = ?", "story_text": "8 crayons in the box, teacher gives 3 more!", "correct_answer": 11}}"""


class QuestionGenerator:
    """Generates math questions via LLM API calls. Tracks history to avoid repeats."""

    def __init__(self, api_key: str = None, model: str = None, base_url: str = None):
        self.api_key = api_key or os.getenv("OPENROUTER_API_KEY", "")
        self.model = model or os.getenv("MATH_LLM_MODEL", "openai/gpt-4o-mini")
        self.base_url = base_url or "https://openrouter.ai/api/v1/chat/completions"
        self._asked_questions = []  # Track question_text history
        self._fallback_questions = [
            {"question_text": "5 + 3 = ?", "story_text": "5 samosas on a plate, Mummy brings 3 more!", "correct_answer": 8},
            {"question_text": "8 - 4 = ?", "story_text": "8 parrots on a tree, 4 fly away!", "correct_answer": 4},
            {"question_text": "6 x 7 = ?", "story_text": "6 rows of 7 diyas for Diwali!", "correct_answer": 42},
            {"question_text": "9 + 7 = ?", "story_text": "9 samosas and 7 jalebis at the sweet shop!", "correct_answer": 16},
            {"question_text": "12 - 5 = ?", "story_text": "12 mangoes on the tree, 5 fall down!", "correct_answer": 7},
            {"question_text": "7 x 8 = ?", "story_text": "7 cricket teams with 8 players each!", "correct_answer": 56},
            {"question_text": "3 + 4 = ?", "story_text": "3 monkeys on a wall, 4 more jump up!", "correct_answer": 7},
            {"question_text": "10 - 6 = ?", "story_text": "10 balloons at the mela, 6 pop!", "correct_answer": 4},
        ]
        self._fallback_index = 0

    def reset(self):
        """Clear question history (on game restart)."""
        self._asked_questions.clear()
        self._fallback_index = 0

    async def generate(self, age: int) -> dict:
        """Generate a question via LLM. Falls back to hardcoded on failure."""
        try:
            question = await self._call_llm(age)
            if question and self._validate(question):
                # Check for duplicate
                if question["question_text"] in self._asked_questions:
                    logger.warning(f"qgen.duplicate_detected(q={question['question_text']}), retrying")
                    question = await self._call_llm(age)
                    if not question or not self._validate(question):
                        return self._get_fallback()

                self._asked_questions.append(question["question_text"])
                logger.info(
                    f"qgen.generated(q={question['question_text']}, "
                    f"answer={question['correct_answer']}, history={len(self._asked_questions)})"
                )
                return question
            logger.warning(f"qgen.invalid_response(response={question})")
        except Exception as e:
            logger.error(f"qgen.llm_error(error={e})")

        return self._get_fallback()

    async def _call_llm(self, age: int) -> dict:
        """Call OpenRouter API for structured JSON question."""
        # Build avoid section from history
        avoid_section = ""
        if self._asked_questions:
            recent = self._asked_questions[-10:]  # Last 10 questions
            avoid_section = f"IMPORTANT: Do NOT repeat these questions (already asked): {', '.join(recent)}\n"

        prompt = QUESTION_GEN_PROMPT.format(age=age, avoid_section=avoid_section)

        payload = {
            "model": self.model,
            "temperature": 0.9,
            "max_tokens": 200,
            "messages": [
                {"role": "system", "content": prompt},
                {"role": "user", "content": "Generate a new, different math question."},
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
        if "question_text" not in q or "story_text" not in q or "correct_answer" not in q:
            return False
        try:
            q["correct_answer"] = int(float(q["correct_answer"]))
        except (ValueError, TypeError):
            return False
        return True

    def _get_fallback(self) -> dict:
        """Return a hardcoded fallback question, skipping already-asked ones."""
        for _ in range(len(self._fallback_questions)):
            q = self._fallback_questions[self._fallback_index % len(self._fallback_questions)]
            self._fallback_index += 1
            if q["question_text"] not in self._asked_questions:
                self._asked_questions.append(q["question_text"])
                logger.warning(f"qgen.using_fallback(q={q['question_text']})")
                return q
        # All fallbacks exhausted, return any
        q = self._fallback_questions[0]
        logger.warning(f"qgen.fallback_exhausted(q={q['question_text']})")
        return q
