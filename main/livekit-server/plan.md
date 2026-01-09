# Plan: Direct Client to LiveKit Audio Streaming

## Overview

Remove UDP audio streaming from client to MQTT gateway. Instead, client connects directly to LiveKit for audio, while MQTT gateway handles signaling only.

---

## Current Architecture

```
┌──────────┐    MQTT     ┌──────────────┐   LiveKit   ┌─────────────┐
│  Client  │◄───────────►│ MQTT Gateway │◄───────────►│ LiveKit     │
│(client.py)│            │              │             │ Server      │
└────┬─────┘             └──────┬───────┘             └──────┬──────┘
     │                          │                            │
     │    UDP (Opus audio)      │                            │
     └──────────────────────────┘                            │
                                                             │
                                                    ┌────────▼────────┐
                                                    │  Cheeko Agent   │
                                                    │(cheeko_worker.py)│
                                                    └─────────────────┘
```

### Current Flow:
1. Client sends "hello" via MQTT to gateway
2. Gateway creates LiveKit room, joins as participant
3. Gateway returns UDP session details: `{server, port, key, nonce}`
4. Client sends/receives Opus audio via encrypted UDP to gateway
5. Gateway decodes client audio → forwards to LiveKit room
6. Gateway receives agent audio from LiveKit → encodes Opus → sends via UDP to client
7. Agent processes audio with Gemini Realtime

---

## Proposed Architecture

```
┌──────────┐    MQTT (signaling)    ┌──────────────┐
│  Client  │◄──────────────────────►│ MQTT Gateway │
│(client.py)│                       │ (signaling)  │
└────┬─────┘                        └──────┬───────┘
     │                                     │
     │  LiveKit WebRTC (audio)             │ Agent Dispatch
     │                                     │
     ▼                                     ▼
┌─────────────────────────────────────────────────┐
│                  LiveKit Server                  │
└────────────────────────┬────────────────────────┘
                         │
                ┌────────▼────────┐
                │  Cheeko Agent   │
                │(cheeko_worker.py)│
                └─────────────────┘
```

### Proposed Flow:
1. Client sends "hello" via MQTT to gateway
2. Gateway creates LiveKit room
3. Gateway generates LiveKit access token for client
4. Gateway dispatches agent to room
5. Gateway returns LiveKit credentials: `{url, token, room_name}`
6. **Client connects directly to LiveKit using WebRTC**
7. Audio flows: Client ↔ LiveKit ↔ Agent (no gateway involvement)

---

## Benefits

| Benefit | Description |
|---------|-------------|
| **Lower Latency** | Audio skips gateway processing (~50-100ms saved) |
| **Better NAT Traversal** | WebRTC/ICE handles NAT automatically |
| **Reduced Gateway Load** | No audio encoding/decoding on gateway |
| **Simpler Architecture** | Gateway becomes signaling-only |
| **Standard Protocol** | Uses WebRTC instead of custom UDP protocol |

---

## Implementation Plan

### Phase 1: Gateway Changes (mqtt-gateway)

#### 1.1 Modify Hello Response Handler

**File:** `mqtt-gateway/gateway/mqtt-gateway.js`

**Current hello response** (via VirtualMQTTConnection):
```javascript
{
  type: "hello",
  session_id: roomName,
  udp: {
    server: publicIp,
    port: udpPort,
    key: aesKey,
    nonce: nonce
  },
  audio_params: { sample_rate: 24000, channels: 1, frame_duration: 60, format: "opus" }
}
```

**New hello response:**
```javascript
{
  type: "hello",
  session_id: roomName,
  // NEW: LiveKit direct connection credentials
  livekit: {
    url: "wss://your-livekit-server.com",
    token: "<JWT access token>",
    room_name: roomName
  },
  // DEPRECATED: Keep for backward compatibility with embedded devices
  udp: {
    server: publicIp,
    port: udpPort,
    key: aesKey,
    nonce: nonce
  },
  audio_params: { sample_rate: 16000, channels: 1, format: "opus" }
}
```

#### 1.2 Token Generation Function

**File:** `mqtt-gateway/gateway/mqtt-gateway.js` (or new file `mqtt-gateway/livekit/token-generator.js`)

