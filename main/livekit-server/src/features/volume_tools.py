"""
Volume and device control function tools for Cheeko AI Assistant
Extracted from main_agent.py for better modularity
"""

import logging
from livekit.agents import function_tool, RunContext

logger = logging.getLogger("volume_tools")

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
    logger.info("🔊 Assistant context injected into volume_tools")


@function_tool
async def self_set_volume(context: RunContext, volume: int) -> str:
    """
    Set device volume to a specific level
    
    Args:
        volume: Volume level between 0 and 100
        
    Returns:
        Status message confirming volume change
    """
    logger.info(f"🔊 [VOLUME] set_volume called: {volume}")
    
    if not _assistant_instance or not _assistant_instance.mcp_executor:
        return "Volume control is not available right now."

    # Set context for MCP executor
    _assistant_instance.mcp_executor.set_context(context)
    return await _assistant_instance.mcp_executor.set_volume(volume)


@function_tool
async def self_get_volume(context: RunContext, unused: str = "") -> str:
    """
    Get current device volume level
    
    Returns:
        Current volume level message
    """
    logger.info("🔊 [VOLUME] get_volume called")
    
    if not _assistant_instance or not _assistant_instance.mcp_executor:
        return "Volume control is not available right now."

    _assistant_instance.mcp_executor.set_context(context)
    return await _assistant_instance.mcp_executor.get_volume()


@function_tool
async def self_volume_up(context: RunContext, unused: str = "") -> str:
    """
    Increase device volume
    
    Returns:
        Status message confirming volume increased
    """
    logger.info("🔊 [VOLUME] volume_up called")
    
    if not _assistant_instance or not _assistant_instance.mcp_executor:
        return "Volume control is not available right now."

    _assistant_instance.mcp_executor.set_context(context)
    return await _assistant_instance.mcp_executor.adjust_volume("up")


@function_tool
async def self_volume_down(context: RunContext, unused: str = "") -> str:
    """
    Decrease device volume
    
    Returns:
        Status message confirming volume decreased
    """
    logger.info("🔊 [VOLUME] volume_down called")
    
    if not _assistant_instance or not _assistant_instance.mcp_executor:
        return "Volume control is not available right now."

    _assistant_instance.mcp_executor.set_context(context)
    return await _assistant_instance.mcp_executor.adjust_volume("down")


@function_tool
async def self_mute(context: RunContext, unused: str = "") -> str:
    """
    Mute the device
    
    Returns:
        Status message confirming device muted
    """
    logger.info("🔇 [VOLUME] mute called")
    
    if not _assistant_instance or not _assistant_instance.mcp_executor:
        return "Volume control is not available right now."

    _assistant_instance.mcp_executor.set_context(context)
    return await _assistant_instance.mcp_executor.mute_device()


@function_tool
async def self_unmute(context: RunContext, unused: str = "") -> str:
    """
    Unmute the device
    
    Returns:
        Status message confirming device unmuted
    """
    logger.info("🔊 [VOLUME] unmute called")
    
    if not _assistant_instance or not _assistant_instance.mcp_executor:
        return "Volume control is not available right now."

    _assistant_instance.mcp_executor.set_context(context)
    return await _assistant_instance.mcp_executor.unmute_device()


@function_tool
async def set_light_color(context: RunContext, color: str) -> str:
    """
    Set device LED light color
    
    Args:
        color: Color name (red, blue, green, white, yellow, purple, pink, etc.)
        
    Returns:
        Status message confirming color change
    """
    logger.info(f"💡 [LIGHT] set_light_color called: {color}")
    
    if not _assistant_instance or not _assistant_instance.mcp_executor:
        return "Light control is not available right now."

    _assistant_instance.mcp_executor.set_context(context)
    return await _assistant_instance.mcp_executor.set_light_color(color)


@function_tool
async def set_light_mode(context: RunContext, mode: str) -> str:
    """
    Set device light mode
    
    Args:
        mode: Mode name (rainbow, default, custom)
        
    Returns:
        Status message confirming mode change
    """
    logger.info(f"💡 [LIGHT] set_light_mode called: {mode}")
    
    if not _assistant_instance or not _assistant_instance.mcp_executor:
        return "Light mode control is not available right now."

    _assistant_instance.mcp_executor.set_context(context)
    return await _assistant_instance.mcp_executor.set_light_mode(mode)


@function_tool
async def set_rainbow_speed(context: RunContext, speed_ms: str) -> str:
    """
    Set rainbow LED animation speed
    
    Args:
        speed_ms: Animation speed in milliseconds (50-1000)
        
    Returns:
        Status message confirming speed change
    """
    logger.info(f"🌈 [LIGHT] set_rainbow_speed called: {speed_ms}")
    
    if not _assistant_instance or not _assistant_instance.mcp_executor:
        return "Rainbow mode speed control is not available right now."

    _assistant_instance.mcp_executor.set_context(context)
    return await _assistant_instance.mcp_executor.set_rainbow_speed(speed_ms)
