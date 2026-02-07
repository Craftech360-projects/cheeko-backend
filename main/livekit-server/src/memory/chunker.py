"""
Markdown-aware text chunker for memory indexing.
Splits text on markdown headings first, then paragraph boundaries.
"""

import re
from typing import List, Dict


def chunk_markdown(text: str, max_tokens: int = 400, overlap: int = 80) -> List[Dict]:
    """Split text into chunks suitable for embedding.

    Strategy:
    1. Split on markdown headings (##) first.
    2. If a section exceeds max_tokens, split on paragraph boundaries.
    3. Apply overlap between consecutive chunks.

    Args:
        text: Input text (plain or markdown).
        max_tokens: Max approximate tokens per chunk (word count).
        overlap: Number of overlapping words between chunks.

    Returns:
        List of dicts: {"text": str, "start_line": int, "end_line": int}
    """
    if not text or not text.strip():
        return []

    lines = text.split("\n")
    sections = _split_by_headings(lines)
    chunks = []

    for section in sections:
        section_text = "\n".join(section["lines"]).strip()
        if not section_text:
            continue

        word_count = len(section_text.split())
        if word_count <= max_tokens:
            chunks.append({
                "text": section_text,
                "start_line": section["start_line"],
                "end_line": section["end_line"],
            })
        else:
            # Split large section into paragraph-based chunks
            sub_chunks = _split_by_paragraphs(
                section["lines"],
                section["start_line"],
                max_tokens,
                overlap,
            )
            chunks.extend(sub_chunks)

    return chunks


def _split_by_headings(lines: List[str]) -> List[Dict]:
    """Split lines into sections by markdown headings (## or more)."""
    sections = []
    current_lines = []
    current_start = 0

    for i, line in enumerate(lines):
        if re.match(r"^#{1,6}\s", line) and current_lines:
            sections.append({
                "lines": current_lines,
                "start_line": current_start,
                "end_line": current_start + len(current_lines) - 1,
            })
            current_lines = [line]
            current_start = i
        else:
            if not current_lines:
                current_start = i
            current_lines.append(line)

    if current_lines:
        sections.append({
            "lines": current_lines,
            "start_line": current_start,
            "end_line": current_start + len(current_lines) - 1,
        })

    return sections


def _split_by_paragraphs(
    lines: List[str],
    base_line: int,
    max_tokens: int,
    overlap: int,
) -> List[Dict]:
    """Split lines into chunks at paragraph boundaries with overlap."""
    paragraphs = []
    current_para = []
    para_start = 0

    for i, line in enumerate(lines):
        if line.strip() == "" and current_para:
            paragraphs.append({
                "lines": current_para,
                "start": para_start,
                "end": i - 1,
            })
            current_para = []
        else:
            if not current_para:
                para_start = i
            current_para.append(line)

    if current_para:
        paragraphs.append({
            "lines": current_para,
            "start": para_start,
            "end": len(lines) - 1,
        })

    # Merge paragraphs into chunks up to max_tokens
    chunks = []
    current_chunk_lines = []
    chunk_start = 0
    current_word_count = 0

    for para in paragraphs:
        para_text = "\n".join(para["lines"])
        para_words = len(para_text.split())

        if current_word_count + para_words > max_tokens and current_chunk_lines:
            chunk_text = "\n".join(current_chunk_lines).strip()
            if chunk_text:
                chunks.append({
                    "text": chunk_text,
                    "start_line": base_line + chunk_start,
                    "end_line": base_line + para["start"] - 1,
                })

            # Overlap: keep the last few words from current chunk
            if overlap > 0 and current_chunk_lines:
                overlap_text = " ".join(chunk_text.split()[-overlap:])
                current_chunk_lines = [overlap_text]
                current_word_count = overlap
            else:
                current_chunk_lines = []
                current_word_count = 0

            chunk_start = para["start"]

        current_chunk_lines.extend(para["lines"])
        current_word_count += para_words

    # Final chunk
    if current_chunk_lines:
        chunk_text = "\n".join(current_chunk_lines).strip()
        if chunk_text:
            last_para = paragraphs[-1] if paragraphs else {"end": len(lines) - 1}
            chunks.append({
                "text": chunk_text,
                "start_line": base_line + chunk_start,
                "end_line": base_line + last_para["end"],
            })

    return chunks
