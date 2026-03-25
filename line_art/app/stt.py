import logging
import os

import httpx

logger = logging.getLogger(__name__)

GROQ_API_URL = "https://api.groq.com/openai/v1/audio/transcriptions"
GROQ_API_KEY = os.environ.get("GROQ_API_KEY")


async def transcribe(audio_bytes: bytes) -> str:
    """Transcribe audio bytes to text using Groq Whisper API."""
    if not GROQ_API_KEY:
        raise RuntimeError("GROQ_API_KEY not set")

    headers = {"Authorization": f"Bearer {GROQ_API_KEY}"}
    files = {"file": ("audio.wav", audio_bytes, "audio/wav")}
    data = {"model": "whisper-large-v3", "response_format": "json"}

    async with httpx.AsyncClient(timeout=30.0) as client:
        resp = await client.post(GROQ_API_URL, headers=headers, files=files, data=data)
        resp.raise_for_status()
        result = resp.json()
        text = result.get("text", "").strip()
        logger.info("Groq transcription: '%s'", text)
        return text
