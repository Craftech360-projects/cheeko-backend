"""
Utils module initialization

Note: Model preloading is now done explicitly in prewarm() functions
to avoid double-loading in dev mode (watcher + worker processes).
"""

import os
import logging

logger = logging.getLogger(__name__)


def start_preloading():
    """
    Start model preloading - call this from prewarm() in workers.
    This avoids double-loading in dev mode where both watcher and worker import this module.
    """
    try:
        auto_preload = os.getenv("AUTO_PRELOAD_MODELS", "true").lower() == "true"
        if auto_preload:
            from .model_preloader import model_preloader
            if not model_preloader.is_running and not model_preloader.is_ready():
                model_preloader.start_background_loading()
                logger.info("[PRELOAD] Started model preloading")
    except Exception as e:
        logger.warning(f"Model preloading failed: {e}")