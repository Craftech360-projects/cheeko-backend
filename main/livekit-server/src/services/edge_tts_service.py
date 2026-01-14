"""
Edge TTS Service for Audio Caching
Generates audio using Microsoft Edge TTS (free, no API limits)
"""

import os
import asyncio
import tempfile
from pathlib import Path
from typing import Optional, Tuple
from src.utils.loki_agent_logger import logger

# Edge TTS Voice options
EDGE_TTS_VOICES = {
    "ana": "en-US-AnaNeural",          # Young female (default for kids)
    "aria": "en-US-AriaNeural",        # Female
    "jenny": "en-US-JennyNeural",      # Female
    "guy": "en-US-GuyNeural",          # Male
    "sara": "en-US-SaraNeural",        # Female
    "emma": "en-GB-SoniaNeural",       # British female
    "ryan": "en-GB-RyanNeural",        # British male
    # Hindi voices
    "swara": "hi-IN-SwaraNeural",      # Hindi female
    "madhur": "hi-IN-MadhurNeural",    # Hindi male
}

# Default settings from environment
DEFAULT_VOICE = os.getenv("EDGE_TTS_VOICE", "en-US-AnaNeural")
DEFAULT_RATE = os.getenv("EDGE_TTS_RATE", "+0%")
DEFAULT_VOLUME = os.getenv("EDGE_TTS_VOLUME", "+0%")
DEFAULT_PITCH = os.getenv("EDGE_TTS_PITCH", "+0Hz")


class EdgeTTSService:
    """Service for generating TTS audio using Microsoft Edge TTS"""

    def __init__(self):
        self.voice = DEFAULT_VOICE
        self.rate = DEFAULT_RATE
        self.volume = DEFAULT_VOLUME
        self.pitch = DEFAULT_PITCH
        logger.info(f"🎤 Edge TTS initialized with voice: {self.voice}")

    def set_voice(self, voice_name: str):
        """Set voice by name or full voice ID"""
        if voice_name.lower() in EDGE_TTS_VOICES:
            self.voice = EDGE_TTS_VOICES[voice_name.lower()]
            logger.info(f"🎤 Edge TTS voice set to: {voice_name} ({self.voice})")
        else:
            # Assume it's a full voice ID directly
            self.voice = voice_name
            logger.info(f"🎤 Edge TTS voice ID set to: {voice_name}")

    async def generate_speech(
        self,
        text: str,
        voice: Optional[str] = None,
        rate: Optional[str] = None,
        volume: Optional[str] = None,
        pitch: Optional[str] = None,
    ) -> Tuple[Optional[bytes], Optional[str]]:
        """
        Generate speech audio from text using Edge TTS

        Args:
            text: Text to convert to speech
            voice: Voice name or ID (optional, uses default if not specified)
            rate: Speech rate (e.g., "+10%", "-20%")
            volume: Volume (e.g., "+0%")
            pitch: Pitch (e.g., "+0Hz")

        Returns:
            Tuple of (audio_bytes, error_message)
        """
        try:
            import edge_tts
        except ImportError:
            return None, "edge-tts package not installed. Run: pip install edge-tts"

        # Resolve voice
        use_voice = voice if voice else self.voice
        if voice and voice.lower() in EDGE_TTS_VOICES:
            use_voice = EDGE_TTS_VOICES[voice.lower()]

        use_rate = rate if rate else self.rate
        use_volume = volume if volume else self.volume
        use_pitch = pitch if pitch else self.pitch

        try:
            logger.info(f"🎵 Generating Edge TTS for {len(text)} chars with voice {use_voice}")

            # Create communicate instance
            communicate = edge_tts.Communicate(
                text=text,
                voice=use_voice,
                rate=use_rate,
                volume=use_volume,
                pitch=use_pitch,
            )

            # Generate audio to temporary file
            with tempfile.NamedTemporaryFile(suffix=".mp3", delete=False) as tmp_file:
                tmp_path = tmp_file.name

            try:
                await communicate.save(tmp_path)

                # Read audio bytes
                audio_data = Path(tmp_path).read_bytes()
                logger.info(f"✅ Edge TTS generated: {len(audio_data)} bytes")
                return audio_data, None

            finally:
                # Cleanup temp file
                try:
                    Path(tmp_path).unlink()
                except Exception:
                    pass

        except Exception as e:
            error_msg = f"Edge TTS error: {str(e)}"
            logger.error(f"❌ {error_msg}")
            return None, error_msg

    async def generate_rhyme_speech(
        self, rhyme_text: str, title: str = ""
    ) -> Tuple[Optional[bytes], Optional[str]]:
        """
        Generate speech for a nursery rhyme with optimized settings

        Args:
            rhyme_text: The rhyme lyrics to speak
            title: Optional title for logging

        Returns:
            Tuple of (audio_bytes, error_message)
        """
        # Use slightly slower rate for rhymes (easier for kids to follow)
        return await self.generate_speech(
            text=rhyme_text,
            rate="-5%",  # Slightly slower for clarity
        )


# Singleton instance
_edge_tts_service: Optional[EdgeTTSService] = None


def get_edge_tts_service() -> EdgeTTSService:
    """Get or create the Edge TTS service singleton"""
    global _edge_tts_service
    if _edge_tts_service is None:
        _edge_tts_service = EdgeTTSService()
    return _edge_tts_service
