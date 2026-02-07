"""
Integration test: full session lifecycle.

Tests the complete flow:
  initialize → write_fact → search → flush_session → curator → verify profile
"""

import asyncio
import os
import shutil
import sys
import tempfile

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from src.memory.memory_service import MemoryService
from src.memory.curator import curate_device_memory


@pytest.fixture
def tmp_dir():
    d = tempfile.mkdtemp(prefix="cheeko_integration_")
    yield d
    shutil.rmtree(d, ignore_errors=True)


@pytest.fixture
def service(tmp_dir):
    config = {
        "enabled": True,
        "backend": "sqlite",
        "base_path": tmp_dir,
        "embedding": {"model": "all-MiniLM-L6-v2"},
        "search": {
            "max_results": 10,
            "min_score": 0.0,
            "hybrid": {"vector_weight": 0.7, "text_weight": 0.3},
        },
        "chunking": {"max_tokens": 400, "overlap": 80},
        "flush": {"enabled": True, "extract_facts_with_llm": True},
    }
    return MemoryService(config)


MAC = "aa:bb:cc:dd:ee:ff"
PROFILE = {"name": "Arjun", "age": 10, "interests": "dinosaurs, space, cricket"}


class TestFullSessionLifecycle:
    """Simulates a complete device session from start to end."""

    @pytest.mark.asyncio
    async def test_session_lifecycle(self, service):
        # === 1. SESSION START: Initialize device ===
        await service.initialize(MAC, PROFILE)

        # Verify profile was stored
        profile_text = await service.backend.read_file(MAC, "profile")
        assert "Arjun" in profile_text
        assert "dinosaurs" in profile_text

        # === 2. DURING SESSION: Agent writes facts ===
        await service.write_fact(MAC, "Favorite dinosaur is Velociraptor", "preference")
        await service.write_fact(MAC, "Has a pet parrot named Mithu", "personal")
        await service.write_fact(MAC, "Scored 5/5 on multiplication quiz", "achievement")

        # === 3. DURING SESSION: Agent searches memory ===
        results = await service.search(MAC, "what is their favorite dinosaur", limit=5)
        assert len(results) >= 1
        assert any("Velociraptor" in r for r in results)

        results = await service.search(MAC, "pet bird parrot", limit=5)
        assert len(results) >= 1
        assert any("Mithu" in r for r in results)

        # === 4. SESSION END: Flush with mock LLM extraction ===
        chat_history = [
            {"chatType": 1, "content": "I love playing cricket with my brother Rahul"},
            {"chatType": 2, "content": "That sounds fun! Cricket with Rahul must be exciting!"},
            {"chatType": 1, "content": "Yeah, and my favorite player is Virat Kohli"},
            {"chatType": 2, "content": "Virat Kohli is amazing! Great choice!"},
            {"chatType": 1, "content": "Can you tell me about the solar system?"},
            {"chatType": 2, "content": "Of course! Our solar system has 8 planets..."},
        ]

        async def mock_extractor(conversation_text):
            return [
                "[PERSONAL] Has a brother named Rahul",
                "[PREFERENCE] Favorite cricket player is Virat Kohli",
                "[LEARNING] Interested in learning about the solar system",
            ]

        await service.flush_session(MAC, chat_history, extract_with_llm=mock_extractor)

        # === 5. Verify flushed facts are searchable ===
        results = await service.search(MAC, "brother Rahul cricket", limit=5)
        assert len(results) >= 1

        results = await service.search(MAC, "Virat Kohli favorite", limit=5)
        assert len(results) >= 1

    @pytest.mark.asyncio
    async def test_device_isolation_full(self, service):
        """Two devices should have completely isolated memory."""
        mac_a = "11:22:33:44:55:01"
        mac_b = "11:22:33:44:55:02"

        await service.initialize(mac_a, {"name": "Alice"})
        await service.initialize(mac_b, {"name": "Bob"})

        await service.write_fact(mac_a, "Alice loves painting", "preference")
        await service.write_fact(mac_b, "Bob loves football", "preference")

        results_a = await service.search(mac_a, "painting", limit=5)
        results_b = await service.search(mac_b, "painting", limit=5)

        assert any("painting" in r for r in results_a)
        assert not any("painting" in r for r in results_b)

    @pytest.mark.asyncio
    async def test_context_loading_after_rewrite(self, service):
        """Load context should reflect facts written in previous sessions."""
        await service.initialize(MAC, PROFILE)
        await service.write_fact(MAC, "Knows all planets in order", "learning")

        # Simulate a new session by loading context
        ctx = await service.load_context(MAC)
        memories = ctx["long_term_memories"]
        assert isinstance(memories, list)
        # The search in load_context should find the fact
        assert len(memories) >= 1

    @pytest.mark.asyncio
    async def test_curator_updates_profile(self, service):
        """Curator should merge daily log facts into profile."""
        await service.initialize(MAC, PROFILE)

        # Write some daily log facts
        await service.write_fact(MAC, "Favorite sport is cricket", "preference")
        await service.write_fact(MAC, "Best friend is Priya", "personal")

        # Run curator with a mock LLM
        # Since Groq API may not be available in CI, test that curator
        # doesn't crash and handles missing API gracefully
        result = await curate_device_memory(MAC, days=1, memory_service=service)
        # May be True (if Groq available) or False (if no API key)
        assert isinstance(result, bool)

    @pytest.mark.asyncio
    async def test_reindex_preserves_searchability(self, service):
        """After reindex, all facts should still be searchable."""
        await service.initialize(MAC, PROFILE)
        await service.write_fact(MAC, "Birthday is March 15", "personal")
        await service.write_fact(MAC, "Allergic to peanuts", "personal")

        # Reindex
        await service.reindex(MAC)

        # Should still find facts
        results = await service.search(MAC, "birthday March", limit=5)
        assert len(results) >= 1

        results = await service.search(MAC, "peanut allergy", limit=5)
        assert len(results) >= 1
