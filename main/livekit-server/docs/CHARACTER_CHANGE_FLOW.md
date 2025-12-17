# Character Change Flow Documentation

This document explains how voice-triggered character/mode switching works in the Cheeko AI system.

## Overview

Children can switch between different AI character modes (Cheeko, Math Tutor, Riddle Solver, Word Ladder) using voice commands. The system performs a **full session reset** - creating a new LiveKit room with a fresh agent loaded with the new character's prompt.

## Architecture

```
┌──────────────┐     ┌──────────────┐     ┌──────────────┐     ┌──────────────┐
│    Child     │────▶│    ESP32     │────▶│    MQTT      │────▶│   LiveKit    │
│    Voice     │     │    Device    │     │   Gateway    │     │    Agent     │
└──────────────┘     └──────────────┘     └──────────────┘     └──────────────┘
                            │                    │                     │
                            │                    │                     │
                            ▼                    ▼                     ▼
                      UDP Audio          Room Management       Function Tools
                      Streaming          Agent Dispatch        Character Switch
```

## Available Characters

| Character | Description | Trigger Phrases |
|-----------|-------------|-----------------|
| **Cheeko** | Fun, playful AI friend | "Change to Cheeko", "Normal mode" |
| **Math Tutor** | Math games and practice | "Math mode", "Let's play math" |
| **Riddle Solver** | Riddles and puzzles | "Riddle mode", "Let's do riddles" |
| **Word Ladder** | Vocabulary games | "Word game", "Word ladder" |

## Flow Diagram

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         CHARACTER CHANGE FLOW                                │
└─────────────────────────────────────────────────────────────────────────────┘

  STEP 1: Voice Input
  ═══════════════════
  Child: "Change to Math Tutor"
           │
           ▼
  ┌─────────────────┐
  │  ESP32 Device   │──── UDP Audio ────▶ MQTT Gateway ────▶ LiveKit Room
  └─────────────────┘
           │
           ▼
  Gemini STT transcribes: "Change to Math Tutor"


  STEP 2: LLM Function Call
  ═════════════════════════
  ┌─────────────────────────────────────────────────────────────────┐
  │  LiveKit Agent (main_agent.py)                                  │
  │                                                                 │
  │  LLM reads prompt → sees character_switching instructions       │
  │           │                                                     │
  │           ▼                                                     │
  │  Calls: update_agent_mode(mode_name="Math Tutor")              │
  └─────────────────────────────────────────────────────────────────┘


  STEP 3: Data Channel Message
  ════════════════════════════
  ┌─────────────────────────────────────────────────────────────────┐
  │  update_agent_mode() function sends via LiveKit data channel:   │
  │                                                                 │
  │  {                                                              │
  │    "type": "character_change_request",                          │
  │    "character_name": "Math Tutor",                              │
  │    "device_mac": "68:25:dd:bb:f3:a0",                          │
  │    "timestamp": 1234567890                                      │
  │  }                                                              │
  └─────────────────────────────────────────────────────────────────┘


  STEP 4: MQTT Gateway Processing
  ════════════════════════════════
  ┌─────────────────────────────────────────────────────────────────┐
  │  livekit-bridge.js receives data packet                         │
  │           │                                                     │
  │           ▼                                                     │
  │  case "character_change_request":                               │
  │      this.handleCharacterChangeRequest(data)                    │
  │           │                                                     │
  │           ▼                                                     │
  │  mqtt-gateway.js:handleCharacterChangeFromAgent()               │
  └─────────────────────────────────────────────────────────────────┘


  STEP 5: Full Session Reset
  ══════════════════════════
  ┌─────────────────────────────────────────────────────────────────┐
  │  handleCharacterChangeFromAgent() performs:                     │
  │                                                                 │
  │  1. 📝 Update database                                          │
  │     POST /agent/device/{mac}/set-character                      │
  │     Body: { characterName: "Math Tutor" }                       │
  │                                                                 │
  │  2. 🧹 Clear audio buffers                                      │
  │     Prevents old audio bleeding into new session                │
  │                                                                 │
  │  3. 🗑️ Delete OLD LiveKit room                                  │
  │     roomService.deleteRoom(oldRoomName)                         │
  │                                                                 │
  │  4. 🆕 Generate NEW session                                     │
  │     newRoomName = "{uuid}_{mac}_conversation"                   │
  │                                                                 │
  │  5. 🌉 Create NEW LiveKitBridge                                 │
  │     Connect to new room                                         │
  │                                                                 │
  │  6. 📱 Send mode_update to ESP32                                │
  │     Device updates session_id, UDP encryption keys              │
  │                                                                 │
  │  7. 🤖 Dispatch NEW agent                                       │
  │     Agent loads fresh prompt from database                      │
  └─────────────────────────────────────────────────────────────────┘


  STEP 6: New Agent Starts
  ════════════════════════
  ┌─────────────────────────────────────────────────────────────────┐
  │  New LiveKit Agent Process:                                     │
  │                                                                 │
  │  1. Fetches Math Tutor prompt from API                          │
  │  2. Appends character_switching instructions                    │
  │  3. Creates Assistant with new prompt                           │
  │  4. Greets child as Math Tutor                                  │
  │                                                                 │
  │  "Hi! I'm Cheeko the Math Tutor! Let's have fun with numbers!"  │
  └─────────────────────────────────────────────────────────────────┘
