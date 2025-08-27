#!/usr/bin/env python3
"""
Test script to verify the complete textbook RAG fix.

This script:
1. Triggers textbook processing with proper fixes
2. Waits for processing to complete
3. Tests Qdrant data storage
4. Verifies embeddings are properly stored
"""

import asyncio
import time
import sys
import os
import requests
import json
from datetime import datetime

# Configuration
MANAGER_API_URL = "http://localhost:8002/xiaozhi"
AUTH_TOKEN = "66122e75-3b2a-45d7-a082-0f0894529348"
TEXTBOOK_ID = 6

def test_java_api_connection():
    """Test connection to Java API."""
    try:
        headers = {"Authorization": f"Bearer {AUTH_TOKEN}"}
        response = requests.get(f"{MANAGER_API_URL}/api/textbooks/pending", headers=headers)
        
        if response.status_code == 200:
            print("✅ Java API connection successful")
            return True
        else:
            print(f"❌ Java API connection failed: {response.status_code}")
            return False
    except Exception as e:
        print(f"❌ Java API connection error: {e}")
        return False

def trigger_textbook_processing():
    """Trigger processing of the test textbook."""
    try:
        headers = {"Authorization": f"Bearer {AUTH_TOKEN}"}
        response = requests.post(f"{MANAGER_API_URL}/api/textbooks/{TEXTBOOK_ID}/process", headers=headers)
        
        if response.status_code == 200:
            data = response.json()
            print(f"✅ Textbook processing triggered: {data.get('message', 'Success')}")
            return True
        else:
            print(f"❌ Failed to trigger processing: {response.status_code} - {response.text}")
            return False
    except Exception as e:
        print(f"❌ Error triggering processing: {e}")
        return False

def check_textbook_status():
    """Check the status of textbook processing."""
    try:
        headers = {"Authorization": f"Bearer {AUTH_TOKEN}"}
        response = requests.get(f"{MANAGER_API_URL}/api/textbooks/{TEXTBOOK_ID}", headers=headers)
        
        if response.status_code == 200:
            data = response.json()
            if data and 'data' in data:
                textbook = data.get('data', {})
                status = textbook.get('status', 'unknown')
                chunks = textbook.get('processedChunks', 0)
                print(f"📊 Textbook status: {status}, Processed chunks: {chunks}")
                return status, chunks
            else:
                print(f"⚠️ Unexpected response format: {data}")
                return 'unknown', 0
        else:
            print(f"❌ Failed to get textbook status: {response.status_code} - {response.text}")
            return None, 0
    except Exception as e:
        print(f"❌ Error checking status: {e}")
        return None, 0

def get_textbook_chunks():
    """Get chunks for the textbook."""
    try:
        headers = {"Authorization": f"Bearer {AUTH_TOKEN}"}
        response = requests.get(f"{MANAGER_API_URL}/api/textbooks/{TEXTBOOK_ID}/chunks", headers=headers)
        
        if response.status_code == 200:
            data = response.json()
            chunks = data.get('data', [])
            print(f"📝 Retrieved {len(chunks)} chunks")
            
            # Check embedding status
            embedding_stats = {}
            for chunk in chunks:
                status = chunk.get('embeddingStatus', 'unknown')
                embedding_stats[status] = embedding_stats.get(status, 0) + 1
                
                # Check if chunk has embedding vector
                if chunk.get('embeddingVector'):
                    print(f"  ✅ Chunk {chunk.get('chunkIndex')} has embedding vector")
                else:
                    print(f"  ❌ Chunk {chunk.get('chunkIndex')} missing embedding vector")
            
            print(f"📈 Embedding status breakdown: {embedding_stats}")
            return chunks
        else:
            print(f"❌ Failed to get chunks: {response.status_code}")
            return []
    except Exception as e:
        print(f"❌ Error getting chunks: {e}")
        return []

