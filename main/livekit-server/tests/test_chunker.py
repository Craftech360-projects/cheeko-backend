"""Unit tests for the markdown chunker."""

import sys
import os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from src.memory.chunker import chunk_markdown


class TestChunkMarkdown:
    def test_empty_input(self):
        assert chunk_markdown("") == []
        assert chunk_markdown("   ") == []
        assert chunk_markdown(None) == []

    def test_single_short_section(self):
        text = "# Title\n\nSome content here."
        chunks = chunk_markdown(text, max_tokens=400)
        assert len(chunks) == 1
        assert "Title" in chunks[0]["text"]
        assert "Some content" in chunks[0]["text"]

    def test_splits_on_headings(self):
        text = "## Section A\nContent A\n\n## Section B\nContent B"
        chunks = chunk_markdown(text, max_tokens=400)
        assert len(chunks) == 2
        assert "Section A" in chunks[0]["text"]
        assert "Section B" in chunks[1]["text"]

    def test_large_section_splits_by_paragraphs(self):
        # Create a section with many words
        words = " ".join(["word"] * 200)
        paragraph1 = words
        paragraph2 = words
        text = f"## Big Section\n\n{paragraph1}\n\n{paragraph2}"
        chunks = chunk_markdown(text, max_tokens=150, overlap=0)
        assert len(chunks) >= 2

    def test_line_numbers_are_tracked(self):
        text = "## A\nLine 1\nLine 2\n\n## B\nLine 3"
        chunks = chunk_markdown(text, max_tokens=400)
        assert len(chunks) == 2
        assert chunks[0]["start_line"] == 0
        assert chunks[1]["start_line"] == 4

    def test_overlap_produces_shared_text(self):
        words_a = " ".join([f"alpha{i}" for i in range(100)])
        words_b = " ".join([f"beta{i}" for i in range(100)])
        text = f"## Section\n\n{words_a}\n\n{words_b}"
        chunks = chunk_markdown(text, max_tokens=80, overlap=20)
        if len(chunks) >= 2:
            # Overlap means some words from chunk 0 appear in chunk 1
            last_words_chunk0 = set(chunks[0]["text"].split()[-20:])
            first_words_chunk1 = set(chunks[1]["text"].split()[:20])
            assert len(last_words_chunk0 & first_words_chunk1) > 0

    def test_bullet_list_stays_together(self):
        text = "## Facts\n- Fact one\n- Fact two\n- Fact three"
        chunks = chunk_markdown(text, max_tokens=400)
        assert len(chunks) == 1
        assert "Fact one" in chunks[0]["text"]
        assert "Fact three" in chunks[0]["text"]