```

## Code References

### 1. Function Tool Definition
**File:** `src/agent/main_agent.py` (lines 765-821)

```python
@function_tool
async def update_agent_mode(self, context: RunContext, mode_name: str) -> str:
    """Update agent configuration mode by applying a template.
    This triggers a full session reset via MQTT gateway.
    """
    # Normalize mode name (handles transcript variations)
    normalized_mode = normalize_mode_name(mode_name)

    # Send character_change_request via data channel
    character_change_message = {
        "type": "character_change_request",
        "character_name": normalized_mode,
        "device_mac": self.device_mac,
        "timestamp": int(asyncio.get_event_loop().time() * 1000)
    }

    await room.local_participant.publish_data(message_data, reliable=True)
    return f"Switching to {normalized_mode}. One moment please."
```

### 2. Mode Name Normalization
**File:** `src/agent/main_agent.py` (lines 23-86)

```python
MODE_ALIASES = {
    "Cheeko": ["chiko", "chico", "cheeko", "default", "normal mode"],
    "Math Tutor": ["math tutor", "math", "maths", "math mode", "tutor"],
    "Riddle Solver": ["riddle solver", "riddle", "riddles", "puzzle"],
    "Word Ladder": ["word ladder", "word game", "word", "vocabulary"],
}

def normalize_mode_name(mode_input: str) -> str:
    """Normalize mode name input to handle transcript variations"""
    # Handles speech-to-text variations like "math tutor" → "Math Tutor"
```

### 3. Data Channel Handler
**File:** `mqtt-gateway/livekit/livekit-bridge.js` (lines 421-424)

```javascript
case "character_change_request":
    console.log(`🎭 [CHARACTER-CHANGE] Voice command: ${data.character_name}`);
    this.handleCharacterChangeRequest(data);
    break;
```

### 4. Bridge Handler
**File:** `mqtt-gateway/livekit/livekit-bridge.js` (lines 1874-1890)

```javascript
async handleCharacterChangeRequest(data) {
    const characterName = data.character_name;
    const macAddress = this.macAddress;

    // Call gateway's full session reset handler
    await this.connection.gateway.handleCharacterChangeFromAgent(
        macAddress, characterName, this.connection
    );
}
```

### 5. Main Session Reset Handler
**File:** `mqtt-gateway/gateway/mqtt-gateway.js` (lines 1092-1248)

```javascript
async handleCharacterChangeFromAgent(deviceId, characterName, existingConnection) {
    // 1. Update character in database
    const apiUrl = `${MANAGER_API_URL}/agent/device/${macAddress}/set-character`;
    await axios.post(apiUrl, { characterName });

    // 2. Clear audio buffers
    connection.bridge.clearAudioBuffers();

    // 3. Delete old room
    await this.roomService.deleteRoom(oldRoomName);

    // 4. Generate new session
    const newSessionUuid = crypto.randomUUID();
    const newRoomName = `${newSessionUuid}_${macForRoom}_conversation`;

    // 5. Create new bridge
    const newBridge = new LiveKitBridge(connection, ...);
    await newBridge.connect(...);

    // 6. Send mode_update to device
    connection.sendMqttMessage(JSON.stringify(modeUpdateMsg));

    // 7. Dispatch new agent
    await this.agentDispatchClient.createDispatch(newRoomName, "cheeko-agent", {
        metadata: { character_change: true, new_character: characterName }
    });
}
```

### 6. Prompt Instructions
**File:** `main.py` (lines 377-420)

Character switching instructions are appended to every prompt:

```python
CHARACTER_CHANGE_INSTRUCTIONS = """
<character_switching>
【IMPORTANT: Character/Mode Switching Capability】

You have the ability to switch to different character modes.

**Available Characters:**
- "Cheeko" - Default fun, playful friend
- "Math Tutor" - Math games and practice
- "Riddle Solver" - Riddle and puzzle games
- "Word Ladder" - Word and vocabulary games

**How to Switch:**
Call the `update_agent_mode` function:
- update_agent_mode(mode_name="Math Tutor")
- update_agent_mode(mode_name="Riddle Solver")

**CRITICAL:** When asked to switch, ALWAYS call the function.
Do NOT just say you are that character.
</character_switching>
"""
```

## Database Schema

### ai_agent_template Table

| Column | Type | Description |
|--------|------|-------------|
| id | varchar(32) | Primary key |
| agent_name | varchar(64) | Character name (Cheeko, Math Tutor, etc.) |
| system_prompt | text | Character's system prompt |
| llm_model_id | varchar(32) | LLM model to use |
| tts_model_id | varchar(32) | TTS model to use |
| lang_code | varchar(10) | Language code |

## API Endpoints

### Set Character
```
POST /toy/agent/device/{macAddress}/set-character
Authorization: Bearer {secret}
Content-Type: application/json

