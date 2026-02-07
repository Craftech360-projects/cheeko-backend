"""
SQLite-based memory backend.
Each device gets its own SQLite database file.
Uses FTS5 for keyword search and numpy for vector cosine similarity.
"""

import asyncio
import hashlib
import logging
import sqlite3
import struct
from pathlib import Path
from typing import Dict, List, Optional

logger = logging.getLogger("memory.sqlite_backend")

try:
    import numpy as np
    NUMPY_AVAILABLE = True
except ImportError:
    NUMPY_AVAILABLE = False
    logger.warning("[SQLITE] numpy not available, vector search disabled")

from .base import MemoryBackend


def _normalize_mac(mac: str) -> str:
    return mac.replace(":", "").replace("-", "").lower()


def _embedding_to_bytes(embedding: List[float]) -> bytes:
    """Pack a float list into compact bytes."""
    return struct.pack(f"{len(embedding)}f", *embedding)


def _bytes_to_embedding(data: bytes) -> List[float]:
    """Unpack bytes back to float list."""
    count = len(data) // 4
    return list(struct.unpack(f"{count}f", data))


def _cosine_similarity(a: List[float], b: List[float]) -> float:
    """Compute cosine similarity between two vectors."""
    if not NUMPY_AVAILABLE:
        # Fallback: dot product / (norm_a * norm_b)
        dot = sum(x * y for x, y in zip(a, b))
        norm_a = sum(x * x for x in a) ** 0.5
        norm_b = sum(x * x for x in b) ** 0.5
        if norm_a == 0 or norm_b == 0:
            return 0.0
        return dot / (norm_a * norm_b)

    va = np.array(a, dtype=np.float32)
    vb = np.array(b, dtype=np.float32)
    norm_a = np.linalg.norm(va)
    norm_b = np.linalg.norm(vb)
    if norm_a == 0 or norm_b == 0:
        return 0.0
    return float(np.dot(va, vb) / (norm_a * norm_b))


