"""
FunASR STT Provider for LiveKit Agents
Implements streaming STT using FunASR WebSocket server with 2-pass mode.
"""

import asyncio
import logging
import re
import uuid
from dataclasses import dataclass
from typing import Optional

import numpy as np

from livekit import rtc
from livekit.agents import stt, utils
from livekit.agents.types import (
    DEFAULT_API_CONNECT_OPTIONS,
    APIConnectOptions,
)

from .funasr_ws_client import FunASRConfig, FunASRWebSocketClient, FunASRResponse

logger = logging.getLogger(__name__)


def resample_audio(audio_data: bytes, from_rate: int, to_rate: int) -> bytes:
    """
    Resample audio from one sample rate to another.

    Args:
        audio_data: Raw PCM audio bytes (16-bit signed, mono)
        from_rate: Source sample rate (e.g., 48000)
        to_rate: Target sample rate (e.g., 16000)

    Returns:
        Resampled PCM audio bytes
    """
    if from_rate == to_rate:
        return audio_data

    # Convert bytes to numpy array (16-bit signed integers)
    audio_array = np.frombuffer(audio_data, dtype=np.int16)

    # Calculate the resampling ratio and new length
    ratio = to_rate / from_rate
    new_length = int(len(audio_array) * ratio)

    if new_length == 0:
        return b''

    try:
        # Try scipy for high-quality resampling
        from scipy import signal
        resampled = signal.resample(audio_array, new_length).astype(np.int16)
        logger.debug(f"Resampled audio from {from_rate}Hz to {to_rate}Hz using scipy ({len(audio_array)} -> {len(resampled)} samples)")
    except ImportError:
        # Fallback to linear interpolation
        indices = np.linspace(0, len(audio_array) - 1, new_length)
        resampled = np.interp(indices, np.arange(len(audio_array)), audio_array).astype(np.int16)
        logger.debug(f"Resampled audio from {from_rate}Hz to {to_rate}Hz using linear interp ({len(audio_array)} -> {len(resampled)} samples)")

    return resampled.tobytes()

# Pattern to match SenseVoice special tokens like <|en|>, <|nospeech|>, <|EMO_UNKNOWN|>, etc.
SENSEVOICE_TOKEN_PATTERN = re.compile(r'<\|[^|]+\|>')

# Pattern to keep only English text (ASCII letters, numbers, punctuation, spaces)
ENGLISH_ONLY_PATTERN = re.compile(r'[^a-zA-Z0-9\s\.,!?\'";\:\-\(\)\[\]\{\}@#\$%\^&\*\+=/\\<>~`]+')


def clean_sensevoice_text(text: str, language: str = "en") -> str:
    """
    Clean SenseVoice model output by removing special tokens and non-target language chars.

    SenseVoice returns tokens like:
    - <|en|>, <|zh|>, <|ja|>, <|ko|>, <|yue|> - language tags
    - <|nospeech|> - no speech detected
    - <|EMO_UNKNOWN|>, <|HAPPY|>, <|SAD|>, etc. - emotion tags
    - <|Event_UNK|>, <|Speech|>, <|Music|>, etc. - event tags
    - <|woitn|>, <|itn|> - ITN control tags
    """
    if not text:
        return ""

    # Remove all <|xxx|> tokens
    cleaned = SENSEVOICE_TOKEN_PATTERN.sub('', text)

    # For English, remove non-ASCII characters (Japanese, Chinese, etc.)
    if language.lower() in ["en", "english"]:
        cleaned = ENGLISH_ONLY_PATTERN.sub('', cleaned)

    # Clean up whitespace
    cleaned = ' '.join(cleaned.split())  # Normalize whitespace
    cleaned = cleaned.strip()

    return cleaned


@dataclass
class FunASRSTTOptions:
    """Options for FunASR STT configuration"""
    host: str
    port: int
    use_ssl: bool
    mode: str
    language: str
    use_itn: bool
    sample_rate: int
    hotwords: str


