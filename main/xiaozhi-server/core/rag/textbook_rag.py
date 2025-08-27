"""Textbook RAG (Retrieval-Augmented Generation) service.

This module provides RAG functionality for educational content using Qdrant Cloud
and Voyage AI embeddings, designed specifically for the xiaozhi AI assistant.
"""

import asyncio
import hashlib
import json
import os
import uuid
from typing import List, Dict, Any, Optional, Tuple
from dataclasses import dataclass
from datetime import datetime

import httpx
import numpy as np
from qdrant_client import QdrantClient as QdrantClientLib
from qdrant_client.models import VectorParams, Distance, PointStruct
from config.logger import setup_logging

logger = setup_logging()
TAG = __name__

@dataclass
class RAGResult:
    """Result from RAG query."""
    answer: str
    sources: List[Dict[str, Any]]
    confidence: float
    response_time_ms: int
    chunks_used: int

@dataclass
class ChunkData:
    """Textbook chunk data for embedding."""
    id: str
    content: str
    textbook_id: int
    chunk_index: int
    page_number: Optional[int] = None
    chapter_title: Optional[str] = None
    metadata: Optional[Dict] = None

class VoyageEmbeddings:
    """Voyage AI embeddings client."""
    
    def __init__(self, api_key: str):
        self.api_key = api_key
        self.base_url = "https://api.voyageai.com/v1"
        self.model = "voyage-3-lite"  # Cost-effective model
        
    async def embed_texts(self, texts: List[str]) -> List[List[float]]:
        """Generate embeddings for multiple texts."""
        if not texts:
            return []
            
        async with httpx.AsyncClient() as client:
            try:
                response = await client.post(
                    f"{self.base_url}/embeddings",
                    headers={
                        "Authorization": f"Bearer {self.api_key}",
                        "Content-Type": "application/json"
                    },
                    json={
                        "input": texts,
                        "model": self.model
                    },
                    timeout=30.0
                )
                response.raise_for_status()
                
                result = response.json()
                embeddings = [item['embedding'] for item in result['data']]
                
                logger.info(f"Generated {len(embeddings)} embeddings using {self.model}")
                return embeddings
                
            except httpx.HTTPError as e:
                logger.error(f"Voyage AI API error: {e}")
                raise Exception(f"Failed to generate embeddings: {e}")
    
    async def embed_query(self, query: str) -> List[float]:
        """Generate embedding for a single query."""
        embeddings = await self.embed_texts([query])
        return embeddings[0] if embeddings else []

class QdrantClient:
    """Qdrant Cloud client for vector operations using official Python client."""
    
    def __init__(self, url: str, api_key: str):
        self.url = url.rstrip('/')
        self.api_key = api_key
        # Extract host and port from URL for official client
        # URL format: https://host:port
        if self.url.startswith('https://'):
            host_port = self.url.replace('https://', '')
            if ':' in host_port:
                self.host, port_str = host_port.split(':', 1)
                self.port = int(port_str)
            else:
                self.host = host_port
                self.port = 443
        else:
            # Fallback for http or other formats
            self.host = 'localhost'
            self.port = 6333
        
        # Initialize the official Qdrant client
        self.client = QdrantClientLib(
            host=self.host,
            port=self.port,
            api_key=self.api_key,
            https=True,
            timeout=60
        )
        logger.info(f"Initialized Qdrant client for {self.host}:{self.port}")
        
    def create_collection(self, collection_name: str, vector_size: int = 512) -> bool:
        """Create a new collection in Qdrant."""
        try:
            # Check if collection exists
            if self.client.collection_exists(collection_name):
                logger.info(f"Collection {collection_name} already exists")
                return True
            
            # Create collection with proper configuration
            self.client.create_collection(
                collection_name=collection_name,
                vectors_config=VectorParams(size=vector_size, distance=Distance.COSINE)
            )
            
            logger.info(f"Collection {collection_name} created successfully")
            return True
            
        except Exception as e:
            logger.error(f"Failed to create collection {collection_name}: {e}")
            return False
    
    def upsert_points(self, collection_name: str, points: List[Dict]) -> bool:
        """Insert or update points in collection."""
        if not points:
            return True
            
        try:
            # Convert points to PointStruct format
            qdrant_points = []
            for point in points:
                qdrant_point = PointStruct(
                    id=point["id"],
                    vector=point["vector"],
                    payload=point["payload"]
                )
                qdrant_points.append(qdrant_point)
            
            # Use official client upsert method
            self.client.upsert(
                collection_name=collection_name,
                points=qdrant_points
            )
            
            logger.info(f"Upserted {len(points)} points to {collection_name}")
            return True
            
        except Exception as e:
            logger.error(f"Failed to upsert points to {collection_name}: {e}")
            return False
    
    def search(self, collection_name: str, query_vector: List[float], 
              limit: int = 5, score_threshold: float = 0.7,
              filter_dict: Optional[Dict] = None) -> List[Dict]:
        """Search for similar vectors."""
        try:
            # Use official client search method
            search_result = self.client.search(
                collection_name=collection_name,
                query_vector=query_vector,
                limit=limit,
                score_threshold=score_threshold,
                query_filter=filter_dict,
                with_payload=True
            )
            
            # Convert to the expected format
            results = []
            for hit in search_result:
                results.append({
                    "id": hit.id,
                    "score": hit.score,
                    "payload": hit.payload
                })
            
            return results
            
        except Exception as e:
            logger.error(f"Search failed for collection {collection_name}: {e}")
            return []

