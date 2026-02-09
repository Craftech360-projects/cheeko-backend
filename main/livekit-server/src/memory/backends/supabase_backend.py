"""
Supabase PostgreSQL memory backend.

Uses pgvector for vector similarity search and PostgreSQL FTS for keyword search.
All data stored in Supabase PostgreSQL — no local files or extra services needed.
Ideal for serverless deployments (Cerebrium) where local storage is ephemeral.
"""

import hashlib
import logging
import os
from datetime import datetime
from typing import Dict, List, Optional

from .base import MemoryBackend

logger = logging.getLogger("memory.supabase_backend")

try:
    import httpx
    HTTPX_AVAILABLE = True
except ImportError:
    HTTPX_AVAILABLE = False
    logger.warning("[SUPABASE] httpx not available")


def _normalize_mac(mac: str) -> str:
    return mac.replace(":", "").replace("-", "").lower()


class SupabaseBackend(MemoryBackend):
    """Supabase PostgreSQL memory backend using pgvector + FTS.

    Vectors stored in `memory_chunks` table with pgvector HNSW index.
    Keyword search via PostgreSQL tsvector + GIN index.
    Files stored in `device_memories` table.
    """

    def __init__(self, config: dict):
        if not HTTPX_AVAILABLE:
            raise ImportError("httpx package is required for SupabaseBackend")

        self.url = config.get("url") or os.getenv("SUPABASE_URL", "")
        self.key = config.get("service_role_key") or os.getenv("SUPABASE_SERVICE_ROLE_KEY", "")

        if not self.url or not self.key:
            raise ValueError("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required for SupabaseBackend")

        self._client: Optional[httpx.AsyncClient] = None

        logger.info(f"[SUPABASE] Backend created (url={self.url[:40]}...)")

    def _headers(self) -> dict:
        return {
            "apikey": self.key,
            "Authorization": f"Bearer {self.key}",
            "Content-Type": "application/json",
        }

    async def _get_client(self) -> httpx.AsyncClient:
        if self._client is None or self._client.is_closed:
            self._client = httpx.AsyncClient(timeout=15.0)
        return self._client

    # --- MemoryBackend interface ---

    async def initialize(self, mac_id: str):
        """No-op — tables created by SQL migration."""
        pass

    async def search(self, mac_id: str, query_embedding: List[float], limit: int = 5) -> List[Dict]:
        """Vector similarity search via match_memory_chunks RPC."""
        normalized = _normalize_mac(mac_id)
        try:
            client = await self._get_client()
            response = await client.post(
                f"{self.url}/rest/v1/rpc/match_memory_chunks",
                headers=self._headers(),
                json={
                    "query_mac_id": normalized,
                    "query_embedding": query_embedding,
                    "match_count": limit,
                },
            )

            if response.status_code == 200:
                rows = response.json()
                return [
                    {
                        "id": row["id"],
                        "text": row["text"],
                        "file_path": row.get("file_path", ""),
                        "category": row.get("category", "general"),
                        "score": row.get("similarity", 0.0),
                    }
                    for row in rows
                ]
            else:
                logger.error(f"[SUPABASE] Vector search failed ({response.status_code}): {response.text}")
                return []

        except Exception as e:
            logger.error(f"[SUPABASE] Vector search error: {e}")
            return []

    async def fts_search(self, mac_id: str, query: str, limit: int = 5) -> List[Dict]:
        """Full-text search via fts_memory_chunks RPC."""
        normalized = _normalize_mac(mac_id)
        if not query.strip():
            return []

        try:
            client = await self._get_client()
            response = await client.post(
                f"{self.url}/rest/v1/rpc/fts_memory_chunks",
                headers=self._headers(),
                json={
                    "query_mac_id": normalized,
                    "search_query": query,
                    "match_count": limit,
                },
            )

            if response.status_code == 200:
                rows = response.json()
                return [
                    {
                        "id": row["id"],
                        "text": row["text"],
                        "file_path": row.get("file_path", ""),
                        "category": row.get("category", "general"),
                        "score": row.get("rank", 0.0),
                    }
                    for row in rows
                ]
            else:
                logger.error(f"[SUPABASE] FTS search failed ({response.status_code}): {response.text}")
                return []

        except Exception as e:
            logger.error(f"[SUPABASE] FTS search error: {e}")
            return []

    async def upsert_chunks(self, mac_id: str, chunks: List[Dict]):
        """Upsert chunks via REST with merge-duplicates."""
        if not chunks:
            return

        normalized = _normalize_mac(mac_id)
        rows = []
        for chunk in chunks:
            content_hash = chunk.get("content_hash") or hashlib.md5(
                chunk["text"].encode()
            ).hexdigest()

            row = {
                "mac_id": normalized,
                "text": chunk["text"],
                "file_path": chunk.get("file_path", ""),
                "start_line": chunk.get("start_line", 0),
                "end_line": chunk.get("end_line", 0),
                "category": chunk.get("category", "general"),
                "content_hash": content_hash,
                "created_at": datetime.utcnow().isoformat(),
            }

            embedding = chunk.get("embedding")
            if embedding:
                # pgvector expects a JSON array string like "[0.1, 0.2, ...]"
                row["embedding"] = embedding

            rows.append(row)

        try:
            client = await self._get_client()
            headers = self._headers()
            headers["Prefer"] = "resolution=merge-duplicates"

            response = await client.post(
                f"{self.url}/rest/v1/memory_chunks?on_conflict=mac_id,content_hash",
                headers=headers,
                json=rows,
            )

            if response.status_code not in (200, 201):
                logger.error(f"[SUPABASE] Upsert failed ({response.status_code}): {response.text}")
            else:
                logger.info(f"[SUPABASE] Upserted {len(rows)} chunks for {normalized}")

        except Exception as e:
            logger.error(f"[SUPABASE] Upsert error: {e}")

    async def replace_all_chunks(self, mac_id: str, chunks: List[Dict]):
        """Delete all chunks for device, then upsert new ones."""
        normalized = _normalize_mac(mac_id)

        try:
            client = await self._get_client()
            response = await client.delete(
                f"{self.url}/rest/v1/memory_chunks?mac_id=eq.{normalized}",
                headers=self._headers(),
            )

            if response.status_code not in (200, 204):
                logger.error(f"[SUPABASE] Delete failed ({response.status_code}): {response.text}")
            else:
                logger.info(f"[SUPABASE] Deleted all chunks for {normalized}")

        except Exception as e:
            logger.error(f"[SUPABASE] Delete error: {e}")

        await self.upsert_chunks(mac_id, chunks)

    async def read_file(self, mac_id: str, file_type: str, date: Optional[str] = None) -> str:
        """Read from device_memories table."""
        normalized = _normalize_mac(mac_id)
        try:
            client = await self._get_client()

            params = f"mac_id=eq.{normalized}&file_type=eq.{file_type}&select=content"
            if date:
                params += f"&file_date=eq.{date}"
            else:
                params += "&file_date=is.null"

            response = await client.get(
                f"{self.url}/rest/v1/device_memories?{params}",
                headers=self._headers(),
            )

            if response.status_code == 200:
                rows = response.json()
                if rows:
                    return rows[0].get("content", "")
            return ""

        except Exception as e:
            logger.error(f"[SUPABASE] Read file error: {e}")
            return ""

    async def write_file(self, mac_id: str, file_type: str, content: str, date: Optional[str] = None):
        """Upsert to device_memories table.

        Uses PATCH-then-POST to handle nullable file_date in unique constraint,
        since PostgREST merge-duplicates doesn't work with nullable columns.
        """
        normalized = _normalize_mac(mac_id)
        try:
            client = await self._get_client()
            headers = self._headers()
            update_body = {
                "content": content,
                "updated_at": datetime.utcnow().isoformat(),
            }

            # Build filter for the existing row
            filter_params = f"mac_id=eq.{normalized}&file_type=eq.{file_type}"
            if date:
                filter_params += f"&file_date=eq.{date}"
            else:
                filter_params += "&file_date=is.null"

            # Try to update existing row — return the updated rows to check if any matched
            patch_headers = {**headers, "Prefer": "return=representation"}
            response = await client.patch(
                f"{self.url}/rest/v1/device_memories?{filter_params}",
                headers=patch_headers,
                json=update_body,
            )

            updated_rows = response.json() if response.status_code == 200 else []
            rows_matched = len(updated_rows) if isinstance(updated_rows, list) else 0

            if rows_matched == 0:
                # No existing row — insert new one
                insert_body = {
                    "mac_id": normalized,
                    "file_type": file_type,
                    "file_date": date,
                    "content": content,
                    "updated_at": datetime.utcnow().isoformat(),
                }
                response = await client.post(
                    f"{self.url}/rest/v1/device_memories",
                    headers=headers,
                    json=insert_body,
                )
                if response.status_code not in (200, 201):
                    logger.error(f"[SUPABASE] Write file insert failed ({response.status_code}): {response.text}")

        except Exception as e:
            logger.error(f"[SUPABASE] Write file error: {e}")

    async def close(self):
        """Close the httpx client."""
        if self._client and not self._client.is_closed:
            await self._client.aclose()
            self._client = None
