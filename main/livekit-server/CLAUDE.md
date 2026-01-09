# CLAUDE.md - Cheeko LiveKit Server

Project configuration for Claude Code AI assistant.

---

## Project Overview

**Cheeko LiveKit Server** is a real-time voice AI agent system that connects IoT devices to AI-powered conversational agents via LiveKit.

### Architecture Components
- **LiveKit Agents** (`workers/`) - Python agents using Gemini Realtime
- **MQTT Gateway** (`../mqtt-gateway/`) - Node.js bridge for device communication
- **Client** (`../client.py`) - Python test client for device simulation

### Tech Stack
- Python 3.11+ with LiveKit Agents SDK
- Node.js with LiveKit Server SDK
- MQTT for device signaling
- LiveKit for real-time audio
- Google Gemini for AI processing

---

## Skills

### /deploy
Deploy the LiveKit agent workers to production.

```yaml
name: deploy
description: Deploy agent workers to production environment
steps:
  - Validate environment variables
  - Run tests
  - Build Docker images
  - Push to registry
  - Update Kubernetes deployment
```

### /test-agent
Run agent tests with a simulated device connection.

```yaml
name: test-agent
description: Test agent with simulated device
command: |
  cd workers && python -m pytest tests/ -v
  python test_agent_connection.py
```

### /start-dev
Start all development services locally.

```yaml
name: start-dev
description: Start gateway, agent, and test client
steps:
  - Start MQTT broker (if not running)
  - Start MQTT Gateway: cd ../mqtt-gateway && npm run dev
  - Start Cheeko Agent: python workers/cheeko_worker.py dev
  - Optionally start test client
```

### /logs
View real-time logs from all services.

```yaml
name: logs
description: Stream logs from gateway and agents
command: |
  # Use Grafana Loki or local logs
  tail -f logs/*.log
```

### /lint
Run linting and type checking on Python code.

```yaml
name: lint
description: Lint Python and JavaScript code
command: |
  cd workers && ruff check . && mypy .
  cd ../mqtt-gateway && npm run lint
```

---

## Commands

### /agent-status
Check the status of running agents.

```bash
# Query LiveKit for active rooms and agents
curl -X GET "https://$LIVEKIT_URL/twirp/livekit.RoomService/ListRooms" \
  -H "Authorization: Bearer $LIVEKIT_API_KEY"
```

### /room-info <room_name>
Get detailed information about a LiveKit room.

```bash
# List participants in a room
curl -X POST "https://$LIVEKIT_URL/twirp/livekit.RoomService/ListParticipants" \
  -H "Content-Type: application/json" \
  -d '{"room": "<room_name>"}'
```

### /cleanup-rooms
Clean up stale/ghost LiveKit rooms.

```bash
# Trigger ghost room cleanup
curl -X POST "http://localhost:3001/admin/cleanup-rooms"
```

### /generate-token <room_name> <identity>
Generate a LiveKit access token for testing.

```javascript
// Run in Node.js context
const { AccessToken } = require('livekit-server-sdk');
const at = new AccessToken(API_KEY, API_SECRET, { identity: '<identity>' });
at.addGrant({ room: '<room_name>', roomJoin: true, canPublish: true });
console.log(await at.toJwt());
```

### /simulate-device <mac_address>
Start a simulated device for testing.

```bash
cd .. && python client.py --mac <mac_address>
```

---

## Subagents

### agent-debugger
Specialized agent for debugging LiveKit agent issues.

```yaml
name: agent-debugger
description: Debug agent connection, audio, and AI processing issues
capabilities:
  - Analyze agent logs for errors
  - Check LiveKit room state
  - Verify Gemini API connectivity
  - Trace audio pipeline issues
tools:
  - Read log files
  - Query LiveKit API
  - Check environment variables
  - Analyze audio frame data
```

### gateway-analyzer
Analyze MQTT gateway behavior and connections.

