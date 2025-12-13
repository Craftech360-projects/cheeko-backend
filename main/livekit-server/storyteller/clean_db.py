"""
Clean/Reset Story Databases
Removes SQLite database and ChromaDB vector store for fresh upload.

Usage:
    python clean_db.py
"""

import os
import shutil
from pathlib import Path

ROOT_DIR = Path(__file__).parent
DB_PATH = ROOT_DIR / "stories.db"
CHROMA_PATH = ROOT_DIR / "chroma_db"


def clean_databases():
    print("\n" + "=" * 50)
    print("STORY DATABASE CLEANUP")
    print("=" * 50 + "\n")

    # Clean SQLite database
    if DB_PATH.exists():
        try:
            os.remove(DB_PATH)
            print(f"✅ Deleted SQLite database: {DB_PATH}")
        except Exception as e:
            print(f"❌ Failed to delete SQLite: {e}")
    else:
        print(f"ℹ️  SQLite database not found: {DB_PATH}")

    # Clean ChromaDB vector store
    if CHROMA_PATH.exists():
        try:
            shutil.rmtree(CHROMA_PATH)
            print(f"✅ Deleted ChromaDB folder: {CHROMA_PATH}")
        except Exception as e:
            print(f"❌ Failed to delete ChromaDB: {e}")
    else:
        print(f"ℹ️  ChromaDB folder not found: {CHROMA_PATH}")

    print("\n" + "=" * 50)
    print("CLEANUP COMPLETE!")
    print("=" * 50)
    print("\nNow run: python upload_to_db.py")
    print("=" * 50 + "\n")


if __name__ == "__main__":
    # Confirm before deleting
    print("\n⚠️  WARNING: This will DELETE all story data!")
    print(f"   - SQLite: {DB_PATH}")
    print(f"   - ChromaDB: {CHROMA_PATH}")

    response = input("\nAre you sure? (yes/no): ").strip().lower()

    if response == "yes":
        clean_databases()
    else:
        print("\n❌ Cancelled. No files deleted.\n")
