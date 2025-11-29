"""
Silero VAD 6.2.0 Provider for LiveKit
Wraps standalone silero-vad package to be compatible with LiveKit's VAD interface
"""

import os
os.environ["NNPACK_DISABLE"] = "1"

import asyncio
import logging
import time
from typing import Literal

# Suppress NNPACK C++ warnings during torch import
import sys
import io
_stderr = sys.stderr
sys.stderr = io.StringIO()
try:
    import torch
finally:
    sys.stderr = _stderr

import numpy as np

from livekit import rtc
from livekit.agents import vad

logger = logging.getLogger(__name__)


class SileroVAD(vad.VAD):
    """
    Silero Voice Activity Detection (VAD) wrapper for LiveKit.

    Uses the standalone silero-vad package (version 6.2.0+) instead of the LiveKit plugin.
    """

    @classmethod
    def load(
        cls,
        *,
        min_speech_duration: float = 0.05,
        min_silence_duration: float = 0.3,
        prefix_padding_duration: float = 0.5,
        max_buffered_speech: float = 60.0,
        activation_threshold: float = 0.5,
        sample_rate: Literal[8000, 16000] = 16000,
        onnx: bool = True,
    ) -> "SileroVAD":
        """
        Load and initialize the Silero VAD model.

        Args:
            min_speech_duration: Minimum duration of speech to start a new speech chunk (seconds)
            min_silence_duration: Wait this duration before ending speech (seconds)
            prefix_padding_duration: Duration of padding to add to beginning of speech (seconds)
            max_buffered_speech: Maximum duration of speech to keep in buffer (seconds)
            activation_threshold: Threshold to consider a frame as speech (0.0-1.0)
            sample_rate: Audio sample rate (8000 or 16000 Hz)
            onnx: Whether to use ONNX model (default True, faster inference)

        Returns:
            Initialized SileroVAD instance
        """
        logger.info("[Silero VAD 6.2] Loading Silero VAD model...")

        try:
            from silero_vad import load_silero_vad, VADIterator
        except ImportError:
            logger.error(
                "[Silero VAD 6.2] silero-vad not installed. Install with: "
                "pip install silero-vad==6.2.0"
            )
            raise

        # Load the Silero VAD model
        model = load_silero_vad(onnx=onnx)
        logger.info(f"[Silero VAD 6.2] Model loaded successfully (onnx={onnx})")

        return cls(
            model=model,
            min_speech_duration=min_speech_duration,
            min_silence_duration=min_silence_duration,
            prefix_padding_duration=prefix_padding_duration,
            max_buffered_speech=max_buffered_speech,
            activation_threshold=activation_threshold,
            sample_rate=sample_rate,
        )

    def __init__(
        self,
        *,
        model,
        min_speech_duration: float,
        min_silence_duration: float,
        prefix_padding_duration: float,
        max_buffered_speech: float,
        activation_threshold: float,
        sample_rate: int,
    ) -> None:
        # Silero VAD window size: 512 samples for 16kHz, 256 for 8kHz
        window_size = 512 if sample_rate == 16000 else 256
        update_interval = window_size / sample_rate  # e.g., 512/16000 = 0.032s = 32ms

        super().__init__(
            capabilities=vad.VADCapabilities(
                update_interval=update_interval,
            )
        )

        self._model = model
        self._min_speech_duration = min_speech_duration
        self._min_silence_duration = min_silence_duration
        self._prefix_padding_duration = prefix_padding_duration
        self._max_buffered_speech = max_buffered_speech
        self._activation_threshold = activation_threshold
        self._sample_rate = sample_rate
        self._window_size = window_size

        logger.info(
            f"[Silero VAD 6.2] Initialized with: "
            f"threshold={activation_threshold}, "
            f"min_speech={min_speech_duration}s, "
            f"min_silence={min_silence_duration}s, "
            f"sample_rate={sample_rate}Hz, "
            f"window_size={window_size} ({update_interval*1000:.1f}ms)"
        )

    def stream(self) -> "SileroVADStream":
        """Create a new VAD stream for processing audio"""
        return SileroVADStream(
            vad=self,
            model=self._model,
            min_speech_duration=self._min_speech_duration,
            min_silence_duration=self._min_silence_duration,
            prefix_padding_duration=self._prefix_padding_duration,
            max_buffered_speech=self._max_buffered_speech,
            activation_threshold=self._activation_threshold,
            sample_rate=self._sample_rate,
            window_size=self._window_size,
        )


