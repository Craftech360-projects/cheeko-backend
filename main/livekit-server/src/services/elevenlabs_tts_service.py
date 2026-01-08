"""
ElevenLabs TTS Service for Rhyme Playback
Generates high-quality audio for nursery rhymes using ElevenLabs API
"""

import os
import logging
import aiohttp
from typing import Optional, Tuple

logger = logging.getLogger(__name__)

# ElevenLabs Voice IDs - Add more as needed
ELEVENLABS_VOICES = {
    "anika": "rCmVtv8cYU60uhlsOo6M",  # Anika - young, cheerful female voice
    "rachel": "21m00Tcm4TlvDq8ikWAM",  # Rachel - calm female voice
    "bella": "EXAVITQu4vr4xnSDxMaL",   # Bella - soft female voice
    "charlie": "IKne3meq5aSn9XLyUdCD", # Charlie - friendly male voice
}

# Default settings
DEFAULT_VOICE = "anika"
DEFAULT_MODEL = "eleven_turbo_v2_5"
DEFAULT_STABILITY = 0.5
DEFAULT_SIMILARITY_BOOST = 0.75
DEFAULT_STYLE = 0.5  # More expressive for rhymes


class ElevenLabsTTSService:
    """Service for generating TTS audio using ElevenLabs API"""

    def __init__(self):
        # Support both ELEVEN_API_KEY and ELEVENLABS_API_KEY env var names
        self.api_key = os.getenv("ELEVEN_API_KEY", "") or os.getenv("ELEVENLABS_API_KEY", "")
        self.base_url = "https://api.elevenlabs.io/v1"
        self.voice_id = os.getenv("ELEVENLABS_VOICE_ID", ELEVENLABS_VOICES.get(DEFAULT_VOICE, ""))
        self.model_id = os.getenv("ELEVENLABS_TTS_MODEL", "") or os.getenv("ELEVENLABS_MODEL_ID", DEFAULT_MODEL)

        if not self.api_key:
            logger.warning("⚠️ ELEVEN_API_KEY/ELEVENLABS_API_KEY not set - ElevenLabs TTS will not work")

    def set_voice(self, voice_name: str):
        """Set voice by name or ID"""
        if voice_name.lower() in ELEVENLABS_VOICES:
            self.voice_id = ELEVENLABS_VOICES[voice_name.lower()]
            logger.info(f"🎤 ElevenLabs voice set to: {voice_name} ({self.voice_id})")
        else:
            # Assume it's a voice ID directly
            self.voice_id = voice_name
            logger.info(f"🎤 ElevenLabs voice ID set to: {voice_name}")

    async def generate_speech(
        self,
        text: str,
        voice: Optional[str] = None,
        stability: float = DEFAULT_STABILITY,
        similarity_boost: float = DEFAULT_SIMILARITY_BOOST,
        style: float = DEFAULT_STYLE,
    ) -> Tuple[Optional[bytes], Optional[str]]:
        """
        Generate speech audio from text using ElevenLabs API

        Args:
            text: Text to convert to speech
            voice: Voice name or ID (optional, uses default if not specified)
            stability: Voice stability (0-1)
            similarity_boost: Voice similarity boost (0-1)
            style: Style exaggeration (0-1) - higher = more expressive

        Returns:
            Tuple of (audio_bytes, error_message)
        """
        if not self.api_key:
            return None, "ElevenLabs API key not configured"

        voice_id = voice if voice else self.voice_id
        if voice and voice.lower() in ELEVENLABS_VOICES:
            voice_id = ELEVENLABS_VOICES[voice.lower()]

        if not voice_id:
            return None, "No voice ID configured"

        url = f"{self.base_url}/text-to-speech/{voice_id}"

        headers = {
            "Accept": "audio/mpeg",
            "Content-Type": "application/json",
            "xi-api-key": self.api_key,
        }

        payload = {
            "text": text,
            "model_id": self.model_id,
            "voice_settings": {
                "stability": stability,
                "similarity_boost": similarity_boost,
                "style": style,
                "use_speaker_boost": True,
            },
        }

        try:
            logger.info(f"🎵 Generating ElevenLabs TTS for {len(text)} chars with voice {voice_id}")

            async with aiohttp.ClientSession() as session:
                async with session.post(url, json=payload, headers=headers) as response:
                    if response.status == 200:
                        audio_data = await response.read()
                        logger.info(f"✅ ElevenLabs TTS generated: {len(audio_data)} bytes")
                        return audio_data, None
                    else:
                        error_text = await response.text()
                        error_msg = f"ElevenLabs API error: {response.status} - {error_text}"
                        logger.error(f"❌ {error_msg}")
                        return None, error_msg

        except Exception as e:
            error_msg = f"ElevenLabs TTS error: {str(e)}"
            logger.error(f"❌ {error_msg}")
            return None, error_msg

    async def generate_rhyme_speech(self, rhyme_text: str, title: str = "") -> Tuple[Optional[bytes], Optional[str]]:
        """
        Generate speech for a nursery rhyme with optimized settings

        Args:
            rhyme_text: The rhyme lyrics to speak
            title: Optional title for logging

        Returns:
            Tuple of (audio_bytes, error_message)
        """
        # Use settings optimized for expressive, child-friendly rhyme delivery
        # Note: ElevenLabs v3 only accepts stability values: 0.0 (Creative), 0.5 (Natural), 1.0 (Robust)
        return await self.generate_speech(
            text=rhyme_text,
            stability=0.0,          # Creative mode = most expressive for v3
            similarity_boost=0.75,  # Keep voice consistent
            style=0.5,              # Style for v3 compatibility
        )


# Singleton instance
_elevenlabs_service: Optional[ElevenLabsTTSService] = None


def get_elevenlabs_service() -> ElevenLabsTTSService:
    """Get or create the ElevenLabs TTS service singleton"""
    global _elevenlabs_service
    if _elevenlabs_service is None:
        _elevenlabs_service = ElevenLabsTTSService()
        # Use voice from ELEVENLABS_VOICE_ID env var (already set in __init__)
        # Only set Anika if no voice is configured
        if not _elevenlabs_service.voice_id:
            _elevenlabs_service.set_voice("anika")
        else:
            logger.info(f"🎤 Using ElevenLabs voice from env: {_elevenlabs_service.voice_id}")
    return _elevenlabs_service
