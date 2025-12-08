# Cheeko LiveKit Agent Simplification Changelog

**Date:** December 8, 2025
**Original File:** `main.py` (~1446 lines)
**Simplified File:** `main.py` (~583 lines)
**Reduction:** ~60% fewer lines

---

## Overview

The `main.py` file was simplified to focus on **conversation mode only** with a cleaner architecture matching the working test app (`gemini_live-api-livekit/agent.py`). This document details all removed components and the current configuration.

---

## Components REMOVED

### 1. Monkey-Patch for LiveKit Plugin (Lines 46-124)

**What it was:**
```python
def _patched_create_tools_config(...):
    """Patched version that combines function_declarations with google_search"""
    # ... 50+ lines of code to fix LiveKit plugin bug
```

**Why removed:**
- Was a workaround for combining function tools with GoogleSearch
- No longer needed since we're using simpler tool configuration
- Native `types.GoogleSearch()` works directly now

---

### 2. Mem0 Memory Provider

**What it was:**
```python
from src.memory.mem0_provider import Mem0MemoryProvider

# Query mem0 for existing memories
async def query_mem0_memories(mac: str) -> tuple:
    provider = Mem0MemoryProvider(api_key=mem0_api_key, role_id=mac)
    memories = await provider.get_all_memories()
    return provider, memories

# Inject memories into prompt
memory_injection = f"""<user_profile>
Here is what I know about the child:
{memories}
</user_profile>"""
agent_prompt = agent_prompt.replace("<memory>", memory_injection)

# Save conversation to mem0 on disconnect
await mem0_provider.save_memory(history_dict, child_name=child_name)
```

**Why removed:**
- User requested removal
- Reduces API calls and complexity
- Child profile personalization still works via simple template replacement

**Impact:**
- Agent no longer remembers conversations across sessions
- Each session starts fresh without prior context

---

### 3. Chat History Service

**What it was:**
```python
from src.services.chat_history_service import ChatHistoryService

chat_history_service = ChatHistoryService(
    manager_api_url=manager_api_url,
    secret=manager_api_secret,
    device_mac=device_mac,
    session_id=room_name,
    agent_id=agent_id
)
chat_history_service.start_periodic_sending()

# On disconnect
await chat_history_service.cleanup()
```

**Why removed:**
- User requested removal
- Reduces API calls and background tasks

**Impact:**
- Conversations are no longer logged to backend
- No chat history stored in database

---

### 4. Analytics Service

**What it was:**
```python
from src.services.analytics_service import AnalyticsService

analytics_service = AnalyticsService(
    manager_api_url=manager_api_url,
    secret=manager_api_secret,
    device_mac=device_mac,
    session_id=room_name,
    agent_id=agent_id
)
await analytics_service.start_session(mode_type)
await analytics_service.end_session(completion_status="completed")
```

**Why removed:**
- User requested removal
- Reduces API calls

**Impact:**
- No session analytics tracking
- No usage metrics collected

---

### 5. Music Service & Story Service

**What it was:**
```python
from src.services.music_service import MusicService
from src.services.story_service import StoryService

music_service = MusicService(embedding_model, qdrant_client)
story_service = StoryService(embedding_model, qdrant_client)

await music_service.initialize()
await story_service.initialize()

# Parallel metadata fetch
await asyncio.gather(
    music_service.get_all_languages(),
    story_service.get_all_categories(),
)
```

**Why removed:**
- User requested removal - focus on conversation only
- Music/story modes have separate bots in MQTT gateway

**Impact:**
- No music playback functionality
- No story playback functionality
- Conversation mode only

---

### 6. Question Generator & Riddle Generator Services

**What it was:**
```python
from src.services.question_generator_service import QuestionGeneratorService
from src.services.riddle_generator_service import RiddleGeneratorService

question_generator_service = QuestionGeneratorService()
await question_generator_service.initialize()

riddle_generator_service = RiddleGeneratorService()
await riddle_generator_service.initialize()
```

