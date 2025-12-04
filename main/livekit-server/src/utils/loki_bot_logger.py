"""
Loki Logger Configuration for Media API (Bots)
Configures Python logging with three handlers for music/story bots
"""
import logging
import os
from logging.handlers import RotatingFileHandler
from dotenv import load_dotenv

# Load environment variables
load_dotenv()

def setup_bot_logger():
    """
    Configure and return logger for Media API bots with console, file, and Loki handlers
    """
    # Create logger
    logger = logging.getLogger("media_api")
    logger.setLevel(logging.INFO)
    logger.propagate = False  # Prevent duplicate logs
    
    # Clear any existing handlers
    logger.handlers.clear()
    
    # ================================
    # 1. Console Handler (for terminal/PM2)
    # ================================
    console_handler = logging.StreamHandler()
    console_handler.setLevel(logging.INFO)
    console_formatter = logging.Formatter(
        '[%(levelname)s] %(name)s - %(message)s'
    )
    console_handler.setFormatter(console_formatter)
    logger.addHandler(console_handler)
    
    # ================================
    # 2. Rotating File Handler (local backup)
    # ================================
    try:
        # Create logs directory if it doesn't exist
        log_dir = "logs"
        if not os.path.exists(log_dir):
            os.makedirs(log_dir)
        
        file_handler = RotatingFileHandler(
            filename=os.path.join(log_dir, "media_api.log"),
            maxBytes=20 * 1024 * 1024,  # 20MB
            backupCount=14,  # Keep 14 backup files (2 weeks)
            encoding='utf-8'
        )
        file_handler.setLevel(logging.INFO)
        file_formatter = logging.Formatter(
            '{"timestamp": "%(asctime)s", "level": "%(levelname)s", "name": "%(name)s", "message": "%(message)s"}'
        )
        file_handler.setFormatter(file_formatter)
        logger.addHandler(file_handler)
        
        print(f"✅ [LOGGING] File handler configured: {log_dir}/media_api.log")
    except Exception as e:
        print(f"⚠️ [LOGGING] Failed to configure file handler: {e}")
    
    # ================================
    # 3. Loki Handler (cloud logging - conditional)
    # ================================
    loki_host = os.getenv("LOKI_HOST")
    loki_user = os.getenv("LOKI_USER")
    loki_password = os.getenv("LOKI_PASSWORD")
    
    if loki_host and loki_user and loki_password:
        try:
            from logging_loki import LokiHandler
            
            print("🔧 [LOKI] Initializing Loki handler...")
            
            loki_handler = LokiHandler(
                url=f"{loki_host}/loki/api/v1/push",
                tags={"app": "media-api", "environment": "production"},
                auth=(loki_user, loki_password),
                version="1",
            )
            
            loki_handler.setLevel(logging.INFO)
            logger.addHandler(loki_handler)
            
            print(f"✅ [LOKI] Handler configured. Sending logs to: {loki_host}")
            
        except ImportError:
            print("⚠️ [LOKI] python-logging-loki not installed. Run: pip install python-logging-loki")
        except Exception as e:
            print(f"❌ [LOKI] Failed to configure Loki handler: {e}")
    else:
        print("⚠️ [LOKI] No LOKI_HOST found, skipping Loki handler")
    
    return logger


# Create and export default logger instance
logger = setup_bot_logger()
