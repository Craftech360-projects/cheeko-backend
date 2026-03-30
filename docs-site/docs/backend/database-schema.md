---
id: database-schema
sidebar_position: 1
---

# Database Schema Reference

Cheeko uses DigitalOcean Managed PostgreSQL with Prisma ORM. This page documents every model in the schema, grouped by domain.

## Entity Relationship Overview

### Users and Auth
- `sys_user` — core user account
- `sys_user_token` — session tokens
- `parent_profile` — parent-facing profile and notification preferences
- `user_question_quota` — monthly RFID question usage quota per user

### Devices
- `ai_device` — registered ESP32 devices
- `device_memories` — per-device daily memory files
- `device_token_usage` — daily LLM token and latency metrics per device

### Agents and AI
- `ai_agent` — user-created agent configurations
- `ai_agent_template` — pre-built agent templates
- `ai_agent_chat_history` — per-session chat turns
- `ai_model_provider` — model provider registry
- `ai_model_config` — individual model configurations
- `ai_tts_voice` — TTS voice definitions

### Content
- `ai_music` — music tracks
- `ai_story` — story audio content
- `ai_textbook` — textbook entries
- `ai_textbook_chapter` — chapters within a textbook
- `content_library` — unified content catalogue
- `device_playlist` — per-device content playlist
- `music_playlist` — device-specific music ordering
- `story_playlist` — device-specific story ordering

### RFID
- `rfid_series` — UID range-to-content mappings
- `rfid_pack` — question pack groups
- `rfid_content_pack` — content packs (prompts, audio)
- `rfid_question_pack` — bundles of questions referenced by ID list
- `rfid_question` — individual RFID-triggered questions
- `rfid_card_mapping` — explicit UID-to-content assignments
- `rfid_content_pack` — content packs with cached audio
- `content_item` — individual items within a content pack
- `ai_rfid_tag` — legacy RFID tag definitions
- `ai_rfid_scan_log` — legacy scan event log
- `rfid_tags` — simplified RFID tag registry
- `rfid_scan_log` — simplified scan log

### Kids
- `kid_profile` — child profile linked to a parent user
- `kid_activity_log` — per-child activity events
- `kid_learning_progress` — per-child subject/topic progress

### Analytics
- `analytics_game_sessions` — game session summaries
- `analytics_game_attempts` — individual question attempts within a session
- `analytics_media_playback` — media play/pause/complete events
- `analytics_streaks` — daily usage streak tracking
- `analytics_user_progress` — aggregate per-device progress counters
- `game_session` — legacy game session records

### System
- `sys_params` — key-value system configuration parameters
- `sys_dict_type` — dictionary category definitions
- `sys_dict_data` — dictionary entries
- `email_report_config` — scheduled email report configuration
- `email_report_history` — history of sent email reports
- `ai_ota` — OTA firmware release records
- `openclaw_pair_tokens` — short-lived pairing tokens for OpenClaw integration

### Vector Search
- `memory_chunks` — text chunks with pgvector embeddings for semantic retrieval

---

## Model Details

### sys_user

Purpose: Core user account. All other user-linked models reference this table.

| Field | Type | Nullable | Description |
|---|---|---|---|
| id | BigInt (autoincrement) | No | Primary key |
| firebase_uid | String (128) | Yes | Firebase Auth UID (unique) |
| username | String (100) | Yes | Unique login username |
| password | String (255) | Yes | Hashed password |
| email | String (255) | Yes | Unique email address |
| phone | String (50) | Yes | Phone number |
| nickname | String (100) | Yes | Display name |
| avatar | String (500) | Yes | Avatar URL |
| gender | Int | Yes | 0 = unset, 1 = male, 2 = female |
| status | Int | Yes | 1 = active, 0 = disabled |
| role | String (50) | Yes | User role (default: "user") |
| last_login_at | DateTime | Yes | Timestamp of last login |
| created_at | DateTime | Yes | Record creation time |
| updated_at | DateTime | Yes | Record update time |

---

### sys_user_token

Purpose: Session tokens issued at login, used to authenticate API requests.

