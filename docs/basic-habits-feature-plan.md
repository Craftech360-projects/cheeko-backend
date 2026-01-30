# Basic Habits RFID Card Feature - Implementation Plan (Updated)

## Overview

Add support for "Basic Habits" RFID cards where each habit has 10 steps with audio and images stored in AWS S3. When a card is tapped and content is not on the device's SD card, the server returns downloadable URLs.

**Key Change:** Reuse existing `rfid_pack` table instead of creating a new `habit_pack` table.

## Architecture Flow

```
ESP32 (RFID tap, content missing)
        ↓
MQTT: { type: "habit_download_request", rfid_uid: "..." }
        ↓
MQTT Gateway (Node.js)
  → fetchHabitDownloadManifest()
        ↓
Manager API (Java)
  → GET /toy/admin/rfid/habit/download/{rfidUid}
        ↓
Response with all download URLs
        ↓
Device downloads files to SD card
```

---

## 1. Database Schema (Simplified - Only 2 New Tables)

**File:** `main/manager-api/src/main/resources/db/changelog/V1_9_0__basic_habits_tables.sql`

```sql
-- Reuse existing rfid_pack table for pack metadata
-- Only create 2 new tables: habit and habit_step

-- Table 1: habit (links to existing rfid_pack)
CREATE TABLE habit (
    id              BIGINT AUTO_INCREMENT PRIMARY KEY,
    pack_id         BIGINT NOT NULL COMMENT 'FK to rfid_pack',
    habit_code      VARCHAR(50) NOT NULL UNIQUE,
    name            VARCHAR(200) NOT NULL,
    description     TEXT,
    sequence        INT NOT NULL COMMENT 'Order within pack',
    total_steps     INT DEFAULT 10,
    version         VARCHAR(20) DEFAULT '1.0.0',
    content_hash    VARCHAR(64) COMMENT 'For cache validation',
    thumbnail_url   VARCHAR(500),
    active          TINYINT DEFAULT 1,
    creator         BIGINT,
    create_date     DATETIME DEFAULT CURRENT_TIMESTAMP,
    updater         BIGINT,
    update_date     DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (pack_id) REFERENCES rfid_pack(id)
);

-- Table 2: habit_step (media files per step)
CREATE TABLE habit_step (
    id              BIGINT AUTO_INCREMENT PRIMARY KEY,
    habit_id        BIGINT NOT NULL,
    step_number     INT NOT NULL,
    title           VARCHAR(200),
    instruction_text TEXT,
    audio_url       VARCHAR(500),
    audio_size_bytes BIGINT,
    audio_duration_ms INT,
    images_json     JSON COMMENT '[{"url":"...","sizeBytes":123}]',
    active          TINYINT DEFAULT 1,
    create_date     DATETIME DEFAULT CURRENT_TIMESTAMP,
    update_date     DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uk_habit_step (habit_id, step_number),
    FOREIGN KEY (habit_id) REFERENCES habit(id) ON DELETE CASCADE
);

-- Add habit_id to rfid_card_mapping
ALTER TABLE rfid_card_mapping
ADD COLUMN habit_id BIGINT COMMENT 'FK to habit' AFTER content_pack_id,
ADD CONSTRAINT fk_rfid_card_habit FOREIGN KEY (habit_id) REFERENCES habit(id) ON DELETE SET NULL;
```

**Table Relationships:**
```
rfid_pack (existing)       habit (new)              habit_step (new)
┌──────────────────┐      ┌──────────────────┐     ┌──────────────────┐
│ id               │◄─────│ pack_id          │     │ habit_id         │
│ pack_code        │      │ habit_code       │◄────│ step_number      │
│ name             │      │ name             │     │ title            │
│ description      │      │ sequence         │     │ audio_url        │
└──────────────────┘      │ version          │     │ images_json      │
                          └──────────────────┘     └──────────────────┘
                                   ▲
                                   │
                          rfid_card_mapping
                          ┌──────────────────┐
                          │ rfid_uid         │
                          │ habit_id (new)   │
                          └──────────────────┘
```

---

## 2. The 5 Basic Habits

| # | Habit | Code | Steps | Files per Step |
|---|-------|------|-------|----------------|
| 1 | Brushing Teeth | `brush-teeth` | 10 | 1 audio + 1 image |
| 2 | Tying Shoelace | `tie-shoelace` | 10 | 1 audio + 1 image |
| 3 | Washing Hands | `wash-hands` | 10 | 1 audio + 1 image |
| 4 | Making Bed | `make-bed` | 10 | 1 audio + 1 image |
| 5 | Meal Time | `meal-time` | 10 | 1 audio + 1 image |

---

## 3. S3 File Structure

```
s3://cheeko-content/habits/
├── brush-teeth/
│   ├── step-01/
│   │   ├── audio.mp3
│   │   └── image.jpg
│   └── ... (step-02 to step-10)
├── tie-shoelace/
├── wash-hands/
├── make-bed/
└── meal-time/
```

**CDN URL Pattern:** `https://d23u4d6oyrni77.cloudfront.net/habits/{habit-code}/step-{NN}/audio.mp3`

---

## 4. Manager API Changes

### New Files to Create

| File | Purpose |
|------|---------|
| `entity/HabitEntity.java` | Entity for habit table |
| `entity/HabitStepEntity.java` | Entity for habit_step table |
| `dto/HabitDownloadDTO.java` | Response DTO with manifest |
| `dto/HabitStepDTO.java` | Step details DTO |
| `dao/HabitDao.java` | MyBatis-Plus mapper |
| `dao/HabitStepDao.java` | MyBatis-Plus mapper |
| `service/HabitService.java` | Service interface |
| `service/impl/HabitServiceImpl.java` | Business logic |

