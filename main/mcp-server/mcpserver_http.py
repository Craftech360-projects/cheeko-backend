"""
MCP Server for ESP32 Device Control via MQTT Gateway (HTTP/SSE Transport)

This server exposes tools for controlling ESP32 devices through voice commands.
It communicates with the MQTT Gateway REST API to send commands to devices.
Runs as an HTTP server with SSE transport for better reliability.
"""

import os
import logging
import asyncio
from typing import Any, Dict, Optional
from dotenv import load_dotenv

# MCP Server imports
from mcp.server import Server
from mcp.server.sse import SseServerTransport
from mcp.types import Tool, TextContent
from starlette.applications import Starlette
from starlette.routing import Route, Mount

# HTTP client for MQTT Gateway API
import httpx

# Load environment variables
load_dotenv()

# Configuration
MQTT_GATEWAY_URL = os.getenv("MQTT_GATEWAY_URL", "http://localhost:8081")
LOG_LEVEL = os.getenv("LOG_LEVEL", "INFO")
MCP_SERVER_PORT = int(os.getenv("MCP_SERVER_PORT", "8080"))

# Setup logging
logging.basicConfig(
    level=getattr(logging, LOG_LEVEL),
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger("mcp-esp32-server")

# Create MCP server instance
mcp_server = Server("esp32-controller")

# HTTP client for MQTT Gateway
http_client = httpx.AsyncClient(
    base_url=MQTT_GATEWAY_URL,
    timeout=30.0
)


# ============ Device Resolution Helpers ============

async def get_devices_in_room(room_name: Optional[str] = None) -> list[Dict[str, Any]]:
    """
    Query MQTT Gateway for active devices, optionally filtered by room.
    
    Returns:
        List of device info dicts with keys: device_id, room_name, mode, character
    """
    try:
        response = await http_client.get("/api/devices")
        response.raise_for_status()
        result = response.json()
        
        devices = result.get("devices", [])
        
        # Filter by room if specified
        if room_name:
            devices = [d for d in devices if d.get("room_name") == room_name]
        
        logger.info(f"📋 Found {len(devices)} device(s) in room '{room_name}'")
        return devices
        
    except Exception as e:
        logger.error(f"❌ Failed to get devices from MQTT Gateway: {e}")
        return []


async def resolve_device_id(
    device_id: str,
    room_name: Optional[str] = None
) -> Optional[str]:
    """
    Resolve device ID from MAC address or room context.

    Priority:
    1. If device_id is a MAC address (contains ":"), use it directly
    2. If room_name provided, get device from that room (fallback)

    Returns:
        Resolved MAC address or None if not found
    """
    # Check if it's already a MAC address (contains colons)
    if ":" in device_id:
        logger.info(f"🎯 Using direct MAC address: {device_id}")
        return device_id

    # Check if device_id looks like a MAC without colons (e.g., 781c3c4b4524)
    if len(device_id) == 12 and all(c in '0123456789abcdefABCDEF' for c in device_id):
        # Format as MAC with colons
        formatted_mac = ":".join(device_id[i:i+2] for i in range(0, 12, 2)).lower()
        logger.info(f"🎯 Formatted MAC address: {device_id} -> {formatted_mac}")
        return formatted_mac

    # Fallback: Try to get device from room
    if room_name:
        devices = await get_devices_in_room(room_name)
        if devices:
            # Use first device in room
            resolved = devices[0]["device_id"]
            logger.info(f"🎯 Resolved from room '{room_name}': {resolved}")
            return resolved
        else:
            # Try to extract MAC from room name (format: {session}_{mac}_conversation)
            parts = room_name.split("_")
            if len(parts) >= 2:
                potential_mac = parts[-2]  # Second to last part
                if len(potential_mac) == 12 and all(c in '0123456789abcdefABCDEF' for c in potential_mac):
                    formatted_mac = ":".join(potential_mac[i:i+2] for i in range(0, 12, 2)).lower()
                    logger.info(f"🎯 Extracted MAC from room name: {formatted_mac}")
                    return formatted_mac

            logger.warning(f"⚠️ No devices found in room '{room_name}' and could not extract MAC")

    logger.error(f"❌ Could not resolve device_id '{device_id}' - no MAC address or room provided")
    return None


# ============ MCP Tools ============

@mcp_server.list_tools()
async def list_tools() -> list[Tool]:
    """List all available tools for ESP32 control."""
    logger.info("Listing tools...")
    return [
        Tool(
            name="control_esp32_light",
            description="Control the LED light on an ESP32 device. Can turn on/off or set brightness.",
            inputSchema={
                "type": "object",
                "properties": {
                    "device_id": {
                        "type": "string",
                        "description": "Device MAC address or alias like 'car' (e.g., 'aa:bb:cc:dd:ee:ff' or 'car')"
                    },
                    "action": {
                        "type": "string",
                        "enum": ["on", "off", "brightness", "blink", "fade_in", "fade_out"],
                        "description": "Action to perform: 'on' to turn on, 'off' to turn off, 'brightness' to set level, 'blink' to blink, 'fade_in' to fade in, 'fade_out' to fade out"
                    },
                    "brightness": {
                        "type": "integer",
                        "description": "Brightness level (0-100), only used when action is 'brightness'",
                        "minimum": 0,
                        "maximum": 100
                    },
                    "duration": {
                        "type": "integer",
                        "description": "Duration in milliseconds (e.g., 2000 = 2 seconds). For 'on' action: auto turn off after duration. For 'blink': how long to blink.",
                        "minimum": 100,
                        "maximum": 60000
                    },
                    "speed": {
                        "type": "string",
                        "enum": ["fast", "medium", "slow"],
                        "description": "Blink speed: 'fast' (100ms), 'medium' (500ms), 'slow' (1000ms). Only used with 'blink' action."
                    },
                    "count": {
                        "type": "integer",
                        "description": "Number of times to blink. Only used with 'blink' action.",
                        "minimum": 1,
                        "maximum": 100
                    },
                    "room_name": {
                        "type": "string",
                        "description": "Optional LiveKit room name to identify which device to control in multi-device scenarios"
                    }
                },
                "required": ["device_id", "action"]
            }
        ),
        Tool(
            name="set_esp32_led_color",
            description="Set the RGB LED color on an ESP32 device.",
            inputSchema={
                "type": "object",
                "properties": {
                    "device_id": {
                        "type": "string",
                        "description": "Device MAC address or alias like 'car'"
                    },
                    "color": {
                        "type": "string",
                        "description": "Color name (red, green, blue, yellow, purple, white) or hex code (#RRGGBB)"
                    },
                    "room_name": {
                        "type": "string",
                        "description": "Optional LiveKit room name to identify which device to control in multi-device scenarios"
                    }
                },
                "required": ["device_id", "color"]
            }
        ),

        Tool(
            name="control_car",
            description="Control an RC car/toy directly. Sends movement commands to the device.",
            inputSchema={
                "type": "object",
                "properties": {
                    "toy_mac": {
                        "type": "string",
                        "description": "The device MAC address (e.g., '78:1c:3c:4b:45:24' or '781c3c4b4524')"
                    },
                    "command": {
                        "type": "string",
                        "enum": ["forward", "backward", "left", "right", "stop"],
                        "description": "Movement command: 'forward' to move forward, 'backward' to reverse, 'left' to turn left, 'right' to turn right, 'stop' to stop"
                    }
                },
                "required": ["toy_mac", "command"]
            }
        )
    ]


@mcp_server.call_tool()
async def call_tool(name: str, arguments: Dict[str, Any]) -> list[TextContent]:
    """Handle tool calls from the MCP client."""
    
    logger.info(f"🔧 Tool called: {name} with arguments: {arguments}")
    
    try:
        if name == "control_esp32_light":
            return await control_esp32_light(**arguments)
        elif name == "set_esp32_led_color":
            return await set_esp32_led_color(**arguments)

        elif name == "control_car":
            return await control_car(**arguments)
        else:
            return [TextContent(
                type="text",
                text=f"Unknown tool: {name}"
            )]
    except Exception as e:
        logger.error(f"❌ Error executing tool {name}: {e}", exc_info=True)
        return [TextContent(
            type="text",
            text=f"Error: {str(e)}"
        )]


# ============ Tool Implementations ============

async def control_esp32_light(
    device_id: str,
    action: str,
    brightness: Optional[int] = None,
    duration: Optional[int] = None,
    speed: Optional[str] = None,
    count: Optional[int] = None,
    room_name: Optional[str] = None
) -> list[TextContent]:
    """Control ESP32 LED light."""

    # Speed presets (in milliseconds)
    speed_map = {
        "fast": 100,
        "medium": 500,
        "slow": 1000
    }

    # Resolve device ID using room context
    resolved_id = await resolve_device_id(device_id, room_name)

    if not resolved_id:
        error_msg = f"Could not determine device. Please provide a valid MAC address or ensure the device is connected."
        logger.error(f"❌ {error_msg}")
        return [TextContent(type="text", text=f"❌ {error_msg}")]

    logger.info(f"💡 Controlling light: {device_id} -> {resolved_id}, action={action}, brightness={brightness}, duration={duration}, speed={speed}, count={count}, room={room_name}")

    try:
        # Prepare command payload
        command = {
            "action": f"led_{action}",
            "value": brightness if action == "brightness" else None,
            "duration": duration,
            "speed": speed_map.get(speed) if speed else None,
            "count": count
        }
        
        logger.info(f"📤 Sending to MQTT Gateway: POST /api/device/{resolved_id}/control with {command}")
        
        # Call MQTT Gateway API
        response = await http_client.post(
            f"/api/device/{resolved_id}/control",
            json=command
        )
        response.raise_for_status()
        
        result = response.json()
        logger.info(f"✅ MQTT Gateway response: {result}")
        
        # Format response message
        duration_str = f" for {duration/1000} seconds" if duration else ""
        speed_str = f" at {speed} speed" if speed else ""
        count_str = f" {count} times" if count else ""

        if action == "on":
            message = f"✅ Turned on the light{duration_str} for device {device_id}"
        elif action == "off":
            message = f"✅ Turned off the light for device {device_id}"
        elif action == "brightness":
            message = f"✅ Set brightness to {brightness}%{duration_str} for device {device_id}"
        elif action == "blink":
            message = f"✅ Started blinking{count_str}{speed_str}{duration_str} for device {device_id}"
        elif action == "fade_in":
            message = f"✅ Started fade in effect{duration_str} for device {device_id}"
        elif action == "fade_out":
            message = f"✅ Started fade out effect{duration_str} for device {device_id}"
        else:
            message = f"✅ Light control command sent to {device_id}"
        
        logger.info(f"Light control successful: {message}")
        
        return [TextContent(type="text", text=message)]
        
    except httpx.HTTPStatusError as e:
        error_msg = f"Failed to control light: HTTP {e.response.status_code}"
        logger.error(error_msg)
        return [TextContent(type="text", text=f"❌ {error_msg}")]
    except Exception as e:
        error_msg = f"Failed to control light: {str(e)}"
        logger.error(error_msg)
        return [TextContent(type="text", text=f"❌ {error_msg}")]


async def set_esp32_led_color(
    device_id: str,
    color: str,
    room_name: Optional[str] = None
) -> list[TextContent]:
    """Set ESP32 LED color."""

    # Color name to RGB mapping
    color_map = {
        "red": "#FF0000",
        "green": "#00FF00",
        "blue": "#0000FF",
        "yellow": "#FFFF00",
        "purple": "#FF00FF",
        "white": "#FFFFFF",
        "cyan": "#00FFFF",
        "orange": "#FF8000"
    }

    # Convert color name to hex if needed
    color_value = color_map.get(color.lower(), color)

    # Resolve device ID using room context
    resolved_id = await resolve_device_id(device_id, room_name)

    if not resolved_id:
        error_msg = f"Could not determine device. Please provide a valid MAC address or ensure the device is connected."
        logger.error(f"❌ {error_msg}")
        return [TextContent(type="text", text=f"❌ {error_msg}")]

    logger.info(f"🎨 Setting color: {device_id} -> {resolved_id}, color={color_value}, room={room_name}")
    
    try:
        command = {
            "action": "led_color",
            "value": color_value
        }
        
        response = await http_client.post(
            f"/api/device/{resolved_id}/control",
            json=command
        )
        response.raise_for_status()
        
        message = f"✅ Set LED color to {color} for device {device_id}"
        logger.info(message)
        
        return [TextContent(type="text", text=message)]
        
    except Exception as e:
        error_msg = f"Failed to set LED color: {str(e)}"
        logger.error(error_msg)
        return [TextContent(type="text", text=f"❌ {error_msg}")]



async def control_car(toy_mac: str, command: str) -> list[TextContent]:
    """Control RC car directly via MQTT Gateway (same as light control)."""

    logger.info(f"🚗 Car control: toy_mac={toy_mac}, command={command}")

    # Format MAC address with colons if not already formatted
    if ":" not in toy_mac:
        # Convert 781c3c4b4524 to 78:1c:3c:4b:45:24
        clean_mac = toy_mac.replace("-", "").lower()
        formatted_mac = ":".join(clean_mac[i:i+2] for i in range(0, len(clean_mac), 2))
    else:
        formatted_mac = toy_mac.lower()

    # Command descriptions for response
    command_descriptions = {
        "forward": "moving forward",
        "backward": "reversing",
        "left": "turning left",
        "right": "turning right",
        "stop": "stopped"
    }

    # Map command to action (prefix with car_)
    cmd = command.lower()
    action = f"car_{cmd}"

    try:
        # Use the same control endpoint as light control
        # This sends directly to the device without needing accessory binding
        command_payload = {
            "action": action,
            "value": None,
            "timestamp": None
        }

        logger.info(f"📤 Calling MQTT Gateway: POST /api/device/{formatted_mac}/control with {command_payload}")

        response = await http_client.post(
            f"/api/device/{formatted_mac}/control",
            json=command_payload
        )

        result = response.json()
        logger.info(f"📥 MQTT Gateway response: {result}")

        response.raise_for_status()

        description = command_descriptions.get(cmd, cmd)
        message = f"✅ Car is {description}"

        logger.info(f"✅ Car control successful: {message}")

        return [TextContent(type="text", text=message)]

    except httpx.HTTPStatusError as e:
        error_msg = f"Failed to control car: HTTP {e.response.status_code}"
        logger.error(error_msg)
        return [TextContent(type="text", text=f"❌ {error_msg}")]
    except Exception as e:
        error_msg = f"Failed to control car: {str(e)}"
        logger.error(error_msg)
        return [TextContent(type="text", text=f"❌ {error_msg}")]


# ============ HTTP Server Setup ============

# Create SSE transport instance for handling server-sent events
sse = SseServerTransport("/messages")


async def handle_sse(request):
    """
    SSE endpoint that connects to the MCP server.
    
    This endpoint establishes a Server-Sent Events connection with the client
    and forwards communication to the Model Context Protocol server.
    """
    logger.info("📡 New SSE connection established")
    
    # Use sse.connect_sse to establish an SSE connection with the MCP server
    async with sse.connect_sse(request.scope, request.receive, request._send) as (
        read_stream,
        write_stream,
    ):
        # Run the MCP server with the established streams
        await mcp_server.run(
            read_stream,
            write_stream,
            mcp_server.create_initialization_options(),
        )


# Create Starlette app
app = Starlette(
    routes=[
        Route("/sse", endpoint=handle_sse, methods=["GET"]),
        Mount("/messages", app=sse.handle_post_message),
    ]
)


if __name__ == "__main__":
    import uvicorn

    logger.info(f"🚀 Starting MCP ESP32 Controller Server on port {MCP_SERVER_PORT}")
    logger.info(f"📡 SSE endpoint: http://localhost:{MCP_SERVER_PORT}/sse")
    logger.info(f"🌐 MQTT Gateway URL: {MQTT_GATEWAY_URL}")

    uvicorn.run(app, host="0.0.0.0", port=MCP_SERVER_PORT, log_level="info")
