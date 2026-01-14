"""
Audio Cache Service
Manages caching of AI-generated audio responses with CloudFront CDN support.

Supports two modes:
1. DIRECT S3: Upload directly to S3 (default)
2. NAVIDROME: Save to Navidrome folder, syncs to S3 via cron

Flow:
1. Check if cached audio URL exists in database
2. If exists, download from CloudFront to local temp
3. If not, generate with Gemini + ElevenLabs, save (S3 or Navidrome), update DB
"""

import os
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

    # Navidrome configuration (when USE_NAVIDROME=true)
    NAVIDROME_MUSIC_FOLDER = os.getenv("NAVIDROME_MUSIC_FOLDER", "./navidrome_music")
    USE_NAVIDROME = os.getenv("USE_NAVIDROME", "false").lower() == "true"

    # Download timeout in seconds
    DOWNLOAD_TIMEOUT = 15

    def __init__(self):
        """Initialize the audio cache service"""
        # Local cache directory for downloaded files
        self.cache_dir = Path(os.getenv("AUDIO_CACHE_DIR", "/tmp/cheeko_ai_cache"))
        self.cache_dir.mkdir(parents=True, exist_ok=True)

        # Navidrome folder for AI responses
        if self.USE_NAVIDROME:
            self.navidrome_ai_folder = Path(self.NAVIDROME_MUSIC_FOLDER) / "ai_responses" / "questions"
            self.navidrome_ai_folder.mkdir(parents=True, exist_ok=True)
            logger.info(f"🎵 [AUDIO-CACHE] Navidrome mode enabled")
            logger.info(f"   Navidrome folder: {self.navidrome_ai_folder}")
        else:
            self.navidrome_ai_folder = None

        # Initialize S3 client (used for direct upload mode)
        self.s3_client = None
        if not self.USE_NAVIDROME:
            self._init_s3_client()

        logger.info(f"🎵 [AUDIO-CACHE] Initialized with:")
        logger.info(f"   Mode: {'Navidrome' if self.USE_NAVIDROME else 'Direct S3'}")
        logger.info(f"   S3 Bucket: {self.S3_BUCKET}")
        logger.info(f"   S3 Prefix: {self.S3_PREFIX}")
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
        Download cached audio from CloudFront to local path

        Args:
            cache_url: CloudFront URL for the cached audio

        Returns:
            Local file path if downloaded successfully, None otherwise
        """
        if not cache_url:
            return None

        try:
            # Extract filename from URL
            filename = cache_url.split('/')[-1]
            local_path = self.cache_dir / filename

            # Local cache disabled - always download fresh from CloudFront
            # if local_path.exists():
            #     logger.info(f"🎯 [LOCAL-HIT] Using local cache: {local_path}")
            #     return str(local_path)

            # Download from CloudFront
            logger.info(f"⬇️ [DOWNLOAD] Downloading from CloudFront: {cache_url}")
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

    async def save_audio_to_cache(self, audio_bytes: bytes, question_id: int) -> str:
        """
        Save audio to cache (S3 direct or Navidrome folder) and return CloudFront URL

        Args:
            audio_bytes: Audio data in MP3 format
            question_id: Question ID from database (required for caching)

        Returns:
            CloudFront URL for the uploaded audio, None on failure
        """
        if not audio_bytes:
            logger.error("❌ [CACHE] No audio data to save")
            return None

        if not question_id:
            logger.error("❌ [CACHE] No question_id provided, cannot cache")
            return None

        # Route to appropriate save method based on mode
        if self.USE_NAVIDROME:
            return await self._save_to_navidrome(audio_bytes, question_id)
        else:
            return await self._save_to_s3(audio_bytes, question_id)

    async def _save_to_navidrome(self, audio_bytes: bytes, question_id: int) -> str:
        """
        Save audio to Navidrome music folder.
        S3 sync cron job will upload to S3 automatically.

        Args:
            audio_bytes: Audio data in MP3 format
            question_id: Question ID from database

        Returns:
            CloudFront URL (file available after next sync)
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

            # Also save to local cache for immediate playback
            local_path = self.cache_dir / filename
            async with aiofiles.open(local_path, 'wb') as f:
                await f.write(audio_bytes)
            logger.info(f"✅ [LOCAL] Saved to local cache: {local_path}")

            # Return CloudFront URL (file will be available after S3 sync)
            cloudfront_url = f"https://{self.CLOUDFRONT_DOMAIN}/{self.S3_PREFIX}{filename}"
            logger.info(f"📡 [NAVIDROME] CloudFront URL (after sync): {cloudfront_url}")

            return cloudfront_url

        except Exception as e:
            logger.error(f"❌ [NAVIDROME] Error saving audio: {e}")
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
