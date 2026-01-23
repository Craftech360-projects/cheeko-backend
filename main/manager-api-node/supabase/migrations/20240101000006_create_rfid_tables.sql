-- Migration: Create RFID Tables
-- Description: RFID card mappings, packs, questions, and content

-- =============================================
-- rfid_pack - RFID product packs/SKUs
-- =============================================
CREATE TABLE IF NOT EXISTS rfid_pack (
    id BIGSERIAL PRIMARY KEY,
    pack_code VARCHAR(100) UNIQUE NOT NULL,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    age_min INTEGER,
    age_max INTEGER,
    active BOOLEAN DEFAULT TRUE,
    creator BIGINT,
    create_date TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updater BIGINT,
    update_date TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_rfid_pack_code ON rfid_pack(pack_code);
CREATE INDEX idx_rfid_pack_active ON rfid_pack(active);

COMMENT ON TABLE rfid_pack IS 'RFID product packs/SKUs';
COMMENT ON COLUMN rfid_pack.pack_code IS 'Unique identifier (e.g., BLINKIT_ANIMALS_PACK_1)';

-- =============================================
-- rfid_question - Question templates
-- =============================================
CREATE TABLE IF NOT EXISTS rfid_question (
    id BIGSERIAL PRIMARY KEY,
    code VARCHAR(100) UNIQUE NOT NULL,
    title VARCHAR(255) NOT NULL,
    prompt_text TEXT NOT NULL,
    language VARCHAR(10) DEFAULT 'en',
    category VARCHAR(100),
    difficulty INTEGER DEFAULT 1,
    active BOOLEAN DEFAULT TRUE,
    creator BIGINT,
    create_date TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updater BIGINT,
    update_date TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_rfid_question_code ON rfid_question(code);
CREATE INDEX idx_rfid_question_category ON rfid_question(category);
CREATE INDEX idx_rfid_question_language ON rfid_question(language);
CREATE INDEX idx_rfid_question_active ON rfid_question(active);

COMMENT ON TABLE rfid_question IS 'RFID question templates';
COMMENT ON COLUMN rfid_question.code IS 'Identifier (e.g., ANIMALS_10)';
COMMENT ON COLUMN rfid_question.prompt_text IS 'Prompt to send to LLM';
COMMENT ON COLUMN rfid_question.difficulty IS '1-5 difficulty level';

-- =============================================
-- rfid_content_pack - RAG-ready content packs
-- =============================================
CREATE TABLE IF NOT EXISTS rfid_content_pack (
    id BIGSERIAL PRIMARY KEY,
    pack_code VARCHAR(100) UNIQUE NOT NULL,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    content_type VARCHAR(50) DEFAULT 'prompt',
    content_md TEXT,
    total_items INTEGER DEFAULT 0,
    language VARCHAR(10) DEFAULT 'en',
    active BOOLEAN DEFAULT TRUE,
    creator BIGINT,
    create_date TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updater BIGINT,
    update_date TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_rfid_content_pack_code ON rfid_content_pack(pack_code);
CREATE INDEX idx_rfid_content_pack_type ON rfid_content_pack(content_type);
CREATE INDEX idx_rfid_content_pack_active ON rfid_content_pack(active);

COMMENT ON TABLE rfid_content_pack IS 'RFID content for RAG/TTS';
COMMENT ON COLUMN rfid_content_pack.content_type IS 'read_only (TTS only) or prompt';
COMMENT ON COLUMN rfid_content_pack.content_md IS 'Full markdown content';

-- =============================================
-- rfid_series - RFID UID range mappings
-- =============================================
CREATE TABLE IF NOT EXISTS rfid_series (
    id BIGSERIAL PRIMARY KEY,
    start_uid VARCHAR(50) NOT NULL,
    end_uid VARCHAR(50) NOT NULL,
    question_id BIGINT REFERENCES rfid_question(id) ON DELETE SET NULL,
    pack_id BIGINT REFERENCES rfid_pack(id) ON DELETE SET NULL,
    priority INTEGER DEFAULT 0,
    notes VARCHAR(500),
    active BOOLEAN DEFAULT TRUE,
    creator BIGINT,
    create_date TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updater BIGINT,
    update_date TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_rfid_series_uid_range ON rfid_series(start_uid, end_uid);
CREATE INDEX idx_rfid_series_question ON rfid_series(question_id);
CREATE INDEX idx_rfid_series_pack ON rfid_series(pack_id);
CREATE INDEX idx_rfid_series_active ON rfid_series(active);

COMMENT ON TABLE rfid_series IS 'RFID UID range mappings';
COMMENT ON COLUMN rfid_series.start_uid IS 'Start of UID range (hex)';
COMMENT ON COLUMN rfid_series.end_uid IS 'End of UID range (hex)';
COMMENT ON COLUMN rfid_series.priority IS 'Higher priority wins if multiple matches';

-- =============================================
-- rfid_card_mapping - Individual card mappings
-- =============================================
CREATE TABLE IF NOT EXISTS rfid_card_mapping (
    id BIGSERIAL PRIMARY KEY,
    rfid_uid VARCHAR(50) UNIQUE NOT NULL,
    question_id BIGINT REFERENCES rfid_question(id) ON DELETE SET NULL,
    question_ids JSONB DEFAULT '[]',
    pack_code VARCHAR(100),
    pack_id BIGINT REFERENCES rfid_pack(id) ON DELETE SET NULL,
    content_pack_id BIGINT REFERENCES rfid_content_pack(id) ON DELETE SET NULL,
    notes VARCHAR(500),
    active BOOLEAN DEFAULT TRUE,
    creator BIGINT,
    create_date TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updater BIGINT,
    update_date TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_rfid_card_mapping_uid ON rfid_card_mapping(rfid_uid);
CREATE INDEX idx_rfid_card_mapping_question ON rfid_card_mapping(question_id);
CREATE INDEX idx_rfid_card_mapping_pack ON rfid_card_mapping(pack_id);
CREATE INDEX idx_rfid_card_mapping_content ON rfid_card_mapping(content_pack_id);
CREATE INDEX idx_rfid_card_mapping_active ON rfid_card_mapping(active);

COMMENT ON TABLE rfid_card_mapping IS 'RFID card to content mappings';
COMMENT ON COLUMN rfid_card_mapping.rfid_uid IS 'RFID UID in hex format';
COMMENT ON COLUMN rfid_card_mapping.question_ids IS 'JSON array of question IDs (multi-question support)';
COMMENT ON COLUMN rfid_card_mapping.content_pack_id IS 'FK to rfid_content_pack for RAG';
