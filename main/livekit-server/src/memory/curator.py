"""
Daily log curator — summarizes daily session logs into curated profile facts.

Reads recent daily logs for a device, uses LLM to extract durable facts,
updates the device's profile markdown, and re-indexes the vector store.
Can be called after flush_session or as a scheduled background task.
"""

import logging
import os
from datetime import date, timedelta
from typing import List, Optional

logger = logging.getLogger("memory.curator")

CURATION_PROMPT = """\
You are a memory curator for Cheeko, a children's AI companion.

Below is the child's existing profile, followed by recent session logs.
Your job is to produce an UPDATED profile that merges any new facts from the logs.

Rules:
- Keep the markdown format with sections: About, Preferences, Important Facts, Learning Progress, Notes
- Add new facts discovered in the logs
- Update changed facts (e.g., if favorite color changed, update it)
- Remove duplicates
- Keep each bullet point concise (under 15 words)
- Do NOT remove existing facts unless contradicted by newer information
- Output ONLY the updated markdown profile, nothing else

Current Profile:
{profile}

Recent Session Logs:
{logs}"""


async def curate_device_memory(
    mac: str,
    days: int = 3,
    memory_service=None,
) -> bool:
    """Curate recent daily logs into the device's profile.

    Reads the last N days of logs, asks LLM to merge new facts into
    the existing profile, writes the updated profile, and re-indexes.

    Args:
        mac: Device MAC address.
        days: Number of days of logs to review (default 3).
        memory_service: MemoryService instance (uses singleton if None).

    Returns:
        True if curation was performed, False if skipped/failed.
    """
    if memory_service is None:
        from .memory_service import get_memory_service
        memory_service = get_memory_service()

    if not memory_service.is_ready():
        return False

    try:
        backend = memory_service.backend

        # Read existing profile
        profile = await backend.read_file(mac, "profile") or ""

        # Collect recent daily logs
        today = date.today()
        logs_text = ""
        for i in range(days):
            d = (today - timedelta(days=i)).isoformat()
            log = await backend.read_file(mac, "daily_log", date=d)
            if log:
                logs_text += f"\n--- {d} ---\n{log}\n"

        if not logs_text.strip():
            logger.info(f"[CURATOR] No recent logs for {mac}, skipping")
            return False

        # Get LLM to merge facts
        updated_profile = await _llm_curate(profile, logs_text)
        if not updated_profile:
            logger.info(f"[CURATOR] LLM curation returned nothing for {mac}")
            return False

        # Write updated profile
        await backend.write_file(mac, "profile", updated_profile)
        logger.info(f"[CURATOR] Updated profile for {mac} ({len(updated_profile)} chars)")

        # Re-index the device's memory store
        await memory_service.reindex(mac)
        logger.info(f"[CURATOR] Re-indexed memory for {mac}")

        return True

    except Exception as e:
        logger.error(f"[CURATOR] Failed for {mac}: {e}")
        return False


async def _llm_curate(profile: str, logs: str) -> Optional[str]:
    """Use Groq LLM to merge log facts into profile markdown."""
    try:
        from openai import AsyncOpenAI
    except ImportError:
        logger.warning("[CURATOR] openai package not available")
        return None

    api_key = os.getenv("GROQ_API_KEY")
    if not api_key:
        try:
            from src.config.config_loader import ConfigLoader
            config = ConfigLoader.load_yaml_config()
            api_key = config.get("api_keys", {}).get("groq")
        except Exception:
            pass

    if not api_key:
        logger.warning("[CURATOR] No Groq API key")
        return None

    try:
        client = AsyncOpenAI(
            api_key=api_key,
            base_url="https://api.groq.com/openai/v1",
        )

        # Truncate inputs to stay within token limits
        truncated_profile = profile[:2000]
        truncated_logs = logs[:4000]

        response = await client.chat.completions.create(
            model="llama-3.1-8b-instant",
            messages=[
                {
                    "role": "user",
                    "content": CURATION_PROMPT.format(
                        profile=truncated_profile,
                        logs=truncated_logs,
                    ),
                },
            ],
            temperature=0.2,
            max_tokens=1000,
        )

        result = response.choices[0].message.content.strip()
        if not result or len(result) < 20:
            return None

        logger.info(f"[CURATOR] LLM produced {len(result)} chars of curated profile")
        return result

    except Exception as e:
        logger.error(f"[CURATOR] LLM call failed: {e}")
        return None