| Field | Type | Nullable | Description |
|---|---|---|---|
| id | BigInt (autoincrement) | No | Primary key |
| user_id | BigInt | No | FK to sys_user |
| token | String (500) | No | Token value |
| expire_date | DateTime | No | Token expiry timestamp |
| created_at | DateTime | Yes | Record creation time |
| updated_at | DateTime | Yes | Record update time |

---

### parent_profile

Purpose: Extended profile for parent users, covering notification preferences and OpenClaw integration credentials.

| Field | Type | Nullable | Description |
|---|---|---|---|
| id | BigInt (autoincrement) | No | Primary key |
| user_id | BigInt | Yes | Unique FK to sys_user |
| email | String (255) | Yes | Contact email |
| phone_number | String (50) | Yes | Contact phone |
| display_name | String (255) | Yes | Display name |
| avatar_url | String (500) | Yes | Avatar image URL |
| timezone | String (50) | Yes | User timezone |
| language | String (10) | Yes | Preferred language (default: "en") |
| email_notifications | Boolean | Yes | Email notification opt-in (default: true) |
| push_notifications | Boolean | Yes | Push notification opt-in (default: true) |
| weekly_report | Boolean | Yes | Weekly report opt-in (default: true) |
| onboarding_completed | Boolean | Yes | Whether onboarding flow is done |
| terms_accepted_at | DateTime | Yes | Timestamp when terms were accepted |
| terms_version | String (20) | Yes | Version of terms accepted |
| openclaw_url | String | Yes | OpenClaw server URL for this parent |
| openclaw_token | String | Yes | OpenClaw auth token |
| created_at | DateTime | Yes | Record creation time |
| updated_at | DateTime | Yes | Record update time |

---

### user_question_quota

Purpose: Tracks how many RFID-triggered questions a user has consumed in a given calendar month and how many extra questions have been purchased.

| Field | Type | Nullable | Description |
|---|---|---|---|
| id | BigInt (autoincrement) | No | Primary key |
| user_id | BigInt | No | FK to sys_user |
| month_key | String (7) | No | Month identifier in YYYY-MM format |
| questions_used | Int | No | Questions consumed this month (default: 0) |
| extra_purchased | Int | No | Additional questions purchased (default: 0) |
| created_at | DateTime | Yes | Record creation time |
| updated_at | DateTime | Yes | Record update time |

Unique constraint: (user_id, month_key).

---

### ai_device

Purpose: Registered ESP32 Cheeko devices, linking a physical MAC address to a user, agent configuration, and child profile.

| Field | Type | Nullable | Description |
|---|---|---|---|
| id | UUID | No | Primary key |
| user_id | BigInt | Yes | FK to sys_user (owner) |
| mac_address | String (20) | No | Unique device MAC address |
| last_connected_at | DateTime | Yes | Last MQTT connection timestamp |
| auto_update | SmallInt | Yes | OTA auto-update enabled (default: 1) |
| board | String (100) | Yes | Board hardware identifier |
| alias | String (255) | Yes | Human-friendly device name |
| agent_id | UUID | Yes | Active agent configuration |
| kid_id | BigInt | Yes | Associated child profile |
| mode | String (50) | Yes | Interaction mode (default: "conversation") |
| device_mode | String (50) | Yes | Update mode: "auto" or "manual" |
| app_version | String (50) | Yes | Installed firmware version |
| sort | Int | Yes | Display sort order |
| creator | BigInt | Yes | User ID who created the record |
| create_date | DateTime | Yes | Record creation time |
| updater | BigInt | Yes | User ID of last updater |
| update_date | DateTime | Yes | Record update time |
| openclaw_url | String | Yes | OpenClaw server URL for this device |
| openclaw_token | String | Yes | OpenClaw auth token for this device |

---

### device_memories

Purpose: Stores per-device memory files (e.g., daily summaries, personality notes) keyed by MAC address, file type, and date. The content field holds the raw text of the memory file.

| Field | Type | Nullable | Description |
|---|---|---|---|
| id | UUID | No | Primary key |
| mac_id | String | No | Device MAC address |
| file_type | String | No | Memory file category (e.g., "daily", "personality") |
| file_date | DateTime (Date) | Yes | Date the memory file applies to |
| content | String | No | Text content of the memory (default: "") |
| updated_at | DateTime | Yes | Last update timestamp |

