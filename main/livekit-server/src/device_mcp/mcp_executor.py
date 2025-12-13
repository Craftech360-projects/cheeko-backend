"""LiveKit MCP tool executor"""

import logging
import json
from typing import Dict, Any, Optional
from .mcp_client import LiveKitMCPClient
from .mcp_handler import (
    handle_volume_set,
    handle_volume_adjust,
    handle_volume_get,
    handle_volume_mute,
    handle_light_color_set,
    handle_battery_status_get,
    handle_light_mode_set,
    handle_rainbow_speed_set,
)

logger = logging.getLogger("mcp_executor")


class LiveKitMCPExecutor:
    """Executor for MCP tools via LiveKit data channel"""

    def __init__(self):
        self.mcp_client = LiveKitMCPClient()
        self._volume_cache: Optional[int] = None
        self._battery_cache: Optional[Dict[str, Any]] = None

    def set_context(self, context, audio_player=None, unified_audio_player=None):
        """Set the agent context for MCP communication"""
        self.mcp_client.set_context(context, audio_player, unified_audio_player)

    def is_ready(self) -> bool:
        """Check if the executor is ready"""
        return self.mcp_client.is_ready()

    # Volume Control Methods
    async def set_volume(self, volume: int) -> str:
        """
        Set device volume to a specific level

        Args:
            volume: Volume level (0-100)

        Returns:
            Status message for user feedback
        """
        try:
            # Validate volume level
            if not isinstance(volume, int) or volume < 0 or volume > 100:
                return "Volume level must be between 0 and 100."

            await handle_volume_set(self.mcp_client, volume)
            self._volume_cache = volume

            # Return appropriate response based on level
            if volume == 0:
                return "Volume set to mute."
            elif volume <= 30:
                return f"Volume set to {volume}% (low)."
            elif volume <= 70:
                return f"Volume set to {volume}% (medium)."
            else:
                return f"Volume set to {volume}% (high)."

        except Exception as e:
            logger.error(f"Error setting volume: {e}")
            return "Sorry, I couldn't adjust the volume right now."

    async def adjust_volume(self, action: str, step: int = 10) -> str:
        """
        Adjust device volume up or down

        Args:
            action: 'up'/'increase' or 'down'/'decrease'
            step: Volume adjustment step (default 10)

        Returns:
            Status message for user feedback
        """
        try:
            # Validate action
            if action.lower() not in ["up", "increase", "down", "decrease"]:
                return "Please specify 'up' or 'down' to adjust the volume."

            # Validate step
            if not isinstance(step, int) or step < 1 or step > 50:
                return "Step must be between 1 and 50."

            await handle_volume_adjust(self.mcp_client, action, step)

            # Calculate estimated new volume if we have cached value
            if self._volume_cache is not None:
                if action.lower() in ["up", "increase"]:
                    new_level = min(100, self._volume_cache + step)
                    self._volume_cache = new_level
                    return f"Volume increased to {new_level}%."
                else:
                    new_level = max(0, self._volume_cache - step)
                    self._volume_cache = new_level
                    if new_level == 0:
                        return "Volume muted."
                    else:
                        return f"Volume decreased to {new_level}%."
            else:
                action_word = "increased" if action.lower() in ["up", "increase"] else "decreased"
                return f"Volume {action_word} by {step}%."

        except Exception as e:
            logger.error(f"Error adjusting volume: {e}")
            return "Sorry, I couldn't adjust the volume right now."

    async def get_volume(self) -> str:
        """
        Get current device volume level

        Returns:
            Current volume status message
        """
        try:
            await handle_volume_get(self.mcp_client)

            # Return cached volume if available, otherwise indicate we're checking
            if self._volume_cache is not None:
                return f"Current volume is {self._volume_cache}%."
            else:
                return "Checking current volume level..."

        except Exception as e:
            logger.error(f"Error getting volume: {e}")
            return "Sorry, I couldn't check the volume right now."

    async def mute_device(self) -> str:
        """
        Mute the device (set volume to 0)

        Returns:
            Status message for user feedback
        """
        try:
            await handle_volume_mute(self.mcp_client, mute=True)
            self._volume_cache = 0
            return "Device muted."

        except Exception as e:
            logger.error(f"Error muting device: {e}")
            return "Sorry, I couldn't mute the device right now."

    async def unmute_device(self, level: int = 50) -> str:
        """
        Unmute the device and set volume to specified level

        Args:
            level: Volume level to restore (default 50)

        Returns:
            Status message for user feedback
        """
        try:
            # Validate level
            if not isinstance(level, int) or level < 1 or level > 100:
                level = 50  # Default to 50 if invalid

            await handle_volume_mute(self.mcp_client, mute=False)
            self._volume_cache = level
            return f"Device unmuted and volume set to {level}%."

        except Exception as e:
            logger.error(f"Error unmuting device: {e}")
            return "Sorry, I couldn't unmute the device right now."

    # Cache Management
    def update_volume_cache(self, level: int):
        """
        Update the cached volume level

        Args:
            level: Current volume level from device
        """
        if isinstance(level, int) and 0 <= level <= 100:
            self._volume_cache = level
            logger.info(f"Updated volume cache: {level}%")

    def get_cached_volume(self) -> Optional[int]:
        """
        Get the cached volume level

        Returns:
            Cached volume level or None if not available
        """
        return self._volume_cache

    # Light Control Method
    async def set_light_color(self, color: str) -> str:
        """Set light color"""
        try:
            # Convert color name to RGB if needed
            rgb_color = self._convert_color_to_rgb(color)
            if not rgb_color:
                return f"Unknown color: {color}. Please use color names like red, blue, green, pink, etc."

            await handle_light_color_set(self.mcp_client, rgb_color)
            return f"Light color set to {color}."

        except Exception as e:
            logger.error(f"Error setting light color: {e}")
            return "Sorry, I couldn't change the light color right now."

    def _convert_color_to_rgb(self, color: str) -> dict:
        """Convert color name to RGB values"""
        color_map = {
            "red": {"red": 255, "green": 0, "blue": 0},
            "green": {"red": 0, "green": 255, "blue": 0},
            "blue": {"red": 0, "green": 0, "blue": 255},
            "white": {"red": 255, "green": 255, "blue": 255},
            "yellow": {"red": 255, "green": 255, "blue": 0},
            "purple": {"red": 128, "green": 0, "blue": 128},
            "orange": {"red": 255, "green": 165, "blue": 0},
            "pink": {"red": 255, "green": 192, "blue": 203},
            "cyan": {"red": 0, "green": 255, "blue": 255},
            "magenta": {"red": 255, "green": 0, "blue": 255},
            "off": {"red": 0, "green": 0, "blue": 0}
        }

        color_lower = color.lower().strip()
        return color_map.get(color_lower)

    # Battery Status Method
    async def get_battery_status(self) -> str:
        """Get battery percentage with status details"""
        try:
            # Send request and wait for response
            logger.info("Sending battery status request and waiting for response...")
            response = await handle_battery_status_get(self.mcp_client, wait_for_response=True)

            # Check for error in response
            if response.get("error"):
                logger.error(f"Error in battery response: {response.get('error')}")
                return "Sorry, I couldn't check the battery right now."

            # Parse the response
            # The response structure is: {"result": {"content": [{"type": "text", "text": "{json_string}"}]}}
            result = response.get("result", {})
            content = result.get("content", [])

            if content and len(content) > 0:
                text_content = content[0].get("text", "{}")
                try:
                    # Parse the JSON string
                    battery_data = json.loads(text_content)
                    logger.info(f"Parsed battery data: {battery_data}")

                    percentage = battery_data.get("percentage", "unknown")
                    voltage = battery_data.get("voltage_mv", 0)
                    charging = battery_data.get("charging", False)
                    state = battery_data.get("state", "unknown")

                    # Build response message - keep it simple and concise
                    if charging:
                        message = f"Battery is at {percentage}% and charging"
                    elif state == "critical":
                        message = f"Battery is at {percentage}%, critically low"
                    elif state == "low":
                        message = f"Battery is at {percentage}%, running low"
                    else:
                        message = f"Battery is at {percentage}%"

                    logger.info(f"Returning battery status: {message}")
                    return message

                except json.JSONDecodeError as e:
                    logger.error(f"Failed to parse battery response JSON: {e}")
                    logger.error(f"Raw text content: {text_content}")
                    return "Received battery data but couldn't parse it."
            else:
                logger.warning("Battery response has no content")
                return "Received empty battery response from device."

        except Exception as e:
            logger.error(f"Error getting battery status: {e}")
            import traceback
            logger.error(f"Traceback: {traceback.format_exc()}")
            return "Sorry, I couldn't check the battery right now."


    async def set_light_mode(self, mode: str) -> str:
        """Set light mode (rainbow, default, custom, etc.)"""
        try:
            await handle_light_mode_set(self.mcp_client, mode)
            return f"Light mode set to {mode}."

        except Exception as e:
            logger.error(f"Error setting light mode: {e}")
            return "Sorry, I couldn't change the light mode right now."
    
    async def set_rainbow_speed(self, speed_ms: str) -> str:
      """Set rainbow mode speed"""
      try:
          # Convert speed_ms to integer and validate
          try:
              speed_value = int(speed_ms)
              if speed_value < 50 or speed_value > 1000:
                  return "Speed must be between 50 and 1000 milliseconds."
          except ValueError:
              return "Invalid speed value. Please provide a number between 50 and 1000."

          await handle_rainbow_speed_set(self.mcp_client, speed_value)
          return f"Rainbow speed set to {speed_value}ms."

      except Exception as e:
          logger.error(f"Error setting rainbow speed: {e}")
          return "Sorry, I couldn't change the rainbow speed right now."
    # Generic Tool Execution
    async def execute_tool(self, tool_name: str, arguments: Dict[str, Any] = None) -> str:
        """
        Execute a generic MCP tool

        Args:
            tool_name: Name of the tool to execute
            arguments: Tool arguments

        Returns:
            Execution result message
        """
        try:
            await self.mcp_client.send_function_call(tool_name, arguments)
            return f"Tool '{tool_name}' executed successfully."

        except Exception as e:
            logger.error(f"Error executing tool '{tool_name}': {e}")
            return f"Sorry, I couldn't execute the tool '{tool_name}' right now."