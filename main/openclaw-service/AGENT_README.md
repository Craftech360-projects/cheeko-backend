# OpenClaw Custom Agent System

## 🎉 Complete Implementation

The OpenClaw custom agent system is now fully implemented! This is a Node.js-based conversational AI agent that replaces the Python LiveKit agent while keeping LiveKit for audio transport.

## Architecture

```
┌─────────────┐
│   Device    │
│  (Cheeko)   │
└──────┬──────┘
       │
       ├─ Audio (LiveKit WebRTC)
       └─ Commands (MQTT)
          │
          ↓
┌─────────────────┐
│  MQTT Gateway   │
└────────┬────────┘
         │
         ↓
┌──────────────────────────────┐
│   OpenClaw Agent Service     │
│  ┌────────────────────────┐ │
│  │ Voice Pipeline:        │ │
│  │  • Deepgram STT        │ │
│  │  • Groq LLM (llama-3)  │ │
│  │  • ElevenLabs TTS      │ │
│  └────────────────────────┘ │
│  ┌────────────────────────┐ │
│  │ Tools:                 │ │
│  │  • Reminders           │ │
│  │  • WhatsApp Messages   │ │
│  └────────────────────────┘ │
└──────────────────────────────┘
```

## Components Built

### Phase 1: Voice Pipeline ✅
- **Deepgram STT** (`src/agent/deepgram-stt.js`)
  - Speech-to-text transcription
  - Live streaming support
  
- **Groq LLM** (`src/agent/groq-llm.js`)
  - llama-3-groq-70b-8192-tool-use-preview
  - Function calling for tools
  - Conversation history per device
  
- **ElevenLabs TTS** (`src/agent/elevenlabs-tts.js`)
  - High-quality voice synthesis
  - Streaming support

### Phase 2: Integration ✅
- **Agent Orchestrator** (`src/agent/openclaw-agent.js`)
  - Coordinates STT → LLM → TTS pipeline
  - Tool execution
  - Session management
  
- **MQTT Handler** (`src/agent/agent-mqtt-handler.js`)
  - Receives voice/text data from gateway
  - Sends audio responses
  
- **LiveKit Handler** (`src/agent/agent-livekit-handler.js`)
  - Audio streaming via LiveKit
  - Room management
  
- **Agent Initialization** (`src/agent/index.js`)
  - Lifecycle management
  - Graceful startup/shutdown

### Phase 3: Configuration ✅
- Updated `openclaw.config.js` with AI services
- Updated `.env.example` with API keys
- Integrated into server startup
- Added MQTT audio publishing

## Setup Instructions

### 1. Get API Keys

**Deepgram:**
- Sign up at https://console.deepgram.com/
- Create API key

**Groq:**
- Sign up at https://console.groq.com/
- Create API key

**ElevenLabs:**
- Sign up at https://elevenlabs.io/
- Create API key
- Choose a voice ID from https://elevenlabs.io/voice-library

### 2. Configure Environment

Add to `.env`:
```env
# AI Services (OpenClaw Agent)
DEEPGRAM_API_KEY=your_deepgram_api_key
GROQ_API_KEY=your_groq_api_key
ELEVENLABS_API_KEY=your_elevenlabs_api_key
ELEVENLABS_VOICE_ID=EXAVITQu4vr4xnSDxMaL

# Enable OpenClaw Agent
ENABLE_OPENCLAW_AGENT=true
```

### 3. Install Dependencies

```bash
cd main/openclaw-service
npm install
```

### 4. Start the Service

```bash
npm start
```

You should see:
```
[AGENT] Initializing OpenClaw agent...
[DEEPGRAM] STT client initialized
[GROQ] LLM client initialized with model: llama-3-groq-70b-8192-tool-use-preview
[ELEVENLABS] TTS client initialized with voice: EXAVITQu4vr4xnSDxMaL
[AGENT-LIVEKIT] Handler initialized
[AGENT-MQTT] Handler initialized
[AGENT] ✅ OpenClaw agent initialized successfully
[AGENT] Voice pipeline ready: Deepgram → Groq (llama-3) → ElevenLabs
```

## How It Works

### Voice Input Flow