Unique constraint: (mac_id, file_type, file_date). Partial index on file_date where file_date IS NOT NULL.

---

### device_token_usage

Purpose: Aggregates daily LLM token consumption and latency metrics per device. One row per (mac_address, usage_date).

| Field | Type | Nullable | Description |
|---|---|---|---|
| id | BigInt (autoincrement) | No | Primary key |
| mac_address | String (50) | No | Device MAC address |
| session_id | String (100) | Yes | Last contributing session ID |
| input_tokens | Int | Yes | Total input tokens (default: 0) |
| output_tokens | Int | Yes | Total output tokens (default: 0) |
| total_tokens | Int | Yes | Sum of input + output (default: 0) |
| input_audio_tokens | Int | Yes | Audio-modality input tokens |
| input_text_tokens | Int | Yes | Text-modality input tokens |
| input_cached_tokens | Int | Yes | Tokens served from cache |
| output_audio_tokens | Int | Yes | Audio-modality output tokens |
| output_text_tokens | Int | Yes | Text-modality output tokens |
| avg_ttft_seconds | Decimal (10,3) | Yes | Average time-to-first-token in seconds |
| message_count | Int | Yes | Total messages in the day |
| session_duration_seconds | Decimal (10,3) | Yes | Total session duration |
| total_response_duration_seconds | Decimal (10,3) | Yes | Total time spent generating responses |
| session_count | Int | Yes | Number of sessions |
| usage_date | DateTime (Date) | No | Reporting date |
| created_at | DateTime | Yes | Record creation time |
| update_date | DateTime | Yes | Record update time |

Unique constraint: (mac_address, usage_date).

---

### ai_agent

Purpose: A user-configured AI agent that defines which ASR, LLM, TTS, and other models to use, along with the system prompt and language settings.

| Field | Type | Nullable | Description |
|---|---|---|---|
| id | UUID | No | Primary key |
| user_id | BigInt | Yes | FK to sys_user (owner) |
| agent_code | String (100) | Yes | Short identifier code |
| agent_name | String (200) | No | Display name |
| asr_model_id | UUID | Yes | FK to ai_model_config (ASR) |
| vad_model_id | UUID | Yes | FK to ai_model_config (VAD) |
| llm_model_id | UUID | Yes | FK to ai_model_config (LLM) |
| vllm_model_id | UUID | Yes | FK to ai_model_config (vision LLM) |
| tts_model_id | UUID | Yes | FK to ai_model_config (TTS) |
| tts_voice_id | UUID | Yes | FK to ai_tts_voice |
| mem_model_id | UUID | Yes | FK to ai_model_config (memory) |
| intent_model_id | UUID | Yes | FK to ai_model_config (intent) |
| chat_history_conf | Int | Yes | Chat history window size (default: 0) |
| system_prompt | String | Yes | Base system prompt text |
| summary_memory | String | Yes | Persisted summary memory string |
| lang_code | String (10) | Yes | BCP-47 language code (default: "en") |
| language | String (50) | Yes | Language name (default: "English") |
| sort | Int | Yes | Display sort order |
| status | Int | Yes | 1 = active, 0 = disabled |
| creator | BigInt | Yes | Creating user ID |
| created_at | DateTime | Yes | Record creation time |
| updated_at | DateTime | Yes | Record update time |

---

### ai_agent_chat_history

Purpose: Individual chat turns (user or assistant) recorded during a LiveKit session.

| Field | Type | Nullable | Description |
|---|---|---|---|
| id | UUID | No | Primary key |
| mac_address | String (20) | Yes | Device that generated the turn |
| agent_id | UUID | Yes | FK to ai_agent |
| session_id | String (100) | No | LiveKit session identifier |
| chat_type | Int | No | Message role (e.g., 1 = user, 2 = assistant) |
| content | String | Yes | Message text |
| audio_id | String (100) | Yes | Associated audio file ID |
| created_at | DateTime | Yes | Timestamp of the turn |

---

### ai_music

Purpose: Catalog entry for a music track available for playback on devices.

