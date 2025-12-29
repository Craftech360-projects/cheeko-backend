"""
Music playback function tools for Cheeko AI Assistant
Handles music playback with S3 streaming, favorites playlist, and auto-looping
Extracted from main_agent.py for better modularity
"""

import logging
import json
from typing import Optional, Dict, List
from livekit.agents import function_tool, RunContext

logger = logging.getLogger("music_tools")

# Module-level variables to store context
_assistant_instance = None
_music_service = None
_current_song = None
_playlist_mode = "random"  # "random" or "favorites"
_current_playlist = []
_current_playlist_index = 0


def inject_music_context(assistant, music_service):
    """
    Inject assistant and music service instances
    
    Args:
        assistant: The Assistant instance
        music_service: The MusicService instance
    """
    global _assistant_instance, _music_service
    _assistant_instance = assistant
    _music_service = music_service
    logger.info("🎵 Music context injected into music_tools")


async def get_favorites_playlist() -> List[Dict]:
    """
    Get favorites playlist from backend
    Returns empty list if no favorites exist
    """
    # TODO: Implement favorites playlist API call
    # For now, return empty list (will use random songs)
    return []


async def play_next_in_playlist():
    """
    Internal function to play next song in playlist
    Used for auto-looping
    """
    global _current_playlist_index, _current_playlist, _playlist_mode
    
    if _playlist_mode == "favorites" and _current_playlist:
        # Play next in favorites playlist (loop)
        _current_playlist_index = (_current_playlist_index + 1) % len(_current_playlist)
        next_song = _current_playlist[_current_playlist_index]
        logger.info(f"🎵 Playing next in favorites: {next_song['title']} (#{_current_playlist_index + 1}/{len(_current_playlist)})")
        return next_song
    else:
        # Play random song
        if _music_service:
            song = await _music_service.get_random_song(language=None)
            logger.info(f"🎵 Playing random song: {song['title'] if song else 'None'}")
            return song
        return None


@function_tool
async def play_music(
    context: RunContext,
    song_name: Optional[str] = None,
    language: Optional[str] = None
) -> str:
    """
    Play music - either a specific song, from favorites playlist, or random
    
    Args:
        song_name: Optional specific song to search for
        language: Optional language preference (not used per requirements)
        
    Returns:
        Status message
    """
    global _current_song, _playlist_mode, _current_playlist, _current_playlist_index
    
    logger.info(f"🎵 [MUSIC] play_music called - song: '{song_name}', language: '{language}'")
    
    try:
        if  not _music_service:
            return "Sorry, music service is not available right now."
        
        # Determine which song to play
        song = None
        
        if song_name:
            # Search for specific song
            logger.info(f"🔍 Searching for specific song: {song_name}")
            songs = await _music_service.search_songs(song_name, language=None)
            if songs:
                song = songs[0]
                _playlist_mode = "search"
                logger.info(f"✅ Found song: {song['title']}")
            else:
                logger.warning(f"⚠️ No songs found for '{song_name}', playing random")
                song = await _music_service.get_random_song(language=None)
                _playlist_mode = "random"
        else:
            # Check for favorites playlist
            favorites = await get_favorites_playlist()
            
            if favorites:
                # Play from favorites playlist
                _current_playlist = favorites
                _current_playlist_index = 0
                _playlist_mode = "favorites"
                song = favorites[0]
                logger.info(f"🎵 Playing from favorites playlist: {song['title']} (#{1}/{len(favorites)})")
            else:
                # No favorites, play random
                song = await _music_service.get_random_song(language=None)
                _playlist_mode = "random"
                logger.info(f"🎵 No favorites found, playing random: {song['title'] if song else 'None'}")
        
        if not song:
            return "Sorry, I couldn't find any music to play right now."
        
        # Store current song
        _current_song = song
        
        # Send music start signal to device via data channel
        try:
            music_start_data = {
                "type": "music_playback_started",
                "title": song['title'],
                "language": song.get('language', 'Unknown'),
                "playlist_mode": _playlist_mode,
                "message": f"Now playing: {song['title']}"
            }
            
            room = None
            if hasattr(context, 'room'):
                room = context.room
            
            if room:
                await room.local_participant.publish_data(
                    json.dumps(music_start_data).encode(),
                    topic="music_control"
                )
                logger.info(f"📡 Sent music_playback_started via data channel: {song['title']}")
        except Exception as e:
            logger.warning(f"⚠️ Failed to send music start signal: {e}")
        
        # Actually stream the audio via UnifiedAudioPlayer
        if _assistant_instance and hasattr(_assistant_instance, 'audio_player'):
            player = _assistant_instance.audio_player
            if player and song.get('url'):
                logger.info(f"🎵 Streaming audio via player: {song['title']} from {song['url']}")
                await player.play_from_url(song['url'], song['title'])
                logger.info(f"✅ Started streaming: {song['title']}")
            else:
                logger.error(f"❌ Cannot stream - player: {player}, url: {song.get('url')}")
                return f"Found '{song['title']}' but couldn't play it."
        else:
            logger.error(f"❌ Audio player not available - assistant: {_assistant_instance}")
            return f"Found '{song['title']}' but audio player is not available."

        # Return special instruction to suppress agent response
        return "[MUSIC_PLAYING - STAY_SILENT]"
    
    except Exception as e:
        logger.error(f"❌ Error playing music: {e}")
        import traceback
        logger.error(f"Traceback: {traceback.format_exc()}")
        return "Sorry, I encountered an error while trying to play music."


