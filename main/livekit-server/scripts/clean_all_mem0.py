#!/usr/bin/env python3
"""
Script to clean all memories from Mem0.
WARNING: This will permanently delete ALL memories!
"""

import os
import sys
import httpx
from dotenv import load_dotenv

# Load environment variables
load_dotenv(os.path.join(os.path.dirname(__file__), '..', '.env'))

from mem0 import MemoryClient

# Known device MAC addresses (user IDs) - add your device MACs here
KNOWN_USER_IDS = [
    "68:25:dd:bb:f3:a0",
    "d0:cf:13:13:7a:44",
    # Add more MAC addresses as needed
]

def get_memories_for_user(client, user_id):
    """Get all memories for a specific user"""
    try:
        results = client.get_all(filters={"user_id": user_id})
        if isinstance(results, list):
            return results
        elif isinstance(results, dict) and "results" in results:
            return results["results"]
        return []
    except Exception as e:
        if "400" not in str(e):
            print(f"   ⚠️  Could not fetch memories for {user_id}: {e}")
        return []

def reset_entire_project(api_key):
    """Delete ALL memories in the project using direct API call"""
    print("\n🔥 RESET ENTIRE PROJECT")
    print("=" * 60)
    print("⚠️  WARNING: This will delete ALL memories for ALL users!")
    print("⚠️  This action is IRREVERSIBLE!")
    print("=" * 60)

    confirm = input("\nType 'RESET PROJECT' to confirm: ")
    if confirm != "RESET PROJECT":
        print("❌ Aborted. No memories were deleted.")
        return

    # Use direct API to delete all memories
    # First, we need to get all unique user_ids by paginating
    print("\n🔍 Fetching all memories from project...")

    headers = {
        "Authorization": f"Token {api_key}",
        "Content-Type": "application/json"
    }

    all_user_ids = set()
    page = 1

    # Try to get memories page by page to find all user_ids
    # We'll try common patterns for user_ids
    print("🔍 Scanning for users with memories...")

    client = MemoryClient(api_key=api_key)

    # Check known users
    for user_id in KNOWN_USER_IDS:
        memories = get_memories_for_user(client, user_id)
        if memories:
            all_user_ids.add(user_id)
            print(f"   📦 Found {len(memories)} memories for: {user_id}")

    # Also try to find memories via search with broad query
    try:
        # Search for any memories
        search_results = client.search("", limit=100)
        if isinstance(search_results, dict) and "results" in search_results:
            for mem in search_results["results"]:
                uid = mem.get("user_id")
                if uid:
                    all_user_ids.add(uid)
        elif isinstance(search_results, list):
            for mem in search_results:
                uid = mem.get("user_id")
                if uid:
                    all_user_ids.add(uid)
    except Exception as e:
        print(f"   ⚠️  Search failed: {e}")

    if not all_user_ids:
        print("\n✅ No memories found. Project is already clean.")
        return

    print(f"\n📊 Found memories for {len(all_user_ids)} users:")
    for uid in all_user_ids:
        print(f"   - {uid}")

    print(f"\n🗑️  Deleting all memories...")
    deleted_users = 0

    for user_id in all_user_ids:
        try:
            client.delete_all(user_id=user_id)
            print(f"   ✅ Deleted memories for: {user_id}")
            deleted_users += 1
        except Exception as e:
            print(f"   ❌ Failed for {user_id}: {e}")

    print(f"\n✅ Successfully cleaned memories for {deleted_users} users")

