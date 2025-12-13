"""LiveKit MCP client for device communication"""

import logging
import json
import asyncio
from typing import Optional, Dict, Any
from datetime import datetime

logger = logging.getLogger("mcp_client")


class LiveKitMCPClient:
    """MCP client for LiveKit data channel communication"""

    def __init__(self):
        self.context = None
        self.is_connected = False
        self.audio_player = None
        self.unified_audio_player = None
        self._response_futures: Dict[str, asyncio.Future] = {}
        self._response_timeout = 10.0  # 5 seconds timeout for responses

    def set_context(self, context, audio_player=None, unified_audio_player=None):
        """Set the agent context for sending data channel messages"""
        self.context = context
        self.audio_player = audio_player
        self.unified_audio_player = unified_audio_player
        self.is_connected = True

    async def send_message(self, message_type: str, data: Dict[str, Any], topic: str = "mcp_function_call") -> Dict:
        """
        Send a message via LiveKit data channel

        Args:
            message_type: Type of message (e.g., 'function_call')
            data: Message data
            topic: LiveKit data channel topic

        Returns:
            Dict with the message that was sent
        """
        if not self.context:
            logger.error("MCP client context not available")
            raise Exception("MCP client not properly initialized")

        # Get room using the same pattern as working adjust_device_volume function
        room = None
        if hasattr(self.context, 'room'):
            room = self.context.room
            logger.info("Found room directly in context")
        elif self.unified_audio_player and hasattr(self.unified_audio_player, 'context') and self.unified_audio_player.context:
            room = self.unified_audio_player.context.room
            logger.info("Found room via unified_audio_player.context")
        elif self.audio_player and hasattr(self.audio_player, 'context') and self.audio_player.context:
            room = self.audio_player.context.room
            logger.info("Found room via audio_player.context")

        if not room:
            logger.error("Cannot access room for MCP communication")
            logger.error(f"Context type: {type(self.context)}")
            logger.error(f"Available context attributes: {[attr for attr in dir(self.context) if not attr.startswith('_')]}")
            raise Exception("MCP client cannot access room")

        message = {
            "type": message_type,
            **data,
            "timestamp": datetime.now().isoformat(),
            "request_id": f"req_{int(datetime.now().timestamp() * 1000)}"
        }

        try:
            await room.local_participant.publish_data(
                json.dumps(message).encode(),
                topic=topic,
                reliable=True
            )
            logger.info(f"Sent MCP message: {message_type} to topic: {topic}")
            return message

        except Exception as e:
            logger.error(f"Failed to send MCP message: {e}")
            raise

    async def send_function_call(self, function_name: str, arguments: Dict = None, wait_for_response: bool = False) -> Dict:
        """
        Send a function call message

        Args:
            function_name: The function name (e.g., 'self_set_volume')
            arguments: The function arguments dictionary
            wait_for_response: If True, wait for and return the response

        Returns:
            Dict with the message that was sent, or the response if wait_for_response=True
        """
        data = {
            "function_call": {
                "name": function_name,
                "arguments": arguments or {}
            }
        }

        message = await self.send_message("function_call", data)

        if wait_for_response:
            request_id = message.get("request_id")
            if request_id:
                # Create a future to wait for the response
                future = asyncio.get_event_loop().create_future()
                self._response_futures[request_id] = future

                try:
                    # Wait for response with timeout
                    response = await asyncio.wait_for(future, timeout=self._response_timeout)
                    logger.info(f"Received response for {function_name}: {response}")
                    return response
                except asyncio.TimeoutError:
                    logger.warning(f"Timeout waiting for response to {function_name}")
                    self._response_futures.pop(request_id, None)
                    return {"error": "timeout", "message": "No response received from device"}
                except Exception as e:
                    logger.error(f"Error waiting for response: {e}")
                    self._response_futures.pop(request_id, None)
                    return {"error": str(e)}

        return message

    def handle_response(self, request_id: str = None, response_data: Dict[str, Any] = None):
        """
        Handle an incoming MCP response

        Args:
            request_id: The request ID this response is for (optional)
            response_data: The response data from the device
        """
        if request_id:
            # Try to match by specific request_id
            future = self._response_futures.get(request_id)
            if future and not future.done():
                future.set_result(response_data)
                logger.info(f"✅ Response handled for request {request_id}")
                return
            else:
                logger.warning(f"⚠️ No pending future found for request {request_id}")

        # Fallback: If no request_id or not found, resolve the first pending future
        # This works for single-request-at-a-time scenarios like battery check
        if not request_id or not self._response_futures.get(request_id):
            for req_id, future in list(self._response_futures.items()):
                if not future.done():
                    future.set_result(response_data)
                    logger.info(f"✅ Response matched to pending request {req_id} (fallback matching)")
                    self._response_futures.pop(req_id, None)
                    return

        logger.warning("⚠️ No pending futures to handle this response")

    def is_ready(self) -> bool:
        """Check if the MCP client is ready for communication"""
        return self.is_connected and self.context is not None

    def disconnect(self):
        """Disconnect the MCP client"""
        self.context = None
        self.is_connected = False
        logger.info("MCP client disconnected")