**Why removed:**
- User requested removal
- These were game-related features

**Impact:**
- No math quiz generation
- No riddle generation

---

### 7. Model Preloader & Cache

**What it was:**
```python
from src.utils.model_preloader import model_preloader
from src.utils.model_cache import model_cache

# In prewarm()
model_preloader.start_background_loading()
proc.userdata["embedding_model"] = model_cache.get_embedding_model()
proc.userdata["qdrant_client"] = model_cache.get_qdrant_client()

# In entrypoint()
preloaded_embedding_model = ctx.proc.userdata.get("embedding_model")
preloaded_qdrant_client = ctx.proc.userdata.get("qdrant_client")
```

**Why removed:**
- Only needed for music/story services (which are removed)
- Embedding models were for Qdrant vector search

**Impact:**
- Faster prewarm (no model loading)
- Reduced memory usage

---

### 8. Audio Players

**What it was:**
```python
from src.services.unified_audio_player import UnifiedAudioPlayer
from src.services.foreground_audio_player import ForegroundAudioPlayer

audio_player = ForegroundAudioPlayer()
unified_audio_player = UnifiedAudioPlayer()

audio_player.set_session(session)
audio_player.set_context(ctx)
```

**Why removed:**
- Used for music/story playback
- Not needed for conversation mode

**Impact:**
- No audio file playback capability

---

### 9. Jinja2 Template Rendering

**What it was:**
```python
from jinja2 import Template

template_vars = {
    'emojiList': EMOJI_List,
    'child_name': child_profile.get('name', ''),
    'child_age': child_profile.get('age', ''),
    # ... more variables
}

if any(placeholder in agent_prompt for placeholder in ['{{', '{%']):
    template = Template(agent_prompt)
    agent_prompt = template.render(**template_vars)
```

**Now replaced with:**
```python
# Simple string replacement
agent_prompt = agent_prompt.replace("{{child_name}}", child_profile.get('name', ''))
agent_prompt = agent_prompt.replace("{{child_age}}", str(child_profile.get('age', '')))
# ... etc
```

**Why changed:**
- Jinja2 was overkill for simple variable replacement
- Reduces dependencies
- Memory injection (which needed Jinja2) was removed

---

### 10. PTT RPC Methods

**What it was:**
```python
@ctx.room.local_participant.register_rpc_method("start_turn")
async def start_turn(data: rtc.RpcInvocationData):
    if hasattr(session, 'interrupt'):
        session.interrupt()
    if hasattr(session, 'clear_user_turn'):
        session.clear_user_turn()
    if hasattr(session, 'input') and hasattr(session.input, 'set_audio_enabled'):
        session.input.set_audio_enabled(True)
    return "ok"

@ctx.room.local_participant.register_rpc_method("end_turn")
async def end_turn(data: rtc.RpcInvocationData):
    async def delayed_disable():
        await asyncio.sleep(3.0)
        session.input.set_audio_enabled(False)
    asyncio.create_task(delayed_disable())
    return "ok"

@ctx.room.local_participant.register_rpc_method("cancel_turn")
async def cancel_turn(data: rtc.RpcInvocationData):
    session.input.set_audio_enabled(False)
    if hasattr(session, 'clear_user_turn'):
        session.clear_user_turn()
    return "ok"
```

**Why removed:**
- These methods tried to control PTT at the agent level
- The working test app doesn't use RPC methods
- PTT should be controlled at audio source (mute/unmute track)

**Impact:**
- MQTT gateway's RPC calls will fail silently
- PTT must be implemented differently (see PTT section below)

---

### 11. Manual Turn Detection & Custom VAD Config

