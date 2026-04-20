import logging
import os

import httpx

logger = logging.getLogger(__name__)

GROQ_API_URL = "https://api.groq.com/openai/v1/audio/transcriptions"
GROQ_API_KEY = os.environ.get("GROQ_API_KEY")
logger.info(f"[STT] GROQ_API_KEY at import: {'set (' + GROQ_API_KEY[:8] + '...)' if GROQ_API_KEY else 'NOT SET'}")


async def transcribe(audio_bytes: bytes) -> str:
    """Transcribe audio bytes to text using Groq Whisper API."""
    # Re-read from env in case it was set after import
    api_key = GROQ_API_KEY or os.environ.get("GROQ_API_KEY")
    if not api_key:
        raise RuntimeError("GROQ_API_KEY not set")

    logger.info(f"[STT] Using key: {api_key[:8]}... (len={len(api_key)})")
    headers = {"Authorization": f"Bearer {api_key}"}
    files = {"file": ("audio.wav", audio_bytes, "audio/wav")}
    data = {"model": "whisper-large-v3", "response_format": "json", "language": "en"}

    async with httpx.AsyncClient(timeout=30.0) as client:
        resp = await client.post(GROQ_API_URL, headers=headers, files=files, data=data)
        resp.raise_for_status()
        result = resp.json()
        text = result.get("text", "").strip()
        logger.info("Groq transcription: '%s'", text)
        return text
