#!/usr/bin/env python3
"""
Fix collection dimensions by recreating it with correct size
"""

from qdrant_client import QdrantClient
from qdrant_client.models import VectorParams, Distance

# Qdrant credentials
QDRANT_URL = "https://1198879c-353e-49b1-bfab-8f74004aaf6d.eu-central-1-0.aws.cloud.qdrant.io:6333"
QDRANT_API_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJhY2Nlc3MiOiJtIn0.wKcnr3q8Sq4tb7JzPGnZbuxm9XpfDNutdfFD8mCDlrc"

def fix_collection():
    """Delete and recreate collection with correct dimensions"""
    
    client = QdrantClient(
        host="1198879c-353e-49b1-bfab-8f74004aaf6d.eu-central-1-0.aws.cloud.qdrant.io",
        port=6333,
        api_key=QDRANT_API_KEY,
        https=True,
        timeout=60
    )
    
    collection_name = "ncert_textbooks"
    
    print(f"Checking collection {collection_name}...")
    
    # Check current collection info
    if client.collection_exists(collection_name):
        collection_info = client.get_collection(collection_name)
        current_size = collection_info.config.params.vectors.size
        print(f"Current vector size: {current_size}")
        print(f"Points count: {collection_info.points_count}")
        
        if current_size != 512:
            print("Deleting collection with wrong dimensions...")
            client.delete_collection(collection_name)
            print("Collection deleted")
        else:
            print("Collection already has correct dimensions")
            return
    
    # Create collection with correct dimensions
    print("Creating collection with 512 dimensions...")
    client.create_collection(
        collection_name=collection_name,
        vectors_config=VectorParams(size=512, distance=Distance.COSINE)
    )
    
    # Verify new collection
    collection_info = client.get_collection(collection_name)
    print(f"New collection created with vector size: {collection_info.config.params.vectors.size}")
    print("Collection is ready for 512-dimensional vectors (voyage-3-lite)")

if __name__ == "__main__":
    fix_collection()