class SqliteBackend(MemoryBackend):
    """Per-device SQLite memory backend with FTS5 and vector search."""

    def __init__(self, base_path: str):
        self.base_path = Path(base_path)
        self.db_dir = self.base_path / "db"
        self.files_dir = self.base_path / "files"
        self._connections: Dict[str, sqlite3.Connection] = {}

    def _get_db_path(self, mac_id: str) -> Path:
        normalized = _normalize_mac(mac_id)
        return self.db_dir / f"{normalized}.sqlite"

    def _get_conn(self, mac_id: str) -> sqlite3.Connection:
        normalized = _normalize_mac(mac_id)
        if normalized not in self._connections:
            db_path = self._get_db_path(mac_id)
            conn = sqlite3.connect(str(db_path), check_same_thread=False)
            conn.row_factory = sqlite3.Row
            conn.execute("PRAGMA journal_mode=WAL")
            self._connections[normalized] = conn
        return self._connections[normalized]

    async def initialize(self, mac_id: str):
        """Create DB directory, tables, and FTS index for a device."""
        loop = asyncio.get_event_loop()
        await loop.run_in_executor(None, self._initialize_sync, mac_id)

    def _initialize_sync(self, mac_id: str):
        self.db_dir.mkdir(parents=True, exist_ok=True)
        self.files_dir.mkdir(parents=True, exist_ok=True)

        conn = self._get_conn(mac_id)
        conn.executescript("""
            CREATE TABLE IF NOT EXISTS chunks (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                text TEXT NOT NULL,
                file_path TEXT,
                start_line INTEGER,
                end_line INTEGER,
                embedding BLOB,
                category TEXT DEFAULT 'general',
                timestamp TEXT,
                content_hash TEXT UNIQUE
            );

            CREATE INDEX IF NOT EXISTS idx_chunks_category ON chunks(category);
            CREATE INDEX IF NOT EXISTS idx_chunks_hash ON chunks(content_hash);
        """)

        # FTS5 virtual table for keyword search
        # Check if it exists first
        row = conn.execute(
            "SELECT name FROM sqlite_master WHERE type='table' AND name='chunks_fts'"
        ).fetchone()
        if not row:
            conn.execute(
                "CREATE VIRTUAL TABLE chunks_fts USING fts5(text, content=chunks, content_rowid=id)"
            )

        conn.commit()
        logger.info(f"[SQLITE] Initialized DB for {_normalize_mac(mac_id)}")

    async def search(self, mac_id: str, query_embedding: List[float], limit: int = 5) -> List[Dict]:
        """Vector similarity search across all chunks for a device."""
        loop = asyncio.get_event_loop()
        return await loop.run_in_executor(
            None, self._search_sync, mac_id, query_embedding, limit
        )

    def _search_sync(self, mac_id: str, query_embedding: List[float], limit: int) -> List[Dict]:
        conn = self._get_conn(mac_id)
        rows = conn.execute(
            "SELECT id, text, file_path, category, embedding FROM chunks WHERE embedding IS NOT NULL"
        ).fetchall()

        results = []
        for row in rows:
            if row["embedding"] is None:
                continue
            stored_embedding = _bytes_to_embedding(row["embedding"])
            score = _cosine_similarity(query_embedding, stored_embedding)
            results.append({
                "id": row["id"],
                "text": row["text"],
                "file_path": row["file_path"],
                "category": row["category"],
                "score": score,
            })

        results.sort(key=lambda r: r["score"], reverse=True)
        return results[:limit]

    async def fts_search(self, mac_id: str, query: str, limit: int = 5) -> List[Dict]:
        """Full-text search using FTS5."""
        loop = asyncio.get_event_loop()
        return await loop.run_in_executor(
            None, self._fts_search_sync, mac_id, query, limit
        )

    def _fts_search_sync(self, mac_id: str, query: str, limit: int) -> List[Dict]:
        conn = self._get_conn(mac_id)
        try:
            # Escape special FTS5 characters
            safe_query = query.replace('"', '""')
            rows = conn.execute(
                """
                SELECT c.id, c.text, c.file_path, c.category, rank
                FROM chunks_fts fts
                JOIN chunks c ON c.id = fts.rowid
                WHERE chunks_fts MATCH ?
                ORDER BY rank
                LIMIT ?
                """,
                (f'"{safe_query}"', limit),
            ).fetchall()

            return [
                {
                    "id": row["id"],
                    "text": row["text"],
                    "file_path": row["file_path"],
                    "category": row["category"],
                    "score": -row["rank"],  # FTS5 rank is negative (lower = better)
                }
                for row in rows
            ]
        except Exception as e:
            logger.warning(f"[SQLITE] FTS search failed: {e}")
            return []

    async def upsert_chunks(self, mac_id: str, chunks: List[Dict]):
        """Insert or update chunks, deduplicating by content_hash."""
        loop = asyncio.get_event_loop()
        await loop.run_in_executor(None, self._upsert_chunks_sync, mac_id, chunks)

    def _upsert_chunks_sync(self, mac_id: str, chunks: List[Dict]):
        conn = self._get_conn(mac_id)
        inserted = 0
        for chunk in chunks:
            content_hash = chunk.get("content_hash") or hashlib.md5(
                chunk["text"].encode()
            ).hexdigest()

            embedding_bytes = None
            if chunk.get("embedding"):
                embedding_bytes = _embedding_to_bytes(chunk["embedding"])

            try:
                conn.execute(
                    """
                    INSERT INTO chunks (text, file_path, start_line, end_line, embedding, category, timestamp, content_hash)
                    VALUES (?, ?, ?, ?, ?, ?, datetime('now'), ?)
                    ON CONFLICT(content_hash) DO UPDATE SET
                        embedding = excluded.embedding,
                        timestamp = excluded.timestamp
                    """,
                    (
                        chunk["text"],
                        chunk.get("file_path"),
                        chunk.get("start_line"),
                        chunk.get("end_line"),
                        embedding_bytes,
                        chunk.get("category", "general"),
                        content_hash,
                    ),
                )
                inserted += 1
            except Exception as e:
                logger.warning(f"[SQLITE] Failed to upsert chunk: {e}")

        conn.commit()

        # Rebuild FTS index
        try:
            conn.execute("INSERT INTO chunks_fts(chunks_fts) VALUES('rebuild')")
            conn.commit()
        except Exception as e:
            logger.warning(f"[SQLITE] FTS rebuild failed: {e}")

        logger.info(f"[SQLITE] Upserted {inserted} chunks for {_normalize_mac(mac_id)}")

    async def replace_all_chunks(self, mac_id: str, chunks: List[Dict]):
        """Drop all chunks and insert new ones (full reindex)."""
        loop = asyncio.get_event_loop()
        await loop.run_in_executor(None, self._replace_all_sync, mac_id, chunks)

    def _replace_all_sync(self, mac_id: str, chunks: List[Dict]):
        conn = self._get_conn(mac_id)
        conn.execute("DELETE FROM chunks")
        conn.commit()
        self._upsert_chunks_sync(mac_id, chunks)

    async def read_file(self, mac_id: str, file_type: str, date: Optional[str] = None) -> str:
        """Read a stored file from the filesystem."""
        loop = asyncio.get_event_loop()
        return await loop.run_in_executor(
            None, self._read_file_sync, mac_id, file_type, date
        )

    def _read_file_sync(self, mac_id: str, file_type: str, date: Optional[str] = None) -> str:
        normalized = _normalize_mac(mac_id)
        device_dir = self.files_dir / normalized

        if date:
            file_path = device_dir / f"{file_type}_{date}.md"
        else:
            file_path = device_dir / f"{file_type}.md"

        if file_path.exists():
            return file_path.read_text(encoding="utf-8")
        return ""

    async def write_file(self, mac_id: str, file_type: str, content: str, date: Optional[str] = None):
        """Write a file to the filesystem."""
        loop = asyncio.get_event_loop()
        await loop.run_in_executor(
            None, self._write_file_sync, mac_id, file_type, content, date
        )

    def _write_file_sync(self, mac_id: str, file_type: str, content: str, date: Optional[str] = None):
        normalized = _normalize_mac(mac_id)
        device_dir = self.files_dir / normalized
        device_dir.mkdir(parents=True, exist_ok=True)

        if date:
            file_path = device_dir / f"{file_type}_{date}.md"
        else:
            file_path = device_dir / f"{file_type}.md"

        file_path.write_text(content, encoding="utf-8")

    def close(self):
        """Close all database connections."""
        for mac, conn in self._connections.items():
            try:
                conn.close()
            except Exception:
                pass
        self._connections.clear()
