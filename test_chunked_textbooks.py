#!/usr/bin/env python3
"""
Test to get textbooks ready for embedding processing
"""

import asyncio
import httpx
import sys
import os

# Add path to Python server
sys.path.append(os.path.join(os.path.dirname(__file__), 'main', 'xiaozhi-server'))

from config.rag_config import get_rag_config
from core.rag.pdf_processor import initialize_pdf_processor, get_pdf_processor
from core.rag.textbook_rag import initialize_rag_service

async def test_textbook_processing():
    """Test finding and processing textbooks ready for embeddings"""
    print("=== Testing Textbook Processing ===")
    
    # Set environment variables
    os.environ["QDRANT_URL"] = "https://1198879c-353e-49b1-bfab-8f74004aaf6d.eu-central-1-0.aws.cloud.qdrant.io:6333"
    os.environ["QDRANT_API_KEY"] = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJhY2Nlc3MiOiJtIn0.wKcnr3q8Sq4tb7JzPGnZbuxm9XpfDNutdfFD8mCDlrc"
    os.environ["VOYAGE_API_KEY"] = "pa-1ai2681JWAAiaAGVPzmVHhiEWmOmwPwVGAfYBBi-oBL"
    
    # Initialize services
    rag_config = get_rag_config()
    rag_success = initialize_rag_service(rag_config)
    
    if not rag_success:
        print("Failed to initialize RAG service")
        return
    
    processor = initialize_pdf_processor(
        manager_api_url="http://localhost:8002/xiaozhi",
        api_token="66122e75-3b2a-45d7-a082-0f0894529348"
    )
    
    # Test the endpoint directly
    headers = {
        "Content-Type": "application/json",
        "Authorization": "Bearer 66122e75-3b2a-45d7-a082-0f0894529348"
    }
    
    async with httpx.AsyncClient() as client:
        # Test pending endpoint
        print("1. Testing /api/textbooks/pending endpoint:")
        try:
            response = await client.get(
                "http://localhost:8002/xiaozhi/api/textbooks/pending",
                headers=headers,
                timeout=30.0
            )
            
            print(f"   Status: {response.status_code}")
            if response.status_code == 200:
                data = response.json()
                textbooks = data.get('data', [])
                print(f"   Found {len(textbooks)} textbooks:")
                
                for tb in textbooks:
                    print(f"     - ID: {tb.get('id')}, Name: {tb.get('originalFilename')}, Status: {tb.get('status')}")
                
                if textbooks:
                    # Try processing the first textbook
                    first_textbook = textbooks[0]
                    textbook_id = first_textbook['id']
                    
                    print(f"\n2. Processing textbook {textbook_id}:")
                    result = await processor.process_textbook(textbook_id)
                    
                    if result.success:
                        print(f"   SUCCESS: {result.chunks_created} chunks, {result.chunks_embedded} embedded in {result.processing_time_ms}ms")
                    else:
                        print(f"   FAILED: {result.error_message}")
                        
                else:
                    print("   No textbooks ready for processing")
                    
            else:
                print(f"   Error: {response.text}")
                
        except Exception as e:
            print(f"   Exception: {e}")

if __name__ == "__main__":
    asyncio.run(test_textbook_processing())