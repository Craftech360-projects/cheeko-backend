"""
Google Chirp STT Wrapper with Audio Recording
Wraps the LiveKit Google STT plugin to record audio for debugging.
"""

import asyncio
import logging
import os
import wave
from datetime import datetime
from typing import Optional

from livekit import rtc
from livekit.agents import stt, utils
from livekit.agents.types import (
    DEFAULT_API_CONNECT_OPTIONS,
    APIConnectOptions,
)
from livekit.plugins import google

# Use the same logger as provider_factory for consistent logging
logger = logging.getLogger("provider_factory")


class GoogleChirpSTTWrapper(stt.STT):
    """
    Wrapper around Google Chirp STT that records audio for debugging.
    """

    def __init__(
        self,
        *,
        model: str = "chirp",
        location: str = "asia-southeast1",
        spoken_punctuation: bool = False,
        record_audio: bool = True,
        audio_dir: str = "debug_audio",
    ) -> None:
        """
        Initialize Google Chirp STT wrapper.

        Args:
            model: Google STT model (default: chirp)
            location: GCP region (us-central1, europe-west4, asia-southeast1)
            spoken_punctuation: Enable spoken punctuation detection
            record_audio: Whether to record audio to files
            audio_dir: Directory to save audio files
        """
        logger.info(f"[STT] 🔧 GoogleChirpSTTWrapper.__init__ called: model={model}, location={location}, record_audio={record_audio}")

        # Create the underlying Google STT
        self._google_stt = google.STT(
            model=model,
            location=location,
            spoken_punctuation=spoken_punctuation,
        )
        logger.info(f"[STT] ✅ Underlying Google STT created")

        # Copy capabilities from underlying STT
        super().__init__(
            capabilities=self._google_stt.capabilities
        )

        self._record_audio = record_audio
        self._audio_dir = audio_dir
        self._location = location
        self._model = model
        self._model = model

        # Create audio directory if needed
        if self._record_audio:
            os.makedirs(self._audio_dir, exist_ok=True)
            logger.info(f"[STT] 📁 Audio recording directory: {os.path.abspath(self._audio_dir)}")

        logger.info(f"[STT] ✅ GoogleChirpSTTWrapper initialized: location={location}, record_audio={record_audio}, audio_dir={self._audio_dir}")

    def unmute(self) -> None:
        """Unmute the STT - call this when agent finishes speaking"""
        # No-op: we no longer mute the STT
        pass

    def _save_audio(self, audio_data: bytes, prefix: str = "chirp") -> str:
        """Save audio data to WAV file"""
        try:
            timestamp = datetime.now().strftime("%Y%m%d_%H%M%S_%f")
            wav_filename = os.path.join(self._audio_dir, f"{prefix}_audio_{timestamp}.wav")

            # Save as WAV file (16kHz, 16-bit, mono)
            with wave.open(wav_filename, 'wb') as wav_file:
                wav_file.setnchannels(1)  # Mono
                wav_file.setsampwidth(2)  # 16-bit = 2 bytes
                wav_file.setframerate(16000)  # 16kHz
                wav_file.writeframes(audio_data)

            logger.info(f"Saved audio to: {wav_filename} ({len(audio_data)} bytes)")
            return wav_filename
        except Exception as e:
            logger.warning(f"Failed to save audio file: {e}")
            return ""

    async def _recognize_impl(
        self,
        buffer: utils.AudioBuffer,
        *,
        language: str | None = None,
        conn_options: APIConnectOptions = DEFAULT_API_CONNECT_OPTIONS,
    ) -> stt.SpeechEvent:
        """
        Recognize speech from audio buffer (non-streaming).
        Records audio before passing to Google STT.
        """
        # Record audio if enabled
        if self._record_audio:
            try:
                audio_bytes = self._audio_buffer_to_bytes(buffer)
                self._save_audio(audio_bytes, "chirp_recognize")
            except Exception as e:
                logger.warning(f"Failed to record audio: {e}")

        # Delegate to underlying Google STT
        return await self._google_stt._recognize_impl(
            buffer,
            language=language,
            conn_options=conn_options,
        )

    def stream(
        self,
        *,
        language: str | None = None,
        conn_options: APIConnectOptions = DEFAULT_API_CONNECT_OPTIONS,
    ) -> "GoogleChirpRecognizeStream":
        """Create a streaming recognition session with audio recording"""
        logger.info(f"[STT] 🎤 GoogleChirpSTTWrapper.stream() called (record_audio={self._record_audio})")
        stream = GoogleChirpRecognizeStream(
            wrapper=self,
            google_stt=self._google_stt,
            language=language,
            conn_options=conn_options,
            record_audio=self._record_audio,
            audio_dir=self._audio_dir,
        )
        # Store reference for mute control
        logger.info(f"[STT] 🎤 Created GoogleChirpRecognizeStream")
        return stream

    def _audio_buffer_to_bytes(self, buffer: utils.AudioBuffer) -> bytes:
        """Convert LiveKit AudioBuffer to raw PCM bytes"""
        if hasattr(buffer, 'data'):
            return bytes(buffer.data)
        elif isinstance(buffer, (bytes, bytearray)):
            return bytes(buffer)
        elif hasattr(buffer, '__iter__'):
            try:
                merged = utils.merge_frames(buffer)
                return bytes(merged.data)
            except Exception:
                result = b''
                for frame in buffer:
                    if hasattr(frame, 'data'):
                        result += bytes(frame.data)
                return result
        else:
            raise ValueError(f"Unsupported buffer type: {type(buffer)}")


