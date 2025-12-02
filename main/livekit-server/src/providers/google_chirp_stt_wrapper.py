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

logger = logging.getLogger("provider_factory")


class GoogleChirpSTTWrapper(stt.STT):
    """
    Wrapper around Google Chirp STT that records audio for debugging.
    Includes mute functionality to prevent transcript processing during LLM thinking.
    """

    def __init__(
        self,
        *,
        model: str = "chirp_3",
        location: str = "asia-southeast1",
        spoken_punctuation: bool = False,
        record_audio: bool = True,
        audio_dir: str = "debug_audio",
    ) -> None:
        # Create the underlying Google STT
        self._google_stt = google.STT(
            model=model,
            location=location,
            spoken_punctuation=spoken_punctuation,
        )

        super().__init__(capabilities=self._google_stt.capabilities)

        self._record_audio = record_audio
        self._audio_dir = audio_dir
        self._location = location
        self._model = model

        # Mute state - when True, transcripts are dropped to prevent "thinking stuck" issue
        self._is_muted = False
        self._current_stream: Optional["GoogleChirpRecognizeStream"] = None

        if self._record_audio:
            os.makedirs(self._audio_dir, exist_ok=True)

        logger.info(f"[STT] GoogleChirpSTTWrapper initialized (location={location}, record_audio={record_audio})")

    def mute(self) -> None:
        """Mute STT - transcripts will be dropped"""
        self._is_muted = True
        if self._current_stream:
            self._current_stream.set_muted(True)
        logger.info("[STT] 🔇 MUTED")

    def unmute(self) -> None:
        """Unmute STT - transcripts will be processed"""
        self._is_muted = False
        if self._current_stream:
            self._current_stream.set_muted(False)
        logger.info("[STT] 🔊 UNMUTED")

    @property
    def is_muted(self) -> bool:
        return self._is_muted

    def _save_audio(self, audio_data: bytes, prefix: str = "chirp") -> str:
        """Save audio data to WAV file"""
        try:
            timestamp = datetime.now().strftime("%Y%m%d_%H%M%S_%f")
            wav_filename = os.path.join(self._audio_dir, f"{prefix}_audio_{timestamp}.wav")

            with wave.open(wav_filename, 'wb') as wav_file:
                wav_file.setnchannels(1)
                wav_file.setsampwidth(2)
                wav_file.setframerate(16000)
                wav_file.writeframes(audio_data)

            return wav_filename
        except Exception as e:
            logger.warning(f"Failed to save audio: {e}")
            return ""

    async def _recognize_impl(
        self,
        buffer: utils.AudioBuffer,
        *,
        language: str | None = None,
        conn_options: APIConnectOptions = DEFAULT_API_CONNECT_OPTIONS,
    ) -> stt.SpeechEvent:
        if self._record_audio:
            try:
                audio_bytes = self._audio_buffer_to_bytes(buffer)
                self._save_audio(audio_bytes, "chirp_recognize")
            except Exception as e:
                logger.warning(f"Failed to record audio: {e}")

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
        stream = GoogleChirpRecognizeStream(
            wrapper=self,
            google_stt=self._google_stt,
            language=language,
            conn_options=conn_options,
            record_audio=self._record_audio,
            audio_dir=self._audio_dir,
        )
        self._current_stream = stream
        if self._is_muted:
            stream.set_muted(True)
        return stream

    def _audio_buffer_to_bytes(self, buffer: utils.AudioBuffer) -> bytes:
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
    """Streaming recognition wrapper with mute functionality."""

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
        super().__init__(stt=wrapper, conn_options=conn_options)
        self._google_stt = google_stt
        self._language = language
        self._conn_options = conn_options
        self._record_audio = record_audio
        self._audio_dir = audio_dir
        self._audio_buffer = bytearray()
        self._utterance_buffer = bytearray()
        self._underlying_stream = None
        self._frame_count = 0
        self._utterance_count = 0

        # Mute state
        self._is_muted = False
        self._dropped_count = 0

    def set_muted(self, muted: bool) -> None:
        """Set mute state for transcript forwarding"""
        if self._is_muted != muted:
            self._is_muted = muted
            if not muted and self._dropped_count > 0:
                logger.info(f"[STT] 🔊 Stream unmuted (dropped {self._dropped_count} transcripts while muted)")
                self._dropped_count = 0

    async def _run(self) -> None:
        self._underlying_stream = self._google_stt.stream(
            language=self._language,
            conn_options=self._conn_options,
        )

        try:
            stream_task = asyncio.create_task(self._run_underlying_stream())

            async for frame in self._input_ch:
                if isinstance(frame, rtc.AudioFrame):
                    self._frame_count += 1
                    if self._record_audio:
                        frame_data = bytes(frame.data)
                        self._audio_buffer.extend(frame_data)
                        self._utterance_buffer.extend(frame_data)
                    self._underlying_stream.push_frame(frame)

            self._underlying_stream.end_input()

            if self._record_audio and self._utterance_buffer:
                self._save_utterance_audio("final")

            await stream_task

        except Exception as e:
            logger.error(f"[STT] Stream error: {e}")
            raise

    async def _run_underlying_stream(self) -> None:
        """Forward events, dropping all speech events when muted"""
        try:
            async for event in self._underlying_stream:
                event_type = getattr(event, 'type', None)

                # When muted, drop ALL speech events to prevent agent interruption
                if self._is_muted and event_type in (
                    stt.SpeechEventType.START_OF_SPEECH,
                    stt.SpeechEventType.INTERIM_TRANSCRIPT,
                    stt.SpeechEventType.FINAL_TRANSCRIPT,
                    stt.SpeechEventType.END_OF_SPEECH,
                ):
                    if event_type == stt.SpeechEventType.FINAL_TRANSCRIPT:
                        transcript_text = ""
                        if hasattr(event, 'alternatives') and event.alternatives:
                            transcript_text = event.alternatives[0].text or ""

                        if self._record_audio and self._utterance_buffer:
                            self._save_utterance_audio(f"MUTED_{transcript_text}")
                            self._utterance_buffer = bytearray()

                        self._dropped_count += 1
                        logger.warning(f"[STT] 🔇 DROPPED: '{transcript_text}' (#{self._dropped_count})")
                    continue

                # Forward non-muted events
                if event_type == stt.SpeechEventType.FINAL_TRANSCRIPT:
                    transcript_text = ""
                    if hasattr(event, 'alternatives') and event.alternatives:
                        transcript_text = event.alternatives[0].text or ""

                    if self._record_audio and self._utterance_buffer:
                        self._save_utterance_audio(transcript_text)
                        self._utterance_buffer = bytearray()

                    logger.info(f"[STT] 📝 Transcript: '{transcript_text}'")

                self._event_ch.send_nowait(event)

        except Exception as e:
            logger.error(f"[STT] Error forwarding events: {e}")

    def _save_utterance_audio(self, transcript: str = "") -> None:
        """Save utterance audio to WAV file"""
        try:
            self._utterance_count += 1
            timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
            clean_transcript = ''.join(c if c.isalnum() or c == ' ' else '' for c in transcript)
            clean_transcript = clean_transcript.strip().replace(' ', '_')[:30]

            if clean_transcript:
                wav_filename = os.path.join(self._audio_dir, f"chirp_{timestamp}_{self._utterance_count:03d}_{clean_transcript}.wav")
            else:
                wav_filename = os.path.join(self._audio_dir, f"chirp_{timestamp}_{self._utterance_count:03d}.wav")

            os.makedirs(self._audio_dir, exist_ok=True)

            with wave.open(wav_filename, 'wb') as wav_file:
                wav_file.setnchannels(1)
                wav_file.setsampwidth(2)
                wav_file.setframerate(16000)
                wav_file.writeframes(bytes(self._utterance_buffer))

        except Exception as e:
            logger.error(f"[STT] Failed to save audio: {e}")
