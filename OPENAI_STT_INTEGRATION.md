# OpenAI STT Integration Summary

## Overview
Successfully added OpenAI STT (Speech-to-Text) as a new provider option for the LiveKit agent, using the `gpt-4o-transcribe` model.

## Changes Made

### 1. LiveKit Server - Provider Factory
**File**: `main/livekit-server/src/providers/provider_factory.py`

Added OpenAI STT support in two places:
- **Fallback mode** (lines 115-122): Added `openai` provider option with StreamAdapter and VAD support
- **Single provider mode** (lines 189-199): Added `openai` provider option with StreamAdapter and VAD support

Key features:
- Uses `openai.STT()` with configurable model (default: `gpt-4o-transcribe`)
- Wrapped in `stt.StreamAdapter` for streaming support
- Supports VAD (Voice Activity Detection)
- Requires `OPENAI_API_KEY` environment variable

### 2. Configuration Loader
**File**: `main/livekit-server/src/config/config_loader.py`

Added configuration support:
- Updated `stt_provider` comment to include `openai` as an option
- Added `openai_stt_model` configuration (default: `gpt-4o-transcribe`)
- Reads from `OPENAI_STT_MODEL` environment variable

### 3. Main Agent File
**File**: `main/livekit-server/main.py`

Updated documentation:
- Line 601: Updated comment to list `openai` as a supported STT provider

### 4. Database Migration
**File**: `main/manager-api/src/main/resources/db/changelog/202512011230_add_openai_stt.sql`

Created new migration to add OpenAI STT to the database:
- Adds `SYSTEM_ASR_OpenAI` provider to `ai_model_provider` table
- Adds `ASR_OpenAI` configuration to `ai_model_config` table
- Includes documentation and setup instructions
- Sort order: 8 (after Google Chirp at 7)

### 5. Changelog Master
**File**: `main/manager-api/src/main/resources/db/changelog/db.changelog-master.yaml`

Added new changeSet:
- ID: `202512011230`
- References the OpenAI STT migration SQL file

## Usage

### Environment Variables
Add to your `.env` file:

```bash
# Set OpenAI as the STT provider
STT_PROVIDER=openai

# OpenAI API Key (required)
OPENAI_API_KEY=your_openai_api_key_here

# Optional: Specify the model (default: gpt-4o-transcribe)
OPENAI_STT_MODEL=gpt-4o-transcribe
```

### Code Example
As shown in the user's request, you can now use:

```python
from livekit.plugins import openai

session = AgentSession(
    stt=openai.STT(
        model="gpt-4o-transcribe",
    ),
    # ... llm, tts, etc.
)
```

Or simply set the environment variable and let the factory create it:
```bash
STT_PROVIDER=openai
```

## Supported STT Providers
The system now supports the following STT providers:
1. **groq** - Groq Whisper (default)
2. **deepgram** - Deepgram Nova
3. **funasr** - FunASR WebSocket
4. **chirp** / **google** - Google Chirp STT
5. **openai** - OpenAI gpt-4o-transcribe (NEW)

## Database Migration
To apply the database changes:
1. The migration will run automatically on next application startup
2. Or manually run Liquibase update

The migration adds:
- Provider entry in `ai_model_provider` table
- Configuration entry in `ai_model_config` table
- Documentation with setup instructions

## Features
- ✅ Streaming support via StreamAdapter
- ✅ VAD (Voice Activity Detection) support
- ✅ Fallback adapter support
- ✅ Configurable model selection
- ✅ Database integration for manager API
- ✅ Environment variable configuration

## Notes
- OpenAI STT requires a valid `OPENAI_API_KEY`
- The `gpt-4o-transcribe` model is optimized for real-time transcription
- VAD is enabled by default (can be controlled via `STT_USE_VAD` env var)
- Works with both single provider and fallback modes