```javascript
const { AccessToken } = require("livekit-server-sdk");

async function generateClientToken(roomName, clientIdentity, macAddress) {
  const livekitConfig = configManager.get("livekit");

  const at = new AccessToken(livekitConfig.api_key, livekitConfig.api_secret, {
    identity: clientIdentity,
    attributes: {
      device_mac: macAddress,
      participant_type: "device"
    }
  });

  at.addGrant({
    room: roomName,
    roomJoin: true,
    roomCreate: false,  // Room already created by gateway
    canPublish: true,
    canSubscribe: true,
    canPublishData: true
  });

  // Token expires in 24 hours
  at.ttl = 24 * 60 * 60;

  return await at.toJwt();
}
```

#### 1.3 Modify LiveKit Bridge Behavior

**File:** `mqtt-gateway/livekit/livekit-bridge.js`

When client connects directly to LiveKit:
- Gateway should NOT join the room as audio participant
- Gateway only needs to dispatch agent and manage room lifecycle
- Remove audio forwarding code for direct-connect clients

**Changes:**
1. Add `connectionMode` parameter: `"direct"` or `"gateway_bridge"`
2. If `direct`: Skip `audioSource` creation and track publishing
3. Gateway still listens for data channel messages (for signaling)

---

### Phase 2: Client Changes (client.py)

#### 2.1 Install LiveKit SDK

```bash
pip install livekit livekit-rtc
```

#### 2.2 New LiveKit Connection Class

**File:** `client.py` (or new file `livekit_client.py`)

```python
import asyncio
from livekit import rtc

class LiveKitAudioClient:
    def __init__(self, url: str, token: str, room_name: str):
        self.url = url
        self.token = token
        self.room_name = room_name
        self.room = rtc.Room()
        self.audio_source = rtc.AudioSource(16000, 1)  # 16kHz mono
        self.audio_stream = None

    async def connect(self):
        # Connect to LiveKit room
        await self.room.connect(self.url, self.token)
        print(f"Connected to room: {self.room.name}")

        # Publish microphone track
        track = rtc.LocalAudioTrack.create_audio_track("microphone", self.audio_source)
        options = rtc.TrackPublishOptions()
        options.source = rtc.TrackSource.SOURCE_MICROPHONE
        await self.room.local_participant.publish_track(track, options)

        # Subscribe to agent audio
        self.room.on("track_subscribed", self._on_track_subscribed)

    def _on_track_subscribed(self, track, publication, participant):
        if track.kind == rtc.TrackKind.KIND_AUDIO:
            print(f"Subscribed to audio from: {participant.identity}")
            self.audio_stream = rtc.AudioStream(track)
            asyncio.create_task(self._play_audio())

    async def _play_audio(self):
        """Play received audio from agent"""
        async for frame in self.audio_stream:
            # Convert frame to PCM and play via pyaudio
            pcm_data = frame.data.tobytes()
            # ... play audio

    async def send_audio(self, pcm_data: bytes):
        """Send microphone audio to LiveKit"""
        samples = np.frombuffer(pcm_data, dtype=np.int16)
        frame = rtc.AudioFrame(
            data=samples,
            sample_rate=16000,
            num_channels=1,
            samples_per_channel=len(samples)
        )
        await self.audio_source.capture_frame(frame)

    async def disconnect(self):
        await self.room.disconnect()
```

#### 2.3 Modify Hello Handler

```python
def on_mqtt_message(self, client, userdata, msg):
    payload = json.loads(msg.payload.decode())

    if payload.get("type") == "hello":
        # Check for LiveKit credentials (new flow)
        if "livekit" in payload:
            livekit_creds = payload["livekit"]
            self.livekit_client = LiveKitAudioClient(
                url=livekit_creds["url"],
                token=livekit_creds["token"],
                room_name=livekit_creds["room_name"]
            )
            asyncio.create_task(self.livekit_client.connect())
            print("Using direct LiveKit connection")
        else:
            # Fallback to UDP (old flow)
            self.setup_udp_connection(payload["udp"])
            print("Using UDP gateway connection")
```

#### 2.4 Update Audio Recording Thread

Replace UDP sending with LiveKit audio source:

```python
async def _record_audio_livekit(self):
    """Record microphone and send to LiveKit"""
    p = pyaudio.PyAudio()
    stream = p.open(
        format=pyaudio.paInt16,
        channels=1,
        rate=16000,
        input=True,
        frames_per_buffer=320  # 20ms frames
    )

    while not self.stop_recording:
        pcm_data = stream.read(320, exception_on_overflow=False)
        await self.livekit_client.send_audio(pcm_data)

    stream.close()
    p.terminate()
```

---

### Phase 3: Agent Changes (cheeko_worker.py)

**No changes required!**

The agent already:
- Connects to LiveKit room via `ctx.connect()`
- Subscribes to audio via `AutoSubscribe.AUDIO_ONLY`
- Publishes audio via Gemini Realtime model
- Handles data channel messages

The agent doesn't care whether audio comes from gateway or directly from client.

---

## File Changes Summary

| File | Action | Lines Changed |
|------|--------|---------------|
| `mqtt-gateway/gateway/mqtt-gateway.js` | Modify hello handler | ~30 lines |
| `mqtt-gateway/livekit/livekit-bridge.js` | Add direct connection mode | ~50 lines |
| `mqtt-gateway/livekit/token-generator.js` | New file | ~40 lines |
| `client.py` | Major rewrite for LiveKit | ~200 lines |
| `cheeko_worker.py` | No changes | 0 lines |

---

## Migration Strategy

### Backward Compatibility

1. **Keep UDP as fallback**: Gateway returns both `livekit` and `udp` in hello response
2. **Client detection**: Gateway checks client capabilities from hello message
3. **Gradual rollout**: Enable direct LiveKit per-device via feature flag

### Hello Message Enhancement

**Client hello request:**
```javascript
{
  type: "hello",
  version: 4,  // Increment version
  transport: "mqtt",
  capabilities: ["livekit_direct", "udp"],  // NEW: Client capabilities
  audio_params: { sample_rate: 16000, channels: 1, format: "opus" }
}
```

**Gateway logic:**
```javascript
if (clientCapabilities.includes("livekit_direct")) {
  // Return LiveKit credentials
  response.livekit = { url, token, room_name };
} else {
  // Return UDP details (legacy)
  response.udp = { server, port, key, nonce };
}
```

---

## Testing Plan

### Unit Tests
1. Token generation with correct grants
2. Room creation with proper settings
3. Client connection to LiveKit

### Integration Tests
1. Full flow: Client → LiveKit → Agent → Client
2. Audio quality comparison: Direct vs UDP
3. Latency measurement: Direct vs UDP
4. NAT traversal scenarios

### Manual Tests
1. Start gateway, agent
2. Run client with direct LiveKit
3. Verify two-way audio
4. Test interrupt/abort functionality
5. Test mode switching

---

## Rollback Plan

If issues arise:
1. Client checks for `livekit` in hello response
2. If missing or connection fails, fall back to UDP
3. Gateway can disable LiveKit credentials via config flag

```python
# client.py fallback logic
if "livekit" in hello_response:
    try:
        await self.connect_livekit(hello_response["livekit"])
    except Exception as e:
        print(f"LiveKit failed: {e}, falling back to UDP")
        self.connect_udp(hello_response["udp"])
else:
    self.connect_udp(hello_response["udp"])
```

---

## Timeline Estimate

| Phase | Task | Duration |
|-------|------|----------|
| 1 | Gateway token generation | 2-3 hours |
| 2 | Gateway hello response modification | 1-2 hours |
| 3 | Client LiveKit integration | 4-6 hours |
| 4 | Testing & debugging | 2-3 hours |
| **Total** | | **9-14 hours** |

---

## Open Questions

1. **ESP32 Support**: Does the actual embedded device need direct LiveKit? (WebRTC is heavy for ESP32)
2. **TURN Server**: Is a TURN server configured for restrictive NAT scenarios?
3. **Audio Sample Rate**: Should client send 16kHz or 24kHz to LiveKit?
4. **Data Channel**: Should signaling (TTS start/stop) go through LiveKit data channel or stay on MQTT?

---

## References

- [LiveKit Python SDK](https://docs.livekit.io/client-sdk-js/)
- [livekit-rtc PyPI](https://pypi.org/project/livekit-rtc/)
- [LiveKit Server SDK](https://docs.livekit.io/server-sdk/)
- Current code: `mqtt-gateway/livekit/livekit-bridge.js:282-298` (token generation example)
