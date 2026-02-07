"""
LiveKit function tools for memory search and write.
Registered as agent tools so the LLM can access memory during conversations.
"""

import logging
from livekit.agents import function_tool, RunContext

logger = logging.getLogger("memory.tools")


@function_tool
async def memory_search(context: RunContext, query: str) -> str:
    """Search the child's memory for relevant information.

    Use this when the child mentions something that might relate to past
    conversations, preferences, family, pets, or routines.

    Args:
        query: What to search for (e.g., "dog's name", "favorite food", "family members")

    Returns:
        Relevant memories as formatted text, or a message if none found.
    """
    try:
        mac = context.userdata.get("device_mac", "")
        if not mac:
            return "No device context available."

        from .memory_service import get_memory_service
        service = get_memory_service()

        if not service.is_ready():
            return "Memory service is not available."

        memories = await service.search(mac, query, limit=5)

        if not memories:
            return "No relevant memories found."

        result = "Found memories:\n"
        for mem in memories:
            result += f"- {mem}\n"
        return result

    except Exception as e:
        logger.error(f"[MEMORY_TOOL] Search failed: {e}")
        return "Memory search encountered an error."


@function_tool
async def memory_write(context: RunContext, fact: str, category: str = "general") -> str:
    """Save an important fact about the child to long-term memory.

    Use this when the child shares something worth remembering, like:
    - Their name, age, family members
    - Pets, favorite things, hobbies
    - School info, friends, routines
    - Feelings or important events

    Args:
        fact: The fact to remember (e.g., "Has a dog named Rocky", "Loves dinosaurs")
        category: Category - one of: general, preference, family, school, pet

    Returns:
        Confirmation message.
    """
    try:
        mac = context.userdata.get("device_mac", "")
        if not mac:
            return "No device context available."

        from .memory_service import get_memory_service
        service = get_memory_service()

        if not service.is_ready():
            return "Memory service is not available."

        await service.write_fact(mac, fact, category=category)
        return f"Remembered: {fact}"

    except Exception as e:
        logger.error(f"[MEMORY_TOOL] Write failed: {e}")
        return "Failed to save memory."


MEMORY_TOOLS = [memory_search, memory_write]
