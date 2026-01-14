"""
Gemini Text Service
Gets text-only responses from Gemini API for RFID question answering.
Used for caching responses - generates text, then TTS is applied separately.
"""

import os
import asyncio
import google.generativeai as genai
from src.utils.loki_agent_logger import logger


class GeminiTextService:
    """Service to get text responses from Gemini API (not realtime streaming)"""

    # Default model to use
    DEFAULT_MODEL = "gemini-2.0-flash"

    # Default system prompt for child-friendly responses
    DEFAULT_SYSTEM_PROMPT = """You are Cheeko, a friendly AI companion for children aged 3-16.

When answering questions:
- Use simple, child-friendly language
- Be enthusiastic and encouraging
- Make learning fun with examples
- Be positive and supportive
- never ever add eny emojis  or icons, 
Response length guidelines:
- For counting/listing questions (e.g., "name 10 animals"), list ALL items requested with enthusiasm
- For simple questions, keep it brief (2-3 sentences)
- For explanations, use short paragraphs with simple words

When listing items:
- Number each item clearly (1, 2, 3...)
- Add a fun fact or sound for each (e.g., "Dog - woof woof!")
- Celebrate after completing the list

Remember: You're talking to a child, so be warm, patient, and fun!"""

    def __init__(self, model_name: str = None):
        """
        Initialize the Gemini text service

        Args:
            model_name: Gemini model to use (default: gemini-2.0-flash)
        """
        self.model_name = model_name or self.DEFAULT_MODEL
        self.model = None
        self._initialized = False

        # Initialize the model
        self._init_model()

    def _init_model(self):
        """Initialize the Gemini model with API key"""
        try:
            api_key = os.getenv("GOOGLE_API_KEY")
            if not api_key:
                logger.error("❌ [GEMINI-TEXT] GOOGLE_API_KEY not found in environment")
                return

            genai.configure(api_key=api_key)
            self.model = genai.GenerativeModel(self.model_name)
            self._initialized = True
            logger.info(f"✅ [GEMINI-TEXT] Initialized with model: {self.model_name}")

        except Exception as e:
            logger.error(f"❌ [GEMINI-TEXT] Failed to initialize: {e}")
            self._initialized = False

    async def generate_response(self, prompt: str, system_prompt: str = None,
                                 age_group: str = None) -> str:
        """
        Generate text response for a prompt

        Args:
            prompt: The question/prompt to answer
            system_prompt: Optional custom system prompt (uses default if not provided)
            age_group: Optional age group for tailored responses (e.g., "3-5", "6-10", "11-16")

        Returns:
            Generated text response, or None on failure
        """
        if not self._initialized or not self.model:
            logger.error("❌ [GEMINI-TEXT] Model not initialized")
            return None

        try:
            # Build the full prompt
            sys_prompt = system_prompt or self.DEFAULT_SYSTEM_PROMPT

            # Adjust for age group if provided
            if age_group:
                sys_prompt += f"\n\nThe child is in the {age_group} years age group. Adjust your language accordingly."

            full_prompt = f"{sys_prompt}\n\nQuestion: {prompt}"

            logger.info(f"🤖 [GEMINI-TEXT] Generating response for: {prompt[:50]}...")

            # Generate response (run in thread to avoid blocking)
            response = await asyncio.to_thread(
                self.model.generate_content,
                full_prompt
            )

            if response and response.text:
                text = response.text.strip()
                logger.info(f"✅ [GEMINI-TEXT] Generated {len(text)} chars response")
                return text
            else:
                logger.warning("⚠️ [GEMINI-TEXT] Empty response from model")
                return None

        except Exception as e:
            logger.error(f"❌ [GEMINI-TEXT] Error generating response: {e}")
            return None

    async def generate_response_with_context(self, prompt: str, context: dict = None) -> str:
        """
        Generate response with additional context (e.g., previous answers, topic)

        Args:
            prompt: The question/prompt to answer
            context: Dict with optional keys:
                - topic: The topic category (animals, math, story, etc.)
                - language: Language code (en, hi, etc.)
                - difficulty: 1-5 difficulty level
                - previous_response: Previous response text for continuity

        Returns:
            Generated text response, or None on failure
        """
        if not context:
            return await self.generate_response(prompt)

        try:
            # Build context-aware system prompt
            sys_prompt = self.DEFAULT_SYSTEM_PROMPT

            if context.get('topic'):
                sys_prompt += f"\n\nThis question is about: {context['topic']}"

            if context.get('language') and context['language'] != 'en':
                sys_prompt += f"\n\nRespond in {context['language']} language."

            if context.get('difficulty'):
                difficulty = context['difficulty']
                if difficulty <= 2:
                    sys_prompt += "\n\nUse very simple words for a young child."
                elif difficulty >= 4:
                    sys_prompt += "\n\nYou can use more advanced vocabulary."

            if context.get('previous_response'):
                sys_prompt += f"\n\nPrevious response was: {context['previous_response']}"

            return await self.generate_response(prompt, system_prompt=sys_prompt)

        except Exception as e:
            logger.error(f"❌ [GEMINI-TEXT] Error with context generation: {e}")
            return await self.generate_response(prompt)

    def is_available(self) -> bool:
        """Check if the service is available"""
        return self._initialized and self.model is not None