class TextbookRAGService:
    """Main RAG service for textbook queries."""
    
    def __init__(self, config: Dict[str, Any]):
        """Initialize RAG service with configuration."""
        self.voyage_api_key = config.get("voyage_api_key", os.getenv("VOYAGE_API_KEY"))
        self.qdrant_url = config.get("qdrant_url", os.getenv("QDRANT_URL"))
        self.qdrant_api_key = config.get("qdrant_api_key", os.getenv("QDRANT_API_KEY"))
        
        if not all([self.voyage_api_key, self.qdrant_url, self.qdrant_api_key]):
            raise ValueError("Missing required RAG service credentials")
        
        self.embeddings = VoyageEmbeddings(self.voyage_api_key)
        self.qdrant = QdrantClient(self.qdrant_url, self.qdrant_api_key)
        
        # Configuration
        self.chunk_size = config.get("chunk_size", 512)
        self.chunk_overlap = config.get("chunk_overlap", 50)
        self.max_chunks_per_query = config.get("max_chunks_per_query", 5)
        self.score_threshold = config.get("score_threshold", 0.7)
        
        logger.info("TextbookRAG service initialized")
    
    def _generate_collection_name(self, textbook_id: int, language: str = "en") -> str:
        """Generate collection name for NCERT textbooks."""
        return "ncert_textbooks"  # Use shared collection for all NCERT textbooks
    
    async def create_textbook_collection(self, textbook_id: int, language: str = "en") -> bool:
        """Create the shared NCERT textbooks collection if it doesn't exist."""
        collection_name = self._generate_collection_name(textbook_id, language)
        return self.qdrant.create_collection(collection_name, vector_size=512)
    
    async def add_textbook_chunks(self, textbook_id: int, chunks: List[ChunkData], 
                                language: str = "en") -> bool:
        """Add textbook chunks to vector database."""
        if not chunks:
            logger.warning("No chunks provided to add")
            return True
        
        collection_name = self._generate_collection_name(textbook_id, language)
        
        # Create collection if it doesn't exist
        await self.create_textbook_collection(textbook_id, language)
        
        # Generate embeddings for all chunks
        texts = [chunk.content for chunk in chunks]
        
        try:
            embeddings = await self.embeddings.embed_texts(texts)
            
            # Prepare points for Qdrant
            points = []
            for i, (chunk, embedding) in enumerate(zip(chunks, embeddings)):
                point = {
                    "id": int(chunk.id),  # Convert string ID to integer for Qdrant
                    "vector": embedding,
                    "payload": {
                        "textbook_id": chunk.textbook_id,
                        "chunk_index": chunk.chunk_index,
                        "content": chunk.content,
                        "page_number": chunk.page_number,
                        "chapter_title": chunk.chapter_title,
                        "language": language,
                        "created_at": datetime.utcnow().isoformat(),
                        **(chunk.metadata or {})
                    }
                }
                points.append(point)
            
            # Upsert points in batches of 100
            batch_size = 100
            for i in range(0, len(points), batch_size):
                batch = points[i:i + batch_size]
                success = self.qdrant.upsert_points(collection_name, batch)
                if not success:
                    logger.error(f"Failed to upsert batch {i//batch_size + 1}")
                    return False
            
            logger.info(f"Added {len(chunks)} chunks to collection {collection_name}")
            return True
            
        except Exception as e:
            logger.error(f"Failed to add textbook chunks: {e}")
            return False
    
    async def query_textbook(self, question: str, textbook_id: int, 
                           language: str = "en", grade: Optional[str] = None,
                           subject: Optional[str] = None) -> List[Dict]:
        """Query textbook for relevant chunks."""
        collection_name = self._generate_collection_name(textbook_id, language)
        
        try:
            # Generate query embedding
            query_embedding = await self.embeddings.embed_query(question)
            
            # Build filter if needed
            filter_dict = None
            if grade or subject:
                must_conditions = []
                if grade:
                    must_conditions.append({"key": "grade", "match": {"value": grade}})
                if subject:
                    must_conditions.append({"key": "subject", "match": {"value": subject}})
                
                if must_conditions:
                    filter_dict = {"must": must_conditions}
            
            # Search for relevant chunks
            results = self.qdrant.search(
                collection_name=collection_name,
                query_vector=query_embedding,
                limit=self.max_chunks_per_query,
                score_threshold=self.score_threshold,
                filter_dict=filter_dict
            )
            
            logger.info(f"Found {len(results)} relevant chunks for query")
            return results
            
        except Exception as e:
            logger.error(f"Failed to query textbook: {e}")
            return []
    
    def _generate_question_hash(self, question: str) -> str:
        """Generate hash for question for caching/analytics."""
        return hashlib.md5(question.lower().encode()).hexdigest()
    
    async def get_rag_response(self, question: str, textbook_ids: List[int],
                             language: str = "en", grade: Optional[str] = None,
                             subject: Optional[str] = None) -> Optional[RAGResult]:
        """Get RAG response for educational question."""
        start_time = datetime.now()
        all_chunks = []
        
        try:
            # Query all specified textbooks
            for textbook_id in textbook_ids:
                chunks = await self.query_textbook(
                    question=question,
                    textbook_id=textbook_id,
                    language=language,
                    grade=grade,
                    subject=subject
                )
                all_chunks.extend(chunks)
            
            if not all_chunks:
                logger.warning("No relevant chunks found for question")
                return None
            
            # Sort by relevance score
            all_chunks.sort(key=lambda x: x.get('score', 0), reverse=True)
            
            # Take top chunks
            top_chunks = all_chunks[:self.max_chunks_per_query]
            
            # Prepare context
            context_parts = []
            sources = []
            
            for chunk in top_chunks:
                payload = chunk.get('payload', {})
                context_parts.append(payload.get('content', ''))
                
                sources.append({
                    'textbook_id': payload.get('textbook_id'),
                    'page_number': payload.get('page_number'),
                    'chapter_title': payload.get('chapter_title'),
                    'content_preview': payload.get('content', '')[:200] + '...' if len(payload.get('content', '')) > 200 else payload.get('content', ''),
                    'relevance_score': chunk.get('score', 0)
                })
            
            context = "\n\n".join(context_parts)
            
            # Calculate response time
            response_time = int((datetime.now() - start_time).total_seconds() * 1000)
            
            # For now, return the context as answer (AI integration will be added later)
            # In production, this context would be sent to the AI model
            answer = f"Based on the textbook content:\n\n{context}"
            
            return RAGResult(
                answer=answer,
                sources=sources,
                confidence=min(chunk.get('score', 0) for chunk in top_chunks),
                response_time_ms=response_time,
                chunks_used=len(top_chunks)
            )
            
        except Exception as e:
            logger.error(f"Failed to get RAG response: {e}")
            return None