### Files to Modify

| File | Changes |
|------|---------|
| `entity/RfidCardMappingEntity.java` | Add `habitId` field |
| `controller/RfidCardMappingController.java` | Add download endpoint |

### API Endpoint

```
GET /toy/admin/rfid/habit/download/{rfidUid}
```

**Response:**
```json
{
  "code": 0,
  "data": {
    "rfidUid": "A1B2C3D4",
    "habitCode": "brush-teeth",
    "habitName": "Brushing Teeth",
    "version": "1.0.0",
    "contentHash": "sha256:...",
    "totalSteps": 10,
    "totalSizeBytes": 5242880,
    "steps": [
      {
        "stepNumber": 1,
        "title": "Wet your toothbrush",
        "audio": {
          "url": "https://cdn.../habits/brush-teeth/step-01/audio.mp3",
          "sizeBytes": 156000
        },
        "images": [
          { "url": "https://cdn.../habits/brush-teeth/step-01/image.jpg", "sizeBytes": 45000 }
        ]
      }
    ]
  }
}
```

---

## 5. MQTT Gateway Changes

**File:** `main/mqtt-gateway/gateway/mqtt-gateway.js`

### Message Type: `habit_download_request`

**Request (Device → Server):**
```json
{
  "type": "habit_download_request",
  "rfid_uid": "A1B2C3D4",
  "current_version": "1.0.0"
}
```

**Response (Server → Device):**
```json
{
  "type": "habit_download_response",
  "status": "download_required",
  "rfid_uid": "A1B2C3D4",
  "habit_code": "brush-teeth",
  "habit_name": "Brushing Teeth",
  "version": "1.0.0",
  "total_steps": 10,
  "total_size_bytes": 5242880,
  "manifest": [
    {
      "step": 1,
      "audio_url": "https://cdn.../step-01/audio.mp3",
      "audio_size": 156000,
      "images": [{ "url": "https://cdn.../step-01/image.jpg", "size": 45000 }]
    }
  ]
}
```

**Status values:** `download_required`, `up_to_date`, `not_found`, `error`

---

## 6. Implementation Order

1. Database Migration (Liquibase)
2. Manager API Entities
3. Manager API DAOs + XML mappers
4. Manager API DTOs
5. Manager API Service
6. Manager API Controller endpoint
7. MQTT Gateway handler
8. Seed data for 5 habits

---

## 7. Files to Create/Modify

### Create (Manager API)
- `src/main/resources/db/changelog/V1_9_0__basic_habits_tables.sql`
- `src/main/java/cheeko/modules/rfid/entity/HabitEntity.java`
- `src/main/java/cheeko/modules/rfid/entity/HabitStepEntity.java`
- `src/main/java/cheeko/modules/rfid/dto/HabitDownloadDTO.java`
- `src/main/java/cheeko/modules/rfid/dto/HabitStepDTO.java`
- `src/main/java/cheeko/modules/rfid/dao/HabitDao.java`
- `src/main/java/cheeko/modules/rfid/dao/HabitStepDao.java`
- `src/main/java/cheeko/modules/rfid/service/HabitService.java`
- `src/main/java/cheeko/modules/rfid/service/impl/HabitServiceImpl.java`

### Modify (Manager API)
- `src/main/java/cheeko/modules/rfid/entity/RfidCardMappingEntity.java`
- `src/main/java/cheeko/modules/rfid/controller/RfidCardMappingController.java`
- `src/main/resources/db/changelog/db.changelog-master.yaml`

### Modify (MQTT Gateway)
- `main/mqtt-gateway/gateway/mqtt-gateway.js`

---

## 8. Seed Data

```sql
-- Insert into existing rfid_pack
INSERT INTO rfid_pack (pack_code, name, description, active, create_date)
VALUES ('HABITS_EN_01', 'Basic Habits Pack', 'Essential daily habits for children', 1, NOW());

-- Insert 5 habits
INSERT INTO habit (pack_id, habit_code, name, description, sequence, total_steps, version) VALUES
((SELECT id FROM rfid_pack WHERE pack_code='HABITS_EN_01'), 'brush-teeth', 'Brushing Teeth', 'How to brush teeth properly', 1, 10, '1.0.0'),
((SELECT id FROM rfid_pack WHERE pack_code='HABITS_EN_01'), 'tie-shoelace', 'Tying Shoelace', 'How to tie shoelaces', 2, 10, '1.0.0'),
((SELECT id FROM rfid_pack WHERE pack_code='HABITS_EN_01'), 'wash-hands', 'Washing Hands', 'Proper hand washing', 3, 10, '1.0.0'),
((SELECT id FROM rfid_pack WHERE pack_code='HABITS_EN_01'), 'make-bed', 'Making Bed', 'How to make your bed', 4, 10, '1.0.0'),
((SELECT id FROM rfid_pack WHERE pack_code='HABITS_EN_01'), 'meal-time', 'Meal Time', 'Good eating habits', 5, 10, '1.0.0');

-- Steps inserted with actual S3 URLs once files uploaded
```

---

## 9. Verification

1. Run Liquibase migration
2. Test API: `GET /toy/admin/rfid/habit/download/{uid}`
3. Test MQTT: Send `habit_download_request`, verify response
4. End-to-end: RFID tap → download manifest
