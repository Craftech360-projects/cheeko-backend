"""
Music Service Module for LiveKit Agent
Handles music search and playback with AWS CloudFront streaming
"""

import json
import os
import random
import logging
from typing import Dict, List, Optional
from pathlib import Path
import urllib.parse
from src.services.semantic_search import QdrantSemanticSearch

logger = logging.getLogger(__name__)

class MusicService:
    """Service for handling music playback and search"""

    def __init__(self, preloaded_model=None, preloaded_client=None):
        self.cloudfront_domain = os.getenv("CLOUDFRONT_DOMAIN", "")
        self.s3_base_url = os.getenv("S3_BASE_URL", "")
        self.use_cdn = os.getenv("USE_CDN", "true").lower() == "true"
        self.is_initialized = False
        self.semantic_search = QdrantSemanticSearch(preloaded_model, preloaded_client)

    async def initialize(self) -> bool:
        """Initialize music service using Qdrant cloud API"""
        try:
            initialized = await self.semantic_search.initialize()
            if initialized:
                logger.info("[MUSIC] Music service initialized with Qdrant cloud API")
                self.is_initialized = True
                return True
            else:
                logger.warning("[MUSIC] Qdrant initialization failed, music service unavailable")
                return False
        except Exception as e:
            logger.error(f"[MUSIC] Failed to initialize music service: {e}")
            return False

    def get_song_url(self, filename: str, language: str = "English") -> str:
        """Generate URL for song file"""
        audio_path = f"music/{language}/{filename}"
        # Ensure we don't encode the slashes in the path
        encoded_path = urllib.parse.quote(audio_path, safe='/')

        if self.use_cdn and self.cloudfront_domain:
            return f"https://{self.cloudfront_domain}/{encoded_path}"
        else:
            return f"{self.s3_base_url}/{encoded_path}"

    async def search_songs(self, query: str, language: Optional[str] = None) -> List[Dict]:
        """Search for songs using enhanced semantic search with spell tolerance"""
        if not self.is_initialized:
            logger.warning(f"Music service not initialized - cannot search for '{query}'")
            return []

        try:
            # Use semantic search service with enhanced fuzzy matching
            search_results = await self.semantic_search.search_music(query, language, limit=5)

            # Convert search results to expected format
            results = []
            for result in search_results:
                results.append({
                    'title': result.title,
                    'filename': result.filename,
                    'language': result.language_or_category,
                    'url': self.get_song_url(result.filename, result.language_or_category),
                    'score': result.score
                })

            if results:
                logger.info(f"🎵 Found {len(results)} songs for '{query}' - top match: '{results[0]['title']}' (score: {results[0]['score']:.2f})")
            else:
                logger.warning(f"🎵 No songs found for '{query}' - check spelling or try different terms")

            return results
            
        except Exception as e:
            logger.error(f"Error searching songs for '{query}': {e}")
            return []

    async def search_songs_by_name(self, song_name: str, language: Optional[str] = None, limit: int = 5) -> List[Dict]:
        """
        Search for songs by name with fuzzy matching support.
        This method is optimized for specific content requests from mobile app.

        Args:
            song_name: Name of the song to search for
            language: Optional language filter
            limit: Maximum number of results to return (default: 5)

        Returns:
            List of matching songs with metadata (title, filename, language, url, score)
        """
        if not self.is_initialized:
            logger.warning(f"[MUSIC-SEARCH] Music service not initialized - cannot search for '{song_name}'")
            return []

        try:
            search_query = song_name.lower().strip()
            logger.info(f"🔍 [MUSIC-SEARCH] Searching for song: '{song_name}', Language: {language or 'Any'}")

            # Use the existing semantic search which already has fuzzy matching
            search_results = await self.semantic_search.search_music(search_query, language, limit=limit)

            # Convert to expected format with additional metadata
            results = []
            for result in search_results:
                song_data = {
                    'title': result.title,
                    'filename': result.filename,
                    'language': result.language_or_category,
                    'url': self.get_song_url(result.filename, result.language_or_category),
                    'score': result.score
                }
                results.append(song_data)

            if results:
                logger.info(f"🔍 [MUSIC-SEARCH] Found {len(results)} matches for '{song_name}' - best: '{results[0]['title']}' (score: {results[0]['score']:.2f})")
            else:
                logger.warning(f"⚠️ [MUSIC-SEARCH] No songs found matching '{song_name}'")

            return results

        except Exception as e:
            logger.error(f"❌ [MUSIC-SEARCH] Error searching for '{song_name}': {e}")
            return []

    async def get_random_song(self, language: Optional[str] = None) -> Optional[Dict]:
        """Get a random song using Qdrant cloud API"""
        if not self.is_initialized:
            return None

        # Use semantic search service to get random song from cloud
        result = await self.semantic_search.get_random_music(language)

        if result:
            return {
                'title': result.title,
                'filename': result.filename,
                'language': result.language_or_category,
                'url': self.get_song_url(result.filename, result.language_or_category)
            }

        return None

    async def get_all_languages(self) -> List[str]:
        """Get list of all available music languages from Qdrant cloud"""
        if not self.is_initialized:
            return []

        return await self.semantic_search.get_available_languages()