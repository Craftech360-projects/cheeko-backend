#!/usr/bin/env python3
"""
Simple test script to verify data in Qdrant ncert_textbooks collection
"""

import os
import sys
import asyncio
import httpx

# Qdrant credentials
QDRANT_URL = "https://1198879c-353e-49b1-bfab-8f74004aaf6d.eu-central-1-0.aws.cloud.qdrant.io:6333"
QDRANT_API_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJhY2Nlc3MiOiJtIn0.wKcnr3q8Sq4tb7JzPGnZbuxm9XpfDNutdfFD8mCDlrc"

async def test_qdrant():
    """Test Qdrant collection"""
    
    if not QDRANT_URL or not QDRANT_API_KEY:
        print("Error: Missing QDRANT_URL or QDRANT_API_KEY environment variables")
        return
    
    url = QDRANT_URL.rstrip('/')
    headers = {
        "api-key": QDRANT_API_KEY,
        "Content-Type": "application/json"
    }
    
    print(f"Testing Qdrant at: {url}")
    print("-" * 50)
    
    async with httpx.AsyncClient() as client:
        try:
            # Test 1: Get collection info
            print("\n[1] Checking ncert_textbooks collection...")
            response = await client.get(
                f"{url}/collections/ncert_textbooks",
                headers=headers,
                timeout=30.0
            )
            
            if response.status_code == 200:
                collection_info = response.json()
                result = collection_info.get('result', {})
                points_count = result.get('points_count', 0)
                print(f"Collection exists with {points_count} points")
                
                if points_count == 0:
                    print("Collection is empty!")
                    return
                    
            elif response.status_code == 404:
                print("Collection does not exist!")
                return
            else:
                print(f"Error getting collection: {response.status_code}")
                return
            
            # Test 2: Scroll through points
            print(f"\n[2] Fetching first 5 points...")
            scroll_params = {
                "limit": 5,
                "with_payload": True,
                "with_vectors": False
            }
            
            response = await client.post(
                f"{url}/collections/ncert_textbooks/points/scroll",
                headers=headers,
                json=scroll_params,
                timeout=30.0
            )
            
            if response.status_code == 200:
                result = response.json()
                points = result.get('result', {}).get('points', [])
                
                print(f"Found {len(points)} points:")
                for i, point in enumerate(points):
                    payload = point.get('payload', {})
                    print(f"  Point {i+1}:")
                    print(f"    ID: {point.get('id')}")
                    print(f"    Textbook ID: {payload.get('textbook_id')}")
                    print(f"    Chunk Index: {payload.get('chunk_index')}")
                    print(f"    Page: {payload.get('page_number')}")
                    print(f"    Grade: {payload.get('grade')}")
                    print(f"    Subject: {payload.get('subject')}")
                    print(f"    Content: {payload.get('content', '')[:100]}...")
                    print()
                
                if len(points) > 0:
                    print(f"SUCCESS: Found {len(points)} points in collection!")
                else:
                    print("WARNING: Collection exists but no points returned")
                    
            else:
                print(f"Error scrolling points: {response.status_code}")
                print(response.text)
                
        except Exception as e:
            print(f"Error: {e}")

async def list_all_collections():
    """List all collections to see what exists"""
    url = QDRANT_URL.rstrip('/')
    headers = {
        "api-key": QDRANT_API_KEY,
        "Content-Type": "application/json"
    }
    
    async with httpx.AsyncClient() as client:
        try:
            response = await client.get(
                f"{url}/collections",
                headers=headers,
                timeout=30.0
            )
            
            if response.status_code == 200:
                result = response.json()
                collections = result.get('result', {}).get('collections', [])
                print(f"\nAll Collections ({len(collections)} found):")
                
                for collection in collections:
                    name = collection.get('name')
                    print(f"  - {name}")
                    
                    # Get points count for each collection
                    info_response = await client.get(
                        f"{url}/collections/{name}",
                        headers=headers,
                        timeout=30.0
                    )
                    
                    if info_response.status_code == 200:
                        info_data = info_response.json()
                        points_count = info_data.get('result', {}).get('points_count', 0)
                        print(f"    Points: {points_count}")
                    print()
                    
            else:
                print(f"Failed to list collections: {response.status_code}")
                
        except Exception as e:
            print(f"Error listing collections: {e}")

if __name__ == "__main__":
    print("=== Testing All Collections ===")
    asyncio.run(list_all_collections())
    print("\n=== Testing ncert_textbooks Collection ===")
    asyncio.run(test_qdrant())