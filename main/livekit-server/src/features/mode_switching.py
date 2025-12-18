"""
Mode switching functionality for Cheeko AI Assistant
Allows switching between different agent personalities/templates
Extracted from main_agent.py for better modularity
"""

import logging
import os
import aiohttp
from livekit.agents import function_tool, RunContext
from src.utils.database_helper import DatabaseHelper

logger = logging.getLogger("mode_switching")

# Module-level variable to store assistant instance
_assistant_instance = None

# Mode name aliases for handling transcript variations
# Keys must match EXACT database mode names
MODE_ALIASES = {
    "Cheeko": ["chiko", "chico", "cheeko", "cheek o", "default", "default mode", "normal mode"],

    "Music": ["music", "music mode", "musician", "music time", "sing", "singing", "song", "songs"],
    "Tutor": ["tutor", "tutor mode", "teacher", "teach", "teaching", "study", "study mode", "learning", "learn"],
    "Chat": ["chat", "chat mode", "talk", "conversation", "friend", "buddy", "chatting"],
}


def normalize_mode_name(mode_input: str) -> str:
    """
    Normalize mode name input to handle transcript variations

    Args:
        mode_input: Raw mode name from speech transcript

    Returns:
        Normalized canonical mode name or original input if no match
    """
    if not mode_input:
        return mode_input

    # Normalize: lowercase, strip whitespace, remove special chars
    normalized = mode_input.lower().strip()
    normalized = normalized.replace("-", " ").replace("_", " ")

    # Direct match first (case-insensitive comparison with canonical names)
    for canonical_name in MODE_ALIASES.keys():
        if normalized == canonical_name.lower():
            return canonical_name

    # Check aliases
    for canonical_name, aliases in MODE_ALIASES.items():
        if normalized in [alias.lower() for alias in aliases]:
            logger.info(f"🔍 Matched '{mode_input}' → '{canonical_name}' via alias")
            return canonical_name

    # Check if input matches canonical name when spaces are removed
    normalized_no_space = normalized.replace(" ", "")
    for canonical_name in MODE_ALIASES.keys():
        if normalized_no_space == canonical_name.lower():
            logger.info(f"🔍 Matched '{mode_input}' → '{canonical_name}' via space removal")
            return canonical_name

    # No match found - return original for backend to handle
    logger.warning(f"⚠️ No alias match found for '{mode_input}', passing as-is")
    return mode_input


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
    Update agent configuration mode by applying a template
    
    This switches the agent's personality to a different mode like Story, Music, 
    Tutor, or Chat by updating the agent's template configuration in the database
    and dynamically reloading the new prompt.

    Args:
        mode_name: Template mode name (e.g., "Cheeko", "Story", "Music", "Tutor", "Chat")

    Returns:
        Success or error message confirming the mode change
        
    Examples:
        - "Switch to story mode"
        - "Change to tutor mode"
        - "Go back to normal mode"
    """
    logger.info(f"🔄 [MODE] Function called: update_agent_mode(mode_name='{mode_name}')")
    
    try:
        # Get assistant instance
        if not _assistant_instance:
            logger.error("❌ [MODE] No assistant instance available")
            return "Sorry, I couldn't switch modes right now."

        # 1. Validate device MAC
        if not _assistant_instance.device_mac:
            logger.error("❌ [MODE] Device MAC address not available")
            return "Device MAC address is not available"

        # 2. Get Manager API configuration
        manager_api_url = os.getenv("MANAGER_API_URL")
        manager_api_secret = os.getenv("MANAGER_API_SECRET")

        if not manager_api_url or not manager_api_secret:
            logger.error("❌ [MODE] Manager API not configured")
            return "Manager API is not configured"

        # 3. Fetch agent_id using DatabaseHelper
        db_helper = DatabaseHelper(manager_api_url, manager_api_secret)
        agent_id = await db_helper.get_agent_id(_assistant_instance.device_mac)

        if not agent_id:
            logger.error(f"❌ [MODE] No agent found for MAC: {_assistant_instance.device_mac}")
            return f"No agent found for device MAC: {_assistant_instance.device_mac}"

        # Normalize mode name to handle transcript variations
        normalized_mode = normalize_mode_name(mode_name)
        if normalized_mode != mode_name:
            logger.info(f"🔄 Mode name normalized: '{mode_name}' → '{normalized_mode}'")

        logger.info(f"🔄 Updating agent {agent_id} to mode: {normalized_mode}")

        # 4. Call update-mode API (updates template_id in database)
        url = f"{manager_api_url}/agent/update-mode"
        headers = {
            "Authorization": f"Bearer {manager_api_secret}",
            "Content-Type": "application/json"
        }
        payload = {
            "agentId": agent_id,
            "modeName": normalized_mode
        }

        timeout = aiohttp.ClientTimeout(total=10)
        async with aiohttp.ClientSession(timeout=timeout) as session:
            async with session.put(url, json=payload, headers=headers) as response:
                if response.status == 200:
                    result = await response.json()
                    logger.info(f"✅ Agent mode updated in database to '{normalized_mode}' for agent: {agent_id}")

                    # 5. Get prompt from API response
                    logger.info("📄 Using prompt from API response")
                    if result.get('code') == 0 and result.get('data'):
                        new_prompt = result.get('data')
                        logger.info(f"📄 Retrieved prompt from API (length: {len(new_prompt)} chars)")
                    else:
                        logger.warning(f"⚠️ No prompt data in response")
                        return f"Mode updated to '{normalized_mode}' in database. Please reconnect to apply changes."

                    # 6. Inject memory into new prompt (if available)
                    try:
                        if _assistant_instance._agent_session and hasattr(_assistant_instance._agent_session, '_memory_provider'):
                            memory_provider = _assistant_instance._agent_session._memory_provider
                            if memory_provider:
                                memories = await memory_provider.query_memory("conversation history")
                                if memories:
                                    new_prompt = new_prompt.replace("<memory>", f"<memory>\n{memories}")
                                    logger.info(f"💭 Injected memories into new prompt ({len(memories)} chars)")
                    except Exception as e:
                        logger.warning(f"Could not inject memories: {e}")

                    # 7. Update the agent's instructions dynamically
                    _assistant_instance._instructions = new_prompt
                    logger.info(f"📝 Instructions updated dynamically (length: {len(new_prompt)} chars)")

                    # 8. Update session if available (for immediate effect)
                    if _assistant_instance._agent_session:
                        try:
                            # Update session's agent internal instructions
                            _assistant_instance._agent_session._agent._instructions = new_prompt

                            # Also update session chat context if possible
                            if hasattr(_assistant_instance._agent_session, 'history') and hasattr(_assistant_instance._agent_session.history, 'messages'):
                                # Update the system message in history
                                if len(_assistant_instance._agent_session.history.messages) > 0:
                                    if hasattr(_assistant_instance._agent_session.history.messages[0], 'content'):
                                        _assistant_instance._agent_session.history.messages[0].content = new_prompt
                                        logger.info(f"🔄 Session chat context updated!")

                            logger.info(f"🔄 Session instructions updated in real-time!")
                        except Exception as e:
                            logger.warning(f"⚠️ Could not update session directly: {e}")

                    return f"Successfully updated agent mode to '{normalized_mode}' and reloaded the new prompt! The changes are now active in this conversation."

                else:
                    error_text = await response.text()
                    logger.error(f"❌ Failed to update mode: {response.status} - {error_text}")
                    return f"Failed to update mode: {error_text}"

    except aiohttp.ClientError as e:
        logger.error(f"Network error updating agent mode: {e}")
        return f"Network error: Unable to connect to server"
    except Exception as e:
        logger.error(f"Error updating agent mode: {e}")
        import traceback
        logger.error(f"Traceback: {traceback.format_exc()}")
        return f"Error updating agent mode: {str(e)}"