@function_tool
async def stop_music(context: RunContext) -> str:
    """
    Stop current music playback
    
    Returns:
        Status message
    """
    global _current_song, _playlist_mode
    
    logger.info("🛑 [MUSIC] stop_music called")
    
    try:
        if _current_song:
            logger.info(f"🛑 Stopping music: {_current_song.get('title', 'Unknown')}")
            _current_song = None
            _playlist_mode = "random"
            
            # Send stop signal to device
            try:
                stop_data = {
                    "type": "music_playback_stopped",
                    "message": "Music stopped"
                }
                
                room = None
                if hasattr(context, 'room'):
                    room = context.room
                
                if room:
                    await room.local_participant.publish_data(
                        json.dumps(stop_data).encode(),
                        topic="music_control"
                    )
                    logger.info("📡 Sent music_playback_stopped via data channel")
            except Exception as e:
                logger.warning(f"⚠️ Failed to send stop signal: {e}")
            
            return "Music stopped"
        else:
            return "No music is currently playing"
    
    except Exception as e:
        logger.error(f"❌ Error stopping music: {e}")
        return "Sorry, I encountered an error while trying to stop music."


@function_tool
async def next_song(context: RunContext) -> str:
    """
    Skip to next song in playlist or play random song
    
    Returns:
        Status message
    """
    logger.info("⏭️ [MUSIC] next_song called")
    
    try:
        song = await play_next_in_playlist()
        
        if song:
            global _current_song
            _current_song = song
            
            # Send next song signal
            try:
                next_data = {
                    "type": "music_next",
                    "title": song['title'],
                    "message": f"Next: {song['title']}"
                }
                
                room = None
                if hasattr(context, 'room'):
                    room = context.room
                
                if room:
                    await room.local_participant.publish_data(
                        json.dumps(next_data).encode(),
                        topic="music_control"
                    )
                    logger.info(f"📡 Sent music_next via data channel: {song['title']}")
            except Exception as e:
                logger.warning(f"⚠️ Failed to send next signal: {e}")
            
            return f"Playing next: {song['title']}"
        else:
            return "No more songs available"
    
    except Exception as e:
        logger.error(f"❌ Error playing next song: {e}")
        return "Sorry, I encountered an error."


@function_tool
async def previous_song(context: RunContext) -> str:
    """
    Play previous song in playlist
    
    Returns:
        Status message
    """
    global _current_playlist_index, _current_playlist, _playlist_mode
    
    logger.info("⏮️ [MUSIC] previous_song called")
    
    try:
        if _playlist_mode == "favorites" and _current_playlist:
            # Go to previous in favorites playlist
            _current_playlist_index = (_current_playlist_index - 1) % len(_current_playlist)
            prev_song = _current_playlist[_current_playlist_index]
            
            global _current_song
            _current_song = prev_song
            
            logger.info(f"⏮️ Playing previous in favorites: {prev_song['title']} (#{_current_playlist_index + 1}/{len(_current_playlist)})")
            
            # Send previous song signal
            try:
                prev_data = {
                    "type": "music_previous",
                    "title": prev_song['title'],
                    "message": f"Previous: {prev_song['title']}"
                }
                
                room = None
                if hasattr(context, 'room'):
                    room = context.room
                
                if room:
                    await room.local_participant.publish_data(
                        json.dumps(prev_data).encode(),
                        topic="music_control"
                    )
                    logger.info(f"📡 Sent music_previous via data channel: {prev_song['title']}")
            except Exception as e:
                logger.warning(f"⚠️ Failed to send previous signal: {e}")
            
            return f"Playing previous: {prev_song['title']}"
        else:
            return "Previous song not available in random mode"
    
    except Exception as e:
        logger.error(f"❌ Error playing previous song: {e}")
        return "Sorry, I encountered an error."


async def start_music_mode():
    """
    Start Music Mode - auto-play first song
    Called when device switches to Music Mode
    """
    logger.info("🎵 [MUSIC MODE] Starting Music Mode with auto-play")
    
    try:
        # Check for favorites playlist
        favorites = await get_favorites_playlist()
        
        global _current_playlist, _current_playlist_index, _playlist_mode, _current_song
        
        if favorites:
            # Play from favorites
            _current_playlist = favorites
            _current_playlist_index = 0
            _playlist_mode = "favorites"
            song = favorites[0]
            logger.info(f"🎵 Auto-playing from favorites: {song['title']} (#{1}/{len(favorites)})")
        else:
            # Play random song
            if _music_service:
                song = await _music_service.get_random_song(language=None)
                _playlist_mode = "random"
                logger.info(f"🎵 Auto-playing random song: {song['title'] if song else 'None'}")
            else:
                logger.error("❌ Music service not available")
                return None
        
        if song:
            _current_song = song
            
            # CRITICAL: Actually stream the audio via UnifiedAudioPlayer
            if _assistant_instance and hasattr(_assistant_instance, 'audio_player'):
                player = _assistant_instance.audio_player
                logger.info(f"🎵 Streaming audio via player: {song['title']} from {song['url']}")
                await player.play_from_url(song['url'], song['title'])
                logger.info(f"✅ Started streaming: {song['title']}")
            else:
                logger.error("❌ Audio player not available")
                
            return song
        
        return None
    
    except Exception as e:
        logger.error(f"❌ Error starting Music Mode: {e}")
        import traceback
        logger.error(f"Traceback: {traceback.format_exc()}")
        return None


async def stop_music_mode():
    """
    Stop Music Mode - immediately stop all music
    Called when switching from Music to Conversation Mode
    """
    global _current_song, _playlist_mode, _current_playlist
    
    logger.info("🛑 [MUSIC MODE] Stopping Music Mode")
    
    _current_song = None
    _playlist_mode = "random"
    _current_playlist = []
    
    logger.info("✅ Music Mode stopped")


def get_current_song() -> Optional[Dict]:
    """Get currently playing song"""
    return _current_song
