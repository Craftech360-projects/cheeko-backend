import logging
import json
import aiohttp
from typing import List, Dict, Any
from datetime import datetime

logger = logging.getLogger("chat_history")


class ChatHistoryService:
    """Service for capturing and saving chat history to Manager API on room close"""

    def __init__(self, manager_api_url: str, secret: str, device_mac: str, session_id: str, agent_id: str = None):
        """
        Initialize chat history service

        Args:
            manager_api_url: Base URL of Manager API
            secret: API authentication secret
            device_mac: Device MAC address
            session_id: Session identifier (room name)
            agent_id: Agent identifier (optional)
        """
        self.manager_api_url = manager_api_url.rstrip('/')
        self.secret = secret
        self.device_mac = device_mac
        self.session_id = session_id
        self.agent_id = agent_id

        # State - buffer all messages until room closes
        self.conversation_history: List[Dict[str, Any]] = []

        logger.info(f"📝 Chat history service initialized - MAC: {device_mac}, Session: {session_id}")

    def add_message(self, chat_type: int, content: str, timestamp: float = None):
        """
        Add a message to the conversation history

        Args:
            chat_type: 1 for user, 2 for agent
            content: Message text content
            timestamp: Message timestamp (defaults to current time)
        """
        if not content or not content.strip():
            return

        # Validate chat type
        if chat_type not in [1, 2]:
            chat_type = 2

        message = {
            "chatType": chat_type,
            "content": content.strip()[:2000],  # Limit content length
            "timestamp": int(timestamp or datetime.now().timestamp())
        }

        self.conversation_history.append(message)

        chat_type_str = "👤 User" if chat_type == 1 else "🤖 Agent"
        logger.debug(f"📝 {chat_type_str}: '{content[:50]}...' (total: {len(self.conversation_history)})")

    def start_periodic_sending(self):
        """No-op for backward compatibility - we only send on room close now"""
        logger.info("📝 Chat history will be sent on room close")

    async def send_history_on_close(self) -> bool:
        """
        Send entire chat history to Manager API when room closes

        Returns:
            bool: True if successful, False if failed
        """
        if not self.conversation_history:
            logger.info("📝 No chat history to send")
            return True

        url = f"{self.manager_api_url}/agent/chat-history/session"
        logger.info(f"📝📤 Sending {len(self.conversation_history)} messages to Manager API: {url}")

        # Build payload with entire history
        payload = {
            "macAddress": self.device_mac,
            "sessionId": self.session_id,
            "agentId": self.agent_id,
            "messages": self.conversation_history,
            "messageCount": len(self.conversation_history),
            "sessionEnd": int(datetime.now().timestamp())
        }

        headers = {
            "Authorization": f"Bearer {self.secret}",
            "Content-Type": "application/json"
        }

        # Try sending with retries
        for attempt in range(3):
            try:
                timeout = aiohttp.ClientTimeout(total=15)
                async with aiohttp.ClientSession(timeout=timeout) as session:
                    async with session.post(url, json=payload, headers=headers) as response:
                        if response.status == 200:
                            logger.info(f"📝✅ Chat history sent successfully ({len(self.conversation_history)} messages)")
                            return True
                        else:
                            error_text = await response.text()
                            logger.warning(f"📝❌ API returned {response.status}: {error_text}")

                            # Don't retry client errors
                            if 400 <= response.status < 500:
                                return False

            except Exception as e:
                logger.warning(f"📝❌ Attempt {attempt + 1}/3 failed: {e}")

            # Wait before retry
            if attempt < 2:
                import asyncio
                await asyncio.sleep(2 ** attempt)

        logger.error(f"📝❌ Failed to send chat history after 3 attempts")
        return False

    async def cleanup(self):
        """Cleanup service - send all history on room close"""
        logger.info(f"📝🧹 Room closing - sending {len(self.conversation_history)} messages...")
        await self.send_history_on_close()
        logger.info("📝🧹 Chat history service cleanup complete")

    def get_stats(self) -> Dict[str, Any]:
        """Get service statistics"""
        return {
            "session_id": self.session_id,
            "device_mac": self.device_mac,
            "total_messages": len(self.conversation_history),
            "agent_id": self.agent_id
        }