| Field | Type | Nullable | Description |
|---|---|---|---|
| id | UUID | No | Primary key |
| title | String (300) | No | Track title |
| artist | String (200) | Yes | Artist name |
| album | String (200) | Yes | Album name |
| category | String (100) | Yes | Genre or category |
| language | String (50) | Yes | Track language |
| duration | Int | Yes | Duration in seconds |
| file_url | String (500) | Yes | Audio file URL |
| cover_url | String (500) | Yes | Cover art URL |
| lyrics | String | Yes | Lyrics text |
| sort | Int | Yes | Display sort order |
| status | Int | Yes | 1 = active |
| creator | BigInt | Yes | Creating user ID |
| created_at | DateTime | Yes | Record creation time |
| updated_at | DateTime | Yes | Record update time |

---

### ai_story

Purpose: Catalog entry for an audio story available for playback on devices.

| Field | Type | Nullable | Description |
|---|---|---|---|
| id | UUID | No | Primary key |
| title | String (300) | No | Story title |
| author | String (200) | Yes | Author name |
| category | String (100) | Yes | Story category |
| language | String (50) | Yes | Story language |
| age_group | String (50) | Yes | Target age group |
| duration | Int | Yes | Duration in seconds |
| content | String | Yes | Story text content |
| audio_url | String (500) | Yes | Audio file URL |
| cover_url | String (500) | Yes | Cover image URL |
| sort | Int | Yes | Display sort order |
| status | Int | Yes | 1 = active |
| creator | BigInt | Yes | Creating user ID |
| created_at | DateTime | Yes | Record creation time |
| updated_at | DateTime | Yes | Record update time |

---

### ai_textbook

Purpose: A textbook entry that groups chapters for curriculum-aligned learning.

| Field | Type | Nullable | Description |
|---|---|---|---|
| id | UUID | No | Primary key |
| title | String (300) | No | Textbook title |
| subject | String (100) | Yes | Subject area |
| grade | String (50) | Yes | Grade level |
| language | String (50) | Yes | Language |
| publisher | String (200) | Yes | Publisher name |
| cover_url | String (500) | Yes | Cover image URL |
| description | String | Yes | Textbook description |
| sort | Int | Yes | Display sort order |
| status | Int | Yes | 1 = active |
| creator | BigInt | Yes | Creating user ID |
| created_at | DateTime | Yes | Record creation time |
| updated_at | DateTime | Yes | Record update time |

---

### content_library

Purpose: Unified content catalogue entry that can represent music, stories, or other media types.

| Field | Type | Nullable | Description |
|---|---|---|---|
| id | BigInt (autoincrement) | No | Primary key |
| content_type | String (50) | No | Type: "music", "story", etc. |
| title | String (500) | No | Content title |
| description | String | Yes | Description text |
| url | String (1000) | Yes | Media URL |
| thumbnail_url | String (500) | Yes | Thumbnail image URL |
| duration_seconds | Int | Yes | Duration in seconds |
| category | String (100) | Yes | Category label |
| tags | Json | Yes | Array of tag strings |
| age_min | Int | Yes | Minimum recommended age |
| age_max | Int | Yes | Maximum recommended age |
| language | String (50) | Yes | Content language (default: "en") |
| metadata | Json | Yes | Arbitrary extra metadata |
| status | Int | Yes | 1 = active |
| created_at | DateTime | Yes | Record creation time |
| updated_at | DateTime | Yes | Record update time |

---

### device_playlist

Purpose: Associates content library items with a device as a playlist entry.

| Field | Type | Nullable | Description |
|---|---|---|---|
| id | BigInt (autoincrement) | No | Primary key |
| device_id | BigInt | Yes | Device identifier (legacy integer) |
| mac_address | String (50) | Yes | Device MAC address |
| content_id | BigInt | Yes | FK to content_library |
| playlist_type | String (50) | Yes | Playlist category (default: "music") |
| position | Int | Yes | Ordering position |
| created_at | DateTime | Yes | Record creation time |

---

### rfid_series

Purpose: Maps a contiguous range of RFID UIDs (start_uid to end_uid) to a content pack, question, or question pack. This allows a batch of physical RFID cards to be configured without individual UID entries.

