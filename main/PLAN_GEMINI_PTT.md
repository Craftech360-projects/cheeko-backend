# Gemini Realtime Push-to-Talk Implementation Plan

## Overview
Add push-to-talk (PTT) support to the existing Gemini Realtime agent, allowing manual control of when the user speaks instead of relying on automatic VAD.

## Current Architecture

### Agent (main.py)
- Uses Gemini Realtime with **automatic VAD enabled**
- AgentSession without manual turn detection
- Handles `start_greeting` via data channel

### Gateway (virtual-connection.js)
- Handles: goodbye, abort, function_call, mobile_music_request
- **No PTT handling** for `listen` messages

---

## Implementation Steps

### Step 1: Add PTT Handler to Gateway (virtual-connection.js)

**Location**: `parseOtherMessage()` function (after line ~1046)

**Add handling for PTT messages**:
```javascript
// Handle push-to-talk messages (ESP32 format: listen with mode=manual)
if (json.type === "listen") {
    const state = json.state;
    const mode = json.mode;
    console.log(`🎤 [PTT] Received listen message - State: ${state}, Mode: ${mode}`);

    if (!this.bridge || !this.bridge.room || !this.bridge.room.localParticipant) {
        console.error(`❌ [PTT] No bridge/room available for PTT control`);
        return;
    }

    // Find the agent participant
    const participants = Array.from(this.bridge.room.remoteParticipants.values());
    const agentParticipant = participants.find(p => p.identity.includes('agent') || p.identity.includes('cheeko'));

    if (!agentParticipant) {
        console.error(`❌ [PTT] No agent participant found in room`);
        return;
    }

    try {
        if (state === "start" && mode === "manual") {
            // PTT started - call agent's start_turn RPC
            console.log(`🎤 [PTT] Starting push-to-talk - calling start_turn RPC`);
            const result = await this.bridge.room.localParticipant.performRpc({
                destinationIdentity: agentParticipant.identity,
                method: "start_turn",
                payload: ""
            });
            console.log(`✅ [PTT] start_turn RPC completed: ${result}`);
        } else if (state === "stop") {
            // PTT ended - call agent's end_turn RPC
            console.log(`🎤 [PTT] Stopping push-to-talk - calling end_turn RPC`);
            const result = await this.bridge.room.localParticipant.performRpc({
                destinationIdentity: agentParticipant.identity,
                method: "end_turn",
                payload: ""
            });
            console.log(`✅ [PTT] end_turn RPC completed: ${result}`);
        }
    } catch (error) {
        console.error(`❌ [PTT] Failed to handle PTT message:`, error);
    }
    return;
}
```

---

### Step 2: Add RPC Methods to Agent (main.py)

**Location**: After session.start() (around line 1172)

**Register RPC methods for PTT control**:
```python
# ============================================================================
# PUSH-TO-TALK RPC METHODS
# ============================================================================

@ctx.room.local_participant.register_rpc_method("start_turn")
async def start_turn(data: rtc.RpcInvocationData):
    """Handle PTT start - enable audio input and prepare for user speech"""
    logger.info("🎤 [PTT] start_turn RPC received - enabling audio input")
    try:
        # Interrupt any current agent speech
        session.interrupt()
        # Clear any pending user turn
        session.clear_user_turn()
        # Enable audio input for this participant
        session.input.set_audio_enabled(True)
        logger.info("✅ [PTT] Audio input enabled, ready to receive speech")
        return "ok"
    except Exception as e:
        logger.error(f"❌ [PTT] start_turn failed: {e}")
        return f"error: {e}"

@ctx.room.local_participant.register_rpc_method("end_turn")
async def end_turn(data: rtc.RpcInvocationData):
    """Handle PTT end - disable audio input and commit user turn"""
    logger.info("🎤 [PTT] end_turn RPC received - disabling audio input")
    try:
        # Disable audio input
        session.input.set_audio_enabled(False)
        # Commit the user turn to trigger response generation
        session.commit_user_turn(
            transcript_timeout=10.0,  # Wait for final transcript
            stt_flush_duration=2.0,   # Flush duration for STT
        )
        logger.info("✅ [PTT] Audio input disabled, user turn committed")
        return "ok"
    except Exception as e:
        logger.error(f"❌ [PTT] end_turn failed: {e}")
        return f"error: {e}"

@ctx.room.local_participant.register_rpc_method("cancel_turn")
async def cancel_turn(data: rtc.RpcInvocationData):
    """Handle PTT cancel - disable audio and discard user turn"""
    logger.info("🎤 [PTT] cancel_turn RPC received - canceling turn")
    try:
        session.input.set_audio_enabled(False)
        session.clear_user_turn()
        logger.info("✅ [PTT] Turn canceled")
        return "ok"
    except Exception as e:
        logger.error(f"❌ [PTT] cancel_turn failed: {e}")
        return f"error: {e}"

logger.info("🎤 [PTT] Push-to-talk RPC methods registered")
```