**What it was:**
```python
ptt_mode = os.getenv("PTT_MODE", "auto").lower() == "manual"

vad_config = types.RealtimeInputConfig(
    automatic_activity_detection=types.AutomaticActivityDetection(
        disabled=False,
        start_of_speech_sensitivity=types.StartSensitivity.START_SENSITIVITY_HIGH,
        end_of_speech_sensitivity=types.EndSensitivity.END_SENSITIVITY_LOW,
        prefix_padding_ms=100,
        silence_duration_ms=2000,
    )
)

session = AgentSession(
    llm=realtime_model,
    turn_detection="manual",  # Manual turn control for PTT
)
```

**Now:**
```python
session = AgentSession(
    llm=realtime_model,
    # NO turn_detection parameter - uses default
)
```

**Why changed:**
- Test app works without manual turn detection
- Default Gemini VAD handles turn detection naturally
- Complex VAD config was causing PTT issues

---

### 12. Data Channel `start_greeting` Handler

**What it was:**
```python
@ctx.room.on("data_received")
def on_data_received(data_packet: rtc.DataPacket):
    if data_json.get('type') == 'start_greeting' and room_type == "conversation":
        async def send_greeting():
            await session.say("Hello! How can I help you today?", allow_interruptions=True)
        asyncio.create_task(send_greeting())
```

**Now:**
```python
# Auto-greet immediately after session.start()
await session.generate_reply(
    instructions="Greet the user warmly and offer your assistance."
)
```

**Why changed:**
- User requested auto-greet pattern from test app
- Simpler - no need to wait for data channel signal

---

## Current Configuration

### Imports (Simplified)

```python
import os, logging, asyncio, json, time, threading, aiohttp
from datetime import datetime
from dotenv import load_dotenv

from livekit.agents import AgentSession, JobContext, JobProcess, WorkerOptions, cli, Agent, AutoSubscribe
from livekit import rtc, api
from livekit.plugins import google
from google.genai import types

from src.config.datadog_config import DatadogConfig
from src.config.config_loader import ConfigLoader
from src.utils.database_helper import DatabaseHelper
from src.services.prompt_service import PromptService
from src.mcp.device_control_service import DeviceControlService
from src.mcp.mcp_executor import LiveKitMCPExecutor
from src.agent.filtered_agent import FilteredAgent
from src.utils.loki_agent_logger import logger
```

### Components KEPT

| Component | Purpose |
|-----------|---------|
| `ResourceMonitor` | System resource monitoring (CPU, RAM, etc.) |
| `PromptService` | Dynamic prompt fetching from API |
| `DatabaseHelper` | Child profile fetching |
| `DeviceControlService` | Device MCP commands (volume, etc.) |
| `LiveKitMCPExecutor` | MCP command execution |
| `FilteredAgent` | Text filtering for TTS, emotion detection |
| `delete_livekit_room()` | Room cleanup on disconnect |
| `setup_error_handling()` | Error recovery with retries |
| LED state management | `emit_agent_state`, `emit_speech_created` |

### Gemini Realtime Model Setup

```python
# Google Search grounding
google_search_grounding = types.GoogleSearch()

# Create model - SIMPLE, matching test app
realtime_model = google.realtime.RealtimeModel(
    model="gemini-2.5-flash-native-audio-preview-09-2025",
    voice="Zephyr",
    temperature=0.8,
    modalities=["AUDIO"],
    _gemini_tools=[google_search_grounding],
)

# Create session - NO manual turn detection
session = AgentSession(
    llm=realtime_model,
)
```

### API Calls (Reduced from 5 to 3)

```python
results = await asyncio.gather(
    db_helper.get_agent_id(device_mac),              # Agent ID
    prompt_service.get_prompt_and_config(...),       # Prompt + TTS config
    db_helper.get_child_profile_by_mac(device_mac),  # Child profile
    return_exceptions=True
)
```

**Removed API calls:**
- `query_mem0_memories()` - Memory retrieval
- `db_helper.get_current_character()` - Character mode

### Session Flow

```python
# 1. Connect to room
await ctx.connect(auto_subscribe=AutoSubscribe.AUDIO_ONLY)

# 2. Wait for participant
participant = await ctx.wait_for_participant()

# 3. Start session
await session.start(room=ctx.room, agent=assistant)

# 4. Auto-greet (new pattern)
await session.generate_reply(
    instructions="Greet the user warmly and offer your assistance."
)
```

