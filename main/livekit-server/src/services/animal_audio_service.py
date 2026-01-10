"""
Animal Audio Service
Manages animal sound audio files for playback
"""

import os
import asyncio
import aiohttp
from pathlib import Path
from src.utils.loki_agent_logger import logger


class AnimalAudioService:
    """Service to manage animal sound audio files from local storage"""
    
    def __init__(self, sounds_directory: str = None):
        """
        Initialize the animal audio service
        
        Args:
            sounds_directory: Directory where animal sound MP3 files are stored
                            Default: src/assets/animal_sounds/
        """
        if sounds_directory:
            self.sounds_dir = Path(sounds_directory)
        else:
            # Default to src/assets/animal_sounds/ relative to this file
            base_dir = Path(__file__).parent.parent
            self.sounds_dir = base_dir / "assets" / "animal_sounds"
        
        # Create directory if it doesn't exist
        self.sounds_dir.mkdir(parents=True, exist_ok=True)
        logger.info(f"🐾 [ANIMAL-AUDIO] Sounds directory: {self.sounds_dir}")
    
    def get_animal_sound_path(self, audio_filename: str) -> str:
        """
        Get local path to animal sound file
        
        Args:
            audio_filename: Filename of the MP3 file (e.g., "cow.mp3" or just "cow")
        
        Returns:
            Absolute path to the audio file, or None if not found
        """
        try:
            # Add .mp3 extension if not present
            if not audio_filename.endswith('.mp3'):
                audio_filename = f"{audio_filename}.mp3"
            
            sound_path = self.sounds_dir / audio_filename
            
            if sound_path.exists():
                logger.info(f"✅ [ANIMAL-AUDIO] Found sound file: {sound_path}")
                return str(sound_path)
            else:
                logger.warning(f"⚠️ [ANIMAL-AUDIO] Sound file not found: {sound_path}")
                return None
        
        except Exception as e:
            logger.error(f"❌ [ANIMAL-AUDIO] Error getting sound path: {e}")
            return None
    
    def list_available_sounds(self) -> list:
        """
        List all available animal sound files
        
        Returns:
            List of available MP3 filenames
        """
        try:
            mp3_files = list(self.sounds_dir.glob("*.mp3"))
            logger.info(f"🐾 [ANIMAL-AUDIO] Found {len(mp3_files)} sound files")
            return [f.name for f in mp3_files]
        except Exception as e:
            logger.error(f"❌ [ANIMAL-AUDIO] Error listing sounds: {e}")
            return []
    
    def validate_sounds_directory(self) -> bool:
        """
        Validate that the sounds directory exists and contains MP3 files
        
        Returns:
            True if directory is valid and has MP3 files
        """
        if not self.sounds_dir.exists():
            logger.warning(f"⚠️ [ANIMAL-AUDIO] Sounds directory does not exist: {self.sounds_dir}")
            return False
        
        mp3_files = list(self.sounds_dir.glob("*.mp3"))
        if len(mp3_files) == 0:
            logger.warning(f"⚠️ [ANIMAL-AUDIO] No MP3 files found in: {self.sounds_dir}")
            return False
        
        logger.info(f"✅ [ANIMAL-AUDIO] Directory valid with {len(mp3_files)} MP3 files")
        return True
