# MiniApp Math Quiz — End-to-End Integration Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When an interactive RFID card with `math_quiz` template is tapped, the system dispatches the math game agent, bridges game data (JSON) through MQTT and voice audio through UDP, and the Python test client renders a terminal math game UI.

**Architecture:** The gateway already sends `card_interactive` to the device on card tap (Branch D). This plan adds: (1) `miniapp_session/start` handling in the gateway to dispatch `math-game-agent` into a LiveKit room, (2) bridging LiveKit data channel messages (`math_question`, `math_result`, `game_state`) from agent → MQTT → client, and (3) bridging client tap answers from MQTT → LiveKit data channel → agent. Audio (TTS/STT) already flows through the existing UDP↔LiveKit audio pipeline — no changes needed there.

**Tech Stack:** Node.js (MQTT gateway), Python (client.py, math_game_worker.py — no agent changes)

**Spec:** `interactive-miniapp-backend-spec.md` (Section 2: Session Lifecycle, Section 8: Voice Channel Integration)

---

## Current State (What Already Works)

| Component | Status | Details |
|-----------|--------|---------|
| `card_interactive` response | ✅ Done | Gateway Branch D sends `card_interactive` JSON to device on RFID lookup |
| `math-game-agent` worker | ✅ Done | `workers/math_game_worker.py` — full game engine, hints, question gen |
| Agent data channel protocol | ✅ Done | `math_game_data_channel.py` — sends `math_question`, `math_result`, `game_state`, `math_hint` |
| Agent dispatch client | ✅ Done | Gateway has `agentDispatchClient.createDispatch()` for all modes |
| LiveKit bridge audio | ✅ Done | UDP↔Opus audio already bridges between device and LiveKit |
| LiveKit bridge DataReceived | ✅ Done | `livekit-bridge.js:330` handles `agent_state_changed`, `speech_created`, etc. |

## What's Missing (This Plan)

| # | Component | What to Build |
|---|-----------|---------------|
| 1 | Gateway: `miniapp_session` handler | Handle `miniapp_session/start` → dispatch `math-game-agent`, `miniapp_session/end` → cleanup |
| 2 | Gateway: Bridge game data (agent→device) | Forward `math_question`, `math_result`, `game_state`, `math_hint` from LiveKit data channel to MQTT |
| 3 | Gateway: Bridge game input (device→agent) | Forward `miniapp_event` (tap answers, knob events) from MQTT to LiveKit data channel |
| 4 | Client: Handle `card_interactive` | On receiving `card_interactive`, send `miniapp_session/start` to gateway |
| 5 | Client: Math game UI | Render `math_question` as terminal UI, capture answer input, send `math_answer` back |
| 6 | Client: Session lifecycle | Handle `miniapp_session/end`, game summary, cleanup |

---

## Data Flow Diagram

```
                    RFID TAP
                       │
                       ▼
  Client ──MQTT──► Gateway ──HTTP──► Manager API (card lookup)
                       │
                       ▼
  Client ◄──MQTT──  Gateway sends card_interactive
                       │
  Client sends         │
  miniapp_session/start│
       │               ▼
       └──MQTT──► Gateway:
                   1. Creates LiveKit room (roomType="miniapp")
                   2. Connects LiveKit bridge
                   3. Dispatches "math-game-agent"
                       │
                       ▼
              ┌─────────────────────┐
              │   GAME LOOP         │
              │                     │
              │ Agent ──DC──► Bridge ──MQTT──► Client
              │   (math_question)     (wrapped in miniapp envelope)
              │                     │
              │ Agent ◄──DC── Bridge ◄──MQTT── Client
              │   (math_answer)       (miniapp_event/voice_result)
              │                     │
              │ Agent ──audio──► Bridge ──UDP──► Client (TTS)
              │ Agent ◄──audio── Bridge ◄──UDP── Client (STT)
              │                     │
              └─────────────────────┘
```

## File Structure

