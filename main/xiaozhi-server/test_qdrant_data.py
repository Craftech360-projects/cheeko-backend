#!/usr/bin/env python3
"""
Test script to verify textbook data is properly stored in Qdrant vector database.

This script checks:
1. Qdrant connection and authentication
2. Collection existence and structure
3. Vector embeddings and metadata
4. Search functionality
"""

import asyncio
import os
import sys
from typing import List, Dict, Any
import httpx
import json
from datetime import datetime
from dotenv import load_dotenv

# Add the main directory to Python path
sys.path.append(os.path.dirname(os.path.abspath(__file__)))

# Load environment variables
load_dotenv()

from config.logger import setup_logging

logger = setup_logging()
TAG = __name__

class QdrantDataTester:
    """Test class for verifying Qdrant data storage."""
    
    def __init__(self):
        """Initialize the tester with Qdrant configuration."""
        # Get only Qdrant-specific configuration
        self.qdrant_url = os.getenv("QDRANT_URL")
        self.qdrant_api_key = os.getenv("QDRANT_API_KEY")
        
        if not self.qdrant_url or not self.qdrant_api_key:
            raise ValueError("Missing QDRANT_URL or QDRANT_API_KEY in .env file")
        
        self.headers = {
            "Content-Type": "application/json",
            "api-key": self.qdrant_api_key
        }
        
        logger.info(f"Initialized Qdrant tester for: {self.qdrant_url}")
    
    async def test_connection(self) -> bool:
        """Test basic connection to Qdrant."""
        try:
            async with httpx.AsyncClient() as client:
                response = await client.get(
                    f"{self.qdrant_url}/",
                    headers=self.headers,
                    timeout=10.0
                )
                
                if response.status_code == 200:
                    logger.info("✅ Qdrant connection successful")
                    return True
                else:
                    logger.error(f"❌ Qdrant connection failed: {response.status_code}")
                    return False
                    
        except Exception as e:
            logger.error(f"❌ Qdrant connection error: {e}")
            return False
    
    async def list_collections(self) -> List[str]:
        """List all collections in Qdrant."""
        try:
            async with httpx.AsyncClient() as client:
                response = await client.get(
                    f"{self.qdrant_url}/collections",
                    headers=self.headers,
                    timeout=10.0
                )
                
                if response.status_code == 200:
                    data = response.json()
                    collections = [col["name"] for col in data.get("result", {}).get("collections", [])]
                    logger.info(f"📚 Found {len(collections)} collections: {collections}")
                    return collections
                else:
                    logger.error(f"❌ Failed to list collections: {response.status_code}")
                    return []
                    
        except Exception as e:
            logger.error(f"❌ Error listing collections: {e}")
            return []
    
    async def get_collection_info(self, collection_name: str) -> Dict[str, Any]:
        """Get detailed information about a specific collection."""
        try:
            async with httpx.AsyncClient() as client:
                response = await client.get(
                    f"{self.qdrant_url}/collections/{collection_name}",
                    headers=self.headers,
                    timeout=10.0
                )
                
                if response.status_code == 200:
                    data = response.json()
                    result = data.get("result", {})
                    
                    logger.info(f"📊 Collection '{collection_name}' info:")
                    logger.info(f"  - Status: {result.get('status', 'unknown')}")
                    logger.info(f"  - Vectors count: {result.get('vectors_count', 0):,}")
                    logger.info(f"  - Indexed vectors: {result.get('indexed_vectors_count', 0):,}")
                    logger.info(f"  - Points count: {result.get('points_count', 0):,}")
                    
                    config = result.get("config", {})
                    params = config.get("params", {})
                    vector_config = params.get("vectors", {})
                    
                    if isinstance(vector_config, dict) and "size" in vector_config:
                        logger.info(f"  - Vector size: {vector_config['size']}")
                        logger.info(f"  - Distance metric: {vector_config.get('distance', 'unknown')}")
                    
                    return result
                else:
                    logger.error(f"❌ Failed to get collection info: {response.status_code}")
                    return {}
                    
        except Exception as e:
            logger.error(f"❌ Error getting collection info: {e}")
            return {}
    
    async def sample_vectors(self, collection_name: str, limit: int = 3) -> List[Dict[str, Any]]:
        """Sample some vectors from the collection to verify data structure."""
        try:
            async with httpx.AsyncClient() as client:
                # Scroll through points to get samples
                payload = {
                    "limit": limit,
                    "with_payload": True,
                    "with_vector": False  # Don't fetch full vectors to save bandwidth
                }
                
                response = await client.post(
                    f"{self.qdrant_url}/collections/{collection_name}/points/scroll",
                    headers=self.headers,
                    json=payload,
                    timeout=10.0
                )
                
                if response.status_code == 200:
                    data = response.json()
                    points = data.get("result", {}).get("points", [])
                    
                    logger.info(f"📝 Sample points from '{collection_name}':")
                    for i, point in enumerate(points, 1):
                        logger.info(f"  Point {i}:")
                        logger.info(f"    - ID: {point.get('id', 'unknown')}")
                        
                        payload = point.get("payload", {})
                        logger.info(f"    - Content preview: {str(payload.get('content', 'N/A'))[:100]}...")
                        logger.info(f"    - Textbook ID: {payload.get('textbook_id', 'N/A')}")
                        logger.info(f"    - Chunk index: {payload.get('chunk_index', 'N/A')}")
                        logger.info(f"    - Page number: {payload.get('page_number', 'N/A')}")
                        logger.info(f"    - Grade: {payload.get('grade', 'N/A')}")
                        logger.info(f"    - Subject: {payload.get('subject', 'N/A')}")
                        logger.info("")
                    
                    return points
                else:
                    logger.error(f"❌ Failed to sample vectors: {response.status_code}")
                    return []
                    
        except Exception as e:
            logger.error(f"❌ Error sampling vectors: {e}")
            return []
    
    async def test_search(self, collection_name: str, query_text: str = "patterns", limit: int = 3) -> List[Dict[str, Any]]:
        """Test search functionality with a sample query."""
        try:
            # For this test, we'll use a dummy vector since we don't have the embedding service initialized
            # In a real test, you'd generate embeddings for the query_text
            dummy_vector = [0.1] * 1024  # Assuming 1024-dimensional vectors (adjust based on your model)
            
            async with httpx.AsyncClient() as client:
                payload = {
                    "vector": dummy_vector,
                    "limit": limit,
                    "with_payload": True,
                    "with_vector": False
                }
                
                response = await client.post(
                    f"{self.qdrant_url}/collections/{collection_name}/points/search",
                    headers=self.headers,
                    json=payload,
                    timeout=10.0
                )
                
                if response.status_code == 200:
                    data = response.json()
                    results = data.get("result", [])
                    
                    logger.info(f"🔍 Search test results for '{query_text}' in '{collection_name}':")
                    logger.info(f"  Found {len(results)} results")
                    
                    for i, result in enumerate(results, 1):
                        score = result.get("score", 0)
                        payload = result.get("payload", {})
                        logger.info(f"  Result {i} (score: {score:.4f}):")
                        logger.info(f"    - Content: {str(payload.get('content', 'N/A'))[:100]}...")
                        logger.info(f"    - Textbook ID: {payload.get('textbook_id', 'N/A')}")
                    
                    return results
                else:
                    logger.error(f"❌ Search test failed: {response.status_code}")
                    logger.error(f"Response: {response.text}")
                    return []
                    
        except Exception as e:
            logger.error(f"❌ Error testing search: {e}")
            return []
    
    async def run_comprehensive_test(self) -> Dict[str, Any]:
        """Run comprehensive tests and return results summary."""
        logger.info("🚀 Starting comprehensive Qdrant data verification test")
        logger.info("=" * 60)
        
        results = {
            "timestamp": datetime.now().isoformat(),
            "connection_test": False,
            "collections_found": [],
            "collection_details": {},
            "sample_data": {},
            "search_test": {},
            "overall_status": "FAILED"
        }
        
        # Test 1: Connection
        logger.info("1️⃣  Testing Qdrant connection...")
        results["connection_test"] = await self.test_connection()
        
        if not results["connection_test"]:
            logger.error("❌ Connection test failed - aborting further tests")
            return results
        
        # Test 2: List Collections
        logger.info("\n2️⃣  Listing collections...")
        collections = await self.list_collections()
        results["collections_found"] = collections
        
        if not collections:
            logger.warning("⚠️  No collections found - this might be expected if no textbooks were processed yet")
        
        # Test 3: Collection Details
        logger.info("\n3️⃣  Getting collection details...")
        for collection in collections:
            logger.info(f"\n📋 Analyzing collection: {collection}")
            collection_info = await self.get_collection_info(collection)
            results["collection_details"][collection] = collection_info
            
            # Test 4: Sample Data
            logger.info(f"\n4️⃣  Sampling data from '{collection}'...")
            sample_points = await self.sample_vectors(collection)
            results["sample_data"][collection] = sample_points
            
            # Test 5: Search Test
            logger.info(f"\n5️⃣  Testing search in '{collection}'...")
            search_results = await self.test_search(collection)
            results["search_test"][collection] = search_results
        
        # Overall assessment
        if results["connection_test"] and len(collections) > 0:
            results["overall_status"] = "PASSED"
            logger.info("\n✅ Overall test result: PASSED")
        else:
            logger.info("\n⚠️  Overall test result: PARTIAL (connection works but no data found)")
        
        logger.info("=" * 60)
        logger.info("🏁 Test completed")
        
        return results

async def main():
    """Main test function."""
    try:
        tester = QdrantDataTester()
        results = await tester.run_comprehensive_test()
        
        # Save results to file
        results_file = "qdrant_test_results.json"
        with open(results_file, "w", encoding="utf-8") as f:
            json.dump(results, f, indent=2, ensure_ascii=False)
        
        logger.info(f"📄 Test results saved to: {results_file}")
        
        # Print summary
        print("\n" + "="*60)
        print("📊 TEST SUMMARY")
        print("="*60)
        print(f"Connection Test: {'✅ PASS' if results['connection_test'] else '❌ FAIL'}")
        print(f"Collections Found: {len(results['collections_found'])}")
        
        for collection, details in results["collection_details"].items():
            points_count = details.get("points_count", 0)
            vectors_count = details.get("vectors_count", 0)
            print(f"  - {collection}: {points_count:,} points, {vectors_count:,} vectors")
        
        print(f"Overall Status: {results['overall_status']}")
        print("="*60)
        
    except Exception as e:
        logger.error(f"❌ Test execution failed: {e}")
        sys.exit(1)

if __name__ == "__main__":
    asyncio.run(main())