```yaml
name: gateway-analyzer
description: Debug gateway issues, MQTT connections, UDP audio
capabilities:
  - Parse gateway logs
  - Analyze MQTT message flow
  - Debug UDP packet issues
  - Check device connections
tools:
  - Read gateway logs
  - Query EMQX broker stats
  - Analyze UDP traffic patterns
```

### performance-profiler
Profile and optimize system performance.

```yaml
name: performance-profiler
description: Analyze latency, memory, and CPU usage
capabilities:
  - Measure audio latency (end-to-end)
  - Profile memory usage
  - Identify bottlenecks
  - Suggest optimizations
metrics:
  - Audio round-trip time
  - Agent response latency
  - Gateway processing time
  - Memory consumption
```

### code-reviewer
Review code changes for this project.

```yaml
name: code-reviewer
description: Review Python and Node.js code for quality and security
focus_areas:
  - LiveKit SDK usage patterns
  - Async/await correctness
  - Error handling
  - Memory leaks
  - Security vulnerabilities
```

---

## MCP Servers

### livekit-mcp
LiveKit room and participant management.

```json
{
  "name": "livekit-mcp",
  "description": "Manage LiveKit rooms, participants, and tracks",
  "tools": [
    {
      "name": "list_rooms",
      "description": "List all active LiveKit rooms"
    },
    {
      "name": "get_room_info",
      "description": "Get detailed room information",
      "parameters": { "room_name": "string" }
    },
    {
      "name": "list_participants",
      "description": "List participants in a room",
      "parameters": { "room_name": "string" }
    },
    {
      "name": "delete_room",
      "description": "Delete a LiveKit room",
      "parameters": { "room_name": "string" }
    },
    {
      "name": "generate_token",
      "description": "Generate access token for a room",
      "parameters": {
        "room_name": "string",
        "identity": "string",
        "can_publish": "boolean"
      }
    },
    {
      "name": "dispatch_agent",
      "description": "Dispatch an agent to a room",
      "parameters": {
        "room_name": "string",
        "agent_name": "string"
      }
    }
  ],
  "config": {
    "url": "${LIVEKIT_URL}",
    "api_key": "${LIVEKIT_API_KEY}",
    "api_secret": "${LIVEKIT_API_SECRET}"
  }
}
```

### mqtt-mcp
MQTT broker interaction for device messaging.

```json
{
  "name": "mqtt-mcp",
  "description": "Interact with MQTT broker and device messages",
  "tools": [
    {
      "name": "publish_message",
      "description": "Publish message to MQTT topic",
      "parameters": {
        "topic": "string",
        "payload": "object"
      }
    },
    {
      "name": "list_clients",
      "description": "List connected MQTT clients"
    },
    {
      "name": "get_client_info",
      "description": "Get info about a specific client",
      "parameters": { "client_id": "string" }
    },
    {
      "name": "subscribe_topic",
      "description": "Subscribe to topic and receive messages",
      "parameters": { "topic": "string" }
    }
  ],
  "config": {
    "broker": "${MQTT_BROKER_HOST}",
    "port": "${MQTT_BROKER_PORT}"
  }
}
```

### database-mcp
Database access for device and user data.

```json
{
  "name": "database-mcp",
  "description": "Query device, user, and session data",
  "tools": [
    {
      "name": "get_device_info",
      "description": "Get device configuration by MAC",
      "parameters": { "mac_address": "string" }
    },
    {
      "name": "get_child_profile",
      "description": "Get child profile for a device",
      "parameters": { "mac_address": "string" }
    },
    {
      "name": "get_chat_history",
      "description": "Get conversation history",
      "parameters": {
        "device_mac": "string",
        "limit": "number"
      }
    },
    {
      "name": "query_rfid_card",
      "description": "Look up RFID card mapping",
      "parameters": { "rfid_uid": "string" }
    }
  ],
  "config": {
    "api_url": "${MANAGER_API_URL}",
    "api_secret": "${MANAGER_API_SECRET}"
  }
}
```