# Global service instance
_rag_service: Optional[TextbookRAGService] = None

def get_rag_service() -> Optional[TextbookRAGService]:
    """Get global RAG service instance."""
    return _rag_service

def initialize_rag_service(config: Dict[str, Any]) -> bool:
    """Initialize global RAG service."""
    global _rag_service
    try:
        _rag_service = TextbookRAGService(config)
        logger.info("RAG service initialized successfully")
        return True
    except Exception as e:
        logger.error(f"Failed to initialize RAG service: {e}")
        return False

async def rag_function_call(question: str, textbook_ids: List[int], 
                          language: str = "en", grade: Optional[str] = None,
                          subject: Optional[str] = None) -> Dict[str, Any]:
    """Function call interface for AI assistant integration."""
    service = get_rag_service()
    if not service:
        return {
            "error": "RAG service not initialized",
            "answer": "Sorry, I cannot access textbook information right now."
        }
    
    result = await service.get_rag_response(
        question=question,
        textbook_ids=textbook_ids,
        language=language,
        grade=grade,
        subject=subject
    )
    
    if not result:
        return {
            "error": "No relevant information found",
            "answer": "I couldn't find relevant information in the specified textbooks."
        }
    
    return {
        "answer": result.answer,
        "sources": result.sources,
        "confidence": result.confidence,
        "response_time_ms": result.response_time_ms,
        "chunks_used": result.chunks_used
    }