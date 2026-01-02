"""
Mode switching functionality for Cheeko AI Assistant
Sends character-change message to gateway to switch to a different agent worker
"""

import json
import logging
from livekit.agents import function_tool, RunContext

logger = logging.getLogger("mode_switching")

# Module-level variable to store assistant instance
_assistant_instance = None

# Character name aliases for handling transcript variations
# Keys must match EXACT character names expected by gateway
CHARACTER_ALIASES = {
    "Cheeko": ["chiko", "chico", "cheeko", "cheek o", "default", "default mode", "normal", "normal mode", "regular"],
    "Math Tutor": ["math tutor", "math", "maths", "math mode", "tutor", "math teacher", "mathematics"],
    "Riddle Solver": ["riddle solver", "riddle", "riddles", "riddle mode", "riddle game", "puzzle", "puzzles"],
    "Word Ladder": ["word ladder", "word game", "word", "words", "ladder", "word ladder game"],
}


def normalize_character_name(name_input: str) -> str:
    """
    Normalize character name input to handle transcript variations

    Args:
        name_input: Raw character name from speech transcript

    Returns:
        Normalized canonical character name or original input if no match
    """
    if not name_input:
        return name_input

    # Normalize: lowercase, strip whitespace, remove special chars
    normalized = name_input.lower().strip()
    normalized = normalized.replace("-", " ").replace("_", " ")

    # Direct match first (case-insensitive comparison with canonical names)
    for canonical_name in CHARACTER_ALIASES.keys():
        if normalized == canonical_name.lower():
            return canonical_name

    # Check aliases
    for canonical_name, aliases in CHARACTER_ALIASES.items():
        if normalized in [alias.lower() for alias in aliases]:
            logger.info(f"🔍 Matched '{name_input}' → '{canonical_name}' via alias")
            return canonical_name

    # Check if input contains key words
    for canonical_name, aliases in CHARACTER_ALIASES.items():
        for alias in aliases:
            if alias in normalized or normalized in alias:
                logger.info(f"🔍 Partial match '{name_input}' → '{canonical_name}'")
                return canonical_name

    # No match found - return original for backend to handle
    logger.warning(f"⚠️ No alias match found for '{name_input}', passing as-is")
    return name_input


def inject_assistant_context(assistant):
    """
    Inject assistant instance into this module for function tools to access

    Args:
        assistant: The Assistant instance
    """
    global _assistant_instance
    _assistant_instance = assistant
    logger.info("🔄 Assistant context injected into mode_switching")


@function_tool
async def update_agent_mode(context: RunContext, mode_name: str) -> str:
    """
    Switch to a different character/agent mode.

    This switches to a completely different agent like Math Tutor, Riddle Solver,
    or Word Ladder by sending a request to the gateway.

    Args:
        mode_name: Character name to switch to (e.g., "Math Tutor", "Riddle Solver", "Word Ladder", "Cheeko")

    Returns:
        Confirmation message about the switch

    Examples:
        - "Switch to Math Tutor"
        - "I want to play riddles"
        - "Let's do word ladder"
        - "Go back to Cheeko"
        - "Change to math mode"
    """
    logger.info(f"🎭 [CHARACTER-SWITCH] Function called: update_agent_mode(mode_name='{mode_name}')")

    try:
        # Get assistant instance
        if not _assistant_instance:
            logger.error("❌ [CHARACTER-SWITCH] No assistant instance available")
            return "Sorry, I couldn't switch characters right now."

        # Check for session context
        if not _assistant_instance._session_context:
            logger.error("❌ [CHARACTER-SWITCH] No session context available")
            return "Sorry, I couldn't switch characters right now."

        # Normalize character name to handle transcript variations
        normalized_name = normalize_character_name(mode_name)
        if normalized_name != mode_name:
            logger.info(f"🎭 Character name normalized: '{mode_name}' → '{normalized_name}'")

        logger.info(f"🎭 [CHARACTER-SWITCH] Switching to: {normalized_name}")

        # Send character-change message via data channel to gateway
        message = {
            "type": "character-change",
            "characterName": normalized_name
        }

        await _assistant_instance._session_context.room.local_participant.publish_data(
            json.dumps(message).encode("utf-8"),
            reliable=True
        )

        logger.info(f"🎭 [CHARACTER-SWITCH] Sent character-change to gateway: {normalized_name}")

        # Return a friendly message - the gateway will handle the actual switch
        return f"Switching to {normalized_name}! See you soon!"

    except Exception as e:
        logger.error(f"❌ [CHARACTER-SWITCH] Error: {e}")
        import traceback
        logger.error(f"Traceback: {traceback.format_exc()}")
        return f"Sorry, I couldn't switch to {mode_name} right now."