class FunASRSTT(stt.STT):
    """
    FunASR Speech-to-Text provider for LiveKit Agents.

    Uses FunASR WebSocket server for speech recognition.
    Supports streaming (2-pass/online) and non-streaming (offline) modes.
    """

    def __init__(
        self,
        *,
        host: str = "64.227.121.147",
        port: int = 10096,
        use_ssl: bool = False,
        mode: str = "2pass",
        language: str = "en",
        use_itn: bool = True,
        sample_rate: int = 16000,
        hotwords: str = "",
    ) -> None:
        """
        Initialize FunASR STT provider.

        Args:
            host: FunASR server host
            port: FunASR server port (default 10096)
            use_ssl: Use WSS instead of WS
            mode: Recognition mode - "offline", "online", or "2pass"
            language: Language code (en, zh, etc.)
            use_itn: Enable Inverse Text Normalization
            sample_rate: Audio sample rate (must be 16000)
            hotwords: Hotword string for improved recognition
        """
        # FunASR with 2pass mode supports streaming with interim results
        # Offline mode requires non-streaming (VAD-buffered) recognition
        super().__init__(
            capabilities=stt.STTCapabilities(
                streaming=(mode != "offline"),
                interim_results=(mode in ["online", "2pass"]),
            )
        )

        self._opts = FunASRSTTOptions(
            host=host,
            port=port,
            use_ssl=use_ssl,
            mode=mode,
            language=language,
            use_itn=use_itn,
            sample_rate=sample_rate,
            hotwords=hotwords,
        )

        logger.info(f"FunASR STT initialized: {host}:{port}, mode={mode}, lang={language}")

    def _create_client_config(self) -> FunASRConfig:
        """Create FunASR client configuration"""
        return FunASRConfig(
            host=self._opts.host,
            port=self._opts.port,
            use_ssl=self._opts.use_ssl,
            mode=self._opts.mode,
            sample_rate=self._opts.sample_rate,
            use_itn=self._opts.use_itn,
            hotwords=self._opts.hotwords,
            language=self._opts.language,
        )

    async def _recognize_impl(
        self,
        buffer: utils.AudioBuffer,
        *,
        language: str | None = None,
        conn_options: APIConnectOptions = DEFAULT_API_CONNECT_OPTIONS,
    ) -> stt.SpeechEvent:
        """
        Recognize speech from audio buffer (non-streaming).

        Sends entire audio buffer to FunASR and waits for final result.
        """
        request_id = str(uuid.uuid4())[:8]

        # Create temporary client for this recognition
        config = self._create_client_config()
        config.mode = "offline"  # Use offline mode for single-shot
        client = FunASRWebSocketClient(config)

        try:
            await client.connect()

            # Convert AudioBuffer to bytes
            audio_data = self._audio_buffer_to_bytes(buffer)
            
            # Save audio as WAV file for debugging
            try:
                import wave
                import os
                from datetime import datetime
                
                # Create debug directory if it doesn't exist
                debug_dir = "debug_audio"
                if not os.path.exists(debug_dir):
                    os.makedirs(debug_dir)
                
                # Generate filename with timestamp
                timestamp = datetime.now().strftime("%Y%m%d_%H%M%S_%f")
                wav_filename = os.path.join(debug_dir, f"funasr_audio_{timestamp}.wav")
                
                # Save as WAV file (16kHz, 16-bit, mono)
                with wave.open(wav_filename, 'wb') as wav_file:
                    wav_file.setnchannels(1)  # Mono
                    wav_file.setsampwidth(2)  # 16-bit = 2 bytes
                    wav_file.setframerate(16000)  # 16kHz
                    wav_file.writeframes(audio_data)
                
                logger.info(f"Saved audio to: {wav_filename} ({len(audio_data)} bytes)")
            except Exception as e:
                logger.warning(f"Failed to save audio file: {e}")
            
            logger.info(f"Sending complete audio buffer to FunASR: {len(audio_data)} bytes")

            # For offline mode, send entire audio at once for best accuracy
            # This matches how FunASR processes WAV files
            await client.send_audio(audio_data)
            
            # Small delay to ensure data is sent
            await asyncio.sleep(0.001)

            # Signal end of stream
            await client.end_stream()

            # Wait for final response
            final_text = ""
            timeout_duration = conn_options.timeout if hasattr(conn_options, 'timeout') and conn_options.timeout else 30.0
            start_time = asyncio.get_event_loop().time()

            target_lang = language or self._opts.language
            while asyncio.get_event_loop().time() - start_time < timeout_duration:
                response = await client.get_response(timeout=0.5)
                if response:
                    cleaned = clean_sensevoice_text(response.text, target_lang)
                    if not cleaned and response.text:
                        logger.debug(f"Filtered out non-English/hallucinated text: {response.text}")

                    if response.is_final or response.mode == "offline":
                        final_text = cleaned
                        break
                    elif cleaned:
                        final_text = cleaned

            return stt.SpeechEvent(
                type=stt.SpeechEventType.FINAL_TRANSCRIPT,
                request_id=request_id,
                alternatives=[
                    stt.SpeechData(
                        language=language or self._opts.language,
                        text=final_text,
                        confidence=1.0,
                    )
                ],
            )

        except Exception as e:
            logger.error(f"FunASR recognition error: {e}")
            raise
        finally:
            await client.close()

    def stream(
        self,
        *,
        language: str | None = None,
        conn_options: APIConnectOptions = DEFAULT_API_CONNECT_OPTIONS,
    ) -> "FunASRRecognizeStream":
        """Create a streaming recognition session"""
        return FunASRRecognizeStream(
            stt=self,
            config=self._create_client_config(),
            language=language if language else self._opts.language,
            conn_options=conn_options,
        )

    def _audio_buffer_to_bytes(self, buffer: utils.AudioBuffer) -> bytes:
        """Convert LiveKit AudioBuffer to raw PCM bytes, resampling if needed"""
        target_sample_rate = self._opts.sample_rate  # FunASR expects 16kHz
        audio_bytes = b''
        source_sample_rate = None

        if hasattr(buffer, 'data'):
            # Single frame with data attribute
            audio_bytes = bytes(buffer.data)
            source_sample_rate = getattr(buffer, 'sample_rate', target_sample_rate)
        elif isinstance(buffer, (bytes, bytearray)):
            # Raw bytes - assume target sample rate
            audio_bytes = bytes(buffer)
            source_sample_rate = target_sample_rate
        elif hasattr(buffer, '__iter__'):
            # List of frames - merge them
            try:
                merged = utils.merge_frames(buffer)
                audio_bytes = bytes(merged.data)
                source_sample_rate = getattr(merged, 'sample_rate', target_sample_rate)
            except Exception:
                # Fallback: concatenate frame data
                result = b''
                for frame in buffer:
                    if hasattr(frame, 'data'):
                        frame_bytes = bytes(frame.data)
                        frame_rate = getattr(frame, 'sample_rate', target_sample_rate)
                        # Resample individual frames if needed
                        if frame_rate != target_sample_rate:
                            frame_bytes = resample_audio(frame_bytes, frame_rate, target_sample_rate)
                        result += frame_bytes
                return result
        else:
            raise ValueError(f"Unsupported buffer type: {type(buffer)}")

        # Resample if source sample rate differs from target
        if source_sample_rate and source_sample_rate != target_sample_rate:
            logger.info(f"Resampling audio buffer from {source_sample_rate}Hz to {target_sample_rate}Hz")
            audio_bytes = resample_audio(audio_bytes, source_sample_rate, target_sample_rate)

        return audio_bytes