| Action | File | Responsibility |
|--------|------|----------------|
| Modify | `main/mqtt-gateway/gateway/mqtt-gateway.js` | Handle `miniapp_session` start/end, add `math-game-agent` to agent map |
| Modify | `main/mqtt-gateway/livekit/livekit-bridge.js` | Forward game data channel messages to device via MQTT |
| Modify | `client.py` | Handle `card_interactive`, render math game UI, send answers |

**No changes to agent files** — `math_game_worker.py`, `math_game_engine.py`, `math_game_data_channel.py` etc. remain as-is.

---

## Task 1: Gateway — Add `math-game-agent` to Character Map & Handle `miniapp_session`

**Files:**
- Modify: `main/mqtt-gateway/gateway/mqtt-gateway.js`

### Step-by-step

- [ ] **Step 1: Add `math-game-agent` to CHARACTER_AGENT_MAP**

At line ~31 in `mqtt-gateway.js`, the `CHARACTER_AGENT_MAP` is defined:

```javascript
const CHARACTER_AGENT_MAP = {
  "Cheeko": "cheeko-agent",
  "Math Tutor": "math-tutor-agent",
  "Riddle Solver": "riddle-solver-agent",
  "Word Ladder": "word-ladder-agent",
};
```

Add a template-to-agent mapping constant right after it:

```javascript
const MINIAPP_AGENT_MAP = {
  "math_quiz": "math-game-agent",
  // Future templates: "yes_no_quiz": "yes-no-quiz-agent", etc.
};
```

- [ ] **Step 2: Handle `miniapp_session` in `processIngestLogic`**

In `processIngestLogic()` (the main message router, around line ~790), find where `type === "hello"` and other message types are checked. Add a new case for `miniapp_session`:

```javascript
      // ====== MINIAPP SESSION ======
      if (payload.type === 'miniapp_session') {
        logger.info(`🎮 [MINIAPP] Received miniapp_session: action=${payload.action}, template=${payload.template}, device=${deviceId}`);
        await this.handleMiniappSession(deviceId, payload, clientId);
        return;
      }
```

Place this BEFORE the `hello` handler so it's checked early in the routing.

- [ ] **Step 3: Implement `handleMiniappSession` method**

Add this method to the MQTTGateway class:

