import logging
import json
import asyncio
from typing import Optional, Dict, Any
from datetime import datetime

logger = logging.getLogger("device_control")


class DeviceControlService:
    """Service for controlling device hardware features like volume, brightness, etc."""

    def __init__(self):
        self.context = None
        self._current_volume = None  # Cache for current volume level

    def set_context(self, context):
        """Set the agent context for sending data channel messages"""
        self.context = context

    async def _send_function_call(self, function_name: str, arguments: Dict = None) -> Dict:
        """
        Send a function call command via LiveKit data channel using xiaozhi format

        Args:
            function_name: The function name (e.g., 'self_set_volume', 'self_get_volume')
            arguments: The function arguments dictionary

        Returns:
            Dict with the message that was sent
        """
        if not self.context:
            logger.error("Device control context not available")
            raise Exception("Device control service not properly initialized")

        # Try different ways to access the room (same pattern as existing code)
        room = None
        if hasattr(self.context, 'room'):
            room = self.context.room
        else:
            logger.error("Device control context does not have room attribute")
            raise Exception("Device control service cannot access room")

        # Use the xiaozhi WebSocket/MQTT format from stable2 branch
        message = {
            "type": "function_call",
            "function_call": {
                "name": function_name,
                "arguments": arguments or {}
            },
            "timestamp": datetime.now().isoformat(),
            "request_id": f"req_{int(datetime.now().timestamp() * 1000)}"
        }

        try:
            await room.local_participant.publish_data(
                json.dumps(message).encode(),
                topic="mcp_function_call",
                reliable=True
            )
            logger.info(f"Sent function call: {function_name} with arguments: {arguments}")
            return message

        except Exception as e:
            logger.error(f"Failed to send function call: {e}")
            raise

    async def set_volume(self, level: int) -> str:
        """
        Set device volume to a specific level

        Args:
            level: Volume level (0-100)

        Returns:
            Status message for user feedback
        """
        # Validate volume level
        if not isinstance(level, int) or level < 0 or level > 100:
            return "Volume level must be between 0 and 100."

        try:
            await self._send_function_call("self_set_volume", {"volume": level})
            self._current_volume = level  # Cache the value

            # Return appropriate response based on level
            if level == 0:
                return "Volume set to mute."
            elif level <= 30:
                return f"Volume set to {level}% (low)."
            elif level <= 70:
                return f"Volume set to {level}% (medium)."
            else:
                return f"Volume set to {level}% (high)."

        except Exception as e:
            logger.error(f"Error setting volume: {e}")
            return "Sorry, I couldn't adjust the volume right now."

    async def get_volume(self) -> str:
        """
        Get current device volume level

        Returns:
            Current volume status message
        """
        try:
            await self._send_function_call("self_get_volume")

            # If we have cached volume, return it immediately
            if self._current_volume is not None:
                return f"Current volume is {self._current_volume}%."
            else:
                return "Checking current volume level..."

        except Exception as e:
            logger.error(f"Error getting volume: {e}")
            return "Sorry, I couldn't check the volume right now."

    async def volume_up(self, step: int = 10) -> str:
        """
        Increase device volume by specified step

        Args:
            step: Volume increase step (default 10)

        Returns:
            Status message for user feedback
        """
        try:
            await self._send_function_call("self_volume_up")

            # If we have cached volume, calculate new level
            if self._current_volume is not None:
                new_level = min(100, self._current_volume + step)
                self._current_volume = new_level
                return f"Volume increased to {new_level}%."
            else:
                return f"Volume increased by {step}%."

        except Exception as e:
            logger.error(f"Error increasing volume: {e}")
            return "Sorry, I couldn't increase the volume right now."

    async def volume_down(self, step: int = 10) -> str:
        """
        Decrease device volume by specified step

        Args:
            step: Volume decrease step (default 10)

        Returns:
            Status message for user feedback
        """
        try:
            await self._send_function_call("self_volume_down")

            # If we have cached volume, calculate new level
            if self._current_volume is not None:
                new_level = max(0, self._current_volume - step)
                self._current_volume = new_level
                if new_level == 0:
                    return "Volume muted."
                else:
                    return f"Volume decreased to {new_level}%."
            else:
                return f"Volume decreased by {step}%."

        except Exception as e:
            logger.error(f"Error decreasing volume: {e}")
            return "Sorry, I couldn't decrease the volume right now."

    async def mute(self) -> str:
        """
        Mute the device

        Returns:
            Status message for user feedback
        """
        try:
            await self._send_function_call("self_mute")
            self._current_volume = 0  # Cache the muted state
            return "Device muted."
        except Exception as e:
            logger.error(f"Error muting device: {e}")
            return "Sorry, I couldn't mute the device right now."

    async def unmute(self, level: int = 50) -> str:
        """
        Unmute the device

        Returns:
            Status message for user feedback
        """
        try:
            await self._send_function_call("self_unmute")
            self._current_volume = level  # Cache the restored level
            return f"Device unmuted and volume restored."
        except Exception as e:
            logger.error(f"Error unmuting device: {e}")
            return "Sorry, I couldn't unmute the device right now."

    def update_volume_cache(self, level: int):
        """
        Update the cached volume level (called when receiving device responses)

        Args:
            level: Current volume level from device
        """
        if isinstance(level, int) and 0 <= level <= 100:
            self._current_volume = level
            logger.info(f"Updated volume cache: {level}%")

    def get_cached_volume(self) -> Optional[int]:
        """
        Get the cached volume level

        Returns:
            Cached volume level or None if not available
        """
        return self._current_volume