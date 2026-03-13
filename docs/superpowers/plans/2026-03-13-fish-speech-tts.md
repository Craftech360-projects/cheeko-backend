# Fish Speech TTS (RunPod) Integration Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace ElevenLabs TTS with a custom Fish Speech TTS plugin backed by RunPod serverless in `cheeko_SLT.py`.

**Architecture:** Define a custom LiveKit `TTS` subclass and `ChunkedStream` subclass inline in `cheeko_SLT.py`. The `ChunkedStream._run()` method calls the RunPod `/runsync` endpoint via `aiohttp`, decodes the base64 WAV response, and pushes raw bytes to LiveKit's `AudioEmitter` which handles WAV decoding and framing internally.

**Tech Stack:** Python, LiveKit Agents v1.4.5, aiohttp (already installed), RunPod serverless API

**Constraint:** Only `main/livekit-server/workers/cheeko_SLT.py` may be edited. No new files.

---

## File Structure

- **Modify:** `main/livekit-server/workers/cheeko_SLT.py`
  - Remove ElevenLabs import (line 32)
  - Add new imports (aiohttp, base64, LiveKit TTS base classes)
  - Add `FishSpeechChunkedStream` class (~30 lines)
  - Add `FishSpeechTTS` class (~30 lines)
  - Replace TTS instantiation (lines 240-242)

No other files created or modified.

---

## Chunk 1: Implementation

### Task 1: Update imports

**Files:**
- Modify: `main/livekit-server/workers/cheeko_SLT.py:9-12` (add imports)
- Modify: `main/livekit-server/workers/cheeko_SLT.py:32` (remove ElevenLabs import)

- [ ] **Step 1: Remove ElevenLabs import and add new imports**

Replace line 32:
```python
from livekit.plugins.elevenlabs import TTS as ElevenLabsTTS
```

With:
```python
import aiohttp
import base64
from livekit.agents.tts import TTS as BaseTTS, ChunkedStream, TTSCapabilities
from livekit.agents.utils import shortuuid
```

- [ ] **Step 2: Verify no other references to ElevenLabsTTS exist**

Search the file for `ElevenLabsTTS` — the only other reference is the instantiation at line 241 which will be changed in Task 3.

---

### Task 2: Add FishSpeechTTS classes

**Files:**
- Modify: `main/livekit-server/workers/cheeko_SLT.py` (insert after imports, before `CheekoAssistant` class at line 59)

- [ ] **Step 1: Add FishSpeechChunkedStream class**

Insert after line 56 (MODE_SWITCH_TOOLS), before the CheekoAssistant class:

```python
class FishSpeechChunkedStream(ChunkedStream):
    """ChunkedStream that calls RunPod Fish Speech API"""

    def __init__(self, *, tts: "FishSpeechTTS", input_text: str, conn_options):
        super().__init__(tts=tts, input_text=input_text, conn_options=conn_options)

    async def _run(self, output_emitter) -> None:
        tts: FishSpeechTTS = self._tts
        request_id = shortuuid()
        output_emitter.initialize(
            request_id=request_id,
            sample_rate=tts.sample_rate,
            num_channels=tts.num_channels,
            mime_type="audio/wav",
            stream=False,
        )

        url = f"https://api.runpod.ai/v2/{tts._endpoint_id}/runsync"
        headers = {
            "Authorization": f"Bearer {tts._api_key}",
            "Content-Type": "application/json",
        }
        payload = {
            "input": {
                "text": self._input_text,
                "format": "wav",
                "temperature": 0.8,
                "top_p": 0.8,
            }
        }
        if tts._reference_audio:
            payload["input"]["reference_audio"] = tts._reference_audio
            payload["input"]["reference_text"] = tts._reference_text or ""

        async with aiohttp.ClientSession() as session:
            async with session.post(url, json=payload, headers=headers, timeout=aiohttp.ClientTimeout(total=30)) as resp:
                resp.raise_for_status()
                data = await resp.json()

        output = data.get("output", {})
        if "error" in output:
            from livekit.agents._exceptions import APIError
            raise APIError(f"Fish Speech error: {output['error']}")

        audio_b64 = output.get("audio_base64", "")
        audio_bytes = base64.b64decode(audio_b64)
        output_emitter.push(audio_bytes)
        output_emitter.flush()
```

- [ ] **Step 2: Add FishSpeechTTS class**

Insert immediately after the FishSpeechChunkedStream class:

```python
class FishSpeechTTS(BaseTTS):
    """Fish Speech TTS via RunPod serverless"""

    def __init__(
        self,
        *,
        endpoint_id: str,
        api_key: str,
        reference_audio: str | None = None,
        reference_text: str | None = None,
    ) -> None:
        super().__init__(
            capabilities=TTSCapabilities(streaming=False),
            sample_rate=44100,
            num_channels=1,
        )
        self._endpoint_id = endpoint_id
        self._api_key = api_key
        self._reference_audio = reference_audio
        self._reference_text = reference_text

    @property
    def model(self) -> str:
        return "fish-speech-1.5"

    @property
    def provider(self) -> str:
        return "runpod"

    def synthesize(self, text: str, *, conn_options=None):
        from livekit.agents.types import DEFAULT_API_CONNECT_OPTIONS
        if conn_options is None:
            conn_options = DEFAULT_API_CONNECT_OPTIONS
        return FishSpeechChunkedStream(tts=self, input_text=text, conn_options=conn_options)

    async def aclose(self) -> None:
        pass
```

---

### Task 3: Replace TTS instantiation

**Files:**
- Modify: `main/livekit-server/workers/cheeko_SLT.py:240-242`

- [ ] **Step 1: Replace ElevenLabs TTS with FishSpeechTTS**

Replace:
```python
    # TTS: ElevenLabs
    tts = ElevenLabsTTS()
    logger.info(f"ElevenLabs TTS created")
```

With:
```python
    # TTS: Fish Speech via RunPod
    tts = FishSpeechTTS(
        endpoint_id=os.getenv("RUNPOD_ENDPOINT_ID", "d4twkzby42jxr7"),
        api_key=os.getenv("RUNPOD_API_KEY"),
    )
    logger.info(f"Fish Speech TTS created (RunPod endpoint: {tts._endpoint_id})")
```

- [ ] **Step 2: Verify the file has no syntax errors**

Run: `cd main/livekit-server && python -c "import ast; ast.parse(open('workers/cheeko_SLT.py').read()); print('OK')"`
Expected: `OK`

- [ ] **Step 3: Commit**

```bash
git add main/livekit-server/workers/cheeko_SLT.py
git commit -m "feat: replace ElevenLabs TTS with Fish Speech via RunPod in cheeko_SLT"
```

---

## Notes

- **Latency:** RunPod serverless has cold starts (10-30s). Warm requests ~1-5s. This is non-streaming (full audio returned at once), unlike ElevenLabs which streams chunks. User experience will feel slower.
- **Voice cloning:** Pass `reference_audio` (base64) and `reference_text` to the TTS constructor for voice cloning. Not wired up by default — can be added later via config.
- **Sample rate mismatch:** Fish Speech outputs 44100 Hz. LiveKit's AudioEmitter handles resampling internally via its codec decoder path.
- **Env vars needed:** `RUNPOD_ENDPOINT_ID` and `RUNPOD_API_KEY` in `.env`.
