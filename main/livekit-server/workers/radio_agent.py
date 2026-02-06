import asyncio
import logging
import os
import signal
import sys
import json
from datetime import datetime
import io

import aiohttp
from livekit import rtc, api
from pydub import AudioSegment

# Add parent directory to path to import src
current_dir = os.path.dirname(os.path.abspath(__file__))
parent_dir = os.path.dirname(current_dir)
sys.path.append(parent_dir)

from src.utils.database_helper import DatabaseHelper
from src.services.music_service import MusicService

# Configure logging
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger("radio-agent")

# Load environment variables
from dotenv import load_dotenv
load_dotenv(os.path.join(parent_dir, ".env"))

# Environment variables
LIVEKIT_URL = os.getenv("LIVEKIT_URL")
LIVEKIT_API_KEY = os.getenv("LIVEKIT_API_KEY")
LIVEKIT_API_SECRET = os.getenv("LIVEKIT_API_SECRET")
MANAGER_API_URL = os.getenv("MANAGER_API_URL", "http://localhost:3000/toy")
MANAGER_API_SECRET = os.getenv("MANAGER_API_SECRET", "default-secret")
RADIO_PORT = int(os.getenv("RADIO_PORT", "8082"))

if not LIVEKIT_URL or not LIVEKIT_API_KEY or not LIVEKIT_API_SECRET:
    logger.error("❌ Missing required environment variables: LIVEKIT_URL, LIVEKIT_API_KEY, LIVEKIT_API_SECRET")
    sys.exit(1)

logger.info(f"📻 Radio Agent starting config: URL={LIVEKIT_URL}, Manager={MANAGER_API_URL}, Port={RADIO_PORT}")

class StreamingAudioIterator:
    """
    Async iterator that downloads MP3 chunks from CDN and converts to LiveKit frames on-the-fly.
    Copied/Adapted from media_api.py
    """

    def __init__(self, cdn_url: str, stop_event, title: str):
        self.cdn_url = cdn_url
        self.stop_event = stop_event
        self.title = title
        self.chunk_size = 64 * 1024  # 64KB chunks
        self.frame_queue = asyncio.Queue(maxsize=100)  # Buffer up to 100 frames
        self.producer_task = None
        self.session = None
        self.is_closed = False

    async def close(self):
        """Explicitly close the iterator and stop download"""
        self.is_closed = True
        
        # Cancel producer task
        if self.producer_task and not self.producer_task.done():
            self.producer_task.cancel()
            logger.info(f"🎵 Producer task cancelled")

        # Close session
        if self.session:
            try:
                # Use create_task to close session in background without waiting
                asyncio.create_task(self.session.close())
            except:
                pass

        # Clear queue
        while not self.frame_queue.empty():
            try:
                self.frame_queue.get_nowait()
            except asyncio.QueueEmpty:
                break
        
        # Signal end
        try:
            # Non-blocking put attempt
            if not self.frame_queue.full():
                self.frame_queue.put_nowait(None)
        except:
            pass

    async def _produce_frames(self):
        """Background task: Download MP3 chunks, convert to PCM, create LiveKit frames"""
        try:
            logger.info(f"🎵 Starting progressive download: {self.title}")
            logger.info(f"🔗 URL: {self.cdn_url}")

            self.session = aiohttp.ClientSession()
            async with self.session.get(self.cdn_url, timeout=aiohttp.ClientTimeout(total=300)) as response:
                if response.status != 200:
                    raise Exception(f"CDN returned status {response.status}")

                mp3_buffer = bytearray()
                
                # LiveKit audio parameters
                sample_rate = 48000
                frame_duration_ms = 20
                samples_per_frame = sample_rate * frame_duration_ms // 1000  # 960 samples

                async for chunk in response.content.iter_chunked(self.chunk_size):
                    if self.stop_event or self.is_closed:
                        break

                    mp3_buffer.extend(chunk)

                    # Try to decode accumulated MP3 data
                    try:
                        audio_segment = AudioSegment.from_mp3(io.BytesIO(bytes(mp3_buffer)))

                        # Convert to LiveKit format: 48kHz, mono, 16-bit
                        audio_segment = audio_segment.set_frame_rate(sample_rate)
                        audio_segment = audio_segment.set_channels(1)
                        audio_segment = audio_segment.set_sample_width(2)

                        raw_pcm = audio_segment.raw_data
                        mp3_buffer.clear() # Clear buffer on success

                        # Split PCM into LiveKit frames
                        total_samples = len(raw_pcm) // 2
                        total_frames = total_samples // samples_per_frame

                        for frame_num in range(total_frames):
                            if self.stop_event or self.is_closed:
                                break

                            start_byte = frame_num * samples_per_frame * 2
                            end_byte = start_byte + (samples_per_frame * 2)
                            frame_data = raw_pcm[start_byte:end_byte]

                            if len(frame_data) < samples_per_frame * 2:
                                break

                            audio_frame = rtc.AudioFrame(
                                data=frame_data,
                                sample_rate=sample_rate,
                                num_channels=1,
                                samples_per_channel=samples_per_frame
                            )

                            await self.frame_queue.put(audio_frame) # Flow control backpressure via queue size

                    except Exception:
                        # Continue accumulating data if not enough for a frame or decode fails
                        continue

            logger.info(f"✅ Download finished: {self.title}")

        except Exception as e:
            if not self.is_closed:
                logger.error(f"❌ Producer error: {e}")
        finally:
            # Signal end of stream
            await self.frame_queue.put(None)

    def __aiter__(self):
        self.producer_task = asyncio.create_task(self._produce_frames())
        return self

    async def __anext__(self):
        if self.is_closed and self.frame_queue.empty():
             raise StopAsyncIteration

        try:
            frame = await self.frame_queue.get()
            if frame is None:
                raise StopAsyncIteration
            return frame
        except asyncio.CancelledError:
            raise StopAsyncIteration