```javascript
  /**
   * Handle miniapp_session start/end from device.
   * On start: create LiveKit room, connect bridge, dispatch game agent.
   * On end: tear down the session.
   */
  async handleMiniappSession(deviceId, payload, clientId) {
    const { action, template, params, session_id } = payload;

    if (action === 'start') {
      const agentName = MINIAPP_AGENT_MAP[template];
      if (!agentName) {
        logger.error(`❌ [MINIAPP] Unknown template: ${template}`);
        this.mqttPublish(`devices/p2p/${clientId}`, {
          type: 'miniapp_error',
          session_id,
          error: `Unknown template: ${template}`,
        });
        return;
      }

      logger.info(`🎮 [MINIAPP] Starting miniapp session: template=${template}, agent=${agentName}`);

      // Get existing device connection info
      const devInfo = this.deviceConnections.get(deviceId);
      if (!devInfo || !devInfo.connection) {
        logger.error(`❌ [MINIAPP] No active connection for device ${deviceId}`);
        return;
      }

      const connection = devInfo.connection;
      const macAddress = deviceId.replace(/:/g, '').toLowerCase();

      // Fetch child profile from API (same pattern as conversation mode)
      let childProfile = null;
      try {
        const profileResponse = await axios.post(
          `${process.env.MANAGER_API_URL}/config/child-profile-by-mac`,
          { macAddress },
          { timeout: 5000, headers: { 'secret': process.env.MANAGER_API_SECRET } }
        );
        if (profileResponse.data?.code === 0 && profileResponse.data?.data) {
          childProfile = profileResponse.data.data;
          logger.info(`🎮 [MINIAPP] Child profile: name=${childProfile.name}, age=${childProfile.age}`);
        }
      } catch (fetchError) {
        logger.warn(`⚠️ [MINIAPP] Failed to fetch child profile: ${fetchError.message}`);
        // Fall back to connection's cached profile if available
        childProfile = connection.childProfile || null;
      }

      // Store the miniapp metadata on the connection for the dispatch step
      connection.miniappTemplate = template;
      connection.miniappParams = params || {};
      connection.miniappSessionId = session_id;

      // Use the existing mode change flow, but with roomType "miniapp"
      try {
        // If there's an existing bridge, close it first (like mode change does)
        if (connection.bridge) {
          logger.info(`🔄 [MINIAPP] Closing existing bridge for mode switch to miniapp`);
          connection.bridge.disconnect();
          connection.bridge = null;
        }

        // Set room type to miniapp
        connection.roomType = 'miniapp';

        // Create new room name
        const roomUuid = require('uuid').v4().replace(/-/g, '').substring(0, 12);
        const macForRoom = macAddress.replace(/:/g, '');
        const newRoomName = `${roomUuid}_${macForRoom}_miniapp`;

        logger.info(`🎮 [MINIAPP] Creating room: ${newRoomName}`);

        // Create and connect LiveKit bridge (reusing existing pattern)
        const LiveKitBridge = require('../livekit/livekit-bridge');
        const newBridge = new LiveKitBridge(connection, macAddress);

        try {
          await newBridge.connect(newRoomName);
          connection.bridge = newBridge;
          logger.info(`✅ [MINIAPP] Bridge connected to room: ${newRoomName}`);
        } catch (bridgeError) {
          logger.error(`❌ [MINIAPP] Failed to connect bridge: ${bridgeError.message}`);
          return;
        }

        // Dispatch the game agent
        if (this.agentDispatchClient) {
          try {
            // Include child_profile in metadata — the math agent uses it
            // to set game_mode (explorer for age<7, commander for age>=7)
            // and to personalize greetings. See math_game_worker.py:106-120
            const metadata = {
              device_mac: deviceId,
              child_profile: childProfile,
              miniapp_template: template,
              miniapp_params: params || {},
              miniapp_session_id: session_id,
              timestamp: Date.now(),
            };

            await this.agentDispatchClient.createDispatch(newRoomName, agentName, {
              metadata: JSON.stringify(metadata),
            });

            logger.info(`✅ [MINIAPP] Agent ${agentName} dispatched to ${newRoomName}`);

            // Confirm session started to device
            this.mqttPublish(`devices/p2p/${clientId}`, {
              type: 'miniapp_session_ack',
              session_id,
              template,
              status: 'started',
            });
          } catch (dispatchError) {
            logger.error(`❌ [MINIAPP] Failed to dispatch agent: ${dispatchError.message}`);
          }
        } else {
          logger.error(`❌ [MINIAPP] AgentDispatchClient not initialized`);
        }
      } catch (error) {
        logger.error(`❌ [MINIAPP] Session start error: ${error.message}`);
      }

    } else if (action === 'end') {
      logger.info(`🎮 [MINIAPP] Ending miniapp session: session_id=${session_id}, reason=${payload.reason}`);

      const devInfo = this.deviceConnections.get(deviceId);
      if (devInfo && devInfo.connection) {
        const connection = devInfo.connection;

        // Send shutdown to agent via data channel before closing
        if (connection.bridge && connection.bridge.room) {
          try {
            const shutdownMsg = JSON.stringify({
              type: 'shutdown_request',
              session_id,
              reason: payload.reason || 'card_removed',
              require_ack: false,
            });
            await connection.bridge.room.localParticipant.publishData(
              Buffer.from(shutdownMsg),
              { reliable: true }
            );
            logger.info(`📤 [MINIAPP] Sent shutdown_request to agent`);
          } catch (e) {
            logger.warn(`⚠️ [MINIAPP] Failed to send shutdown: ${e.message}`);
          }
        }

        // Close bridge
        if (connection.bridge) {
          connection.bridge.disconnect();
          connection.bridge = null;
        }

        // Clear miniapp state
        connection.miniappTemplate = null;
        connection.miniappParams = null;
        connection.miniappSessionId = null;
        connection.roomType = 'conversation'; // Reset to default
      }
    }
  }
```