class GoogleChirpRecognizeStream(stt.RecognizeStream):
    """
    Streaming recognition wrapper that records audio.
    """

    def __init__(
        self,
        *,
        wrapper: GoogleChirpSTTWrapper,
        google_stt: google.STT,
        language: str | None,
        conn_options: APIConnectOptions,
        record_audio: bool,
        audio_dir: str,
    ) -> None:
        super().__init__(
            stt=wrapper,
            conn_options=conn_options,
        )
        self._google_stt = google_stt
        self._language = language
        self._conn_options = conn_options
        self._record_audio = record_audio
        self._audio_dir = audio_dir
        self._audio_buffer = bytearray()
        self._utterance_buffer = bytearray()  # Buffer for current utterance
        self._underlying_stream = None
        self._frame_count = 0
        self._utterance_count = 0
        self._last_transcript = ""
        self._last_transcript = ""
        logger.info(f"[STT] GoogleChirpRecognizeStream created (record_audio={record_audio})")

    def set_muted(self, muted: bool) -> None:
        """Mute/unmute transcript forwarding (call when agent starts/stops speaking)"""
        # No-op: we no longer mute the STT
        pass

    async def _run(self) -> None:
        """Main streaming loop with audio recording"""
        logger.info("[STT] GoogleChirpRecognizeStream._run() started")

        # Create the underlying Google stream
        self._underlying_stream = self._google_stt.stream(
            language=self._language,
            conn_options=self._conn_options,
        )
        logger.info("[STT] Underlying Google stream created")

        try:
            # Start the underlying stream
            stream_task = asyncio.create_task(self._run_underlying_stream())

            # Process input frames and record audio
            async for frame in self._input_ch:
                if isinstance(frame, rtc.AudioFrame):
                    self._frame_count += 1

                    # Record audio for both overall and current utterance
                    if self._record_audio:
                        frame_data = bytes(frame.data)
                        self._audio_buffer.extend(frame_data)
                        self._utterance_buffer.extend(frame_data)

                        # Log progress every 100 frames (~1 second at 10ms frames)
                        # if self._frame_count % 100 == 0:
                        #     logger.info(f"[STT] Recording progress: {self._frame_count} frames, {len(self._audio_buffer)} bytes")

                    # Forward to underlying stream
                    self._underlying_stream.push_frame(frame)

            # Input channel closed
            logger.info(f"[STT] Input channel closed after {self._frame_count} frames")
            self._underlying_stream.end_input()

            # Save any remaining audio in utterance buffer
            if self._record_audio and self._utterance_buffer:
                self._save_utterance_audio("final")

            # Wait for underlying stream to complete
            await stream_task
            logger.info(f"[STT] GoogleChirpRecognizeStream._run() completed - saved {self._utterance_count} utterances")

        except Exception as e:
            logger.error(f"[STT] Google Chirp stream error: {e}")
            import traceback
            logger.error(f"[STT] Traceback: {traceback.format_exc()}")
            raise

    async def _run_underlying_stream(self) -> None:
        """Forward events from underlying stream and save audio on final transcripts"""
        event_count = 0
        try:
            async for event in self._underlying_stream:
                event_count += 1

                # Check if this is a final transcript
                if hasattr(event, 'type') and event.type == stt.SpeechEventType.FINAL_TRANSCRIPT:
                    # Extract transcript text
                    transcript_text = ""
                    if hasattr(event, 'alternatives') and event.alternatives:
                        transcript_text = event.alternatives[0].text if event.alternatives[0].text else ""

                    # Save the utterance audio
                    if self._record_audio and self._utterance_buffer:
                        self._save_utterance_audio(transcript_text)
                        self._utterance_buffer = bytearray()

                    logger.info(f"[STT] 📝 Final transcript received: '{transcript_text[:50]}...' (saved audio)")
                    
                    # [LOGGING-INVESTIGATION] Explicitly log the transcript for investigation
                    if transcript_text:
                        logger.info(f"🔍 [INVESTIGATION] STT Final Transcript: '{transcript_text}'")
                    else:
                        logger.warning(f"🔍 [INVESTIGATION] STT Final Transcript is EMPTY")

                self._event_ch.send_nowait(event)
            logger.info(f"[STT] Forwarded {event_count} events from underlying stream")
        except Exception as e:
            logger.error(f"[STT] Error forwarding events: {e}")

    def _save_utterance_audio(self, transcript: str = "") -> None:
        """Save utterance audio to WAV file with transcript in filename"""
        try:
            self._utterance_count += 1
            timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")

            # Clean transcript for filename (first 30 chars, alphanumeric only)
            clean_transcript = ''.join(c if c.isalnum() or c == ' ' else '' for c in transcript)
            clean_transcript = clean_transcript.strip().replace(' ', '_')[:30]

            if clean_transcript:
                wav_filename = os.path.join(self._audio_dir, f"chirp_{timestamp}_{self._utterance_count:03d}_{clean_transcript}.wav")
            else:
                wav_filename = os.path.join(self._audio_dir, f"chirp_{timestamp}_{self._utterance_count:03d}.wav")

            # Ensure directory exists
            os.makedirs(self._audio_dir, exist_ok=True)

            # Calculate duration
            duration_sec = len(self._utterance_buffer) / (16000 * 2)  # 16kHz, 16-bit

            with wave.open(wav_filename, 'wb') as wav_file:
                wav_file.setnchannels(1)  # Mono
                wav_file.setsampwidth(2)  # 16-bit
                wav_file.setframerate(16000)  # 16kHz
                wav_file.writeframes(bytes(self._utterance_buffer))

            logger.info(f"[STT] ✅ Saved utterance audio: {wav_filename} ({len(self._utterance_buffer)} bytes, {duration_sec:.1f}s)")
            logger.info(f"[STT] 📝 Transcript: '{transcript}'")

        except Exception as e:
            logger.error(f"[STT] ❌ Failed to save utterance audio: {e}")
            import traceback
            logger.error(f"[STT] Traceback: {traceback.format_exc()}")

    def _save_audio(self) -> None:
        """Save full session audio to WAV file (called at end of stream)"""
        try:
            timestamp = datetime.now().strftime("%Y%m%d_%H%M%S_%f")
            wav_filename = os.path.join(self._audio_dir, f"chirp_session_{timestamp}.wav")

            # Ensure directory exists
            os.makedirs(self._audio_dir, exist_ok=True)

            with wave.open(wav_filename, 'wb') as wav_file:
                wav_file.setnchannels(1)  # Mono
                wav_file.setsampwidth(2)  # 16-bit
                wav_file.setframerate(16000)  # 16kHz
                wav_file.writeframes(bytes(self._audio_buffer))

            logger.info(f"[STT] ✅ Saved full session audio to: {wav_filename} ({len(self._audio_buffer)} bytes, {self._frame_count} frames)")
        except Exception as e:
            logger.error(f"[STT] ❌ Failed to save session audio: {e}")
            import traceback
            logger.error(f"[STT] Traceback: {traceback.format_exc()}")
