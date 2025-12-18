"""
Mode change event handler for Music Mode auto-play
Handles firmware mode-change messages and triggers appropriate actions
"""

import logging
import json
from typing import Optional

logger = logging.getLogger("mode_change_handler")

# Global references
_assistant_instance = None
_music_service = None


def inject_context(assistant, music_service):
    """Inject context for mode change handling"""
    global _assistant_instance, _music_service
    _assistant_instance = assistant
    _music_service = music_service
    logger.info("🔄 Mode change handler context injected")


async def handle_mode_change(mode_name: str, room=None):
    """
    Handle device mode change event
    
    Args:
        mode_name: New mode name ("Music" or "Cheeko")
        room: LiveKit room for data channel communication
        
    Actions:
        - Music Mode: Auto-start music playback
        - Conversation Mode: Stop music immediately
    """
    logger.info(f"🔄 [MODE CHANGE] Handling mode change to: {mode_name}")
    
    try:
        if mode_name == "Music":
            # Start Music Mode - auto-play first song
            logger.info("🎵 Entering Music Mode - starting auto-play")
            
            from src.features.music_tools import start_music_mode
            song = await start_music_mode()
            
            if song:
                logger.info(f"✅ Auto-playing: {song['title']}")
                
                # Send music start signal to device
                if room:
                    try:
                        music_data = {
                            "type": "music_mode_started",
                            "title": song['title'],
                            "url": song['url'],
                            "message": f"Music Mode started: {song['title']}"
                        }
                        await room.local_participant.publish_data(
                            json.dumps(music_data).encode(),
                            topic="mode_change"
                        )
                        logger.info("📡 Sent music_mode_started signal")
                    except Exception as e:
                        logger.warning(f"⚠️ Failed to send mode start signal: {e}")
            else:
                logger.error("❌ No song available for auto-play")
        
        elif mode_name in ["Cheeko", "Conversation"]:
            # Stop Music Mode - immediately stop playback
            logger.info("🛑 Entering Conversation Mode - stopping music")
            
            from src.features.music_tools import stop_music_mode
            await stop_music_mode()
            
            # Send mode stop signal
            if room:
                try:
                    stop_data = {
                        "type": "music_mode_stopped",
                        "message": "Switched to Conversation Mode"
                    }
                    await room.local_participant.publish_data(
                        json.dumps(stop_data).encode(),
                        topic="mode_change"
                    )
                    logger.info("📡 Sent music_mode_stopped signal")
                except Exception as e:
                    logger.warning(f"⚠️ Failed to send mode stop signal: {e}")
            
            logger.info("✅ Music Mode stopped, Conversation Mode active")
        
        else:
            logger.warning(f"⚠️ Unknown mode: {mode_name}")
    
    except Exception as e:
        logger.error(f"❌ Error handling mode change: {e}")
        import traceback
        logger.error(f"Traceback: {traceback.format_exc()}")
