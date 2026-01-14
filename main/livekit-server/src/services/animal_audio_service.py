"""
Animal Audio Service
Manages animal sound audio files with CloudFront CDN support and local caching.

Fallback chain:
1. Local cache (if < 24 hours old) - fastest
2. CloudFront CDN - fast
3. S3 direct - slower
4. Local assets - backup
"""

import os
import time
import asyncio
import aiohttp
from pathlib import Path
from src.utils.loki_agent_logger import logger


class AnimalAudioService:
    """Service to manage animal sound audio files with CDN support and caching"""

    # Cache TTL: 24 hours in seconds
    CACHE_TTL_SECONDS = 24 * 60 * 60

    # Download timeout in seconds
    DOWNLOAD_TIMEOUT = 10

    def __init__(self, sounds_directory: str = None):
        """
        Initialize the animal audio service

        Args:
            sounds_directory: Directory where animal sound MP3 files are stored
                            Default: src/assets/animal_sounds/
        """
        if sounds_directory:
            self.sounds_dir = Path(sounds_directory)
        else:
            # Default to src/assets/animal_sounds/ relative to this file
            base_dir = Path(__file__).parent.parent
            self.sounds_dir = base_dir / "assets" / "animal_sounds"

        # Cache directory for downloaded CDN files
        self.cache_dir = Path("/tmp/cheeko_audio_cache")

        # CloudFront and S3 configuration from environment
        self.cloudfront_domain = os.getenv("CLOUDFRONT_DOMAIN", "d23u4d6oyrni77.cloudfront.net")
        self.s3_base_url = os.getenv("S3_BASE_URL", "https://cheeko-music-files.s3.us-east-1.amazonaws.com")

        # Create directories if they don't exist
        self.sounds_dir.mkdir(parents=True, exist_ok=True)
        self.cache_dir.mkdir(parents=True, exist_ok=True)

        logger.info(f"🐾 [ANIMAL-AUDIO] Initialized with:")
        logger.info(f"   Local sounds: {self.sounds_dir}")
        logger.info(f"   Cache dir: {self.cache_dir}")
        logger.info(f"   CloudFront: {self.cloudfront_domain}")

    def _is_cache_valid(self, cache_path: Path) -> bool:
        """
        Check if cached file exists and is less than 24 hours old

        Args:
            cache_path: Path to cached file

        Returns:
            True if cache is valid, False otherwise
        """
        if not cache_path.exists():
            return False

        age = time.time() - cache_path.stat().st_mtime
        is_valid = age < self.CACHE_TTL_SECONDS

        if is_valid:
            logger.debug(f"🗂️ [CACHE] Valid cache for {cache_path.name} (age: {age/3600:.1f}h)")
        else:
            logger.debug(f"🗂️ [CACHE] Expired cache for {cache_path.name} (age: {age/3600:.1f}h)")

        return is_valid

    async def _download_from_url(self, url: str, dest_path: Path) -> bool:
        """
        Download file from URL to destination path

        Args:
            url: URL to download from
            dest_path: Destination path to save file

        Returns:
            True if download successful, False otherwise
        """
        try:
            timeout = aiohttp.ClientTimeout(total=self.DOWNLOAD_TIMEOUT)
            async with aiohttp.ClientSession(timeout=timeout) as session:
                async with session.get(url) as response:
                    if response.status == 200:
                        content = await response.read()
                        dest_path.write_bytes(content)
                        logger.info(f"✅ [DOWNLOAD] Saved {len(content)} bytes to {dest_path.name}")
                        return True
                    else:
                        logger.warning(f"⚠️ [DOWNLOAD] HTTP {response.status} from {url}")
                        return False
        except asyncio.TimeoutError:
            logger.warning(f"⚠️ [DOWNLOAD] Timeout downloading {url}")
            return False
        except Exception as e:
            logger.error(f"❌ [DOWNLOAD] Error downloading {url}: {e}")
            return False

    def _get_s3_fallback_url(self, cloudfront_url: str) -> str:
        """
        Convert CloudFront URL to S3 direct URL for fallback

        Args:
            cloudfront_url: CloudFront URL

        Returns:
            S3 direct URL
        """
        # Replace CloudFront domain with S3 domain
        return cloudfront_url.replace(
            f"https://{self.cloudfront_domain}",
            self.s3_base_url
        )

    async def get_audio_file(self, audio_url: str = None, filename: str = None) -> str:
        """
        Get audio file path with fallback chain:
        1. Local cache (if < 24 hours old)
        2. CloudFront CDN
        3. S3 direct
        4. Local assets (backward compatibility)

        Args:
            audio_url: CloudFront URL for the audio file (optional)
            filename: Filename of the MP3 file (e.g., "cow.mp3")

        Returns:
            Absolute path to the audio file, or None if not found
        """
        # Ensure filename has .mp3 extension
        if filename and not filename.endswith('.mp3'):
            filename = f"{filename}.mp3"

        logger.info(f"🔍 [AUDIO] Looking for: filename={filename}, url={audio_url}")

        # If we have a URL, try CDN path with caching
        if audio_url:
            cache_filename = filename or audio_url.split('/')[-1]
            cache_path = self.cache_dir / cache_filename

            # Step 1: Check local cache
            if self._is_cache_valid(cache_path):
                logger.info(f"✅ [CACHE-HIT] Using cached file: {cache_path}")
                return str(cache_path)

            # Step 2: Try CloudFront CDN
            logger.info(f"🌐 [CDN] Downloading from CloudFront: {audio_url}")
            if await self._download_from_url(audio_url, cache_path):
                logger.info(f"✅ [CDN] Downloaded and cached: {cache_path}")
                return str(cache_path)

            # Step 3: Try S3 direct fallback
            s3_url = self._get_s3_fallback_url(audio_url)
            logger.info(f"🔄 [S3-FALLBACK] Trying S3 direct: {s3_url}")
            if await self._download_from_url(s3_url, cache_path):
                logger.info(f"✅ [S3] Downloaded and cached: {cache_path}")
                return str(cache_path)

            logger.warning(f"⚠️ [CDN] Both CloudFront and S3 failed for {audio_url}")

        # Step 4: Fallback to local assets
        if filename:
            local_path = self.sounds_dir / filename
            if local_path.exists():
                logger.info(f"✅ [LOCAL-FALLBACK] Using local file: {local_path}")
                return str(local_path)
            else:
                logger.warning(f"⚠️ [LOCAL] File not found: {local_path}")

        logger.error(f"❌ [AUDIO] No audio file found for url={audio_url}, filename={filename}")
        return None

    def get_animal_sound_path(self, audio_filename: str) -> str:
        """
        Get local path to animal sound file (legacy method for backward compatibility)

        Args:
            audio_filename: Filename of the MP3 file (e.g., "cow.mp3" or just "cow")

        Returns:
            Absolute path to the audio file, or None if not found
        """
        try:
            # Add .mp3 extension if not present
            if not audio_filename.endswith('.mp3'):
                audio_filename = f"{audio_filename}.mp3"

            sound_path = self.sounds_dir / audio_filename

            if sound_path.exists():
                logger.info(f"✅ [ANIMAL-AUDIO] Found sound file: {sound_path}")
                return str(sound_path)
            else:
                logger.warning(f"⚠️ [ANIMAL-AUDIO] Sound file not found: {sound_path}")
                return None

        except Exception as e:
            logger.error(f"❌ [ANIMAL-AUDIO] Error getting sound path: {e}")
            return None

    def list_available_sounds(self) -> list:
        """
        List all available animal sound files

        Returns:
            List of available MP3 filenames
        """
        try:
            mp3_files = list(self.sounds_dir.glob("*.mp3"))
            logger.info(f"🐾 [ANIMAL-AUDIO] Found {len(mp3_files)} sound files")
            return [f.name for f in mp3_files]
        except Exception as e:
            logger.error(f"❌ [ANIMAL-AUDIO] Error listing sounds: {e}")
            return []

    def list_cached_sounds(self) -> list:
        """
        List all cached sound files from CDN

        Returns:
            List of cached MP3 filenames with their age
        """
        try:
            cached = []
            for f in self.cache_dir.glob("*.mp3"):
                age_hours = (time.time() - f.stat().st_mtime) / 3600
                cached.append({
                    "filename": f.name,
                    "age_hours": round(age_hours, 1),
                    "valid": age_hours < (self.CACHE_TTL_SECONDS / 3600)
                })
            logger.info(f"🗂️ [CACHE] Found {len(cached)} cached sound files")
            return cached
        except Exception as e:
            logger.error(f"❌ [CACHE] Error listing cached sounds: {e}")
            return []

    def clear_cache(self) -> int:
        """
        Clear all cached sound files

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

    def validate_sounds_directory(self) -> bool:
        """
        Validate that the sounds directory exists and contains MP3 files

        Returns:
            True if directory is valid and has MP3 files
        """
        if not self.sounds_dir.exists():
            logger.warning(f"⚠️ [ANIMAL-AUDIO] Sounds directory does not exist: {self.sounds_dir}")
            return False

        mp3_files = list(self.sounds_dir.glob("*.mp3"))
        if len(mp3_files) == 0:
            logger.warning(f"⚠️ [ANIMAL-AUDIO] No MP3 files found in: {self.sounds_dir}")
            return False

        logger.info(f"✅ [ANIMAL-AUDIO] Directory valid with {len(mp3_files)} MP3 files")
        return True