- [ ] **Step 4: Handle `miniapp_event` messages from device**

In `processIngestLogic()`, add handling for `miniapp_event` — these are game inputs (tap answers, knob events) from the device that need to be forwarded to the agent via LiveKit data channel:

```javascript
      // ====== MINIAPP EVENT (game input from device → agent) ======
      if (payload.type === 'miniapp_event') {
        logger.info(`🎮 [MINIAPP-EVENT] ${payload.event} from device ${deviceId}`);
        const devInfo = this.deviceConnections.get(deviceId);
        if (devInfo && devInfo.connection && devInfo.connection.bridge && devInfo.connection.bridge.room) {
          try {
            // Forward the event to the agent via LiveKit data channel
            // Map miniapp_event types to the data channel types the math agent expects
            let agentMessage;
            if (payload.event === 'voice_result') {
              // Voice answer → math_answer (tap format)
              agentMessage = {
                type: 'math_answer',
                answer: payload.data?.text,
                source: 'voice',
              };
            } else if (payload.event === 'tap_answer') {
              // Direct tap answer from client UI
              agentMessage = {
                type: 'math_answer',
                answer: payload.data?.value,
                question_id: payload.data?.question_id,
                source: 'tap',
              };
            } else if (payload.event === 'game_control') {
              agentMessage = {
                type: 'game_control',
                action: payload.data?.action,
              };
            } else {
              // Forward as-is for other event types
              agentMessage = payload;
            }

            const messageData = Buffer.from(JSON.stringify(agentMessage));
            await devInfo.connection.bridge.room.localParticipant.publishData(messageData, { reliable: true });
            logger.info(`📤 [MINIAPP-EVENT] Forwarded ${payload.event} → agent as ${agentMessage.type}`);
          } catch (e) {
            logger.error(`❌ [MINIAPP-EVENT] Failed to forward: ${e.message}`);
          }
        } else {
          logger.warn(`⚠️ [MINIAPP-EVENT] No active bridge for device ${deviceId}`);
        }
        return;
      }
```

- [ ] **Step 5: Commit**

```bash
git add main/mqtt-gateway/gateway/mqtt-gateway.js
git commit -m "feat(gateway): handle miniapp_session start/end and miniapp_event forwarding"
```

---

## Task 2: Gateway — Bridge Game Data from Agent to Device

**Files:**
- Modify: `main/mqtt-gateway/livekit/livekit-bridge.js`

The math game agent sends `math_question`, `math_result`, `game_state`, `math_hint` via LiveKit data channel. The bridge's `DataReceived` handler (line ~330) needs to forward these to the device via MQTT, wrapped in the `miniapp` envelope from the spec.

### Step-by-step

- [ ] **Step 1: Add game message forwarding cases to DataReceived switch**

In `livekit-bridge.js`, inside the `RoomEvent.DataReceived` handler's switch statement (after line ~474, before the `default:` case), add:

```javascript
            // ====== MINIAPP GAME DATA (agent → device) ======
            case "math_question":
            case "math_result":
            case "game_state":
            case "math_hint":
            case "child_profile":
              // Forward game data channel messages to device via MQTT
              // Wrap in miniapp envelope per spec
              if (this.connection) {
                const miniappMsg = {
                  type: 'miniapp',
                  session_id: this.connection.miniappSessionId || this.connection.udp?.session_id,
                  action: data.type,  // math_question, math_result, etc.
                  data: data,         // Full payload from agent
                };
                console.log(`🎮 [MINIAPP-OUT] Forwarding ${data.type} to device ${this.macAddress}`);
                this.connection.sendMqttMessage(JSON.stringify(miniappMsg));
              }
              break;
```

- [ ] **Step 2: Commit**

