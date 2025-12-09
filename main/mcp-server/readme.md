# MCP Server for ESP32 Device Control

This MCP (Model Context Protocol) server exposes tools for controlling ESP32 devices through voice commands via the LiveKit Agent.

## Quick Start

```bash
python mcpserver_http.py
```

Server runs on `http://localhost:8080` with SSE endpoint at `/sse`.

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `MQTT_GATEWAY_URL` | `http://localhost:8081` | MQTT Gateway REST API URL |
| `DEFAULT_DEVICE_ID` | `aa:bb:cc:dd:ee:ff` | Default ESP32 device MAC |
| `MCP_SERVER_PORT` | `8080` | MCP server port |
| `LOG_LEVEL` | `INFO` | Logging level |

## Available Tools

| Tool Name | Description | Parameters |
|-----------|-------------|------------|
| `control_esp32_light` | Control LED on/off/brightness | device_id, action, brightness |
| `set_esp32_led_color` | Set RGB LED color | device_id, color |
| `get_esp32_status` | Get device status | device_id |
| `set_esp32_volume` | Set audio volume | device_id, volume |

## How the Agent Discovers and Uses Tools

### 1. Tool Discovery (Automatic)

When `AgentSession` starts, LiveKit automatically connects to the MCP server via SSE and calls the `list_tools()` endpoint:

```python
@mcp_server.list_tools()
async def list_tools() -> list[Tool]:
    """List all available tools for ESP32 control."""
    return [
        Tool(
            name="control_esp32_light",
            description="Control the LED light on an ESP32 device...",
            inputSchema={
                "type": "object",
                "properties": {
                    "device_id": {...},
                    "action": {...},
                    "brightness": {...}
                },
                "required": ["device_id", "action"]
            }
        ),
        # ... more tools
    ]
```

### 2. LLM Gets Tool Definitions

LiveKit passes these tool definitions to the LLM (GPT-4o). The LLM now "knows" all available tools, their descriptions, and required parameters.

### 3. How the Agent Decides to Use Tools

The LLM uses the **tool descriptions** and **agent instructions** to decide which tool to call. When a user says something, the LLM:

1. Analyzes the user's intent
2. Matches it against available tool descriptions
3. Extracts parameters from the user's speech
4. Generates a tool call with appropriate arguments

### 4. Example Flow

```
User says: "Turn on the light on my toy"
                    |
                    v
+----------------------------------------------------------+
| GPT-4o thinks:                                           |
| - User wants to turn on a light                          |
| - "toy" is mentioned as the device                       |
| - Tool "control_esp32_light" matches this request        |
| - action="on", device_id="toy"                           |
+----------------------------------------------------------+
                    |
                    v
LiveKit sends to MCP server:
{
  "method": "tools/call",
  "params": {
    "name": "control_esp32_light",
    "arguments": {"device_id": "toy", "action": "on"}
  }
}
                    |
                    v
MCP Server executes -> MQTT Gateway -> ESP32
                    |
                    v
Response: "Turned on the light for device toy"
                    |
                    v
Agent speaks: "I've turned on the light on your toy"
```

### 5. Architecture Overview

```
+---------------+     SSE/HTTP      +--------------+     HTTP      +---------------+
|    LiveKit    | <---list_tools--> |  MCP Server  | <-----------> | MQTT Gateway  |
|     Agent     | <---call_tool---> |    (8080)    |               |    (8081)     |
|    (GPT-4o)   |                   +--------------+               +---------------+
+---------------+                                                         |
                                                                        MQTT
                                                                          |
                                                                          v
                                                                   +---------------+
                                                                   |     ESP32     |
                                                                   +---------------+
```

## Device Aliases

The server supports device aliases for easier voice control:

```python
DEVICE_ALIASES = {
    "toy": DEFAULT_DEVICE_ID,
    "my toy": DEFAULT_DEVICE_ID,
    "the toy": DEFAULT_DEVICE_ID,
    "esp32": DEFAULT_DEVICE_ID,
    "device": DEFAULT_DEVICE_ID
}
```

When a user says "turn on the light on my toy", the alias is resolved to the actual MAC address.

## Service Startup Order

Ensure services start in this order:

1. **MQTT Gateway** (port 8081) - Must be running first
2. **MCP Server** (port 8080) - Connects to MQTT Gateway
3. **LiveKit Agent** - Connects to MCP Server

## Testing

Test the MCP server endpoints:

```bash
# Health check (via MQTT Gateway)
curl http://localhost:8081/api/health

# Test control endpoint directly
curl -X POST "http://localhost:8081/api/device/aa:bb:cc:dd:ee:ff/control" \
  -H "Content-Type: application/json" \
  -d '{"action":"led_on","value":null}'
```

## Writing Good Tool Descriptions

The key to effective tool usage is writing clear, specific descriptions. The LLM decides which tool to use based on:

- **Tool name**: Should be descriptive (e.g., `control_esp32_light`)
- **Description**: Explain what the tool does and when to use it
- **Input schema**: Define parameters with clear descriptions

Example of a well-documented tool:

```python
Tool(
    name="control_esp32_light",
    description="Control the LED light on an ESP32 device. Can turn on/off or set brightness.",
    inputSchema={
        "type": "object",
        "properties": {
            "device_id": {
                "type": "string",
                "description": "Device MAC address or alias like 'toy'"
            },
            "action": {
                "type": "string",
                "enum": ["on", "off", "brightness"],
                "description": "Action to perform"
            }
        },
        "required": ["device_id", "action"]
    }
)
```
