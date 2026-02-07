# OpenClaw Agent Quick Start

## Setup

1. **Install dependencies:**
```bash
npm install
```

2. **Configure API keys in `.env`:**
```env
# AI Services
DEEPGRAM_API_KEY=your_deepgram_api_key
GROQ_API_KEY=your_groq_api_key
ELEVENLABS_API_KEY=your_elevenlabs_api_key
ELEVENLABS_VOICE_ID=EXAVITQu4vr4xnSDxMaL

# Enable OpenClaw Agent
ENABLE_OPENCLAW_AGENT=true
```

3. **Start the service:**
```bash
npm start
```

## Testing the Agent

### Test Voice Pipeline

```javascript
const OpenClawAgent = require('./src/agent/openclaw-agent');

const agent = new OpenClawAgent({
    deepgramApiKey: process.env.DEEPGRAM_API_KEY,
    groqApiKey: process.env.GROQ_API_KEY,
    elevenlabsApiKey: process.env.ELEVENLABS_API_KEY,
    elevenlabsVoiceId: process.env.ELEVENLABS_VOICE_ID
});

// Test with audio file
const fs = require('fs');
const audioBuffer = fs.readFileSync('test-audio.wav');

const response = await agent.processVoiceInput('20:6E:F1:A6:D0:24', audioBuffer);
console.log('User said:', response.userText);
console.log('Agent responded:', response.responseText);
```

### Test Text Input

```javascript
const response = await agent.processTextInput(
    '20:6E:F1:A6:D0:24',
    'Remind me to do homework at 5pm'
);

console.log('Response:', response.responseText);
console.log('Audio generated:', response.audioBuffer.length, 'bytes');
```

### Test Reminder Announcement

```javascript
const response = await agent.processTextInput(
    '20:6E:F1:A6:D0:24',
    'Reminder: do homework',
    { isReminder: true }
);

console.log('Reminder announcement:', response.responseText);
// Output: "Hey! It's time to do homework!"
```

## Voice Pipeline Flow

```
User speaks → Audio Buffer
    ↓
Deepgram STT → "Remind me to call mom at 3pm"
    ↓
Groq LLM → Detects intent, calls set_reminder tool
    ↓
Tool Execution → Reminder scheduled
    ↓
Groq LLM → "I'll remind you to call mom at 3pm!"
    ↓
ElevenLabs TTS → Audio Buffer (MP3)
    ↓
Device plays audio
```

## Available Tools

The agent has built-in tools:

1. **set_reminder** - Schedule reminders
2. **send_message_to_parent** - Send WhatsApp messages

## Conversation History

The agent maintains conversation context per device:

```javascript
// First message
await agent.processTextInput('device-mac', 'My name is Alex');
// Response: "Nice to meet you, Alex!"

// Second message (remembers context)
await agent.processTextInput('device-mac', 'What's my name?');
// Response: "Your name is Alex!"

// Clear history
agent.clearSession('device-mac');
```

## Next Steps

1. ✅ Voice pipeline components created
2. ✅ Agent orchestrator built
3. ⏳ Integrate with MQTT Gateway
4. ⏳ Connect to LiveKit for audio
5. ⏳ Test end-to-end with device

## API Keys

Get your API keys from:
- **Deepgram**: https://console.deepgram.com/
- **Groq**: https://console.groq.com/
- **ElevenLabs**: https://elevenlabs.io/app/speech-synthesis

## Voice Selection

To use a different voice, browse voices at:
https://elevenlabs.io/voice-library

Copy the Voice ID and update `ELEVENLABS_VOICE_ID` in `.env`.
