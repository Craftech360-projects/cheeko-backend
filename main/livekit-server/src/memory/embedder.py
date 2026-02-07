"""
Embedding wrapper using sentence-transformers.
Reuses the cached model from model_cache to avoid loading duplicates.
"""

import asyncio
import logging
from typing import List

logger = logging.getLogger("memory.embedder")


class Embedder:
    """Async wrapper around SentenceTransformer for text embedding."""

    def __init__(self, config: dict):
        self.model_name = config.get("model", "all-MiniLM-L6-v2")
        self._model = None
        self.dimension = 384  # MiniLM-L6-v2 output size

    def _get_model(self):
        """Get or load the embedding model via model_cache."""
        if self._model is None:
            try:
                from ..utils.model_cache import model_cache
                self._model = model_cache.get_embedding_model(self.model_name)
                if self._model is not None:
                    logger.info(f"[EMBEDDER] Loaded model via model_cache: {self.model_name}")
                else:
                    logger.error(f"[EMBEDDER] model_cache returned None for {self.model_name}")
            except Exception as e:
                logger.error(f"[EMBEDDER] Failed to load model: {e}")
        return self._model

    async def embed(self, text: str) -> List[float]:
        """Embed a single text string.

        Args:
            text: Input text to embed.

        Returns:
            List of floats (384-dimensional vector).
        """
        model = self._get_model()
        if model is None:
            return [0.0] * self.dimension

        loop = asyncio.get_event_loop()
        embedding = await loop.run_in_executor(None, lambda: model.encode(text).tolist())
        return embedding

    async def embed_batch(self, texts: List[str]) -> List[List[float]]:
        """Embed a batch of texts.

        Args:
            texts: List of input texts.

        Returns:
            List of embedding vectors.
        """
        if not texts:
            return []

        model = self._get_model()
        if model is None:
            return [[0.0] * self.dimension for _ in texts]

        loop = asyncio.get_event_loop()
        embeddings = await loop.run_in_executor(
            None, lambda: model.encode(texts).tolist()
        )
        return embeddings
