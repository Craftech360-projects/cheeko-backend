"""RAG configuration for textbook functionality."""

import os
from typing import Dict, Any

def get_rag_config() -> Dict[str, Any]:
    """Get RAG configuration from environment variables."""
    return {
        # Voyage AI Configuration
        "voyage_api_key": os.getenv("VOYAGE_API_KEY"),
        
        # Qdrant Cloud Configuration  
        "qdrant_url": os.getenv("QDRANT_URL"),
        "qdrant_api_key": os.getenv("QDRANT_API_KEY"),
        
        # RAG Parameters
        "chunk_size": int(os.getenv("RAG_CHUNK_SIZE", "512")),
        "chunk_overlap": int(os.getenv("RAG_CHUNK_OVERLAP", "50")),
        "max_chunks_per_query": int(os.getenv("RAG_MAX_CHUNKS", "5")),
        "score_threshold": float(os.getenv("RAG_SCORE_THRESHOLD", "0.7")),
        
        # Processing Configuration
        "batch_size": int(os.getenv("RAG_BATCH_SIZE", "100")),
        "max_text_length": int(os.getenv("RAG_MAX_TEXT_LENGTH", "2000")),
        "supported_languages": os.getenv("RAG_LANGUAGES", "en,hi,te,ta,bn").split(",")
    }

def validate_rag_config(config: Dict[str, Any]) -> bool:
    """Validate RAG configuration."""
    required_keys = ["voyage_api_key", "qdrant_url", "qdrant_api_key"]
    
    for key in required_keys:
        if not config.get(key):
            print(f"Missing required RAG config: {key}")
            return False
    
    return True