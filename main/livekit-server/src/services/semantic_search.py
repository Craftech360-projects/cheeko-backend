"""
Qdrant Semantic Search Implementation for Music and Stories
Enhanced semantic search using vector database
"""

import logging
import asyncio
import os
from typing import Dict, List, Optional
from dataclasses import dataclass

# Qdrant and ML dependencies
try:
    from qdrant_client import QdrantClient
    from qdrant_client import models
    from qdrant_client.models import Filter, FieldCondition, Match, PointStruct
    from sentence_transformers import SentenceTransformer
    QDRANT_AVAILABLE = True
except ImportError:
    QDRANT_AVAILABLE = False

logger = logging.getLogger(__name__)

@dataclass
class QdrantSearchResult:
    """Enhanced search result with vector scoring"""
    title: str
    filename: str
    language_or_category: str
    score: float
    metadata: Dict
    alternatives: List[str]
    romanized: str

class QdrantSemanticSearch:
    """
    Advanced semantic search using Qdrant vector database
    """

    def __init__(self, preloaded_model=None, preloaded_client=None):
        self.is_available = QDRANT_AVAILABLE

        # Use cached models if preloaded ones not provided
        if preloaded_model is None or preloaded_client is None:
            from ..utils.model_cache import model_cache
            self.client = preloaded_client or model_cache.get_qdrant_client()
            self.model = preloaded_model or model_cache.get_embedding_model()
        else:
            self.client = preloaded_client
            self.model = preloaded_model

        self.is_initialized = False

        # Qdrant configuration from environment variables
        self.config = {
            "qdrant_url": os.getenv("QDRANT_URL", ""),
            "qdrant_api_key": os.getenv("QDRANT_API_KEY", ""),
            "music_collection": "xiaozhi_music",
            "stories_collection": "xiaozhi_stories",
            "embedding_model": "all-MiniLM-L6-v2",
            "search_limit": 10,
            "min_score_threshold": 0.5,
            "allowed_music_languages": self._parse_allowed_languages()
        }

        if not QDRANT_AVAILABLE:
            logger.warning("Qdrant dependencies not available, semantic search will be limited")

    def _parse_allowed_languages(self) -> List[str]:
        """Parse allowed music languages from environment variable

        Returns:
            List of allowed language names, or empty list to allow all languages
        """
        allowed = os.getenv("ALLOWED_MUSIC_LANGUAGES", "")
        if allowed:
            languages = [lang.strip() for lang in allowed.split(",") if lang.strip()]
            logger.info(f"🎵 Music search restricted to languages: {', '.join(languages)}")
            return languages
        else:
            logger.info("🎵 Music search enabled for ALL languages (no restrictions)")
            return []

    async def initialize(self) -> bool:
        """Initialize Qdrant client and embedding model with fallback support"""
        if not self.is_available:
            logger.warning("Qdrant dependencies not available, semantic search will be limited")
            return False

        # Check if Qdrant configuration is provided
        if not self.config["qdrant_url"] or not self.config["qdrant_api_key"]:
            logger.warning("Qdrant configuration missing, semantic search will be limited")
            return False

        try:
            # Use preloaded model if available, otherwise load it from cache
            if self.model is None:
                logger.info(f"Loading embedding model from cache: {self.config['embedding_model']}")
                from ..utils.model_cache import model_cache
                self.model = model_cache.get_embedding_model(self.config["embedding_model"])
                logger.info(f"✅ Loaded embedding model from cache: {self.config['embedding_model']}")
            else:
                logger.info("✅ Using preloaded embedding model from prewarm")

            # Use preloaded client if available, otherwise create it
            if self.client is None:
                self.client = QdrantClient(
                    url=self.config["qdrant_url"],
                    api_key=self.config["qdrant_api_key"],
                    timeout=10  # Add timeout for faster failure detection
                )
            else:
                logger.info("✅ Using preloaded Qdrant client from prewarm")

            # Test connection with timeout
            try:
                collections = self.client.get_collections()
                logger.info("✅ Connected to Qdrant cloud successfully")
                
                # Check if collections exist and have data
                await self._ensure_collections_exist()
                
                self.is_initialized = True
                return True
                
            except Exception as conn_error:
                logger.error(f"❌ Qdrant connection failed: {conn_error}")
                logger.info("🔄 Semantic search will work with local embeddings only")
                
                # Still mark as initialized if we have the embedding model
                # This allows for local similarity calculations
                self.is_initialized = True
                return True

        except Exception as e:
            logger.error(f"Failed to initialize semantic search: {e}")
            return False

    async def _ensure_collections_exist(self):
        """Check that required collections exist in Qdrant cloud"""
        try:
            # Check music collection exists
            try:
                music_info = self.client.get_collection(self.config["music_collection"])
                logger.info(f"Music collection '{self.config['music_collection']}' found with {music_info.points_count} points")
            except Exception:
                logger.warning(f"Music collection '{self.config['music_collection']}' not found in cloud")

            # Check stories collection exists
            try:
                stories_info = self.client.get_collection(self.config["stories_collection"])
                logger.info(f"Stories collection '{self.config['stories_collection']}' found with {stories_info.points_count} points")
            except Exception:
                logger.warning(f"Stories collection '{self.config['stories_collection']}' not found in cloud")

        except Exception as e:
            logger.error(f"Error checking collections: {e}")

    def _get_embedding(self, text: str) -> List[float]:
        """Generate embedding for text"""
        if not text or not self.model:
            return []
        try:
            return self.model.encode(text).tolist()
        except AttributeError as e:
            if "model_forward_params" in str(e):
                logger.error("Embedding model version incompatibility detected. Please update sentence-transformers: pip install sentence-transformers>=2.2.2 transformers>=4.21.0")
                # Try to reload the model with proper error handling
                try:
                    from ..utils.model_cache import model_cache
                    model_cache.clear_cache()  # Clear the problematic cached model
                    logger.info("Cleared model cache due to compatibility issue")
                except Exception:
                    pass
            raise e
        except Exception as e:
            logger.error(f"Failed to generate embedding: {e}")
            return []

    async def index_music_metadata(self, music_metadata: Dict) -> bool:
        """Index music metadata into Qdrant"""
        if not self.is_initialized:
            logger.warning("Semantic search not initialized, skipping indexing")
            return False

        try:
            points = []
            point_id = 0

            for language, language_metadata in music_metadata.items():
                for song_title, song_info in language_metadata.items():
                    # Prepare searchable text for embedding
                    searchable_texts = [
                        song_title,  # Original title
                        song_info.get('romanized', ''),  # Romanized version
                    ]

                    # Add alternative names
                    alternatives = song_info.get('alternatives', [])
                    if isinstance(alternatives, list):
                        searchable_texts.extend(alternatives)

                    # Add keywords
                    keywords = song_info.get('keywords', [])
                    if isinstance(keywords, list):
                        searchable_texts.extend(keywords)

                    # Add language for context
                    searchable_texts.append(language)

                    # Combine all searchable text
                    combined_text = " ".join(filter(None, searchable_texts)).strip()

                    if not combined_text:
                        continue

                    # Generate embedding
                    embedding = self._get_embedding(combined_text)
                    if not embedding:
                        continue

                    # Prepare payload
                    payload = {
                        'title': song_title,
                        'language': language,
                        'romanized': song_info.get('romanized', song_title),
                        'alternatives': alternatives,
                        'keywords': keywords,
                        'filename': song_info.get('filename', f"{song_title}.mp3"),
                        'file_path': f"{language}/{song_info.get('filename', f'{song_title}.mp3')}",
                        'searchable_text': combined_text,
                        'metadata': song_info
                    }

                    points.append(
                        PointStruct(
                            id=point_id,
                            vector=embedding,
                            payload=payload
                        )
                    )
                    point_id += 1

            # Upsert points to Qdrant
            if points:
                self.client.upsert(
                    collection_name=self.config["music_collection"],
                    points=points
                )
                logger.info(f"Indexed {len(points)} music tracks into Qdrant")
                return True
            else:
                logger.warning("No music metadata to index")
                return False

        except Exception as e:
            logger.error(f"Failed to index music metadata: {e}")
            return False

    async def index_stories_metadata(self, stories_metadata: Dict) -> bool:
        """Skip indexing - use existing cloud collections"""
        logger.info("Skipping stories indexing - using existing cloud collections")
        return True

    async def search_music(self, query: str, language_filter: Optional[str] = None, limit: int = 5) -> List[QdrantSearchResult]:
        """Search for music using enhanced semantic search with fuzzy matching"""
        if not self.is_initialized:
            return []

        try:
            # If Qdrant client is available, try vector search first
            if self.client:
                try:
                    # Generate query embedding for true semantic search
                    query_embedding = self._get_embedding(query)
                    if query_embedding:
                        search_result = self.client.query_points(
                            collection_name=self.config["music_collection"],
                            query=query_embedding,
                            limit=limit * 3,  # Get more results for filtering
                            with_payload=True,
                            score_threshold=0.3  # Lower threshold for better recall
                        ).points
                        
                        # Convert to our result format
                        results = []
                        for scored_point in search_result:
                            payload = scored_point.payload
                            
                            # Apply language filter if specified (but don't exclude all other languages)
                            if language_filter and payload.get('language') != language_filter:
                                # Reduce score but don't exclude completely
                                score = scored_point.score * 0.7
                            else:
                                score = scored_point.score
                            
                            results.append(QdrantSearchResult(
                                title=payload['title'],
                                filename=payload['filename'],
                                language_or_category=payload['language'],
                                score=score,
                                metadata=payload,
                                alternatives=payload.get('alternatives', []),
                                romanized=payload.get('romanized', '')
                            ))
                        
                        # Filter by allowed languages if configured
                        if self.config["allowed_music_languages"]:
                            results = [r for r in results if r.language_or_category in self.config["allowed_music_languages"]]
                            logger.info(f"🔒 Filtered to allowed languages: {len(results)} results remain")

                        # If we have good vector results, return them
                        if results:
                            results.sort(key=lambda x: x.score, reverse=True)
                            logger.info(f"✅ Vector search found {len(results)} results for '{query}'")
                            return results[:limit]
                            
                except Exception as e:
                    logger.warning(f"Vector search failed, trying text search: {e}")

                # Fallback to enhanced text search with Qdrant data
                try:
                    scroll_result = self.client.scroll(
                        collection_name=self.config["music_collection"],
                        limit=1000,  # Get all points for comprehensive search
                        with_payload=True
                    )

                    results = []
                    query_lower = query.lower().strip()
                    query_words = query_lower.split()

                    for point in scroll_result[0]:
                        payload = point.payload
                        
                        # Get all searchable text fields
                        title = payload.get('title', '').lower()
                        romanized = payload.get('romanized', '').lower()
                        alternatives = [alt.lower() for alt in payload.get('alternatives', [])]
                        keywords = [kw.lower() for kw in payload.get('keywords', [])]
                        language = payload.get('language', '').lower()
                        
                        # Calculate comprehensive similarity score
                        score = self._calculate_fuzzy_score(query_lower, query_words, {
                            'title': title,
                            'romanized': romanized,
                            'alternatives': alternatives,
                            'keywords': keywords,
                            'language': language
                        })
                        
                        # Apply language preference (not filter)
                        if language_filter:
                            if payload.get('language') == language_filter:
                                score *= 1.2  # Boost preferred language
                            else:
                                score *= 0.8  # Slight penalty for other languages
                        
                        # Only include results with meaningful scores
                        if score > 0.2:
                            results.append(QdrantSearchResult(
                                title=payload['title'],
                                filename=payload['filename'],
                                language_or_category=payload['language'],
                                score=score,
                                metadata=payload,
                                alternatives=payload.get('alternatives', []),
                                romanized=payload.get('romanized', '')
                            ))

                    # Filter by allowed languages if configured
                    if self.config["allowed_music_languages"]:
                        results = [r for r in results if r.language_or_category in self.config["allowed_music_languages"]]
                        logger.info(f"🔒 Filtered to allowed languages: {len(results)} results remain")

                    # Sort by score and return top results
                    results.sort(key=lambda x: x.score, reverse=True)
                    final_results = results[:limit]

                    if self.config["allowed_music_languages"]:
                        logger.info(f"✅ Enhanced text search found {len(final_results)} results for '{query}' in allowed languages: {', '.join(self.config['allowed_music_languages'])}")
                    else:
                        logger.info(f"✅ Enhanced text search found {len(final_results)} results for '{query}' across all languages")
                    return final_results
                    
                except Exception as e:
                    logger.warning(f"Qdrant text search failed: {e}")

            # Final fallback: return empty results with helpful message
            logger.warning(f"All search methods failed for query '{query}' - Qdrant may be unavailable")
            return []

        except Exception as e:
            logger.error(f"Music search completely failed: {e}")
            return []

    def _calculate_fuzzy_score(self, query: str, query_words: list, fields: dict) -> float:
        """Calculate fuzzy similarity score with spell tolerance"""
        max_score = 0.0
        
        # Exact matches (highest priority)
        if query == fields['title']:
            return 1.0
        if query == fields['romanized']:
            return 0.95
        if query in fields['alternatives']:
            return 0.9
        if query in fields['keywords']:
            return 0.85
            
        # Substring matches
        if query in fields['title']:
            max_score = max(max_score, 0.8)
        if query in fields['romanized']:
            max_score = max(max_score, 0.75)
        for alt in fields['alternatives']:
            if query in alt:
                max_score = max(max_score, 0.7)
        for kw in fields['keywords']:
            if query in kw:
                max_score = max(max_score, 0.65)
                
        # Word-level matching (handles partial matches and misspellings)
        for word in query_words:
            if len(word) < 2:  # Skip very short words
                continue
                
            # Check each field for word matches
            if word in fields['title']:
                max_score = max(max_score, 0.6)
            if word in fields['romanized']:
                max_score = max(max_score, 0.55)
            for alt in fields['alternatives']:
                if word in alt:
                    max_score = max(max_score, 0.5)
            for kw in fields['keywords']:
                if word in kw:
                    max_score = max(max_score, 0.45)
                    
            # Fuzzy matching for misspellings (simple edit distance)
            for field_name, field_value in [('title', fields['title']), ('romanized', fields['romanized'])]:
                if field_value:
                    fuzzy_score = self._simple_fuzzy_match(word, field_value)
                    if fuzzy_score > 0.7:  # Only consider good fuzzy matches
                        bonus = 0.4 if field_name == 'title' else 0.35
                        max_score = max(max_score, fuzzy_score * bonus)
        
        return max_score
    
    def _simple_fuzzy_match(self, word: str, text: str) -> float:
        """Simple fuzzy matching for spell tolerance"""
        if not word or not text:
            return 0.0
            
        # Check if word appears with small variations
        text_words = text.split()
        for text_word in text_words:
            if len(text_word) < 2:
                continue
                
            # Calculate simple similarity
            if word == text_word:
                return 1.0
            if word in text_word or text_word in word:
                return 0.8
                
            # Simple character overlap check
            if len(word) >= 3 and len(text_word) >= 3:
                common_chars = set(word.lower()) & set(text_word.lower())
                similarity = len(common_chars) / max(len(set(word.lower())), len(set(text_word.lower())))
                if similarity > 0.6:
                    return similarity
                    
        return 0.0

    async def search_stories(self, query: str, category_filter: Optional[str] = None, limit: int = 5) -> List[QdrantSearchResult]:
        """Search for stories using enhanced semantic search with fuzzy matching"""
        if not self.is_initialized:
            return []

        try:
            # Generate query embedding for true semantic search
            query_embedding = self._get_embedding(query)
            if not query_embedding:
                logger.warning("Failed to generate embedding for query")
                return []

            # First try vector similarity search
            try:
                search_result = self.client.query_points(
                    collection_name=self.config["stories_collection"],
                    query=query_embedding,
                    limit=limit * 3,  # Get more results for filtering
                    with_payload=True,
                    score_threshold=0.3  # Lower threshold for better recall
                ).points
                
                # Convert to our result format
                results = []
                for scored_point in search_result:
                    payload = scored_point.payload
                    
                    # Apply category filter if specified (but don't exclude all other categories)
                    if category_filter and payload.get('category') != category_filter:
                        # Reduce score but don't exclude completely
                        score = scored_point.score * 0.7
                    else:
                        score = scored_point.score
                    
                    results.append(QdrantSearchResult(
                        title=payload['title'],
                        filename=payload['filename'],
                        language_or_category=payload['category'],
                        score=score,
                        metadata=payload,
                        alternatives=payload.get('alternatives', []),
                        romanized=payload.get('romanized', '')
                    ))
                
                # If we have good vector results, return them
                if results:
                    results.sort(key=lambda x: x.score, reverse=True)
                    logger.info(f"Vector search found {len(results)} results for '{query}'")
                    return results[:limit]
                    
            except Exception as e:
                logger.warning(f"Vector search failed, falling back to text search: {e}")

            # Fallback to enhanced text search with fuzzy matching
            scroll_result = self.client.scroll(
                collection_name=self.config["stories_collection"],
                limit=1000,  # Get all points for comprehensive search
                with_payload=True
            )

            results = []
            query_lower = query.lower().strip()
            query_words = query_lower.split()

            for point in scroll_result[0]:
                payload = point.payload
                
                # Get all searchable text fields
                title = payload.get('title', '').lower()
                romanized = payload.get('romanized', '').lower()
                alternatives = [alt.lower() for alt in payload.get('alternatives', [])]
                keywords = [kw.lower() for kw in payload.get('keywords', [])]
                category = payload.get('category', '').lower()
                
                # Calculate comprehensive similarity score
                score = self._calculate_fuzzy_score(query_lower, query_words, {
                    'title': title,
                    'romanized': romanized,
                    'alternatives': alternatives,
                    'keywords': keywords,
                    'language': category  # Use category as language field for stories
                })
                
                # Apply category preference (not filter)
                if category_filter:
                    if payload.get('category') == category_filter:
                        score *= 1.2  # Boost preferred category
                    else:
                        score *= 0.8  # Slight penalty for other categories
                
                # Only include results with meaningful scores
                if score > 0.2:
                    results.append(QdrantSearchResult(
                        title=payload['title'],
                        filename=payload['filename'],
                        language_or_category=payload['category'],
                        score=score,
                        metadata=payload,
                        alternatives=payload.get('alternatives', []),
                        romanized=payload.get('romanized', '')
                    ))

            # Sort by score and return top results
            results.sort(key=lambda x: x.score, reverse=True)
            final_results = results[:limit]
            
            logger.info(f"Enhanced text search found {len(final_results)} results for '{query}' across all categories")
            return final_results

        except Exception as e:
            logger.error(f"Story search failed: {e}")
            return []

    async def get_random_music(self, language_filter: Optional[str] = None) -> Optional[QdrantSearchResult]:
        """Get a random song from Qdrant collection"""
        if not self.is_initialized:
            return None

        try:
            # Use scroll to get random points without filters to avoid typing issues
            scroll_result = self.client.scroll(
                collection_name=self.config["music_collection"],
                limit=100,  # Get more points to choose from
                with_payload=True
            )

            if scroll_result[0]:  # Check if we have any points
                import random
                # Filter by language if specified
                valid_points = scroll_result[0]

                # First apply allowed languages filter if configured
                if self.config["allowed_music_languages"]:
                    valid_points = [p for p in valid_points if p.payload.get('language') in self.config["allowed_music_languages"]]
                    logger.info(f"🔒 Random music restricted to allowed languages: {', '.join(self.config['allowed_music_languages'])}")

                # Then apply specific language filter if requested
                if language_filter:
                    valid_points = [p for p in valid_points if p.payload.get('language') == language_filter]

                if valid_points:
                    random_point = random.choice(valid_points)
                    return QdrantSearchResult(
                        title=random_point.payload['title'],
                        filename=random_point.payload['filename'],
                        language_or_category=random_point.payload['language'],
                        score=1.0,
                        metadata=random_point.payload,
                        alternatives=random_point.payload.get('alternatives', []),
                        romanized=random_point.payload.get('romanized', '')
                    )

            return None

        except Exception as e:
            logger.error(f"Qdrant random music selection failed: {e}")
            return None

    async def get_random_story(self, category_filter: Optional[str] = None) -> Optional[QdrantSearchResult]:
        """Get a random story from Qdrant collection"""
        if not self.is_initialized:
            return None

        try:
            # Use scroll to get random points without filters to avoid typing issues
            scroll_result = self.client.scroll(
                collection_name=self.config["stories_collection"],
                limit=100,  # Get more points to choose from
                with_payload=True
            )

            if scroll_result[0]:  # Check if we have any points
                import random
                # Filter by category if specified
                valid_points = scroll_result[0]
                if category_filter:
                    valid_points = [p for p in scroll_result[0] if p.payload.get('category') == category_filter]

                if valid_points:
                    random_point = random.choice(valid_points)
                    return QdrantSearchResult(
                        title=random_point.payload['title'],
                        filename=random_point.payload['filename'],
                        language_or_category=random_point.payload['category'],
                        score=1.0,
                        metadata=random_point.payload,
                        alternatives=random_point.payload.get('alternatives', []),
                        romanized=random_point.payload.get('romanized', '')
                    )

            return None

        except Exception as e:
            logger.error(f"Qdrant random story selection failed: {e}")
            return None

    async def get_available_languages(self) -> List[str]:
        """Get list of available music languages from Qdrant"""
        if not self.is_initialized:
            return []

        try:
            # Use aggregation to get unique languages
            scroll_result = self.client.scroll(
                collection_name=self.config["music_collection"],
                limit=1000,  # Get a large sample
                with_payload=["language"]
            )

            languages = set()
            for point in scroll_result[0]:
                if 'language' in point.payload:
                    languages.add(point.payload['language'])

            return sorted(list(languages))

        except Exception as e:
            logger.error(f"Failed to get available languages: {e}")
            return []

    async def get_available_categories(self) -> List[str]:
        """Get list of available story categories from Qdrant"""
        if not self.is_initialized:
            return []

        try:
            # Use aggregation to get unique categories
            scroll_result = self.client.scroll(
                collection_name=self.config["stories_collection"],
                limit=1000,  # Get a large sample
                with_payload=["category"]
            )

            categories = set()
            for point in scroll_result[0]:
                if 'category' in point.payload:
                    categories.add(point.payload['category'])

            return sorted(list(categories))

        except Exception as e:
            logger.error(f"Failed to get available categories: {e}")
            return []