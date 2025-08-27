#!/usr/bin/env python3
"""
Test script to verify data in Qdrant ncert_textbooks collection
"""

import os
import sys
import asyncio
import httpx
from typing import List, Dict, Any

# Add the main project to path
sys.path.append(os.path.join(os.path.dirname(__file__), 'main', 'xiaozhi-server'))

from config.logger import setup_logging

logger = setup_logging()

class QdrantTester:
    def __init__(self, qdrant_url: str, api_key: str):
        self.url = qdrant_url.rstrip('/')
        self.api_key = api_key
        self.headers = {
            "api-key": api_key,
            "Content-Type": "application/json"
        }
    
    async def test_collection_info(self, collection_name: str = "ncert_textbooks"):
        """Get collection information and stats"""
        async with httpx.AsyncClient() as client:
            try:
                # Get collection info
                response = await client.get(
                    f"{self.url}/collections/{collection_name}",
                    headers=self.headers,
                    timeout=30.0
                )
                
                if response.status_code == 200:
                    collection_info = response.json()
                    print(f"✅ Collection '{collection_name}' exists")
                    print(f"📊 Collection Info:")
                    print(f"   - Status: {collection_info.get('status', 'unknown')}")
                    
                    if 'result' in collection_info:
                        result = collection_info['result']
                        print(f"   - Points count: {result.get('points_count', 0)}")
                        print(f"   - Vector size: {result.get('config', {}).get('params', {}).get('vectors', {}).get('size', 'unknown')}")
                        print(f"   - Distance: {result.get('config', {}).get('params', {}).get('vectors', {}).get('distance', 'unknown')}")
                        return result.get('points_count', 0)
                    return 0
                elif response.status_code == 404:
                    print(f"❌ Collection '{collection_name}' does not exist")
                    return -1
                else:
                    print(f"❌ Failed to get collection info: {response.status_code}")
                    print(f"Response: {response.text}")
                    return -1
                    
            except Exception as e:
                print(f"❌ Error getting collection info: {e}")
                return -1
    
    async def test_search_points(self, collection_name: str = "ncert_textbooks", limit: int = 5):
        """Search for points in the collection"""
        async with httpx.AsyncClient() as client:
            try:
                # Create a dummy vector for search (1024 dimensions, all zeros)
                dummy_vector = [0.0] * 1024
                
                search_params = {
                    "vector": dummy_vector,
                    "limit": limit,
                    "with_payload": True
                }
                
                response = await client.post(
                    f"{self.url}/collections/{collection_name}/points/search",
                    headers=self.headers,
                    json=search_params,
                    timeout=30.0
                )
                
                if response.status_code == 200:
                    result = response.json()
                    points = result.get('result', [])
                    print(f"🔍 Search Results (found {len(points)} points):")
                    
                    for i, point in enumerate(points):
                        payload = point.get('payload', {})
                        print(f"   Point {i+1}:")
                        print(f"     - ID: {point.get('id')}")
                        print(f"     - Score: {point.get('score', 'N/A'):.4f}")
                        print(f"     - Textbook ID: {payload.get('textbook_id')}")
                        print(f"     - Chunk Index: {payload.get('chunk_index')}")
                        print(f"     - Page: {payload.get('page_number')}")
                        print(f"     - Chapter: {payload.get('chapter_title', 'N/A')}")
                        print(f"     - Content Preview: {payload.get('content', '')[:100]}...")
                        print(f"     - Grade: {payload.get('grade')}")
                        print(f"     - Subject: {payload.get('subject')}")
                        print()
                    
                    return len(points)
                else:
                    print(f"❌ Search failed: {response.status_code}")
                    print(f"Response: {response.text}")
                    return 0
                    
            except Exception as e:
                print(f"❌ Error searching points: {e}")
                return 0
    
    async def test_scroll_points(self, collection_name: str = "ncert_textbooks", limit: int = 10):
        """Scroll through points in the collection"""
        async with httpx.AsyncClient() as client:
            try:
                scroll_params = {
                    "limit": limit,
                    "with_payload": True,
                    "with_vectors": False  # Don't need vectors for verification
                }
                
                response = await client.post(
                    f"{self.url}/collections/{collection_name}/points/scroll",
                    headers=self.headers,
                    json=scroll_params,
                    timeout=30.0
                )
                
                if response.status_code == 200:
                    result = response.json()
                    points = result.get('result', {}).get('points', [])
                    print(f"📜 Scroll Results (found {len(points)} points):")
                    
                    for i, point in enumerate(points):
                        payload = point.get('payload', {})
                        print(f"   Point {i+1}:")
                        print(f"     - ID: {point.get('id')}")
                        print(f"     - Textbook ID: {payload.get('textbook_id')}")
                        print(f"     - Chunk Index: {payload.get('chunk_index')}")
                        print(f"     - Content: {payload.get('content', '')[:150]}...")
                        print()
                    
                    return len(points)
                else:
                    print(f"❌ Scroll failed: {response.status_code}")
                    print(f"Response: {response.text}")
                    return 0
                    
            except Exception as e:
                print(f"❌ Error scrolling points: {e}")
                return 0
    
    async def list_all_collections(self):
        """List all collections in Qdrant"""
        async with httpx.AsyncClient() as client:
            try:
                response = await client.get(
                    f"{self.url}/collections",
                    headers=self.headers,
                    timeout=30.0
                )
                
                if response.status_code == 200:
                    result = response.json()
                    collections = result.get('result', {}).get('collections', [])
                    print(f"📋 All Collections ({len(collections)} found):")
                    
                    for collection in collections:
                        name = collection.get('name')
                        print(f"   - {name}")
                    
                    return [c.get('name') for c in collections]
                else:
                    print(f"❌ Failed to list collections: {response.status_code}")
                    return []
                    
            except Exception as e:
                print(f"❌ Error listing collections: {e}")
                return []