```bash
git add main/mqtt-gateway/livekit/livekit-bridge.js
git commit -m "feat(bridge): forward math game data channel messages to device via MQTT"
```

---

## Task 3: Client — Handle `card_interactive` and Start MiniApp Session

**Files:**
- Modify: `client.py`

When the client receives `card_interactive` (after an RFID tap), it should:
1. Display the interactive card info
2. Send `miniapp_session/start` to the gateway
3. Enter miniapp mode

### Step-by-step

- [ ] **Step 1: Add miniapp state tracking to `__init__`**

In the `TestClient.__init__` method, add these instance variables:

```python
        # Miniapp state
        self.miniapp_active = False
        self.miniapp_template = None
        self.miniapp_session_id = None
        self.current_question = None  # Current math question data
```

- [ ] **Step 2: Handle `card_interactive` in `on_mqtt_message`**

In the `on_mqtt_message` method (around line 200, in the `else` block that puts to `mqtt_message_queue`), add specific handling before the queue fallback:

```python
            # Handle card_interactive (interactive RFID card detected)
            elif payload.get("type") == "card_interactive":
                template = payload.get("template", "unknown")
                display_name = payload.get("display_name", "Unknown")
                logger.info(f"🎮 [CARD] Interactive card detected: {display_name} (template={template})")
                if template == "math_quiz":
                    self.start_miniapp_session(payload)
                else:
                    logger.warning(f"⚠️ [CARD] Unsupported template: {template}")

            # Handle miniapp messages from gateway (game data from agent)
            elif payload.get("type") == "miniapp":
                self.handle_miniapp_message(payload)

            # Handle miniapp session acknowledgement
            elif payload.get("type") == "miniapp_session_ack":
                logger.info(f"🎮 [MINIAPP] Session started: template={payload.get('template')}")

            else:
                mqtt_message_queue.put(payload)
```

- [ ] **Step 3: Implement `start_miniapp_session`**

Add this method to the `TestClient` class:

```python
    def start_miniapp_session(self, card_data):
        """Start a miniapp session after receiving card_interactive."""
        self.miniapp_active = True
        self.miniapp_template = card_data.get("template")
        self.miniapp_session_id = f"sess_{uuid.uuid4().hex[:8]}"

        logger.info(f"🎮 [MINIAPP] Starting session: template={self.miniapp_template}, session_id={self.miniapp_session_id}")

        # Send miniapp_session/start to gateway
        session_start = {
            "type": "miniapp_session",
            "action": "start",
            "template": self.miniapp_template,
            "params": card_data.get("params", {}),
            "session_id": self.miniapp_session_id,
        }
        self.mqtt_client.publish("device-server", json.dumps(session_start))
        logger.info(f"📤 [MINIAPP] Sent miniapp_session/start")
```

- [ ] **Step 4: Implement `handle_miniapp_message`**

Add this method to handle game data from the agent (via gateway bridge):

```python
    def handle_miniapp_message(self, payload):
        """Handle miniapp messages from agent (via gateway bridge)."""
        action = payload.get("action")
        data = payload.get("data", {})

        if action == "math_question":
            self.current_question = data
            self.render_math_question(data)
        elif action == "math_result":
            self.render_math_result(data)
        elif action == "game_state":
            self.render_game_state(data)
        elif action == "math_hint":
            hint_text = data.get("hint_text", "")
            logger.info(f"💡 [HINT] {hint_text}")
        else:
            logger.info(f"🎮 [MINIAPP] {action}: {json.dumps(data)[:200]}")
```

- [ ] **Step 5: Commit**

```bash
git add client.py
git commit -m "feat(client): handle card_interactive and start miniapp session"
```

---

## Task 4: Client — Math Game Terminal UI

**Files:**
- Modify: `client.py`

Render math questions in the terminal and capture tap answers.

### Step-by-step

- [ ] **Step 1: Implement `render_math_question`**

