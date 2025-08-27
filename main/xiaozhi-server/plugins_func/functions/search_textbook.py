"""Textbook RAG search function for educational queries.

This function integrates textbook RAG functionality into the xiaozhi AI assistant,
allowing it to search educational content and help kids with academic questions.
"""

import asyncio
import os
from typing import Dict, List, Any, Optional
from config.logger import setup_logging
from plugins_func.register import register_function, ToolType, ActionResponse, Action
from core.rag.rag_integration import get_rag_integration, initialize_rag_integration
from config.rag_config import get_rag_config, validate_rag_config

TAG = __name__
logger = setup_logging()

SEARCH_TEXTBOOK_FUNCTION_DESC = {
    "type": "function",
    "function": {
        "name": "search_textbook",
        "description": (
            "Search textbooks for educational content to help answer academic questions. "
            "Use this when a student asks about subjects like math, science, history, geography, "
            "or any school-related topic. This searches through uploaded textbook content."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "question": {
                    "type": "string",
                    "description": "The educational question or topic to search for"
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
                    "enum": ["en", "hi", "te", "ta", "bn", "mr", "gu", "kn", "ml", "pa"]
                }
            },
            "required": ["question"]
        }
    }
}

# Subject mappings for Indian curriculum
SUBJECT_MAPPINGS = {
    "maths": "math",
    "mathematics": "math",
    "ganit": "math",
    "physics": "science",
    "chemistry": "science",
    "biology": "science",
    "vigyan": "science",
    "itihas": "history",
    "bhugol": "geography",
    "english": "english",
    "hindi": "hindi",
    "sanskrit": "sanskrit",
    "computer": "computer",
    "economics": "economics",
    "political science": "politics",
    "civics": "civics"
}

# Grade mappings
GRADE_MAPPINGS = {
    "first": "1", "1st": "1",
    "second": "2", "2nd": "2",
    "third": "3", "3rd": "3",
    "fourth": "4", "4th": "4",
    "fifth": "5", "5th": "5",
    "sixth": "6", "6th": "6",
    "seventh": "7", "7th": "7",
    "eighth": "8", "8th": "8",
    "ninth": "9", "9th": "9",
    "tenth": "10", "10th": "10",
    "eleventh": "11", "11th": "11",
    "twelfth": "12", "12th": "12",
    "class 1": "1", "class 2": "2", "class 3": "3",
    "class 4": "4", "class 5": "5", "class 6": "6",
    "class 7": "7", "class 8": "8", "class 9": "9",
    "class 10": "10", "class 11": "11", "class 12": "12"
}

# Initialize RAG integration on module load
_rag_initialized = False

def ensure_rag_initialized():
    """Ensure RAG service is initialized."""
    global _rag_initialized
    if not _rag_initialized:
        try:
            config = get_rag_config()
            if validate_rag_config(config):
                success = initialize_rag_integration(config)
                if success:
                    _rag_initialized = True
                    logger.info("RAG integration initialized for search_textbook function")
                else:
                    logger.warning("Failed to initialize RAG integration")
            else:
                logger.warning("Invalid RAG configuration, textbook search will be disabled")
        except Exception as e:
            logger.error(f"Error initializing RAG: {e}")

def normalize_subject(subject: Optional[str]) -> Optional[str]:
    """Normalize subject name to standard format."""
    if not subject:
        return None
    
    subject_lower = subject.lower().strip()
    return SUBJECT_MAPPINGS.get(subject_lower, subject_lower)

def normalize_grade(grade: Optional[str]) -> Optional[str]:
    """Normalize grade to standard format."""
    if not grade:
        return None
    
    grade_lower = grade.lower().strip()
    return GRADE_MAPPINGS.get(grade_lower, grade)

async def search_textbook_function(question: str, grade: str = None, 
                                  subject: str = None, language: str = "en") -> ActionResponse:
    """Search textbooks for educational content.
    
    Args:
        question: The educational question to search for
        grade: Optional grade level filter
        subject: Optional subject filter
        language: Language for search (default: 'en')
    
    Returns:
        ActionResponse with search results
    """
    ensure_rag_initialized()
    
    integration = get_rag_integration()
    if not integration.is_enabled():
        logger.warning("RAG integration is not enabled")
        return ActionResponse(
            action=Action.RESPONSE,
            response="I'm sorry, but textbook search is currently unavailable. Please try again later."
        )
    
    try:
        # Normalize inputs
        normalized_grade = normalize_grade(grade)
        normalized_subject = normalize_subject(subject)
        
        logger.info(f"Searching textbooks - Question: {question[:50]}..., "
                   f"Grade: {normalized_grade}, Subject: {normalized_subject}, Language: {language}")
        
        # Get available textbook IDs from context (in production, this would query the database)
        # For now, we'll search all available textbooks
        textbook_ids = []  # Will be populated based on grade/subject filters
        
        # Execute RAG search
        parameters = {
            "question": question,
            "textbook_ids": textbook_ids,
            "grade": normalized_grade,
            "subject": normalized_subject,
            "language": language
        }
        
        result = await integration.execute_function("search_textbook", parameters)
        
        if "error" in result:
            logger.error(f"RAG search error: {result['error']}")
            return ActionResponse(
                action=Action.RESPONSE,
                response=result.get("answer", "I couldn't find relevant information for your question.")
            )
        
        # Format response
        answer = result.get("answer", "")
        sources = result.get("sources", [])
        confidence = result.get("confidence", 0)
        
        # Add source attribution if available
        if sources and confidence > 0.7:
            source_info = f"\n\n📚 Sources: Found in {len(sources)} textbook section(s)"
            if sources[0].get("chapter_title"):
                source_info += f" including '{sources[0]['chapter_title']}'"
            answer += source_info
        
        logger.info(f"RAG search completed - Confidence: {confidence}, Sources: {len(sources)}")
        
        # Return response for LLM to process further
        return ActionResponse(
            action=Action.REQLLM,  # Request LLM to generate final response
            result={
                "answer": answer,
                "sources": sources,
                "confidence": confidence
            }
        )
        
    except Exception as e:
        logger.error(f"Error in search_textbook function: {e}")
        return ActionResponse(
            action=Action.RESPONSE,
            response="I encountered an error while searching the textbooks. Please try again."
        )

# Register the function using decorator syntax
@register_function("search_textbook", SEARCH_TEXTBOOK_FUNCTION_DESC, ToolType.WAIT)
async def search_textbook(**kwargs):
    """Wrapper function for async execution."""
    return await search_textbook_function(**kwargs)