1. **User speaks** to Cheeko device
2. **Audio data** sent via MQTT to OpenClaw service
3. **Deepgram STT** transcribes audio to text
4. **Groq LLM** processes text and decides:
   - Generate response
   - Call tools (set reminder, send message)
5. **Tool execution** if needed
6. **ElevenLabs TTS** converts response to audio
7. **Audio sent** back to device via MQTT/LiveKit
8. **Device plays** Cheeko's voice

### Reminder Flow

1. **User says:** "Remind me to do homework at 5pm"
2. **Groq detects** intent and calls `set_reminder` tool
3. **Tool executes:** Reminder scheduled in database
4. **Groq responds:** "I'll remind you to do homework at 5pm!"
5. **At 5pm:** Reminder triggers
6. **Agent announces:** "Hey! It's time to do homework!"

### Conversation Context

The agent maintains conversation history per device:

```javascript
// First interaction
User: "My name is Alex"
Agent: "Nice to meet you, Alex!"

// Later interaction (remembers context)
User: "What's my name?"
Agent: "Your name is Alex!"
```

## Available Tools

The agent has built-in tools accessible via natural language:

1. **set_reminder**
   - User: "Remind me to call mom at 3pm"
   - Agent calls tool → Schedules reminder

2. **send_message_to_parent**
   - User: "Tell my mom I finished my homework"
   - Agent calls tool → Sends WhatsApp message

## Testing

See `AGENT_QUICKSTART.md` for detailed testing instructions.

## Differences from LiveKit Agent

| Feature | LiveKit Agent (Python) | OpenClaw Agent (Node.js) |
|---------|----------------------|-------------------------|
| Language | Python | JavaScript/Node.js |
| STT | Deepgram (via LiveKit) | Deepgram (direct API) |
| LLM | Gemini/Groq | Groq llama-3 |
| TTS | Edge-TTS/ElevenLabs | ElevenLabs |
| Audio Transport | LiveKit native | LiveKit + MQTT |
| Tools | Python functions | JavaScript functions |
| Conversation History | LiveKit session | In-memory per device |
| Deployment | Separate worker process | Integrated in OpenClaw service |

## Advantages

✅ **Single Language:** Everything in Node.js
✅ **Simpler Architecture:** No separate worker processes
✅ **Better Control:** Direct access to all components
✅ **Easier Debugging:** All logs in one place
✅ **Faster Iteration:** No Python/Node.js context switching
✅ **Tool Integration:** Direct access to reminders, WhatsApp, etc.

## Next Steps

1. ✅ Voice pipeline built
2. ✅ MQTT/LiveKit integration complete
3. ⏳ Test with real device
4. ⏳ Optimize latency
5. ⏳ Add more tools
6. ⏳ Production deployment

## Files Created

```
src/agent/
├── deepgram-stt.js          # Speech-to-text client
├── groq-llm.js              # Language model client
├── elevenlabs-tts.js        # Text-to-speech client
├── openclaw-agent.js        # Main agent orchestrator
├── agent-mqtt-handler.js    # MQTT communication
├── agent-livekit-handler.js # LiveKit integration
└── index.js                 # Agent initialization

Updated:
├── src/config/openclaw.config.js  # Added AI services config
├── src/core/message-router.js     # Added agent initialization
├── src/core/mqtt-client.js        # Added audio publishing
├── src/api/server.js              # Added agent shutdown
├── .env.example                   # Added API keys
└── package.json                   # Added AI SDKs
```

## Troubleshooting

**Agent not starting:**
- Check API keys in `.env`
- Ensure `ENABLE_OPENCLAW_AGENT=true`
- Check logs for initialization errors

**No audio response:**
- Verify MQTT connection
- Check LiveKit room status
- Ensure device is connected

**Tool calls not working:**
- Check tool handler registration
- Verify Groq function calling
- Check tool execution logs

## Support

For issues or questions, check:
- `AGENT_QUICKSTART.md` - Quick start guide
- `TROUBLESHOOTING.md` - Common issues
- Server logs - Detailed error messages

---

**Status:** ✅ Complete and ready for testing!
**Branch:** `openclaw_agents`
**Next:** Test with device and optimize
