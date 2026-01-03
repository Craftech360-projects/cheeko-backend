"""
Mem0 Service - Long-term memory management for Cheeko agents

This service handles:
- Storing conversation transcripts to Mem0 for fact extraction
- Retrieving memories for prompt injection
- Knowledge graph with entities and relations
"""

import os
import logging
import asyncio
from typing import List, Dict, Any, Optional

logger = logging.getLogger("mem0_service")


class Mem0Service:
    """
    Service for interacting with Mem0 API for persistent memory.
    Handles conversation storage and fact extraction with knowledge graph support.
    """

    def __init__(self):
        self.api_key = os.getenv("MEM0_API_KEY")
        self.client = None

        logger.info(f"[MEM0] Initializing Mem0Service... API key present: {bool(self.api_key)}")

        if not self.api_key:
            logger.warning("[MEM0] MEM0_API_KEY not set. Memory features disabled.")
        else:
            try:
                from mem0 import MemoryClient
                self.client = MemoryClient(api_key=self.api_key)
                logger.info("[MEM0] Service initialized successfully with graph support")
            except ImportError as e:
                logger.error(f"[MEM0] mem0 package not installed. Run: pip install mem0ai. Error: {e}")
            except Exception as e:
                logger.error(f"[MEM0] Failed to initialize: {e}")

    def _normalize_user_id(self, user_id: str) -> str:
        """Normalize MAC address to consistent format (lowercase, with colons)"""
        # Keep colons, just lowercase
        return user_id.lower()

    async def add_conversation(
        self,
        user_id: str,
        messages: List[Dict[str, Any]],
        session_id: str = None
    ) -> bool:
        """
        Send conversation transcript to Mem0 for fact extraction.
        This is called at session end (fire-and-forget).

        Args:
            user_id: Device MAC address
            messages: List of {chatType: 1|2, content: str, timestamp: int}
            session_id: Optional session identifier for tracking

        Returns:
            bool: True if successful, False otherwise
        """
        logger.info(f"[MEM0] add_conversation called - user: {user_id}, messages: {len(messages) if messages else 0}, client_ready: {self.client is not None}")

        if not self.client:
            logger.warning("[MEM0] Client not initialized, skipping add_conversation")
            return False

        if not messages:
            logger.debug("[MEM0] No messages to add")
            return True

        try:
            clean_user_id = self._normalize_user_id(user_id)

            # Format messages for Mem0 API
            # chatType: 1 = user, 2 = agent
            formatted_messages = []
            for msg in messages:
                content = msg.get("content", "").strip()
                if content:
                    role = "user" if msg.get("chatType") == 1 else "assistant"
                    formatted_messages.append({
                        "role": role,
                        "content": content
                    })

            if not formatted_messages:
                logger.debug("[MEM0] No valid messages after filtering")
                return True

            # Add to Mem0 with graph extraction enabled
            # Mem0's sync client wrapped for async execution
            loop = asyncio.get_event_loop()
            await loop.run_in_executor(
                None,
                lambda: self.client.add(
                    formatted_messages,
                    user_id=clean_user_id,
                    enable_graph=True,  # Enable knowledge graph extraction
                    metadata={"session_id": session_id} if session_id else None
                )
            )

            logger.info(f"[MEM0] Added {len(formatted_messages)} messages for user {clean_user_id}")
            return True

        except Exception as e:
            logger.error(f"[MEM0] Failed to add conversation: {e}")
            return False

    async def get_memories(
        self,
        user_id: str,
        limit: int = 20
    ) -> Dict[str, Any]:
        """
        Retrieve memories for a user using semantic search with graph support.

        Args:
            user_id: Device MAC address
            limit: Maximum number of memories to retrieve (~500 tokens)

        Returns:
            Dict with: memories (list of strings), relations (list), entities (list)
        """
        if not self.client:
            return {"memories": [], "relations": [], "entities": []}

        try:
            clean_user_id = self._normalize_user_id(user_id)

            # Use semantic search with graph enabled
            loop = asyncio.get_event_loop()
            results = await loop.run_in_executor(
                None,
                lambda: self.client.search(
                    "What is known about this person, their family, pets, interests, skills, routines, and feelings?",
                    user_id=clean_user_id,
                    limit=limit,
                    enable_graph=True
                )
            )

            if results:
                # Extract memories
                memories = []
                entities = []

                for r in results.get("results", []):
                    if r.get("memory"):
                        memories.append(r["memory"])
                    # Extract entities from each result
                    for e in r.get("entities", []):
                        if e.get("name"):
                            entities.append({
                                "name": e["name"],
                                "type": e.get("type", "unknown")
                            })

                relations = results.get("relations", [])

                logger.info(f"[MEM0] Retrieved {len(memories)} memories, {len(relations)} relations for {clean_user_id}")

                return {
                    "memories": memories,
                    "relations": relations,
                    "entities": entities
                }

            return {"memories": [], "relations": [], "entities": []}

        except Exception as e:
            logger.error(f"[MEM0] Failed to get memories: {e}")
            return {"memories": [], "relations": [], "entities": []}

    async def add_fact(self, user_id: str, fact: str) -> bool:
        """
        Add a single fact to memory.

        Args:
            user_id: Device MAC address
            fact: The fact to store (e.g., "Loves dinosaurs")

        Returns:
            bool: True if successful
        """
        if not fact:
            return False

        return await self.add_conversation(
            user_id,
            [{"chatType": 1, "content": fact}]
        )

    def is_ready(self) -> bool:
        """Check if the Mem0 client is initialized and ready"""
        return self.client is not None


# Singleton instance for use across workers
mem0_service = Mem0Service()
