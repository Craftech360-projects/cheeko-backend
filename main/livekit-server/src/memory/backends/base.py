"""
Abstract base class for memory storage backends.
"""

from abc import ABC, abstractmethod
from typing import List, Dict, Optional


class MemoryBackend(ABC):
    """Abstract interface for memory storage backends."""

    @abstractmethod
    async def initialize(self, mac_id: str):
        """Initialize storage for a device.

        Args:
            mac_id: Normalized MAC address identifier.
        """

    @abstractmethod
    async def search(self, mac_id: str, query_embedding: List[float], limit: int = 5) -> List[Dict]:
        """Search chunks by vector similarity.

        Args:
            mac_id: Normalized MAC address.
            query_embedding: Query vector.
            limit: Max results to return.

        Returns:
            List of dicts with keys: text, score, file_path, category.
        """

    @abstractmethod
    async def upsert_chunks(self, mac_id: str, chunks: List[Dict]):
        """Insert or update chunks (dedup by content_hash).

        Args:
            mac_id: Normalized MAC address.
            chunks: List of dicts with keys: text, embedding, file_path,
                    start_line, end_line, category, content_hash.
        """

    @abstractmethod
    async def replace_all_chunks(self, mac_id: str, chunks: List[Dict]):
        """Replace all chunks for a device (full reindex).

        Args:
            mac_id: Normalized MAC address.
            chunks: New complete set of chunks.
        """

    @abstractmethod
    async def read_file(self, mac_id: str, file_type: str, date: Optional[str] = None) -> str:
        """Read a stored file (e.g. daily log, profile).

        Args:
            mac_id: Normalized MAC address.
            file_type: Type of file (e.g. 'daily_log', 'profile').
            date: Optional date string for date-specific files (YYYY-MM-DD).

        Returns:
            File content as string, or empty string if not found.
        """

    @abstractmethod
    async def write_file(self, mac_id: str, file_type: str, content: str, date: Optional[str] = None):
        """Write a stored file.

        Args:
            mac_id: Normalized MAC address.
            file_type: Type of file.
            content: File content.
            date: Optional date string for date-specific files.
        """