| Field | Type | Nullable | Description |
|---|---|---|---|
| id | BigInt (autoincrement) | No | Primary key |
| series_name | String (255) | No | Human-readable series name |
| start_uid | String (100) | No | First UID in the range |
| end_uid | String (100) | No | Last UID in the range |
| content_pack_id | BigInt | Yes | FK to rfid_pack (question group) |
| question_id | BigInt | Yes | FK to rfid_question |
| content_ref_id | BigInt | Yes | FK to rfid_content_pack (audio/prompt content) |
| question_pack_id | BigInt | Yes | FK to rfid_question_pack |
| priority | Int | Yes | Resolution priority when ranges overlap (default: 0) |
| notes | String (500) | Yes | Internal notes |
| status | Int | Yes | 1 = active |
| created_at | DateTime | Yes | Record creation time |
| updated_at | DateTime | Yes | Record update time |

---

### rfid_pack

Purpose: Groups rfid_series entries under a named pack, representing a physical card pack product.

| Field | Type | Nullable | Description |
|---|---|---|---|
| id | BigInt (autoincrement) | No | Primary key |
| pack_name | String (255) | No | Display name |
| pack_code | String (100) | Yes | Short code identifier |
| description | String | Yes | Pack description |
| age_min | Int | Yes | Minimum recommended age |
| age_max | Int | Yes | Maximum recommended age |
| language | String (50) | Yes | Pack language (default: "en") |
| active | Boolean | Yes | Whether the pack is active |
| status | Int | Yes | 1 = active |
| creator | BigInt | Yes | Creating user ID |
| create_date | DateTime | Yes | Record creation time |
| updater | BigInt | Yes | Last updater user ID |
| update_date | DateTime | Yes | Record update time |
| created_at | DateTime | Yes | Alias creation timestamp |
| updated_at | DateTime | Yes | Alias update timestamp |

---

### rfid_content_pack

Purpose: A content pack linked to RFID cards, holding a collection of audio or prompt content items (e.g., a nursery rhyme pack). Includes caching metadata for pre-generated audio.

| Field | Type | Nullable | Description |
|---|---|---|---|
| id | BigInt (autoincrement) | No | Primary key |
| pack_code | String (100) | No | Unique pack code |
| name | String (255) | No | Display name |
| description | String | Yes | Pack description |
| content_type | String (50) | Yes | Type: "prompt", "audio", etc. (default: "prompt") |
| content_md | String | Yes | Markdown source content |
| total_items | Int | Yes | Count of content_item children |
| language | String (10) | Yes | Content language (default: "en") |
| cached_audio_urls | String | Yes | Serialized list of pre-cached audio URLs |
| version | String (50) | Yes | Pack version string |
| status | String (50) | Yes | Pack lifecycle status |
| age_range | String (50) | Yes | Target age range label |
| thumbnail_url | String (500) | Yes | Thumbnail image URL |
| content_hash | String (255) | Yes | Hash for detecting content changes |
| active | Boolean | Yes | Whether the pack is active |
| creator | BigInt | Yes | Creating user ID |
| create_date | DateTime | Yes | Record creation time |
| updater | BigInt | Yes | Last updater user ID |
| update_date | DateTime | Yes | Record update time |

---

### rfid_question_pack

Purpose: A named bundle of rfid_question IDs, allowing a single RFID card to trigger a rotating set of questions.

| Field | Type | Nullable | Description |
|---|---|---|---|
| id | BigInt (autoincrement) | No | Primary key |
| pack_code | String (100) | No | Pack code identifier |
| name | String (255) | No | Display name |
| description | String | Yes | Pack description |
| question_ids | Json | Yes | Ordered array of rfid_question IDs |
| language | String (10) | Yes | Language code (default: "en") |
| category | String (100) | Yes | Category label |
| version | Int | Yes | Revision number |
| status | String (50) | Yes | Lifecycle status |
| active | Boolean | Yes | Whether the pack is active |
| creator | BigInt | Yes | Creating user ID |
| create_date | DateTime | Yes | Record creation time |
| updater | BigInt | Yes | Last updater user ID |
| update_date | DateTime | Yes | Record update time |

