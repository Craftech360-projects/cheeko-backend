"""
MemoryService - Self-hosted memory system for Cheeko agents.
Per-device memory with local SQLite + sentence-transformer embeddings.
"""

import asyncio
import hashlib
import logging
from datetime import date as date_module
from typing import Any, Callable, Dict, List, Optional

from .backends.sqlite_backend import SqliteBackend
from .chunker import chunk_markdown
from .embedder import Embedder
from .hybrid_search import hybrid_search

logger = logging.getLogger("memory.service")

# Singleton instance
_memory_service_instance: Optional["MemoryService"] = None


def get_memory_service(config: Optional[dict] = None) -> "MemoryService":
    """Get or create the singleton MemoryService.

    Args:
        config: Memory config dict (from config.yaml memory: section).
               Only used on first call to create the instance.

    Returns:
        MemoryService singleton.
    """
    global _memory_service_instance
    if _memory_service_instance is None:
        if config is None:
            config = {}
        _memory_service_instance = MemoryService(config)
    return _memory_service_instance


class MemoryService:
    """Self-hosted memory service with local embedding + SQLite storage.

    Provides initialize, search, write, flush, and reindex operations per device.
    """

    def __init__(self, config: dict):
        self.config = config
        self.enabled = config.get("enabled", True)

        # Backend selection
        base_path = config.get("base_path", "./memory")
        backend_type = config.get("backend", "sqlite")

        if backend_type == "qdrant":
            try:
                from .backends.qdrant_backend import QdrantBackend
                qdrant_config = config.get("qdrant", {})
                # Pass file_fallback_path so Qdrant can use local files if Supabase is unavailable
                qdrant_config.setdefault("file_fallback_path", base_path)
                self.backend = QdrantBackend(qdrant_config)
            except ImportError as e:
                logger.warning(f"[MEMORY] Qdrant backend unavailable ({e}), falling back to sqlite")
                backend_type = "sqlite"
                self.backend = SqliteBackend(base_path)
        else:
            self.backend = SqliteBackend(base_path)

        self._backend_type = backend_type

        # Embedder
        embedding_config = config.get("embedding", {})
        self.embedder = Embedder(embedding_config)

        # Search config
        search_config = config.get("search", {})
        self.max_results = search_config.get("max_results", 6)
        self.min_score = search_config.get("min_score", 0.35)
        hybrid_config = search_config.get("hybrid", {})
        self.vector_weight = hybrid_config.get("vector_weight", 0.7)
        self.text_weight = hybrid_config.get("text_weight", 0.3)

        # Chunking config
        chunking_config = config.get("chunking", {})
        self.max_tokens = chunking_config.get("max_tokens", 400)
        self.overlap = chunking_config.get("overlap", 80)

        # Flush config
        flush_config = config.get("flush", {})
        self.flush_enabled = flush_config.get("enabled", True)
        self.extract_facts_with_llm = flush_config.get("extract_facts_with_llm", True)

        # Track initialized devices
        self._initialized_macs = set()

        logger.info(f"[MEMORY] MemoryService created (enabled={self.enabled}, backend={backend_type}, base_path={base_path})")

    async def initialize(self, mac: str, child_profile: Optional[dict] = None):
        """Initialize memory storage for a device.

        Creates workspace directories, DB schema, and seeds initial profile.

        Args:
            mac: Device MAC address.
            child_profile: Optional dict with child info (name, age, interests).
        """
        if not self.enabled:
            return

        normalized = self._normalize_mac(mac)
        if normalized in self._initialized_macs:
            return

        await self.backend.initialize(mac)

        # Seed profile if provided and not already existing
        if child_profile:
            existing = await self.backend.read_file(mac, "profile")
            if not existing:
                profile_text = self._format_profile(child_profile)
                await self.backend.write_file(mac, "profile", profile_text)
                # Index the profile
                chunks = chunk_markdown(profile_text, self.max_tokens, self.overlap)
                await self._index_chunks(mac, chunks, category="profile")

        self._initialized_macs.add(normalized)
        logger.info(f"[MEMORY] Initialized for device {normalized}")

    async def load_context(self, mac: str) -> Dict[str, Any]:
        """Load memory context for prompt injection.

        Returns:
            Dict with keys:
                long_term_memories: List[str] - general memories
                memory_relations: List[dict] - entity relations
                memory_entities: List[dict] - known entities
                today_context: str - today's session log
        """
        if not self.enabled:
            return {
                "long_term_memories": [],
                "memory_relations": [],
                "memory_entities": [],
                "today_context": "",
            }

        today = date_module.today().isoformat()

        # Load today's log
        today_context = await self.backend.read_file(mac, "daily_log", date=today)

        # Load profile
        profile = await self.backend.read_file(mac, "profile")

        # Search for broad context
        broad_query = "What is known about this person, their family, pets, interests, skills, and routines?"
        memories = await self.search(mac, broad_query, limit=self.max_results)

        return {
            "long_term_memories": memories,
            "memory_relations": [],  # Relations extracted from graph (future)
            "memory_entities": [],   # Entities extracted from graph (future)
            "today_context": today_context,
        }

    async def search(self, mac: str, query: str, limit: int = 5) -> List[str]:
        """Hybrid search over memory chunks.

        Args:
            mac: Device MAC address.
            query: Search query.
            limit: Max results.

        Returns:
            List of relevant memory text strings.
        """
        if not self.enabled or not query:
            return []

        try:
            # Get query embedding
            query_embedding = await self.embedder.embed(query)

            # Vector search
            vector_results = await self.backend.search(mac, query_embedding, limit=limit * 2)

            # FTS search
            fts_results = await self.backend.fts_search(mac, query, limit=limit * 2)

            # Merge results (dedup by text)
            seen_texts = set()
            merged = []
            for r in vector_results + fts_results:
                text = r.get("text", "")
                if text and text not in seen_texts:
                    seen_texts.add(text)
                    merged.append(r)

            # Apply hybrid scoring
            if merged:
                scored = hybrid_search(
                    query,
                    merged,
                    vector_weight=self.vector_weight,
                    text_weight=self.text_weight,
                    min_score=self.min_score,
                )
                return [r["text"] for r in scored[:limit]]

            return [r["text"] for r in vector_results[:limit]]

        except Exception as e:
            logger.error(f"[MEMORY] Search failed: {e}")
            return []

    def format_memories_for_injection(self, query: str, memories: List[str]) -> str:
        """Format memories for LLM prompt injection.

        Args:
            query: The user's current query.
            memories: List of relevant memory strings.

        Returns:
            Formatted string to inject into conversation context.
        """
        if not memories:
            return ""

        formatted = f"""
🧠 RELEVANT MEMORIES FOR THIS REQUEST:
The child just said: "{query}"

YOU MUST USE these memories in your response:
"""
        for memory in memories:
            formatted += f"- {memory}\n"

        formatted += """
⚠️ CRITICAL: If any memory above is relevant to what the child asked, you MUST incorporate it!
Example: If they asked about a dog and you know their dog's name → USE that name!
"""
        return formatted

    async def write_fact(self, mac: str, content: str, category: str = "general"):
        """Write a fact to memory. Appends to daily log and indexes.

        Args:
            mac: Device MAC address.
            content: Fact content text.
            category: Category tag (e.g. 'general', 'preference', 'family').
        """
        if not self.enabled or not content:
            return

        try:
            today = date_module.today().isoformat()

            # Append to daily log
            existing_log = await self.backend.read_file(mac, "daily_log", date=today)
            updated_log = existing_log + f"\n- {content}" if existing_log else f"# Daily Log {today}\n\n- {content}"
            await self.backend.write_file(mac, "daily_log", updated_log, date=today)

            # Index the fact as a chunk
            embedding = await self.embedder.embed(content)
            content_hash = hashlib.md5(content.encode()).hexdigest()
            await self.backend.upsert_chunks(mac, [{
                "text": content,
                "embedding": embedding,
                "file_path": f"daily_log_{today}",
                "start_line": 0,
                "end_line": 0,
                "category": category,
                "content_hash": content_hash,
            }])

            logger.info(f"[MEMORY] Wrote fact for {self._normalize_mac(mac)}: {content[:50]}...")

        except Exception as e:
            logger.error(f"[MEMORY] Failed to write fact: {e}")

    async def flush_session(
        self,
        mac: str,
        chat_history: List[Dict],
        extract_with_llm: Optional[Callable] = None,
    ):
        """End-of-session processing: extract facts from conversation.

        Args:
            mac: Device MAC address.
            chat_history: List of {chatType: 1|2, content: str} messages.
            extract_with_llm: Optional async function(text) -> List[str] that
                              uses an LLM to extract facts from conversation text.
        """
        if not self.enabled or not self.flush_enabled:
            return

        if not chat_history:
            return

        try:
            # Format conversation
            conversation_text = ""
            for msg in chat_history:
                content = msg.get("content", "").strip()
                if not content:
                    continue
                role = "Child" if msg.get("chatType") == 1 else "Cheeko"
                conversation_text += f"{role}: {content}\n"

            if not conversation_text:
                return

            # Extract facts
            facts = []
            if extract_with_llm and self.extract_facts_with_llm:
                try:
                    facts = await extract_with_llm(conversation_text)
                except Exception as e:
                    logger.warning(f"[MEMORY] LLM fact extraction failed: {e}")

            if not facts:
                # Simple extraction: take user messages as potential facts
                facts = [
                    msg.get("content", "").strip()
                    for msg in chat_history
                    if msg.get("chatType") == 1 and msg.get("content", "").strip()
                ]
                # Only keep longer statements likely to contain facts
                facts = [f for f in facts if len(f.split()) > 3]

            # Write each fact
            for fact in facts:
                await self.write_fact(mac, fact, category="session")

            logger.info(f"[MEMORY] Flushed session for {self._normalize_mac(mac)}: {len(facts)} facts")

        except Exception as e:
            logger.error(f"[MEMORY] Session flush failed: {e}")

    async def reindex(self, mac: str):
        """Full re-index: re-read all files and rebuild chunk index.

        Args:
            mac: Device MAC address.
        """
        if not self.enabled:
            return

        try:
            # Read profile
            profile = await self.backend.read_file(mac, "profile")
            all_chunks = []

            if profile:
                chunks = chunk_markdown(profile, self.max_tokens, self.overlap)
                for c in chunks:
                    c["category"] = "profile"
                    c["file_path"] = "profile"
                all_chunks.extend(chunks)

            # Read daily logs (check recent dates)
            from datetime import timedelta
            today = date_module.today()
            for days_ago in range(30):  # Last 30 days
                d = (today - timedelta(days=days_ago)).isoformat()
                log = await self.backend.read_file(mac, "daily_log", date=d)
                if log:
                    chunks = chunk_markdown(log, self.max_tokens, self.overlap)
                    for c in chunks:
                        c["category"] = "daily_log"
                        c["file_path"] = f"daily_log_{d}"
                    all_chunks.extend(chunks)

            # Embed all chunks
            if all_chunks:
                texts = [c["text"] for c in all_chunks]
                embeddings = await self.embedder.embed_batch(texts)
                for chunk, emb in zip(all_chunks, embeddings):
                    chunk["embedding"] = emb
                    chunk["content_hash"] = hashlib.md5(chunk["text"].encode()).hexdigest()

                await self.backend.replace_all_chunks(mac, all_chunks)
                logger.info(f"[MEMORY] Reindexed {len(all_chunks)} chunks for {self._normalize_mac(mac)}")

        except Exception as e:
            logger.error(f"[MEMORY] Reindex failed: {e}")

    async def _index_chunks(self, mac: str, chunks: List[Dict], category: str = "general"):
        """Embed and upsert a list of text chunks.

        Args:
            mac: Device MAC address.
            chunks: List of chunk dicts from chunker (text, start_line, end_line).
            category: Category tag for all chunks.
        """
        if not chunks:
            return

        texts = [c["text"] for c in chunks]
        embeddings = await self.embedder.embed_batch(texts)

        indexed = []
        for chunk, emb in zip(chunks, embeddings):
            content_hash = hashlib.md5(chunk["text"].encode()).hexdigest()
            indexed.append({
                "text": chunk["text"],
                "embedding": emb,
                "file_path": chunk.get("file_path", ""),
                "start_line": chunk.get("start_line", 0),
                "end_line": chunk.get("end_line", 0),
                "category": category,
                "content_hash": content_hash,
            })

        await self.backend.upsert_chunks(mac, indexed)

    def is_ready(self) -> bool:
        """Check if the memory service is ready. Always True for SQLite."""
        return self.enabled

    def _normalize_mac(self, mac: str) -> str:
        return mac.replace(":", "").replace("-", "").lower()

    def _format_profile(self, profile: dict) -> str:
        """Format a child profile dict into markdown."""
        lines = ["# Child Profile", ""]
        if profile.get("name"):
            lines.append(f"- **Name:** {profile['name']}")
        if profile.get("age"):
            lines.append(f"- **Age:** {profile['age']}")
        if profile.get("interests"):
            interests = profile["interests"]
            if isinstance(interests, list):
                interests = ", ".join(interests)
            lines.append(f"- **Interests:** {interests}")
        if profile.get("language"):
            lines.append(f"- **Language:** {profile['language']}")
        for key, value in profile.items():
            if key not in ("name", "age", "interests", "language"):
                lines.append(f"- **{key.title()}:** {value}")
        return "\n".join(lines)
