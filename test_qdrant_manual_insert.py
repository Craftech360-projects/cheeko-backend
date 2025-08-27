#!/usr/bin/env python3
"""
Test script to manually insert a test point into Qdrant using the new client
"""

import asyncio
import sys
import os

# Add path to Python server
sys.path.append(os.path.join(os.path.dirname(__file__), 'main', 'xiaozhi-server'))

from qdrant_client import QdrantClient
from qdrant_client.models import VectorParams, Distance, PointStruct

async def test_manual_insert():
    """Test manual insertion using the official Qdrant client"""
    
    # Credentials
    QDRANT_URL = "https://1198879c-353e-49b1-bfab-8f74004aaf6d.eu-central-1-0.aws.cloud.qdrant.io:6333"
    QDRANT_API_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJhY2Nlc3MiOiJtIn0.wKcnr3q8Sq4tb7JzPGnZbuxm9XpfDNutdfFD8mCDlrc"
    
    # Parse URL to get host and port
    host = "1198879c-353e-49b1-bfab-8f74004aaf6d.eu-central-1-0.aws.cloud.qdrant.io"
    port = 6333
    
    print(f"Testing direct Qdrant client connection to {host}:{port}")
    
    try:
        # Initialize Qdrant client
        client = QdrantClient(
            host=host,
            port=port,
            api_key=QDRANT_API_KEY,
            https=True,
            timeout=60
        )
        
        print("Qdrant client initialized")
        
        # Check if collection exists
        collection_name = "ncert_textbooks"
        collection_exists = client.collection_exists(collection_name)
        print(f"Collection '{collection_name}' exists: {collection_exists}")
        
        if not collection_exists:
            print("Creating collection...")
            client.create_collection(
                collection_name=collection_name,
                vectors_config=VectorParams(size=1024, distance=Distance.COSINE)
            )
            print("Collection created")
        
        # Get collection info
        collection_info = client.get_collection(collection_name)
        print(f"Collection info: {collection_info}")
        
        # Create a test point
        test_vector = [0.1] * 1024  # Simple test vector
        test_point = PointStruct(
            id=999999,
            vector=test_vector,
            payload={
                "textbook_id": 999,
                "chunk_index": 0,
                "content": "This is a test chunk from the fixed Qdrant client",
                "page_number": 1,
                "chapter_title": "Test Chapter",
                "language": "en",
                "grade": "test",
                "subject": "debug"
            }
        )
        
        print("Inserting test point...")
        client.upsert(
            collection_name=collection_name,
            points=[test_point]
        )
        print("Test point inserted successfully")
        
        # Verify insertion
        collection_info = client.get_collection(collection_name)
        points_count = collection_info.points_count
        print(f"Collection now has {points_count} points")
        
        # Try to retrieve the point
        retrieved_point = client.retrieve(
            collection_name=collection_name,
            ids=[999999]
        )
        
        if retrieved_point:
            print(f"Retrieved point: ID={retrieved_point[0].id}")
            print(f"  Payload: {retrieved_point[0].payload}")
        else:
            print("Could not retrieve inserted point")
            
        return points_count > 0
        
    except Exception as e:
        print(f"Error: {e}")
        return False

if __name__ == "__main__":
    success = asyncio.run(test_manual_insert())
    if success:
        print("\nSUCCESS: Qdrant integration is working with the new client!")
    else:
        print("\nFAILED: Qdrant integration still has issues")