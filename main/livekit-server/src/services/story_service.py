"""
Story Service Module for LiveKit Agent
Handles story search and playback with AWS CloudFront streaming and semantic search
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

class StoryService:
    """Service for handling story playback and search with semantic search"""

    def __init__(self, preloaded_model=None, preloaded_client=None):
        self.cloudfront_domain = os.getenv("CLOUDFRONT_DOMAIN", "")
        self.s3_base_url = os.getenv("S3_BASE_URL", "")
        self.use_cdn = os.getenv("USE_CDN", "true").lower() == "true"
        self.is_initialized = False
        self.semantic_search = QdrantSemanticSearch(preloaded_model, preloaded_client)

    async def initialize(self) -> bool:
        """Initialize story service with semantic search using Qdrant"""
        try:
            # Initialize semantic search
            initialized = await self.semantic_search.initialize()
            if initialized:
                logger.info("[STORY] Story service initialized with Qdrant semantic search")
                self.is_initialized = True
                return True
            else:
                logger.warning("[STORY] Qdrant initialization failed - falling back to simple story service")
                # Still mark as initialized for fallback mode
                self.is_initialized = True
                return True

        except Exception as e:
            logger.error(f"[STORY] Failed to initialize story service: {e}")
            # Still mark as initialized for fallback mode
            self.is_initialized = True
            return True

    def get_story_url(self, filename: str, category: str = "Adventure") -> str:
        """Generate URL for story file"""
        audio_path = f"stories/{category}/{filename}"
        # Ensure we don't encode the slashes in the path
        encoded_path = urllib.parse.quote(audio_path, safe='/')

        if self.use_cdn and self.cloudfront_domain:
            return f"https://{self.cloudfront_domain}/{encoded_path}"
        else:
            return f"{self.s3_base_url}/{encoded_path}"

    async def search_stories(self, query: str, category: Optional[str] = None) -> List[Dict]:
        """Search for stories using enhanced semantic search with spell tolerance"""
        if not self.is_initialized:
            logger.warning(f"Story service not initialized - cannot search for '{query}'")
            return []

        try:
            # Use semantic search service with enhanced fuzzy matching
            search_results = await self.semantic_search.search_stories(query, category, limit=5)

            # Convert search results to expected format
            results = []
            for result in search_results:
                results.append({
                    'title': result.title,
                    'filename': result.filename,
                    'category': result.language_or_category,  # Stories use category instead of language
                    'url': self.get_story_url(result.filename, result.language_or_category),
                    'score': result.score
                })

            if results:
                logger.info(f"📚 Found {len(results)} stories for '{query}' - top match: '{results[0]['title']}' (score: {results[0]['score']:.2f})")
            else:
                logger.warning(f"📚 No stories found for '{query}' - will try random story")
                # If no results, fall back to random story
                return []

            return results

        except Exception as e:
            logger.error(f"Error in semantic story search for '{query}': {e}")
            # Fall back to random story on error
            return []

    async def search_stories_by_name(self, story_name: str, category: Optional[str] = None, limit: int = 5) -> List[Dict]:
        """
        Search for stories by name with fuzzy matching support.
        This method is optimized for specific content requests from mobile app.

        Args:
            story_name: Name of the story to search for
            category: Optional category filter
            limit: Maximum number of results to return (default: 5)

        Returns:
            List of matching stories with metadata (title, filename, category, url, score)
        """
        if not self.is_initialized:
            logger.warning(f"[STORY-SEARCH] Story service not initialized - cannot search for '{story_name}'")
            return []

        try:
            search_query = story_name.lower().strip()
            logger.info(f"🔍 [STORY-SEARCH] Searching for story: '{story_name}', Category: {category or 'Any'}")

            # Use the existing semantic search which already has fuzzy matching
            search_results = await self.semantic_search.search_stories(search_query, category, limit=limit)

            # Convert to expected format with additional metadata
            results = []
            for result in search_results:
                story_data = {
                    'title': result.title,
                    'filename': result.filename,
                    'category': result.language_or_category,
                    'url': self.get_story_url(result.filename, result.language_or_category),
                    'score': result.score
                }
                results.append(story_data)

            if results:
                logger.info(f"🔍 [STORY-SEARCH] Found {len(results)} matches for '{story_name}' - best: '{results[0]['title']}' (score: {results[0]['score']:.2f})")
            else:
                logger.warning(f"⚠️ [STORY-SEARCH] No stories found matching '{story_name}'")

            return results

        except Exception as e:
            logger.error(f"❌ [STORY-SEARCH] Error searching for '{story_name}': {e}")
            return []

    async def get_random_story(self, category: Optional[str] = None) -> Optional[Dict]:
        """Get a random story using semantic search or fallback"""
        if not self.is_initialized:
            return None

        try:
            # First try to get a random story from Qdrant
            random_result = await self.semantic_search.get_random_story(category)

            if random_result:
                story = {
                    'title': random_result.title,
                    'filename': random_result.filename,
                    'category': random_result.language_or_category,
                    'url': self.get_story_url(random_result.filename, random_result.language_or_category)
                }
                logger.info(f"📚 Selected random story from Qdrant: {story['title']} ({story['category']})")
                return story

            # Fallback to hardcoded stories if Qdrant fails
            logger.warning("📚 Qdrant random story failed - using fallback stories")
            sample_stories = [
                {
                    'title': 'Why Bananas Belong to Monkeys',
                    'filename': 'why bananas belong to monkeys.mp3',
                    'category': 'Adventure'
                },
                {
                    'title': 'Agent Bertie',
                    'filename': 'agent bertie part.mp3',
                    'category': 'Adventure'
                },
                {
                    'title': 'The Three Dogs',
                    'filename': 'the three dogs.mp3',
                    'category': 'Bedtime'
                },
                {
                    'title': 'Sleeping Beauty',
                    'filename': 'sleeping beauty.mp3',
                    'category': 'Bedtime'
                },
                {
                    'title': 'The Christmas Cherry Tree',
                    'filename': 'the christmas cherry tree.mp3',
                    'category': 'Educational'
                },
                {
                    'title': 'Hansel and Gretel',
                    'filename': 'hansel and gretel.mp3',
                    'category': 'Fantasy'
                },
                {
                    'title': 'Katie Unicorn',
                    'filename': 'katie unicorn.mp3',
                    'category': 'Fantasy'
                },
                {
                    'title': 'A Portrait of a Cat',
                    'filename': 'a portrait of a cat.mp3',
                    'category': 'Fairy Tales'
                },
                {
                    'title': 'Honest Jack',
                    'filename': 'honest jack.mp3',
                    'category': 'Fairy Tales'
                }
            ]

            # Filter by category if specified
            if category:
                filtered_stories = [s for s in sample_stories if s['category'].lower() == category.lower()]
                if filtered_stories:
                    sample_stories = filtered_stories

            # Select a random story from the fallback list
            story = random.choice(sample_stories)
            story['url'] = self.get_story_url(story['filename'], story['category'])

            logger.info(f"📚 Selected fallback story: {story['title']} ({story['category']})")
            return story

        except Exception as e:
            logger.error(f"Error getting random story: {e}")
            # Last resort fallback
            fallback = {
                'title': 'Why Bananas Belong to Monkeys',
                'filename': 'why bananas belong to monkeys.mp3',
                'category': 'Adventure',
                'url': self.get_story_url('why bananas belong to monkeys.mp3', 'Adventure')
            }
            return fallback

    async def get_all_categories(self) -> List[str]:
        """Get list of available story categories from semantic search or fallback"""
        if not self.is_initialized:
            return []

        try:
            # Try to get categories from Qdrant
            categories = await self.semantic_search.get_available_categories()

            if categories:
                logger.info(f"📚 Found {len(categories)} story categories from Qdrant")
                return categories

            # Fallback to known categories
            logger.warning("📚 Using fallback category list")
            return ["Adventure", "Bedtime", "Educational", "Fantasy", "Fairy Tales"]

        except Exception as e:
            logger.error(f"Error getting story categories: {e}")
            # Return fallback categories
            return ["Adventure", "Bedtime", "Educational", "Fantasy", "Fairy Tales"]