---

### Step 3: Configure PTT Mode (Optional - Hybrid Support)

**Option A: Environment Variable Control**

Add to `.env`:
```
# PTT Mode: "auto" (VAD) or "manual" (push-to-talk)
PTT_MODE=auto
```

Modify agent initialization based on mode:
```python
ptt_mode = os.getenv("PTT_MODE", "auto")

if ptt_mode == "manual":
    # Manual PTT mode - disable VAD
    vad_config = types.RealtimeInputConfig(
        automatic_activity_detection=types.AutomaticActivityDetection(
            disabled=True,  # Disable VAD for PTT
        )
    )
    session = AgentSession(
        llm=realtime_model,
        # Audio disabled by default for PTT
    )
    # Disable audio at start
    session.input.set_audio_enabled(False)
else:
    # Auto mode - keep current VAD settings
    vad_config = types.RealtimeInputConfig(
        automatic_activity_detection=types.AutomaticActivityDetection(
            disabled=False,
            start_of_speech_sensitivity=types.StartSensitivity.START_SENSITIVITY_HIGH,
            end_of_speech_sensitivity=types.EndSensitivity.END_SENSITIVITY_HIGH,
            prefix_padding_ms=10,
            silence_duration_ms=200,
        )
    )
```

---

### Step 4: Client Message Format (ESP32/Python client)

**PTT Start** (when button pressed):
```json
{
    "type": "listen",
    "state": "start",
    "mode": "manual",
    "session_id": "<session_id>"
}
```

**PTT End** (when button released):
```json
{
    "type": "listen",
    "state": "stop",
    "session_id": "<session_id>"
}
```

---

## Flow Diagram

```
┌──────────────┐    MQTT     ┌──────────────┐   RPC    ┌──────────────┐
│   ESP32 /    │ ──────────► │    MQTT      │ ───────► │   Gemini     │
│   Client     │             │   Gateway    │          │   Agent      │
└──────────────┘             └──────────────┘          └──────────────┘
      │                             │                        │
      │ Button Press               │                        │
      │ ─────────────────────────► │                        │
      │ {"type":"listen",          │ performRpc             │
      │  "state":"start",          │ ("start_turn")         │
      │  "mode":"manual"}          │ ─────────────────────► │
      │                            │                        │ Enable audio
      │                            │                        │ input
      │ [User speaks into mic]     │                        │
      │ Audio via UDP ───────────► │ ──── LiveKit ────────► │
      │                            │                        │
      │ Button Release             │                        │
      │ ─────────────────────────► │                        │
      │ {"type":"listen",          │ performRpc             │
      │  "state":"stop"}           │ ("end_turn")           │
      │                            │ ─────────────────────► │
      │                            │                        │ Disable audio
      │                            │                        │ Commit turn
      │                            │                        │ Generate response
      │                            │ ◄──── LiveKit ──────── │
      │ ◄─────────── Audio ─────── │                        │
```

---

## Testing Steps

1. Start gateway with modified `virtual-connection.js`
2. Start agent with PTT RPC methods registered
3. Connect client (ESP32 or Python test client)
4. Press and hold button → sends `listen/start/manual`
5. Speak while holding button
6. Release button → sends `listen/stop`
7. Verify agent processes speech and responds

---

## Files to Modify

1. `main/mqtt-gateway/mqtt/virtual-connection.js` - Add PTT handler in parseOtherMessage()
2. `main/livekit-server/main.py` - Add RPC method registration after session.start()
3. `main/livekit-server/.env` (optional) - Add PTT_MODE configuration

---

## Considerations

### Gemini Realtime VAD vs Manual PTT
- Gemini has built-in VAD that works well for continuous conversation
- For PTT, we may want to disable Gemini's VAD and rely on explicit start/end signals
- Alternative: Keep Gemini VAD but use PTT signals as hints to interrupt/commit

### Hybrid Approach (Recommended)
- Keep VAD enabled for automatic mode
- When PTT signal received, temporarily override VAD behavior
- This allows both modes to work without code changes
