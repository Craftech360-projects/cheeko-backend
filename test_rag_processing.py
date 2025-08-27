#!/usr/bin/env python3
"""
Test script to manually trigger RAG processing
"""

import asyncio
import sys
import os

# Add path to Python server
sys.path.append(os.path.join(os.path.dirname(__file__), 'main', 'xiaozhi-server'))

from config.rag_config import get_rag_config
from core.rag.pdf_processor import initialize_pdf_processor
from core.rag.textbook_rag import initialize_rag_service

async def test_rag_processing():
    """Test RAG processing manually"""
    print("Initializing RAG services...")
    
    # Get RAG config
    rag_config = get_rag_config()
    
    # Initialize RAG service
    success = initialize_rag_service(rag_config)
    if not success:
        print("Failed to initialize RAG service")
        return
    
    print("RAG service initialized successfully")
    
    # Initialize PDF processor
    processor = initialize_pdf_processor(
        manager_api_url="http://localhost:8002/xiaozhi",
        api_token="66122e75-3b2a-45d7-a082-0f0894529348"
    )
    
    print("PDF processor initialized")
    
    # Try to sync pending textbooks
    print("Checking for pending textbooks...")
    results = await processor.sync_pending_textbooks()
    
    if results:
        for result in results:
            if result.success:
                print(f"✓ Textbook {result.textbook_id}: {result.chunks_created} chunks, {result.chunks_embedded} embedded ({result.processing_time_ms}ms)")
            else:
                print(f"✗ Textbook {result.textbook_id}: {result.error_message}")
    else:
        print("No pending textbooks found")
    
    return len(results) if results else 0

if __name__ == "__main__":
    # Set environment variables
    os.environ["QDRANT_URL"] = "https://1198879c-353e-49b1-bfab-8f74004aaf6d.eu-central-1-0.aws.cloud.qdrant.io:6333"
    os.environ["QDRANT_API_KEY"] = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJhY2Nlc3MiOiJtIn0.wKcnr3q8Sq4tb7JzPGnZbuxm9XpfDNutdfFD8mCDlrc"
    os.environ["VOYAGE_API_KEY"] = "pa-1ai2681JWAAiaAGVPzmVHhiEWmOmwPwVGAfYBBi-oBL"
    
    processed_count = asyncio.run(test_rag_processing())
    print(f"\nProcessed {processed_count} textbooks")