"""PDF processing pipeline for textbook RAG.

This module handles PDF text extraction, chunking, and synchronization
with the manager-api backend.
"""

import asyncio
import hashlib
import re
from typing import List, Dict, Any, Optional, Tuple
from dataclasses import dataclass
import httpx
from datetime import datetime

from config.logger import setup_logging
from core.rag.textbook_rag import ChunkData, get_rag_service

logger = setup_logging()
TAG = __name__

@dataclass
class ProcessingResult:
    """Result from PDF processing."""
    success: bool
    textbook_id: int
    chunks_created: int
    chunks_embedded: int
    error_message: Optional[str] = None
    processing_time_ms: int = 0

class PDFProcessor:
    """PDF processing and synchronization service."""
    
    def __init__(self, manager_api_url: str, api_token: Optional[str] = None):
        """Initialize PDF processor.
        
        Args:
            manager_api_url: Base URL of manager-api (e.g., http://localhost:8080)
            api_token: Optional API token for authentication
        """
        self.manager_api_url = manager_api_url.rstrip('/')
        self.api_token = api_token
        self.headers = {
            "Content-Type": "application/json"
        }
        if api_token:
            self.headers["Authorization"] = f"Bearer {api_token}"
    
    async def sync_pending_textbooks(self) -> List[ProcessingResult]:
        """Sync and process pending textbooks from manager-api."""
        results = []
        
        try:
            # Get pending textbooks from manager-api
            pending_textbooks = await self._get_pending_textbooks()
            
            if not pending_textbooks:
                logger.info("No pending textbooks to process")
                return results
            
            logger.info(f"Found {len(pending_textbooks)} pending textbooks")
            
            # Process each textbook
            for textbook in pending_textbooks:
                result = await self.process_textbook(textbook['id'])
                results.append(result)
                
                # Add delay to prevent overwhelming the APIs
                await asyncio.sleep(1)
            
            return results
            
        except Exception as e:
            logger.error(f"Failed to sync textbooks: {e}")
            return results
    
    async def _get_pending_textbooks(self) -> List[Dict[str, Any]]:
        """Fetch pending textbooks from manager-api."""
        async with httpx.AsyncClient() as client:
            try:
                url = f"{self.manager_api_url}/api/textbooks/pending"
                logger.info(f"Fetching pending textbooks from: {url}")
                logger.info(f"Headers: {self.headers}")
                
                response = await client.get(
                    url,
                    headers=self.headers,
                    timeout=30.0
                )
                
                if response.status_code == 200:
                    response_data = response.json()
                    if response_data.get('success') and 'data' in response_data:
                        return response_data['data']
                    else:
                        logger.error(f"Invalid response format: {response_data}")
                        return []
                else:
                    logger.error(f"Failed to fetch pending textbooks: {response.status_code}")
                    return []
                    
            except httpx.HTTPError as e:
                logger.error(f"Error fetching pending textbooks: {e}")
                return []
    
    async def _get_textbook_chunks(self, textbook_id: int) -> List[Dict[str, Any]]:
        """Fetch textbook chunks from manager-api."""
        async with httpx.AsyncClient() as client:
            try:
                response = await client.get(
                    f"{self.manager_api_url}/api/textbooks/{textbook_id}/chunks/server",
                    headers=self.headers,
                    timeout=30.0
                )
                
                if response.status_code == 200:
                    data = response.json()
                    return data.get("data", [])
                else:
                    logger.error(f"Failed to fetch chunks for textbook {textbook_id}: {response.status_code}")
                    return []
                    
            except httpx.HTTPError as e:
                logger.error(f"Error fetching chunks: {e}")
                return []
    
    async def _update_textbook_status(self, textbook_id: int, status: str, 
                                     error_message: Optional[str] = None) -> bool:
        """Update textbook processing status in manager-api."""
        async with httpx.AsyncClient() as client:
            try:
                payload = {
                    "status": status,
                    "updated_at": datetime.utcnow().isoformat()
                }
                
                if error_message:
                    payload["error_message"] = error_message
                
                response = await client.patch(
                    f"{self.manager_api_url}/api/textbooks/{textbook_id}/status",
                    headers=self.headers,
                    json=payload,
                    timeout=30.0
                )
                
                return response.status_code == 200
                
            except httpx.HTTPError as e:
                logger.error(f"Error updating textbook status: {e}")
                return False
    
    async def _update_chunk_status(self, chunk_ids: List[str], status: str,
                                  qdrant_ids: Optional[List[str]] = None) -> bool:
        """Update chunk embedding status in manager-api."""
        async with httpx.AsyncClient() as client:
            try:
                payload = {
                    "chunk_ids": chunk_ids,
                    "status": status
                }
                
                if qdrant_ids:
                    payload["qdrant_ids"] = qdrant_ids
                
                response = await client.patch(
                    f"{self.manager_api_url}/api/textbooks/chunks/status",
                    headers=self.headers,
                    json=payload,
                    timeout=30.0
                )
                
                return response.status_code == 200
                
            except httpx.HTTPError as e:
                logger.error(f"Error updating chunk status: {e}")
                return False
    
    async def process_textbook(self, textbook_id: int) -> ProcessingResult:
        """Process a single textbook - fetch chunks and create embeddings."""
        start_time = datetime.now()
        
        try:
            logger.info(f"Processing textbook {textbook_id}")
            
            # Update status to processing
            await self._update_textbook_status(textbook_id, "processing")
            
            # Get textbook metadata
            textbook_info = await self._get_textbook_info(textbook_id)
            if not textbook_info:
                raise Exception(f"Textbook {textbook_id} not found")
            
            # Get chunks from manager-api
            chunks_data = await self._get_textbook_chunks(textbook_id)
            
            if not chunks_data:
                raise Exception(f"No chunks found for textbook {textbook_id}")
            
            logger.info(f"Found {len(chunks_data)} chunks for textbook {textbook_id}")
            
            # Convert to ChunkData objects
            chunks = []
            for chunk in chunks_data:
                chunk_obj = ChunkData(
                    id=str(chunk['id']),
                    content=chunk['content'],
                    textbook_id=textbook_id,
                    chunk_index=chunk.get('chunkIndex'),  # Java uses camelCase
                    page_number=chunk.get('pageNumber'),  # Java uses camelCase
                    chapter_title=chunk.get('chapterTitle'),  # Java uses camelCase
                    metadata={
                        'grade': textbook_info.get('grade'),
                        'subject': textbook_info.get('subject'),
                        'filename': textbook_info.get('filename')
                    }
                )
                chunks.append(chunk_obj)
            
            # Get RAG service
            rag_service = get_rag_service()
            if not rag_service:
                raise Exception("RAG service not initialized")
            
            # Add chunks to vector database
            language = textbook_info.get('language', 'en')
            success = await rag_service.add_textbook_chunks(
                textbook_id=textbook_id,
                chunks=chunks,
                language=language
            )
            
            if success:
                # Update chunk status to uploaded
                chunk_ids = [str(chunk['id']) for chunk in chunks_data]
                await self._update_chunk_status(chunk_ids, "uploaded")
                
                # Update textbook status to processed
                await self._update_textbook_status(textbook_id, "processed")
                
                processing_time = int((datetime.now() - start_time).total_seconds() * 1000)
                
                logger.info(f"Successfully processed textbook {textbook_id} in {processing_time}ms")
                
                return ProcessingResult(
                    success=True,
                    textbook_id=textbook_id,
                    chunks_created=len(chunks),
                    chunks_embedded=len(chunks),
                    processing_time_ms=processing_time
                )
            else:
                raise Exception("Failed to create embeddings")
                
        except Exception as e:
            error_msg = str(e)
            logger.error(f"Failed to process textbook {textbook_id}: {error_msg}")
            
            # Update status to failed
            await self._update_textbook_status(textbook_id, "failed", error_msg)
            
            processing_time = int((datetime.now() - start_time).total_seconds() * 1000)
            
            return ProcessingResult(
                success=False,
                textbook_id=textbook_id,
                chunks_created=0,
                chunks_embedded=0,
                error_message=error_msg,
                processing_time_ms=processing_time
            )
    
    async def _get_textbook_info(self, textbook_id: int) -> Optional[Dict[str, Any]]:
        """Get textbook metadata from manager-api."""
        async with httpx.AsyncClient() as client:
            try:
                response = await client.get(
                    f"{self.manager_api_url}/api/textbooks/{textbook_id}",
                    headers=self.headers,
                    timeout=30.0
                )
                
                if response.status_code == 200:
                    return response.json()
                else:
                    logger.error(f"Failed to fetch textbook info: {response.status_code}")
                    return None
                    
            except httpx.HTTPError as e:
                logger.error(f"Error fetching textbook info: {e}")
                return None
    
    async def delete_textbook_embeddings(self, textbook_id: int, language: str = "en") -> bool:
        """Delete textbook embeddings from vector database."""
        try:
            rag_service = get_rag_service()
            if not rag_service:
                logger.error("RAG service not initialized")
                return False
            
            collection_name = rag_service._generate_collection_name(textbook_id, language)
            
            # Delete collection from Qdrant
            async with httpx.AsyncClient() as client:
                response = await client.delete(
                    f"{rag_service.qdrant_url}/collections/{collection_name}",
                    headers=rag_service.qdrant.headers,
                    timeout=30.0
                )
                
                if response.status_code in [200, 204]:
                    logger.info(f"Deleted collection {collection_name}")
                    return True
                elif response.status_code == 404:
                    logger.info(f"Collection {collection_name} not found")
                    return True
                else:
                    logger.error(f"Failed to delete collection: {response.status_code}")
                    return False
                    
        except Exception as e:
            logger.error(f"Failed to delete textbook embeddings: {e}")
            return False