---

### rfid_question

Purpose: An individual question triggered when an RFID card is scanned. Contains the prompt text sent to the LLM and optional pre-cached audio.

| Field | Type | Nullable | Description |
|---|---|---|---|
| id | BigInt (autoincrement) | No | Primary key |
| code | String (100) | No | Unique question code |
| title | String (255) | No | Short title |
| prompt_text | String | Yes | Full prompt text sent to the LLM |
| system_prompt_override | String | Yes | Optional system prompt override for this question |
| allow_caching | Boolean | Yes | Whether audio response may be cached (default: true) |
| cached_audio_url | String (500) | Yes | URL to pre-generated audio response |
| language | String (10) | Yes | Language code (default: "en") |
| category | String (100) | Yes | Question category |
| difficulty | Int | Yes | Difficulty level 1-5 (default: 1) |
| active | Boolean | Yes | Whether the question is active |
| creator | BigInt | Yes | Creating user ID |
| create_date | DateTime | Yes | Record creation time |
| updater | BigInt | Yes | Last updater user ID |
| update_date | DateTime | Yes | Record update time |

---

### content_item

Purpose: An individual audio or text item belonging to an rfid_content_pack, ordered by item_number.

| Field | Type | Nullable | Description |
|---|---|---|---|
| id | BigInt (autoincrement) | No | Primary key |
| content_pack_id | BigInt | Yes | FK to rfid_content_pack |
| item_number | Int | No | Ordering position within the pack |
| title | String (255) | Yes | Item title |
| description | String | Yes | Item description |
| audio_url | String (500) | Yes | Audio file URL |
| audio_size_bytes | BigInt | Yes | Audio file size in bytes |
| audio_duration_ms | BigInt | Yes | Audio duration in milliseconds |
| images_json | Json | Yes | Array of image URLs/metadata |
| image_url | String (500) | Yes | Primary image URL |
| lyrics_text | String | Yes | Lyrics or subtitle text |
| content_text | String | Yes | Full text content |
| active | Boolean | Yes | Whether the item is active |
| creator | BigInt | Yes | Creating user ID |
| create_date | DateTime | Yes | Record creation time |
| updater | BigInt | Yes | Last updater user ID |
| update_date | DateTime | Yes | Record update time |

---

### kid_profile

Purpose: Child profile linked to a parent user, storing age, grade, interests, and language preferences used to personalise agent behaviour.

| Field | Type | Nullable | Description |
|---|---|---|---|
| id | BigInt (autoincrement) | No | Primary key |
| user_id | BigInt | Yes | FK to sys_user (parent) |
| name | String (100) | No | Child's full name |
| nickname | String (100) | Yes | Preferred nickname |
| avatar_url | String (500) | Yes | Avatar image URL |
| birth_date | DateTime (Date) | Yes | Date of birth |
| gender | String (20) | Yes | Gender |
| grade | String (50) | Yes | School grade |
| school | String (200) | Yes | School name |
| interests | String[] | No | Array of interest tags |
| language | String (10) | Yes | Preferred language (default: "en") |
| timezone | String (50) | Yes | Timezone string |
| preferences | Json | Yes | Arbitrary preference JSON |
| created_at | DateTime | Yes | Record creation time |
| updated_at | DateTime | Yes | Record update time |

---

### sys_params

Purpose: Key-value store for system-wide configuration parameters accessible at runtime.

| Field | Type | Nullable | Description |
|---|---|---|---|
| id | BigInt (autoincrement) | No | Primary key |
| param_code | String (100) | No | Unique parameter key |
| param_value | String | Yes | Parameter value |
| value_type | String (50) | Yes | Data type hint: "string", "int", "bool" (default: "string") |
| param_type | Int | Yes | 1 = system, 2 = custom |
| remark | String (500) | Yes | Description of the parameter |
| created_at | DateTime | Yes | Record creation time |
| updated_at | DateTime | Yes | Record update time |

---

### sys_dict_type

Purpose: Dictionary category (e.g., "gender", "status") that groups related sys_dict_data entries.

