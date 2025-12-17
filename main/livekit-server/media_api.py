"""
Media API Server - Spawns music/story bots that join LiveKit rooms
Similar to livekit-media/server.py but integrated with existing services
"""
from fastapi import FastAPI, HTTPException, Body
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import Optional, Dict, List
import asyncio
import os
import json
from dotenv import load_dotenv
from livekit import rtc, api
from pydub import AudioSegment
import io
import aiohttp

from src.services.music_service import MusicService
from src.services.story_service import StoryService
from src.services.analytics_service import AnalyticsService
from src.utils.model_cache import model_cache
from src.utils.loki_bot_logger import logger

load_dotenv(".env")

# LiveKit configuration
LIVEKIT_URL = os.getenv("LIVEKIT_URL")
LIVEKIT_API_KEY = os.getenv("LIVEKIT_API_KEY")
LIVEKIT_API_SECRET = os.getenv("LIVEKIT_API_SECRET")

# Manager API configuration (for analytics)
MANAGER_API_URL = os.getenv("MANAGER_API_URL", "http://localhost:8002")
MANAGER_API_SECRET = os.getenv("MANAGER_API_SECRET", "")

app = FastAPI(title="Cheeko Media API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

def format_mac_address(mac: str) -> str:
    """
    Convert compact MAC address to colon-separated format.
    Example: '28562f001058' -> '28:56:2f:00:10:58'
    """
    if ':' in mac or '-' in mac:
        # Already formatted
        return mac
    
    # Insert colons every 2 characters
    return ':'.join([mac[i:i+2] for i in range(0, len(mac), 2)])


# Initialize services on startup
music_service: Optional[MusicService] = None
story_service: Optional[StoryService] = None
active_bots = {}  # Track active bots by room_name


@app.on_event("startup")
async def startup_event():
    global music_service, story_service

    logger.info("🚀 Initializing Media API services...")

    # Get preloaded models from cache
    embedding_model = model_cache.get_embedding_model()
    qdrant_client = model_cache.get_qdrant_client()

    # Initialize services
    music_service = MusicService(embedding_model, qdrant_client)
    story_service = StoryService(embedding_model, qdrant_client)

    await music_service.initialize()
    await story_service.initialize()

    logger.info("✅ Media API services initialized")
    
    # Log Loki status
    if os.getenv("LOKI_HOST"):
        logger.info(f"✅ [LOGGING] Grafana Loki enabled. Sending logs to: {os.getenv('LOKI_HOST')}")
    else:
        logger.warning("⚠️ [LOGGING] Grafana Loki NOT configured. Logs will only be saved locally.")


class StartMusicBotRequest(BaseModel):
    room_name: str       # LiveKit room name (e.g., "uuid_mac_music")
    device_mac: str      # Device MAC address
    language: Optional[str] = None
    playlist: Optional[List[dict]] = None  # Playlist with filename + language


class StartStoryBotRequest(BaseModel):
    room_name: str
    device_mac: str
    age_group: Optional[str] = None
    playlist: Optional[List[dict]] = None  # Playlist with filename + category


class StopBotRequest(BaseModel):
    room_name: str


def create_bot_token(room_name: str, bot_identity: str) -> str:
    """Create access token for bot to join room"""
    at = api.AccessToken(LIVEKIT_API_KEY, LIVEKIT_API_SECRET)
    at.with_identity(bot_identity)
    at.with_name(bot_identity)
    at.with_grants(api.VideoGrants(
        room_join=True,
        room=room_name,
        can_publish=True,
        can_subscribe=True
    ))
    logger.info(f"🎫 Created token for bot '{bot_identity}' to join room '{room_name}'")
    return at.to_jwt()


class MediaBot:
    """Base class for music/story bots that stream audio to LiveKit rooms"""

    def __init__(self, room_name: str, token: str, bot_type: str):
        self.room_name = room_name
        self.token = token
        self.bot_type = bot_type  # "music" or "story"

        # LiveKit components
        self.room = None
        self.audio_source = None
        self.audio_track = None
        self.should_stop = False
        self.task = None  # Reference to the running task for proper cleanup
        self._disconnected = False  # Track if already disconnected

    async def connect_to_room(self) -> bool:
        """Connect to LiveKit room and publish audio track"""
        try:
            self.room = rtc.Room()

            # Setup event handlers for data channel messages
            # Use synchronous wrapper with asyncio.create_task for async handlers
            @self.room.on("data_received")
            def on_data_received_sync(data_packet):
                """Synchronous wrapper for async data received handler"""
                try:
                    asyncio.create_task(self._on_data_received(data_packet))
                except RuntimeError as e:
                    logger.error(f"❌ Failed to create task for data handler: {e}")
                except Exception as e:
                    logger.error(f"❌ Unexpected error in data received wrapper: {e}")

            await self.room.connect(LIVEKIT_URL, self.token)
            logger.info(f"✅ {self.bot_type} bot connected to room: {self.room_name}")

            # Create audio source (48kHz mono - LiveKit will handle to approom.js)
            self.audio_source = rtc.AudioSource(48000, 1)
            track_name = f"{self.bot_type}-agent-audio"
            self.audio_track = rtc.LocalAudioTrack.create_audio_track(
                track_name,
                self.audio_source
            )

            # Publish audio track
            options = rtc.TrackPublishOptions(source=rtc.TrackSource.SOURCE_MICROPHONE)
            publication = await self.room.local_participant.publish_track(self.audio_track, options)
            logger.info(f"✅ {self.bot_type} audio track '{track_name}' published (sid: {publication.sid})")

            return True
        except Exception as e:
            logger.error(f"❌ Failed to connect to room: {e}")
            import traceback
            logger.error(f"Traceback: {traceback.format_exc()}")
            return False

    async def _on_data_received(self, data_packet):
        """Handle data received from data channel"""
        try:
            # Decode the data packet
            data_bytes = bytes(data_packet.data)
            data_str = data_bytes.decode('utf-8')
            data_json = json.loads(data_str)

            logger.info(f"📡 [DATA-CHANNEL] Received data: {data_json.get('type', 'unknown')}")

            # Check if this is a function call from mobile app
            if data_json.get('type') == 'function_call':
                await self._handle_function_call(data_json)
            # Check if this is a specific content request
            elif data_json.get('type') == 'specific_content_request':
                await self._handle_specific_content_request(data_json)
            else:
                logger.debug(f"📡 [DATA-CHANNEL] Ignoring message type: {data_json.get('type')}")

        except json.JSONDecodeError as e:
            logger.error(f"❌ [DATA-CHANNEL] Failed to decode JSON: {e}")
        except UnicodeDecodeError as e:
            logger.error(f"❌ [DATA-CHANNEL] Failed to decode UTF-8: {e}")
        except AttributeError as e:
            logger.error(f"❌ [DATA-CHANNEL] Invalid data packet structure: {e}")
        except Exception as e:
            logger.error(f"❌ [DATA-CHANNEL] Unexpected error handling data: {e}")
            import traceback
            logger.error(f"❌ [DATA-CHANNEL] Traceback: {traceback.format_exc()}")

    async def _handle_function_call(self, function_data: Dict):
        """Handle function call from mobile app via data channel"""
        try:
            # Log the full data structure for debugging
            logger.info(f"📞 [FUNCTION-CALL] Raw data: {function_data}")

            # Check if function_call is nested inside
            if 'function_call' in function_data:
                function_call_obj = function_data['function_call']
                function_name = function_call_obj.get('name')
                arguments = function_call_obj.get('arguments', {})
            else:
                # Try different possible key names for function (flat structure)
                function_name = function_data.get('function') or function_data.get('function_name') or function_data.get('name')
                arguments = function_data.get('arguments', {})

            # Handle if arguments is a JSON string
            if isinstance(arguments, str):
                try:
                    arguments = json.loads(arguments)
                except:
                    logger.error(f"❌ [FUNCTION-CALL] Failed to parse arguments string: {arguments}")
                    arguments = {}

            logger.info(f"📞 [FUNCTION-CALL] Function: {function_name}, Args: {arguments}")

            # Convert function call to specific content request format
            if function_name == 'play_music' and self.bot_type == 'music':
                # Extract arguments
                song_name = arguments.get('song_name')
                language = arguments.get('language')
                loop_enabled = arguments.get('loop_enabled', False)

                if song_name:
                    # Convert to specific_content_request format
                    request_data = {
                        'content_type': 'music',
                        'content_name': song_name,
                        'language': language,
                        'loop_enabled': loop_enabled
                    }
                    logger.info(f"🔄 [FUNCTION-CALL] Converted to music request: {song_name}")
                    await self._handle_specific_music_request(request_data)
                else:
                    logger.error(f"❌ [FUNCTION-CALL] Missing song_name in arguments")

            elif function_name == 'play_story' and self.bot_type == 'story':
                # Extract arguments
                story_name = arguments.get('story_name')
                category = arguments.get('category')
                loop_enabled = arguments.get('loop_enabled', False)

                if story_name:
                    # Convert to specific_content_request format
                    request_data = {
                        'content_type': 'story',
                        'content_name': story_name,
                        'category': category,
                        'loop_enabled': loop_enabled
                    }
                    logger.info(f"🔄 [FUNCTION-CALL] Converted to story request: {story_name}")
                    await self._handle_specific_story_request(request_data)
                else:
                    logger.error(f"❌ [FUNCTION-CALL] Missing story_name in arguments")

            else:
                logger.warning(f"⚠️ [FUNCTION-CALL] Unhandled function or bot type mismatch. Function: {function_name}, Bot: {self.bot_type}")

        except Exception as e:
            logger.error(f"❌ [FUNCTION-CALL] Error handling function call: {e}")
            import traceback
            logger.error(f"❌ [FUNCTION-CALL] Traceback: {traceback.format_exc()}")

    async def _handle_specific_content_request(self, request_data: Dict):
        """Handle specific content request from mobile app via data channel"""
        try:
            content_type = request_data.get('content_type')
            content_name = request_data.get('content_name')

            logger.info(f"🎯 [SPECIFIC-CONTENT] Processing {content_type} request: {content_name}")

            # Route to appropriate handler based on content type and bot type
            if content_type == "music" and self.bot_type == "music":
                await self._handle_specific_music_request(request_data)
            elif content_type == "story" and self.bot_type == "story":
                await self._handle_specific_story_request(request_data)
            else:
                logger.error(f"❌ [SPECIFIC-CONTENT] Bot type mismatch. Bot: {self.bot_type}, Request: {content_type}")

        except Exception as e:
            logger.error(f"❌ [SPECIFIC-CONTENT] Error handling request: {e}")
            import traceback
            logger.error(f"❌ [SPECIFIC-CONTENT] Traceback: {traceback.format_exc()}")

    async def _handle_specific_music_request(self, request_data: Dict):
        """Handle specific music request - implemented by MusicBot subclass"""
        logger.warning(f"⚠️ [SPECIFIC-MUSIC] Base class method called - should be overridden by MusicBot")

    async def _handle_specific_story_request(self, request_data: Dict):
        """Handle specific story request - implemented by StoryBot subclass"""
        logger.warning(f"⚠️ [SPECIFIC-STORY] Base class method called - should be overridden by StoryBot")

    async def download_from_cdn(self, url: str) -> bytes:
        """Download MP3 file from CDN"""
        try:
            logger.info(f"📥 Downloading from CDN: {url}")
            async with aiohttp.ClientSession() as session:
                async with session.get(url, timeout=aiohttp.ClientTimeout(total=30)) as response:
                    if response.status != 200:
                        raise Exception(f"CDN returned status {response.status}")

                    audio_data = await response.read()
                    size_mb = len(audio_data) / (1024 * 1024)
                    logger.info(f"✅ Downloaded {size_mb:.2f} MB")
                    return audio_data
        except Exception as e:
            logger.error(f"❌ Failed to download from CDN: {e}")
            raise

    async def convert_to_pcm(self, audio_data: bytes) -> bytes:
        """Convert MP3 to PCM format for LiveKit (48kHz mono 16-bit)"""
        try:
            logger.info("🔄 Converting MP3 to PCM...")
            audio_segment = AudioSegment.from_mp3(io.BytesIO(audio_data))

            # Convert to LiveKit format: 48kHz, mono, 16-bit
            audio_segment = audio_segment.set_frame_rate(48000)
            audio_segment = audio_segment.set_channels(1)
            audio_segment = audio_segment.set_sample_width(2)  # 16-bit

            raw_audio = audio_segment.raw_data
            duration_seconds = len(audio_segment) / 1000.0

            logger.info(f"✅ Converted to PCM ({duration_seconds:.1f} seconds)")
            return raw_audio
        except Exception as e:
            logger.error(f"❌ Failed to convert audio: {e}")
            raise

    async def stream_audio_to_livekit(self, raw_audio: bytes, title: str):
        """Stream PCM audio to LiveKit room"""
        try:
            sample_rate = 48000
            frame_duration_ms = 20
            samples_per_frame = sample_rate * frame_duration_ms // 1000  # 960 samples

            total_samples = len(raw_audio) // 2  # 16-bit = 2 bytes per sample
            total_frames = total_samples // samples_per_frame

            logger.info(f"🎵 Streaming '{title}' to LiveKit ({total_frames} frames)...")

            for frame_num in range(total_frames):
                if self.should_stop:
                    logger.info("⏹️ Stopping stream...")
                    break

                # Extract frame data
                start_byte = frame_num * samples_per_frame * 2
                end_byte = start_byte + (samples_per_frame * 2)
                frame_data = raw_audio[start_byte:end_byte]

                # Pad if necessary
                if len(frame_data) < samples_per_frame * 2:
                    frame_data += b'\x00' * (samples_per_frame * 2 - len(frame_data))

                # Create and capture frame
                frame = rtc.AudioFrame(
                    data=frame_data,
                    sample_rate=sample_rate,
                    num_channels=1,
                    samples_per_channel=samples_per_frame
                )

                await self.audio_source.capture_frame(frame)
                await asyncio.sleep(frame_duration_ms / 1000.0)

                # Progress indicator
                if frame_num % 500 == 0:
                    percent = (frame_num / total_frames) * 100
                    logger.info(f"   Progress: {percent:.1f}%")

            logger.info(f"✅ Finished streaming '{title}'")

        except Exception as e:
            logger.error(f"❌ Error streaming audio: {e}")
            raise

    async def disconnect(self):
        """Disconnect from LiveKit room (idempotent - safe to call multiple times)"""
        # Check if already disconnected to avoid double-disconnect issues
        if self._disconnected:
            logger.debug(f"👋 {self.bot_type} bot already disconnected, skipping")
            return

        self._disconnected = True

        try:
            self.should_stop = True

            # Close any active stream iterator first
            if hasattr(self, 'current_stream_iterator') and self.current_stream_iterator:
                try:
                    await asyncio.wait_for(self.current_stream_iterator.close(), timeout=2.0)
                    logger.info(f"✅ Stream iterator closed successfully")
                except asyncio.TimeoutError:
                    logger.warning(f"⚠️ Stream iterator close timed out")
                except Exception as e:
                    logger.error(f"❌ Error closing stream iterator: {e}")

            # Disconnect from room
            if self.room:
                try:
                    await asyncio.wait_for(self.room.disconnect(), timeout=5.0)
                    logger.info(f"👋 {self.bot_type} bot disconnected from room")
                except asyncio.TimeoutError:
                    logger.warning(f"⚠️ Room disconnect timed out")
                except Exception as e:
                    logger.error(f"❌ Error disconnecting from room: {e}")
                finally:
                    self.room = None  # Clear room reference to prevent re-use

        except Exception as e:
            logger.error(f"❌ Unexpected error during disconnect: {e}")
            import traceback
            logger.error(f"Traceback: {traceback.format_exc()}")


class StreamingAudioIterator:
    """
    Async iterator that downloads MP3 chunks from CDN and converts to LiveKit frames on-the-fly.
    This enables progressive streaming - audio starts playing immediately instead of waiting for full download.
    """

    def __init__(self, cdn_url: str, stop_event, title: str):
        self.cdn_url = cdn_url
        self.stop_event = stop_event
        self.title = title
        self.chunk_size = 64 * 1024  # 64KB chunks
        self.frame_queue = asyncio.Queue(maxsize=100)  # Buffer up to 100 frames
        self.producer_task = None
        self.session = None
        self.is_closed = False  # Track if iterator was explicitly closed

    async def close(self):
        """Explicitly close the iterator and stop download"""
        self.is_closed = True
        self.stop_event = True

        # Cancel producer task if running (don't wait for it to avoid hanging)
        if self.producer_task and not self.producer_task.done():
            self.producer_task.cancel()
            logger.info(f"🎵 Producer task cancelled, not waiting for completion")

        # Close HTTP session (don't wait for it to avoid hanging)
        if self.session:
            try:
                # Use create_task to close session in background without waiting
                asyncio.create_task(self.session.close())
                logger.info(f"🎵 HTTP session close initiated in background")
            except:
                pass

        # IMPORTANT: Clear the frame queue immediately to prevent buffered audio from playing
        frames_cleared = 0
        while not self.frame_queue.empty():
            try:
                self.frame_queue.get_nowait()
                frames_cleared += 1
            except asyncio.QueueEmpty:
                break
        if frames_cleared > 0:
            logger.info(f"🗑️ Cleared {frames_cleared} buffered frames from queue")

        # Signal end of stream (with timeout to avoid hanging)
        try:
            await asyncio.wait_for(self.frame_queue.put(None), timeout=0.1)
            logger.info(f"🎵 End-of-stream signal sent to queue")
        except asyncio.TimeoutError:
            logger.warning(f"⚠️ Queue put timed out, queue might be full")
        except:
            pass

    async def _produce_frames(self):
        """Background task: Download MP3 chunks, convert to PCM, create LiveKit frames"""
        try:
            logger.info(f"🎵 Starting progressive download: {self.title}")

            # Start streaming download from CDN
            self.session = aiohttp.ClientSession()
            async with self.session.get(self.cdn_url, timeout=aiohttp.ClientTimeout(total=300)) as response:
                if response.status != 200:
                    raise Exception(f"CDN returned status {response.status}")

                # MP3 decoding state
                mp3_buffer = bytearray()
                chunk_count = 0
                total_bytes = 0

                # LiveKit audio parameters
                sample_rate = 48000
                frame_duration_ms = 20
                samples_per_frame = sample_rate * frame_duration_ms // 1000  # 960 samples

                # Download and process chunks
                async for chunk in response.content.iter_chunked(self.chunk_size):
                    if self.stop_event or self.is_closed:
                        logger.info("⏹️ Stop/skip event triggered, halting download")
                        break

                    chunk_count += 1
                    total_bytes += len(chunk)
                    mp3_buffer.extend(chunk)

                    # Try to decode accumulated MP3 data
                    try:
                        # Attempt to decode the buffer as MP3
                        audio_segment = AudioSegment.from_mp3(io.BytesIO(bytes(mp3_buffer)))

                        # Convert to LiveKit format: 48kHz, mono, 16-bit
                        audio_segment = audio_segment.set_frame_rate(sample_rate)
                        audio_segment = audio_segment.set_channels(1)
                        audio_segment = audio_segment.set_sample_width(2)  # 16-bit

                        # Get raw PCM data
                        raw_pcm = audio_segment.raw_data

                        # Clear buffer since we successfully decoded
                        mp3_buffer.clear()

                        # Split PCM into LiveKit frames (20ms each = 960 samples)
                        total_samples = len(raw_pcm) // 2  # 16-bit = 2 bytes per sample
                        total_frames = total_samples // samples_per_frame

                        for frame_num in range(total_frames):
                            if self.stop_event or self.is_closed:
                                break

                            # Extract frame data
                            start_byte = frame_num * samples_per_frame * 2
                            end_byte = start_byte + (samples_per_frame * 2)
                            frame_data = raw_pcm[start_byte:end_byte]

                            # Pad if necessary
                            if len(frame_data) < samples_per_frame * 2:
                                frame_data += b'\x00' * (samples_per_frame * 2 - len(frame_data))

                            # Create LiveKit AudioFrame
                            livekit_frame = rtc.AudioFrame(
                                data=frame_data,
                                sample_rate=sample_rate,
                                num_channels=1,
                                samples_per_channel=samples_per_frame
                            )

                            # Add to queue (blocks if queue is full - provides backpressure)
                            await self.frame_queue.put(livekit_frame)

                        # Log progress periodically
                        if chunk_count % 10 == 0:
                            mb_downloaded = total_bytes / (1024 * 1024)
                            logger.info(f"   📥 Downloaded {mb_downloaded:.2f} MB ({chunk_count} chunks)")

                    except Exception as decode_error:
                        # Incomplete MP3 frame - need more data
                        # Keep accumulating in mp3_buffer
                        if len(mp3_buffer) > 10 * 1024 * 1024:  # Safety: clear if buffer > 10MB
                            logger.warning(f"⚠️ MP3 buffer too large ({len(mp3_buffer)} bytes), clearing")
                            mp3_buffer.clear()
                        continue

                # Process any remaining buffered data
                if len(mp3_buffer) > 0 and not self.stop_event and not self.is_closed:
                    try:
                        audio_segment = AudioSegment.from_mp3(io.BytesIO(bytes(mp3_buffer)))
                        audio_segment = audio_segment.set_frame_rate(sample_rate).set_channels(1).set_sample_width(2)
                        raw_pcm = audio_segment.raw_data

                        # Convert remaining PCM to frames
                        total_samples = len(raw_pcm) // 2
                        total_frames = total_samples // samples_per_frame

                        for frame_num in range(total_frames):
                            start_byte = frame_num * samples_per_frame * 2
                            end_byte = start_byte + (samples_per_frame * 2)
                            frame_data = raw_pcm[start_byte:end_byte]

                            if len(frame_data) < samples_per_frame * 2:
                                frame_data += b'\x00' * (samples_per_frame * 2 - len(frame_data))

                            livekit_frame = rtc.AudioFrame(
                                data=frame_data,
                                sample_rate=sample_rate,
                                num_channels=1,
                                samples_per_channel=samples_per_frame
                            )
                            await self.frame_queue.put(livekit_frame)
                    except:
                        pass  # Ignore final incomplete data

                logger.info(f"✅ Download complete: {total_bytes / (1024 * 1024):.2f} MB")

        except Exception as e:
            logger.error(f"❌ Error in streaming producer: {e}")
            import traceback
            traceback.print_exc()
        finally:
            # Signal end of stream
            await self.frame_queue.put(None)
            if self.session:
                await self.session.close()

    async def __anext__(self):
        """Return next audio frame when ready"""
        if self.producer_task is None:
            # Start background download/conversion task
            self.producer_task = asyncio.create_task(self._produce_frames())

        # Get next frame from queue (blocks until available)
        frame = await self.frame_queue.get()

        if frame is None:
            # End of stream
            raise StopAsyncIteration

        return frame

    def __aiter__(self):
        return self


class MusicBot(MediaBot):
    """Music streaming bot with skip control"""

    def __init__(self, room_name: str, token: str, language: Optional[str] = None, playlist: Optional[List[dict]] = None, analytics_service: Optional[AnalyticsService] = None):
        super().__init__(room_name, token, "music")
        self.language = language
        self.playlist = playlist  # List of {filename, category/language, title, etc.}
        self.current_index = 0  # Track current position in playlist
        self.skip_requested = False  # Flag to interrupt current song
        self.skip_direction = None  # 'next', 'previous', or None
        self.skip_lock = asyncio.Lock()  # Thread safety for skip operations
        self.current_stream_iterator = None  # Track current streaming iterator

        # Random mode support
        self.random_mode = False  # True when playlist is empty
        self.current_random_song = None  # Current random song info
        self.song_history = []  # Keep track of last 10 random songs for previous functionality
        self.max_history = 10  # Maximum songs to remember
        self.history_index = -1  # Current position in history (-1 means at the end/latest)
        self.pending_previous_song = None  # Song to play on next iteration (for "previous" in random mode)

        # Specific content playback support (for mobile app requests)
        self.specific_content_queue = None  # Queue for specific song requests

        # Analytics service
        self.analytics_service = analytics_service

        # Paused state - bot waits for start_agent signal before streaming
        self.is_paused = True  # Start in paused state
        self.start_event = asyncio.Event()  # Event to signal start

        # First interaction tracking - bot waits for first button press to actually start playback
        self.is_first_interaction = True  # Track if this is the first button press
        self.waiting_for_first_interaction = True  # Bot is waiting for user to press button

    async def run(self):
        """Main entry point - connect and stream music with progressive streaming and skip support"""
        connection_retries = 3
        retry_delay = 2

        try:
            # Connect to LiveKit with retry mechanism
            connected = False
            for attempt in range(connection_retries):
                try:
                    if await self.connect_to_room():
                        connected = True
                        break
                    else:
                        logger.warning(f"⚠️ Connection attempt {attempt + 1}/{connection_retries} failed")
                        if attempt < connection_retries - 1:
                            await asyncio.sleep(retry_delay)
                except Exception as e:
                    logger.error(f"❌ Connection attempt {attempt + 1}/{connection_retries} error: {e}")
                    if attempt < connection_retries - 1:
                        await asyncio.sleep(retry_delay)

            if not connected:
                logger.error("❌ Failed to connect to room after all retries")
                return

            # Wait for start signal before streaming (paused state)
            if self.is_paused:
                logger.info("⏸️ [MUSIC] Bot connected, waiting for start_agent signal...")
                await self.start_event.wait()
                logger.info("▶️ [MUSIC] Start signal received, beginning playback")
                self.is_paused = False

            # Start analytics session
            if self.analytics_service:
                await self.analytics_service.start_session(mode_type="Music")

            # Check if playlist is provided
            if self.playlist and len(self.playlist) > 0:
                logger.info(f"🎵 Using playlist with {len(self.playlist)} songs (looping enabled)")
                await self._run_playlist_mode()
            else:
                # No playlist - enter continuous random mode
                logger.info("🎵 No playlist provided, entering continuous random mode")
                self.random_mode = True
                await self._run_random_mode()

            # Keep bot alive for a moment to ensure audio finishes
            await asyncio.sleep(2)

        except asyncio.CancelledError:
            logger.info("🛑 Music bot task cancelled")
        except Exception as e:
            logger.error(f"❌ Music bot error: {e}")
            import traceback
            traceback.print_exc()
        finally:
            # End analytics session
            if self.analytics_service:
                await self.analytics_service.end_session(completion_status="completed")

            await self.disconnect()
            # Remove from active bots
            if self.room_name in active_bots:
                del active_bots[self.room_name]

    async def _run_playlist_mode(self):
        """Run playlist mode with looping and specific content support"""
        # Loop through playlist starting from current_index with looping
        while not self.should_stop:
            # Check if we need to play specific content first
            if self.specific_content_queue is not None:
                logger.info("🎯 [MUSIC-SPECIFIC] Playing specific content before continuing playlist")

                content_info = self.specific_content_queue['content_info']
                loop_enabled = self.specific_content_queue['loop_enabled']
                self.specific_content_queue = None  # Clear after extracting

                # Extract content details
                title = content_info.get('title', 'Unknown Song')
                filename = content_info.get('filename')
                language = content_info.get('language')

                if filename and language:
                    song_url = music_service.get_song_url(filename, language)
                    logger.info(f"🎯 [MUSIC-SPECIFIC] Playing: '{title}' ({language})")

                    # Reset skip flag before streaming
                    async with self.skip_lock:
                        self.skip_requested = False
                        self.skip_direction = None

                    # Stream the specific content
                    if loop_enabled:
                        # Loop the specific content until interrupted
                        logger.info(f"🎯 [MUSIC-SPECIFIC] Loop mode enabled for '{title}'")
                        while not self.should_stop and not self.skip_requested:
                            await self._stream_song(song_url, title, media_id=filename, language=language)
                            if not self.should_stop and not self.skip_requested:
                                await asyncio.sleep(1)  # Small gap between loops
                    else:
                        # Play once
                        await self._stream_song(song_url, title, media_id=filename, language=language)

                    logger.info(f"🎯 [MUSIC-SPECIFIC] Finished streaming: '{title}'")

                    # After specific content, continue with normal playlist flow
                    if self.should_stop:
                        break

                    # Small gap before continuing playlist
                    await asyncio.sleep(1)
                else:
                    logger.error(f"🎯 [MUSIC-SPECIFIC] Invalid content info: {content_info}")

                # Continue to next iteration to play normal playlist
                # NOTE: current_index is NOT modified, so playlist resumes from same song
                continue

            # Get current playlist item
            playlist_item = self.playlist[self.current_index]

            # Extract metadata from playlist item
            filename = playlist_item.get('filename')
            category = playlist_item.get('category')  # For music, this is language (English, Hindi, etc.)
            title = playlist_item.get('title', filename)

            if not filename or not category:
                logger.warning(f"⚠️ Skipping invalid playlist item: {playlist_item}")
                # Move to next
                self.current_index = (self.current_index + 1) % len(self.playlist)
                continue

            # Construct URL using music_service
            song_url = music_service.get_song_url(filename, category)
            logger.info(f"🎵 [{self.current_index + 1}/{len(self.playlist)}] Playing: '{title}' ({category})")

            # Reset skip flag before streaming
            async with self.skip_lock:
                self.skip_requested = False
                self.skip_direction = None

            # Stream this song (can be interrupted by skip)
            logger.info(f"🎵 About to start streaming: '{title}'")
            await self._stream_song(song_url, title, media_id=filename, language=category)
            logger.info(f"🎵 Finished streaming call for: '{title}'")

            if self.should_stop:
                logger.info(f"🎵 should_stop is True, breaking main loop")
                break

            # Check if skip was requested during streaming
            was_skipped = False
            async with self.skip_lock:
                if self.skip_requested:
                    was_skipped = True
                    if self.skip_direction == 'next':
                        logger.info("⏭️ Skipping to next song")
                        self.current_index = (self.current_index + 1) % len(self.playlist)
                        logger.info(f"🎵 New index after next skip: {self.current_index}")
                    elif self.skip_direction == 'previous':
                        logger.info("⏮️ Going to previous song")
                        self.current_index = (self.current_index - 1) % len(self.playlist)
                        logger.info(f"🎵 New index after previous skip: {self.current_index}")
                    self.skip_requested = False
                    logger.info(f"🎵 Skip processed, continuing to next iteration")
                else:
                    # Normal progression - song finished naturally, go to next
                    self.current_index = (self.current_index + 1) % len(self.playlist)
                    logger.info(f"🔄 Auto-advancing to next song (index: {self.current_index})")

            # Small gap between songs - only when song ended naturally, not on skip
            if not self.should_stop and not was_skipped:
                await asyncio.sleep(1)

        logger.info("✅ Playlist stopped")

    async def _run_random_mode(self):
        """Run continuous random mode with skip support and specific content requests"""
        while not self.should_stop:
            # Check if we need to play specific content first (from mobile app request)
            if self.specific_content_queue is not None:
                logger.info("🎯 [MUSIC-SPECIFIC] Playing specific content before continuing random mode")

                content_info = self.specific_content_queue['content_info']
                loop_enabled = self.specific_content_queue['loop_enabled']
                self.specific_content_queue = None  # Clear after extracting

                # Extract content details
                title = content_info.get('title', 'Unknown Song')
                filename = content_info.get('filename')
                language = content_info.get('language')

                if filename and language:
                    song_url = music_service.get_song_url(filename, language)
                    logger.info(f"🎯 [MUSIC-SPECIFIC] Playing: '{title}' ({language})")

                    # Reset skip flag before streaming
                    async with self.skip_lock:
                        self.skip_requested = False
                        self.skip_direction = None

                    # Stream the specific content
                    if loop_enabled:
                        # Loop the specific content until interrupted
                        logger.info(f"🎯 [MUSIC-SPECIFIC] Loop mode enabled for '{title}'")
                        while not self.should_stop and not self.skip_requested:
                            await self._stream_song(song_url, title, media_id=filename, language=language)
                            if not self.should_stop and not self.skip_requested:
                                await asyncio.sleep(1)  # Small gap between loops
                    else:
                        # Play once
                        await self._stream_song(song_url, title, media_id=filename, language=language)

                    logger.info(f"🎯 [MUSIC-SPECIFIC] Finished streaming: '{title}'")

                    # After specific content, continue with normal random flow
                    if self.should_stop:
                        break

                    # Small gap before continuing random mode
                    await asyncio.sleep(1)
                else:
                    logger.error(f"🎯 [MUSIC-SPECIFIC] Invalid content info: {content_info}")

                # Continue to next iteration to play normal random song
                continue

            # Check if we have a pending previous song to play (from "previous" skip request)
            if self.pending_previous_song is not None:
                song = self.pending_previous_song
                self.pending_previous_song = None  # Clear after using
                logger.info(f"🎵 [RANDOM] Playing previous song from history: '{song['title']}'")
                is_from_history = True
            else:
                # Get random song
                song = await music_service.get_random_song(language=self.language)
                is_from_history = False

                if not song:
                    logger.error("❌ No music available in random mode")
                    break

            # Store current song info
            self.current_random_song = {
                'title': song.get('title'),
                'language': song.get('language', self.language),
                'url': song.get('url'),
                'filename': song.get('filename', song.get('title', 'unknown'))
            }

            if not is_from_history:
                logger.info(f"🎵 [RANDOM] Playing: '{self.current_random_song['title']}' ({self.current_random_song['language']})")

            # Add to history BEFORE streaming so "previous" works correctly during playback
            if not is_from_history:
                self._add_to_history(self.current_random_song)

            # Reset skip flag before streaming
            async with self.skip_lock:
                self.skip_requested = False
                self.skip_direction = None

            # Stream this random song (can be interrupted by skip)
            logger.info(f"🎵 About to start streaming random: '{song['title']}'")
            await self._stream_song(song['url'], song['title'])
            logger.info(f"🎵 Finished streaming random call for: '{song['title']}'")

            if self.should_stop:
                logger.info(f"🎵 should_stop is True, breaking random loop")
                break

            # Check if skip was requested during streaming
            was_skipped = False
            async with self.skip_lock:
                if self.skip_requested:
                    was_skipped = True
                    if self.skip_direction == 'next':
                        logger.info("⏭️ [RANDOM] Skipping to next random song")
                    elif self.skip_direction == 'previous':
                        logger.info("⏮️ [RANDOM] Going to previous song from history")
                        # Try to get previous song from history
                        previous_song = self._get_previous_from_history()
                        if previous_song:
                            # Set pending_previous_song so the next loop iteration plays it
                            self.pending_previous_song = previous_song
                            logger.info(f"🎵 [RANDOM] Queued previous song: '{previous_song['title']}'")
                        else:
                            logger.info("🎵 [RANDOM] No previous song in history, getting new random")
                    self.skip_requested = False
                    logger.info(f"🎵 [RANDOM] Skip processed, continuing to next iteration")
                else:
                    # Normal progression - song finished naturally, get next random
                    logger.info(f"🔄 [RANDOM] Song finished naturally, getting next random")

            # Small gap between songs - only when song ended naturally, not on skip
            if not self.should_stop and not was_skipped:
                await asyncio.sleep(1)

        logger.info("✅ Random mode stopped")

    def _add_to_history(self, song_info):
        """Add song to history for previous functionality"""
        # If we're navigating back in history and a new song is added, truncate future history
        if self.history_index >= 0 and self.history_index < len(self.song_history) - 1:
            # We were in the middle of history, truncate everything after current position
            self.song_history = self.song_history[:self.history_index + 1]

        self.song_history.append(song_info)
        # Keep only last N songs
        if len(self.song_history) > self.max_history:
            self.song_history.pop(0)

        # Reset history index to point to the latest song
        self.history_index = len(self.song_history) - 1
        logger.info(f"🎵 [HISTORY] Added to history: '{song_info['title']}' (history size: {len(self.song_history)}, index: {self.history_index})")

    def _get_previous_from_history(self):
        """Get previous song from history using index-based navigation (non-destructive)"""
        if len(self.song_history) == 0:
            logger.info("🎵 [HISTORY] No songs in history")
            return None

        # Calculate the target index (one step back)
        if self.history_index < 0:
            # history_index is -1, meaning we're at the end
            target_index = len(self.song_history) - 2  # Go to second-to-last
        else:
            target_index = self.history_index - 1  # Go one step back

        if target_index < 0:
            logger.info(f"🎵 [HISTORY] Already at the beginning of history (index: {self.history_index}, size: {len(self.song_history)})")
            return None

        # Update index and return the song at that position
        self.history_index = target_index
        previous_song = self.song_history[target_index]
        logger.info(f"🎵 [HISTORY] Moving to index {target_index}: '{previous_song['title']}' (history size: {len(self.song_history)})")
        return previous_song

    async def _stream_song(self, song_url: str, title: str, media_id: str = None, language: str = None):
        """Stream a single song using progressive streaming - can be interrupted by skip"""
        from datetime import datetime

        # Track analytics - song started
        started_at = datetime.now()
        was_skipped = False
        skip_action = None

        # Log CDN URL for debugging
        logger.info(f"🔗 [CDN] URL for '{title}': {song_url}")

        # Create streaming iterator for progressive download & conversion
        stream_iterator = StreamingAudioIterator(
            cdn_url=song_url,
            stop_event=self.should_stop,
            title=title
        )
        self.current_stream_iterator = stream_iterator

        # Stream frames as they become available (audio starts immediately!)
        logger.info(f"🎵 Starting progressive stream to LiveKit...")
        frame_count = 0

        try:
            async for frame in stream_iterator:
                # Check for skip or stop
                if self.should_stop or self.skip_requested:
                    if self.skip_requested:
                        logger.info(f"⏭️ Skip requested, interrupting stream...")
                        was_skipped = True
                        skip_action = self.skip_direction if self.skip_direction else "next"
                    else:
                        logger.info(f"⏹️ Stop requested, interrupting stream...")

                    logger.info(f"🎵 About to close stream iterator...")
                    try:
                        await stream_iterator.close()  # Stop download
                        logger.info(f"🎵 Stream iterator closed successfully")
                    except Exception as close_error:
                        logger.error(f"❌ Error closing stream iterator: {close_error}")

                    # Send silence frames to flush LiveKit's buffer and stop audio immediately
                    await self._send_silence_frames(num_frames=10)  # ~200ms of silence

                    logger.info(f"🎵 Breaking from streaming loop")
                    break

                # Send frame to LiveKit room
                await self.audio_source.capture_frame(frame)
                frame_count += 1

                # Progress indicator every 500 frames (~10 seconds)
                if frame_count % 500 == 0:
                    logger.info(f"   🎵 Streamed {frame_count} frames...")

            logger.info(f"✅ Finished streaming '{title}' ({frame_count} frames)")
        except Exception as e:
            logger.error(f"❌ Error in _stream_song: {e}")
        finally:
            logger.info(f"🎵 _stream_song finally block for '{title}'")
            self.current_stream_iterator = None
            
            # Track analytics - song ended
            if self.analytics_service and media_id:
                try:
                    ended_at = datetime.now()
                    duration_played = int((ended_at - started_at).total_seconds())
                    
                    logger.info(f"📊 [MUSIC] Recording playback: {title}, duration={duration_played}s, skip={skip_action}")
                    
                    await self.analytics_service.record_media_playback(
                        media_type="music",
                        media_id=media_id,
                        media_title=title,
                        started_at=started_at,
                        ended_at=ended_at,
                        duration_played_seconds=duration_played,
                        skip_action=skip_action,
                        metadata={'language': language, 'was_skipped': was_skipped} if language else {'was_skipped': was_skipped}
                    )
                    
                    logger.info(f"📊✅ [MUSIC] Playback recorded successfully")
                except Exception as e:
                    logger.error(f"📊❌ [MUSIC] Failed to record playback: {e}")
                    import traceback
                    logger.error(f"📊❌ [MUSIC] Traceback: {traceback.format_exc()}")

    async def _send_silence_frames(self, num_frames: int = 10):
        """Send silence frames to flush LiveKit's audio buffer and stop audio immediately"""
        try:
            sample_rate = 48000
            samples_per_frame = 960  # 20ms at 48kHz
            silence_data = b'\x00' * (samples_per_frame * 2)  # 16-bit = 2 bytes per sample

            logger.info(f"🔇 Sending {num_frames} silence frames to flush buffer...")

            for _ in range(num_frames):
                silence_frame = rtc.AudioFrame(
                    data=silence_data,
                    sample_rate=sample_rate,
                    num_channels=1,
                    samples_per_channel=samples_per_frame
                )
                await self.audio_source.capture_frame(silence_frame)

            logger.info(f"🔇 Silence frames sent successfully")
        except Exception as e:
            logger.error(f"❌ Error sending silence frames: {e}")

    async def skip_to_next(self):
        """Request skip to next song (works in both playlist and random mode)"""
        async with self.skip_lock:
            # Check if this is the first interaction
            if self.is_first_interaction and self.waiting_for_first_interaction:
                logger.info("▶️ [FIRST-INTERACTION] First button press detected - starting playback from song 1")
                self.is_first_interaction = False
                self.waiting_for_first_interaction = False
                self.start_event.set()  # NOW trigger playback to start
                # Don't set skip_requested - let it play song 1 from beginning
                return
            
            # Normal skip behavior
            if self.random_mode:
                logger.info("⏭️ [CONTROL] Next random song requested")
            else:
                logger.info("⏭️ [CONTROL] Next song requested")
            self.skip_requested = True
            self.skip_direction = 'next'

    async def skip_to_previous(self):
        """Request skip to previous song (works in both playlist and random mode)"""
        async with self.skip_lock:
            # Check if this is the first interaction
            if self.is_first_interaction and self.waiting_for_first_interaction:
                logger.info("▶️ [FIRST-INTERACTION] First button press detected - starting playback from song 1")
                self.is_first_interaction = False
                self.waiting_for_first_interaction = False
                self.start_event.set()  # NOW trigger playback to start
                # Don't set skip_requested - let it play song 1 from beginning
                return
            
            # Normal skip behavior
            if self.random_mode:
                logger.info("⏮️ [CONTROL] Previous song from history requested")
            else:
                logger.info("⏮️ [CONTROL] Previous song requested")
            self.skip_requested = True
            self.skip_direction = 'previous'

    async def start_playback(self, is_mode_switch: bool = False):
        """Start playback - called when start_agent signal is received"""
        if self.is_paused:
            if is_mode_switch:
                # Mode switch - start immediately without waiting for button press
                logger.info("▶️ [MUSIC] Mode switch detected - starting playback immediately")
                self.start_event.set()
                self.is_first_interaction = False  # Skip first interaction logic
                self.waiting_for_first_interaction = False
                self.is_paused = False
                return {"status": "started", "message": "Music playback started (mode switch)"}
            else:
                # Fresh boot - wait for first button press
                logger.info("▶️ [MUSIC] Fresh boot detected - waiting for first button press...")
                # DON'T set start_event yet - wait for first button press
                self.waiting_for_first_interaction = True
                self.is_paused = False  # Mark as "ready" but not playing
                return {"status": "ready", "message": "Bot ready, waiting for user interaction"}
        else:
            logger.info("▶️ [MUSIC] Already ready/playing")
            return {"status": "already_ready", "message": "Bot is already ready"}

    async def play_specific_content(self, content_info: Dict, loop_enabled: bool = False):
        """
        Play specific content immediately, interrupting current playback.
        After specific content finishes, resume normal playlist flow.

        Args:
            content_info: Dict containing song metadata (title, filename, language, url)
            loop_enabled: If True, loop the specific content until skip is requested
        """
        async with self.skip_lock:
            logger.info(f"🎯 [MUSIC-SPECIFIC] Queuing specific song: {content_info.get('title', 'Unknown')}")

            # Store the specific content to play
            self.specific_content_queue = {
                'content_info': content_info,
                'loop_enabled': loop_enabled,
                'type': 'mobile_request'
            }

            # Trigger interruption of current playback
            self.skip_requested = True
            self.skip_direction = 'specific_content'

            logger.info(f"🎯 [MUSIC-SPECIFIC] Current playback will be interrupted")

    async def _handle_specific_music_request(self, request_data: Dict):
        """Handle specific music request from data channel"""
        try:
            song_name = request_data.get('content_name')
            language = request_data.get('language')
            loop_enabled = request_data.get('loop_enabled', False)

            logger.info(f"🔍 [MUSIC-SPECIFIC] Searching for song: '{song_name}', Language: {language or 'Any'}")

            # Search for the song in the database
            search_results = await music_service.search_songs_by_name(song_name, language, limit=1)

            if search_results and len(search_results) > 0:
                song_info = search_results[0]
                logger.info(f"✅ [MUSIC-SPECIFIC] Found song: '{song_info['title']}' (score: {song_info['score']:.2f})")

                # Request the bot to play this specific song
                await self.play_specific_content(song_info, loop_enabled)
            else:
                logger.warning(f"⚠️ [MUSIC-SPECIFIC] Song not found: '{song_name}'")

        except Exception as e:
            logger.error(f"❌ [MUSIC-SPECIFIC] Error: {e}")
            import traceback
            logger.error(f"❌ [MUSIC-SPECIFIC] Traceback: {traceback.format_exc()}")

    def get_current_status(self):
        """Get current playback status"""
        if self.random_mode:
            return {
                "current_index": -1,  # Indicate random mode
                "playlist_length": -1,  # Indicate infinite/random
                "current_song": self.current_random_song.get('title') if self.current_random_song else None,
                "current_filename": self.current_random_song.get('filename') if self.current_random_song else None,
                "mode": "random",
                "history_size": len(self.song_history)
            }
        elif self.playlist:
            current_song = self.playlist[self.current_index] if 0 <= self.current_index < len(self.playlist) else None
            return {
                "current_index": self.current_index,
                "playlist_length": len(self.playlist),
                "current_song": current_song.get('title') if current_song else None,
                "current_filename": current_song.get('filename') if current_song else None,
                "mode": "playlist"
            }
        else:
            return {
                "current_index": 0,
                "playlist_length": 0,
                "current_song": None,
                "mode": "none"
            }


class StoryBot(MediaBot):
    """Story streaming bot with skip control"""

    def __init__(self, room_name: str, token: str, age_group: Optional[str] = None, playlist: Optional[List[dict]] = None, analytics_service: Optional[AnalyticsService] = None):
        super().__init__(room_name, token, "story")
        self.age_group = age_group
        self.playlist = playlist  # List of {filename, category, title, etc.}
        self.current_index = 0  # Track current position in playlist
        self.skip_requested = False  # Flag to interrupt current story
        self.skip_direction = None  # 'next', 'previous', or None
        self.skip_lock = asyncio.Lock()  # Thread safety for skip operations
        self.current_stream_iterator = None  # Track current streaming iterator

        # Random mode support
        self.random_mode = not playlist or len(playlist) == 0  # True when playlist is empty
        self.current_random_story = None  # Current random story info
        self.story_history = []  # Keep track of last 10 random stories for previous functionality
        self.max_history = 10  # Maximum stories to remember
        self.history_index = -1  # Current position in history (-1 means at the end/latest)
        self.pending_previous_story = None  # Story to play on next iteration (for "previous" in random mode)

        # Specific content playback support (for mobile app requests)
        self.specific_content_queue = None  # Queue for specific story requests

        # Analytics service
        self.analytics_service = analytics_service

        # Paused state - bot waits for start_agent signal before streaming
        self.is_paused = True  # Start in paused state
        self.start_event = asyncio.Event()  # Event to signal start

        # First interaction tracking - bot waits for first button press to actually start playback
        self.is_first_interaction = True  # Track if this is the first button press
        self.waiting_for_first_interaction = True  # Bot is waiting for user to press button

    async def run(self):
        """Main entry point - connect and stream story with progressive streaming and skip support"""
        connection_retries = 3
        retry_delay = 2

        try:
            # Connect to LiveKit with retry mechanism
            connected = False
            for attempt in range(connection_retries):
                try:
                    if await self.connect_to_room():
                        connected = True
                        break
                    else:
                        logger.warning(f"⚠️ Connection attempt {attempt + 1}/{connection_retries} failed")
                        if attempt < connection_retries - 1:
                            await asyncio.sleep(retry_delay)
                except Exception as e:
                    logger.error(f"❌ Connection attempt {attempt + 1}/{connection_retries} error: {e}")
                    if attempt < connection_retries - 1:
                        await asyncio.sleep(retry_delay)

            if not connected:
                logger.error("❌ Failed to connect to room after all retries")
                return

            # Wait for start signal before streaming (paused state)
            if self.is_paused:
                logger.info("⏸️ [STORY] Bot connected, waiting for start_agent signal...")
                await self.start_event.wait()
                logger.info("▶️ [STORY] Start signal received, beginning playback")
                self.is_paused = False

            # Start analytics session
            if self.analytics_service:
                await self.analytics_service.start_session(mode_type="Story")

            # Check if playlist is provided
            if self.playlist and len(self.playlist) > 0:
                logger.info(f"📖 Using playlist with {len(self.playlist)} stories (looping enabled)")
                await self._run_playlist_mode()
            else:
                # No playlist - enter continuous random mode
                logger.info("📖 No playlist provided, entering continuous random mode")
                await self._run_random_mode()

            await asyncio.sleep(2)

        except asyncio.CancelledError:
            logger.info("🛑 Story bot task cancelled")
        except Exception as e:
            logger.error(f"❌ Story bot error: {e}")
            import traceback
            traceback.print_exc()
        finally:
            # End analytics session
            if self.analytics_service:
                await self.analytics_service.end_session(completion_status="completed")

            await self.disconnect()
            if self.room_name in active_bots:
                del active_bots[self.room_name]

    async def _run_playlist_mode(self):
        """Run playlist mode with looping and specific content support"""
        # Loop through playlist starting from current_index with looping
        while not self.should_stop:
            # Check if we need to play specific content first
            if self.specific_content_queue is not None:
                logger.info("🎯 [STORY-SPECIFIC] Playing specific content before continuing playlist")

                content_info = self.specific_content_queue['content_info']
                loop_enabled = self.specific_content_queue['loop_enabled']
                self.specific_content_queue = None  # Clear after extracting

                # Extract content details
                title = content_info.get('title', 'Unknown Story')
                filename = content_info.get('filename')
                category = content_info.get('category')

                if filename and category:
                    story_url = story_service.get_story_url(filename, category)
                    logger.info(f"🎯 [STORY-SPECIFIC] Playing: '{title}' ({category})")

                    # Reset skip flag before streaming
                    async with self.skip_lock:
                        self.skip_requested = False
                        self.skip_direction = None

                    # Stream the specific content
                    if loop_enabled:
                        # Loop the specific content until interrupted
                        logger.info(f"🎯 [STORY-SPECIFIC] Loop mode enabled for '{title}'")
                        while not self.should_stop and not self.skip_requested:
                            await self._stream_story(story_url, title, media_id=filename, category=category)
                            if not self.should_stop and not self.skip_requested:
                                await asyncio.sleep(1)  # Small gap between loops
                    else:
                        # Play once
                        await self._stream_story(story_url, title, media_id=filename, category=category)

                    logger.info(f"🎯 [STORY-SPECIFIC] Finished streaming: '{title}'")

                    # After specific content, continue with normal playlist flow
                    if self.should_stop:
                        break

                    # Small gap before continuing playlist
                    await asyncio.sleep(1)
                else:
                    logger.error(f"🎯 [STORY-SPECIFIC] Invalid content info: {content_info}")

                # Continue to next iteration to play normal playlist
                # NOTE: current_index is NOT modified, so playlist resumes from same story
                continue

            # Get current playlist item
            playlist_item = self.playlist[self.current_index]

            # Extract metadata from playlist item
            filename = playlist_item.get('filename')
            category = playlist_item.get('category')  # Adventure, Bedtime, Fantasy, etc.
            title = playlist_item.get('title', filename)

            if not filename or not category:
                logger.warning(f"⚠️ Skipping invalid playlist item: {playlist_item}")
                # Move to next
                self.current_index = (self.current_index + 1) % len(self.playlist)
                continue

            # Construct URL using story_service
            story_url = story_service.get_story_url(filename, category)
            logger.info(f"📖 [{self.current_index + 1}/{len(self.playlist)}] Playing: '{title}' ({category})")

            # Reset skip flag before streaming
            async with self.skip_lock:
                self.skip_requested = False
                self.skip_direction = None

            # Stream this story (can be interrupted by skip)
            logger.info(f"📖 About to start streaming: '{title}'")
            await self._stream_story(story_url, title, media_id=filename, category=category)
            logger.info(f"📖 Finished streaming call for: '{title}'")

            if self.should_stop:
                logger.info(f"📖 should_stop is True, breaking main loop")
                break

            # Check if skip was requested during streaming
            was_skipped = False
            async with self.skip_lock:
                if self.skip_requested:
                    was_skipped = True
                    if self.skip_direction == 'next':
                        logger.info("⏭️ Skipping to next story")
                        self.current_index = (self.current_index + 1) % len(self.playlist)
                        logger.info(f"📖 New index after next skip: {self.current_index}")
                    elif self.skip_direction == 'previous':
                        logger.info("⏮️ Going to previous story")
                        self.current_index = (self.current_index - 1) % len(self.playlist)
                        logger.info(f"📖 New index after previous skip: {self.current_index}")
                    self.skip_requested = False
                    logger.info(f"📖 Skip processed, continuing to next iteration")
                else:
                    # Normal progression - story finished naturally, go to next
                    self.current_index = (self.current_index + 1) % len(self.playlist)
                    logger.info(f"🔄 Auto-advancing to next story (index: {self.current_index})")

            # Small gap between stories - only when story ended naturally, not on skip
            if not self.should_stop and not was_skipped:
                await asyncio.sleep(1)

        logger.info("✅ Playlist stopped")

    async def _run_random_mode(self):
        """Run continuous random mode with skip support and specific content requests"""
        while not self.should_stop:
            # Check if we need to play specific content first (from mobile app request)
            if self.specific_content_queue is not None:
                logger.info("🎯 [STORY-SPECIFIC] Playing specific content before continuing random mode")

                content_info = self.specific_content_queue['content_info']
                loop_enabled = self.specific_content_queue['loop_enabled']
                self.specific_content_queue = None  # Clear after extracting

                # Extract content details
                title = content_info.get('title', 'Unknown Story')
                filename = content_info.get('filename')
                category = content_info.get('category')

                if filename and category:
                    story_url = story_service.get_story_url(filename, category)
                    logger.info(f"🎯 [STORY-SPECIFIC] Playing: '{title}' ({category})")

                    # Reset skip flag before streaming
                    async with self.skip_lock:
                        self.skip_requested = False
                        self.skip_direction = None

                    # Stream the specific content
                    if loop_enabled:
                        # Loop the specific content until interrupted
                        logger.info(f"🎯 [STORY-SPECIFIC] Loop mode enabled for '{title}'")
                        while not self.should_stop and not self.skip_requested:
                            await self._stream_story(story_url, title, media_id=filename, category=category)
                            if not self.should_stop and not self.skip_requested:
                                await asyncio.sleep(1)  # Small gap between loops
                    else:
                        # Play once
                        await self._stream_story(story_url, title, media_id=filename, category=category)

                    logger.info(f"🎯 [STORY-SPECIFIC] Finished streaming: '{title}'")

                    # After specific content, continue with normal random flow
                    if self.should_stop:
                        break

                    # Small gap before continuing random mode
                    await asyncio.sleep(1)
                else:
                    logger.error(f"🎯 [STORY-SPECIFIC] Invalid content info: {content_info}")

                # Continue to next iteration to play normal random story
                continue

            # Check if we have a pending previous story to play (from "previous" skip request)
            if self.pending_previous_story is not None:
                story = self.pending_previous_story
                self.pending_previous_story = None  # Clear after using
                logger.info(f"📖 [RANDOM] Playing previous story from history: '{story['title']}'")
                is_from_history = True
            else:
                # Get random story
                story = await story_service.get_random_story(category=self.age_group)
                is_from_history = False

                if not story:
                    logger.error("❌ No stories available in random mode")
                    break

            # Store current story info
            self.current_random_story = {
                'title': story.get('title'),
                'category': story.get('category', self.age_group),
                'url': story.get('url'),
                'filename': story.get('filename', story.get('title', 'unknown'))
            }

            if not is_from_history:
                logger.info(f"📖 [RANDOM] Playing: '{self.current_random_story['title']}' ({self.current_random_story['category']})")

            # Add to history BEFORE streaming so "previous" works correctly during playback
            if not is_from_history:
                self._add_to_history(self.current_random_story)

            # Reset skip flag before streaming
            async with self.skip_lock:
                self.skip_requested = False
                self.skip_direction = None

            # Stream this random story (can be interrupted by skip)
            logger.info(f"📖 About to start streaming random: '{story['title']}'")
            await self._stream_story(story['url'], story['title'], media_id=story.get('filename', story['title']), category=story.get('category'))
            logger.info(f"📖 Finished streaming random call for: '{story['title']}'")

            if self.should_stop:
                logger.info(f"📖 should_stop is True, breaking random loop")
                break

            # Check if skip was requested during streaming
            was_skipped = False
            async with self.skip_lock:
                if self.skip_requested:
                    was_skipped = True
                    if self.skip_direction == 'next':
                        logger.info("⏭️ [RANDOM] Skipping to next random story")
                    elif self.skip_direction == 'previous':
                        logger.info("⏮️ [RANDOM] Going to previous story from history")
                        # Try to get previous story from history
                        previous_story = self._get_previous_from_history()
                        if previous_story:
                            # Set pending_previous_story so the next loop iteration plays it
                            self.pending_previous_story = previous_story
                            logger.info(f"📖 [RANDOM] Queued previous story: '{previous_story['title']}'")
                        else:
                            logger.info("📖 [RANDOM] No previous story in history, getting new random")
                    self.skip_requested = False
                    logger.info(f"📖 [RANDOM] Skip processed, continuing to next iteration")
                else:
                    # Normal progression - story finished naturally, get next random
                    logger.info(f"🔄 [RANDOM] Story finished naturally, getting next random")

            # Small gap between stories - only when story ended naturally, not on skip
            if not self.should_stop and not was_skipped:
                await asyncio.sleep(1)

        logger.info("✅ Random mode stopped")

    def _add_to_history(self, story_info):
        """Add story to history for previous functionality"""
        # If we're navigating back in history and a new story is added, truncate future history
        if self.history_index >= 0 and self.history_index < len(self.story_history) - 1:
            # We were in the middle of history, truncate everything after current position
            self.story_history = self.story_history[:self.history_index + 1]

        self.story_history.append(story_info)
        # Keep only last N stories
        if len(self.story_history) > self.max_history:
            self.story_history.pop(0)

        # Reset history index to point to the latest story
        self.history_index = len(self.story_history) - 1
        logger.info(f"📖 [HISTORY] Added to history: '{story_info['title']}' (history size: {len(self.story_history)}, index: {self.history_index})")

    def _get_previous_from_history(self):
        """Get previous story from history using index-based navigation (non-destructive)"""
        if len(self.story_history) == 0:
            logger.info("📖 [HISTORY] No stories in history")
            return None

        # Calculate the target index (one step back)
        if self.history_index < 0:
            # history_index is -1, meaning we're at the end
            target_index = len(self.story_history) - 2  # Go to second-to-last
        else:
            target_index = self.history_index - 1  # Go one step back

        if target_index < 0:
            logger.info(f"📖 [HISTORY] Already at the beginning of history (index: {self.history_index}, size: {len(self.story_history)})")
            return None

        # Update index and return the story at that position
        self.history_index = target_index
        previous_story = self.story_history[target_index]
        logger.info(f"📖 [HISTORY] Moving to index {target_index}: '{previous_story['title']}' (history size: {len(self.story_history)})")
        return previous_story

    async def _stream_story(self, story_url: str, title: str, media_id: str = None, category: str = None):
        """Stream a single story using progressive streaming - can be interrupted by skip"""
        from datetime import datetime

        # Track analytics - story started
        started_at = datetime.now()
        was_skipped = False
        skip_action = None

        # Log CDN URL for debugging
        logger.info(f"🔗 [CDN] URL for '{title}': {story_url}")

        # Create streaming iterator for progressive download & conversion
        stream_iterator = StreamingAudioIterator(
            cdn_url=story_url,
            stop_event=self.should_stop,
            title=title
        )
        self.current_stream_iterator = stream_iterator

        # Stream frames as they become available (audio starts immediately!)
        logger.info(f"📖 Starting progressive stream to LiveKit...")
        frame_count = 0

        try:
            async for frame in stream_iterator:
                # Check for skip or stop
                if self.should_stop or self.skip_requested:
                    if self.skip_requested:
                        logger.info(f"⏭️ Skip requested, interrupting stream...")
                        was_skipped = True
                        skip_action = self.skip_direction if self.skip_direction else "next"
                    else:
                        logger.info(f"⏹️ Stop requested, interrupting stream...")

                    logger.info(f"📖 About to close stream iterator...")
                    try:
                        await stream_iterator.close()  # Stop download
                        logger.info(f"📖 Stream iterator closed successfully")
                    except Exception as close_error:
                        logger.error(f"❌ Error closing stream iterator: {close_error}")

                    # Send silence frames to flush LiveKit's buffer and stop audio immediately
                    await self._send_silence_frames(num_frames=10)  # ~200ms of silence

                    logger.info(f"📖 Breaking from streaming loop")
                    break

                # Send frame to LiveKit room
                await self.audio_source.capture_frame(frame)
                frame_count += 1

                # Progress indicator every 500 frames (~10 seconds)
                if frame_count % 500 == 0:
                    logger.info(f"   📖 Streamed {frame_count} frames...")

            logger.info(f"✅ Finished streaming '{title}' ({frame_count} frames)")
        except Exception as e:
            logger.error(f"❌ Error in _stream_story: {e}")
        finally:
            logger.info(f"📖 _stream_story finally block for '{title}'")
            self.current_stream_iterator = None
            
            # Track analytics - story ended
            if self.analytics_service and media_id:
                try:
                    ended_at = datetime.now()
                    duration_played = int((ended_at - started_at).total_seconds())
                    
                    logger.info(f"📊 [STORY] Recording playback: {title}, duration={duration_played}s, skip={skip_action}")
                    
                    await self.analytics_service.record_media_playback(
                        media_type="story",
                        media_id=media_id,
                        media_title=title,
                        started_at=started_at,
                        ended_at=ended_at,
                        duration_played_seconds=duration_played,
                        skip_action=skip_action,
                        metadata={'category': category, 'was_skipped': was_skipped} if category else {'was_skipped': was_skipped}
                    )
                    
                    logger.info(f"📊✅ [STORY] Playback recorded successfully")
                except Exception as e:
                    logger.error(f"📊❌ [STORY] Failed to record playback: {e}")
                    import traceback
                    logger.error(f"📊❌ [STORY] Traceback: {traceback.format_exc()}")

    async def _send_silence_frames(self, num_frames: int = 10):
        """Send silence frames to flush LiveKit's audio buffer and stop audio immediately"""
        try:
            sample_rate = 48000
            samples_per_frame = 960  # 20ms at 48kHz
            silence_data = b'\x00' * (samples_per_frame * 2)  # 16-bit = 2 bytes per sample

            logger.info(f"🔇 Sending {num_frames} silence frames to flush buffer...")

            for _ in range(num_frames):
                silence_frame = rtc.AudioFrame(
                    data=silence_data,
                    sample_rate=sample_rate,
                    num_channels=1,
                    samples_per_channel=samples_per_frame
                )
                await self.audio_source.capture_frame(silence_frame)

            logger.info(f"🔇 Silence frames sent successfully")
        except Exception as e:
            logger.error(f"❌ Error sending silence frames: {e}")

    async def skip_to_next(self):
        """Request skip to next story (works in both playlist and random mode)"""
        async with self.skip_lock:
            # Check if this is the first interaction
            if self.is_first_interaction and self.waiting_for_first_interaction:
                logger.info("▶️ [FIRST-INTERACTION] First button press detected - starting playback from story 1")
                self.is_first_interaction = False
                self.waiting_for_first_interaction = False
                self.start_event.set()  # NOW trigger playback to start
                # Don't set skip_requested - let it play story 1 from beginning
                return
            
            # Normal skip behavior
            if self.random_mode:
                logger.info("⏭️ [CONTROL] Next random story requested")
            else:
                logger.info("⏭️ [CONTROL] Next story requested")
            self.skip_requested = True
            self.skip_direction = 'next'

    async def skip_to_previous(self):
        """Request skip to previous story (works in both playlist and random mode)"""
        async with self.skip_lock:
            # Check if this is the first interaction
            if self.is_first_interaction and self.waiting_for_first_interaction:
                logger.info("▶️ [FIRST-INTERACTION] First button press detected - starting playback from story 1")
                self.is_first_interaction = False
                self.waiting_for_first_interaction = False
                self.start_event.set()  # NOW trigger playback to start
                # Don't set skip_requested - let it play story 1 from beginning
                return
            
            # Normal skip behavior
            if self.random_mode:
                logger.info("⏮️ [CONTROL] Previous story from history requested")
            else:
                logger.info("⏮️ [CONTROL] Previous story requested")
            self.skip_requested = True
            self.skip_direction = 'previous'

    async def start_playback(self, is_mode_switch: bool = False):
        """Start playback - called when start_agent signal is received"""
        if self.is_paused:
            if is_mode_switch:
                # Mode switch - start immediately without waiting for button press
                logger.info("▶️ [STORY] Mode switch detected - starting playback immediately")
                self.start_event.set()
                self.is_first_interaction = False  # Skip first interaction logic
                self.waiting_for_first_interaction = False
                self.is_paused = False
                return {"status": "started", "message": "Story playback started (mode switch)"}
            else:
                # Fresh boot - wait for first button press (same as music)
                logger.info("▶️ [STORY] Fresh boot detected - waiting for first button press...")
                # DON'T set start_event yet - wait for first button press
                self.waiting_for_first_interaction = True
                self.is_paused = False  # Mark as "ready" but not playing
                return {"status": "ready", "message": "Bot ready, waiting for user interaction"}
        else:
            logger.info("▶️ [STORY] Already playing")
            return {"status": "already_playing", "message": "Story is already playing"}

    async def play_specific_content(self, content_info: Dict, loop_enabled: bool = False):
        """
        Play specific content immediately, interrupting current playback.
        After specific content finishes, resume normal playlist flow.

        Args:
            content_info: Dict containing story metadata (title, filename, category, url)
            loop_enabled: If True, loop the specific content until skip is requested
        """
        async with self.skip_lock:
            logger.info(f"🎯 [STORY-SPECIFIC] Queuing specific story: {content_info.get('title', 'Unknown')}")

            # Store the specific content to play
            self.specific_content_queue = {
                'content_info': content_info,
                'loop_enabled': loop_enabled,
                'type': 'mobile_request'
            }

            # Trigger interruption of current playback
            self.skip_requested = True
            self.skip_direction = 'specific_content'

            logger.info(f"🎯 [STORY-SPECIFIC] Current playback will be interrupted")

    async def _handle_specific_story_request(self, request_data: Dict):
        """Handle specific story request from data channel"""
        try:
            story_name = request_data.get('content_name')
            category = request_data.get('category')
            loop_enabled = request_data.get('loop_enabled', False)

            logger.info(f"🔍 [STORY-SPECIFIC] Searching for story: '{story_name}', Category: {category or 'Any'}")

            # Search for the story in the database
            search_results = await story_service.search_stories_by_name(story_name, category, limit=1)

            if search_results and len(search_results) > 0:
                story_info = search_results[0]
                logger.info(f"✅ [STORY-SPECIFIC] Found story: '{story_info['title']}' (score: {story_info['score']:.2f})")

                # Request the bot to play this specific story
                await self.play_specific_content(story_info, loop_enabled)
            else:
                logger.warning(f"⚠️ [STORY-SPECIFIC] Story not found: '{story_name}'")

        except Exception as e:
            logger.error(f"❌ [STORY-SPECIFIC] Error: {e}")
            import traceback
            logger.error(f"❌ [STORY-SPECIFIC] Traceback: {traceback.format_exc()}")

    def get_current_status(self):
        """Get current playback status"""
        if self.random_mode:
            return {
                "current_index": -1,  # Indicate random mode
                "playlist_length": -1,  # Indicate infinite/random
                "current_story": self.current_random_story.get('title') if self.current_random_story else None,
                "current_filename": self.current_random_story.get('filename') if self.current_random_story else None,
                "mode": "random",
                "history_size": len(self.story_history)
            }
        elif self.playlist:
            current_story = self.playlist[self.current_index] if 0 <= self.current_index < len(self.playlist) else None
            return {
                "current_index": self.current_index,
                "playlist_length": len(self.playlist),
                "current_story": current_story.get('title') if current_story else None,
                "current_filename": current_story.get('filename') if current_story else None,
                "mode": "playlist"
            }
        else:
            return {
                "current_index": 0,
                "playlist_length": 0,
                "current_story": None,
                "mode": "none"
            }


@app.post("/start-music-bot")
async def start_music_bot(req: StartMusicBotRequest):
    """Start music bot that joins LiveKit room and streams music"""
    try:
        playlist_info = f", playlist: {len(req.playlist)} songs" if req.playlist else ""
        logger.info(f"🎵 Starting music bot for room: {req.room_name}, language: {req.language or 'all'}{playlist_info}")

        # Check if bot already exists for this room
        if req.room_name in active_bots:
            logger.warning(f"Bot already active for room: {req.room_name}")
            return {"status": "already_active", "room_name": req.room_name}

        # Create token for bot (use "agent" in identity so gateway recognizes it)
        token = create_bot_token(req.room_name, "music-agent-bot")

        # Extract MAC address from room_name (format: uuid_mac_mode)
        # Example: "75ba3756-3693-4486-adff-daac0d13ef1d_6825ddbbf3a0_music"
        mac_address = None
        try:
            parts = req.room_name.split('_')
            if len(parts) >= 2:
                mac_address = parts[1]  # Get MAC part
        except Exception as e:
            logger.warning(f"Could not extract MAC from room_name: {req.room_name}, error: {e}")

        # Create analytics service for this bot
        analytics_service = None
        if mac_address and MANAGER_API_SECRET:
            try:
                analytics_service = AnalyticsService(
                    manager_api_url=MANAGER_API_URL,
                    secret=MANAGER_API_SECRET,
                    device_mac=format_mac_address(mac_address),
                    session_id=req.room_name,
                    agent_id="music-agent-bot"
                )
                logger.info(f"📊 Analytics service created for Music bot - MAC: {mac_address}")
            except Exception as e:
                logger.error(f"❌ Failed to create analytics service: {e}")

        # Create and start music bot with playlist
        bot = MusicBot(req.room_name, token, req.language, req.playlist, analytics_service)

        # Store bot reference
        active_bots[req.room_name] = bot

        # Run bot in background and store task reference for proper cleanup
        bot.task = asyncio.create_task(bot.run())

        logger.info(f"✅ Music bot started for room: {req.room_name}")

        return {
            "status": "started",
            "room_name": req.room_name,
            "bot_type": "music",
            "language": req.language or "all",
            "playlist_size": len(req.playlist) if req.playlist else 0
        }

    except Exception as e:
        logger.error(f"❌ Error starting music bot: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/start-story-bot")
async def start_story_bot(req: StartStoryBotRequest):
    """Start story bot that joins LiveKit room and streams story"""
    try:
        playlist_info = f", playlist: {len(req.playlist)} stories" if req.playlist else ""
        logger.info(f"📖 Starting story bot for room: {req.room_name}{playlist_info}")

        if req.room_name in active_bots:
            logger.warning(f"Bot already active for room: {req.room_name}")
            return {"status": "already_active", "room_name": req.room_name}

        # Create token for bot (use "agent" in identity so gateway recognizes it)
        token = create_bot_token(req.room_name, "story-agent-bot")

        # Extract MAC address from room_name (format: uuid_mac_mode)
        # Example: "75ba3756-3693-4486-adff-daac0d13ef1d_6825ddbbf3a0_story"
        mac_address = None
        try:
            parts = req.room_name.split('_')
            if len(parts) >= 2:
                mac_address = parts[1]  # Get MAC part
        except Exception as e:
            logger.warning(f"Could not extract MAC from room_name: {req.room_name}, error: {e}")

        # Create analytics service for this bot
        analytics_service = None
        if mac_address and MANAGER_API_SECRET:
            try:
                analytics_service = AnalyticsService(
                    manager_api_url=MANAGER_API_URL,
                    secret=MANAGER_API_SECRET,
                    device_mac=format_mac_address(mac_address),
                    session_id=req.room_name,
                    agent_id="story-agent-bot"
                )
                logger.info(f"📊 Analytics service created for Story bot - MAC: {mac_address}")
            except Exception as e:
                logger.error(f"❌ Failed to create analytics service: {e}")

        # Create and start story bot with playlist
        bot = StoryBot(req.room_name, token, req.age_group, req.playlist, analytics_service)
        active_bots[req.room_name] = bot

        # Run bot in background and store task reference for proper cleanup
        bot.task = asyncio.create_task(bot.run())

        logger.info(f"✅ Story bot started for room: {req.room_name}")

        return {
            "status": "started",
            "room_name": req.room_name,
            "bot_type": "story",
            "playlist_size": len(req.playlist) if req.playlist else 0
        }

    except Exception as e:
        logger.error(f"❌ Error starting story bot: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/stop-bot")
async def stop_bot(req: StopBotRequest):
    """Stop a running bot for a specific room"""
    try:
        if req.room_name not in active_bots:
            logger.warning(f"No active bot found for room: {req.room_name}")
            return {"status": "not_found", "room_name": req.room_name}

        bot = active_bots[req.room_name]

        logger.info(f"🛑 Stopping bot for room: {req.room_name}")

        # Signal bot to stop
        bot.should_stop = True

        # If bot has a start_event that might be waiting, set it to unblock
        if hasattr(bot, 'start_event') and bot.start_event:
            bot.start_event.set()

        # Cancel the task and wait for it to complete properly
        if bot.task and not bot.task.done():
            bot.task.cancel()
            try:
                # Wait for task to handle cancellation (disconnect happens in finally block)
                await asyncio.wait_for(bot.task, timeout=10.0)
            except asyncio.CancelledError:
                logger.info(f"✅ Bot task cancelled successfully")
            except asyncio.TimeoutError:
                logger.warning(f"⚠️ Bot task cancellation timed out, forcing disconnect")
                await bot.disconnect()
        else:
            # Task already done, just disconnect
            await bot.disconnect()

        # Remove from active bots
        if req.room_name in active_bots:
            del active_bots[req.room_name]

        logger.info(f"✅ Bot stopped for room: {req.room_name}")

        return {"status": "stopped", "room_name": req.room_name}

    except Exception as e:
        logger.error(f"❌ Error stopping bot: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/music-bot/{room_name}/next")
async def music_bot_skip_next(room_name: str):
    """Skip to next song in music playlist"""
    try:
        logger.info(f"🎵 [API] Next song request for room: {room_name}")

        if room_name not in active_bots:
            raise HTTPException(status_code=404, detail=f"Music bot not found in room: {room_name}")

        bot = active_bots[room_name]

        if not isinstance(bot, MusicBot):
            raise HTTPException(status_code=400, detail=f"Bot in room {room_name} is not a music bot")

        await bot.skip_to_next()

        return {
            "status": "success",
            "message": "Skipping to next song",
            "current_status": bot.get_current_status()
        }

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"❌ Error skipping to next song: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/music-bot/{room_name}/previous")
async def music_bot_skip_previous(room_name: str):
    """Skip to previous song in music playlist"""
    try:
        logger.info(f"🎵 [API] Previous song request for room: {room_name}")

        if room_name not in active_bots:
            raise HTTPException(status_code=404, detail=f"Music bot not found in room: {room_name}")

        bot = active_bots[room_name]

        if not isinstance(bot, MusicBot):
            raise HTTPException(status_code=400, detail=f"Bot in room {room_name} is not a music bot")

        await bot.skip_to_previous()

        return {
            "status": "success",
            "message": "Skipping to previous song",
            "current_status": bot.get_current_status()
        }

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"❌ Error skipping to previous song: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/music-bot/{room_name}/start")
async def music_bot_start(room_name: str, request: dict = Body(...)):
    """Start music playback - triggers the bot to begin streaming after start_agent signal"""
    try:
        is_mode_switch = request.get("is_mode_switch", False)
        logger.info(f"▶️ [API] Start music bot request for room: {room_name}, is_mode_switch: {is_mode_switch}")

        if room_name not in active_bots:
            raise HTTPException(status_code=404, detail=f"Music bot not found in room: {room_name}")

        bot = active_bots[room_name]

        if not isinstance(bot, MusicBot):
            raise HTTPException(status_code=400, detail=f"Bot in room {room_name} is not a music bot")

        result = await bot.start_playback(is_mode_switch=is_mode_switch)

        return {
            "status": result["status"],
            "message": result["message"],
            "room_name": room_name
        }

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"❌ Error starting music bot: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/story-bot/{room_name}/start")
async def story_bot_start(room_name: str, request: dict = Body(...)):
    """Start story playback - triggers the bot to begin streaming after start_agent signal"""
    try:
        is_mode_switch = request.get("is_mode_switch", False)
        logger.info(f"▶️ [API] Start story bot request for room: {room_name}, is_mode_switch: {is_mode_switch}")

        if room_name not in active_bots:
            raise HTTPException(status_code=404, detail=f"Story bot not found in room: {room_name}")

        bot = active_bots[room_name]

        if not isinstance(bot, StoryBot):
            raise HTTPException(status_code=400, detail=f"Bot in room {room_name} is not a story bot")

        result = await bot.start_playback(is_mode_switch=is_mode_switch)

        return {
            "status": result["status"],
            "message": result["message"],
            "room_name": room_name
        }

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"❌ Error starting story bot: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/story-bot/{room_name}/next")
async def story_bot_skip_next(room_name: str):
    """Skip to next story in story playlist"""
    try:
        logger.info(f"📖 [API] Next story request for room: {room_name}")

        if room_name not in active_bots:
            raise HTTPException(status_code=404, detail=f"Story bot not found in room: {room_name}")

        bot = active_bots[room_name]

        if not isinstance(bot, StoryBot):
            raise HTTPException(status_code=400, detail=f"Bot in room {room_name} is not a story bot")

        await bot.skip_to_next()

        return {
            "status": "success",
            "message": "Skipping to next story",
            "current_status": bot.get_current_status()
        }

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"❌ Error skipping to next story: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/story-bot/{room_name}/previous")
async def story_bot_skip_previous(room_name: str):
    """Skip to previous story in story playlist"""
    try:
        logger.info(f"📖 [API] Previous story request for room: {room_name}")

        if room_name not in active_bots:
            raise HTTPException(status_code=404, detail=f"Story bot not found in room: {room_name}")

        bot = active_bots[room_name]

        if not isinstance(bot, StoryBot):
            raise HTTPException(status_code=400, detail=f"Bot in room {room_name} is not a story bot")

        await bot.skip_to_previous()

        return {
            "status": "success",
            "message": "Skipping to previous story",
            "current_status": bot.get_current_status()
        }

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"❌ Error skipping to previous story: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/bot/{room_name}/status")
async def get_bot_status(room_name: str):
    """Get current playback status"""
    try:
        if room_name not in active_bots:
            raise HTTPException(status_code=404, detail=f"Bot not found in room: {room_name}")

        bot = active_bots[room_name]

        return {
            "room_name": room_name,
            "bot_type": bot.bot_type,
            "status": bot.get_current_status()
        }

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"❌ Error getting bot status: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/health")
async def health_check():
    return {
        "status": "healthy",
        "active_bots": len(active_bots),
        "music_service": music_service.is_initialized if music_service else False,
        "story_service": story_service.is_initialized if story_service else False
    }


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8003, log_level="info")