# Background task for periodic sync
async def periodic_sync_task(processor: PDFProcessor, interval_seconds: int = 300):
    """Periodic task to sync pending textbooks.
    
    Args:
        processor: PDFProcessor instance
        interval_seconds: Sync interval in seconds (default: 5 minutes)
    """
    while True:
        try:
            logger.info("Starting periodic textbook sync")
            results = await processor.sync_pending_textbooks()
            
            success_count = sum(1 for r in results if r.success)
            failed_count = sum(1 for r in results if not r.success)
            
            if results:
                logger.info(f"Sync completed: {success_count} success, {failed_count} failed")
            
        except Exception as e:
            logger.error(f"Periodic sync error: {e}")
        
        # Wait for next sync
        await asyncio.sleep(interval_seconds)

# Global processor instance
_pdf_processor: Optional[PDFProcessor] = None

def initialize_pdf_processor(manager_api_url: str, api_token: Optional[str] = None) -> PDFProcessor:
    """Initialize global PDF processor."""
    global _pdf_processor
    _pdf_processor = PDFProcessor(manager_api_url, api_token)
    logger.info(f"PDF processor initialized with manager-api at {manager_api_url}")
    return _pdf_processor

def get_pdf_processor() -> Optional[PDFProcessor]:
    """Get global PDF processor instance."""
    return _pdf_processor