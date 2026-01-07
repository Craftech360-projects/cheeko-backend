-- ============================================================================
-- V1_5_0: RFID Content Pack for RAG System
-- Stores markdown content files for read-only TTS playback
-- ============================================================================

-- Table: rfid_content_pack
-- Stores content packs with full markdown content for RFID cards
CREATE TABLE IF NOT EXISTS rfid_content_pack (
    id              BIGINT AUTO_INCREMENT PRIMARY KEY,
    pack_code       VARCHAR(50) NOT NULL UNIQUE COMMENT 'Unique pack identifier (e.g., RHYMES_EN_01)',
    name            VARCHAR(200) COMMENT 'Display name (e.g., Classic Nursery Rhymes)',
    description     TEXT COMMENT 'Pack description',
    content_type    VARCHAR(20) DEFAULT 'read_only' COMMENT 'Content type: read_only (TTS only) or prompt (send to LLM)',
    content_md      LONGTEXT COMMENT 'Full markdown content with numbered sections',
    total_items     INT DEFAULT 0 COMMENT 'Total number of items in the pack',
    language        VARCHAR(10) DEFAULT 'en' COMMENT 'Language code (en, hi, etc.)',
    active          TINYINT DEFAULT 1 COMMENT 'Active status: 0=Disabled, 1=Enabled',
    creator         BIGINT COMMENT 'Creator user ID',
    create_date     DATETIME DEFAULT CURRENT_TIMESTAMP COMMENT 'Creation timestamp',
    updater         BIGINT COMMENT 'Last updater user ID',
    update_date     DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT 'Last update timestamp',

    INDEX idx_pack_code (pack_code),
    INDEX idx_content_type (content_type),
    INDEX idx_language (language),
    INDEX idx_active (active)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='RFID Content Packs for RAG System';

-- Add content_pack_id to rfid_card_mapping table
ALTER TABLE rfid_card_mapping
ADD COLUMN content_pack_id BIGINT COMMENT 'FK to rfid_content_pack table' AFTER pack_id;

-- Add foreign key constraint
ALTER TABLE rfid_card_mapping
ADD CONSTRAINT fk_rfid_card_content_pack
FOREIGN KEY (content_pack_id) REFERENCES rfid_content_pack(id) ON DELETE SET NULL;

-- Add index for faster lookups
CREATE INDEX idx_rfid_card_content_pack ON rfid_card_mapping(content_pack_id);

-- ============================================================================
-- Sample Data: Classic Nursery Rhymes Pack
-- ============================================================================

INSERT INTO rfid_content_pack (pack_code, name, description, content_type, content_md, total_items, language, active)
VALUES (
    'RHYMES_EN_01',
    'Classic Nursery Rhymes',
    'A collection of 10 classic English nursery rhymes for children',
    'read_only',
    '# 🌟 Classic Nursery Rhymes Collection

---

## 1. Twinkle Twinkle Little Star

Twinkle, twinkle, little star,
How I wonder what you are!
Up above the world so high,
Like a diamond in the sky.

Twinkle, twinkle, little star,
How I wonder what you are!

---

## 2. Humpty Dumpty Sat on a Wall

Humpty Dumpty sat on a wall,
Humpty Dumpty had a great fall.
All the king''s horses and all the king''s men
Couldn''t put Humpty together again.

---

## 3. Incy Wincy Spider

Incy Wincy spider climbed up the water spout,
Down came the rain and washed the spider out.
Out came the sunshine and dried up all the rain,
And Incy Wincy spider climbed up the spout again.

---

## 4. Row Row Row Your Boat

Row, row, row your boat,
Gently down the stream.
Merrily, merrily, merrily, merrily,
Life is but a dream.

---

## 5. Mary Had a Little Lamb

Mary had a little lamb,
Its fleece was white as snow;
And everywhere that Mary went,
The lamb was sure to go.

It followed her to school one day,
Which was against the rule;
It made the children laugh and play
To see a lamb at school.

---

## 6. Hickory Dickory Dock

Hickory dickory dock,
The mouse ran up the clock.
The clock struck one,
The mouse ran down,
Hickory dickory dock.

---

## 7. Jack and Jill Went Up the Hill

Jack and Jill went up the hill
To fetch a pail of water.
Jack fell down and broke his crown,
And Jill came tumbling after.

Up Jack got and home did trot,
As fast as he could caper;
Went to bed to mend his head
With vinegar and brown paper.

---

## 8. Itsy Bitsy Spider

The itsy bitsy spider climbed up the waterspout,
Down came the rain and washed the spider out.
Out came the sun and dried up all the rain,
And the itsy bitsy spider climbed up the spout again.

---

## 9. Hey Diddle Diddle

Hey diddle diddle,
The cat and the fiddle,
The cow jumped over the moon;
The little dog laughed
To see such sport,
And the dish ran away with the spoon.

---

## 10. London Bridge Is Falling Down

London Bridge is falling down,
Falling down, falling down,
London Bridge is falling down,
My fair lady.

Build it up with silver and gold,
Silver and gold, silver and gold,
Build it up with silver and gold,
My fair lady.

---

✨ End of Collection',
    10,
    'en',
    1
);