class SileroVADStream(vad.VADStream):
    """Stream for processing audio frames with Silero VAD 6.2.0"""

    def __init__(
        self,
        *,
        vad: SileroVAD,
        model,
        min_speech_duration: float,
        min_silence_duration: float,
        prefix_padding_duration: float,
        max_buffered_speech: float,
        activation_threshold: float,
        sample_rate: int,
        window_size: int,
    ) -> None:
        super().__init__(vad)

        self._model = model
        self._min_speech_duration = min_speech_duration
        self._min_silence_duration = min_silence_duration
        self._prefix_padding_duration = prefix_padding_duration
        self._max_buffered_speech = max_buffered_speech
        self._activation_threshold = activation_threshold
        self._sample_rate = sample_rate
        self._window_size = window_size

        # Create VADIterator for streaming processing
        try:
            from silero_vad import VADIterator
            self._vad_iterator = VADIterator(
                model,
                sampling_rate=sample_rate,
                threshold=activation_threshold,
                min_silence_duration_ms=int(min_silence_duration * 1000),
                speech_pad_ms=int(prefix_padding_duration * 1000),
            )
        except Exception as e:
            logger.warning(f"[Silero VAD 6.2] VADIterator init failed, using direct model: {e}")
            self._vad_iterator = None

        # State tracking
        self._speech_started = False
        self._speech_buffer = []
        self._prefix_buffer = []
        self._silence_duration = 0.0
        self._speech_duration = 0.0

        # Audio buffer for collecting samples
        self._audio_buffer = np.array([], dtype=np.float32)

        # Track resampling to log only once
        self._resampling_logged = False

        # Debug logging for VAD probabilities
        self._debug_log_counter = 0
        self._debug_log_interval = 30  # Log every 30 chunks (~1 second)
        self._max_prob_seen = 0.0

        # Reset model state at stream start
        self._model_state_reset = False

    async def _main_task(self) -> None:
        """Main processing loop for audio frames"""
        try:
            # Reset model state at stream start
            if not self._model_state_reset:
                try:
                    if hasattr(self._model, 'reset_states'):
                        self._model.reset_states()
                        logger.info("[Silero VAD 6.2] Model state reset at stream start")
                    self._model_state_reset = True
                except Exception as e:
                    logger.warning(f"[Silero VAD 6.2] Could not reset model state: {e}")

            async for item in self._input_ch:
                # Handle flush sentinel
                if isinstance(item, self._FlushSentinel):
                    await self._flush_speech()
                    # Reset model state on flush
                    try:
                        if hasattr(self._model, 'reset_states'):
                            self._model.reset_states()
                        if self._vad_iterator:
                            self._vad_iterator.reset_states()
                    except Exception as e:
                        logger.warning(f"[Silero VAD 6.2] Could not reset state on flush: {e}")
                    continue

                # Process audio frame
                frame: rtc.AudioFrame = item
                inference_start = time.perf_counter()

                # Convert frame to numpy array (int16) then to float32
                audio_data = np.frombuffer(frame.data, dtype=np.int16)

                # Resample if needed (Silero VAD expects 16kHz or 8kHz)
                if frame.sample_rate != self._sample_rate:
                    audio_data = self._resample_audio(audio_data, frame.sample_rate, self._sample_rate)

                # Convert to float32 normalized [-1, 1] for Silero VAD
                audio_float = audio_data.astype(np.float32) / 32768.0

                # Add to buffer for processing
                self._audio_buffer = np.concatenate([self._audio_buffer, audio_float])

                # Process in chunks of window_size
                while len(self._audio_buffer) >= self._window_size:
                    chunk = self._audio_buffer[:self._window_size]
                    self._audio_buffer = self._audio_buffer[self._window_size:]

                    # Store int16 version for speech buffer
                    chunk_int16 = (chunk * 32768.0).astype(np.int16)

                    # Run Silero VAD inference
                    try:
                        chunk_tensor = torch.from_numpy(chunk)
                        probability = self._model(chunk_tensor, self._sample_rate).item()
                    except Exception as e:
                        logger.error(f"[Silero VAD 6.2] Prediction error: {e}")
                        probability = 0.0

                    # Debug logging - track max probability and log periodically
                    self._max_prob_seen = max(self._max_prob_seen, probability)
                    self._debug_log_counter += 1
                    if self._debug_log_counter >= self._debug_log_interval:
                        # Calculate audio level (RMS)
                        rms = np.sqrt(np.mean(chunk ** 2))
                        logger.info(
                            f"[Silero VAD 6.2] DEBUG: prob={probability:.3f}, "
                            f"max_prob={self._max_prob_seen:.3f}, threshold={self._activation_threshold}, "
                            f"rms={rms:.4f}, speech_started={self._speech_started}"
                        )
                        self._debug_log_counter = 0
                        self._max_prob_seen = 0.0

                    # Determine if speech is active
                    is_speech = probability >= self._activation_threshold

                    # Calculate frame duration
                    frame_duration = self._window_size / self._sample_rate

                    # Update prefix buffer (for padding before speech)
                    self._prefix_buffer.append(chunk_int16)
                    prefix_duration = len(self._prefix_buffer) * frame_duration
                    if prefix_duration > self._prefix_padding_duration:
                        self._prefix_buffer.pop(0)

                    # Process speech state
                    if is_speech:
                        # Accumulate speech
                        self._speech_buffer.append(chunk_int16)
                        self._speech_duration += frame_duration
                        self._silence_duration = 0.0

                        # Check if we should start speech detection
                        if not self._speech_started and self._speech_duration >= self._min_speech_duration:
                            self._speech_started = True

                            # Add prefix padding at the START
                            self._speech_buffer = list(self._prefix_buffer) + self._speech_buffer

                            # Emit START_OF_SPEECH event
                            start_event = vad.VADEvent(
                                type=vad.VADEventType.START_OF_SPEECH,
                                samples_index=0,
                                timestamp=time.time(),
                                speech_duration=self._speech_duration,
                                silence_duration=0.0,
                                probability=probability,
                                inference_duration=time.perf_counter() - inference_start,
                            )
                            self._event_ch.send_nowait(start_event)
                            logger.info(f"[Silero VAD 6.2] START_OF_SPEECH (duration={self._speech_duration:.3f}s)")

                    else:
                        # Silence detected
                        if self._speech_started:
                            self._silence_duration += frame_duration
                            self._speech_buffer.append(chunk_int16)  # Include trailing silence

                            # Check if silence duration exceeds threshold
                            if self._silence_duration >= self._min_silence_duration:
                                # End of speech
                                await self._emit_speech_chunk()
                        else:
                            # Not in speech yet - reset accumulated speech if any
                            if self._speech_duration > 0:
                                self._speech_duration = 0.0
                                self._speech_buffer = []

                    # Emit inference done event
                    inference_event = vad.VADEvent(
                        type=vad.VADEventType.INFERENCE_DONE,
                        samples_index=0,
                        timestamp=time.time(),
                        speech_duration=self._speech_duration,
                        silence_duration=self._silence_duration,
                        probability=probability,
                        inference_duration=time.perf_counter() - inference_start,
                    )
                    self._event_ch.send_nowait(inference_event)

            # End of input - flush remaining speech
            await self._flush_speech()

        except Exception as e:
            logger.error(f"[Silero VAD 6.2] Error in main task: {e}", exc_info=True)
            raise

    async def _emit_speech_chunk(self) -> None:
        """Emit a complete speech chunk"""
        if not self._speech_buffer:
            return

        # Concatenate all speech frames
        speech_array = np.concatenate(self._speech_buffer)

        # Create audio frame
        speech_frame = rtc.AudioFrame(
            data=speech_array.tobytes(),
            sample_rate=self._sample_rate,
            num_channels=1,
            samples_per_channel=len(speech_array),
        )

        # Emit END_OF_SPEECH event with the speech data
        end_event = vad.VADEvent(
            type=vad.VADEventType.END_OF_SPEECH,
            samples_index=0,
            timestamp=time.time(),
            speech_duration=self._speech_duration,
            silence_duration=self._silence_duration,
            frames=[speech_frame],
            probability=1.0,
            inference_duration=0.0,
        )
        self._event_ch.send_nowait(end_event)

        logger.info(
            f"[Silero VAD 6.2] END_OF_SPEECH: duration={self._speech_duration:.2f}s, "
            f"samples={len(speech_array)}, "
            f"sample_rate={self._sample_rate}Hz"
        )

        # Reset state
        self._speech_started = False
        self._speech_buffer = []
        self._speech_duration = 0.0
        self._silence_duration = 0.0

    async def _flush_speech(self) -> None:
        """Flush any remaining speech in the buffer"""
        if self._speech_started and self._speech_buffer:
            await self._emit_speech_chunk()

    def _resample_audio(self, audio: np.ndarray, from_rate: int, to_rate: int) -> np.ndarray:
        """Resample audio from one sample rate to another"""
        if from_rate == to_rate:
            return audio

        # Log resampling only once
        if not self._resampling_logged:
            logger.info(f"[Silero VAD 6.2] Resampling audio: {from_rate}Hz -> {to_rate}Hz")
            self._resampling_logged = True

        try:
            from scipy import signal
            num_samples = int(len(audio) * to_rate / from_rate)
            resampled = signal.resample(audio, num_samples).astype(np.int16)
            return resampled
        except ImportError:
            # Fallback to linear interpolation
            ratio = to_rate / from_rate
            new_length = int(len(audio) * ratio)
            indices = np.linspace(0, len(audio) - 1, new_length)
            resampled = np.interp(indices, np.arange(len(audio)), audio).astype(np.int16)
            return resampled