async def main():
    """Main test function"""
    print("Qdrant Collection Test")
    print("=" * 50)
    
    # Get credentials from environment or config
    qdrant_url = os.getenv('QDRANT_URL')
    qdrant_api_key = os.getenv('QDRANT_API_KEY')
    
    if not qdrant_url or not qdrant_api_key:
        print("❌ Missing QDRANT_URL or QDRANT_API_KEY environment variables")
        print("💡 Make sure to set these in your environment or .env file")
        return
    
    print(f"🔗 Connecting to Qdrant: {qdrant_url}")
    
    tester = QdrantTester(qdrant_url, qdrant_api_key)
    
    # Test 1: List all collections
    print("\n1️⃣ Testing: List all collections")
    collections = await tester.list_all_collections()
    
    # Test 2: Check ncert_textbooks collection
    print("\n2️⃣ Testing: Collection info for 'ncert_textbooks'")
    points_count = await tester.test_collection_info("ncert_textbooks")
    
    if points_count > 0:
        # Test 3: Search points
        print("\n3️⃣ Testing: Search points")
        search_results = await tester.test_search_points("ncert_textbooks", limit=3)
        
        # Test 4: Scroll points
        print("\n4️⃣ Testing: Scroll points")
        scroll_results = await tester.test_scroll_points("ncert_textbooks", limit=5)
        
        print("\n" + "=" * 50)
        print("📊 Summary:")
        print(f"   - Collections found: {len(collections)}")
        print(f"   - Points in ncert_textbooks: {points_count}")
        print(f"   - Search results: {search_results}")
        print(f"   - Scroll results: {scroll_results}")
        
        if points_count > 0 and (search_results > 0 or scroll_results > 0):
            print("✅ Data verification: SUCCESS - Collection has data!")
        else:
            print("⚠️  Data verification: WARNING - Collection exists but data access issues")
    else:
        print("\n❌ No points found in ncert_textbooks collection")
        print("💡 Check if the upload process completed successfully")

if __name__ == "__main__":
    asyncio.run(main())