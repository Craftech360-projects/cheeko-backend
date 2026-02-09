-- Memory chunks table for Cheeko memory system (Supabase backend)
-- Stores text chunks with pgvector embeddings for semantic search.
-- Uses PostgreSQL FTS (tsvector + GIN) for keyword search.

-- Enable pgvector extension
CREATE EXTENSION IF NOT EXISTS vector;

-- Chunks table (vectors + text)
CREATE TABLE IF NOT EXISTS memory_chunks (
    id BIGSERIAL PRIMARY KEY,
    mac_id TEXT NOT NULL,
    text TEXT NOT NULL,
    file_path TEXT,
    start_line INTEGER DEFAULT 0,
    end_line INTEGER DEFAULT 0,
    embedding vector(384),
    category TEXT DEFAULT 'general',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    content_hash TEXT NOT NULL,
    UNIQUE(mac_id, content_hash)
);

-- Index for fast device lookup
CREATE INDEX IF NOT EXISTS idx_memory_chunks_mac ON memory_chunks(mac_id);

-- HNSW index for fast vector similarity search (cosine distance)
CREATE INDEX IF NOT EXISTS idx_memory_chunks_embedding ON memory_chunks
    USING hnsw (embedding vector_cosine_ops);

-- GIN index for full-text search
CREATE INDEX IF NOT EXISTS idx_memory_chunks_fts ON memory_chunks
    USING GIN (to_tsvector('english', text));

COMMENT ON TABLE memory_chunks IS 'Per-device memory chunks with pgvector embeddings for Cheeko memory system';

-- RPC function: Vector similarity search
CREATE OR REPLACE FUNCTION match_memory_chunks(
    query_mac_id TEXT,
    query_embedding vector(384),
    match_count INT DEFAULT 5
)
RETURNS TABLE (
    id BIGINT,
    text TEXT,
    file_path TEXT,
    category TEXT,
    similarity FLOAT
)
LANGUAGE plpgsql AS $$
BEGIN
    RETURN QUERY
    SELECT c.id, c.text, c.file_path, c.category,
           (1 - (c.embedding <=> query_embedding))::FLOAT AS similarity
    FROM memory_chunks c
    WHERE c.mac_id = query_mac_id
      AND c.embedding IS NOT NULL
    ORDER BY c.embedding <=> query_embedding
    LIMIT match_count;
END;
$$;

-- RPC function: Full-text search
CREATE OR REPLACE FUNCTION fts_memory_chunks(
    query_mac_id TEXT,
    search_query TEXT,
    match_count INT DEFAULT 5
)
RETURNS TABLE (
    id BIGINT,
    text TEXT,
    file_path TEXT,
    category TEXT,
    rank FLOAT
)
LANGUAGE plpgsql AS $$
BEGIN
    RETURN QUERY
    SELECT c.id, c.text, c.file_path, c.category,
           ts_rank(to_tsvector('english', c.text), plainto_tsquery('english', search_query))::FLOAT AS rank
    FROM memory_chunks c
    WHERE c.mac_id = query_mac_id
      AND to_tsvector('english', c.text) @@ plainto_tsquery('english', search_query)
    ORDER BY rank DESC
    LIMIT match_count;
END;
$$;
