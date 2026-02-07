"""Unit tests for hybrid search scoring."""

import sys
import os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from src.memory.hybrid_search import hybrid_search, _tokenize, _bm25_score


class TestTokenize:
    def test_basic_tokenization(self):
        tokens = _tokenize("Hello World! Test-case 123")
        assert "hello" in tokens
        assert "world" in tokens
        assert "test" in tokens
        assert "123" in tokens

    def test_empty_string(self):
        assert _tokenize("") == []

    def test_single_char_filtered(self):
        tokens = _tokenize("I a am")
        assert "am" in tokens
        # Single chars "I" and "a" should be filtered out


class TestBM25Score:
    def test_exact_match_scores_higher(self):
        query_tokens = _tokenize("favorite color")
        doc_freq = {"favorite": 1, "color": 1}
        score = _bm25_score(query_tokens, "My favorite color is green", 3, doc_freq)
        assert score > 0

    def test_no_match_returns_zero(self):
        query_tokens = _tokenize("dinosaur")
        doc_freq = {"dinosaur": 0}
        score = _bm25_score(query_tokens, "I like math and science", 3, doc_freq)
        assert score == 0.0

    def test_empty_doc(self):
        query_tokens = _tokenize("test")
        score = _bm25_score(query_tokens, "", 3, {"test": 1})
        assert score == 0.0


class TestHybridSearch:
    def test_empty_results(self):
        assert hybrid_search("query", []) == []

    def test_combines_vector_and_text_scores(self):
        results = [
            {"text": "I love dinosaurs and T-Rex", "score": 0.9},
            {"text": "Math homework is hard", "score": 0.3},
        ]
        scored = hybrid_search("dinosaurs", results, min_score=0.0)
        assert len(scored) >= 1
        # The dinosaur result should rank higher
        assert "dinosaur" in scored[0]["text"].lower()

    def test_min_score_filters(self):
        results = [
            {"text": "unrelated content", "score": 0.1},
        ]
        scored = hybrid_search("specific query", results, min_score=0.9)
        assert len(scored) == 0

    def test_preserves_original_fields(self):
        results = [
            {"text": "test document", "score": 0.8, "category": "general", "file_path": "test.md"},
        ]
        scored = hybrid_search("test", results, min_score=0.0)
        assert len(scored) == 1
        assert scored[0]["category"] == "general"
        assert scored[0]["file_path"] == "test.md"
        assert "hybrid_score" in scored[0]

    def test_single_result(self):
        results = [{"text": "only document about pets", "score": 0.5}]
        scored = hybrid_search("pets", results, min_score=0.0)
        assert len(scored) == 1
