"""
Qdrant-based memory backend for scale (Tier 2).

Uses a single Qdrant collection with mac_id payload filter for per-device isolation.
File storage (profile, daily_log) uses Supabase REST API, falling back to local
filesystem if Supabase is not configured.
"""

import asyncio
import hashlib
import logging
import os
import uuid
from datetime import datetime
from pathlib import Path
from typing import Dict, List, Optional

from .base import MemoryBackend

logger = logging.getLogger("memory.qdrant_backend")

try:
    from qdrant_client import AsyncQdrantClient, models
    from qdrant_client.models import (
        Distance,
        FieldCondition,
        Filter,
        MatchValue,
        PointStruct,
        VectorParams,
    )
    QDRANT_AVAILABLE = True
except ImportError:
    QDRANT_AVAILABLE = False
    logger.warning("[QDRANT] qdrant_client not available")

try:
    import httpx
    HTTPX_AVAILABLE = True
except ImportError:
    HTTPX_AVAILABLE = False


def _normalize_mac(mac: str) -> str:
    return mac.replace(":", "").replace("-", "").lower()


class QdrantBackend(MemoryBackend):
    """Qdrant + Supabase memory backend (Tier 2).

    Vectors stored in a single Qdrant collection filtered by mac_id.
    Files stored in Supabase `device_memories` table (or local fallback).
    """

    def __init__(self, config: dict):
        """Initialize with qdrant config section from config.yaml.

        Expected config keys:
            url: Qdrant cloud URL
            api_key: Qdrant API key
            collection: Collection name (default: "cheeko_memories")
            vector_size: Embedding dimension (default: 384)
        """
        if not QDRANT_AVAILABLE:
            raise ImportError("qdrant_client package is required for QdrantBackend")

        self.qdrant_url = config.get("url") or os.getenv("QDRANT_URL", "")
        self.qdrant_api_key = config.get("api_key") or os.getenv("QDRANT_API_KEY", "")
        self.collection = config.get("collection", "cheeko_memories")
        self.vector_size = config.get("vector_size", 384)

        self._client: Optional[AsyncQdrantClient] = None
        self._collection_ready = False

        # Supabase config for file storage
        self.supabase_url = config.get("supabase_url") or os.getenv("SUPABASE_URL", "")
        self.supabase_key = config.get("supabase_key") or os.getenv("SUPABASE_SERVICE_ROLE_KEY", "")
        self._supabase_available = bool(self.supabase_url and self.supabase_key and HTTPX_AVAILABLE)

        # Local filesystem fallback for file storage
        base_path = config.get("file_fallback_path", "./memory")
        self._files_dir = Path(base_path) / "files"

        logger.info(
            f"[QDRANT] Backend created (collection={self.collection}, "
            f"supabase={'yes' if self._supabase_available else 'no (local fallback)'})"
        )

    async def _get_client(self) -> AsyncQdrantClient:
        """Lazy-init the async Qdrant client."""
        if self._client is None:
            self._client = AsyncQdrantClient(
                url=self.qdrant_url,
                api_key=self.qdrant_api_key,
            )
        return self._client

    async def _ensure_collection(self):
        """Create collection if it doesn't exist."""
        if self._collection_ready:
            return

        client = await self._get_client()
        try:
            collections = await client.get_collections()
            existing = [c.name for c in collections.collections]

            if self.collection not in existing:
                await client.create_collection(
                    collection_name=self.collection,
                    vectors_config=VectorParams(
                        size=self.vector_size,
                        distance=Distance.COSINE,
                    ),
                )
                # Create payload index on mac_id for fast filtering
                await client.create_payload_index(
                    collection_name=self.collection,
                    field_name="mac_id",
                    field_schema="keyword",
                )
                logger.info(f"[QDRANT] Created collection '{self.collection}' ({self.vector_size}d)")
            else:
                logger.info(f"[QDRANT] Collection '{self.collection}' exists")

            self._collection_ready = True
        except Exception as e:
            logger.error(f"[QDRANT] Failed to ensure collection: {e}")
            raise

    # ─── MemoryBackend interface ──────────────────────────────────

    async def initialize(self, mac_id: str):
        """Ensure collection exists. Per-device init is a no-op for Qdrant."""
        await self._ensure_collection()

        # Ensure local fallback directory exists
        if not self._supabase_available:
            normalized = _normalize_mac(mac_id)
            device_dir = self._files_dir / normalized
            await asyncio.get_event_loop().run_in_executor(
                None, lambda: device_dir.mkdir(parents=True, exist_ok=True)
            )

    async def search(self, mac_id: str, query_embedding: List[float], limit: int = 5) -> List[Dict]:
        """Vector search filtered by mac_id."""
        client = await self._get_client()
        normalized = _normalize_mac(mac_id)

        try:
            results = await client.query_points(
                collection_name=self.collection,
                query=query_embedding,
                query_filter=Filter(
                    must=[
                        FieldCondition(
                            key="mac_id",
                            match=MatchValue(value=normalized),
                        )
                    ]
                ),
                limit=limit,
            )

            return [
                {
                    "id": str(point.id),
                    "text": point.payload.get("text", ""),
                    "file_path": point.payload.get("file_path", ""),
                    "category": point.payload.get("category", "general"),
                    "score": point.score,
                }
                for point in results.points
            ]
        except Exception as e:
            logger.error(f"[QDRANT] Search failed: {e}")
            return []

    async def fts_search(self, mac_id: str, query: str, limit: int = 5) -> List[Dict]:
        """Keyword search — Qdrant doesn't have FTS, so we use payload filter.

        Falls back to a broad vector-less scroll with text matching.
        For production, consider Qdrant's full-text index feature.
        """
        client = await self._get_client()
        normalized = _normalize_mac(mac_id)

        try:
            # Use scroll with payload filter to find text containing query words
            keywords = query.lower().split()
            if not keywords:
                return []

            # Scroll through device's points and do client-side text matching
            # This is acceptable for moderate data sizes per device
            results, _ = await client.scroll(
                collection_name=self.collection,
                scroll_filter=Filter(
                    must=[
                        FieldCondition(
                            key="mac_id",
                            match=MatchValue(value=normalized),
                        )
                    ]
                ),
                limit=200,  # Scan up to 200 points per device
                with_payload=True,
                with_vectors=False,
            )

            # Score by keyword overlap
            scored = []
            for point in results:
                text = point.payload.get("text", "").lower()
                matches = sum(1 for kw in keywords if kw in text)
                if matches > 0:
                    scored.append({
                        "id": str(point.id),
                        "text": point.payload.get("text", ""),
                        "file_path": point.payload.get("file_path", ""),
                        "category": point.payload.get("category", "general"),
                        "score": matches / len(keywords),
                    })

            scored.sort(key=lambda r: r["score"], reverse=True)
            return scored[:limit]

        except Exception as e:
            logger.error(f"[QDRANT] FTS search failed: {e}")
            return []

    async def upsert_chunks(self, mac_id: str, chunks: List[Dict]):
        """Upsert chunks as Qdrant points with mac_id payload."""
        if not chunks:
            return

        client = await self._get_client()
        normalized = _normalize_mac(mac_id)

        points = []
        for chunk in chunks:
            embedding = chunk.get("embedding")
            if not embedding:
                continue

            content_hash = chunk.get("content_hash") or hashlib.md5(
                chunk["text"].encode()
            ).hexdigest()

            # Use deterministic ID from mac + content_hash for dedup
            point_id = str(uuid.uuid5(uuid.NAMESPACE_DNS, f"{normalized}:{content_hash}"))

            points.append(PointStruct(
                id=point_id,
                vector=embedding,
                payload={
                    "mac_id": normalized,
                    "text": chunk["text"],
                    "file_path": chunk.get("file_path", ""),
                    "start_line": chunk.get("start_line", 0),
                    "end_line": chunk.get("end_line", 0),
                    "category": chunk.get("category", "general"),
                    "content_hash": content_hash,
                    "timestamp": chunk.get("timestamp") or datetime.utcnow().isoformat(),
                },
            ))

        if points:
            try:
                await client.upsert(
                    collection_name=self.collection,
                    points=points,
                )
                logger.info(f"[QDRANT] Upserted {len(points)} points for {normalized}")
            except Exception as e:
                logger.error(f"[QDRANT] Upsert failed: {e}")

    async def replace_all_chunks(self, mac_id: str, chunks: List[Dict]):
        """Delete all points for device, then upsert new ones."""
        client = await self._get_client()
        normalized = _normalize_mac(mac_id)

        try:
            # Delete all points for this device
            await client.delete(
                collection_name=self.collection,
                points_selector=models.FilterSelector(
                    filter=Filter(
                        must=[
                            FieldCondition(
                                key="mac_id",
                                match=MatchValue(value=normalized),
                            )
                        ]
                    )
                ),
            )
            logger.info(f"[QDRANT] Deleted all points for {normalized}")
        except Exception as e:
            logger.error(f"[QDRANT] Delete failed: {e}")

        # Insert new chunks
        await self.upsert_chunks(mac_id, chunks)

    # ─── File storage (Supabase or local fallback) ────────────────

    async def read_file(self, mac_id: str, file_type: str, date: Optional[str] = None) -> str:
        """Read file from Supabase or local fallback."""
        if self._supabase_available:
            return await self._supabase_read(mac_id, file_type, date)
        return await self._local_read(mac_id, file_type, date)

    async def write_file(self, mac_id: str, file_type: str, content: str, date: Optional[str] = None):
        """Write file to Supabase or local fallback."""
        if self._supabase_available:
            await self._supabase_write(mac_id, file_type, content, date)
        else:
            await self._local_write(mac_id, file_type, content, date)

    # ─── Supabase REST file operations ────────────────────────────

    async def _supabase_read(self, mac_id: str, file_type: str, date: Optional[str] = None) -> str:
        """Read from Supabase device_memories table via REST API."""
        normalized = _normalize_mac(mac_id)
        try:
            async with httpx.AsyncClient() as client:
                # Build query params
                params = f"mac_id=eq.{normalized}&file_type=eq.{file_type}&select=content"
                if date:
                    params += f"&file_date=eq.{date}"
                else:
                    params += "&file_date=is.null"

                response = await client.get(
                    f"{self.supabase_url}/rest/v1/device_memories?{params}",
                    headers={
                        "apikey": self.supabase_key,
                        "Authorization": f"Bearer {self.supabase_key}",
                    },
                    timeout=10.0,
                )

                if response.status_code == 200:
                    rows = response.json()
                    if rows:
                        return rows[0].get("content", "")
                return ""

        except Exception as e:
            logger.warning(f"[QDRANT] Supabase read failed: {e}")
            return ""

    async def _supabase_write(self, mac_id: str, file_type: str, content: str, date: Optional[str] = None):
        """Upsert to Supabase device_memories table via REST API."""
        normalized = _normalize_mac(mac_id)
        try:
            async with httpx.AsyncClient() as client:
                body = {
                    "mac_id": normalized,
                    "file_type": file_type,
                    "file_date": date,
                    "content": content,
                    "updated_at": datetime.utcnow().isoformat(),
                }

                response = await client.post(
                    f"{self.supabase_url}/rest/v1/device_memories",
                    headers={
                        "apikey": self.supabase_key,
                        "Authorization": f"Bearer {self.supabase_key}",
                        "Content-Type": "application/json",
                        "Prefer": "resolution=merge-duplicates",
                    },
                    json=body,
                    timeout=10.0,
                )

                if response.status_code not in (200, 201):
                    logger.warning(f"[QDRANT] Supabase write status {response.status_code}: {response.text}")

        except Exception as e:
            logger.warning(f"[QDRANT] Supabase write failed: {e}")

    # ─── Local filesystem fallback ────────────────────────────────

    async def _local_read(self, mac_id: str, file_type: str, date: Optional[str] = None) -> str:
        """Read file from local filesystem (same layout as SqliteBackend)."""
        loop = asyncio.get_event_loop()
        return await loop.run_in_executor(None, self._local_read_sync, mac_id, file_type, date)

    def _local_read_sync(self, mac_id: str, file_type: str, date: Optional[str] = None) -> str:
        normalized = _normalize_mac(mac_id)
        device_dir = self._files_dir / normalized

        if date:
            file_path = device_dir / f"{file_type}_{date}.md"
        else:
            file_path = device_dir / f"{file_type}.md"

        if file_path.exists():
            return file_path.read_text(encoding="utf-8")
        return ""

    async def _local_write(self, mac_id: str, file_type: str, content: str, date: Optional[str] = None):
        """Write file to local filesystem."""
        loop = asyncio.get_event_loop()
        await loop.run_in_executor(None, self._local_write_sync, mac_id, file_type, content, date)

    def _local_write_sync(self, mac_id: str, file_type: str, content: str, date: Optional[str] = None):
        normalized = _normalize_mac(mac_id)
        device_dir = self._files_dir / normalized
        device_dir.mkdir(parents=True, exist_ok=True)

        if date:
            file_path = device_dir / f"{file_type}_{date}.md"
        else:
            file_path = device_dir / f"{file_type}.md"

        file_path.write_text(content, encoding="utf-8")

    async def close(self):
        """Close the Qdrant client."""
        if self._client:
            await self._client.close()
            self._client = None
