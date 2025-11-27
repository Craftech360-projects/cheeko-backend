"""
Unified Audio Player for LiveKit Agent
Plays music/stories through the agent's main TTS channel using session.say()
"""

import logging
import asyncio
import io
from typing import Optional, AsyncIterator
import aiohttp
from ..utils.audio_state_manager import audio_state_manager

try:
    from livekit import rtc
    LIVEKIT_AVAILABLE = True
except ImportError:
    LIVEKIT_AVAILABLE = False

try:
    from pydub import AudioSegment
    PYDUB_AVAILABLE = True
    # Suppress pydub's verbose DEBUG logs from ffmpeg
    logging.getLogger("pydub.converter").setLevel(logging.WARNING)
except ImportError:
    PYDUB_AVAILABLE = False

logger = logging.getLogger(__name__)

class UnifiedAudioPlayer:
    """Plays audio through the agent's main TTS channel using session.say()"""

    def __init__(self):
        self.session = None
        self.context = None
        self.current_task: Optional[asyncio.Task] = None
        self.is_playing = False
        self.stop_event = asyncio.Event()
        self.session_say_task = None
        self._playback_lock = asyncio.Lock()  # Prevent race conditions on rapid requests

    def set_session(self, session):
        """Set the LiveKit agent session"""
        self.session = session
        logger.info("Unified audio player integrated with session")

    def set_context(self, context):
        """Set the job context"""
        self.context = context
        logger.info("Unified audio player integrated with context")

    async def stop(self):
        """Stop current playback and interrupt session.say() IMMEDIATELY with FULL cancellation"""
        logger.info("🛑 UNIFIED: IMMEDIATE STOP requested")

        # Set stop event FIRST - this stops audio frame iteration immediately
        self.stop_event.set()

        # ROBUSTLY cancel and wait for session.say() task to fully terminate
        if self.session_say_task:
            try:
                logger.info("🛑 UNIFIED: Cancelling active speech handle...")

                # Method 1: Try cancel() if available
                if hasattr(self.session_say_task, 'cancel'):
                    self.session_say_task.cancel()
                    logger.info("🛑 UNIFIED: Called cancel() on speech handle")

                    # Wait for cancellation to complete with timeout
                    try:
                        await asyncio.wait_for(self.session_say_task, timeout=0.5)
                        logger.info("🛑 UNIFIED: Speech handle fully cancelled")
                    except asyncio.CancelledError:
                        logger.info("🛑 UNIFIED: Speech handle cancellation confirmed")
                    except asyncio.TimeoutError:
                        logger.warning("🛑 UNIFIED: Speech handle cancellation timeout (will force continue)")
                    except Exception as e:
                        logger.warning(f"🛑 UNIFIED: Speech handle await error (continuing anyway): {e}")

                # Method 2: Try interrupt() as fallback
                elif hasattr(self.session_say_task, 'interrupt'):
                    self.session_say_task.interrupt()
                    logger.info("🛑 UNIFIED: Called interrupt() on speech handle")

                    # Give it a moment to process the interrupt
                    await asyncio.sleep(0.1)
                else:
                    logger.warning("🛑 UNIFIED: Speech handle has no cancel() or interrupt() method")

                # Clear the reference
                self.session_say_task = None

            except Exception as e:
                logger.warning(f"🛑 UNIFIED: Error cancelling speech: {e}")
                # Force clear the reference anyway
                self.session_say_task = None

        # Cancel background task aggressively and WAIT for it
        if self.current_task and not self.current_task.done():
            logger.info("🛑 UNIFIED: Cancelling background playback task...")
            self.current_task.cancel()

            try:
                # Wait for background task to fully cancel with timeout
                await asyncio.wait_for(self.current_task, timeout=0.5)
                logger.info("🛑 UNIFIED: Background task fully cancelled")
            except asyncio.CancelledError:
                logger.info("🛑 UNIFIED: Background task cancellation confirmed")
            except asyncio.TimeoutError:
                logger.warning("🛑 UNIFIED: Background task cancellation timeout")
            except Exception as e:
                logger.warning(f"🛑 UNIFIED: Background task cancellation error: {e}")

            # Clear the reference
            self.current_task = None

        # Force clear all states immediately
        self.is_playing = False
        audio_state_manager.force_stop_music()
        logger.info("🛑 UNIFIED: IMMEDIATE stop completed - ready for new playback")

    async def play_from_url(self, url: str, title: str = "Audio"):
        """Play audio from URL through agent's TTS channel using session.say()"""
        # Use lock to prevent race conditions when multiple rapid requests arrive
        async with self._playback_lock:
            logger.info(f"🎵 UNIFIED: Acquired playback lock for: {title}")

            await self.stop()  # Stop any current playback and wait for full cancellation

            # CRITICAL: Small delay to ensure LiveKit session clears its internal audio buffer
            # Without this, old audio frames may still be in the pipeline
            await asyncio.sleep(0.2)
            logger.info(f"🎵 UNIFIED: Audio pipeline cleared, starting playback: {title}")

            logger.info(f"🎵 UNIFIED: Starting playback: {title}")
            self.is_playing = True
            self.stop_event.clear()

            # Set global music state
            audio_state_manager.set_music_playing(True, title)

            # Start playback task (non-blocking)
            self.current_task = asyncio.create_task(self._play_via_session_say(url, title))

            # Return immediately - don't wait for completion to avoid blocking the agent
            # The agent function should return empty string to avoid TTS interference
            logger.info(f"🎵 UNIFIED: Started playback task for: {title}")
            return f"Started playing {title}"

    async def _play_via_session_say(self, url: str, title: str):
        """Play audio through session.say() with audio frames"""
        try:
            if not self.session:
                logger.error("No session available for playback")
                return

            # Stream and convert audio to frames (NEW: no full download!)
            audio_frames = await self._stream_download_and_convert(url, title)

            # Fallback to full download if streaming fails
            if audio_frames is None:
                logger.warning(f"🎵 UNIFIED: Streaming failed for {title}, falling back to full download")
                audio_frames = await self._download_and_convert_to_frames_fallback(url, title)

            if audio_frames is not None:
                logger.info(f"🎵 UNIFIED: Injecting {title} into TTS queue via session.say()")

                try:
                    # Use session.say() with audio frames - NO TEXT to avoid TTS before music!
                    speech_handle = self.session.say(
                        text="",  # EMPTY TEXT - no TTS before music!
                        audio=audio_frames,  # Pre-recorded audio to play
                        allow_interruptions=True,  # Allow user to interrupt
                        add_to_chat_ctx=False  # Don't add music to chat context
                    )

                    # Store the speech handle for potential interruption
                    self.session_say_task = speech_handle

                    # Wait for the speech to complete (only if we got a valid handle)
                    if speech_handle is not None:
                        logger.info(f"🎵 UNIFIED: Waiting for {title} to complete playback...")
                        await speech_handle
                        logger.info(f"🎵 UNIFIED: {title} playback completed normally")
                    else:
                        logger.error("🎵 UNIFIED: session.say() returned None - cannot await")
                        return

                    logger.info(f"🎵 UNIFIED: Successfully completed {title} playback")

                except asyncio.CancelledError:
                    logger.info(f"🎵 UNIFIED: Playback of {title} was cancelled (interrupted by new request)")
                    # Re-raise to propagate cancellation
                    raise
                except Exception as e:
                    logger.error(f"🎵 UNIFIED: Error during playback of {title}: {e}")
                    raise
            else:
                logger.error(f"🎵 UNIFIED: No audio frames available for {title} - cannot play")
                return

        except asyncio.CancelledError:
            logger.info(f"🎵 UNIFIED: Playback cancelled: {title}")
            raise
        except Exception as e:
            logger.error(f"🎵 UNIFIED: Error playing audio: {e}")
        finally:
            self.is_playing = False
            # Force clear music state to allow listening state transitions
            audio_state_manager.force_stop_music()
            logger.info(f"🎵 UNIFIED: Finished playing: {title}")

            # Send music end signal via data channel FIRST (most important!)
            await self._send_music_end_signal()

            # Send agent state change to listening mode (like normal TTS does)
            await self._send_agent_state_to_listening()

            # NOTE: Removed completion message to prevent race condition
            # The completion message was causing the agent to go back to "speaking" state
            # which could trap the system if the state change gets suppressed

    async def _stream_download_and_convert(self, url: str, title: str) -> Optional[AsyncIterator[rtc.AudioFrame]]:
        """Stream audio chunks and convert to frames on-the-fly (OPTIMIZED: no full download!)"""
        try:
            logger.info(f"🎵 UNIFIED: Starting streaming for {title} from {url}")

            # Use longer timeout for streaming
            timeout = aiohttp.ClientTimeout(total=None)  # No timeout for streaming
            headers = {
                'User-Agent': 'LiveKit-Agent/1.0',
                'Accept': 'audio/mpeg, audio/*',
            }

            session = aiohttp.ClientSession(timeout=timeout)
            response = None
            
            try:
                response = await session.get(url, headers=headers)
                
                # Check if response is valid
                if response is None:
                    logger.error("Failed to get response from URL")
                    await session.close()
                    return None

                if response.status == 403 and 'cloudfront' in url:
                    # Try S3 fallback
                    close_result = response.close()
                    if close_result is not None and asyncio.iscoroutine(close_result):
                        await close_result
                    
                    s3_url = url.replace('dbtnllz9fcr1z.cloudfront.net', 'cheeko-audio-files.s3.us-east-1.amazonaws.com')
                    logger.warning("Trying S3 fallback URL for streaming")
                    response = await session.get(s3_url, headers=headers)
                    
                    # Check fallback response
                    if response is None:
                        logger.error("Failed to get S3 fallback response")
                        await session.close()
                        return None

                if response.status != 200:
                    logger.error(f"Streaming failed: HTTP {response.status}")
                    close_result = response.close()
                    if close_result is not None and asyncio.iscoroutine(close_result):
                        await close_result
                    await session.close()
                    return None

                # Get content length for progress tracking
                content_length = response.headers.get('Content-Length')
                logger.info(f"🎵 UNIFIED: Streaming {content_length or 'unknown'} bytes")

                # Return streaming audio iterator (NEW: no full download!)
                if PYDUB_AVAILABLE and LIVEKIT_AVAILABLE:
                    return StreamingAudioIterator(response, session, self.stop_event, title)
                else:
                    logger.error("Required libraries not available for audio conversion")
                    close_result = response.close()
                    if close_result is not None and asyncio.iscoroutine(close_result):
                        await close_result
                    await session.close()
                    return None

            except Exception as e:
                # Clean up on error
                if response is not None:
                    try:
                        close_result = response.close()
                        if close_result is not None and asyncio.iscoroutine(close_result):
                            await close_result
                    except Exception:
                        pass
                        
                try:
                    await session.close()
                except Exception:
                    pass
                raise e

        except Exception as e:
            logger.error(f"🎵 UNIFIED: Error starting stream: {e}")
            return None

    async def _download_and_convert_to_frames_fallback(self, url: str, title: str) -> Optional[AsyncIterator[rtc.AudioFrame]]:
        """LEGACY: Download full audio and convert to AudioFrame iterator (kept for fallback)"""
        try:
            logger.info(f"🎵 UNIFIED: FALLBACK - Downloading {title} from {url}")

            # Download audio
            timeout = aiohttp.ClientTimeout(total=30)
            headers = {
                'User-Agent': 'LiveKit-Agent/1.0',
                'Accept': 'audio/mpeg, audio/*',
            }

            async with aiohttp.ClientSession(timeout=timeout) as session:
                async with session.get(url, headers=headers) as response:
                    if response.status == 403 and 'cloudfront' in url:
                        # Try S3 fallback
                        s3_url = url.replace('dbtnllz9fcr1z.cloudfront.net', 'cheeko-audio-files.s3.us-east-1.amazonaws.com')
                        logger.warning("Trying S3 fallback URL")
                        async with session.get(s3_url, headers=headers) as s3_response:
                            if s3_response.status == 200:
                                audio_data = await s3_response.read()
                            else:
                                logger.error(f"Download failed: HTTP {s3_response.status}")
                                return None
                    elif response.status == 200:
                        audio_data = await response.read()
                    else:
                        logger.error(f"Download failed: HTTP {response.status}")
                        return None

            logger.info(f"🎵 UNIFIED: Downloaded {len(audio_data)} bytes")

            # Convert to audio frames
            if PYDUB_AVAILABLE and LIVEKIT_AVAILABLE:
                return await self._create_frame_iterator(audio_data)
            else:
                logger.error("Required libraries not available for audio conversion")
                return None

        except Exception as e:
            logger.error(f"🎵 UNIFIED: Error downloading/converting: {e}")
            return None

    async def _create_frame_iterator(self, audio_data: bytes):
        """Create an async iterator of AudioFrames from audio data for session.say()"""
        try:
            # Convert MP3 to PCM using pydub
            audio_segment = AudioSegment.from_mp3(io.BytesIO(audio_data))

            # Convert to 48kHz mono for LiveKit
            audio_segment = audio_segment.set_frame_rate(48000)
            audio_segment = audio_segment.set_channels(1)
            audio_segment = audio_segment.set_sample_width(2)

            raw_audio = audio_segment.raw_data
            sample_rate = 48000
            frame_duration_ms = 20
            samples_per_frame = sample_rate * frame_duration_ms // 1000

            logger.info(f"🎵 UNIFIED: Created audio frames for {len(raw_audio)} bytes")

            # Return an async iterator
            return AudioFrameIterator(raw_audio, sample_rate, samples_per_frame, self.stop_event)

        except Exception as e:
            logger.error(f"🎵 UNIFIED: Error creating frames: {e}")
            return None

    async def _send_music_end_signal(self):
        """Send music end signal via data channel"""
        try:
            if self.context and hasattr(self.context, 'room'):
                import json
                music_end_data = {
                    "type": "music_playback_stopped"
                }
                await self.context.room.local_participant.publish_data(
                    json.dumps(music_end_data).encode(),
                    topic="music_control"
                )
                logger.info("🎵 UNIFIED: Sent music_playback_stopped via data channel")
        except Exception as e:
            logger.warning(f"🎵 UNIFIED: Failed to send music end signal: {e}")

    async def _send_completion_message(self, title: str):
        """Send completion message via TTS after music finishes"""
        try:
            if self.session:
                # Now that music is done, we can safely use TTS for completion message
                completion_messages = [
                    f"That was {title}. What would you like to hear next?",
                    f"Finished playing {title}. Anything else?",
                    f"Hope you enjoyed {title}!",
                    f"That was fun! Want to hear another song?"
                ]
                
                # Choose a random completion message
                import random
                message = random.choice(completion_messages)
                
                # Use session.say() to send completion message
                await self.session.say(message, allow_interruptions=True)
                logger.info(f"🎵 UNIFIED: Sent completion message: {message}")
        except Exception as e:
            logger.warning(f"🎵 UNIFIED: Failed to send completion message: {e}")

    async def _send_agent_state_to_listening(self):
        """Send agent state change to listening mode (mimics normal TTS completion)"""
        try:
            if self.context and hasattr(self.context, 'room'):
                import json
                agent_state_data = {
                    "type": "agent_state_changed",
                    "data": {
                        "old_state": "speaking",
                        "new_state": "listening"
                    }
                }
                await self.context.room.local_participant.publish_data(
                    json.dumps(agent_state_data).encode(),
                    reliable=True
                )
                logger.info("🎵 UNIFIED: Sent agent_state_changed (speaking -> listening) via data channel")
        except Exception as e:
            logger.warning(f"🎵 UNIFIED: Failed to send agent state change: {e}")


