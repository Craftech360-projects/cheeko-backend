import logging
import aiohttp
import asyncio
from typing import Optional

logger = logging.getLogger("database_helper")

class DatabaseHelper:
    """Helper class for database-related operations via Manager API"""

    def __init__(self, manager_api_url: str, secret: str):
        """
        Initialize database helper

        Args:
            manager_api_url: Base URL of Manager API
            secret: API authentication secret
        """
        self.manager_api_url = manager_api_url.rstrip('/')
        self.secret = secret
        self.retry_attempts = 3

    def _normalize_mac_address(self, mac_address: str) -> str:
        """
        Normalize MAC address by removing colons/dashes and converting to lowercase
        This matches the normalization used in the Java device controller methods
        
        Args:
            mac_address: Original MAC address (e.g., "68:25:dd:bb:f3:a0")
            
        Returns:
            str: Normalized MAC address (e.g., "6825ddbbf3a0")
        """
        return mac_address.replace(":", "").replace("-", "").lower()

    async def get_agent_id(self, device_mac: str) -> Optional[str]:
        """
        Get agent_id from database using device MAC address

        Args:
            device_mac: Device MAC address

        Returns:
            str: Agent ID if found, None if not found or on error
        """
        # Normalize MAC address to match Java controller expectations
        normalized_mac = self._normalize_mac_address(device_mac)
        logger.info(f"🔍 [DB HELPER] get_agent_id - MAC: {device_mac} -> normalized: {normalized_mac}")
        
        url = f"{self.manager_api_url}/agent/device/{normalized_mac}/agent-id"
        headers = {
            "Authorization": f"Bearer {self.secret}",
            "Content-Type": "application/json"
        }

        for attempt in range(self.retry_attempts):
            try:
                timeout = aiohttp.ClientTimeout(total=10)
                async with aiohttp.ClientSession(timeout=timeout) as session:
                    async with session.get(url, headers=headers) as response:
                        if response.status == 200:
                            data = await response.json()
                            # Check for Result<String> format: {code: 0, data: "agent_id"}
                            if data.get('code') == 0 and data.get('data'):
                                agent_id = data.get('data')
                                logger.info(f"🆔✅ Retrieved agent_id: {agent_id} for MAC: {device_mac} (normalized: {normalized_mac})")
                                return str(agent_id)
                            # Fallback to direct fields
                            agent_id = data.get('agentId') or data.get('agent_id')
                            if agent_id:
                                logger.info(f"🆔✅ Retrieved agent_id: {agent_id} for MAC: {device_mac} (normalized: {normalized_mac})")
                                return str(agent_id)
                            else:
                                logger.warning(f"🆔⚠️ No agent_id found in response for MAC: {device_mac} (normalized: {normalized_mac}). Response: {data}")
                                return None
                        elif response.status == 404:
                            logger.warning(f"No agent found for MAC: {device_mac} (normalized: {normalized_mac})")
                            return None
                        else:
                            error_text = await response.text()
                            logger.warning(f"API request failed: {response.status} - {error_text}")

                            # Don't retry client errors (4xx)
                            if 400 <= response.status < 500:
                                logger.error(f"Client error, not retrying: {response.status}")
                                return None

            except asyncio.TimeoutError:
                logger.warning(f"API request timeout (attempt {attempt + 1}/{self.retry_attempts})")
            except aiohttp.ClientError as e:
                logger.warning(f"API client error (attempt {attempt + 1}/{self.retry_attempts}): {e}")
            except Exception as e:
                logger.error(f"Unexpected error getting agent_id (attempt {attempt + 1}/{self.retry_attempts}): {e}")

            # Wait before retry with exponential backoff
            if attempt < self.retry_attempts - 1:
                wait_time = 2 ** attempt  # 1s, 2s, 4s
                await asyncio.sleep(wait_time)

        logger.error(f"Failed to get agent_id after {self.retry_attempts} attempts for MAC: {device_mac} (normalized: {normalized_mac})")
        return None

    async def get_current_character(self, device_mac: str) -> Optional[str]:
        """
        Get current character/mode name from database using device MAC address

        Args:
            device_mac: Device MAC address

        Returns:
            str: Character name (e.g., "Cheeko", "Math", "Story", etc.) if found, "Conversation" as default
        """
        # Normalize MAC address
        normalized_mac = self._normalize_mac_address(device_mac)
        logger.info(f"🔍 [DB HELPER] get_current_character - MAC: {device_mac} -> normalized: {normalized_mac}")

        url = f"{self.manager_api_url}/agent/device/{normalized_mac}/current-character"
        headers = {
            "Authorization": f"Bearer {self.secret}",
            "Content-Type": "application/json"
        }

        for attempt in range(self.retry_attempts):
            try:
                timeout = aiohttp.ClientTimeout(total=10)
                async with aiohttp.ClientSession(timeout=timeout) as session:
                    async with session.get(url, headers=headers) as response:
                        if response.status == 200:
                            data = await response.json()
                            # Check for Result<String> format: {code: 0, data: "character_name"}
                            if isinstance(data, dict) and data.get('code') == 0:
                                character_name = data.get('data')
                                if character_name:
                                    logger.info(f"✅ [DB HELPER] Current character: {character_name}")
                                    return character_name
                                else:
                                    logger.warning(f"⚠️ [DB HELPER] API returned success but no character name")
                                    return "Conversation"  # Default
                            else:
                                logger.warning(f"⚠️ [DB HELPER] Unexpected API response format: {data}")
                                return "Conversation"  # Default
                        elif response.status == 404:
                            logger.warning(f"No agent found for MAC: {device_mac}, using default Conversation mode")
                            return "Conversation"
                        else:
                            error_text = await response.text()
                            logger.warning(f"API request failed: {response.status} - {error_text}")

                            # Don't retry client errors (4xx)
                            if 400 <= response.status < 500:
                                logger.error(f"Client error, not retrying: {response.status}")
                                return "Conversation"  # Default

            except asyncio.TimeoutError:
                logger.warning(f"API request timeout (attempt {attempt + 1}/{self.retry_attempts})")
            except aiohttp.ClientError as e:
                logger.warning(f"API client error (attempt {attempt + 1}/{self.retry_attempts}): {e}")
            except Exception as e:
                logger.error(f"Unexpected error getting character (attempt {attempt + 1}/{self.retry_attempts}): {e}")

            # Wait before retry with exponential backoff
            if attempt < self.retry_attempts - 1:
                wait_time = 2 ** attempt  # 1s, 2s, 4s
                await asyncio.sleep(wait_time)

        logger.error(f"Failed to get character after {self.retry_attempts} attempts, using default Conversation")
        return "Conversation"  # Default fallback

    async def get_child_profile_by_mac(self, device_mac: str) -> Optional[dict]:
        """
        Get child profile assigned to device by MAC address

        Args:
            device_mac: Device MAC address

        Returns:
            dict: Child profile with name, age, ageGroup, gender, interests
        """
        # Normalize MAC address to match Java controller expectations
        normalized_mac = self._normalize_mac_address(device_mac)
        logger.info(f"🔍 [DB HELPER] get_child_profile_by_mac - MAC: {device_mac} -> normalized: {normalized_mac}")
        
        url = f"{self.manager_api_url}/config/child-profile-by-mac"
        headers = {
            "Authorization": f"Bearer {self.secret}",
            "Content-Type": "application/json"
        }
        payload = {"macAddress": normalized_mac}

        for attempt in range(self.retry_attempts):
            try:
                timeout = aiohttp.ClientTimeout(total=10)
                async with aiohttp.ClientSession(timeout=timeout) as session:
                    async with session.post(url, json=payload, headers=headers) as response:
                        if response.status == 200:
                            data = await response.json()
                            # Check for Result<ChildProfileDTO> format: {code: 0, data: {...}}
                            if data.get('code') == 0 and data.get('data'):
                                child_profile = data.get('data')
                                logger.info(f"👶✅ Retrieved child profile for MAC: {device_mac} (normalized: {normalized_mac}) - {child_profile.get('name')}, age {child_profile.get('age')}")
                                return child_profile
                            else:
                                logger.warning(f"👶⚠️ API returned error: {data}")
                                return None
                        elif response.status == 404:
                            logger.warning(f"No child profile found for MAC: {device_mac} (normalized: {normalized_mac})")
                            return None
                        else:
                            error_text = await response.text()
                            logger.warning(f"API request failed: {response.status} - {error_text}")

                            # Don't retry client errors (4xx)
                            if 400 <= response.status < 500:
                                logger.error(f"Client error, not retrying: {response.status}")
                                return None

            except asyncio.TimeoutError:
                logger.warning(f"API request timeout (attempt {attempt + 1}/{self.retry_attempts})")
            except aiohttp.ClientError as e:
                logger.warning(f"API client error (attempt {attempt + 1}/{self.retry_attempts}): {e}")
            except Exception as e:
                logger.error(f"Unexpected error getting child profile (attempt {attempt + 1}/{self.retry_attempts}): {e}")

            # Wait before retry with exponential backoff
            if attempt < self.retry_attempts - 1:
                wait_time = 2 ** attempt  # 1s, 2s, 4s
                await asyncio.sleep(wait_time)

        logger.error(f"Failed to get child profile after {self.retry_attempts} attempts for MAC: {device_mac} (normalized: {normalized_mac})")
        return None

    async def verify_manager_api_connection(self) -> bool:
        """
        Verify connection to Manager API

        Returns:
            bool: True if connection successful, False otherwise
        """
        url = f"{self.manager_api_url}/health"
        headers = {
            "Authorization": f"Bearer {self.secret}",
            "Content-Type": "application/json"
        }

        try:
            timeout = aiohttp.ClientTimeout(total=5)
            async with aiohttp.ClientSession(timeout=timeout) as session:
                async with session.get(url, headers=headers) as response:
                    if response.status == 200:
                        logger.info("Manager API connection verified")
                        return True
                    else:
                        logger.warning(f"Manager API health check failed: {response.status}")
                        return False
        except Exception as e:
            logger.error(f"Failed to verify Manager API connection: {e}")
            return False

    async def get_agent_template_id(self, device_mac: str) -> Optional[str]:
        """
        Get agent template_id from database using device MAC address

        Args:
            device_mac: Device MAC address

        Returns:
            str: Template ID if found, None if not found or on error
        """
        # Normalize MAC address to match Java controller expectations
        normalized_mac = self._normalize_mac_address(device_mac)
        logger.info(f"🔍 [DB HELPER] get_agent_template_id - MAC: {device_mac} -> normalized: {normalized_mac}")
        
        url = f"{self.manager_api_url}/config/agent-template-id"
        headers = {
            "Authorization": f"Bearer {self.secret}",
            "Content-Type": "application/json"
        }
        payload = {"macAddress": normalized_mac}

        for attempt in range(self.retry_attempts):
            try:
                timeout = aiohttp.ClientTimeout(total=10)
                async with aiohttp.ClientSession(timeout=timeout) as session:
                    async with session.post(url, json=payload, headers=headers) as response:
                        if response.status == 200:
                            data = await response.json()
                            # Check for Result<String> format: {code: 0, data: "template_id"}
                            if data.get('code') == 0 and data.get('data'):
                                template_id = data.get('data')
                                logger.info(f"📄✅ Retrieved template_id: {template_id} for MAC: {device_mac} (normalized: {normalized_mac})")
                                return str(template_id)
                            else:
                                logger.warning(f"📄⚠️ No template_id in response for MAC: {device_mac} (normalized: {normalized_mac}). Response: {data}")
                                return None
                        elif response.status == 404:
                            logger.warning(f"No template found for MAC: {device_mac} (normalized: {normalized_mac})")
                            return None
                        else:
                            error_text = await response.text()
                            logger.warning(f"API request failed: {response.status} - {error_text}")

                            # Don't retry client errors (4xx)
                            if 400 <= response.status < 500:
                                logger.error(f"Client error, not retrying: {response.status}")
                                return None

            except asyncio.TimeoutError:
                logger.warning(f"API request timeout (attempt {attempt + 1}/{self.retry_attempts})")
            except aiohttp.ClientError as e:
                logger.warning(f"API client error (attempt {attempt + 1}/{self.retry_attempts}): {e}")
            except Exception as e:
                logger.error(f"Unexpected error getting template_id (attempt {attempt + 1}/{self.retry_attempts}): {e}")

            # Wait before retry with exponential backoff
            if attempt < self.retry_attempts - 1:
                wait_time = 2 ** attempt  # 1s, 2s, 4s
                await asyncio.sleep(wait_time)

        logger.error(f"Failed to get template_id after {self.retry_attempts} attempts for MAC: {device_mac} (normalized: {normalized_mac})")
        return None

    async def fetch_template_content(self, template_id: str) -> Optional[str]:
        """
        Fetch template content (personality) from database

        Args:
            template_id: Template ID

        Returns:
            str: Template content (agent personality/prompt)
        """
        url = f"{self.manager_api_url}/config/template/{template_id}"
        headers = {
            "Authorization": f"Bearer {self.secret}",
            "Content-Type": "application/json"
        }

        for attempt in range(self.retry_attempts):
            try:
                timeout = aiohttp.ClientTimeout(total=10)
                async with aiohttp.ClientSession(timeout=timeout) as session:
                    async with session.get(url, headers=headers) as response:
                        if response.status == 200:
                            data = await response.json()
                            # Check for Result<String> format: {code: 0, data: "template_content"}
                            if data.get('code') == 0 and data.get('data'):
                                content = data.get('data')
                                logger.info(f"📝✅ Retrieved template content for ID: {template_id} ({len(content)} chars)")
                                return content
                            else:
                                logger.warning(f"📝⚠️ No content in response for template_id: {template_id}. Response: {data}")
                                return None
                        elif response.status == 404:
                            logger.warning(f"Template not found: {template_id}")
                            return None
                        else:
                            error_text = await response.text()
                            logger.warning(f"API request failed: {response.status} - {error_text}")

                            # Don't retry client errors (4xx)
                            if 400 <= response.status < 500:
                                logger.error(f"Client error, not retrying: {response.status}")
                                return None

            except asyncio.TimeoutError:
                logger.warning(f"API request timeout (attempt {attempt + 1}/{self.retry_attempts})")
            except aiohttp.ClientError as e:
                logger.warning(f"API client error (attempt {attempt + 1}/{self.retry_attempts}): {e}")
            except Exception as e:
                logger.error(f"Unexpected error fetching template (attempt {attempt + 1}/{self.retry_attempts}): {e}")

            # Wait before retry with exponential backoff
            if attempt < self.retry_attempts - 1:
                wait_time = 2 ** attempt
                await asyncio.sleep(wait_time)

        logger.error(f"Failed to fetch template after {self.retry_attempts} attempts for ID: {template_id}")
        return None

    async def get_device_location(self, device_mac: str) -> Optional[str]:
        """
        Get device location (city name) from database

        Args:
            device_mac: Device MAC address

        Returns:
            str: Location (city name)
        """
        # Normalize MAC address to match Java controller expectations
        normalized_mac = self._normalize_mac_address(device_mac)
        logger.info(f"🔍 [DB HELPER] get_device_location - MAC: {device_mac} -> normalized: {normalized_mac}")
        
        url = f"{self.manager_api_url}/config/device-location"
        headers = {
            "Authorization": f"Bearer {self.secret}",
            "Content-Type": "application/json"
        }
        payload = {"macAddress": normalized_mac}

        for attempt in range(self.retry_attempts):
            try:
                timeout = aiohttp.ClientTimeout(total=10)
                async with aiohttp.ClientSession(timeout=timeout) as session:
                    async with session.post(url, json=payload, headers=headers) as response:
                        if response.status == 200:
                            data = await response.json()
                            # Check for Result<String> format: {code: 0, data: "city_name"}
                            if data.get('code') == 0 and data.get('data'):
                                location = data.get('data')
                                logger.info(f"📍✅ Retrieved location: {location} for MAC: {device_mac} (normalized: {normalized_mac})")
                                return location
                            else:
                                logger.warning(f"📍⚠️ No location in response for MAC: {device_mac} (normalized: {normalized_mac})")
                                return None
                        elif response.status == 404:
                            logger.warning(f"No location found for MAC: {device_mac} (normalized: {normalized_mac})")
                            return None
                        else:
                            error_text = await response.text()
                            logger.warning(f"API request failed: {response.status} - {error_text}")

                            if 400 <= response.status < 500:
                                return None

            except asyncio.TimeoutError:
                logger.warning(f"API request timeout (attempt {attempt + 1}/{self.retry_attempts})")
            except aiohttp.ClientError as e:
                logger.warning(f"API client error (attempt {attempt + 1}/{self.retry_attempts}): {e}")
            except Exception as e:
                logger.error(f"Unexpected error getting location (attempt {attempt + 1}/{self.retry_attempts}): {e}")

            if attempt < self.retry_attempts - 1:
                wait_time = 2 ** attempt
                await asyncio.sleep(wait_time)

        logger.error(f"Failed to get location after {self.retry_attempts} attempts for MAC: {device_mac} (normalized: {normalized_mac})")
        return None

    async def get_weather_forecast(self, location: str) -> Optional[str]:
        """
        Get 7-day weather forecast for location

        Args:
            location: City name

        Returns:
            str: Weather forecast text
        """
        url = f"{self.manager_api_url}/config/weather"
        headers = {
            "Authorization": f"Bearer {self.secret}",
            "Content-Type": "application/json"
        }
        payload = {"location": location}

        for attempt in range(self.retry_attempts):
            try:
                timeout = aiohttp.ClientTimeout(total=10)
                async with aiohttp.ClientSession(timeout=timeout) as session:
                    async with session.post(url, json=payload, headers=headers) as response:
                        if response.status == 200:
                            data = await response.json()
                            # Check for Result<String> format: {code: 0, data: "weather_text"}
                            if data.get('code') == 0 and data.get('data'):
                                weather = data.get('data')
                                logger.info(f"🌤️✅ Retrieved weather for: {location}")
                                return weather
                            else:
                                logger.warning(f"🌤️⚠️ No weather in response for location: {location}")
                                return None
                        elif response.status == 404:
                            logger.warning(f"No weather data found for location: {location}")
                            return None
                        else:
                            error_text = await response.text()
                            logger.warning(f"API request failed: {response.status} - {error_text}")

                            if 400 <= response.status < 500:
                                return None

            except asyncio.TimeoutError:
                logger.warning(f"API request timeout (attempt {attempt + 1}/{self.retry_attempts})")
            except aiohttp.ClientError as e:
                logger.warning(f"API client error (attempt {attempt + 1}/{self.retry_attempts}): {e}")
            except Exception as e:
                logger.error(f"Unexpected error getting weather (attempt {attempt + 1}/{self.retry_attempts}): {e}")

            if attempt < self.retry_attempts - 1:
                wait_time = 2 ** attempt
                await asyncio.sleep(wait_time)

        logger.error(f"Failed to get weather after {self.retry_attempts} attempts for location: {location}")
        return None