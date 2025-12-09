# ESP32 MCP Implementation Guide

This guide explains how to run the MCP (Model Context Protocol) integration for controlling ESP32 devices via voice using LiveKit.

## Architecture

1. **LiveKit Agent** (`esp32_voice_agent.py`):
   - Uses official `livekit-agents[mcp]` support
   - Runs the MCP server as a subprocess (Stdio transport)
   - Converts voice commands -> MCP tool calls

2. **MCP Server** (`mcp-server/mcp_esp32_server.py`):
   - Standalone Python script
   - Defines tools: `control_esp32_light`, `set_esp32_led_color`, etc.
   - Translates tool calls -> REST API requests to MQTT Gateway

3. **MQTT Gateway** (`mqtt-gateway/app.js`):
   - Existing NodeJS gateway
   - New REST API endpoints (`/api/device/:id/control`)
   - Publishes MQTT messages to physical ESP32 devices

## Setup Instructions

### 1. MQTT Gateway Setup

Install express for the API:
```bash
cd main/mqtt-gateway
npm install express
```
Update your `app.js` and `api/device-api.js` are already created.

Restart the gateway:
```bash
pm2 restart all
# OR
node app.js
```
*Port 8081 must be free.*

### 2. MCP Server Setup

Dependencies are managed by the LiveKit agent environment usually, but for development:

```bash
cd main/mcp-server
pip install -r requirements.txt
```

### 3. LiveKit Agent Setup

Install dependencies:
```bash
cd main/livekit-server
pip install -r requirements.txt
```

Set environment variables in `main/livekit-server/.env`:
```env
LIVEKIT_URL=...
LIVEKIT_API_KEY=...
LIVEKIT_API_SECRET=...
MCP_SERVER_URL=stdio # Not strictly used by StdIO but good for reference
MQTT_GATEWAY_URL=http://localhost:8081
```

### 4. Running the Agent

```bash
cd main/livekit-server
python esp32_voice_agent.py dev
```

## How it Works

1. You say: "Turn on the light for device AA:BB:CC..."
2. LLM decides to call tool `control_esp32_light(device_id="AA:BB:CC...", action="on")`
3. LiveKit Agent sends this request to `mcp_esp32_server.py` via Stdio.
4. `mcp_esp32_server.py` sends POST request to `http://localhost:8081/api/device/AA:BB:CC.../control`.
5. MQTT Gateway receives POST, publishes MQTT message `devices/p2p/AA:BB:CC...` with payload `{"action": "led_on"}`.
6. ESP32 receives MQTT message and turns on the light.
7. Success message flows back: MQTT Gateway -> MCP Server -> LiveKit Agent -> TTS -> You.
