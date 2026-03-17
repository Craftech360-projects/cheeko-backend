"""
LLM-based question generator for Odd One Out game.
Generates age-appropriate "which doesn't belong?" questions with rotating types.
"""

import os
import json
import logging
import random
import aiohttp

logger = logging.getLogger("oddoneout_qgen")

EXPLORER_TYPES = ["category", "color", "size"]
COMMANDER_TYPES = ["category", "function", "abstract", "wordplay", "tricky"]

# Difficulty tier config: controls options count and available question types
TIER_CONFIG = {
    1: {"num_options": 3, "types": ["category"]},
    2: {"num_options": 3, "types": ["category", "color"]},
    3: {"num_options": 3, "types": ["category", "color", "size"]},
    4: {"num_options": 4, "types": ["category", "color", "size", "function"]},
    5: {"num_options": 4, "types": ["category", "function", "abstract", "wordplay", "tricky"]},
}

QUESTION_GEN_PROMPT = """You are a question generator for a kids game called "Odd One Out".
Generate ONE question for a {age}-year-old child. Question type: {question_type}.

You must return a JSON object with EXACTLY {num_options} items where {num_options_minus_one} of them share something in common, and 1 is the odd one out.

Question type guidelines:
- category: items from same category + 1 outsider (e.g., 3 animals + 1 fruit)
- color: items that share a color + 1 that doesn't (e.g., 3 red things + 1 green thing)
- size: items that share a size property + 1 opposite (e.g., 3 big animals + 1 tiny one)
- function: items with same function + 1 different (e.g., 3 tools + 1 toy)
- abstract: items with abstract pattern + 1 different (e.g., 3 even numbers + 1 odd)
- wordplay: items that rhyme or share sound + 1 that doesn't
- tricky: looks obvious but has a twist (e.g., Penguin, Eagle, Bat, Sparrow — Bat is not a bird)

Rules by age:
- Ages 3-5: very simple, obvious categories (animals vs food), use emoji in labels
- Ages 6-8: moderate categories, can include adjective-based (big/small, hot/cold)
- Ages 9-12: multi-step reasoning, abstract patterns, wordplay
- Ages 13+: tricky questions with debatable answers, require deeper knowledge

Requirements:
- items: array of exactly {num_options} strings (short labels, max 15 chars each)
- odd_one_out: the item that doesn't belong (must be one of the items)
- category_label: what the majority share (e.g., "animals", "red things", "even numbers")
- explanation: 1-2 sentences explaining WHY the odd one is different, aimed at a {age}-year-old
- fun_fact: 1 interesting sentence related to the odd item or the category
- question_type: "{question_type}"
- The audience is primarily Indian children — prefer universal or India-relevant topics
- Avoid US/UK-specific cultural references

{avoid_section}
Return ONLY valid JSON, no markdown, no explanation:
{{"items": ["Cat", "Dog", "Banana", "Fish"], "odd_one_out": "Banana", "category_label": "animals", "explanation": "Cat, Dog, and Fish are all animals, but Banana is a fruit!", "fun_fact": "Did you know bananas are technically berries, but strawberries are not?", "question_type": "category"}}"""


