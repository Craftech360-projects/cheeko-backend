"""
MCP Server for ESP32 Device Control via MQTT Gateway

This server exposes tools for controlling ESP32 devices through voice commands.
It communicates with the MQTT Gateway REST API to send commands to devices.
"""

import os
import logging
import asyncio
from typing import Any, Dict, Optional
from dotenv import load_dotenv

# MCP Server imports
from mcp.server import Server
from mcp.server.stdio import stdio_server
from mcp.types import Tool, TextContent

# HTTP client for MQTT Gateway API
import httpx

# Load environment variables
load_dotenv()

# Configuration
MQTT_GATEWAY_URL = os.getenv("MQTT_GATEWAY_URL", "http://localhost:8081")
LOG_LEVEL = os.getenv("LOG_LEVEL", "INFO")

# Setup logging
logging.basicConfig(
    level=getattr(logging, LOG_LEVEL),
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger("mcp-esp32-server")

# Create MCP server instance
app = Server("esp32-controller")

# HTTP client for MQTT Gateway
http_client = httpx.AsyncClient(
    base_url=MQTT_GATEWAY_URL,
    timeout=30.0
)


# ============ MCP Tools ============

@app.list_tools()
async def list_tools() -> list[Tool]:
    """List all available tools for ESP32 control."""
    return [
        Tool(
            name="control_esp32_light",
            description="Control the LED light on an ESP32 device. Can turn on/off or set brightness.",
            inputSchema={
                "type": "object",
                "properties": {
                    "device_id": {
                        "type": "string",
                        "description": "Device MAC address (e.g., 'aa:bb:cc:dd:ee:ff')"
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
                        "description": "Device MAC address"
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
                        "description": "Device MAC address"
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
                        "description": "Device MAC address"
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


@app.call_tool()
async def call_tool(name: str, arguments: Dict[str, Any]) -> list[TextContent]:
    """Handle tool calls from the MCP client."""
    
    logger.info(f"Tool called: {name} with arguments: {arguments}")
    
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
        logger.error(f"Error executing tool {name}: {e}", exc_info=True)
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
    
    try:
        # Prepare command payload
        command = {
            "action": f"led_{action}",
            "value": brightness if action == "brightness" else None
        }
        
        # Call MQTT Gateway API
        response = await http_client.post(
            f"/api/device/{device_id}/control",
            json=command
        )
        response.raise_for_status()
        
        result = response.json()
        
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
    
    try:
        command = {
            "action": "led_color",
            "value": color_value
        }
        
        response = await http_client.post(
            f"/api/device/{device_id}/control",
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
    
    try:
        response = await http_client.get(f"/api/device/{device_id}/status")
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
    
    try:
        command = {
            "action": "set_volume",
            "value": volume
        }
        
        response = await http_client.post(
            f"/api/device/{device_id}/control",
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


# ============ Server Lifecycle ============

async def main():
    """Run the MCP server."""
    logger.info(f"Starting MCP ESP32 Controller Server")
    logger.info(f"MQTT Gateway URL: {MQTT_GATEWAY_URL}")
    
    async with stdio_server() as (read_stream, write_stream):
        await app.run(
            read_stream,
            write_stream,
            app.create_initialization_options()
        )


if __name__ == "__main__":
    asyncio.run(main())
