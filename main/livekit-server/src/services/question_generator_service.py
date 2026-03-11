"""
Question Generator Service
Uses Groq API to generate varied math questions for children
"""

import os
import logging
import json
from typing import Dict, Any, List

logger = logging.getLogger(__name__)


class QuestionGeneratorService:
    """Generate math question banks using Groq API"""

    def __init__(self):
        self.groq_api_key = os.getenv("GROQ_API_KEY")
        self._initialized = False

    async def initialize(self):
        """Initialize the service"""
        try:
            if not self.groq_api_key:
                logger.error("❌ Cannot initialize QuestionGeneratorService: GROQ_API_KEY not set")
                return False

            logger.info("✅ Question Generator Service initialized with Groq API")
            self._initialized = True
            return True

        except Exception as e:
            logger.error(f"❌ Error initializing QuestionGeneratorService: {e}")
            self._initialized = False
            return False

    def is_available(self) -> bool:
        """Check if service is ready"""
        return self._initialized and bool(self.groq_api_key)

    async def generate_question_bank(self, count: int = 10, difficulty: str = "easy") -> Dict[str, Any]:
        """
        Generate a bank of math questions with answers

        Args:
            count: Number of questions to generate (default 5)
            difficulty: Difficulty level: "easy", "medium", "hard"

        Returns:
            dict: {
                'success': bool,
                'questions': [
                    {'question': str, 'answer': float},
                    ...
                ],
                'error': str or None
            }
        """
        try:
            if not self.is_available():
                logger.warning("⚠️ Question generator not available")
                return {
                    'success': False,
                    'questions': [],
                    'error': 'Service not initialized'
                }

            from openai import AsyncOpenAI

            # Use direct Groq API call
            client = AsyncOpenAI(
                api_key=self.groq_api_key,
                base_url="https://api.groq.com/openai/v1"
            )

            prompt = self._create_prompt(count, difficulty)

            response = await client.chat.completions.create(
                model="llama-3.1-8b-instant",
                messages=[{"role": "user", "content": prompt}],
                temperature=0.8,  # Higher temperature for variety
                max_tokens=500
            )

            raw_response = response.choices[0].message.content.strip()
            logger.debug(f"Raw question bank response: {raw_response}")

            # Parse JSON response
            questions = self._parse_response(raw_response)

            if questions:
                logger.info(f"✅ Generated {len(questions)} math questions")
                return {
                    'success': True,
                    'questions': questions,
                    'error': None
                }
            else:
                logger.warning("⚠️ Failed to parse questions from response")
                return {
                    'success': False,
                    'questions': [],
                    'error': 'Failed to parse questions'
                }

        except Exception as e:
            logger.error(f"❌ Error generating question bank: {e}")
            return {
                'success': False,
                'questions': [],
                'error': str(e)
            }

    def _create_prompt(self, count: int, difficulty: str) -> str:
        """Create prompt for question generation"""

        difficulty_guidelines = {
            "easy": "Numbers 1-20, simple operations (addition, subtraction)",
            "medium": "Numbers 1-50, includes multiplication, division",
            "hard": "Numbers 1-100, multi-step problems"
        }

        guidelines = difficulty_guidelines.get(difficulty, difficulty_guidelines["easy"])

        return f"""You are a math teacher creating questions for children.

Generate {count} DIFFERENT math questions. Each question must be UNIQUE and VARIED.

**Requirements:**
- Use word operators: "plus", "minus", "times", "divided by" (NOT symbols like +, -, ×, ÷)
- Difficulty: {difficulty} - {guidelines}
- Make questions diverse (don't repeat similar patterns)
- Questions should be simple and clear
- Return ONLY valid JSON, no other text

**Output Format (JSON only):**
{{
  "questions": [
    {{"question": "What is 7 plus 3?", "answer": 10}},
    {{"question": "What is 12 minus 5?", "answer": 7}},
    {{"question": "What is 4 times 2?", "answer": 8}},
    {{"question": "What is 15 divided by 3?", "answer": 5}},
    {{"question": "What is 9 plus 6?", "answer": 15}}
  ]
}}

**CRITICAL:**
- Return ONLY the JSON
- Each question must be different
- Use word operators only
- Answer must be exact numeric value

Generate {count} questions now:"""

    def _parse_response(self, raw_response: str) -> List[Dict[str, Any]]:
        """Parse JSON response from LLM"""
        try:
            # Try to extract JSON from response
            # Sometimes LLM adds markdown code blocks
            if "```json" in raw_response:
                # Extract JSON from markdown
                start = raw_response.find("```json") + 7
                end = raw_response.find("```", start)
                json_str = raw_response[start:end].strip()
            elif "```" in raw_response:
                # Extract JSON from generic code block
                start = raw_response.find("```") + 3
                end = raw_response.find("```", start)
                json_str = raw_response[start:end].strip()
            else:
                json_str = raw_response.strip()

            # Parse JSON
            data = json.loads(json_str)

            if 'questions' in data and isinstance(data['questions'], list):
                # Validate each question
                valid_questions = []
                for q in data['questions']:
                    if 'question' in q and 'answer' in q:
                        # Ensure answer is numeric
                        try:
                            answer = float(q['answer'])
                            valid_questions.append({
                                'question': str(q['question']),
                                'answer': answer
                            })
                        except (ValueError, TypeError):
                            logger.warning(f"⚠️ Invalid answer format: {q}")
                            continue

                return valid_questions

            return []

        except json.JSONDecodeError as e:
            logger.error(f"❌ JSON parse error: {e}")
            logger.debug(f"Raw response: {raw_response}")
            return []
        except Exception as e:
            logger.error(f"❌ Error parsing response: {e}")
            return []
