"""
Audio Cache Service
Manages caching of AI-generated audio responses.

Supports three modes:
1. DIRECT S3: Upload directly to S3, serve via CloudFront (default)
2. NAVIDROME_LOCAL: Save to local Navidrome folder, syncs to S3 via cron
3. NAVIDROME_REMOTE: Upload via SFTP to remote Navidrome, stream via Subsonic API

Flow:
1. Check if cached audio URL exists in database
2. If exists, download from URL to local temp
3. If not, generate with Gemini + TTS, save to storage, update DB
"""

import os
import re
import asyncio
import aiohttp
import aiofiles
import boto3
from pathlib import Path
from botocore.exceptions import ClientError
from src.utils.loki_agent_logger import logger


class AudioCacheService:
    """Service to cache AI-generated audio responses to S3 or Navidrome"""

    # S3 and CloudFront configuration
    S3_BUCKET = os.getenv("S3_BUCKET_NAME", "cheeko-audio-files")
    S3_PREFIX = "audio/ai_responses/"
    CLOUDFRONT_DOMAIN = os.getenv("CLOUDFRONT_DOMAIN", "d23u4d6oyrni77.cloudfront.net")

    # Navidrome configuration
    NAVIDROME_MUSIC_FOLDER = os.getenv("NAVIDROME_MUSIC_FOLDER", "./navidrome_music")
    USE_NAVIDROME = os.getenv("USE_NAVIDROME", "false").lower() == "true"

    # Local streaming URL (for direct streaming without S3/CloudFront)
    # When set, files are served from media_api instead of CloudFront
    AUDIO_SERVER_URL = os.getenv("AUDIO_SERVER_URL", "")

    # Remote Navidrome (SFTP + Subsonic API) - when NAVIDROME_SFTP_HOST is set
    NAVIDROME_SFTP_HOST = os.getenv("NAVIDROME_SFTP_HOST", "")

    # Download timeout in seconds
    DOWNLOAD_TIMEOUT = 15

    def __init__(self):
        """Initialize the audio cache service"""
        # Local cache directory for downloaded files
        self.cache_dir = Path(os.getenv("AUDIO_CACHE_DIR", "/tmp/cheeko_ai_cache"))
        self.cache_dir.mkdir(parents=True, exist_ok=True)

        # Determine mode
        self.is_remote_navidrome = bool(self.NAVIDROME_SFTP_HOST) and self.USE_NAVIDROME
        self.navidrome_service = None

        if self.is_remote_navidrome:
            # Mode 3: Remote Navidrome via SFTP + Subsonic API
            from src.services.navidrome_service import get_navidrome_service
            self.navidrome_service = get_navidrome_service()
            self.navidrome_ai_folder = None
            logger.info(f"🎵 [AUDIO-CACHE] Remote Navidrome mode (SFTP + Subsonic API)")
            logger.info(f"   SFTP Host: {self.NAVIDROME_SFTP_HOST}")
        elif self.USE_NAVIDROME:
            # Mode 2: Local Navidrome folder
            self.navidrome_ai_folder = Path(self.NAVIDROME_MUSIC_FOLDER) / "ai_responses" / "questions"
            self.navidrome_ai_folder.mkdir(parents=True, exist_ok=True)
            logger.info(f"🎵 [AUDIO-CACHE] Local Navidrome mode")
            logger.info(f"   Navidrome folder: {self.navidrome_ai_folder}")
        else:
            # Mode 1: Direct S3
            self.navidrome_ai_folder = None

        # Initialize S3 client (used for direct S3 upload mode)
        self.s3_client = None
        if not self.USE_NAVIDROME:
            self._init_s3_client()

        # Log configuration
        if self.is_remote_navidrome:
            mode_name = "Remote Navidrome (Subsonic)"
        elif self.USE_NAVIDROME and self.AUDIO_SERVER_URL:
            mode_name = "Local Navidrome (Direct Streaming)"
        elif self.USE_NAVIDROME:
            mode_name = "Local Navidrome (CloudFront)"
        else:
            mode_name = "Direct S3"

        logger.info(f"🎵 [AUDIO-CACHE] Initialized with:")
        logger.info(f"   Mode: {mode_name}")
        if self.AUDIO_SERVER_URL:
            logger.info(f"   Audio Server URL: {self.AUDIO_SERVER_URL}")
        elif not self.is_remote_navidrome:
            logger.info(f"   S3 Bucket: {self.S3_BUCKET}")
            logger.info(f"   CloudFront: {self.CLOUDFRONT_DOMAIN}")
        logger.info(f"   Local cache: {self.cache_dir}")

    def _init_s3_client(self):
        """Initialize S3 client with credentials from environment"""
        try:
            self.s3_client = boto3.client(
                's3',
                aws_access_key_id=os.getenv('AWS_ACCESS_KEY_ID'),
                aws_secret_access_key=os.getenv('AWS_SECRET_ACCESS_KEY'),
                region_name=os.getenv('AWS_DEFAULT_REGION', 'us-east-1')
            )
            logger.info("✅ [S3] Client initialized successfully")
        except Exception as e:
            logger.error(f"❌ [S3] Failed to initialize client: {e}")
            self.s3_client = None

    def get_cache_key(self, question_id: int) -> str:
        """
        Generate unique cache key based on question ID.

        Using question_id only (not rfid_uid) because:
        - Same question = same answer regardless of which card
        - Multiple cards can share the same question
        - One cached audio per question is the correct approach

        Args:
            question_id: Question ID from database

        Returns:
            Cache key string (e.g., "question_15")
        """
        return f"question_{question_id}"

    async def get_cached_audio(self, cache_url: str) -> str:
        """
        Download cached audio from URL to local path.

        Supports:
        - CloudFront URLs: https://xxx.cloudfront.net/audio/question_1.mp3
        - Media API URLs: http://server:8003/audio/ai_responses/questions/question_1.mp3
        - Navidrome Subsonic URLs: http://server:4533/rest/stream?id=xxx&format=mp3&...

        Args:
            cache_url: URL for the cached audio (CloudFront, media_api, or Navidrome)

        Returns:
            Local file path if downloaded successfully, None otherwise
        """
        if not cache_url:
            return None

        try:
            # Fix HTML-encoded URLs (database may store &amp; instead of &)
            cache_url = cache_url.replace("&amp;", "&")

            # Determine filename based on URL type
            if "/rest/stream?" in cache_url:
                # Navidrome Subsonic URL - extract song ID for filename
                # URL format: http://server:4533/rest/stream?id=xxx&format=mp3&u=...
                match = re.search(r'[?&]id=([^&]+)', cache_url)
                if match:
                    song_id = match.group(1)
                    filename = f"navidrome_{song_id}.mp3"
                    logger.info(f"🎵 [DOWNLOAD] Navidrome stream URL detected, song_id={song_id}")
                else:
                    logger.error(f"❌ [DOWNLOAD] Could not extract song ID from Navidrome URL: {cache_url}")
                    return None
            else:
                # Regular URL (CloudFront, media_api) - extract filename from path
                filename = cache_url.split('/')[-1]
                # Remove any query string if present
                if '?' in filename:
                    filename = filename.split('?')[0]

            local_path = self.cache_dir / filename

            # Local cache disabled - always stream fresh from source
            # if local_path.exists():
            #     logger.info(f"🎯 [LOCAL-HIT] Using local cache: {local_path}")
            #     return str(local_path)

            # Download from URL
            logger.info(f"⬇️ [DOWNLOAD] Downloading from: {cache_url}")
            timeout = aiohttp.ClientTimeout(total=self.DOWNLOAD_TIMEOUT)

            async with aiohttp.ClientSession(timeout=timeout) as session:
                async with session.get(cache_url) as response:
                    if response.status == 200:
                        content = await response.read()
                        local_path.write_bytes(content)
                        logger.info(f"✅ [DOWNLOAD] Saved {len(content)} bytes to {local_path}")
                        return str(local_path)
                    else:
                        logger.warning(f"⚠️ [DOWNLOAD] HTTP {response.status} from {cache_url}")
                        return None

        except asyncio.TimeoutError:
            logger.warning(f"⚠️ [DOWNLOAD] Timeout downloading {cache_url}")
            return None
        except Exception as e:
            logger.error(f"❌ [DOWNLOAD] Error downloading {cache_url}: {e}")
            return None

    async def stream_cached_audio(self, cache_url: str) -> bytes:
        """
        Stream audio directly from URL without saving to disk.

        This is more efficient than get_cached_audio() for Navidrome Subsonic URLs
        since we don't need to save to local cache - just stream and play.

        Args:
            cache_url: URL for the cached audio (Navidrome, CloudFront, or media_api)

        Returns:
            Audio bytes if successful, None otherwise
        """
        if not cache_url:
            return None

        try:
            # Fix HTML-encoded URLs (database may store &amp; instead of &)
            cache_url = cache_url.replace("&amp;", "&")

            logger.info(f"📡 [STREAM] Streaming directly from: {cache_url}")
            timeout = aiohttp.ClientTimeout(total=self.DOWNLOAD_TIMEOUT)

            async with aiohttp.ClientSession(timeout=timeout) as session:
                async with session.get(cache_url) as response:
                    if response.status == 200:
                        content = await response.read()
                        logger.info(f"✅ [STREAM] Received {len(content)} bytes")
                        return content
                    else:
                        logger.warning(f"⚠️ [STREAM] HTTP {response.status} from {cache_url}")
                        return None

        except asyncio.TimeoutError:
            logger.warning(f"⚠️ [STREAM] Timeout streaming {cache_url}")
            return None
        except Exception as e:
            logger.error(f"❌ [STREAM] Error streaming {cache_url}: {e}")
            return None

    async def save_audio_to_cache(self, audio_bytes: bytes, question_id: int) -> str:
        """
        Save audio to cache and return streaming URL.

        Args:
            audio_bytes: Audio data in MP3 format
            question_id: Question ID from database (required for caching)

        Returns:
            Streaming URL (CloudFront or Navidrome Subsonic), None on failure
        """
        if not audio_bytes:
            logger.error("❌ [CACHE] No audio data to save")
            return None

        if not question_id:
            logger.error("❌ [CACHE] No question_id provided, cannot cache")
            return None

        # Route to appropriate save method based on mode
        if self.is_remote_navidrome:
            return await self._save_to_remote_navidrome(audio_bytes, question_id)
        elif self.USE_NAVIDROME:
            return await self._save_to_navidrome(audio_bytes, question_id)
        else:
            return await self._save_to_s3(audio_bytes, question_id)

    async def _save_to_navidrome(self, audio_bytes: bytes, question_id: int) -> str:
        """
        Save audio to Navidrome music folder and return Subsonic stream URL.

        Flow:
        1. Save to navidrome_music folder
        2. Trigger Navidrome scan to index the new file
        3. Wait for song to appear in Navidrome index
        4. Return Navidrome Subsonic stream URL

        Args:
            audio_bytes: Audio data in MP3 format
            question_id: Question ID from database

        Returns:
            Navidrome Subsonic stream URL, None on failure
        """
        try:
            cache_key = self.get_cache_key(question_id)
            filename = f"{cache_key}.mp3"
            filepath = self.navidrome_ai_folder / filename

            logger.info(f"💾 [NAVIDROME] Saving {len(audio_bytes)} bytes to {filepath}")

            # Save to Navidrome folder asynchronously
            async with aiofiles.open(filepath, 'wb') as f:
                await f.write(audio_bytes)

            logger.info(f"✅ [NAVIDROME] Saved successfully: {filepath}")

            # Get Navidrome service
            from src.services.navidrome_service import get_navidrome_service
            navidrome_svc = get_navidrome_service()

            # Check if song already indexed
            song = await navidrome_svc.search_song(cache_key)

            if not song or not song.get("id"):
                # Song not indexed - trigger scan and wait
                logger.info(f"🔄 [NAVIDROME] Triggering scan for new file...")
                await navidrome_svc.trigger_scan()

                # Wait for song to appear (max 30s, poll every 3s)
                song = await navidrome_svc.wait_for_song(cache_key, max_wait=30, poll_interval=3)

            if song and song.get("id"):
                # Song found in Navidrome - return stream URL
                streaming_url = navidrome_svc.get_stream_url(song["id"])
                logger.info(f"📡 [NAVIDROME] Subsonic stream URL: {streaming_url}")
                return streaming_url

            # Song still not indexed after waiting
            logger.error(f"❌ [NAVIDROME] Song not indexed after scan - Navidrome may be down")
            return None

        except Exception as e:
            logger.error(f"❌ [NAVIDROME] Error saving audio: {e}")
            return None

    async def _save_to_remote_navidrome(self, audio_bytes: bytes, question_id: int) -> str:
        """
        Upload audio to remote Navidrome via SFTP and return Subsonic stream URL.

        Args:
            audio_bytes: Audio data in MP3 format
            question_id: Question ID from database

        Returns:
            Navidrome Subsonic stream URL
        """
        if not self.navidrome_service:
            logger.error("❌ [REMOTE-NAVIDROME] Service not initialized")
            return None

        try:
            cache_key = self.get_cache_key(question_id)
            filename = f"{cache_key}.mp3"

            logger.info(f"⬆️ [REMOTE-NAVIDROME] Uploading {len(audio_bytes)} bytes as {filename}")

            # Save to local cache for immediate playback
            local_path = self.cache_dir / filename
            async with aiofiles.open(local_path, 'wb') as f:
                await f.write(audio_bytes)
            logger.info(f"✅ [LOCAL] Saved to local cache: {local_path}")

            # Upload to remote Navidrome via SFTP and get stream URL
            stream_url = await self.navidrome_service.upload_and_get_stream_url(
                audio_bytes,
                filename,
                subfolder="ai_responses/questions"
            )

            if stream_url:
                logger.info(f"📡 [REMOTE-NAVIDROME] Stream URL: {stream_url}")
                return stream_url
            else:
                # If Navidrome hasn't scanned yet, return a placeholder
                # The URL will work once Navidrome scans the file
                logger.warning("⚠️ [REMOTE-NAVIDROME] File uploaded but not yet indexed by Navidrome")
                # Return local path for immediate playback
                return f"file://{local_path}"

        except Exception as e:
            logger.error(f"❌ [REMOTE-NAVIDROME] Error: {e}")
            return None

    async def _save_to_s3(self, audio_bytes: bytes, question_id: int) -> str:
        """
        Upload audio directly to S3 and return CloudFront URL

        Args:
            audio_bytes: Audio data in MP3 format
            question_id: Question ID from database

        Returns:
            CloudFront URL for the uploaded audio
        """
        if not self.s3_client:
            logger.error("❌ [S3] Client not initialized, cannot upload")
            return None

        try:
            # Generate cache key and S3 path based on question_id
            cache_key = self.get_cache_key(question_id)
            s3_key = f"{self.S3_PREFIX}{cache_key}.mp3"

            logger.info(f"⬆️ [S3] Uploading {len(audio_bytes)} bytes to s3://{self.S3_BUCKET}/{s3_key}")

            # Upload to S3 (run in thread pool to avoid blocking)
            await asyncio.to_thread(
                self.s3_client.put_object,
                Bucket=self.S3_BUCKET,
                Key=s3_key,
                Body=audio_bytes,
                ContentType='audio/mpeg'
            )

            # Generate CloudFront URL
            cloudfront_url = f"https://{self.CLOUDFRONT_DOMAIN}/{s3_key}"
            logger.info(f"✅ [S3] Uploaded successfully: {cloudfront_url}")

            # Also save to local cache for immediate playback
            local_path = self.cache_dir / f"{cache_key}.mp3"
            local_path.write_bytes(audio_bytes)
            logger.info(f"✅ [LOCAL] Saved to local cache: {local_path}")

            return cloudfront_url

        except ClientError as e:
            logger.error(f"❌ [S3] Upload failed: {e}")
            return None
        except Exception as e:
            logger.error(f"❌ [S3] Unexpected error during upload: {e}")
            return None

    def get_local_cache_path(self, question_id: int) -> str:
        """
        Get local cache path for a given question ID

        Args:
            question_id: Question ID from database

        Returns:
            Local file path (may or may not exist)
        """
        cache_key = self.get_cache_key(question_id)
        return str(self.cache_dir / f"{cache_key}.mp3")

    def clear_local_cache(self) -> int:
        """
        Clear all locally cached audio files

        Returns:
            Number of files deleted
        """
        try:
            deleted = 0
            for f in self.cache_dir.glob("*.mp3"):
                f.unlink()
                deleted += 1
            logger.info(f"🗑️ [CACHE] Cleared {deleted} cached files")
            return deleted
        except Exception as e:
            logger.error(f"❌ [CACHE] Error clearing cache: {e}")
            return 0

    async def update_database_cached_url(self, question_id: int, cloudfront_url: str) -> bool:
        """
        Update the cached_audio_url in the database via Manager API

        Args:
            question_id: Question ID to update
            cloudfront_url: CloudFront URL for the cached audio

        Returns:
            True if update successful, False otherwise
        """
        try:
            manager_api_url = os.getenv("MANAGER_API_URL", "http://localhost:8002/toy")
            api_url = f"{manager_api_url}/admin/rfid/question/{question_id}/cached-audio"

            logger.info(f"📝 [DB-UPDATE] Updating question {question_id} with cached URL")

            timeout = aiohttp.ClientTimeout(total=10)
            async with aiohttp.ClientSession(timeout=timeout) as session:
                async with session.put(
                    api_url,
                    json={"cachedAudioUrl": cloudfront_url},
                    headers={"Content-Type": "application/json"}
                ) as response:
                    if response.status == 200:
                        logger.info(f"✅ [DB-UPDATE] Successfully updated question {question_id}")
                        return True
                    else:
                        logger.warning(f"⚠️ [DB-UPDATE] HTTP {response.status} updating question {question_id}")
                        return False

        except Exception as e:
            logger.error(f"❌ [DB-UPDATE] Error updating question {question_id}: {e}")
            return False