```python
    def render_math_question(self, data):
        """Render a math question in the terminal."""
        question_text = data.get("question_text", "?")
        options = data.get("options", [])
        progress = data.get("progress", {})
        question_id = data.get("question_id", "")

        stars = progress.get("stars", 0)
        q_num = progress.get("questions_answered", 0) + 1

        print("\n" + "=" * 40)
        print(f"  ⭐ Stars: {stars}  |  Question #{q_num}")
        print("=" * 40)
        print(f"\n  {question_text}\n")

        for i, opt in enumerate(options):
            label = opt.get("label", "?")
            value = opt.get("value", "?")
            print(f"    [{i + 1}] {label}")

        print(f"\n  Press 1-{len(options)} to answer (or say it aloud)")
        print("=" * 40)

        # Start a thread to capture keyboard answer
        threading.Thread(
            target=self._capture_math_answer,
            args=(question_id, options),
            daemon=True
        ).start()
```

- [ ] **Step 2: Implement `_capture_math_answer`**

```python
    def _capture_math_answer(self, question_id, options):
        """Capture keyboard input for math answer (runs in background thread)."""
        try:
            # Wait for a number key press (1-4)
            while self.miniapp_active and self.current_question:
                for i in range(len(options)):
                    key = str(i + 1)
                    if keyboard.is_pressed(key):
                        value = options[i].get("value")
                        logger.info(f"🎯 [ANSWER] Selected option {key}: value={value}")
                        self.send_miniapp_answer(question_id, value)
                        self.current_question = None
                        time.sleep(0.3)  # Debounce
                        return
                time.sleep(0.05)
        except Exception as e:
            logger.error(f"Error in answer capture: {e}")
```

- [ ] **Step 3: Implement `send_miniapp_answer`**

```python
    def send_miniapp_answer(self, question_id, value):
        """Send a tap answer to the gateway as miniapp_event."""
        event = {
            "type": "miniapp_event",
            "session_id": self.miniapp_session_id,
            "event": "tap_answer",
            "data": {
                "question_id": question_id,
                "value": value,
            },
        }
        self.mqtt_client.publish("device-server", json.dumps(event))
        logger.info(f"📤 [ANSWER] Sent tap_answer: question_id={question_id}, value={value}")
```

- [ ] **Step 4: Implement `render_math_result`**

```python
    def render_math_result(self, data):
        """Render answer result in terminal."""
        correct = data.get("correct", False)
        answer = data.get("correct_answer", "?")
        stars = data.get("stars", 0)

        if correct:
            print(f"\n  ✅ Correct! ⭐ Stars: {stars}")
        else:
            print(f"\n  ❌ Wrong! The answer was {answer}")

        if data.get("game_over"):
            print("\n" + "=" * 40)
            print(f"  🏆 GAME OVER — Final Stars: {stars}")
            print("=" * 40)
```

- [ ] **Step 5: Implement `render_game_state`**

```python
    def render_game_state(self, data):
        """Render game state update."""
        state = data.get("state", "unknown")
        progress = data.get("progress", {})
        if state == "game_over":
            stars = progress.get("stars", 0)
            answered = progress.get("questions_answered", 0)
            print(f"\n🏆 Game Over! Stars: {stars}, Questions: {answered}")
            self.miniapp_active = False
```

- [ ] **Step 6: Commit**

```bash
git add client.py
git commit -m "feat(client): add terminal math game UI with tap-to-answer"
```

---

## Task 5: Client — End MiniApp Session

**Files:**
- Modify: `client.py`

Add ability to end a miniapp session (simulating card removal) and handle cleanup.

### Step-by-step

- [ ] **Step 1: Add 'M' key to end miniapp session**

In the keyboard monitoring section (where 'R' key is handled for RFID), add an 'M' key handler:

```python
                # Press 'M' to end miniapp session (simulate card removal)
                if keyboard.is_pressed('m') and self.miniapp_active:
                    self.end_miniapp_session("card_removed")
                    time.sleep(0.5)  # Debounce
```