class OddOneOutQuestionGenerator:
    """Generates odd-one-out questions via LLM. Rotates question types for variety."""

    def __init__(self, api_key: str = None, model: str = None, base_url: str = None):
        self.api_key = api_key or os.getenv("OPENROUTER_API_KEY", "")
        self.model = model or os.getenv("ODDONEOUT_LLM_MODEL", os.getenv("YESNO_LLM_MODEL", "openai/gpt-4o-mini"))
        self.base_url = base_url or "https://openrouter.ai/api/v1/chat/completions"
        self._asked_items = []
        self._type_index = 0
        self._fallback_index = 0
        self._fallback_questions = [
            {"items": ["Cat", "Dog", "Banana", "Fish"], "odd_one_out": "Banana", "category_label": "animals", "explanation": "Cat, Dog, and Fish are all animals, but Banana is a fruit!", "fun_fact": "Did you know bananas are technically berries?", "question_type": "category"},
            {"items": ["Car", "Bus", "Train", "Apple"], "odd_one_out": "Apple", "category_label": "vehicles", "explanation": "Car, Bus, and Train are all vehicles you ride in, but Apple is a fruit!", "fun_fact": "The first car was invented in 1886 by Karl Benz.", "question_type": "category"},
            {"items": ["Tomato", "Strawberry", "Grass", "Cherry"], "odd_one_out": "Grass", "category_label": "red things", "explanation": "Tomato, Strawberry, and Cherry are all red, but Grass is green!", "fun_fact": "Tomatoes were once thought to be poisonous in Europe.", "question_type": "color"},
            {"items": ["Elephant", "Whale", "Ant", "Dinosaur"], "odd_one_out": "Ant", "category_label": "huge animals", "explanation": "Elephant, Whale, and Dinosaur are all enormous, but Ant is tiny!", "fun_fact": "Ants can carry 50 times their own body weight.", "question_type": "size"},
            {"items": ["Hammer", "Saw", "Drill", "Pillow"], "odd_one_out": "Pillow", "category_label": "tools", "explanation": "Hammer, Saw, and Drill are all tools, but Pillow is for sleeping!", "fun_fact": "The oldest known pillow was made of stone in ancient Mesopotamia.", "question_type": "function"},
            {"items": ["2", "4", "7", "8"], "odd_one_out": "7", "category_label": "even numbers", "explanation": "2, 4, and 8 are all even numbers, but 7 is odd!", "fun_fact": "7 is considered a lucky number in many cultures around the world.", "question_type": "abstract"},
            {"items": ["Bear", "Pear", "Hair", "Moon"], "odd_one_out": "Moon", "category_label": "rhyming words", "explanation": "Bear, Pear, and Hair all rhyme with each other, but Moon doesn't!", "fun_fact": "The Moon is slowly drifting away from Earth at about 3.8 cm per year.", "question_type": "wordplay"},
            {"items": ["Rose", "Sunflower", "Diamond", "Tulip"], "odd_one_out": "Diamond", "category_label": "flowers", "explanation": "Rose, Sunflower, and Tulip are all flowers, but Diamond is a gemstone!", "fun_fact": "Diamonds are made of carbon, the same element found in pencil lead.", "question_type": "category"},
        ]

    def reset(self):
        self._asked_items.clear()
        self._type_index = 0
        self._fallback_index = 0

    def _pick_type(self, age: int) -> str:
        types = COMMANDER_TYPES if age >= 9 else EXPLORER_TYPES
        qt = types[self._type_index % len(types)]
        self._type_index += 1
        return qt

    async def generate(self, age: int, difficulty_tier: int = 0) -> dict:
        if difficulty_tier > 0 and difficulty_tier in TIER_CONFIG:
            config = TIER_CONFIG[difficulty_tier]
            num_options = config["num_options"]
            types = config["types"]
            question_type = types[self._type_index % len(types)]
            self._type_index += 1
        else:
            question_type = self._pick_type(age)
            num_options = 4 if age >= 9 else 3
        try:
            question = await self._call_llm(age, question_type, num_options)
            if question and self._validate(question, num_options):
                if question["odd_one_out"] in self._asked_items:
                    logger.warning(f"qgen.duplicate(odd={question['odd_one_out']}), retrying")
                    question = await self._call_llm(age, question_type, num_options)
                    if not question or not self._validate(question, num_options):
                        return self._get_fallback()
                self._asked_items.append(question["odd_one_out"])
                logger.info(f"qgen.generated(type={question['question_type']}, odd={question['odd_one_out']})")
                return question
            logger.warning(f"qgen.invalid_response(response={question})")
        except Exception as e:
            logger.error(f"qgen.llm_error(error={e})")
        return self._get_fallback()

    async def _call_llm(self, age: int, question_type: str, num_options: int) -> dict:
        avoid_section = ""
        if self._asked_items:
            recent = self._asked_items[-8:]
            avoid_section = f"IMPORTANT: Do NOT use these as the odd one out (already used): {', '.join(recent)}\n"

        prompt = QUESTION_GEN_PROMPT.format(
            age=age, question_type=question_type,
            num_options=num_options, num_options_minus_one=num_options - 1,
            avoid_section=avoid_section,
        )

        payload = {
            "model": self.model,
            "temperature": 0.9,
            "max_tokens": 300,
            "messages": [
                {"role": "system", "content": prompt},
                {"role": "user", "content": f"Generate a new odd-one-out question (type: {question_type}, {num_options} items)."},
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
                content = data["choices"][0]["message"]["content"].strip()
                if content.startswith("```"):
                    content = content.split("\n", 1)[1] if "\n" in content else content[3:]
                    if content.endswith("```"):
                        content = content[:-3]
                    content = content.strip()
                return json.loads(content)

    def _validate(self, q: dict, expected_items: int) -> bool:
        required = ["items", "odd_one_out", "category_label", "explanation", "fun_fact", "question_type"]
        if not all(k in q for k in required):
            return False
        if not isinstance(q["items"], list) or len(q["items"]) < 2:
            return False
        if q["odd_one_out"] not in q["items"]:
            logger.warning(f"qgen.odd_not_in_items(odd={q['odd_one_out']}, items={q['items']})")
            return False
        return True

    def _get_fallback(self) -> dict:
        for _ in range(len(self._fallback_questions)):
            q = self._fallback_questions[self._fallback_index % len(self._fallback_questions)]
            self._fallback_index += 1
            if q["odd_one_out"] not in self._asked_items:
                self._asked_items.append(q["odd_one_out"])
                logger.warning(f"qgen.fallback(odd={q['odd_one_out']})")
                return q
        q = self._fallback_questions[0]
        logger.warning(f"qgen.fallback_exhausted(odd={q['odd_one_out']})")
        return q