### logs-mcp
Log aggregation and analysis.

```json
{
  "name": "logs-mcp",
  "description": "Query and analyze logs from Loki/local files",
  "tools": [
    {
      "name": "query_logs",
      "description": "Query logs with filters",
      "parameters": {
        "service": "string",
        "level": "string",
        "time_range": "string",
        "search": "string"
      }
    },
    {
      "name": "tail_logs",
      "description": "Stream recent logs",
      "parameters": {
        "service": "string",
        "lines": "number"
      }
    },
    {
      "name": "get_error_summary",
      "description": "Summarize errors in time range",
      "parameters": { "hours": "number" }
    }
  ],
  "config": {
    "loki_url": "${LOKI_HOST}",
    "log_dir": "./logs"
  }
}
```

---

## Hooks

### pre-commit
Run before git commits.

```yaml
name: pre-commit
trigger: pre-commit
actions:
  - name: lint-python
    command: cd workers && ruff check --fix .
  - name: lint-js
    command: cd ../mqtt-gateway && npm run lint:fix
  - name: type-check
    command: cd workers && mypy src/
  - name: test-unit
    command: cd workers && python -m pytest tests/unit -q
```

### pre-push
Run before git push.

```yaml
name: pre-push
trigger: pre-push
actions:
  - name: full-test
    command: |
      cd workers && python -m pytest tests/ -v
      cd ../mqtt-gateway && npm test
  - name: security-scan
    command: |
      cd workers && bandit -r src/
      cd ../mqtt-gateway && npm audit
```

### post-checkout
Run after branch checkout.

```yaml
name: post-checkout
trigger: post-checkout
actions:
  - name: install-deps
    command: |
      cd workers && pip install -r requirements.txt
      cd ../mqtt-gateway && npm install
  - name: sync-env
    command: |
      echo "Ensure .env files are up to date"
      diff .env.example .env || echo "WARNING: .env may need updates"
```

### on-file-change
Watch for file changes during development.

```yaml
name: on-file-change
trigger: file-change
patterns:
  - "workers/**/*.py"
  - "mqtt-gateway/**/*.js"
actions:
  - name: auto-lint
    command: |
      if [[ "$FILE" == *.py ]]; then
        ruff check "$FILE" --fix
      elif [[ "$FILE" == *.js ]]; then
        eslint "$FILE" --fix
      fi
```

### on-agent-error
Trigger when agent encounters an error.

```yaml
name: on-agent-error
trigger: log-pattern
pattern: "❌.*Error|Exception|FATAL"
actions:
  - name: capture-context
    command: |
      echo "Error detected at $(date)"
      echo "Last 50 log lines:"
      tail -50 logs/agent.log
  - name: notify
    command: |
      # Send notification (Slack, email, etc.)
      echo "Agent error notification would be sent here"
```

---

## Plugins

### audio-analyzer
Analyze audio quality and issues.

```yaml
name: audio-analyzer
description: Analyze audio streams for quality issues
capabilities:
  - Detect silence/noise
  - Measure audio levels
  - Check encoding quality
  - Identify packet loss
usage: |
  # Analyze audio file
  audio-analyzer analyze recording.wav

  # Real-time analysis
  audio-analyzer stream --room <room_name>
```

### latency-tracker
Track end-to-end latency.

```yaml
name: latency-tracker
description: Measure and visualize latency across the system
metrics:
  - client_to_gateway: UDP packet round trip
  - gateway_to_livekit: Audio forwarding time
  - livekit_to_agent: Track subscription latency
  - agent_processing: Gemini response time
  - total_round_trip: End-to-end latency
usage: |
  # Start latency tracking
  latency-tracker start --session <session_id>

  # Generate report
  latency-tracker report --output latency_report.html
```

### device-simulator
Simulate multiple devices for load testing.