- [ ] **Step 2: Implement `end_miniapp_session`**

```python
    def end_miniapp_session(self, reason="card_removed"):
        """End the current miniapp session."""
        if not self.miniapp_active:
            return

        logger.info(f"🎮 [MINIAPP] Ending session: reason={reason}")

        session_end = {
            "type": "miniapp_session",
            "action": "end",
            "session_id": self.miniapp_session_id,
            "reason": reason,
        }
        self.mqtt_client.publish("device-server", json.dumps(session_end))

        self.miniapp_active = False
        self.miniapp_template = None
        self.miniapp_session_id = None
        self.current_question = None

        print("\n🎮 MiniApp session ended.")
```

- [ ] **Step 3: Update help text**

Update the help text line (around line 780) to include the new key:

```python
        "[WAIT] Test running. Press Spacebar to abort TTS | R to tap RFID card | M to end miniapp | Ctrl+C to stop."
```

- [ ] **Step 4: Commit**

```bash
git add client.py
git commit -m "feat(client): add miniapp session end and help text"
```

---

## Task 6: Integration Verification

- [ ] **Step 1: Verify agent worker registration**

Check that `math-game-agent` agent name in the worker matches the gateway's `MINIAPP_AGENT_MAP`:

```bash
grep -n "AGENT_NAME\|agent_name" main/livekit-server/workers/math_game_worker.py
```

Expected: `AGENT_NAME = "math-game-agent"` — must match `MINIAPP_AGENT_MAP["math_quiz"]` value.

- [ ] **Step 2: Verify data channel message types**

The agent sends these types via data channel:
- `math_question` — question with options
- `math_result` — correct/wrong result
- `game_state` — state updates (game_over, etc.)
- `math_hint` — hint messages
- `child_profile` — child info echo

The bridge forwards these types (Task 2). The client handles these types (Task 3/4). Verify all match.

- [ ] **Step 3: Verify agent expects `math_answer` type**

```bash
grep -n "math_answer" main/livekit-server/src/games/math_game_data_channel.py main/livekit-server/workers/math_game_worker.py
```

Expected: Worker registers `dc.on("math_answer", engine.on_tap_answer)`.

The gateway (Task 1, Step 4) converts `miniapp_event/tap_answer` → `math_answer`. Verify field mapping:
- Agent expects: `{ type: "math_answer", answer: <value>, question_id: <id>, source: "tap" }`
- Gateway sends: Same format.

- [ ] **Step 4: Manual test flow**

1. Start manager-api-node (`cd main/manager-api-node && npm run dev`)
2. Start mqtt-gateway (`cd main/mqtt-gateway && node app.js`)
3. Start math-game-agent (`cd main/livekit-server && python workers/math_game_worker.py dev`)
4. Start client (`python client.py`)
5. Press R, enter RFID UID of a card mapped to `math_quiz` template
6. Verify: Client receives `card_interactive` → sends `miniapp_session/start` → gateway dispatches agent → agent sends `math_question` → client renders question → press 1-4 to answer → agent responds

- [ ] **Step 5: Final commit**

```bash
git add -A
git commit -m "feat: miniapp math_quiz end-to-end integration"
```

---

## Key Assumptions & Notes

1. **Audio flows through existing UDP/LiveKit pipeline** — the math game agent uses `session.say()` and LiveKit STT, which already work through the bridge's audio track handling. No audio changes needed.

2. **The agent auto-starts the game** — `math_game_worker.py` line 246: `await engine.on_game_start(child_name, child_age, game_mode)` runs immediately after session start. No `ready_for_greeting` needed from client.

3. **Voice answers** — The agent's `check_math_answer` tool is invoked by the LLM when a child says a number. This works through the existing STT pipeline (UDP audio → LiveKit → agent STT → LLM → tool call). No changes needed. The client's terminal tap answers are an additional input channel.

4. **No changes to agent files** — The math game worker, engine, data channel, hints, narrator, question generator, and pipeline are all used as-is from the `math-game` branch.
