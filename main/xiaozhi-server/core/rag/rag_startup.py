"""RAG startup initialization module.

This module handles the initialization of RAG services at server startup,
including PDF processor and background sync tasks.
"""

import asyncio
import os
from config.logger import setup_logging
from config.rag_config import get_rag_config, validate_rag_config
from core.rag.rag_integration import initialize_rag_integration
from core.rag.pdf_processor import initialize_pdf_processor, periodic_sync_task

logger = setup_logging()
TAG = __name__

# Global task reference
_sync_task = None

async def initialize_rag_services(auth_key: str = None):
    """Initialize all RAG-related services at startup."""
    try:
        logger.info("Initializing RAG services...")
        
        # Get RAG configuration
        config = get_rag_config()
        
        # Validate configuration
        if not validate_rag_config(config):
            logger.warning("RAG configuration invalid or incomplete - RAG features will be disabled")
            logger.warning("Please set VOYAGE_API_KEY, QDRANT_URL, and QDRANT_API_KEY in .env file")
            return False
        
        # Initialize RAG integration
        success = initialize_rag_integration(config)
        if not success:
            logger.error("Failed to initialize RAG integration")
            return False
        
        logger.info("RAG integration initialized successfully")
        
        # Initialize PDF processor if manager API URL is configured
        manager_api_url = os.getenv("MANAGER_API_URL", "http://localhost:8080")
        if manager_api_url:
            processor = initialize_pdf_processor(manager_api_url, auth_key)
            logger.info(f"PDF processor initialized with manager-api at {manager_api_url}")
            
            # Start periodic sync task
            sync_interval = int(os.getenv("RAG_SYNC_INTERVAL", "300"))  # Default 5 minutes
            global _sync_task
            _sync_task = asyncio.create_task(periodic_sync_task(processor, sync_interval))
            logger.info(f"Started periodic textbook sync task (interval: {sync_interval}s)")
        else:
            logger.warning("MANAGER_API_URL not configured - PDF sync disabled")
        
        logger.info("✅ RAG services initialization complete")
        return True
        
    except Exception as e:
        logger.error(f"Failed to initialize RAG services: {e}")
        return False

async def shutdown_rag_services():
    """Shutdown RAG services gracefully."""
    global _sync_task
    
    try:
        logger.info("Shutting down RAG services...")
        
        # Cancel sync task if running
        if _sync_task and not _sync_task.done():
            _sync_task.cancel()
            try:
                await _sync_task
            except asyncio.CancelledError:
                pass
            logger.info("Stopped periodic sync task")
        
        logger.info("RAG services shutdown complete")
        
    except Exception as e:
        logger.error(f"Error during RAG services shutdown: {e}")

def check_rag_status() -> dict:
    """Check the status of RAG services."""
    from core.rag.rag_integration import get_rag_integration
    from core.rag.pdf_processor import get_pdf_processor
    
    status = {
        "enabled": False,
        "integration_ready": False,
        "pdf_processor_ready": False,
        "credentials_configured": False,
        "sync_task_running": False
    }
    
    try:
        # Check configuration
        config = get_rag_config()
        status["credentials_configured"] = validate_rag_config(config)
        
        # Check integration
        integration = get_rag_integration()
        if integration:
            status["integration_ready"] = integration.is_enabled()
            status["enabled"] = integration.is_enabled()
        
        # Check PDF processor
        processor = get_pdf_processor()
        status["pdf_processor_ready"] = processor is not None
        
        # Check sync task
        global _sync_task
        status["sync_task_running"] = _sync_task is not None and not _sync_task.done()
        
    except Exception as e:
        logger.error(f"Error checking RAG status: {e}")
    
    return status