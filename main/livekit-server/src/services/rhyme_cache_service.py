"""
Rhyme Cache Service
Manages caching of generated rhyme audio to S3 with CloudFront CDN support.
"""

import os
import asyncio
import aiohttp
import boto3
from typing import Optional
from src.utils.loki_agent_logger import logger


class RhymeCacheService:
    """Service to cache generated rhyme audio to S3"""

    S3_BUCKET = "cheeko-music-files"
    S3_PREFIX = "rhymes/"
    CLOUDFRONT_DOMAIN = os.getenv("CLOUDFRONT_DOMAIN", "dsmzc13oafp54.cloudfront.net")

    def __init__(self):
        self.s3_client = boto3.client(
            's3',
            aws_access_key_id=os.getenv('AWS_ACCESS_KEY_ID'),
            aws_secret_access_key=os.getenv('AWS_SECRET_ACCESS_KEY'),
            region_name=os.getenv('AWS_DEFAULT_REGION', 'us-east-1')
        )
        self.manager_api_url = os.getenv("MANAGER_API_URL", "http://localhost:8002/toy")
        logger.info(f"[RHYME-CACHE] Initialized: s3://{self.S3_BUCKET}/{self.S3_PREFIX}")

    def get_s3_key(self, pack_code: str, sequence: int) -> str:
        """Generate S3 key: rhymes/RHYMES_EN_01/1.mp3"""
        return f"{self.S3_PREFIX}{pack_code}/{sequence}.mp3"

    def get_cloudfront_url(self, pack_code: str, sequence: int) -> str:
        """Generate CloudFront URL"""
        s3_key = self.get_s3_key(pack_code, sequence)
        return f"https://{self.CLOUDFRONT_DOMAIN}/{s3_key}"

    async def save_rhyme_audio(self, audio_bytes: bytes, pack_code: str, sequence: int) -> Optional[str]:
        """
        Upload audio to S3 and return CloudFront URL

        Args:
            audio_bytes: The MP3 audio bytes to upload
            pack_code: Content pack code (e.g., RHYMES_EN_01)
            sequence: Sequence number within the pack

        Returns:
            CloudFront URL if successful, None otherwise
        """
        if not audio_bytes or not pack_code:
            logger.warning("[RHYME-CACHE] Missing audio_bytes or pack_code")
            return None

        s3_key = self.get_s3_key(pack_code, sequence)
        logger.info(f"[RHYME-CACHE] Uploading {len(audio_bytes)} bytes to s3://{self.S3_BUCKET}/{s3_key}")

        try:
            await asyncio.to_thread(
                self.s3_client.put_object,
                Bucket=self.S3_BUCKET,
                Key=s3_key,
                Body=audio_bytes,
                ContentType='audio/mpeg'
            )

            cloudfront_url = self.get_cloudfront_url(pack_code, sequence)
            logger.info(f"[RHYME-CACHE] Uploaded successfully: {cloudfront_url}")
            return cloudfront_url

        except Exception as e:
            logger.error(f"[RHYME-CACHE] S3 upload failed: {e}")
            return None

    async def update_database_cached_url(self, pack_code: str, sequence: int, cloudfront_url: str) -> bool:
        """
        Update the cached_audio_urls JSON in Manager API

        Args:
            pack_code: Content pack code
            sequence: Sequence number
            cloudfront_url: The CloudFront URL to cache

        Returns:
            True if update succeeded, False otherwise
        """
        try:
            api_url = f"{self.manager_api_url}/admin/rfid/content-pack/{pack_code}/sequence/{sequence}/cached-audio"

            async with aiohttp.ClientSession() as session:
                async with session.put(
                    api_url,
                    json={"audioUrl": cloudfront_url},
                    headers={"Content-Type": "application/json"},
                    timeout=aiohttp.ClientTimeout(total=10)
                ) as response:
                    if response.status == 200:
                        logger.info(f"[RHYME-CACHE] DB updated: {pack_code} seq {sequence}")
                        return True
                    else:
                        response_text = await response.text()
                        logger.warning(f"[RHYME-CACHE] DB update failed: HTTP {response.status} - {response_text}")
                        return False

        except Exception as e:
            logger.error(f"[RHYME-CACHE] DB update error: {e}")
            return False

    async def cache_rhyme_audio(self, audio_bytes: bytes, pack_code: str, sequence: int) -> Optional[str]:
        """
        Complete caching workflow: upload to S3 and update database

        Args:
            audio_bytes: The MP3 audio bytes to upload
            pack_code: Content pack code
            sequence: Sequence number

        Returns:
            CloudFront URL if successful, None otherwise
        """
        # Step 1: Upload to S3
        cloudfront_url = await self.save_rhyme_audio(audio_bytes, pack_code, sequence)
        if not cloudfront_url:
            return None

        # Step 2: Update database
        db_updated = await self.update_database_cached_url(pack_code, sequence, cloudfront_url)
        if not db_updated:
            logger.warning(f"[RHYME-CACHE] Audio uploaded but DB update failed: {cloudfront_url}")
            # Still return the URL - the audio is cached even if DB update failed

        return cloudfront_url


# Singleton instance
_rhyme_cache_service: Optional[RhymeCacheService] = None


def get_rhyme_cache_service() -> RhymeCacheService:
    """Get or create the Rhyme Cache Service singleton"""
    global _rhyme_cache_service
    if _rhyme_cache_service is None:
        _rhyme_cache_service = RhymeCacheService()
    return _rhyme_cache_service
