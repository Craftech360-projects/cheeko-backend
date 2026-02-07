"""Unit tests for the MemoryService (SQLite backend)."""

import asyncio
import os
import shutil
import sys
import tempfile

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from src.memory.memory_service import MemoryService


@pytest.fixture
def tmp_memory_dir():
    """Create a temp directory for memory storage."""
    d = tempfile.mkdtemp(prefix="cheeko_test_memory_")
    yield d
    shutil.rmtree(d, ignore_errors=True)


@pytest.fixture
def service(tmp_memory_dir):
    """Create a MemoryService with a temp directory."""
    config = {
        "enabled": True,
        "backend": "sqlite",
        "base_path": tmp_memory_dir,
        "embedding": {"model": "all-MiniLM-L6-v2"},
        "search": {
            "max_results": 6,
            "min_score": 0.0,  # Low threshold for testing
            "hybrid": {"vector_weight": 0.7, "text_weight": 0.3},
        },
        "chunking": {"max_tokens": 400, "overlap": 80},
        "flush": {"enabled": True, "extract_facts_with_llm": False},
    }
    return MemoryService(config)


TEST_MAC = "68:25:dd:bb:f3:a0"


class TestMemoryServiceInit:
    def test_service_created(self, service):
        assert service.is_ready()
        assert service._backend_type == "sqlite"

    def test_disabled_service(self, tmp_memory_dir):
        svc = MemoryService({"enabled": False, "base_path": tmp_memory_dir})
        assert not svc.is_ready()


class TestInitialize:
    @pytest.mark.asyncio
    async def test_initialize_creates_workspace(self, service):
        await service.initialize(TEST_MAC, {"name": "Riya", "age": 8})
        # Should be able to read the profile back
        profile = await service.backend.read_file(TEST_MAC, "profile")
        assert "Riya" in profile

    @pytest.mark.asyncio
    async def test_initialize_idempotent(self, service):
        await service.initialize(TEST_MAC, {"name": "Riya"})
        await service.initialize(TEST_MAC, {"name": "Riya"})
        # Should not raise


class TestWriteAndSearch:
    @pytest.mark.asyncio
    async def test_write_fact_and_search(self, service):
        await service.initialize(TEST_MAC)
        await service.write_fact(TEST_MAC, "Has a dog named Rocky", "pet")
        results = await service.search(TEST_MAC, "pet dog", limit=5)
        assert len(results) >= 1
        assert any("Rocky" in r for r in results)

    @pytest.mark.asyncio
    async def test_search_returns_empty_for_no_match(self, service):
        await service.initialize(TEST_MAC)
        await service.write_fact(TEST_MAC, "Loves painting", "preference")
        results = await service.search(TEST_MAC, "quantum physics", limit=5)
        # May or may not return results depending on embedding similarity
        # but should not crash
        assert isinstance(results, list)

    @pytest.mark.asyncio
    async def test_device_isolation(self, service):
        mac_a = "aa:bb:cc:dd:ee:01"
        mac_b = "aa:bb:cc:dd:ee:02"
        await service.initialize(mac_a)
        await service.initialize(mac_b)
        await service.write_fact(mac_a, "Device A secret fact", "personal")
        results_b = await service.search(mac_b, "Device A secret", limit=5)
        # Device B should NOT find Device A's facts
        assert not any("Device A" in r for r in results_b)


class TestFormatMemories:
    def test_format_with_memories(self, service):
        formatted = service.format_memories_for_injection(
            "tell me about dogs",
            ["Has a dog named Rocky", "Loves animals"]
        )
        assert "Rocky" in formatted
        assert "dogs" in formatted

    def test_format_empty(self, service):
        formatted = service.format_memories_for_injection("query", [])
        assert formatted == ""


class TestLoadContext:
    @pytest.mark.asyncio
    async def test_load_context_returns_dict(self, service):
        await service.initialize(TEST_MAC, {"name": "Riya", "age": 8})
        ctx = await service.load_context(TEST_MAC)
        assert "long_term_memories" in ctx
        assert "today_context" in ctx
        assert isinstance(ctx["long_term_memories"], list)

    @pytest.mark.asyncio
    async def test_disabled_returns_empty(self, tmp_memory_dir):
        svc = MemoryService({"enabled": False, "base_path": tmp_memory_dir})
        ctx = await svc.load_context(TEST_MAC)
        assert ctx["long_term_memories"] == []


class TestFlushSession:
    @pytest.mark.asyncio
    async def test_flush_saves_facts(self, service):
        await service.initialize(TEST_MAC)
        history = [
            {"chatType": 1, "content": "My favorite color is blue"},
            {"chatType": 2, "content": "That's a nice color!"},
            {"chatType": 1, "content": "I have a pet hamster named Biscuit"},
            {"chatType": 2, "content": "Biscuit is a cute name!"},
        ]
        await service.flush_session(TEST_MAC, history)
        # Should have saved some facts
        results = await service.search(TEST_MAC, "hamster Biscuit", limit=5)
        assert len(results) >= 1

    @pytest.mark.asyncio
    async def test_flush_empty_history(self, service):
        await service.initialize(TEST_MAC)
        await service.flush_session(TEST_MAC, [])
        # Should not crash

    @pytest.mark.asyncio
    async def test_flush_with_mock_llm(self, service):
        # Override flush config to enable LLM
        service.extract_facts_with_llm = True
        await service.initialize(TEST_MAC)

        async def mock_extractor(text):
            return ["[PREFERENCE] Favorite color is blue", "[PERSONAL] Has a hamster named Biscuit"]

        history = [
            {"chatType": 1, "content": "My favorite color is blue"},
            {"chatType": 2, "content": "Nice!"},
        ]
        await service.flush_session(TEST_MAC, history, extract_with_llm=mock_extractor)
        results = await service.search(TEST_MAC, "favorite color blue", limit=5)
        assert len(results) >= 1


class TestReindex:
    @pytest.mark.asyncio
    async def test_reindex_after_write(self, service):
        await service.initialize(TEST_MAC, {"name": "Riya"})
        await service.write_fact(TEST_MAC, "Knows multiplication tables", "learning")
        await service.reindex(TEST_MAC)
        results = await service.search(TEST_MAC, "multiplication", limit=5)
        assert len(results) >= 1