class RadioAgent:
    def __init__(self, room: rtc.Room):
        self.room = room
        self.db_helper = DatabaseHelper(MANAGER_API_URL, MANAGER_API_SECRET)
        self.music_service = MusicService()
        self.should_stop = False
        self.current_schedule = []
        self.current_program = None
        self.audio_source = None
        self.audio_track = None
        
        # Audio setup
        self.sample_rate = 48000
        self.num_channels = 1
        
        # Scheduling
        self.schedule_task = None
        self.current_iterator = None

    async def start(self):
        logger.info(f"📻 Radio Agent initialized for room: {self.room.name}")
        
        # Initialize music service
        await self.music_service.initialize()
        
        # Create audio track
        self.audio_source = rtc.AudioSource(self.sample_rate, self.num_channels)
        self.audio_track = rtc.LocalAudioTrack.create_audio_track("radio-main", self.audio_source)
        await self.room.local_participant.publish_track(self.audio_track)
        logger.info("📻 Audio track published")

        # Start scheduler loop
        self.schedule_task = asyncio.create_task(self._scheduler_loop())
        
        # Keep agent alive
        try:
            logger.info("📻 Agent running. Press Ctrl+C to stop.")
            # Create a future that never completes effectively, or wait for disconnect event
            stop_event = asyncio.Event()
            
            @self.room.on("disconnected")
            def on_disconnected(reason):
                logger.info(f"📻 Disconnected: {reason}")
                stop_event.set()
            
            await stop_event.wait()
            
        except asyncio.CancelledError:
             logger.info("📻 Agent cancelled")
        except Exception as e:
             logger.error(f"❌ Error during execution: {e}", exc_info=True)
        finally:
            self.should_stop = True
            if self.schedule_task:
                self.schedule_task.cancel()
            if self.current_iterator:
                await self.current_iterator.close()
            logger.info("📻 Radio Agent stopped")

    def _get_current_program(self, schedule: list) -> dict:
        """Find the program matching the current time"""
        if not schedule:
            return None

        now = datetime.now()
        current_time = now.strftime('%H:%M:%S')

        for program in schedule:
            start_time = program.get('start_time', '00:00:00')
            end_time = program.get('end_time', '23:59:59')

            # Handle time strings (could be "HH:MM:SS" or datetime objects)
            if hasattr(start_time, 'strftime'):
                start_time = start_time.strftime('%H:%M:%S')
            if hasattr(end_time, 'strftime'):
                end_time = end_time.strftime('%H:%M:%S')

            # Check if current time falls within this program's slot
            # Handle midnight crossover (e.g., 22:00:00 to 06:00:00)
            if start_time <= end_time:
                # Normal case: start < end (e.g., 08:00 to 16:00)
                if start_time <= current_time <= end_time:
                    return program
            else:
                # Midnight crossover case (e.g., 22:00 to 06:00)
                if current_time >= start_time or current_time <= end_time:
                    return program

        # Fallback to first program if no match
        logger.warning(f"⚠️ No program matches current time {current_time}, using first in schedule")
        return schedule[0] if schedule else None

    async def _scheduler_loop(self):
        """Monitors schedule via API and manages playback"""
        logger.info("📅 Scheduler loop started")

        while not self.should_stop:
            try:
                # 1. Fetch Schedule
                schedule = await self.db_helper.get_radio_schedule()

                # 2. Determine current program based on time
                target_program = self._get_current_program(schedule)

                if not target_program:
                    logger.warning("⚠️ No active program found in schedule. Waiting...")
                    await asyncio.sleep(30)
                    continue

                # 3. Check if program changed (by ID) or we need to start playing
                current_id = self.current_program.get('id') if self.current_program else None
                target_id = target_program.get('id')

                if current_id != target_id or not self.current_iterator:
                    logger.info(f"🔄 Program Update: {target_program.get('program_name')} (ID: {target_id})")
                    await self._play_program(target_program)
                    self.current_program = target_program

                # 4. If current track finished, play next track in same program
                if self.current_iterator and self.current_iterator.is_closed:
                    logger.info("🎵 Current track finished, playing next track...")
                    await self._play_program(target_program)

            except Exception as e:
                logger.error(f"❌ Scheduler error: {e}")

            await asyncio.sleep(5)

    async def _play_program(self, program):
        """Plays content for the program"""
        if self.current_iterator:
             await self.current_iterator.close()
             self.current_iterator = None

        stream_url = program.get('stream_url')
        title = program.get('program_name', 'Unknown Program')
        
        # If no direct URL, resolve using MusicService
        if not stream_url:
             playlist_id = program.get('playlist_id')
             logger.info(f"🔍 Resolving content for playlist: {playlist_id}")
             song = await self.music_service.get_random_song(language=playlist_id)
             if song:
                  stream_url = song.get('url')
                  title = song.get('title')
                  logger.info(f"🎵 Resolved to: {title} ({stream_url})")

        if not stream_url:
             logger.warning(f"⚠️ Could not resolve content for program: {title}")
             return

        logger.info(f"▶️ Starting stream: {title}")
        
        self.current_iterator = StreamingAudioIterator(
            cdn_url=stream_url,
            stop_event=self.should_stop,
            title=title
        )
        
        try:
             async for frame in self.current_iterator:
                  if self.should_stop: break
                  await self.audio_source.capture_frame(frame)
        except Exception as e:
             logger.error(f"❌ Playback error: {e}")
        finally:
             if self.current_iterator:
                  await self.current_iterator.close()
                  self.current_iterator = None

async def run_radio_agent():
    # 1. Create Token
    token = api.AccessToken(LIVEKIT_API_KEY, LIVEKIT_API_SECRET) \
        .with_identity("radio-agent-main") \
        .with_name("Radio Host") \
        .with_grants(api.VideoGrants(
            room_join=True,
            room="radio-live-1",
            can_publish=True,
            can_subscribe=True
        ))
    
    jwt_token = token.to_jwt()

    # 2. Connect to Room (SUBSCRIBE_NONE - broadcast only, don't subscribe to others)
    room = rtc.Room()
    room_options = rtc.RoomOptions(auto_subscribe=False)

    logger.info(f"🚀 Connecting to {LIVEKIT_URL} room: radio-live-1")
    try:
        await room.connect(LIVEKIT_URL, jwt_token, options=room_options)
        logger.info("✅ Connected to room (auto_subscribe=False)")
    except Exception as e:
        logger.error(f"❌ Failed to connect: {e}")
        return

    # 3. Start Agent
    agent = RadioAgent(room)
    await agent.start()

if __name__ == "__main__":
    try:
        asyncio.run(run_radio_agent())
    except KeyboardInterrupt:
        pass