```yaml
name: device-simulator
description: Simulate multiple IoT devices for testing
features:
  - Spawn multiple virtual devices
  - Generate realistic audio patterns
  - Simulate network conditions
  - Record metrics
usage: |
  # Simulate 10 devices
  device-simulator run --count 10 --duration 60s

  # With network degradation
  device-simulator run --count 5 --packet-loss 5% --latency 100ms
```

### prompt-tester
Test and iterate on agent prompts.

```yaml
name: prompt-tester
description: Test agent prompts without full deployment
features:
  - Quick prompt iteration
  - Compare prompt versions
  - Measure response quality
  - A/B testing support
usage: |
  # Test a prompt
  prompt-tester test "You are Cheeko, a friendly AI companion..."

  # Compare prompts
  prompt-tester compare prompt_v1.txt prompt_v2.txt
```

---

## Environment Variables

Required environment variables for this project:

```bash
# LiveKit Configuration
LIVEKIT_URL=wss://your-livekit-server.com
LIVEKIT_API_KEY=your-api-key
LIVEKIT_API_SECRET=your-api-secret

# MQTT Configuration
MQTT_BROKER_HOST=localhost
MQTT_BROKER_PORT=1883

# Google AI (Gemini)
GOOGLE_API_KEY=your-google-api-key

# Manager API
MANAGER_API_URL=http://localhost:3000/toy
MANAGER_API_SECRET=your-api-secret

# Logging
LOKI_HOST=http://localhost:3100
LOG_LEVEL=INFO

# Server Configuration
PUBLIC_IP=your-public-ip
UDP_PORT=1883
CHEEKO_PORT=8081
```

---

## Common Tasks

### Start Development Environment

```bash
# Terminal 1: Start MQTT Gateway
cd ../mqtt-gateway && npm run dev

# Terminal 2: Start Cheeko Agent
python workers/cheeko_worker.py dev

# Terminal 3: Start Test Client
cd .. && python client.py
```

### Debug Agent Connection

1. Check agent logs: `tail -f logs/cheeko_agent.log`
2. Verify room exists: `/room-info <room_name>`
3. Check participant list: Use livekit-mcp list_participants
4. Verify audio tracks are published

### Investigate Audio Issues

1. Check gateway audio processing logs
2. Verify Opus encoding/decoding
3. Check sample rate mismatches (16kHz vs 24kHz vs 48kHz)
4. Use audio-analyzer plugin for detailed analysis

### Deploy New Agent Version

1. Run tests: `/test-agent`
2. Build image: `docker build -t cheeko-agent:latest .`
3. Push to registry: `docker push`
4. Update deployment: `kubectl apply -f k8s/`
5. Verify: `/agent-status`

---

## Code Conventions

### File Paths
- Always use relative paths instead of absolute paths when referencing files and directories
- This ensures portability across different development environments and machines

### Python (Agents)
- Use `async/await` for all I/O operations
- Type hints required for function signatures
- Docstrings for public methods
- Use `logger` from `src.utils.loki_agent_logger`

### JavaScript (Gateway)
- Use ES6+ features
- Async/await over callbacks
- JSDoc comments for functions
- Console logging via `logger` module

### Commit Messages
```
<type>(<scope>): <description>

Types: feat, fix, refactor, docs, test, chore
Scopes: agent, gateway, client, config
```

---

## Troubleshooting

### Agent Not Joining Room
1. Check LIVEKIT_URL is correct (wss://)
2. Verify API key/secret are valid
3. Check agent dispatch logs
4. Ensure room exists before dispatch

### No Audio from Agent
1. Verify Gemini API key is valid
2. Check audio track subscription
3. Look for encoding errors in logs
4. Verify sample rate configuration

### High Latency
1. Check network conditions
2. Verify TURN server configuration
3. Profile gateway audio processing
4. Check Gemini API response times

### Memory Leaks
1. Monitor with `process.memoryUsage()`
2. Check for unclosed audio streams
3. Verify proper cleanup on disconnect
4. Look for accumulating buffers