class AudioFrameIterator:
    """Async iterator for audio frames"""

    def __init__(self, raw_audio: bytes, sample_rate: int, samples_per_frame: int, stop_event):
        self.raw_audio = raw_audio
        self.sample_rate = sample_rate
        self.samples_per_frame = samples_per_frame
        self.stop_event = stop_event
        self.position = 0

    def __aiter__(self):
        return self

    async def __anext__(self):
        # Check stop event FIRST - immediate response to abort
        if self.stop_event.is_set():
            raise StopAsyncIteration

        if self.position >= len(self.raw_audio):
            raise StopAsyncIteration

        # Get next chunk
        chunk = self.raw_audio[self.position:self.position + self.samples_per_frame * 2]
        self.position += self.samples_per_frame * 2

        if len(chunk) < self.samples_per_frame * 2:
            chunk += b'\x00' * (self.samples_per_frame * 2 - len(chunk))

        # Check stop event again before creating frame - double check for responsiveness
        if self.stop_event.is_set():
            raise StopAsyncIteration

        frame = rtc.AudioFrame(
            data=chunk,
            sample_rate=self.sample_rate,
            num_channels=1,
            samples_per_channel=self.samples_per_frame
        )

        return frame


class StreamingAudioIterator:
    """Async iterator for streaming audio frames - processes MP3 chunks in real-time"""

    def __init__(self, response, session, stop_event, title: str):
        self.response = response
        self.session = session
        self.stop_event = stop_event
        self.title = title
        self.chunk_size = 64 * 1024  # 64KB chunks for good balance
        self.buffer = b''
        self.audio_converter = None
        self.frame_queue = asyncio.Queue(maxsize=100)  # Buffer frames for smooth playback
        self.producer_task = None
        self.sample_rate = 48000
        self.samples_per_frame = 960  # 20ms at 48kHz
        self.is_finished = False
        self.bytes_processed = 0

    def __aiter__(self):
        return self

    async def __anext__(self):
        # Check if already finished
        if self.is_finished:
            raise StopAsyncIteration

        # Check stop event first
        if self.stop_event.is_set():
            await self._cleanup()
            raise StopAsyncIteration

        # Start producer task if not already started
        if self.producer_task is None:
            self.producer_task = asyncio.create_task(self._produce_frames())

        try:
            # Get next frame from queue with timeout
            frame = await asyncio.wait_for(self.frame_queue.get(), timeout=5.0)

            if frame is None:  # End of stream marker
                await self._cleanup()
                raise StopAsyncIteration

            return frame

        except asyncio.TimeoutError:
            logger.warning(f"🎵 STREAMING: Frame timeout for {self.title}")
            await self._cleanup()
            raise StopAsyncIteration
        except Exception as e:
            # Only log actual errors, not normal end-of-stream conditions
            if str(e):
                logger.error(f"🎵 STREAMING: Error getting frame: {e}")
            await self._cleanup()
            raise StopAsyncIteration

    async def _produce_frames(self):
        """Background task to download chunks and convert to audio frames"""
        try:
            logger.info(f"🎵 STREAMING: Starting frame producer for {self.title}")

            async for chunk in self._download_chunks():
                if self.stop_event.is_set():
                    break

                # Process chunk to audio frames
                frames = await self._process_chunk(chunk)

                # Add frames to queue
                for frame in frames:
                    if self.stop_event.is_set():
                        break
                    await self.frame_queue.put(frame)

            # Signal end of stream
            await self.frame_queue.put(None)
            logger.info(f"🎵 STREAMING: Finished producing frames for {self.title} ({self.bytes_processed} bytes)")

        except Exception as e:
            logger.error(f"🎵 STREAMING: Producer error: {e}")
            await self.frame_queue.put(None)  # Signal end

    async def _download_chunks(self):
        """Download HTTP response in chunks"""
        try:
            async for chunk in self.response.content.iter_chunked(self.chunk_size):
                if self.stop_event.is_set():
                    break

                self.bytes_processed += len(chunk)
                yield chunk

                # Log progress every 512KB
                if self.bytes_processed % (512 * 1024) == 0:
                    logger.debug(f"🎵 STREAMING: Downloaded {self.bytes_processed // 1024}KB for {self.title}")

        except Exception as e:
            logger.error(f"🎵 STREAMING: Download error: {e}")
            raise

    async def _process_chunk(self, chunk: bytes) -> list:
        """Convert MP3 chunk to audio frames"""
        try:
            # Add to buffer
            self.buffer += chunk

            # Try to process complete MP3 frames from buffer
            frames = []

            # For simplicity, we'll process when we have enough data
            # In production, you'd want proper MP3 frame boundary detection
            if len(self.buffer) >= 4096:  # Process when we have enough data
                try:
                    # Convert MP3 data to PCM using pydub
                    if PYDUB_AVAILABLE:
                        audio_segment = AudioSegment.from_mp3(io.BytesIO(self.buffer))

                        # Convert to 48kHz mono for LiveKit
                        audio_segment = audio_segment.set_frame_rate(self.sample_rate)
                        audio_segment = audio_segment.set_channels(1)
                        audio_segment = audio_segment.set_sample_width(2)

                        raw_audio = audio_segment.raw_data

                        # Split into frames
                        frame_size = self.samples_per_frame * 2  # 2 bytes per sample
                        for i in range(0, len(raw_audio), frame_size):
                            if self.stop_event.is_set():
                                break

                            frame_data = raw_audio[i:i + frame_size]

                            # Pad if necessary
                            if len(frame_data) < frame_size:
                                frame_data += b'\x00' * (frame_size - len(frame_data))

                            frame = rtc.AudioFrame(
                                data=frame_data,
                                sample_rate=self.sample_rate,
                                num_channels=1,
                                samples_per_channel=self.samples_per_frame
                            )
                            frames.append(frame)

                        # Clear processed buffer
                        self.buffer = b''

                except Exception as e:
                    # If processing fails, try with smaller buffer or skip
                    logger.debug(f"🎵 STREAMING: Chunk processing issue (normal): {e}")
                    if len(self.buffer) > 64 * 1024:  # If buffer too large, clear it
                        self.buffer = self.buffer[-8192:]  # Keep last 8KB

            return frames

        except Exception as e:
            logger.error(f"🎵 STREAMING: Chunk processing error: {e}")
            return []

    async def _cleanup(self):
        """Clean up resources"""
        if not self.is_finished:
            self.is_finished = True

            if self.producer_task and not self.producer_task.done():
                self.producer_task.cancel()
                try:
                    await self.producer_task
                except asyncio.CancelledError:
                    pass

            try:
                if self.response and hasattr(self.response, 'close'):
                    close_result = self.response.close()
                    # Only await if it's actually a coroutine
                    if close_result is not None and asyncio.iscoroutine(close_result):
                        await close_result
                    
                if self.session and hasattr(self.session, 'close'):
                    close_result = self.session.close()
                    # Only await if it's actually a coroutine
                    if close_result is not None and asyncio.iscoroutine(close_result):
                        await close_result
            except Exception as e:
                logger.debug(f"🎵 STREAMING: Cleanup error: {e}")

            logger.info(f"🎵 STREAMING: Cleaned up resources for {self.title}")