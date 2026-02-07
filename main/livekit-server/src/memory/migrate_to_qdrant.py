"""
Migration script: SQLite backend → Qdrant backend.

Reads all device data from the local SQLite+filesystem backend
and imports chunks into Qdrant and files into Supabase (or local fallback).

Usage:
    cd main/livekit-server
    python -m src.memory.migrate_to_qdrant [--dry-run]
"""

import asyncio
import argparse
import logging
import struct
import sqlite3
from pathlib import Path

from src.config.config_loader import ConfigLoader

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")
logger = logging.getLogger("memory.migrate")


def _bytes_to_embedding(data: bytes) -> list:
    count = len(data) // 4
    return list(struct.unpack(f"{count}f", data))


def _normalize_mac(mac: str) -> str:
    return mac.replace(":", "").replace("-", "").lower()


async def migrate(dry_run: bool = False):
    """Migrate all devices from SQLite to Qdrant backend."""
    config = ConfigLoader.get_memory_config()
    base_path = Path(config.get("base_path", "./memory"))
    db_dir = base_path / "db"
    files_dir = base_path / "files"

    if not db_dir.exists():
        logger.error(f"No SQLite databases found at {db_dir}")
        return

    # Discover all device databases
    db_files = list(db_dir.glob("*.sqlite"))
    logger.info(f"Found {len(db_files)} device databases in {db_dir}")

    if not db_files:
        logger.info("Nothing to migrate")
        return

    # Initialize Qdrant backend
    qdrant_config = config.get("qdrant", {})
    if not qdrant_config.get("url") and not __import__("os").getenv("QDRANT_URL"):
        logger.error("No Qdrant URL configured. Set qdrant.url in config.yaml or QDRANT_URL env var.")
        return

    from src.memory.backends.qdrant_backend import QdrantBackend
    qdrant = QdrantBackend(qdrant_config)

    total_chunks = 0
    total_files = 0

    for db_file in db_files:
        mac_normalized = db_file.stem  # e.g., "6825ddbbf3a0"
        logger.info(f"\n--- Migrating device: {mac_normalized} ---")

        # Initialize Qdrant for this device
        await qdrant.initialize(mac_normalized)

        # Read all chunks from SQLite
        conn = sqlite3.connect(str(db_file))
        conn.row_factory = sqlite3.Row
        rows = conn.execute(
            "SELECT text, file_path, start_line, end_line, embedding, category, timestamp, content_hash FROM chunks"
        ).fetchall()
        conn.close()

        chunks = []
        for row in rows:
            embedding = None
            if row["embedding"]:
                embedding = _bytes_to_embedding(row["embedding"])

            chunks.append({
                "text": row["text"],
                "file_path": row["file_path"] or "",
                "start_line": row["start_line"] or 0,
                "end_line": row["end_line"] or 0,
                "embedding": embedding,
                "category": row["category"] or "general",
                "timestamp": row["timestamp"],
                "content_hash": row["content_hash"],
            })

        logger.info(f"  Chunks: {len(chunks)} ({len([c for c in chunks if c['embedding']])} with embeddings)")

        if not dry_run and chunks:
            # Only migrate chunks that have embeddings
            valid_chunks = [c for c in chunks if c["embedding"]]
            if valid_chunks:
                await qdrant.upsert_chunks(mac_normalized, valid_chunks)
                total_chunks += len(valid_chunks)

        # Migrate files from local filesystem
        device_files_dir = files_dir / mac_normalized
        if device_files_dir.exists():
            md_files = list(device_files_dir.glob("*.md"))
            logger.info(f"  Files: {len(md_files)}")

            for md_file in md_files:
                content = md_file.read_text(encoding="utf-8")
                filename = md_file.stem  # e.g., "profile" or "daily_log_2025-02-06"

                # Parse file_type and date from filename
                if filename.startswith("daily_log_"):
                    file_type = "daily_log"
                    file_date = filename.replace("daily_log_", "")
                else:
                    file_type = filename
                    file_date = None

                logger.info(f"    {filename}.md ({len(content)} chars) → type={file_type}, date={file_date}")

                if not dry_run:
                    await qdrant.write_file(mac_normalized, file_type, content, date=file_date)
                    total_files += 1

    logger.info(f"\n{'[DRY RUN] ' if dry_run else ''}Migration complete:")
    logger.info(f"  Devices: {len(db_files)}")
    logger.info(f"  Chunks migrated: {total_chunks}")
    logger.info(f"  Files migrated: {total_files}")

    await qdrant.close()


def main():
    parser = argparse.ArgumentParser(description="Migrate Cheeko memory from SQLite to Qdrant")
    parser.add_argument("--dry-run", action="store_true", help="Preview without writing")
    args = parser.parse_args()

    asyncio.run(migrate(dry_run=args.dry_run))


if __name__ == "__main__":
    main()
