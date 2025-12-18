"""
Battery checking function tool for Cheeko AI Assistant
Extracted from main_agent.py for better modularity and lazy loading
"""

import logging
from livekit.agents import function_tool, RunContext

logger = logging.getLogger("battery_tools")

# Module-level variable to store assistant instance
_assistant_instance = None


def inject_assistant_context(assistant):
    """
    Inject assistant instance into this module for function tools to access
    
    Args:
        assistant: The Assistant instance
    """
    global _assistant_instance
    _assistant_instance = assistant
    logger.info("🔋 Assistant context injected into battery_tools")


@function_tool
async def check_battery_level(context: RunContext) -> str:
    """
    Check the device's current battery level and charging status.
    
    This function retrieves real-time battery information from the device
    including percentage remaining and whether it's currently charging.
    
    Returns:
        str: Battery status message with percentage and charging state
    
    Examples:
        - "Battery is at 85% and charging"
        - "Battery is at 42% (not charging)"
        - "Battery is fully charged at 100%"
    """
    logger.info("🔋 [BATTERY] Function called: check_battery_level")
    
    try:
        # Get assistant instance
        if not _assistant_instance:
            logger.error("❌ [BATTERY] No assistant instance available")
            return "Sorry, I couldn't check the battery right now."
        
        # Check if MCP executor is available
        if not hasattr(_assistant_instance, 'mcp_executor') or not _assistant_instance.mcp_executor:
            logger.error("❌ [BATTERY] MCP executor not available")
            return "Sorry, battery checking is not available right now."
        
        # Use MCP executor to get battery status
        result = await _assistant_instance.mcp_executor.get_battery_status()
        
        logger.info(f"🔋 [BATTERY] Result: {result}")
        return result
        
    except Exception as e:
        logger.error(f"❌ [BATTERY] Error checking battery: {e}")
        import traceback
        logger.error(f"❌ [BATTERY] Traceback: {traceback.format_exc()}")
        return "Sorry, I couldn't check the battery level right now."
