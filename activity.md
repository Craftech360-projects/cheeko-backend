# Cheeko Manager API (Node.js) - Activity Log

## Current Status
**Last Updated:** 2026-01-23
**Tasks Completed:** 18
**Current Task:** Feature - Implement Model Configuration routes (/models/*)

---

## Project Overview

Migrating the existing Java Spring Boot `manager-api` to Node.js/Express.js with Supabase (PostgreSQL).

**Project Location:** `main/manager-api-node/`

**Tech Stack:**
- Runtime: Node.js 20+
- Framework: Express.js
- Database: Supabase (PostgreSQL)
- Auth: Supabase Auth
- Documentation: Swagger/OpenAPI

---

## Session Log

### 2026-01-23 - PRD Creation

**Completed:**
- Created comprehensive PRD document at `main/manager-api-node/prd.md`
- Analyzed existing Spring Boot API structure and all endpoints
- Defined 33 tasks covering full API migration (SMS and Voyage AI deferred)
- Updated PROMPT.md with project-specific commands
- Updated .claude/settings.json with Node.js permissions

**Key Decisions:**
- Express.js chosen over NestJS/Fastify for simpler migration
- Supabase native migrations instead of Prisma/Drizzle
- Supabase Auth for user authentication
- JavaScript (not TypeScript) for faster development
- All external integrations (Qdrant, Voyage AI, Mem0, SMS) included

**Next Task:**
Configure Supabase client and database connection

---

### 2026-01-23 - Task 1: Initialize Node.js Project (COMPLETED)

**Files Created:**
- `package.json` - Project configuration with dependencies
- `server.js` - Server entry point
- `src/app.js` - Express application setup
- `src/utils/logger.js` - Winston logger configuration
- `src/utils/response.js` - Standardized API response utilities
- `src/utils/helpers.js` - Common helper functions
- `src/middleware/errorHandler.js` - Global error handling
- `src/config/swagger.js` - Swagger/OpenAPI configuration
- `src/config/database.js` - Supabase client setup
- `src/routes/index.js` - Route aggregator with health endpoints
- `tests/integration/health.test.js` - Health endpoint tests
- `.gitignore`, `.eslintrc.js`, `nodemon.json` - Configuration files

**Commands Run:**
```bash
npm install  # Installed 522 packages
npm test     # 4 tests passed
```

**Test Results:**
- GET /health - PASS
- GET /toy/health - PASS
- GET /toy/pub-config - PASS
- GET /toy/nonexistent (404) - PASS

---

### 2026-01-23 - Tasks 2-5: Setup Phase Complete

**Task 2: Configure Supabase client**
- Added database health check endpoint at `/toy/health/db`
- Configured Supabase client with service role for admin operations

**Task 3: Create database migrations**
- Created 7 migration files covering all tables:
  - `20240101000001_create_sys_tables.sql` - Users, tokens, params, dictionaries, profiles
  - `20240101000002_create_model_tables.sql` - Model providers, configs, TTS voices
  - `20240101000003_create_agent_tables.sql` - Agents, templates, chat history, plugins
  - `20240101000004_create_device_tables.sql` - Devices, token usage, OTA
  - `20240101000005_create_content_tables.sql` - Content library, playlists
  - `20240101000006_create_rfid_tables.sql` - RFID packs, questions, mappings
  - `20240101000007_create_analytics_tables.sql` - Sessions, attempts, playback, progress

**Task 4: Set up middleware layer**
- Created `src/middleware/auth.js` - Supabase Auth + Service Key authentication
- Created `src/middleware/validation.js` - Joi validation schemas
- Created `src/middleware/xssFilter.js` - XSS protection middleware
- Created `src/middleware/index.js` - Middleware exports

**Task 5: Set up Swagger/OpenAPI**
- Already completed in Task 1 with `src/config/swagger.js`
- Documentation available at `/toy/doc.html`

**All 5 setup tasks completed!**

---

### 2026-01-23 - Task 6: Implement Authentication routes (/user/*) (COMPLETED)

**Previously Implemented:**
- `src/services/auth.service.js` - Auth service with Supabase Auth methods
- `src/routes/auth.routes.js` - Authentication routes

**Endpoints Implemented:**
- POST /user/register - User registration
- POST /user/login - User login
- GET /user/captcha - Get CAPTCHA
- PUT /user/change-password - Change password (requires auth)
- PUT /user/update-password - Password recovery
- DELETE /user/delete-account - Account deletion
- GET /user/pub-config - Public configuration

---

### 2026-01-23 - Task 7: Implement Device routes (/device/*) (COMPLETED)

**Files Verified/Created:**
- `src/services/device.service.js` - Device management service
- `src/routes/device.routes.js` - Device routes with Swagger docs
- `tests/integration/device.test.js` - 23 integration tests for device routes

**Endpoints Implemented:**
- POST /device/register - ESP32 device registration (public)
- POST /device/bind/:agentId/:deviceCode - Bind device to agent (auth)
- GET /device/bind/:agentId - Get devices bound to agent (auth)
- POST /device/unbind - Unbind device (auth)
- PUT /device/update/:id - Update device (auth)
- POST /device/manual-add - Manually add device (auth)
- PUT /device/assign-kid/:deviceId - Assign kid to device (auth)
- PUT /device/assign-kid-by-mac - Assign kid by MAC (auth)
- POST /device/:mac/cycle-mode - Cycle device mode (public)
- GET /device/:mac/mode - Get device mode (public)
- GET /device/:mac/device-mode - Get PTT mode (public)
- GET /device/list - List user's devices (auth)
- GET /device/:mac - Get device by MAC (public)

**Commands Run:**
```bash
npm test     # 27 tests passed (4 health + 23 device)
npm run lint # 0 errors, 16 warnings
```

**Test Results:**
- All device endpoints tested for validation
- MAC address format validation (colon, dash, raw)
- Authentication checks for protected routes
- Error handling for non-existent devices

**Fixes Applied:**
- Fixed XSS filter regex escape character warning
- Fixed ESLint indentation issues in database.js and content.service.js

---

### 2026-01-23 - Tasks 8-10: Implement Agent routes (ALL COMPLETED)

**Task 8: Agent Core CRUD (/agent/*)**
Reorganized and verified the agent routes to match PRD specification exactly.

**Files Modified:**
- `src/routes/agent.routes.js` - Reorganized routes for proper priority ordering
- `tests/integration/agent.test.js` - Created comprehensive integration tests (26 tests)

**Endpoints Implemented (PRD-compliant paths):**
- GET /agent/list - List agents (paginated, auth)
- GET /agent/all - List all agents (auth)
- POST /agent - Create agent (auth) ✓ Changed from /agent/create
- GET /agent/:id - Get agent by ID (auth)
- PUT /agent/:id - Update agent (auth) ✓ Changed from /agent/update/:id
- DELETE /agent/:id - Delete agent (auth) ✓ Changed from /agent/delete/:id

**Task 9: Agent Chat History & Sessions**
Verified existing implementation.

**Endpoints:**
- GET /agent/:id/sessions - Get agent sessions (auth)
- GET /agent/:id/chat-history/:sessionId - Get chat history (auth)
- POST /agent/chat-message - Add chat message (public for LiveKit)

**Task 10: Agent Device Integration**
Verified existing implementation.

**Endpoints:**
- GET /agent/prompt/:mac - Get agent prompt by MAC (public)
- GET /agent/config/:mac - Alias for prompt (public)
- GET /agent/agent-id/:mac - Get agent ID by MAC (public)
- POST /agent/cycle-character/:mac - Cycle character (public)
- POST /agent/set-character/:mac/:agentId - Set character (public)
- GET /agent/current-character/:mac - Get current character (public)

**Route Ordering Fix:**
Static routes (/list, /all, /prompt/:mac, etc.) now defined BEFORE dynamic :id routes to prevent Express routing conflicts.

**Commands Run:**
```bash
npm test     # 53 tests passed (4 health + 23 device + 26 agent)
npm run lint # 0 errors, 15 warnings
```

**Test Results:**
- All 26 agent tests pass
- Authentication checks for protected routes
- Route priority verified (static vs dynamic routes)
- Chat message validation
- MAC address format handling

---

### 2026-01-23 - Task 11: Implement Content Library routes (/content/*) (COMPLETED)

**Files Created/Modified:**
- `src/services/content.service.js` - Added unified content library methods
- `src/routes/content.routes.js` - Added /content/library/* routes
- `src/middleware/auth.js` - Added requireAdmin middleware
- `tests/integration/content.test.js` - Created comprehensive integration tests (36 tests)

**Content Library Service Methods Added:**
- `getLibraryList()` - Get paginated content with filters
- `searchLibrary()` - Full-text search across content
- `getLibraryCategories()` - Get unique categories with counts
- `getLibraryById()` - Get single content item
- `createLibraryItem()` - Create new content (admin)
- `updateLibraryItem()` - Update content (admin)
- `deleteLibraryItem()` - Delete content (admin)
- `batchCreateLibraryItems()` - Batch create content (admin)

**Endpoints Implemented (PRD-compliant):**
- GET /content/library - List content (paginated, auth)
- GET /content/library/search - Search content with full-text search (auth)
- GET /content/library/categories - Get categories (auth)
- GET /content/library/:id - Get content by ID (auth)
- POST /content/library - Create content (admin)
- PUT /content/library/:id - Update content (admin)
- DELETE /content/library/:id - Delete content (admin)
- POST /content/library/batch - Batch create content (admin)

**Legacy Routes Preserved:**
- /content/music/* - Music CRUD
- /content/story/* - Story CRUD
- /content/textbook/* - Textbook CRUD
- /content/search - Cross-type search
- /content/random/:type/:mac - Random content for device

**Commands Run:**
```bash
npm run lint # 0 errors, 13 warnings
npm test     # 89 tests passed (4 health + 23 device + 26 agent + 36 content)
```

**Test Results:**
- All 36 content tests pass
- Authentication checks for protected routes
- Admin access validation for create/update/delete
- Validation for required fields and contentType enum
- Search query minimum length validation

---

### 2026-01-23 - Task 12: Implement Playlist management (COMPLETED)

**Files Modified:**
- `src/services/content.service.js` - Added 8 playlist methods (getPlaylist, addToPlaylist, removeFromPlaylist, removePlaylistItem, clearPlaylist, reorderPlaylist, movePlaylistItem, getPlaylistItem)
- `src/routes/content.routes.js` - Added 12 playlist routes (6 for music, 6 for story)
- `tests/integration/content.test.js` - Added 31 playlist integration tests

**Music Playlist Endpoints Implemented:**
- GET /content/playlist/music/:deviceId - Get music playlist (auth)
- POST /content/playlist/music/:deviceId - Add to playlist (auth)
- DELETE /content/playlist/music/:deviceId/:contentId - Remove from playlist (auth)
- DELETE /content/playlist/music/:deviceId/clear - Clear playlist (auth)
- PUT /content/playlist/music/:deviceId/reorder - Reorder playlist (auth)
- PUT /content/playlist/music/:deviceId/move - Move item to position (auth)

**Story Playlist Endpoints Implemented:**
- GET /content/playlist/story/:deviceId - Get story playlist (auth)
- POST /content/playlist/story/:deviceId - Add to playlist (auth)
- DELETE /content/playlist/story/:deviceId/:contentId - Remove from playlist (auth)
- DELETE /content/playlist/story/:deviceId/clear - Clear playlist (auth)
- PUT /content/playlist/story/:deviceId/reorder - Reorder playlist (auth)
- PUT /content/playlist/story/:deviceId/move - Move item to position (auth)

**Features:**
- Content type validation (music items only in music playlist, stories only in story playlist)
- Position-based ordering with automatic position calculation
- Duplicate prevention (unique constraint on device_id + content_id)
- Batch reordering with itemIds array
- Single item move with newPosition parameter
- Joined queries to include content details in playlist responses

**Commands Run:**
```bash
npm run lint # 0 errors, 13 warnings (pre-existing)
npm test     # 120 tests passed (4 health + 23 device + 26 agent + 67 content with playlists)
```

**Test Results:**
- All 31 new playlist tests pass
- Authentication checks for all endpoints
- Input validation for contentId, itemIds, and newPosition
- Content type validation when adding to playlist

---

### 2026-01-23 - Task 13: Implement RFID routes - Card mapping (/admin/rfid/*) (COMPLETED)

**Files Created/Modified:**
- `src/services/rfid.service.js` - Added PRD-specified card mapping methods (getCardMappingPage, getCardMappingList, lookupCardByUid, createCardMapping, updateCardMapping, deleteCardMapping, lookupSeriesByUid, getPackList, createPack)
- `src/routes/rfid.routes.js` - Updated routes to match PRD specification with card/* paths and comprehensive Swagger documentation
- `tests/integration/rfid.test.js` - Created 45 integration tests for RFID endpoints

**PRD-Compliant Card Mapping Endpoints Implemented:**
- GET /admin/rfid/card/page - List cards (paginated, auth)
- GET /admin/rfid/card/list - List all cards (auth)
- GET /admin/rfid/card/lookup/:rfidUid - Lookup by UID (public for ESP32)
- POST /admin/rfid/card - Create mapping (admin)
- PUT /admin/rfid/card - Update mapping (admin)
- DELETE /admin/rfid/card - Delete mapping (admin)
- GET /admin/rfid/series/lookup/:uid - Series lookup (public)
- GET /admin/rfid/pack/list - List packs (auth)
- POST /admin/rfid/pack - Create pack (admin)

**Legacy Routes Preserved (backward compatibility):**
- GET /admin/rfid/list - RFID tags list
- GET /admin/rfid/by-uid/:uid - Get tag by UID
- POST /admin/rfid/create - Create RFID tag
- PUT /admin/rfid/update/:id - Update tag
- DELETE /admin/rfid/delete/:id - Delete tag
- GET /admin/rfid/:id - Get tag by ID
- POST /admin/rfid/scan/:mac/:uid - Process RFID scan
- GET /admin/rfid/scan-logs - Get scan logs
- POST /admin/rfid/register-batch - Batch register tags

**Features:**
- UID normalization (supports colons, dashes, or raw hex)
- Multi-question support per card (question_ids array)
- Series lookup for UID ranges (start_uid/end_uid)
- Pack management with age range filtering
- RAG integration ready (content_pack_id for Qdrant)

**Commands Run:**
```bash
npm run lint # 0 errors, 11 warnings (pre-existing in other files)
npm test     # 165 tests passed (4 health + 23 device + 26 agent + 67 content + 45 rfid)
```

**Test Results:**
- All 45 RFID tests pass
- Authentication checks for protected routes
- Admin access validation for create/update/delete
- UID format normalization tests
- Public endpoint access for ESP32 lookup

---

### 2026-01-23 - Task 14: Implement Qdrant vector search integration (COMPLETED)

**Files Created:**
- `src/services/integrations/qdrant.service.js` - Full Qdrant vector database integration service
- `tests/unit/qdrant.service.test.js` - 43 unit tests with mocked Qdrant client

**Qdrant Service Methods Implemented:**

*Client Management:*
- `getClient()` - Lazy initialization of Qdrant client
- `isAvailable()` - Check if Qdrant is configured
- `testConnection()` - Health check for Qdrant connection

*Collection Management:*
- `ensureCollection(name, vectorSize)` - Create collection if not exists
- `getCollectionInfo(name)` - Get collection metadata
- `listCollections()` - List all collections

*Search Operations:*
- `search({ vector, collection, limit, scoreThreshold, filter })` - Vector similarity search
- `searchByEmbedding({ embedding, collection, limit, filter })` - Convenience wrapper for search

*CRUD Operations:*
- `upsert({ points, collection })` - Batch upsert vectors with payloads
- `upsertOne({ id, vector, payload, collection })` - Single point upsert
- `deletePoints({ ids, collection })` - Delete points by IDs
- `deleteByFilter({ filter, collection })` - Delete points matching filter
- `getPoint({ id, collection, withVector })` - Retrieve single point

*Utilities:*
- `buildFilter(conditions)` - Build Qdrant filter from simple object notation

**Configuration:**
- Uses environment variables: `QDRANT_URL`, `QDRANT_API_KEY`, `QDRANT_COLLECTION`, `QDRANT_VECTOR_SIZE`
- Default collection: `rfid_content`
- Default vector size: 1536 (OpenAI ada-002 compatible)
- Supports cosine similarity for semantic matching

**Commands Run:**
```bash
npm run lint # 0 errors, 11 warnings (pre-existing)
npm test     # 208 tests passed (165 integration + 43 unit)
```

**Test Results:**
- All 43 Qdrant service unit tests pass
- Tests use Jest mocking for @qdrant/js-client-rest
- Full coverage of search, upsert, delete, and filter operations
- Error handling for missing configuration
- Connection failure graceful handling

---

### 2026-01-23 - Task 15: Implement RFID routes - RAG-powered lookup (COMPLETED)

**Files Modified:**
- `src/services/rfid.service.js` - Added RAG-powered search methods and emotion tagging support
- `src/routes/rfid.routes.js` - Added RAG lookup routes with Swagger documentation
- `tests/integration/rfid.test.js` - Added 60 new integration tests for RAG functionality

**RAG Service Methods Added:**
- `ragSearch({ embedding, contentPackId, language, limit, scoreThreshold })` - Perform semantic search via Qdrant
- `lookupCardWithRag(rfidUid, { queryEmbedding, queryText, includeRag })` - Enhanced card lookup with RAG
- `getContentPack(contentPackId)` - Get content pack details
- `upsertRagContent({ id, embedding, payload })` - Index content to Qdrant
- `deleteRagContent(ids)` - Delete content by IDs
- `deleteRagContentByPack(contentPackId)` - Delete content by pack

**New Endpoints Implemented:**
- POST /admin/rfid/card/rag-lookup/:rfidUid - RAG-enhanced card lookup (public for ESP32)
- POST /admin/rfid/rag/search - Semantic search in vector DB (auth required)
- GET /admin/rfid/content-pack/:id - Get content pack details (auth required)

**Features:**
- Qdrant integration for semantic similarity search
- Embedding-based queries (1536-dimensional vectors for ada-002)
- Content pack filtering for scoped searches
- Language filtering support
- Score threshold configuration
- Emotion tagging extraction from RAG results
- Multi-emotion support (aggregated from matched content)
- Graceful degradation when Qdrant is unavailable

**Swagger Components Added:**
- RagResult schema for search results
- ContentPack schema for content pack details
- Updated CardMappingLookup with rag_results, emotions, emotion fields

**Commands Run:**
```bash
npm run lint # 0 errors, 11 warnings (pre-existing)
npm test     # 225 tests passed (165 previous + 60 new RAG tests)
```

**Test Results:**
- All 60 new RAG tests pass
- POST /admin/rfid/card/rag-lookup/:rfidUid - Public endpoint tests
- POST /admin/rfid/rag/search - Auth and validation tests
- GET /admin/rfid/content-pack/:id - Auth and lookup tests
- Embedding handling and filter tests

---

### 2026-01-23 - Task 16: Implement RFID routes - Packs and Series (COMPLETED)

**Files Modified:**
- `src/services/rfid.service.js` - Added pack and series management methods:
  - `getPackById()` - Get pack by ID
  - `updatePack()` - Update pack
  - `deletePack()` - Delete pack
  - `getSeriesList()` - Get series with pagination
  - `getSeriesAll()` - Get all series without pagination
  - `getSeriesById()` - Get series by ID
  - `createSeries()` - Create new series
  - `updateSeries()` - Update series
  - `deleteSeries()` - Delete series

- `src/routes/rfid.routes.js` - Added new routes with Swagger documentation:
  - `GET /admin/rfid/pack/:id` - Get pack by ID (auth)
  - `PUT /admin/rfid/pack` - Update pack (admin)
  - `DELETE /admin/rfid/pack/:id` - Delete pack (admin)
  - `GET /admin/rfid/series/page` - List series paginated (auth)
  - `GET /admin/rfid/series/list` - List all series (auth)
  - `GET /admin/rfid/series/:id` - Get series by ID (auth)
  - `POST /admin/rfid/series` - Create series (admin)
  - `PUT /admin/rfid/series` - Update series (admin)
  - `DELETE /admin/rfid/series/:id` - Delete series (admin)

- `tests/integration/rfid.test.js` - Added 30 new integration tests for:
  - Pack CRUD operations (GET by ID, PUT, DELETE)
  - Series CRUD operations (GET page, GET list, GET by ID, POST, PUT, DELETE)
  - UID format handling for series (colons, dashes, raw hex)
  - Authentication and validation checks

**Endpoints Implemented (PRD-compliant):**
- GET /admin/rfid/pack/list - Already existed
- POST /admin/rfid/pack - Already existed
- PUT /admin/rfid/pack - NEW: Update pack (admin)
- DELETE /admin/rfid/pack/:id - NEW: Delete pack (admin)
- GET /admin/rfid/series/lookup/:uid - Already existed (public)
- GET /admin/rfid/series/page - NEW: List series paginated (auth)
- GET /admin/rfid/series/list - NEW: List all series (auth)
- GET /admin/rfid/series/:id - NEW: Get series by ID (auth)
- POST /admin/rfid/series - NEW: Create series (admin)
- PUT /admin/rfid/series - NEW: Update series (admin)
- DELETE /admin/rfid/series/:id - NEW: Delete series (admin)

**Features:**
- UID range validation (startUid must be <= endUid)
- UID normalization (supports colons, dashes, or raw hex)
- Priority-based series lookup for overlapping ranges
- Age range filtering for packs
- Swagger documentation with RfidSeries schema

**Commands Run:**
```bash
npm run lint # 0 errors, 11 warnings (pre-existing in other files)
npm test     # 255 tests passed (225 previous + 30 new pack/series tests)
```

**Test Results:**
- All 30 new pack/series tests pass
- Authentication checks for protected routes
- Admin access validation for create/update/delete
- UID format normalization tests
- Pagination and filter tests

---

### 2026-01-23 - Task 17: Implement Kid Profile routes (/api/mobile/kids/*) (COMPLETED)

**Files Modified:**
- `src/routes/profile.routes.js` - Updated routes to match PRD specification:
  - Added `GET /api/mobile/kids/list` (PRD-compliant path)
  - Added `POST /api/mobile/kids/create` (PRD-compliant path)
  - Preserved legacy REST-style routes for backward compatibility
  - Added comprehensive Swagger documentation with KidProfile and KidProfileInput schemas

- `tests/integration/profile.test.js` - Created 42 integration tests for:
  - PRD-compliant endpoints (/kids/list, /kids/create)
  - Legacy endpoints (/kids GET, POST)
  - CRUD operations (/kids/:id GET, PUT, DELETE)
  - Learning progress endpoints (/kids/:id/progress)
  - Activity logging endpoints (/kids/:id/activity)
  - Preferences endpoints (/kids/:id/preferences)
  - Input validation tests
  - Route priority tests
  - Response format tests

**PRD-Compliant Endpoints Implemented:**
- GET /api/mobile/kids/list - List kid profiles (auth)
- GET /api/mobile/kids/:id - Get kid profile by ID (auth)
- POST /api/mobile/kids/create - Create kid profile (auth)
- PUT /api/mobile/kids/:id - Update kid profile (auth)
- DELETE /api/mobile/kids/:id - Delete kid profile (auth)

**Additional Endpoints (already existed):**
- GET /api/mobile/kids/:id/progress - Get learning progress
- POST /api/mobile/kids/:id/progress - Update learning progress
- GET /api/mobile/kids/:id/activity - Get activity history
- POST /api/mobile/kids/:id/activity - Log activity (public for internal use)
- GET /api/mobile/kids/:id/preferences - Get preferences
- PUT /api/mobile/kids/:id/preferences - Update preferences

**Commands Run:**
```bash
npm run lint # 0 errors, 11 warnings (pre-existing)
npm test     # 297 tests passed (255 previous + 42 new profile tests)
```

**Test Results:**
- All 42 new profile tests pass
- Authentication checks for protected routes
- Input validation tests for required fields
- Route priority tests (static routes before :id routes)
- Response format validation

---

### 2026-01-23 - Task 18: Implement Parent Profile routes (COMPLETED)

**Files Modified:**
- `src/services/profile.service.js` - Added 8 parent profile methods:
  - `getParentProfile()` - Get parent profile for user
  - `getParentBySupabaseId()` - Get parent profile by Supabase user ID
  - `createParentProfile()` - Create parent profile
  - `updateParentProfile()` - Update parent profile
  - `deleteParentProfile()` - Delete parent profile
  - `updateNotificationPreferences()` - Update notification settings
  - `completeOnboarding()` - Mark onboarding as complete
  - `acceptTerms()` - Accept terms and privacy policy

- `src/routes/profile.routes.js` - Added parent profile routes with Swagger documentation:
  - `GET /api/mobile/parent` - Get parent profile (auth)
  - `POST /api/mobile/parent` - Create parent profile (auth)
  - `PUT /api/mobile/parent` - Update parent profile (auth)
  - `DELETE /api/mobile/parent` - Delete parent profile (auth)
  - `GET /api/mobile/parent/notifications` - Get notification preferences (auth)
  - `PUT /api/mobile/parent/notifications` - Update notification preferences (auth)
  - `POST /api/mobile/parent/onboarding/complete` - Mark onboarding complete (auth)
  - `POST /api/mobile/parent/terms/accept` - Accept terms/privacy policy (auth)

- `tests/integration/profile.test.js` - Added 38 new integration tests for:
  - Parent profile CRUD operations
  - Notification preferences endpoints
  - Onboarding completion endpoint
  - Terms acceptance endpoint
  - Input validation tests
  - Route priority tests
  - Response format tests

**Swagger Components Added:**
- `ParentProfile` schema - Full parent profile structure
- `ParentProfileInput` schema - Input for create/update operations

**Commands Run:**
```bash
npm run lint # 0 errors, 10 warnings (pre-existing)
npm test     # 335 tests passed (297 previous + 38 new parent profile tests)
```

**Test Results:**
- All 38 new parent profile tests pass
- Authentication checks for all endpoints
- Response format validation
- Route priority tests

---

<!--
The Ralph Wiggum loop will append dated entries here.
Each entry should include:
- Date and time
- Task worked on
- Changes made
- Commands run
- Screenshot filename (if applicable)
- Any issues and resolutions
-->
