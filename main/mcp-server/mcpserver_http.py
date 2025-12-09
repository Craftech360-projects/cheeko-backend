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
DEFAULT_DEVICE_ID = os.getenv("DEFAULT_DEVICE_ID", "aa:bb:cc:dd:ee:ff")
MCP_SERVER_PORT = int(os.getenv("MCP_SERVER_PORT", "8080"))

# Device Aliases Mapping
DEVICE_ALIASES = {
    "toy": DEFAULT_DEVICE_ID,
    "my toy": DEFAULT_DEVICE_ID,
    "the toy": DEFAULT_DEVICE_ID,
    "esp32": DEFAULT_DEVICE_ID,
    "device": DEFAULT_DEVICE_ID
}

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
                        "description": "Device MAC address or alias like 'toy' (e.g., 'aa:bb:cc:dd:ee:ff' or 'toy')"
                    },
                    "action": {
                        "type": "string",
                        "enum": ["on", "off", "brightness"],
                        "description": "Action to perform: 'on' to turn on, 'off' to turn off, 'brightness' to set level"
                    },
                    "brightness": {
                        "type": "integer",
                        "description": "Brightness level (0-100), only used when action is 'brightness'",
                        "minimum": 0,
                        "maximum": 100
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
                        "description": "Device MAC address or alias like 'toy'"
                    },
                    "color": {
                        "type": "string",
                        "description": "Color name (red, green, blue, yellow, purple, white) or hex code (#RRGGBB)"
                    }
                },
                "required": ["device_id", "color"]
            }
        ),
        Tool(
            name="get_esp32_status",
            description="Get the current status of an ESP32 device including connection state, mode, and settings.",
            inputSchema={
                "type": "object",
                "properties": {
                    "device_id": {
                        "type": "string",
                        "description": "Device MAC address or alias like 'toy'"
                    }
                },
                "required": ["device_id"]
            }
        ),
        Tool(
            name="set_esp32_volume",
            description="Set the audio volume on an ESP32 device.",
            inputSchema={
                "type": "object",
                "properties": {
                    "device_id": {
                        "type": "string",
                        "description": "Device MAC address or alias like 'toy'"
                    },
                    "volume": {
                        "type": "integer",
                        "description": "Volume level (0-100)",
                        "minimum": 0,
                        "maximum": 100
                    }
                },
                "required": ["device_id", "volume"]
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
        elif name == "get_esp32_status":
            return await get_esp32_status(**arguments)
        elif name == "set_esp32_volume":
            return await set_esp32_volume(**arguments)
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
    brightness: Optional[int] = None
) -> list[TextContent]:
    """Control ESP32 LED light."""
    
    # Resolve alias if possible
    resolved_id = DEVICE_ALIASES.get(device_id.lower(), device_id)
    logger.info(f"💡 Controlling light: {device_id} -> {resolved_id}, action={action}, brightness={brightness}")
    
    try:
        # Prepare command payload
        command = {
            "action": f"led_{action}",
            "value": brightness if action == "brightness" else None
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
        if action == "on":
            message = f"✅ Turned on the light for device {device_id}"
        elif action == "off":
            message = f"✅ Turned off the light for device {device_id}"
        elif action == "brightness":
            message = f"✅ Set brightness to {brightness}% for device {device_id}"
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
    color: str
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
    
    # Resolve alias
    resolved_id = DEVICE_ALIASES.get(device_id.lower(), device_id)
    logger.info(f"🎨 Setting color: {device_id} -> {resolved_id}, color={color_value}")
    
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


async def get_esp32_status(device_id: str) -> list[TextContent]:
    """Get ESP32 device status."""
    
    resolved_id = DEVICE_ALIASES.get(device_id.lower(), device_id)
    logger.info(f"📊 Getting status: {device_id} -> {resolved_id}")
    
    try:
        response = await http_client.get(f"/api/device/{resolved_id}/status")
        response.raise_for_status()

        
        status = response.json()
        
        # Format status message
        message = f"""📊 Device Status for {device_id}:
- Connected: {status.get('connected', 'Unknown')}
- Mode: {status.get('mode', 'Unknown')}
- Character: {status.get('character', 'Unknown')}
- Battery: {status.get('battery', 'Unknown')}%
- Signal: {status.get('signal', 'Unknown')}"""
        
        logger.info(f"Retrieved status for {device_id}")
        
        return [TextContent(type="text", text=message)]
        
    except httpx.HTTPStatusError as e:
        if e.response.status_code == 404:
            message = f"❌ Device {device_id} not found or not connected"
        else:
            message = f"❌ Failed to get status: HTTP {e.response.status_code}"
        logger.error(message)
        return [TextContent(type="text", text=message)]
    except Exception as e:
        error_msg = f"Failed to get device status: {str(e)}"
        logger.error(error_msg)
        return [TextContent(type="text", text=f"❌ {error_msg}")]


async def set_esp32_volume(
    device_id: str,
    volume: int
) -> list[TextContent]:
    """Set ESP32 audio volume."""
    
    resolved_id = DEVICE_ALIASES.get(device_id.lower(), device_id)
    logger.info(f"🔊 Setting volume: {device_id} -> {resolved_id}, volume={volume}")
    
    try:
        command = {
            "action": "set_volume",
            "value": volume
        }
        
        response = await http_client.post(
            f"/api/device/{resolved_id}/control",
            json=command
        )
        response.raise_for_status()
        
        message = f"✅ Set volume to {volume}% for device {device_id}"
        logger.info(message)
        
        return [TextContent(type="text", text=message)]
        
    except Exception as e:
        error_msg = f"Failed to set volume: {str(e)}"
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
    logger.info(f"🏷️  Default Device ID: {DEFAULT_DEVICE_ID}")
    
    uvicorn.run(app, host="0.0.0.0", port=MCP_SERVER_PORT, log_level="info")
