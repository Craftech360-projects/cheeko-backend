import logging
from mem0 import MemoryClient

logger = logging.getLogger("mem0_provider")

class Mem0MemoryProvider:
    def __init__(self, api_key: str, role_id: str):
        """Initialize mem0 client

        Args:
            api_key: Mem0 API key
            role_id: Unique user identifier (device MAC address)
        """
        self.api_key = api_key
        self.role_id = role_id
        self.client = MemoryClient(api_key=api_key)

    async def save_memory(self, history_dict: dict, child_name: str = None):
        """Save session history to mem0

        Args:
            history_dict: session.history.to_dict() output
                Format: {'messages': [{'role': 'user', 'content': '...'}, ...]}
            child_name: Optional child name to provide context to mem0
        """
        messages = history_dict.get('messages', [])
        if len(messages) < 2:
            return None

        # Build messages list in the format mem0 expects
        formatted_messages = []

        # Add context message with explicit instructions to prevent agent character leakage
        if child_name:
            formatted_messages.append({
                "role": "system",
                "content": f"""The user's name is {child_name}. Cheeko is the AI assistant.
IMPORTANT: Extract facts and preferences ONLY from messages with role='user' (the child's messages).
Do NOT extract facts from messages with role='assistant' (those are Cheeko's responses, not the child's preferences).
Focus on: favorite things, hobbies, pets, family members, friends, interests, and personal preferences."""
            })

        # Filter and format messages
        junk_phrases = {'ok', 'yes', 'no', 'um', 'ah', 'uh', 'hmm', 'yeah', 'yep', 'nope'}

        for msg in messages:
            if msg.get('role') != 'system':
                content = msg.get('content', '')
                if isinstance(content, list):
                    content = ' '.join(str(item) for item in content)

                # Skip junk data: very short messages or common filler words
                content_lower = content.lower().strip()
                word_count = len(content.split())

                # Skip if too short or is a junk phrase
                if word_count < 3 or content_lower in junk_phrases:
                    continue

                # Map role to standard format
                role = 'user' if msg.get('role') == 'user' else 'assistant'

                formatted_messages.append({
                    "role": role,
                    "content": content
                })

        # Save to mem0 with v1.1 output format and metadata
        metadata = {}
        if child_name:
            metadata["child_name"] = child_name
            metadata["assistant_name"] = "Cheeko"

        result = self.client.add(
            formatted_messages,  # Pass list of messages instead of string
            user_id=self.role_id,
            metadata=metadata if metadata else None
        )
        return result

    async def query_memory(self, query: str) -> str:
        """Query memories from mem0

        Args:
            query: Search query

        Returns:
            Formatted memory string
        """
        try:
            results = self.client.search(
                query,
                filters={"user_id": self.role_id},
                output_format="v1.1"
            )

            if not results or "results" not in results:
                return ""

            results_list = results["results"]

            # Format memories with timestamps
            memories = []
            for entry in results_list:
                timestamp = entry.get("updated_at", "")
                if timestamp:
                    timestamp = timestamp.split(".")[0].replace("T", " ")
                memory = entry.get("memory", "")
                if memory:
                    memories.append(f"[{timestamp}] {memory}")

            return "\n".join(f"- {m}" for m in memories)
        except Exception as e:
            logger.error(f"Error querying mem0: {e}")
            return ""

    async def get_all_memories(self) -> str:
        """Get all memories for the user (for session startup)

        Returns:
            Formatted memory string with all known facts about the user
        """
        try:
            # Mem0 v1.0+ API requires filters parameter
            results = self.client.get_all(
                filters={"user_id": self.role_id}
            )

            # Handle both list response and dict with "results" key
            if isinstance(results, list):
                results_list = results
            elif isinstance(results, dict) and "results" in results:
                results_list = results["results"]
            else:
                return ""

            if not results_list:
                return ""

            # Format memories
            memories = []
            for entry in results_list:
                memory = entry.get("memory", "")
                if memory:
                    memories.append(memory)

            return "\n".join(f"- {m}" for m in memories)
        except Exception as e:
            logger.error(f"Error getting all memories: {e}")
            return ""

    async def delete_all_memories(self) -> bool:
        """Delete all memories for the user (for testing/cleanup)

        Returns:
            True if successful, False otherwise
        """
        try:
            # Mem0 v1.0+ API requires filters parameter
            self.client.delete_all(
                filters={"user_id": self.role_id}
            )
            return True
        except Exception as e:
            logger.error(f"Error deleting memories: {e}")
            return False
