import logging
import aiohttp
import asyncio
from typing import Optional
import yaml
import os
from pathlib import Path

logger = logging.getLogger("prompt_service")

class PromptService:
    """Service for fetching agent prompts from API or config file"""

    def __init__(self):
        self.config = None
        self.prompt_cache = {}
        self.cache_timeout = 300  # 5 minutes cache
        self.last_cache_time = 0

        # New: Template-based prompt system
        self.prompt_manager = None
        self.db_helper = None
        self.enhanced_prompt_cache = {}  # Cache for fully rendered prompts
        self.enhanced_cache_timeout = 300  # 5 minutes cache

    def load_config(self):
        """Load configuration from config.yaml"""
        if self.config is None:
            config_path = Path(__file__).parent.parent.parent / "config.yaml"
            try:
                with open(config_path, 'r', encoding='utf-8') as file:
                    self.config = yaml.safe_load(file)
                logger.info(f"Loaded configuration from {config_path}")
            except Exception as e:
                logger.error(f"Failed to load config: {e}")
                raise
        return self.config

    def get_default_prompt(self) -> str:
        """Get default prompt from config.yaml"""
        config = self.load_config()
        default_prompt = config.get('default_prompt', '')
        if not default_prompt:
            logger.warning("No default_prompt found in config.yaml")
            # Fallback to a basic prompt
            return "You are a helpful AI assistant."
        return default_prompt.strip()

    def should_read_from_api(self) -> bool:
        """Check if we should read prompt from API based on config"""
        config = self.load_config()
        return config.get('read_config_from_api', False)

    async def fetch_prompt_from_api(self, mac_address: str) -> Optional[str]:
        """Fetch prompt from manager API using device MAC address"""
        try:
            config = self.load_config()
            manager_api = config.get('manager_api', {})

            if not manager_api:
                logger.error("Manager API configuration not found")
                return None

            base_url = manager_api.get('url', '')
            secret = manager_api.get('secret', '')
            timeout = manager_api.get('timeout', 5)

            if not base_url or not secret:
                logger.error("Manager API URL or secret not configured")
                return None

            # Keep MAC address format as-is (database stores with colons)
            clean_mac = mac_address.lower()

            # API endpoint to get prompt by MAC address (using config endpoint)
            url = f"{base_url}/config/agent-prompt"

            headers = {
                'Content-Type': 'application/json',
                'Authorization': f'Bearer {secret}'  # Server secret authentication
            }

            # Request payload with MAC address
            payload = {
                'macAddress': clean_mac
            }

            async with aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=timeout)) as session:
                async with session.post(url, json=payload, headers=headers) as response:
                    if response.status == 200:
                        data = await response.json()

                        # Response format: {"code": 0, "data": "prompt_text"}
                        # or sometimes:  {"code": 0, "data": {"prompt": "...", ...}}
                        if data.get('code') == 0 and 'data' in data:
                            prompt = data['data']
                            # Handle dict response — extract the prompt string
                            if isinstance(prompt, dict):
                                prompt = prompt.get('prompt') or prompt.get('systemPrompt') or prompt.get('content', '')
                                logger.info(f"Extracted prompt from dict response for MAC: {mac_address}")
                            if prompt and isinstance(prompt, str) and prompt.strip():
                                logger.info(f"Successfully fetched prompt from API for MAC: {mac_address}")
                                return prompt.strip()
                            else:
                                logger.warning(f"Empty prompt received from API for MAC: {mac_address}")
                                return None
                        else:
                            logger.warning(f"API returned error: {data}")
                            return None
                    else:
                        logger.warning(f"API request failed with status {response.status} for MAC: {mac_address}")
                        return None

        except asyncio.TimeoutError:
            logger.error(f"Timeout fetching prompt from API for MAC: {mac_address}")
            return None
        except Exception as e:
            logger.error(f"Error fetching prompt from API for MAC {mac_address}: {e}")
            return None

    def extract_mac_from_participant_identity(self, participant_identity: str) -> Optional[str]:
        """Extract MAC address from participant identity"""
        try:
            # Participant identity might be the MAC address directly
            if not participant_identity:
                return None

            # Remove common separators and check if it's a valid MAC
            clean_identity = participant_identity.replace(':', '').replace('-', '').lower()

            # Check if it's a 12-character hex string (MAC address)
            if len(clean_identity) == 12 and all(c in '0123456789abcdef' for c in clean_identity):
                # Format as MAC address with colons
                mac = ':'.join(clean_identity[i:i+2] for i in range(0, 12, 2))
                logger.info(f"Extracted MAC from participant identity: {participant_identity} -> {mac}")
                return mac

            # Try with existing colons (already formatted MAC)
            if len(participant_identity) == 17 and participant_identity.count(':') == 5:
                # Validate MAC format
                parts = participant_identity.split(':')
                if len(parts) == 6 and all(len(part) == 2 and all(c in '0123456789abcdefABCDEF' for c in part) for part in parts):
                    mac = participant_identity.lower()
                    logger.info(f"Validated MAC from participant identity: {mac}")
                    return mac

            return None
        except Exception as e:
            logger.error(f"Error extracting MAC from participant identity '{participant_identity}': {e}")
            return None

    def extract_mac_from_room_name(self, room_name: str) -> Optional[str]:
        """Extract MAC address from room name format"""
        try:
            # New format: UUID_mac_MACADDRESS (from MQTT gateway)
            if '_mac_' in room_name:
                parts = room_name.split('_mac_')
                if len(parts) >= 2:
                    mac_part = parts[-1]  # Get the MAC part after '_mac_'
                    # Validate MAC address format (12 hex characters)
                    if len(mac_part) == 12 and all(c in '0123456789abcdefABCDEF' for c in mac_part):
                        # Format as MAC address with colons
                        mac = ':'.join(mac_part[i:i+2] for i in range(0, 12, 2)).lower()
                        logger.info(f"Extracted MAC from room name with _mac_ format: {room_name} -> {mac}")
                        return mac

            # Legacy format: device_<mac_address>
            if room_name.startswith('device_'):
                mac_part = room_name.replace('device_', '')
                # Validate MAC address format (12 hex characters)
                if len(mac_part) == 12 and all(c in '0123456789abcdefABCDEF' for c in mac_part):
                    # Format as MAC address with colons
                    mac = ':'.join(mac_part[i:i+2] for i in range(0, 12, 2)).lower()
                    logger.info(f"Extracted MAC from device_ format: {room_name} -> {mac}")
                    return mac

            # Alternative: room name might be the MAC address directly
            clean_name = room_name.replace(':', '').replace('-', '')
            if len(clean_name) == 12 and all(c in '0123456789abcdefABCDEF' for c in clean_name):
                mac = ':'.join(clean_name[i:i+2] for i in range(0, 12, 2)).lower()
                logger.info(f"Extracted MAC from direct format: {room_name} -> {mac}")
                return mac

            logger.warning(f"Could not extract MAC from room name: {room_name}")
            return None
        except Exception as e:
            logger.error(f"Error extracting MAC from room name '{room_name}': {e}")
            return None

    def is_cache_valid(self, mac_address: str) -> bool:
        """Check if cached prompt is still valid"""
        import time
        if mac_address not in self.prompt_cache:
            return False

        cache_entry = self.prompt_cache[mac_address]
        return (time.time() - cache_entry['timestamp']) < self.cache_timeout

    def cache_prompt(self, mac_address: str, prompt: str):
        """Cache prompt for given MAC address"""
        import time
        self.prompt_cache[mac_address] = {
            'prompt': prompt,
            'timestamp': time.time()
        }

    def get_cached_prompt(self, mac_address: str) -> Optional[str]:
        """Get cached prompt if valid"""
        if self.is_cache_valid(mac_address):
            return self.prompt_cache[mac_address]['prompt']
        return None

    async def get_prompt(self, room_name: str, participant_identity: str = None) -> str:
        """
        Get prompt for the agent based on room name/participant identity and configuration.

        Args:
            room_name: LiveKit room name (used to extract device MAC)
            participant_identity: Participant identity (may contain MAC address)

        Returns:
            Agent prompt string
        """
        try:
            # If not reading from API, return default prompt
            if not self.should_read_from_api():
                logger.info("Using default prompt from config (read_config_from_api=false)")
                return self.get_default_prompt()

            # Extract MAC address from room name or participant identity
            mac_address = None

            # Try participant identity first (more reliable)
            if participant_identity:
                mac_address = self.extract_mac_from_participant_identity(participant_identity)

            # Fallback to room name extraction
            if not mac_address:
                mac_address = self.extract_mac_from_room_name(room_name)

            if not mac_address:
                logger.warning(f"Could not extract MAC address from room name: {room_name} or participant: {participant_identity}")
                logger.info("Falling back to default prompt")
                return self.get_default_prompt()

            # Check cache first
            cached_prompt = self.get_cached_prompt(mac_address)
            if cached_prompt:
                logger.info(f"Using cached prompt for MAC: {mac_address}")
                return cached_prompt

            # Fetch from API
            logger.info(f"Fetching prompt from API for MAC: {mac_address}")
            api_prompt = await self.fetch_prompt_from_api(mac_address)

            if api_prompt:
                # Cache the result
                self.cache_prompt(mac_address, api_prompt)
                return api_prompt
            else:
                logger.warning(f"Failed to fetch prompt from API for MAC: {mac_address}")
                logger.info("Falling back to default prompt")
                return self.get_default_prompt()

        except Exception as e:
            logger.error(f"Error in get_prompt: {e}")
            logger.info("Falling back to default prompt")
            return self.get_default_prompt()

    def clear_cache(self):
        """Clear prompt cache"""
        self.prompt_cache.clear()
        logger.info("Prompt cache cleared")

    async def fetch_model_config_from_api(self, mac_address: str, room_name: str) -> Optional[dict]:
        """
        Fetch model configuration from Manager API

        Args:
            mac_address: Device MAC address
            room_name: LiveKit room name (used as clientId)

        Returns:
            Dict containing model configurations (TTS, STT, LLM, etc.)
        """
        try:
            config = self.load_config()
            manager_api = config.get('manager_api', {})

            if not manager_api:
                logger.error("Manager API configuration not found")
                return None

            base_url = manager_api.get('url', '')
            secret = manager_api.get('secret', '')
            timeout = manager_api.get('timeout', 5)

            if not base_url or not secret:
                logger.error("Manager API URL or secret not configured")
                return None

            # API endpoint to get agent models
            url = f"{base_url}/config/agent-models"

            headers = {
                'Content-Type': 'application/json',
                'Authorization': f'Bearer {secret}'
            }

            # Request payload with MAC address, clientId, and empty selectedModule
            payload = {
                'macAddress': mac_address.lower(),
                'clientId': room_name,  # Use room name as client ID
                'selectedModule': {}  # Empty to get all models
            }

            async with aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=timeout)) as session:
                async with session.post(url, json=payload, headers=headers) as response:
                    if response.status == 200:
                        data = await response.json()

                        if data.get('code') == 0 and 'data' in data:
                            model_config = data['data']
                            logger.info(f"✅ Successfully fetched model config from API for MAC: {mac_address}")
                            # DEBUG: Log response structure
                            logger.info(f"🔍 DEBUG - Response keys: {list(model_config.keys())}")
                            if 'selected_module' in model_config:
                                logger.info(f"🔍 DEBUG - selected_module: {model_config['selected_module']}")
                            if 'TTS' in model_config:
                                logger.info(f"🔍 DEBUG - TTS keys: {list(model_config['TTS'].keys())}")
                            else:
                                logger.warning(f"🔍 DEBUG - TTS key NOT FOUND in response!")
                            return model_config
                        else:
                            logger.warning(f"API returned error: {data}")
                            return None
                    else:
                        error_text = await response.text()
                        logger.warning(f"Model config API failed: {response.status} - {error_text}")
                        return None

        except Exception as e:
            logger.error(f"Error fetching model config for MAC {mac_address}: {e}")
            import traceback
            logger.debug(traceback.format_exc())
            return None

    def extract_tts_config(self, model_config: dict) -> Optional[dict]:
        """
        Extract TTS configuration from model config API response

        Args:
            model_config: Full model configuration from API

        Returns:
            Dict with TTS provider and settings
        """
        try:
            if not model_config or 'TTS' not in model_config:
                logger.warning("No TTS configuration in model config")
                return None

            tts_models = model_config.get('TTS', {})
            selected_module = model_config.get('selected_module', {})
            selected_tts_id = selected_module.get('TTS')

            if not selected_tts_id or selected_tts_id not in tts_models:
                logger.warning(f"Selected TTS model '{selected_tts_id}' not found in TTS models")
                return None

            tts_config = tts_models[selected_tts_id]
            tts_type = tts_config.get('type', '')

            logger.info(f"🎤 TTS Config from DB - Type: {tts_type}, Config: {tts_config}")

            result = {'type': tts_type, 'model_id': selected_tts_id}

            # Map database TTS types to provider names
            if tts_type == 'edge_tts' or tts_type == 'edge':
                result['provider'] = 'edge'
                result['voice'] = tts_config.get('voice', 'en-US-AnaNeural')
                result['rate'] = tts_config.get('rate', '+0%')
                result['volume'] = tts_config.get('volume', '+0%')
                result['pitch'] = tts_config.get('pitch', '+0Hz')

            elif tts_type == 'elevenlabs':
                result['provider'] = 'elevenlabs'
                result['voice_id'] = tts_config.get('voice_id', '')
                result['model'] = tts_config.get('model', 'eleven_turbo_v2_5')

            elif tts_type == 'openai_tts':
                result['provider'] = 'openai'
                result['voice'] = tts_config.get('voice', 'alloy')
                result['model'] = tts_config.get('model', 'tts-1')

            elif tts_type == 'groq_tts':
                result['provider'] = 'groq'
                result['model'] = tts_config.get('model', 'playai-tts')
                result['voice'] = tts_config.get('voice', 'Aaliyah-PlayAI')

            elif tts_type == 'groq arabic':
                result['provider'] = 'groq'
                result['model'] = tts_config.get('model', 'playai-tts-arabic')
                # Check for both 'voice' and 'private_voice' keys
                result['voice'] = tts_config.get('voice') or tts_config.get('private_voice', 'Nasser-PlayAI')

            else:
                logger.warning(f"Unknown TTS type: {tts_type}")
                return None

            logger.info(f"✅ Extracted TTS - Provider: {result['provider']}")
            return result

        except Exception as e:
            logger.error(f"Error extracting TTS config: {e}")
            import traceback
            logger.debug(traceback.format_exc())
            return None

    async def get_prompt_and_config(self, room_name: str, mac_address: str) -> tuple:
        """
        Get both prompt and model configuration in one call

        Args:
            room_name: LiveKit room name
            mac_address: Device MAC address

        Returns:
            Tuple of (prompt_string, tts_config_dict)
        """
        import time
        import re
        from jinja2 import Template

        if not self.should_read_from_api():
            return self.get_default_prompt(), None

        # DISABLED CACHE - Always fetch fresh prompt from API
        # This ensures we always get the latest prompt without stale data
        cache_key = mac_address
        logger.info(f"🔄 Fetching fresh prompt from API (cache disabled)")

        # Fetch prompt
        prompt = await self.fetch_prompt_from_api(mac_address)
        if not prompt:
            prompt = self.get_default_prompt()

        # Fetch model config (including TTS)
        model_config = await self.fetch_model_config_from_api(mac_address, room_name)
        tts_config = None

        if model_config:
            tts_config = self.extract_tts_config(model_config)

        # Cache both
        self.prompt_cache[cache_key] = {
            'prompt': prompt,
            'tts_config': tts_config,
            'timestamp': time.time()
        }

        return prompt, tts_config

    async def initialize_template_system(self):
        """
        Initialize template-based prompt system
        Call this during application startup
        """
        try:
            config = self.load_config()
            manager_api = config.get('manager_api', {})

            if not manager_api:
                logger.warning("Manager API not configured, template system disabled")
                return

            base_url = manager_api.get('url', '')
            secret = manager_api.get('secret', '')

            if not base_url or not secret:
                logger.warning("Manager API URL or secret missing, template system disabled")
                return

            # Initialize DatabaseHelper
            from src.utils.database_helper import DatabaseHelper
            self.db_helper = DatabaseHelper(base_url, secret)

            # Initialize PromptManager
            from src.utils.prompt_manager import PromptManager
            self.prompt_manager = PromptManager(self.db_helper, config)

            logger.info("✅ Template-based prompt system initialized successfully")

        except Exception as e:
            logger.error(f"Failed to initialize template system: {e}")
            import traceback
            logger.debug(traceback.format_exc())

    async def get_enhanced_prompt(
        self,
        room_name: str,
        device_mac: str,
        child_profile: dict = None,
        use_template_system: bool = True
    ) -> str:
        """
        Get fully enhanced prompt with template-based system

        Args:
            room_name: LiveKit room name
            device_mac: Device MAC address
            child_profile: Optional child profile data for personalization
            use_template_system: Whether to use template system (default True)

        Returns:
            str: Fully rendered prompt
        """
        import time

        # If template system not initialized or disabled, fallback to old method
        if not use_template_system or self.prompt_manager is None:
            logger.info("Template system disabled, using legacy prompt method")
            return await self.get_prompt(room_name, device_mac)

        try:
            # Check cache first
            cache_key = f"{device_mac}_enhanced"
            if cache_key in self.enhanced_prompt_cache:
                cached = self.enhanced_prompt_cache[cache_key]
                if (time.time() - cached['timestamp']) < self.enhanced_cache_timeout:
                    logger.debug(f"📦 Using cached enhanced prompt for MAC: {device_mac}")
                    return cached['prompt']

            # Step 1: Get template_id from database
            template_id = await self.db_helper.get_agent_template_id(device_mac)

            if not template_id:
                logger.warning(f"No template_id found for MAC: {device_mac}, falling back to legacy")
                return await self.get_prompt(room_name, device_mac)

            # Step 2: Build enhanced prompt using PromptManager (with child profile)
            enhanced_prompt = await self.prompt_manager.build_enhanced_prompt(
                template_id=template_id,
                device_mac=device_mac,
                child_profile=child_profile
            )

            # Cache the result
            self.enhanced_prompt_cache[cache_key] = {
                'prompt': enhanced_prompt,
                'timestamp': time.time()
            }

            logger.info(f"✅ Generated enhanced prompt for MAC: {device_mac} (template_id: {template_id})")
            return enhanced_prompt

        except Exception as e:
            logger.error(f"Error getting enhanced prompt: {e}")
            import traceback
            logger.debug(traceback.format_exc())

            # Fallback to legacy method
            logger.info("Falling back to legacy prompt method due to error")
            return await self.get_prompt(room_name, device_mac)

    def clear_enhanced_cache(self, device_mac: str = None):
        """
        Clear enhanced prompt cache

        Args:
            device_mac: Optionally clear cache for specific device
        """
        if device_mac:
            cache_key = f"{device_mac}_enhanced"
            self.enhanced_prompt_cache.pop(cache_key, None)
            logger.info(f"🗑️ Cleared enhanced prompt cache for MAC: {device_mac}")

            # Also clear PromptManager caches for this device
            if self.prompt_manager:
                self.prompt_manager.clear_location_cache(device_mac)

        else:
            self.enhanced_prompt_cache.clear()
            logger.info("🗑️ Cleared all enhanced prompt caches")

            # Also clear all PromptManager caches
            if self.prompt_manager:
                self.prompt_manager.clear_caches()

    def is_template_system_enabled(self) -> bool:
        """Check if template system is enabled and initialized"""
        return self.prompt_manager is not None and self.db_helper is not None