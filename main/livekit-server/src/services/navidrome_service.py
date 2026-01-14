"""
Navidrome Service - Remote Audio Streaming via Subsonic API
Handles uploading audio to remote Navidrome instance and streaming via authenticated API.

Flow:
1. Upload audio file to Navidrome server (via SFTP or shared storage)
2. Wait for Navidrome scan (or trigger manually)
3. Search for file to get song ID
4. Generate authenticated stream URL
"""

import os
import hashlib
import random
import string
import asyncio
import aiohttp
import paramiko
from pathlib import Path
from typing import Optional, Tuple
from src.utils.loki_agent_logger import logger


class NavidromeService:
    """Service for interacting with remote Navidrome via Subsonic API"""

    def __init__(self):
        # Navidrome server configuration
        self.base_url = os.getenv("NAVIDROME_URL", "http://192.168.1.2:4533")
        self.username = os.getenv("NAVIDROME_USER", "cheeko")
        self.password = os.getenv("NAVIDROME_PASS", "cheeko123")

        # Subsonic API settings
        self.client_name = "cheeko-agent"
        self.api_version = "1.16.1"

        # SFTP configuration for file upload
        self.sftp_host = os.getenv("NAVIDROME_SFTP_HOST", "")
        self.sftp_port = int(os.getenv("NAVIDROME_SFTP_PORT", "22"))
        self.sftp_user = os.getenv("NAVIDROME_SFTP_USER", "")
        self.sftp_pass = os.getenv("NAVIDROME_SFTP_PASS", "")
        self.sftp_key_path = os.getenv("NAVIDROME_SFTP_KEY", "")
        self.remote_music_path = os.getenv("NAVIDROME_REMOTE_MUSIC_PATH", "/music")

        logger.info(f"🎵 [NAVIDROME] Initialized with URL: {self.base_url}")
        if self.sftp_host:
            logger.info(f"   SFTP Host: {self.sftp_host}:{self.sftp_port}")

    def _generate_auth_params(self) -> str:
        """
        Generate Subsonic API authentication parameters.
        Uses token-based auth (MD5 of password + salt)
        """
        # Generate random salt
        salt = ''.join(random.choices(string.ascii_lowercase + string.digits, k=12))

        # Create token: MD5(password + salt)
        token = hashlib.md5(f"{self.password}{salt}".encode()).hexdigest()

        return f"u={self.username}&t={token}&s={salt}&v={self.api_version}&c={self.client_name}&f=json"

    def get_stream_url(self, song_id: str, format: str = "mp3") -> str:
        """
        Generate authenticated stream URL for a song.

        Args:
            song_id: Navidrome/Subsonic song ID
            format: Audio format (mp3, raw, etc.)

        Returns:
            Full authenticated stream URL
        """
        auth = self._generate_auth_params()
        return f"{self.base_url}/rest/stream?id={song_id}&format={format}&{auth}"

    def get_download_url(self, song_id: str) -> str:
        """
        Generate authenticated download URL for a song.

        Args:
            song_id: Navidrome/Subsonic song ID

        Returns:
            Full authenticated download URL
        """
        auth = self._generate_auth_params()
        return f"{self.base_url}/rest/download?id={song_id}&{auth}"

    async def search_song(self, query: str) -> Optional[dict]:
        """
        Search for a song by title/filename.

        Args:
            query: Search query (filename or title)

        Returns:
            Song info dict with 'id' field if found, None otherwise
        """
        try:
            auth = self._generate_auth_params()
            url = f"{self.base_url}/rest/search3?query={query}&songCount=1&{auth}"

            async with aiohttp.ClientSession() as session:
                async with session.get(url) as response:
                    if response.status == 200:
                        data = await response.json()
                        result = data.get("subsonic-response", {})

                        if result.get("status") == "ok":
                            songs = result.get("searchResult3", {}).get("song", [])
                            if songs:
                                song = songs[0]
                                logger.info(f"🔍 [NAVIDROME] Found song: {song.get('title')} (ID: {song.get('id')})")
                                return song
                        else:
                            error = result.get("error", {})
                            logger.warning(f"⚠️ [NAVIDROME] API error: {error}")
                    else:
                        logger.warning(f"⚠️ [NAVIDROME] HTTP {response.status} searching for {query}")

            return None

        except Exception as e:
            logger.error(f"❌ [NAVIDROME] Search error: {e}")
            return None

    async def get_song_by_path(self, relative_path: str) -> Optional[dict]:
        """
        Find a song by its relative path in the music library.
        Navidrome doesn't have a direct path lookup, so we search by filename.

        Args:
            relative_path: Path relative to music folder (e.g., "ai_responses/questions/question_1.mp3")

        Returns:
            Song info dict if found
        """
        # Extract filename for search
        filename = Path(relative_path).stem  # e.g., "question_1"
        return await self.search_song(filename)

    async def upload_via_sftp(self, audio_bytes: bytes, remote_path: str) -> bool:
        """
        Upload audio file to Navidrome server via SFTP.

        Args:
            audio_bytes: Audio data to upload
            remote_path: Path on remote server (relative to music folder)

        Returns:
            True if upload successful
        """
        if not self.sftp_host:
            logger.error("❌ [SFTP] SFTP not configured (NAVIDROME_SFTP_HOST not set)")
            return False

        try:
            # Full remote path
            full_remote_path = f"{self.remote_music_path}/{remote_path}"

            logger.info(f"⬆️ [SFTP] Uploading {len(audio_bytes)} bytes to {self.sftp_host}:{full_remote_path}")

            # Run SFTP upload in thread pool to avoid blocking
            success = await asyncio.to_thread(
                self._sftp_upload_sync,
                audio_bytes,
                full_remote_path
            )

            if success:
                logger.info(f"✅ [SFTP] Upload successful: {full_remote_path}")

            return success

        except Exception as e:
            logger.error(f"❌ [SFTP] Upload error: {e}")
            return False

    def _sftp_upload_sync(self, audio_bytes: bytes, remote_path: str) -> bool:
        """Synchronous SFTP upload (runs in thread pool)"""
        transport = None
        sftp = None

        try:
            # Connect to SFTP server
            transport = paramiko.Transport((self.sftp_host, self.sftp_port))

            if self.sftp_key_path:
                # Key-based auth
                key = paramiko.RSAKey.from_private_key_file(self.sftp_key_path)
                transport.connect(username=self.sftp_user, pkey=key)
            else:
                # Password auth
                transport.connect(username=self.sftp_user, password=self.sftp_pass)

            sftp = paramiko.SFTPClient.from_transport(transport)

            # Ensure parent directory exists
            remote_dir = str(Path(remote_path).parent)
            self._sftp_makedirs(sftp, remote_dir)

            # Upload file
            with sftp.file(remote_path, 'wb') as f:
                f.write(audio_bytes)

            return True

        except Exception as e:
            logger.error(f"❌ [SFTP] Error in _sftp_upload_sync: {e}")
            return False

        finally:
            if sftp:
                sftp.close()
            if transport:
                transport.close()

    def _sftp_makedirs(self, sftp, remote_dir: str):
        """Create remote directory recursively via SFTP"""
        dirs_to_create = []
        current = remote_dir

        while current != '/':
            try:
                sftp.stat(current)
                break  # Directory exists
            except IOError:
                dirs_to_create.append(current)
                current = str(Path(current).parent)

        # Create directories from root to leaf
        for dir_path in reversed(dirs_to_create):
            try:
                sftp.mkdir(dir_path)
            except IOError:
                pass  # May already exist

    async def trigger_scan(self) -> bool:
        """
        Trigger a library scan on Navidrome.
        Note: This requires admin privileges.

        Returns:
            True if scan was triggered successfully
        """
        try:
            auth = self._generate_auth_params()
            url = f"{self.base_url}/rest/startScan?{auth}"

            async with aiohttp.ClientSession() as session:
                async with session.get(url) as response:
                    if response.status == 200:
                        data = await response.json()
                        result = data.get("subsonic-response", {})

                        if result.get("status") == "ok":
                            logger.info("🔄 [NAVIDROME] Library scan triggered")
                            return True
                        else:
                            error = result.get("error", {})
                            logger.warning(f"⚠️ [NAVIDROME] Scan error: {error}")
                    else:
                        logger.warning(f"⚠️ [NAVIDROME] HTTP {response.status} triggering scan")

            return False

        except Exception as e:
            logger.error(f"❌ [NAVIDROME] Error triggering scan: {e}")
            return False

    async def wait_for_song(self, query: str, max_wait: int = 60, poll_interval: int = 5) -> Optional[dict]:
        """
        Wait for a song to appear in Navidrome after upload.
        Polls the search API until the song is found or timeout.

        Args:
            query: Search query (filename)
            max_wait: Maximum seconds to wait
            poll_interval: Seconds between polls

        Returns:
            Song info if found within timeout
        """
        logger.info(f"⏳ [NAVIDROME] Waiting for song '{query}' to appear (max {max_wait}s)...")

        elapsed = 0
        while elapsed < max_wait:
            song = await self.search_song(query)
            if song:
                return song

            await asyncio.sleep(poll_interval)
            elapsed += poll_interval
            logger.debug(f"   Still waiting... ({elapsed}s)")

        logger.warning(f"⚠️ [NAVIDROME] Timeout waiting for song '{query}'")
        return None

    async def upload_and_get_stream_url(
        self,
        audio_bytes: bytes,
        filename: str,
        subfolder: str = "ai_responses/questions"
    ) -> Optional[str]:
        """
        Complete flow: Upload audio to Navidrome and return stream URL.

        Args:
            audio_bytes: Audio data to upload
            filename: Filename (e.g., "question_1.mp3")
            subfolder: Subfolder in music library

        Returns:
            Authenticated stream URL if successful
        """
        # 1. Upload via SFTP
        remote_path = f"{subfolder}/{filename}"
        if not await self.upload_via_sftp(audio_bytes, remote_path):
            return None

        # 2. Optionally trigger scan (or wait for auto-scan)
        # await self.trigger_scan()

        # 3. Wait for song to appear in Navidrome
        query = Path(filename).stem  # Remove .mp3
        song = await self.wait_for_song(query, max_wait=120, poll_interval=10)

        if not song:
            logger.warning(f"⚠️ [NAVIDROME] Song not found after upload: {filename}")
            # Return a "pending" URL that might work after Navidrome scans
            return None

        # 4. Return stream URL
        song_id = song.get("id")
        return self.get_stream_url(song_id)


# Singleton instance
_navidrome_service: Optional[NavidromeService] = None


def get_navidrome_service() -> NavidromeService:
    """Get or create the Navidrome service singleton"""
    global _navidrome_service
    if _navidrome_service is None:
        _navidrome_service = NavidromeService()
    return _navidrome_service