{
    "characterName": "Math Tutor"
}

Response:
{
    "code": 0,
    "data": {
        "success": true,
        "newModeName": "Math Tutor"
    }
}
```

### Get Agent Prompt
```
POST /toy/config/agent-prompt
Authorization: Bearer {secret}
Content-Type: application/json

{
    "macAddress": "68:25:dd:bb:f3:a0"
}

Response:
{
    "code": 0,
    "data": "<identity>You are Cheeko...</identity>"
}
```

## Troubleshooting

### Character Change Not Working

1. **Check logs for function call:**
   ```
   🎭 [CHARACTER-CHANGE] Voice command to switch to: Math Tutor
   🎭 [CHARACTER-CHANGE] Sent character_change_request to MQTT gateway
   ```

2. **If no function call logs:**
   - The prompt may be missing character_switching instructions
   - Check `main.py` has CHARACTER_CHANGE_INSTRUCTIONS appended
   - Restart livekit-server: `pm2 restart livekit-server`

3. **If function called but no switch:**
   - Check MQTT gateway logs for `character_change_request` handling
   - Verify database API is accessible
   - Check LiveKit room deletion/creation logs

### Common Issues

| Issue | Cause | Solution |
|-------|-------|----------|
| "I am already Math Tutor" | Prompt missing instructions | Restart livekit-server |
| No response after "change to..." | Function tool not registered | Check Gemini model supports tools |
| New agent doesn't greet | Agent dispatch failed | Check LiveKit API credentials |
| Audio continues after switch | Audio buffers not cleared | Check clearAudioBuffers() called |

## Testing

### Manual Test
1. Start conversation with Cheeko
2. Say: "Change to Math Tutor"
3. Expected: Brief "Switching..." message, then Math Tutor greeting
4. Verify new session in logs

### Log Verification
```bash
# Watch livekit-server logs
pm2 logs livekit-server --lines 100

# Watch mqtt-gateway logs
pm2 logs mqtt-gateway --lines 100
```

### Expected Log Sequence
```
[livekit-server] 🎭 [CHARACTER-CHANGE] Voice command to switch to: Math Tutor
[livekit-server] 🎭 [CHARACTER-CHANGE] Sent character_change_request to MQTT gateway
[mqtt-gateway]   🎭 [CHARACTER-CHANGE] Voice command request received: Math Tutor
[mqtt-gateway]   🎭 [CHARACTER-CHANGE] Processing voice command character change
[mqtt-gateway]   ✅ [CHARACTER-CHANGE] DB updated to character: Math Tutor
[mqtt-gateway]   🗑️ [CHARACTER-CHANGE] Deleted old room
[mqtt-gateway]   ✅ [CHARACTER-CHANGE] New agent dispatched
[livekit-server] ⚡ Starting new agent for Math Tutor
[livekit-server] 📝 Added character change instructions
[livekit-server] ✅ Gemini Realtime agent is LIVE!
```

## Version History

| Date | Change |
|------|--------|
| 2025-12-17 | Added CHARACTER_CHANGE_INSTRUCTIONS to prompts |
| 2025-12-17 | Created this documentation |