def clean_known_users():
    """Delete all memories from Mem0 for known users"""
    api_key = os.getenv("MEM0_API_KEY")

    if not api_key:
        print("❌ MEM0_API_KEY not found in environment variables")
        sys.exit(1)

    client = MemoryClient(api_key=api_key)

    print("🔍 Scanning for memories across known users...")
    print(f"📋 Checking {len(KNOWN_USER_IDS)} known user IDs\n")

    # Collect all memories across users
    all_users_memories = {}
    total_memories = 0

    for user_id in KNOWN_USER_IDS:
        memories = get_memories_for_user(client, user_id)
        if memories:
            all_users_memories[user_id] = memories
            total_memories += len(memories)
            print(f"   📦 {user_id}: {len(memories)} memories")
            for mem in memories[:3]:  # Show first 3 memories as preview
                memory_text = mem.get("memory", "")[:50]
                print(f"      - {memory_text}...")
            if len(memories) > 3:
                print(f"      ... and {len(memories) - 3} more")
        else:
            print(f"   ✅ {user_id}: No memories")

    if total_memories == 0:
        print("\n✅ No memories found. Database is already clean.")
        return

    print(f"\n📊 Total: {total_memories} memories across {len(all_users_memories)} users")
    print("\n⚠️  WARNING: This will delete ALL these memories!")
    print("⚠️  This action is IRREVERSIBLE!")
    confirm = input("\nType 'DELETE ALL' to confirm: ")

    if confirm != "DELETE ALL":
        print("❌ Aborted. No memories were deleted.")
        sys.exit(0)

    # Delete memories for each user
    print("\n🗑️  Deleting memories...")
    deleted_count = 0

    for user_id, memories in all_users_memories.items():
        try:
            client.delete_all(user_id=user_id)
            deleted_count += len(memories)
            print(f"   ✅ Deleted {len(memories)} memories for user: {user_id}")
        except Exception as e:
            print(f"   ❌ Failed to delete memories for user {user_id}: {e}")

    print(f"\n✅ Successfully deleted {deleted_count} memories from Mem0")

def clean_specific_user():
    """Interactive mode to add a user ID and delete their memories"""
    api_key = os.getenv("MEM0_API_KEY")

    if not api_key:
        print("❌ MEM0_API_KEY not found in environment variables")
        sys.exit(1)

    client = MemoryClient(api_key=api_key)

    user_id = input("Enter user ID (MAC address) to clean: ").strip()
    if not user_id:
        print("❌ No user ID provided")
        sys.exit(1)

    print(f"\n🔍 Fetching memories for: {user_id}")
    memories = get_memories_for_user(client, user_id)

    if not memories:
        print("✅ No memories found for this user.")
        return

    print(f"📊 Found {len(memories)} memories:")
    for mem in memories:
        memory_text = mem.get("memory", "")
        print(f"   - {memory_text}")

    print(f"\n⚠️  WARNING: This will delete ALL {len(memories)} memories for {user_id}!")
    confirm = input("Type 'DELETE' to confirm: ")

    if confirm != "DELETE":
        print("❌ Aborted. No memories were deleted.")
        return

    try:
        client.delete_all(user_id=user_id)
        print(f"✅ Successfully deleted {len(memories)} memories for {user_id}")
    except Exception as e:
        print(f"❌ Failed to delete memories: {e}")

def print_usage():
    print("=" * 60)
    print("Mem0 Memory Cleanup Tool")
    print("=" * 60)
    print("\nUsage:")
    print("  python scripts/clean_all_mem0.py              # Clean known users")
    print("  python scripts/clean_all_mem0.py --user       # Clean specific user")
    print("  python scripts/clean_all_mem0.py --reset-all  # Reset ENTIRE project")
    print("=" * 60)

if __name__ == "__main__":
    api_key = os.getenv("MEM0_API_KEY")

    if len(sys.argv) > 1:
        if sys.argv[1] == "--user":
            clean_specific_user()
        elif sys.argv[1] == "--reset-all":
            if not api_key:
                print("❌ MEM0_API_KEY not found")
                sys.exit(1)
            reset_entire_project(api_key)
        elif sys.argv[1] in ["--help", "-h"]:
            print_usage()
        else:
            print(f"❌ Unknown option: {sys.argv[1]}")
            print_usage()
    else:
        print_usage()
        print()
        clean_known_users()
