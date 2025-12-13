"""
Manages background audio playback for storytelling.
Plays mood-based background music during story reading.
"""
import logging
import asyncio
import math
from pathlib import Path
from enum import Enum
from typing import Optional, Dict

from livekit import rtc

logger = logging.getLogger("audio.controller")

class Mood(Enum):
    CALM = "calm"
    SUSPENSE = "suspense"
    HAPPY = "happy"
    SAD = "sad"
    ACTION = "action"

class AudioController:
    """Controls background music playback based on story mood."""

    # Volume level for background music (0.0 to 1.0)
    # Lower values = quieter background music so voice is clearer
    BACKGROUND_VOLUME = 0.05  # 5% volume - very subtle background

    def __init__(self, room: rtc.Room, moods_dir: str):
        self.room = room
        self.moods_dir = Path(moods_dir)
        self.current_mood: Optional[Mood] = None
        self.current_source: Optional[rtc.AudioSource] = None
        self.current_track: Optional[rtc.LocalAudioTrack] = None
        self.playback_task: Optional[asyncio.Task] = None

        # Check available files
        self.available_moods = self._scan_moods()

    def _scan_moods(self) -> Dict[Mood, Path]:
        """Maps Mood enums to file paths if they exist."""
        available = {}
        if not self.moods_dir.exists():
            logger.warning(f"Moods directory {self.moods_dir} does not exist.")
            return available

        for mood in Mood:
            # Look for mood.mp3 or mood.wav
            for ext in [".mp3", ".wav"]:
                file_path = self.moods_dir / f"{mood.value}{ext}"
                if file_path.exists():
                    available[mood] = file_path
                    break

        logger.info(f"🎵 Available moods: {[m.value for m in available.keys()]}")
        return available

    async def set_mood(self, mood_str: str):
        """Changes the background audio to match the requested mood."""
        try:
            target_mood = Mood(mood_str.lower())
        except ValueError:
            logger.warning(f"Unknown mood: {mood_str}")
            return

        if target_mood == self.current_mood:
            return

        if target_mood not in self.available_moods:
            logger.warning(f"No audio file found for mood: {target_mood.value}")
            await self.stop()
            return

        logger.info(f"🎵 Switching mood to {target_mood.value}")
        await self.stop()
        self.current_mood = target_mood
        file_path = self.available_moods[target_mood]
        logger.info(f"🎵 Playing audio file: {file_path}")
        self.playback_task = asyncio.create_task(self._play_loop(file_path))

    async def stop(self):
        """Stops the current background audio."""
        if self.playback_task:
            self.playback_task.cancel()
            try:
                await self.playback_task
            except asyncio.CancelledError:
                pass
            self.playback_task = None

        self.current_mood = None
        logger.info("🎵 Background music stopped")

    async def _play_loop(self, file_path: Path):
        """Decodes and plays the audio file in a loop."""
        try:
            # Create a source and track
            source = rtc.AudioSource(48000, 2)
            track = rtc.LocalAudioTrack.create_audio_track("background_music", source)

            # Publish to room
            options = rtc.TrackPublishOptions(source=rtc.TrackSource.SOURCE_MICROPHONE)
            publication = await self.room.local_participant.publish_track(track, options)
            self.current_track = track

            # Use pydub to read and process audio
            from pydub import AudioSegment
            audio = AudioSegment.from_file(str(file_path))

            # Resample to 48k stereo to match source
            audio = audio.set_frame_rate(48000).set_channels(2)

            # REDUCE VOLUME - convert to dB reduction
            if self.BACKGROUND_VOLUME < 1.0:
                db_reduction = 20 * math.log10(self.BACKGROUND_VOLUME)
                audio = audio + db_reduction  # pydub uses + for dB adjustment
                logger.info(f"🎵 Background audio volume reduced by {db_reduction:.1f} dB")

            # Convert to raw PCM
            input_data = audio.raw_data

            # Chunk size (20ms at 48kHz stereo 16-bit)
            # 48000 Hz * 2 channels * 2 bytes/sample = 192000 bytes/sec
            # 20ms = 0.02 * 192000 = 3840 bytes
            chunk_size = 3840
            sleep_time = 0.02

            while True:
                offset = 0
                while offset < len(input_data):
                    chunk = input_data[offset:offset+chunk_size]
                    if len(chunk) < chunk_size:
                        break

                    frame = rtc.AudioFrame(
                        data=chunk,
                        sample_rate=48000,
                        num_channels=2,
                        samples_per_channel=len(chunk) // 4
                    )
                    await source.capture_frame(frame)

                    offset += chunk_size
                    await asyncio.sleep(sleep_time)

        except asyncio.CancelledError:
            logger.info("🎵 Audio loop cancelled")
        except Exception as e:
            logger.error(f"🎵 Error playing audio: {e}")
        finally:
            if self.current_track:
                try:
                    await self.room.local_participant.unpublish_track(self.current_track.sid)
                except Exception:
                    pass