---

## PTT (Push-to-Talk) Status

### Current State (Updated Dec 8, 2025)
- **Agent side:** Uses default Gemini VAD (no manual control) ✅
- **MQTT Gateway side:** RPC calls removed - just logs PTT state ✅
- **PTT Working:** YES! Gemini VAD detects speech/silence naturally

### How PTT Works Now

1. **ESP32** sends `listen` messages with `state: start/stop`
2. **MQTT Gateway** logs the PTT state (no RPC calls)
3. **Agent** uses Gemini's built-in VAD to detect when user stops speaking
4. **Response** triggers automatically when silence is detected

### MQTT Gateway Change

```javascript
// OLD: Called RPC methods (caused errors)
await this.bridge.room.localParticipant.performRpc({
  destinationIdentity: agentParticipant.identity,
  method: "start_turn",
  payload: ""
});

// NEW: Just log, no RPC calls
console.log(`🎤 [PTT] Listen message - State: ${state}, Mode: ${mode} (Gemini VAD handles turn detection)`);
```

### Why It Works

| Component | Behavior |
|-----------|----------|
| ESP32 | Sends audio while button held |
| MQTT Gateway | Forwards audio to LiveKit |
| Agent (Gemini) | VAD detects speech & silence |
| Response | Triggers when VAD detects silence |

---

## File Dependencies

### Files Still Required
- `src/config/datadog_config.py` - Logging setup
- `src/config/config_loader.py` - Configuration loading
- `src/utils/database_helper.py` - API calls for child profile
- `src/services/prompt_service.py` - Prompt fetching
- `src/mcp/device_control_service.py` - Device control
- `src/mcp/mcp_executor.py` - MCP execution
- `src/agent/filtered_agent.py` - Text filtering + emotion
- `src/agent/error_handler.py` - Error recovery
- `src/utils/loki_agent_logger.py` - Logger

### Files No Longer Imported
- `src/memory/mem0_provider.py`
- `src/services/chat_history_service.py`
- `src/services/analytics_service.py`
- `src/services/music_service.py`
- `src/services/story_service.py`
- `src/services/question_generator_service.py`
- `src/services/riddle_generator_service.py`
- `src/services/unified_audio_player.py`
- `src/services/foreground_audio_player.py`
- `src/services/google_search_service.py`
- `src/utils/model_preloader.py`
- `src/utils/model_cache.py`
- `src/handlers/chat_logger.py`
- `src/agent/main_agent.py` (old complex Assistant)

---

## Environment Variables

### Still Used
- `GOOGLE_API_KEY` - Gemini API
- `LIVEKIT_URL` - LiveKit server
- `LIVEKIT_API_KEY` - LiveKit auth
- `LIVEKIT_API_SECRET` - LiveKit auth
- `MANAGER_API_URL` - Backend API
- `MANAGER_API_SECRET` - Backend auth

### No Longer Used
- `PTT_MODE` - Was for manual turn detection
- `MEM0_API_KEY` - Memory service
- `MEM0_ENABLED` - Memory toggle

---

## Testing Checklist

- [ ] Agent starts and connects to room
- [ ] Agent auto-greets on participant join
- [ ] Conversation works (user speaks, agent responds)
- [ ] Google Search grounding works for real-time queries
- [ ] Child profile personalization works in prompt
- [ ] LED state changes are emitted (`agent_state_changed`)
- [ ] Error handling works (retries on failures)
- [ ] Room cleanup works on disconnect
- [ ] Resource monitoring logs appear

---

## Rollback

If you need to restore the full-featured version:

```bash
git checkout HEAD~1 -- backend/main/livekit-server/main.py
```

Or restore from the backup in version control.

---

**Document Version:** 1.0
**Last Updated:** December 8, 2025