| Field | Type | Nullable | Description |
|---|---|---|---|
| id | BigInt (autoincrement) | No | Primary key |
| dict_type | String (100) | No | Unique type code |
| dict_name | String (255) | No | Display name |
| remark | String (500) | Yes | Description |
| sort | Int | Yes | Display sort order |
| created_at | DateTime | Yes | Record creation time |
| updated_at | DateTime | Yes | Record update time |

---

### sys_dict_data

Purpose: Individual dictionary entries providing label-value pairs within a sys_dict_type category.

| Field | Type | Nullable | Description |
|---|---|---|---|
| id | BigInt (autoincrement) | No | Primary key |
| dict_type_id | BigInt | Yes | FK to sys_dict_type |
| dict_type | String (100) | Yes | Denormalised type code |
| dict_label | String (255) | No | Human-readable label |
| dict_value | String (255) | No | Stored value |
| remark | String (500) | Yes | Description |
| sort | Int | Yes | Display sort order |
| created_at | DateTime | Yes | Record creation time |
| updated_at | DateTime | Yes | Record update time |

---

### email_report_config

Purpose: Singleton-style configuration record for scheduled admin email reports, specifying recipients, schedule, and which sections to include.

| Field | Type | Nullable | Description |
|---|---|---|---|
| id | UUID | No | Primary key |
| enabled | Boolean | No | Whether scheduled reports are enabled (default: false) |
| schedule_hour | Int | No | Hour of day to send reports (default: 8) |
| schedule_timezone | String (50) | No | Timezone for the schedule (default: "Asia/Kolkata") |
| recipients | Json | No | Array of recipient email addresses |
| sections | Json | No | Object flags for which report sections to include |
| created_at | DateTime | Yes | Record creation time |
| updated_at | DateTime | Yes | Record update time |

---

### email_report_history

Purpose: Audit log of each email report dispatch attempt, including delivery status and report payload.

| Field | Type | Nullable | Description |
|---|---|---|---|
| id | UUID | No | Primary key |
| report_date | DateTime (Date) | No | Date the report covers |
| recipients | String[] | No | Array of addresses the report was sent to |
| status | String (50) | No | Delivery status (e.g., "sent", "failed") |
| error_message | String | Yes | Error detail if status is "failed" |
| report_data | Json | Yes | Full report payload snapshot |
| sent_at | DateTime | Yes | Dispatch timestamp |

---

### openclaw_pair_tokens

Purpose: Short-lived pairing tokens that allow a device or parent app to authenticate with an OpenClaw instance. Tokens expire and are marked as paired once claimed.

| Field | Type | Nullable | Description |
|---|---|---|---|
| id | BigInt (autoincrement) | No | Primary key |
| user_id | BigInt | No | FK to sys_user (token owner) |
| token | String (20) | No | Unique short pairing token |
| openclaw_url | String | Yes | OpenClaw server URL to pair with |
| paired | Boolean | No | Whether the token has been claimed (default: false) |
| expires_at | DateTime | No | Token expiry timestamp |
| created_at | DateTime | Yes | Record creation time |
| updated_at | DateTime | Yes | Record update time |

---

### memory_chunks

Purpose: Vector search index. Text chunks extracted from device memory files are stored here with pgvector embeddings, enabling semantic similarity search for memory retrieval during AI conversations.

| Field | Type | Nullable | Description |
|---|---|---|---|
| id | BigInt (autoincrement) | No | Primary key |
| mac_id | String | No | Device MAC address (links to device_memories) |
| text | String | No | Raw text chunk |
| file_path | String | Yes | Source file path the chunk was extracted from |
| start_line | Int | Yes | Starting line number in source file (default: 0) |
| end_line | Int | Yes | Ending line number in source file (default: 0) |
| embedding | Unsupported("vector") | Yes | pgvector embedding for semantic search |
| category | String | Yes | Chunk category (default: "general") |
| created_at | DateTime | Yes | Record creation time |
| content_hash | String | No | Hash of text content for deduplication |

Unique constraint: (mac_id, content_hash). The embedding column uses the pgvector extension (`vector` type) and is indexed with an HNSW or IVFFlat index (idx_memory_chunks_embedding) for approximate nearest-neighbour search.
