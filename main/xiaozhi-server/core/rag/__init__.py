"""RAG (Retrieval-Augmented Generation) package for textbook queries."""

from .textbook_rag import (
    TextbookRAGService,
    RAGResult,
    ChunkData,
    get_rag_service,
    initialize_rag_service,
    rag_function_call
)

__all__ = [
    'TextbookRAGService',
    'RAGResult', 
    'ChunkData',
    'get_rag_service',
    'initialize_rag_service',
    'rag_function_call'
]