class FunASRRecognizeStream(stt.RecognizeStream):
    """
    Streaming recognition using FunASR WebSocket.

    Handles 2-pass mode with interim (online) and final (offline) results.
    """

    def __init__(
        self,
        *,
        stt: FunASRSTT,
        config: FunASRConfig,
        language: str,
        conn_options: APIConnectOptions,
    ) -> None:
        super().__init__(
            stt=stt,
            conn_options=conn_options,
        )
        self._config = config
        self._language = language
        self._client: Optional[FunASRWebSocketClient] = None
        self._request_id = str(uuid.uuid4())[:8]
        self._speech_started = False
        self._closed = False

        # Audio buffering for proper chunk sizes
        # FunASR expects chunks based on: stride = 60 * chunk_size[1] / chunk_interval / 1000 * sample_rate * 2
        # For chunk_size=[0, 10, 5], chunk_interval=10, 16kHz: stride = 60 * 10 / 10 / 1000 * 16000 * 2 = 1920 bytes
        chunk_size = config.chunk_size[1] if len(config.chunk_size) > 1 else 10
        self._chunk_stride = int(60 * chunk_size / config.chunk_interval / 1000 * config.sample_rate * 2)
        self._audio_buffer = bytearray()
        logger.debug(f"FunASR chunk stride: {self._chunk_stride} bytes")

    async def _run(self) -> None:
        """Main streaming loop"""
        self._client = FunASRWebSocketClient(self._config)

        try:
            await self._client.connect()

            # Create tasks for input and output
            input_task = asyncio.create_task(self._process_input())
            output_task = asyncio.create_task(self._process_output())

            # Wait for either task to complete (input completes when stream closes)
            done, pending = await asyncio.wait(
                [input_task, output_task],
                return_when=asyncio.FIRST_COMPLETED
            )

            # Cancel remaining tasks
            for task in pending:
                task.cancel()
                try:
                    await task
                except asyncio.CancelledError:
                    pass

        except Exception as e:
            logger.error(f"FunASR stream error: {e}")
            raise
        finally:
            self._closed = True
            if self._client:
                await self._client.close()

    async def _process_input(self) -> None:
        """Process incoming audio frames and send to FunASR with proper chunking"""
        target_sample_rate = self._config.sample_rate  # FunASR expects 16kHz
        frame_count = 0

        try:
            async for frame in self._input_ch:
                if self._closed:
                    break

                if isinstance(frame, rtc.AudioFrame):
                    # Get audio bytes from frame
                    audio_bytes = bytes(frame.data)
                    frame_sample_rate = frame.sample_rate

                    # Log sample rate on first frame for debugging
                    frame_count += 1
                    if frame_count == 1:
                        logger.info(f"FunASR receiving audio: frame_rate={frame_sample_rate}Hz, target_rate={target_sample_rate}Hz, channels={frame.num_channels}")

                    # Resample if frame sample rate doesn't match FunASR's expected rate
                    if frame_sample_rate != target_sample_rate:
                        audio_bytes = resample_audio(audio_bytes, frame_sample_rate, target_sample_rate)

                    # Buffer audio frames
                    self._audio_buffer.extend(audio_bytes)

                    # Send chunks when buffer has enough data
                    while len(self._audio_buffer) >= self._chunk_stride:
                        if self._client and self._client.is_connected:
                            chunk = bytes(self._audio_buffer[:self._chunk_stride])
                            self._audio_buffer = self._audio_buffer[self._chunk_stride:]
                            await self._client.send_audio(chunk)
                            # Small delay to simulate real-time streaming (like original client)
                            await asyncio.sleep(0.04)  # ~40ms between chunks

            # Send remaining buffer
            if self._audio_buffer and self._client and self._client.is_connected:
                await self._client.send_audio(bytes(self._audio_buffer))
                self._audio_buffer.clear()

            # Input channel closed - signal end of stream
            if self._client and self._client.is_connected:
                await self._client.end_stream()
                # Wait for final results
                await asyncio.sleep(1.0)

        except asyncio.CancelledError:
            logger.debug("FunASR input processing cancelled")
        except Exception as e:
            logger.error(f"FunASR input processing error: {e}")

    async def _process_output(self) -> None:
        """Process responses from FunASR and emit events"""
        try:
            while not self._closed:
                if not self._client or not self._client.is_connected:
                    await asyncio.sleep(0.1)
                    continue

                response = await self._client.get_response(timeout=0.1)
                if not response:
                    continue

                # Handle response based on mode
                await self._handle_response(response)

        except asyncio.CancelledError:
            logger.debug("FunASR output processing cancelled")
        except Exception as e:
            logger.error(f"FunASR output processing error: {e}")

    async def _handle_response(self, response: FunASRResponse) -> None:
        """Handle a single response from FunASR"""
        # Clean the text (remove SenseVoice special tokens and non-target language chars)
        cleaned_text = clean_sensevoice_text(response.text, self._language)

        if not cleaned_text and response.text:
            logger.debug(f"Filtered out non-English/hallucinated text: {response.text}")

        # Skip if no actual speech content after cleaning
        if not cleaned_text:
            return

        # Emit START_OF_SPEECH on first result with actual content
        if not self._speech_started:
            self._speech_started = True
            self._event_ch.send_nowait(
                stt.SpeechEvent(
                    type=stt.SpeechEventType.START_OF_SPEECH,
                    request_id=self._request_id,
                )
            )

        # Handle 2-pass mode responses
        if response.mode in ["online", "2pass-online"]:
            # Interim result
            self._event_ch.send_nowait(
                stt.SpeechEvent(
                    type=stt.SpeechEventType.INTERIM_TRANSCRIPT,
                    request_id=self._request_id,
                    alternatives=[
                        stt.SpeechData(
                            language=self._language,
                            text=cleaned_text,
                            confidence=0.8,
                        )
                    ],
                )
            )

        elif response.mode in ["offline", "2pass-offline"] or response.is_final:
            # Final result
            self._event_ch.send_nowait(
                stt.SpeechEvent(
                    type=stt.SpeechEventType.FINAL_TRANSCRIPT,
                    request_id=self._request_id,
                    alternatives=[
                        stt.SpeechData(
                            language=self._language,
                            text=cleaned_text,
                            confidence=1.0,
                        )
                    ],
                )
            )

            # End of speech after final transcript
            if self._speech_started:
                self._event_ch.send_nowait(
                    stt.SpeechEvent(
                        type=stt.SpeechEventType.END_OF_SPEECH,
                        request_id=self._request_id,
                    )
                )
                self._speech_started = False
                self._request_id = str(uuid.uuid4())[:8]  # New request ID for next utterance
