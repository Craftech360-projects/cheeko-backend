"""
Hybrid search combining vector cosine similarity with BM25-style text scoring.
"""

import math
import re
from typing import List, Dict


def hybrid_search(
    query: str,
    results: List[Dict],
    vector_weight: float = 0.7,
    text_weight: float = 0.3,
    min_score: float = 0.35,
) -> List[Dict]:
    """Merge vector similarity scores with BM25-style text scores.

    Args:
        query: Search query string.
        results: List of dicts with keys: text, score (vector cosine similarity).
        vector_weight: Weight for vector similarity score.
        text_weight: Weight for BM25 text score.
        min_score: Minimum combined score threshold.

    Returns:
        Sorted list of results with combined 'hybrid_score' field.
    """
    if not results:
        return []

    query_tokens = _tokenize(query)
    if not query_tokens:
        return sorted(results, key=lambda r: r.get("score", 0), reverse=True)

    # Compute IDF for query terms across all result documents
    doc_count = len(results)
    doc_freq = {}
    for token in set(query_tokens):
        count = sum(1 for r in results if token in _tokenize(r.get("text", "")))
        doc_freq[token] = count

    # Normalize vector scores to [0, 1]
    vector_scores = [r.get("score", 0) for r in results]
    max_vec = max(vector_scores) if vector_scores else 1.0
    min_vec = min(vector_scores) if vector_scores else 0.0
    vec_range = max_vec - min_vec if max_vec != min_vec else 1.0

    scored_results = []
    for r in results:
        # Normalized vector score
        vec_score = (r.get("score", 0) - min_vec) / vec_range

        # BM25-style text score
        text_score = _bm25_score(query_tokens, r.get("text", ""), doc_count, doc_freq)

        # Combined score
        combined = (vector_weight * vec_score) + (text_weight * text_score)

        if combined >= min_score:
            result_copy = dict(r)
            result_copy["hybrid_score"] = combined
            result_copy["vector_score"] = vec_score
            result_copy["text_score"] = text_score
            scored_results.append(result_copy)

    scored_results.sort(key=lambda r: r["hybrid_score"], reverse=True)
    return scored_results


def _tokenize(text: str) -> List[str]:
    """Simple whitespace + punctuation tokenizer with lowercasing."""
    return [t for t in re.findall(r"\w+", text.lower()) if len(t) > 1]


def _bm25_score(
    query_tokens: List[str],
    doc_text: str,
    doc_count: int,
    doc_freq: Dict[str, int],
    k1: float = 1.2,
    b: float = 0.75,
    avg_dl: float = 100.0,
) -> float:
    """Compute BM25-style relevance score for a document.

    Args:
        query_tokens: Tokenized query.
        doc_text: Document text.
        doc_count: Total number of documents.
        doc_freq: Dict mapping query tokens to document frequency.
        k1: Term frequency saturation parameter.
        b: Length normalization parameter.
        avg_dl: Average document length (approximate).

    Returns:
        Normalized BM25 score in [0, 1].
    """
    doc_tokens = _tokenize(doc_text)
    dl = len(doc_tokens)
    if dl == 0:
        return 0.0

    token_counts = {}
    for t in doc_tokens:
        token_counts[t] = token_counts.get(t, 0) + 1

    score = 0.0
    for token in query_tokens:
        tf = token_counts.get(token, 0)
        if tf == 0:
            continue

        df = doc_freq.get(token, 0)
        # IDF with smoothing
        idf = math.log((doc_count - df + 0.5) / (df + 0.5) + 1.0)

        # BM25 term score
        numerator = tf * (k1 + 1)
        denominator = tf + k1 * (1 - b + b * (dl / avg_dl))
        score += idf * (numerator / denominator)

    # Normalize to [0, 1] using sigmoid-like function
    if score <= 0:
        return 0.0
    return score / (score + 1.0)
