"""RAG integration module for xiaozhi AI assistant.

This module integrates textbook RAG functionality with the main xiaozhi server,
providing function calling capabilities for educational queries.
"""

import asyncio
import json
from typing import Dict, List, Optional, Any
from config.logger import setup_logging
from core.rag.textbook_rag import initialize_rag_service, rag_function_call

logger = setup_logging()
TAG = __name__

class RAGIntegration:
    """RAG integration for xiaozhi AI assistant."""
    
    def __init__(self):
        self.enabled = False
        self.config = {}
        
    def initialize(self, config: Dict[str, Any]) -> bool:
        """Initialize RAG service with configuration."""
        try:
            # Extract RAG configuration
            self.config = {
                "voyage_api_key": config.get("voyage_api_key"),
                "qdrant_url": config.get("qdrant_url"), 
                "qdrant_api_key": config.get("qdrant_api_key"),
                "chunk_size": config.get("chunk_size", 512),
                "chunk_overlap": config.get("chunk_overlap", 50),
                "max_chunks_per_query": config.get("max_chunks_per_query", 5),
                "score_threshold": config.get("score_threshold", 0.7)
            }
            
            # Validate required credentials
            required_keys = ["voyage_api_key", "qdrant_url", "qdrant_api_key"]
            missing_keys = [key for key in required_keys if not self.config.get(key)]
            
            if missing_keys:
                logger.warning(f"RAG service disabled - missing configuration: {missing_keys}")
                return False
            
            # Initialize RAG service
            success = initialize_rag_service(self.config)
            if success:
                self.enabled = True
                logger.info("RAG integration enabled successfully")
            else:
                logger.error("Failed to initialize RAG service")
                
            return success
            
        except Exception as e:
            logger.error(f"RAG integration initialization error: {e}")
            return False
    
    def is_enabled(self) -> bool:
        """Check if RAG functionality is enabled."""
        return self.enabled
    
    async def handle_educational_query(self, query: str, context: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        """Handle educational query using RAG."""
        if not self.enabled:
            return None
        
        try:
            # Extract query parameters from context
            textbook_ids = context.get("textbook_ids", [])
            language = context.get("language", "en") 
            grade = context.get("grade")
            subject = context.get("subject")
            
            # Default to all available textbooks if none specified
            if not textbook_ids:
                # In production, this would query the database for available textbooks
                logger.info("No textbook IDs specified, skipping RAG query")
                return None
            
            # Call RAG service
            result = await rag_function_call(
                question=query,
                textbook_ids=textbook_ids,
                language=language,
                grade=grade,
                subject=subject
            )
            
            logger.info(f"RAG query completed in {result.get('response_time_ms', 0)}ms")
            return result
            
        except Exception as e:
            logger.error(f"RAG query error: {e}")
            return {
                "error": str(e),
                "answer": "I encountered an error while searching the textbooks."
            }
    
    def get_function_definition(self) -> Dict[str, Any]:
        """Get function definition for AI assistant function calling."""
        return {
            "name": "search_textbook",
            "description": "Search textbooks for educational content to help answer academic questions about subjects like math, science, history, etc.",
            "parameters": {
                "type": "object",
                "properties": {
                    "question": {
                        "type": "string",
                        "description": "The educational question or topic to search for"
                    },
                    "textbook_ids": {
                        "type": "array",
                        "items": {"type": "integer"},
                        "description": "List of textbook IDs to search in (optional - searches all if not provided)"
                    },
                    "grade": {
                        "type": "string", 
                        "description": "Grade level (e.g., '5', '10', '12') to filter content (optional)"
                    },
                    "subject": {
                        "type": "string",
                        "description": "Subject to filter by (e.g., 'math', 'science', 'history') (optional)"
                    },
                    "language": {
                        "type": "string",
                        "description": "Language for search (default: 'en')",
                        "enum": ["en", "hi", "te", "ta", "bn"]
                    }
                },
                "required": ["question"]
            }
        }
    
    async def execute_function(self, function_name: str, parameters: Dict[str, Any]) -> Dict[str, Any]:
        """Execute RAG function call."""
        if function_name != "search_textbook":
            return {"error": f"Unknown function: {function_name}"}
        
        if not self.enabled:
            return {
                "error": "RAG service not available", 
                "answer": "Textbook search is currently unavailable."
            }
        
        try:
            question = parameters.get("question")
            if not question:
                return {"error": "Question parameter is required"}
            
            context = {
                "textbook_ids": parameters.get("textbook_ids", []),
                "language": parameters.get("language", "en"),
                "grade": parameters.get("grade"),
                "subject": parameters.get("subject")
            }
            
            result = await self.handle_educational_query(question, context)
            return result or {
                "error": "No results found",
                "answer": "I couldn't find relevant information for your question."
            }
            
        except Exception as e:
            logger.error(f"Function execution error: {e}")
            return {
                "error": str(e),
                "answer": "I encountered an error while processing your question."
            }

# Global integration instance
_rag_integration: Optional[RAGIntegration] = None

def get_rag_integration() -> RAGIntegration:
    """Get global RAG integration instance."""
    global _rag_integration
    if _rag_integration is None:
        _rag_integration = RAGIntegration()
    return _rag_integration

def initialize_rag_integration(config: Dict[str, Any]) -> bool:
    """Initialize RAG integration."""
    integration = get_rag_integration()
    return integration.initialize(config)

# Function calling interface for AI assistant
async def textbook_search_function(question: str, textbook_ids: List[int] = None,
                                 grade: str = None, subject: str = None, 
                                 language: str = "en") -> Dict[str, Any]:
    """Function call interface for textbook search."""
    integration = get_rag_integration()
    
    parameters = {
        "question": question,
        "textbook_ids": textbook_ids or [],
        "grade": grade,
        "subject": subject,
        "language": language
    }
    
    return await integration.execute_function("search_textbook", parameters)