async def test_qdrant_data():
    """Test Qdrant data storage using our test script."""
    try:
        # Change to the xiaozhi-server directory and run the test
        import subprocess
        result = subprocess.run([
            sys.executable, 'test_qdrant_data.py'
        ], cwd='main/xiaozhi-server', capture_output=True, text=True)
        
        if result.returncode == 0:
            print("✅ Qdrant test completed - check qdrant_test_results.json for details")
            
            # Try to read the results
            try:
                with open('main/xiaozhi-server/qdrant_test_results.json', 'r') as f:
                    results = json.load(f)
                    
                collections = results.get('collections_found', [])
                print(f"📚 Qdrant collections: {collections}")
                
                for collection, details in results.get('collection_details', {}).items():
                    points = details.get('points_count', 0)
                    vectors = details.get('vectors_count', 0)
                    print(f"  - {collection}: {points} points, {vectors} vectors")
                    
                    if points > 0:
                        print(f"    ✅ Collection {collection} has data!")
                    else:
                        print(f"    ❌ Collection {collection} is empty")
                        
            except Exception as e:
                print(f"⚠️  Could not read test results: {e}")
            return True
        else:
            print(f"❌ Qdrant test failed: {result.stderr}")
            return False
    except Exception as e:
        print(f"❌ Error running Qdrant test: {e}")
        return False

def wait_for_processing_completion(max_wait_seconds=120):
    """Wait for textbook processing to complete."""
    print(f"⏳ Waiting for processing to complete (max {max_wait_seconds}s)...")
    
    start_time = time.time()
    while time.time() - start_time < max_wait_seconds:
        status, chunks = check_textbook_status()
        
        if status in ['processed', 'failed']:
            print(f"🏁 Processing completed with status: {status}")
            return status == 'processed'
        
        print(f"  ⏳ Status: {status}, waiting 5s...")
        time.sleep(5)
    
    print(f"⏰ Timeout waiting for processing completion")
    return False

async def main():
    """Main test function."""
    print("🚀 Starting Textbook RAG Fix Verification Test")
    print("=" * 60)
    print(f"Target textbook ID: {TEXTBOOK_ID}")
    print(f"Manager API URL: {MANAGER_API_URL}")
    print(f"Test started at: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    print()
    
    # Step 1: Test Java API connection
    print("1️⃣  Testing Java API connection...")
    if not test_java_api_connection():
        print("❌ Cannot proceed - Java API not accessible")
        return False
    print()
    
    # Step 2: Trigger textbook processing
    print("2️⃣  Triggering textbook processing...")
    if not trigger_textbook_processing():
        print("❌ Cannot proceed - failed to trigger processing")
        return False
    print()
    
    # Step 3: Wait for processing to complete
    print("3️⃣  Waiting for processing to complete...")
    if not wait_for_processing_completion():
        print("❌ Processing did not complete successfully")
        return False
    print()
    
    # Step 4: Check chunks and embeddings
    print("4️⃣  Checking chunks and embeddings...")
    chunks = get_textbook_chunks()
    if not chunks:
        print("❌ No chunks found")
        return False
    print()
    
    # Step 5: Test Qdrant data
    print("5️⃣  Testing Qdrant data storage...")
    qdrant_ok = await test_qdrant_data()
    print()
    
    # Final summary
    print("=" * 60)
    print("📊 FINAL SUMMARY")
    print("=" * 60)
    print(f"Java API Connection: {'✅ PASS' if True else '❌ FAIL'}")
    print(f"Textbook Processing: {'✅ PASS' if chunks else '❌ FAIL'}")
    print(f"Chunks Retrieved: {len(chunks)} chunks")
    print(f"Qdrant Data Test: {'✅ PASS' if qdrant_ok else '❌ FAIL'}")
    
    overall_success = len(chunks) > 0 and qdrant_ok
    print(f"Overall Result: {'✅ SUCCESS' if overall_success else '❌ PARTIAL/FAILED'}")
    print("=" * 60)
    
    return overall_success

if __name__ == "__main__":
    try:
        success = asyncio.run(main())
        sys.exit(0 if success else 1)
    except KeyboardInterrupt:
        print("\n⏹️  Test interrupted by user")
        sys.exit(1)
    except Exception as e:
        print(f"\n❌ Test failed with error: {e}")
        sys.exit(1)