-- =====================================================
-- Textbook RAG System - Database Schema Updates
-- =====================================================
-- Run this script on your existing database to add textbook management tables

-- Create textbooks table
CREATE TABLE IF NOT EXISTS textbooks (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    filename VARCHAR(255) NOT NULL COMMENT 'Stored filename (UUID_original.pdf)',
    original_filename VARCHAR(255) NOT NULL COMMENT 'Original filename as uploaded',
    grade VARCHAR(10) COMMENT 'Grade level (1-12)',
    subject VARCHAR(50) COMMENT 'Subject area (math, science, english, etc.)',
    language VARCHAR(10) DEFAULT 'en' COMMENT 'Content language (en, hi)',
    upload_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP COMMENT 'When file was uploaded',
    file_size BIGINT COMMENT 'File size in bytes',
    status VARCHAR(20) DEFAULT 'uploaded' COMMENT 'uploaded, processing, processed, failed',
    processed_chunks INTEGER DEFAULT 0 COMMENT 'Number of chunks processed',
    total_pages INTEGER COMMENT 'Total pages in PDF',
    qdrant_collection VARCHAR(100) COMMENT 'Qdrant collection name',
    created_by VARCHAR(100) COMMENT 'User who uploaded',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    
    INDEX idx_textbooks_grade_subject (grade, subject),
    INDEX idx_textbooks_status (status),
    INDEX idx_textbooks_created_at (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='Textbook metadata and processing status';

-- Create textbook_chunks table
CREATE TABLE IF NOT EXISTS textbook_chunks (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    textbook_id BIGINT NOT NULL COMMENT 'Reference to textbooks table',
    chunk_index INTEGER NOT NULL COMMENT 'Order of chunk in textbook (0, 1, 2...)',
    content TEXT NOT NULL COMMENT 'Extracted text content',
    page_number INTEGER COMMENT 'Source page number',
    chapter_title VARCHAR(200) COMMENT 'Chapter or section title',
    qdrant_point_id VARCHAR(100) COMMENT 'Qdrant vector point ID',
    embedding_status VARCHAR(20) DEFAULT 'pending' COMMENT 'pending, generated, uploaded, failed',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    FOREIGN KEY (textbook_id) REFERENCES textbooks(id) ON DELETE CASCADE,
    INDEX idx_chunks_textbook_id (textbook_id),
    INDEX idx_chunks_embedding_status (embedding_status),
    UNIQUE KEY unique_textbook_chunk (textbook_id, chunk_index)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='Text chunks extracted from textbooks';

-- Create rag_usage_stats table
CREATE TABLE IF NOT EXISTS rag_usage_stats (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    question_hash VARCHAR(64) NOT NULL COMMENT 'MD5 hash of question for privacy',
    grade VARCHAR(10) COMMENT 'Student grade level',
    subject VARCHAR(50) COMMENT 'Subject area',
    language VARCHAR(10) COMMENT 'Response language',
    response_time_ms INTEGER COMMENT 'Total response time in milliseconds',
    chunks_retrieved INTEGER COMMENT 'Number of chunks returned',
    accuracy_rating INTEGER COMMENT 'User feedback rating (1-5)',
    query_date DATE NOT NULL COMMENT 'Date of query',
    query_timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    device_id VARCHAR(100) COMMENT 'Device that made the query',
    
    INDEX idx_usage_stats_date (query_date),
    INDEX idx_usage_stats_grade_subject (grade, subject),
    INDEX idx_usage_stats_question_hash (question_hash)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='RAG usage analytics and performance metrics';

-- Create textbook_processing_logs table (for debugging)
CREATE TABLE IF NOT EXISTS textbook_processing_logs (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    textbook_id BIGINT NOT NULL,
    step VARCHAR(50) NOT NULL COMMENT 'processing step (pdf_extract, chunking, embedding, upload)',
    status VARCHAR(20) NOT NULL COMMENT 'success, error, warning',
    message TEXT COMMENT 'Log message or error details',
    execution_time_ms INTEGER COMMENT 'Time taken for this step',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    FOREIGN KEY (textbook_id) REFERENCES textbooks(id) ON DELETE CASCADE,
    INDEX idx_processing_logs_textbook (textbook_id),
    INDEX idx_processing_logs_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='Processing logs for debugging and monitoring';

-- Insert sample data for testing (optional)
-- INSERT INTO textbooks (filename, original_filename, grade, subject, language, file_size, status) VALUES
-- ('sample_math_grade5.pdf', 'NCERT_Mathematics_Grade5.pdf', '5', 'math', 'en', 1024000, 'uploaded'),
-- ('sample_science_grade8.pdf', 'NCERT_Science_Grade8.pdf', '8', 'science', 'en', 2048000, 'processed');

-- Verify tables were created
SELECT 
    TABLE_NAME, 
    TABLE_ROWS, 
    TABLE_COMMENT 
FROM 
    INFORMATION_SCHEMA.TABLES 
WHERE 
    TABLE_SCHEMA = DATABASE() 
    AND TABLE_NAME IN ('textbooks', 'textbook_chunks', 'rag_usage_stats', 'textbook_processing_logs');

-- Show table structures
DESCRIBE textbooks;
DESCRIBE textbook_chunks;
DESCRIBE rag_usage_stats;
DESCRIBE textbook_processing_logs;