"""
LLM-based fact extraction from conversation text.

Uses Groq (via OpenAI-compatible API) to extract durable facts
from chat history for long-term memory storage.
"""

import logging
import os
from typing import List, Optional

logger = logging.getLogger("memory.fact_extractor")

# Extraction prompt template
EXTRACTION_PROMPT = """\
You are a memory extraction assistant for a children's AI companion called Cheeko.

Review this conversation between Cheeko (AI) and a child. Extract ONLY durable, \
reusable facts worth remembering across future sessions.

Categories to look for:
- PREFERENCE: favorite things, likes, dislikes (e.g., "Favorite color is green")
- PERSONAL: family members, pets, school, friends (e.g., "Has a dog named Rocky")
- ACHIEVEMENT: skills learned, milestones (e.g., "Can multiply up to 7x7")
- LEARNING: topics studied, homework subjects (e.g., "Learning about planets")
- ROUTINE: daily habits, schedules (e.g., "Has school play next Friday")

Rules:
- Output one fact per line, prefixed with category in brackets: [PREFERENCE] Loves dinosaurs
- Only extract NEW, specific facts — not generic observations
- Skip greetings, filler, and transient conversation
- If nothing notable was discussed, output exactly: NONE
- Maximum 10 facts per conversation
- Keep each fact concise (under 15 words)

Conversation:
{conversation}"""


async def extract_facts_with_groq(conversation_text: str) -> List[str]:
    """Extract durable facts from conversation text using Groq LLM.

    Args:
        conversation_text: Formatted conversation (e.g., "Child: ...\nCheeko: ...")

    Returns:
        List of extracted fact strings, or empty list if nothing notable.
    """
    try:
        from openai import AsyncOpenAI
    except ImportError:
        logger.warning("[FACT-EXTRACT] openai package not available")
        return []

    api_key = os.getenv("GROQ_API_KEY")
    if not api_key:
        # Try loading from config.yaml
        try:
            from src.config.config_loader import ConfigLoader
            config = ConfigLoader.load_yaml_config()
            api_key = config.get("api_keys", {}).get("groq")
        except Exception:
            pass

    if not api_key:
        logger.warning("[FACT-EXTRACT] No Groq API key available")
        return []

    try:
        client = AsyncOpenAI(
            api_key=api_key,
            base_url="https://api.groq.com/openai/v1",
        )

        # Truncate conversation to avoid token limits
        truncated = conversation_text[:4000]

        response = await client.chat.completions.create(
            model="openai/gpt-oss-20b",
            messages=[
                {"role": "user", "content": EXTRACTION_PROMPT.format(conversation=truncated)},
            ],
            temperature=0.3,
            max_tokens=500,
        )

        raw = response.choices[0].message.content.strip()
        logger.info(f"[FACT-EXTRACT] Raw LLM response: {raw[:200]}")

        if "NONE" in raw.upper():
            logger.info("[FACT-EXTRACT] No notable facts found")
            return []

        # Parse facts (one per line, skip empty lines)
        facts = []
        for line in raw.split("\n"):
            line = line.strip()
            if not line or line.upper() == "NONE":
                continue
            # Remove leading bullet/dash if present
            if line.startswith(("- ", "* ", "• ")):
                line = line[2:]
            facts.append(line)

        logger.info(f"[FACT-EXTRACT] Extracted {len(facts)} facts")
        return facts[:10]  # Cap at 10

    except Exception as e:
        logger.error(f"[FACT-EXTRACT] Groq API call failed: {e}")
        return []


def create_extractor() -> Optional[callable]:
    """Create the fact extraction callback for flush_session().

    Returns:
        Async callable(conversation_text) -> List[str], or None if unavailable.
    """
    # Check if Groq API key is available
    api_key = os.getenv("GROQ_API_KEY")
    if not api_key:
        try:
            from src.config.config_loader import ConfigLoader
            config = ConfigLoader.load_yaml_config()
            api_key = config.get("api_keys", {}).get("groq")
        except Exception:
            pass

    if not api_key:
        logger.info("[FACT-EXTRACT] No API key, LLM extraction disabled")
        return None

    try:
        from openai import AsyncOpenAI
    except ImportError:
        logger.info("[FACT-EXTRACT] openai package not available")
        return None

    logger.info("[FACT-EXTRACT] LLM fact extraction enabled (Groq)")
    return extract_facts_with_groq
