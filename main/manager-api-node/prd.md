# Cheeko Manager API (Node.js) - Product Requirements Document

## Overview

This project is a **complete migration** of the existing Java Spring Boot `manager-api` to a Node.js/Express.js backend with Supabase (PostgreSQL) as the database. The goal is to achieve **full API parity** with the existing system, maintaining all features, endpoints, and integrations while leveraging modern JavaScript ecosystem tooling.

The Cheeko Manager API is the central backend for the Cheeko AI companion system for children (ages 3-16) running on ESP32 devices. It handles device management, user authentication, AI agent configuration, content delivery, analytics, RFID integration, and more.

## Target Audience

### Primary Users
1. **ESP32 Devices** - Hardware clients that communicate via REST API for:
   - Device registration and configuration
   - RFID card lookups
   - Mode cycling and PTT control
   - Agent/character information

2. **LiveKit Voice Agents** - AI workers that fetch:
   - Agent configurations and prompts
   - Chat history logging
   - Analytics data submission

3. **Admin Dashboard (manager-web)** - Vue.js frontend for:
   - Device management
   - Agent configuration
   - Content library management
   - User and kid profile management
   - Analytics viewing

4. **Mobile App Users** - Parents managing:
   - Kid profiles
   - Device bindings
   - Parental controls

### Key Needs
- Low-latency responses for real-time device interactions
- Reliable authentication for both users and service-to-service calls
- Comprehensive analytics tracking for child engagement
- Flexible agent configuration system
- RAG-powered RFID content lookup

## Core Features

### 1. Authentication & Security (Priority: Critical)
- Supabase Auth integration for user authentication
- Service-to-service authentication via API keys
- Role-based access control (normal user vs super admin)
- XSS/SQL injection protection middleware
- SMS verification for password recovery (deferred)

### 2. Device Management (Priority: Critical)
- Device registration with 6-digit validation codes
- Device binding to user accounts and agents
- Device-to-kid profile assignment
- Mode cycling (conversation → music → story)
- PTT (Push-to-Talk) mode control
- OTA firmware update management
- Token usage tracking

### 3. Agent/AI Configuration (Priority: Critical)
- Full CRUD for AI agent configurations
- Agent properties: ASR, VAD, LLM, VLLM, TTS, timbre/voice
- System prompt management
- Agent templates and personalities
- Character cycling via device button
- Chat history logging with session tracking
- Memory/summary management via Mem0
- MCP (Model Context Protocol) access points

### 4. Content Management (Priority: High)
- Music and story library management
- Content categorization and tagging
- Full-text search with pagination
- Playlist creation and reordering
- RAG integration for semantic content matching

### 5. RFID Integration (Priority: High)
- RFID card to content mapping
- Multi-question support per card
- RAG semantic search via Qdrant
- Pack management by age group
- Learning sequences/series
- Emotion tagging for content

### 6. User & Kid Profiles (Priority: High)
- Parent account management
- Multi-child profile support
- Kid profiles with DOB, gender, interests, language
- Profile avatars and preferences

### 7. Analytics & Tracking (Priority: High)
- Game session tracking (math tutor, riddle solver, word ladder)
- Game attempt logging
- Media playback tracking
- Streak recording
- Daily/weekly/monthly statistics
- User progress aggregation

### 8. Model & Timbre Configuration (Priority: Medium)
- Model type management (ASR, VAD, LLM, VLLM, TTS, Memory, Intent)
- Provider configuration (Groq, Google, ElevenLabs, Edge-TTS, Deepgram)
- Voice/timbre management with language support

## Tech Stack

- **Runtime**: Node.js 20+
- **Framework**: Express.js
- **Language**: JavaScript (ES6+)
- **Database**: PostgreSQL via Supabase
- **ORM**: Prisma (primary database access)
- **Schema Management**: Prisma Migrations
- **Authentication**: Supabase Auth + custom service key middleware
- **Auth Client**: Supabase JS Client (@supabase/supabase-js) - for auth only
- **Validation**: Joi or express-validator
- **API Documentation**: Swagger/OpenAPI (swagger-jsdoc + swagger-ui-express)
- **Testing**: Jest + Supertest + Prisma test utilities
- **Logging**: Winston or Pino
- **Environment**: dotenv
- **Vector Database**: Qdrant Cloud (existing)
- **Memory**: Mem0 API (existing)

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        Express.js Server                         │
│                         (Port 8002)                              │
├─────────────────────────────────────────────────────────────────┤
│  Middleware Layer                                                │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────────────┐   │
│  │  CORS    │ │  Auth    │ │  XSS     │ │  Rate Limiting   │   │
│  └──────────┘ └──────────┘ └──────────┘ └──────────────────┘   │
├─────────────────────────────────────────────────────────────────┤
│  Route Layer (/toy/*)                                            │
│  ┌────────┐┌────────┐┌────────┐┌────────┐┌────────┐┌─────────┐ │
│  │  Auth  ││ Device ││ Agent  ││Content ││  RFID  ││Analytics│ │
│  │ Routes ││ Routes ││ Routes ││ Routes ││ Routes ││ Routes  │ │
│  └────────┘└────────┘└────────┘└────────┘└────────┘└─────────┘ │
├─────────────────────────────────────────────────────────────────┤
│  Service Layer                                                   │
│  ┌────────────────┐ ┌────────────────┐ ┌────────────────────┐   │
│  │  Auth Service  │ │ Device Service │ │  Agent Service     │   │
│  └────────────────┘ └────────────────┘ └────────────────────┘   │
│  ┌────────────────┐ ┌────────────────┐ ┌────────────────────┐   │
│  │Content Service │ │  RFID Service  │ │ Analytics Service  │   │
│  └────────────────┘ └────────────────┘ └────────────────────┘   │
├─────────────────────────────────────────────────────────────────┤
│  Data Access Layer                                               │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │                    Prisma Client                          │   │
│  │  ┌─────────────────────────────────────────────────────┐ │   │
│  │  │  Database Queries (all services)                    │ │   │
│  │  └─────────────────────────────────────────────────────┘ │   │
│  └──────────────────────────────────────────────────────────┘   │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │                    Supabase Client                        │   │
│  │  ┌─────────┐ ┌─────────┐ ┌────────────────┐              │   │
│  │  │  Auth   │ │ Storage │ │  Realtime      │              │   │
│  │  └─────────┘ └─────────┘ └────────────────┘              │   │
│  └──────────────────────────────────────────────────────────┘   │
├─────────────────────────────────────────────────────────────────┤
│  External Integrations                                           │
│  ┌─────────────────┐ ┌──────────────────────┐                   │
│  │ Qdrant (Vector) │ │  Mem0 (Memory)       │                   │
│  └─────────────────┘ └──────────────────────┘                   │
└─────────────────────────────────────────────────────────────────┘
```

### Project Structure

```
manager-api-node/
├── prisma/
│   ├── schema.prisma         # Database schema (all models)
│   ├── seed.js               # Seed data script
│   └── migrations/           # Prisma migrations
├── src/
│   ├── config/
│   │   ├── prisma.js         # Prisma client setup
│   │   ├── database.js       # Supabase Auth client (no DB)
│   │   ├── swagger.js        # OpenAPI config
│   │   └── constants.js      # App constants
│   ├── middleware/
│   │   ├── auth.js           # Supabase auth + service key
│   │   ├── validation.js     # Request validation
│   │   ├── errorHandler.js   # Global error handling
│   │   └── xssFilter.js      # XSS protection
│   ├── routes/
│   │   ├── index.js          # Route aggregator
│   │   ├── auth.routes.js    # /user/* endpoints
│   │   ├── device.routes.js  # /device/* endpoints
│   │   ├── agent.routes.js   # /agent/* endpoints
│   │   ├── content.routes.js # /content/* endpoints
│   │   ├── rfid.routes.js    # /admin/rfid/* endpoints
│   │   ├── profile.routes.js # /api/mobile/* endpoints
│   │   ├── model.routes.js   # /models/* endpoints
│   │   └── analytics.routes.js
│   ├── services/
│   │   ├── auth.service.js
│   │   ├── device.service.js
│   │   ├── agent.service.js
│   │   ├── content.service.js
│   │   ├── rfid.service.js
│   │   ├── profile.service.js
│   │   ├── model.service.js
│   │   ├── analytics.service.js
│   │   └── integrations/
│   │       ├── qdrant.service.js
│   │       └── mem0.service.js
│   ├── utils/
│   │   ├── logger.js
│   │   ├── response.js       # Standardized responses
│   │   └── helpers.js
│   └── app.js                # Express app setup
├── tests/
│   ├── unit/
│   ├── integration/
│   └── utils/
│       └── prisma-test-helper.js
├── .env.example
├── package.json
└── server.js                 # Entry point
```

## Data Model

### Core Tables (PostgreSQL via Supabase)

#### System Tables
- `sys_user` - User accounts with role flags
- `sys_user_token` - Session tokens
- `sys_params` - System configuration (key-value)
- `sys_dict_type`, `sys_dict_data` - Dictionary system

#### Profile Tables
- `kid_profile` - Child profiles (dob, interests, language, avatar)
- `parent_profile` - Parent info (contact details)

#### AI Tables
- `ai_agent` - Agent configurations (prompts, model IDs, memory settings)
- `ai_device` - Device tracking (MAC, agent binding, mode)
- `ai_model_provider` - Model provider definitions
- `ai_model_config` - Model instances with API keys
- `ai_tts_voice` - Voice configurations
- `ai_agent_chat_history` - Chat logs
- `ai_agent_mcp_access_point` - MCP integration points

#### RFID Tables
- `rfid_card_mapping` - RFID UID to content mapping
- `rfid_question` - Knowledge base questions
- `rfid_pack` - Product packs/SKUs
- `rfid_series` - Learning sequences
- `rfid_content_pack` - RAG-ready content

#### Analytics Tables
- `analytics_game_session` - Game play sessions
- `analytics_game_attempt` - Individual attempts
- `analytics_media_playback` - Music/story tracking
- `analytics_streak` - Streak records
- `analytics_user_progress` - Aggregated stats

#### Content Tables
- `content_library` - Music/story metadata
- `content_items` - Individual content items
- `music_playlist`, `story_playlist` - User playlists

## API Endpoints (Full List)

### Authentication (`/user/*`)
| Method | Endpoint | Description | Auth |
|--------|----------|-------------|------|
| POST | /user/register | Register new user | Public |
| POST | /user/login | User login | Public |
| GET | /user/captcha | Get CAPTCHA | Public |
| POST | /user/smsVerification | Send SMS code | Public (Future) |
| PUT | /user/change-password | Change password | OAuth |
| PUT | /user/update-password | Update via SMS | Public |
| DELETE | /user/delete-account | Delete account | Public |
| GET | /user/pub-config | Get public config | Public |

### Device (`/device/*`)
| Method | Endpoint | Description | Auth |
|--------|----------|-------------|------|
| POST | /device/register | Register device | Public |
| POST | /device/bind/:agentId/:deviceCode | Bind device | OAuth |
| GET | /device/bind/:agentId | List bound devices | OAuth |
| POST | /device/unbind | Unbind device | OAuth |
| PUT | /device/update/:id | Update device | OAuth |
| POST | /device/manual-add | Manually add device | OAuth |
| PUT | /device/assign-kid/:deviceId | Assign kid to device | OAuth |
| PUT | /device/assign-kid-by-mac | Assign kid by MAC | OAuth |
| POST | /device/:mac/cycle-mode | Cycle device mode | Public |
| GET | /device/:mac/mode | Get current mode | Public |
| GET | /device/:mac/device-mode | Get device mode | Public |

### Agent (`/agent/*`)
| Method | Endpoint | Description | Auth |
|--------|----------|-------------|------|
| GET | /agent/list | List agents (paginated) | OAuth |
| GET | /agent/all | List all agents | OAuth |
| GET | /agent/:id | Get agent by ID | OAuth |
| POST | /agent | Create agent | OAuth |
| PUT | /agent/:id | Update agent | OAuth |
| DELETE | /agent/:id | Delete agent | OAuth |
| GET | /agent/:id/sessions | Get agent sessions | OAuth |
| GET | /agent/:id/chat-history/:sessionId | Get chat history | OAuth |
| GET | /agent/prompt/:mac | Get prompt by MAC | Service |
| GET | /agent/device/:mac/agent-id | Get agent ID | Public |
| POST | /agent/device/:mac/cycle-character | Cycle character | Public |
| POST | /agent/device/:mac/set-character | Set character | Public |
| GET | /agent/device/:mac/current-character | Get current character | Public |

### Content (`/content/*`)
| Method | Endpoint | Description | Auth |
|--------|----------|-------------|------|
| GET | /content/library | List content | OAuth |
| GET | /content/library/search | Search content | OAuth |
| GET | /content/library/categories | Get categories | OAuth |
| GET | /content/library/:id | Get content by ID | OAuth |
| POST | /content/library | Create content | Admin |
| PUT | /content/library/:id | Update content | Admin |
| DELETE | /content/library/:id | Delete content | Admin |
| POST | /content/library/batch | Batch create | Admin |

### RFID (`/admin/rfid/*`)
| Method | Endpoint | Description | Auth |
|--------|----------|-------------|------|
| GET | /admin/rfid/card/page | List cards (paginated) | OAuth |
| GET | /admin/rfid/card/list | List all cards | OAuth |
| GET | /admin/rfid/card/lookup/:rfidUid | Lookup by UID | Public |
| POST | /admin/rfid/card | Create mapping | Admin |
| PUT | /admin/rfid/card | Update mapping | Admin |
| DELETE | /admin/rfid/card | Delete mapping | Admin |
| GET | /admin/rfid/series/lookup/:uid | Series lookup | Public |
| GET | /admin/rfid/pack/list | List packs | OAuth |
| POST | /admin/rfid/pack | Create pack | Admin |

### Profiles (`/api/mobile/*`)
| Method | Endpoint | Description | Auth |
|--------|----------|-------------|------|
| GET | /api/mobile/kids/list | List kid profiles | OAuth |
| GET | /api/mobile/kids/:id | Get kid profile | OAuth |
| POST | /api/mobile/kids/create | Create kid profile | OAuth |
| PUT | /api/mobile/kids/:id | Update kid profile | OAuth |
| DELETE | /api/mobile/kids/:id | Delete kid profile | OAuth |

### Models (`/models/*`)
| Method | Endpoint | Description | Auth |
|--------|----------|-------------|------|
| GET | /models/names | Get model names | OAuth |
| GET | /models/llm/names | Get LLM names | OAuth |
| GET | /models/:type/provideTypes | Get provider types | OAuth |
| GET | /models/list | List all models | OAuth |
| POST | /models/:type/:provider | Create model | Admin |
| PUT | /models/:type/:provider/:id | Update model | Admin |
| DELETE | /models/:id | Delete model | Admin |

### Analytics (`/analytics/*`)
| Method | Endpoint | Description | Auth |
|--------|----------|-------------|------|
| POST | /analytics/session/start | Start session | Service |
| POST | /analytics/session/end | End session | Service |
| POST | /analytics/game-attempt | Log attempt | Service |
| POST | /analytics/media-event | Log media event | Service |
| POST | /analytics/streak | Log streak | Service |
| GET | /analytics/user/:mac/overall | Get overall stats | OAuth |
| GET | /analytics/user/:mac/math | Get math stats | OAuth |
| GET | /analytics/user/:mac/riddle | Get riddle stats | OAuth |
| GET | /analytics/user/:mac/wordladder | Get word stats | OAuth |
| GET | /analytics/sessions/:mac | Get sessions | OAuth |
| GET | /analytics/usage/daily/:mac | Get daily usage | OAuth |

## Security Considerations

### Authentication Layers
1. **Supabase Auth** - JWT-based user authentication
   - Email/password registration and login
   - Token refresh mechanism
   - Role claims in JWT

2. **Service Key Auth** - For backend-to-backend calls
   - `X-Service-Key` header validation
   - Used by LiveKit agents and other services

3. **Public Endpoints** - No auth required
   - Device registration/lookup
   - RFID lookups (for ESP32)
   - Mode cycling endpoints

### Security Middleware
- XSS protection via `xss-clean`
- Helmet.js for HTTP headers
- Rate limiting per IP/endpoint
- Input validation on all endpoints
- SQL injection prevention (parameterized queries)

### Data Protection
- Passwords hashed with bcrypt
- Sensitive config in environment variables
- API keys encrypted at rest in Supabase

## Third-Party Integrations

| Service | Purpose | SDK/API | Status |
|---------|---------|---------|--------|
| Supabase | Database + Auth | @supabase/supabase-js | Required |
| Qdrant Cloud | Vector search (RAG) | @qdrant/js-client-rest | Required |
| Mem0 | Memory/personalization | HTTP API | Required |
| Voyage AI | Embeddings | HTTP API | Deferred |
| Alibaba Cloud SMS | Mobile verification | alicloud-sdk | Deferred |

## Constraints & Assumptions

### Constraints
- Must maintain exact API contract compatibility with existing clients
- ESP32 devices cannot be updated frequently - API must be backward compatible
- Response formats must match Spring Boot API exactly
- Same port (8002) and context path (/toy) as existing API

### Assumptions
- Supabase project already exists or will be created
- Existing external service credentials (Qdrant, Voyage, Mem0) will be reused
- Database schema will be migrated/recreated in Supabase PostgreSQL
- Testing will be done against local Supabase instance initially

## Success Criteria

1. **API Parity**: All 100+ endpoints from Spring Boot API work identically
2. **Request/Response Compatibility**: Same JSON structures for all endpoints
3. **Auth Compatibility**: Both OAuth2 and service key auth work
4. **Test Coverage**: All endpoints have integration tests
5. **Documentation**: Swagger docs available at `/toy/doc.html`
6. **Performance**: Response times within 20% of Spring Boot API

---

## Task List

```json
[
  {
    "category": "setup",
    "description": "Initialize Node.js project with Express.js and dependencies",
    "steps": [
      "Create package.json with npm init",
      "Install core dependencies: express, @supabase/supabase-js, dotenv, cors, helmet",
      "Install dev dependencies: nodemon, jest, supertest",
      "Create project folder structure (src/, tests/, supabase/)",
      "Create .env.example with required environment variables",
      "Create server.js entry point",
      "Create src/app.js with Express setup"
    ],
    "passes": true
  },
  {
    "category": "setup",
    "description": "Configure Supabase client and database connection",
    "steps": [
      "Create src/config/database.js with Supabase client initialization",
      "Add SUPABASE_URL and SUPABASE_ANON_KEY to .env",
      "Create health check endpoint to verify connection",
      "Test connection to Supabase"
    ],
    "passes": true
  },
  {
    "category": "setup",
    "description": "Create database migrations for all tables",
    "steps": [
      "Initialize Supabase CLI in project",
      "Create migration for sys_user and sys_user_token tables",
      "Create migration for sys_params, sys_dict_type, sys_dict_data",
      "Create migration for kid_profile and parent_profile",
      "Create migration for ai_agent, ai_device, ai_model_provider, ai_model_config, ai_tts_voice",
      "Create migration for ai_agent_chat_history, ai_agent_mcp_access_point",
      "Create migration for rfid_card_mapping, rfid_question, rfid_pack, rfid_series, rfid_content_pack",
      "Create migration for analytics tables (game_session, game_attempt, media_playback, streak, user_progress)",
      "Create migration for content_library, content_items, playlists",
      "Run all migrations and verify schema"
    ],
    "passes": true
  },
  {
    "category": "setup",
    "description": "Set up middleware layer",
    "steps": [
      "Create src/middleware/auth.js with Supabase JWT verification",
      "Add service key authentication middleware",
      "Create src/middleware/errorHandler.js for global error handling",
      "Create src/middleware/validation.js with Joi schemas",
      "Add xss-clean, helmet, and rate limiting middleware",
      "Configure CORS for allowed origins"
    ],
    "passes": true
  },
  {
    "category": "setup",
    "description": "Set up Swagger/OpenAPI documentation",
    "steps": [
      "Install swagger-jsdoc and swagger-ui-express",
      "Create src/config/swagger.js with OpenAPI spec",
      "Configure swagger-ui to serve at /toy/doc.html",
      "Add JSDoc annotations to a sample route",
      "Verify Swagger UI loads correctly"
    ],
    "passes": true
  },
  {
    "category": "feature",
    "description": "Implement Authentication routes (/user/*)",
    "steps": [
      "Create src/services/auth.service.js with Supabase Auth methods",
      "Create src/routes/auth.routes.js",
      "Implement POST /user/register endpoint",
      "Implement POST /user/login endpoint",
      "Implement GET /user/captcha endpoint",
      "Implement PUT /user/change-password endpoint",
      "Implement PUT /user/update-password endpoint",
      "Implement DELETE /user/delete-account endpoint",
      "Implement GET /user/pub-config endpoint",
      "Add Swagger documentation for all endpoints",
      "Write integration tests for auth routes"
    ],
    "passes": true
  },
  {
    "category": "feature",
    "description": "Implement Device routes (/device/*)",
    "steps": [
      "Create src/services/device.service.js",
      "Create src/routes/device.routes.js",
      "Implement POST /device/register endpoint",
      "Implement POST /device/bind/:agentId/:deviceCode endpoint",
      "Implement GET /device/bind/:agentId endpoint",
      "Implement POST /device/unbind endpoint",
      "Implement PUT /device/update/:id endpoint",
      "Implement POST /device/manual-add endpoint",
      "Implement PUT /device/assign-kid/:deviceId endpoint",
      "Implement PUT /device/assign-kid-by-mac endpoint",
      "Implement POST /device/:mac/cycle-mode endpoint",
      "Implement GET /device/:mac/mode endpoint",
      "Implement GET /device/:mac/device-mode endpoint",
      "Add Swagger documentation",
      "Write integration tests"
    ],
    "passes": true
  },
  {
    "category": "feature",
    "description": "Implement Agent routes - Core CRUD (/agent/*)",
    "steps": [
      "Create src/services/agent.service.js",
      "Create src/routes/agent.routes.js",
      "Implement GET /agent/list endpoint with pagination",
      "Implement GET /agent/all endpoint",
      "Implement GET /agent/:id endpoint",
      "Implement POST /agent endpoint",
      "Implement PUT /agent/:id endpoint",
      "Implement DELETE /agent/:id endpoint",
      "Add Swagger documentation",
      "Write integration tests"
    ],
    "passes": true
  },
  {
    "category": "feature",
    "description": "Implement Agent routes - Chat history and sessions",
    "steps": [
      "Extend agent.service.js with chat history methods",
      "Implement GET /agent/:id/sessions endpoint",
      "Implement GET /agent/:id/chat-history/:sessionId endpoint",
      "Implement POST endpoint for logging chat messages",
      "Add Swagger documentation",
      "Write integration tests"
    ],
    "passes": true
  },
  {
    "category": "feature",
    "description": "Implement Agent routes - Device integration",
    "steps": [
      "Implement GET /agent/prompt/:mac endpoint (service auth)",
      "Implement GET /agent/device/:mac/agent-id endpoint",
      "Implement POST /agent/device/:mac/cycle-character endpoint",
      "Implement POST /agent/device/:mac/set-character endpoint",
      "Implement GET /agent/device/:mac/current-character endpoint",
      "Add Swagger documentation",
      "Write integration tests"
    ],
    "passes": true
  },
  {
    "category": "feature",
    "description": "Implement Content Library routes (/content/*)",
    "steps": [
      "Create src/services/content.service.js",
      "Create src/routes/content.routes.js",
      "Implement GET /content/library endpoint with pagination",
      "Implement GET /content/library/search endpoint with full-text search",
      "Implement GET /content/library/categories endpoint",
      "Implement GET /content/library/:id endpoint",
      "Implement POST /content/library endpoint",
      "Implement PUT /content/library/:id endpoint",
      "Implement DELETE /content/library/:id endpoint",
      "Implement POST /content/library/batch endpoint",
      "Add Swagger documentation",
      "Write integration tests"
    ],
    "passes": true
  },
  {
    "category": "feature",
    "description": "Implement Playlist management",
    "steps": [
      "Extend content.service.js with playlist methods",
      "Implement music playlist CRUD endpoints",
      "Implement story playlist CRUD endpoints",
      "Implement playlist reordering",
      "Add Swagger documentation",
      "Write integration tests"
    ],
    "passes": true
  },
  {
    "category": "feature",
    "description": "Implement RFID routes - Card mapping (/admin/rfid/*)",
    "steps": [
      "Create src/services/rfid.service.js",
      "Create src/routes/rfid.routes.js",
      "Implement GET /admin/rfid/card/page endpoint",
      "Implement GET /admin/rfid/card/list endpoint",
      "Implement GET /admin/rfid/card/lookup/:rfidUid endpoint (public)",
      "Implement POST /admin/rfid/card endpoint",
      "Implement PUT /admin/rfid/card endpoint",
      "Implement DELETE /admin/rfid/card endpoint",
      "Add Swagger documentation",
      "Write integration tests"
    ],
    "passes": true
  },
  {
    "category": "integration",
    "description": "Implement Qdrant vector search integration",
    "steps": [
      "Create src/services/integrations/qdrant.service.js",
      "Install @qdrant/js-client-rest",
      "Configure Qdrant client with credentials",
      "Implement vector search method for RAG",
      "Implement upsert method for embeddings",
      "Write tests with mocked Qdrant client"
    ],
    "passes": true
  },
  {
    "category": "feature",
    "description": "Implement RFID routes - RAG-powered lookup",
    "steps": [
      "Enhance /admin/rfid/card/lookup/:rfidUid with RAG support",
      "Integrate Qdrant search for semantic matching",
      "Handle multi-question responses",
      "Add emotion tagging support",
      "Write integration tests"
    ],
    "passes": true
  },
  {
    "category": "feature",
    "description": "Implement RFID routes - Packs and Series",
    "steps": [
      "Implement GET /admin/rfid/pack/list endpoint",
      "Implement POST /admin/rfid/pack endpoint",
      "Implement PUT /admin/rfid/pack endpoint",
      "Implement DELETE /admin/rfid/pack endpoint",
      "Implement GET /admin/rfid/series/lookup/:uid endpoint (public)",
      "Implement series CRUD endpoints",
      "Add Swagger documentation",
      "Write integration tests"
    ],
    "passes": true
  },
  {
    "category": "feature",
    "description": "Implement Kid Profile routes (/api/mobile/kids/*)",
    "steps": [
      "Create src/services/profile.service.js",
      "Create src/routes/profile.routes.js",
      "Implement GET /api/mobile/kids/list endpoint",
      "Implement GET /api/mobile/kids/:id endpoint",
      "Implement POST /api/mobile/kids/create endpoint",
      "Implement PUT /api/mobile/kids/:id endpoint",
      "Implement DELETE /api/mobile/kids/:id endpoint",
      "Add Swagger documentation",
      "Write integration tests"
    ],
    "passes": true
  },
  {
    "category": "feature",
    "description": "Implement Parent Profile routes",
    "steps": [
      "Extend profile.service.js with parent methods",
      "Implement parent profile CRUD endpoints",
      "Add Swagger documentation",
      "Write integration tests"
    ],
    "passes": true
  },
  {
    "category": "feature",
    "description": "Implement Model Configuration routes (/models/*)",
    "steps": [
      "Create src/services/model.service.js",
      "Create src/routes/model.routes.js",
      "Implement GET /models/names endpoint",
      "Implement GET /models/llm/names endpoint",
      "Implement GET /models/:type/provideTypes endpoint",
      "Implement GET /models/list endpoint",
      "Implement POST /models/:type/:provider endpoint",
      "Implement PUT /models/:type/:provider/:id endpoint",
      "Implement DELETE /models/:id endpoint",
      "Add Swagger documentation",
      "Write integration tests"
    ],
    "passes": true
  },
  {
    "category": "feature",
    "description": "Implement Timbre/Voice routes",
    "steps": [
      "Extend model.service.js with timbre methods",
      "Implement voice configuration CRUD endpoints",
      "Implement language support endpoints",
      "Add Swagger documentation",
      "Write integration tests"
    ],
    "passes": true
  },
  {
    "category": "feature",
    "description": "Implement Analytics routes - Session tracking",
    "steps": [
      "Create src/services/analytics.service.js",
      "Create src/routes/analytics.routes.js",
      "Implement POST /analytics/session/start endpoint",
      "Implement POST /analytics/session/end endpoint",
      "Implement POST /analytics/game-attempt endpoint",
      "Add Swagger documentation",
      "Write integration tests"
    ],
    "passes": true
  },
  {
    "category": "feature",
    "description": "Implement Analytics routes - Media and streaks",
    "steps": [
      "Implement POST /analytics/media-event endpoint",
      "Implement POST /analytics/streak endpoint",
      "Implement GET /analytics/sessions/:mac endpoint",
      "Add Swagger documentation",
      "Write integration tests"
    ],
    "passes": true
  },
  {
    "category": "feature",
    "description": "Implement Analytics routes - Statistics",
    "steps": [
      "Implement GET /analytics/user/:mac/overall endpoint",
      "Implement GET /analytics/user/:mac/math endpoint",
      "Implement GET /analytics/user/:mac/riddle endpoint",
      "Implement GET /analytics/user/:mac/wordladder endpoint",
      "Implement GET /analytics/usage/daily/:mac endpoint",
      "Implement weekly and monthly usage endpoints",
      "Add Swagger documentation",
      "Write integration tests"
    ],
    "passes": true
  },
  {
    "category": "integration",
    "description": "Implement Mem0 memory integration",
    "steps": [
      "Create src/services/integrations/mem0.service.js",
      "Configure Mem0 API client",
      "Implement memory add/retrieve methods",
      "Integrate with agent service for personalization",
      "Write tests with mocked API"
    ],
    "passes": true
  },
  {
    "category": "feature",
    "description": "Implement OTA firmware update endpoints",
    "steps": [
      "Extend device.service.js with OTA methods",
      "Implement firmware version check endpoint",
      "Implement firmware download endpoint",
      "Add Swagger documentation",
      "Write integration tests"
    ],
    "passes": true
  },
  {
    "category": "feature",
    "description": "Implement Token Usage tracking",
    "steps": [
      "Extend device.service.js with token tracking",
      "Implement token usage recording endpoint",
      "Implement token usage statistics endpoint",
      "Add Swagger documentation",
      "Write integration tests"
    ],
    "passes": true
  },
  {
    "category": "feature",
    "description": "Implement System Parameters and Dictionary endpoints",
    "steps": [
      "Create src/services/system.service.js",
      "Implement sys_params CRUD endpoints",
      "Implement dictionary type CRUD endpoints",
      "Implement dictionary data CRUD endpoints",
      "Add Swagger documentation",
      "Write integration tests"
    ],
    "passes": true
  },
  {
    "category": "feature",
    "description": "Implement Admin endpoints",
    "steps": [
      "Create admin controller routes",
      "Implement user management for super admins",
      "Implement system statistics endpoints",
      "Add role-based access control",
      "Add Swagger documentation",
      "Write integration tests"
    ],
    "passes": true
  },
  {
    "category": "testing",
    "description": "Complete integration test suite",
    "steps": [
      "Review all endpoints have tests",
      "Add edge case tests",
      "Add authentication tests (valid/invalid tokens)",
      "Add error handling tests",
      "Run full test suite and fix failures"
    ],
    "passes": true
  },
  {
    "category": "testing",
    "description": "API contract validation",
    "steps": [
      "Compare response formats with Spring Boot API",
      "Verify all field names match exactly",
      "Verify pagination format matches",
      "Verify error response format matches",
      "Document any intentional differences"
    ],
    "passes": true
  },
  {
    "category": "setup",
    "description": "Add logging and monitoring",
    "steps": [
      "Configure Winston or Pino logger",
      "Add request/response logging middleware",
      "Add error logging",
      "Configure log levels by environment",
      "Add request ID tracking"
    ],
    "passes": true
  },
  {
    "category": "setup",
    "description": "Finalize deployment configuration",
    "steps": [
      "Create Dockerfile",
      "Create docker-compose.yml for local development",
      "Add environment-specific configuration files",
      "Update .env.example with all required variables",
      "Add npm scripts for dev, test, start"
    ],
    "passes": true
  }
]
```

---

## Agent Instructions

1. Read `activity.md` first to understand current state
2. Find next task with `"passes": false`
3. Complete all steps for that task
4. Verify in browser using agent-browser (for UI) or run tests
5. Update task to `"passes": true`
6. Log completion in `activity.md`
7. Repeat until all tasks pass

**Important:** Only modify the `passes` field. Do not remove or rewrite tasks.

---

## Completion Criteria

All tasks marked with `"passes": true`

**Final Verification:**
- All 100+ endpoints return correct responses
- All integration tests pass
- Swagger documentation is complete
- API can be used as drop-in replacement for Spring Boot API

---

## Phase 2: Prisma Migration

### Overview
Migrate manager-api-node from Supabase JS client to Prisma ORM for better schema management, type safety, and database migration tooling. This is a minimal setup that preserves existing functionality while improving the database layer.

### Goals
1. **Prisma Schema** - Define all tables in `prisma/schema.prisma`
2. **Service Migration** - Replace Supabase queries with Prisma client in all services
3. **Database Testing** - Add test utilities for database operations
4. **Seed Data** - Migration of existing seed data to Prisma seeds

### Architecture Changes
Keep existing Express.js architecture. Replace only the database layer:
- `src/config/database.js` → Keep Supabase Auth, remove DB client
- `src/config/prisma.js` → New Prisma client
- `src/services/*.js` → Update queries from Supabase to Prisma

### Data Model (Prisma)
Tables from `scripts/complete-schema.sql` and `src/config/migrations.js`:

**Core Tables:**
- `sys_user` - System users (BIGSERIAL id)
- `ai_model` - AI model configurations (UUID id)
- `ai_tts_voice` - TTS voice settings (UUID id)
- `ai_agent` - Agent configurations (UUID id)
- `ai_device` - ESP32 device registry (UUID id)

**Content Tables:**
- `ai_music` - Music library (UUID id)
- `ai_story` - Story library (UUID id)
- `ai_textbook` - Textbook metadata (UUID id)
- `ai_textbook_chapter` - Textbook chapters (UUID id)
- `content_library` - Generic content (BIGSERIAL id)

**RFID Tables:**
- `rfid_pack` - Content packs (BIGSERIAL id)
- `rfid_card_mapping` - RFID to content mapping (BIGSERIAL id)
- `rfid_series` - Learning sequences (BIGSERIAL id)
- `rfid_scan_log` - Scan history (BIGSERIAL id)
- `rfid_tags` - Legacy RFID tags (BIGSERIAL id)

**Analytics Tables:**
- `analytics_game_sessions` - Game play sessions (BIGSERIAL id)
- `analytics_game_attempts` - Individual game attempts (BIGSERIAL id)
- `analytics_media_playback` - Media playback events (BIGSERIAL id)
- `analytics_streaks` - Streak records (BIGSERIAL id)
- `analytics_user_progress` - Aggregated user stats (BIGSERIAL id)

**Profile Tables:**
- `kid_profile` - Child profiles (BIGSERIAL id)
- `kid_learning_progress` - Learning progress (UUID id)
- `kid_activity_log` - Activity logs (UUID id)
- `parent_profile` - Parent info (BIGSERIAL id)

**Other Tables:**
- `ai_agent_chat_history` - Chat logs (UUID id)
- `ai_ota` - OTA firmware updates (UUID id)
- `device_token_usage` - Token usage tracking (BIGSERIAL id)
- `music_playlist` - Music playlists (BIGSERIAL id)
- `story_playlist` - Story playlists (BIGSERIAL id)

### Environment Variables Required

```bash
# Prisma Database URLs
DATABASE_URL="postgresql://postgres.[project-ref]:[password]@aws-0-ap-south-1.pooler.supabase.com:6543/postgres?pgbouncer=true"
DIRECT_URL="postgresql://postgres.[project-ref]:[password]@aws-0-ap-south-1.pooler.supabase.com:5432/postgres"

# Keep existing Supabase Auth variables
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_ANON_KEY=your-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
```

### Key Files to Modify

| File | Action |
|------|--------|
| `prisma/schema.prisma` | Create - all models |
| `prisma/seed.js` | Create - seed data |
| `src/config/prisma.js` | Create - Prisma client |
| `src/config/database.js` | Modify - remove DB client, keep Auth |
| `src/config/migrations.js` | Delete - replaced by Prisma |
| `src/services/*.service.js` | Modify - all service files |
| `server.js` | Modify - remove migration calls |
| `package.json` | Modify - add Prisma scripts |
| `tests/utils/prisma-test-helper.js` | Create - test utilities |

### Prisma Migration Task List

```json
[
  {
    "id": "prisma-1",
    "category": "setup",
    "description": "Install Prisma and initialize configuration",
    "steps": [
      "Run npm install prisma @prisma/client",
      "Run npx prisma init",
      "Configure DATABASE_URL and DIRECT_URL in .env for Supabase PostgreSQL"
    ],
    "passes": true
  },
  {
    "id": "prisma-2",
    "category": "setup",
    "description": "Create Prisma schema with all database models",
    "steps": [
      "Read scripts/complete-schema.sql for table definitions",
      "Read src/config/migrations.js for additional tables",
      "Create prisma/schema.prisma with all models",
      "Define relationships between models",
      "Run npx prisma generate to create client"
    ],
    "passes": true
  },
  {
    "id": "prisma-3",
    "category": "setup",
    "description": "Introspect existing database and baseline migration",
    "steps": [
      "Run npx prisma db pull to sync with existing schema",
      "Run npx prisma migrate dev --name init to create baseline",
      "Verify migration files are created"
    ],
    "passes": false
  },
  {
    "id": "prisma-4",
    "category": "setup",
    "description": "Create Prisma client wrapper",
    "steps": [
      "Create src/config/prisma.js with PrismaClient initialization",
      "Add error handling and logging",
      "Export prisma instance for services"
    ],
    "passes": false
  },
  {
    "id": "prisma-5",
    "category": "feature",
    "description": "Migrate device.service.js to Prisma",
    "steps": [
      "Replace supabaseAdmin import with prisma",
      "Convert all .from().select().eq() queries to prisma.model.findMany()",
      "Update error handling for Prisma errors",
      "Test device endpoints: GET /toy/device/info/{mac}"
    ],
    "passes": false
  },
  {
    "id": "prisma-6",
    "category": "feature",
    "description": "Migrate agent.service.js to Prisma",
    "steps": [
      "Replace supabaseAdmin import with prisma",
      "Convert agent queries to Prisma syntax",
      "Test agent endpoints: GET /toy/agent/config/{mac}"
    ],
    "passes": false
  },
  {
    "id": "prisma-7",
    "category": "feature",
    "description": "Migrate auth.service.js to Prisma",
    "steps": [
      "Keep Supabase Auth for authentication",
      "Replace user database queries with Prisma",
      "Test auth endpoints: POST /toy/user/login"
    ],
    "passes": false
  },
  {
    "id": "prisma-8",
    "category": "feature",
    "description": "Migrate content.service.js to Prisma",
    "steps": [
      "Replace music, story, textbook queries with Prisma",
      "Test content endpoints"
    ],
    "passes": false
  },
  {
    "id": "prisma-9",
    "category": "feature",
    "description": "Migrate rfid.service.js to Prisma",
    "steps": [
      "Replace RFID-related queries with Prisma",
      "Test RFID endpoints: GET /toy/admin/rfid/*"
    ],
    "passes": false
  },
  {
    "id": "prisma-10",
    "category": "feature",
    "description": "Migrate analytics.service.js to Prisma",
    "steps": [
      "Replace analytics queries with Prisma",
      "Test analytics endpoints"
    ],
    "passes": false
  },
  {
    "id": "prisma-11",
    "category": "feature",
    "description": "Migrate profile.service.js to Prisma",
    "steps": [
      "Replace profile queries with Prisma",
      "Test profile endpoints: GET /toy/api/mobile/*"
    ],
    "passes": false
  },
  {
    "id": "prisma-12",
    "category": "feature",
    "description": "Migrate model.service.js to Prisma",
    "steps": [
      "Replace AI model queries with Prisma",
      "Test model endpoints"
    ],
    "passes": false
  },
  {
    "id": "prisma-13",
    "category": "feature",
    "description": "Migrate admin.service.js to Prisma",
    "steps": [
      "Replace admin queries with Prisma",
      "Test admin endpoints"
    ],
    "passes": false
  },
  {
    "id": "prisma-14",
    "category": "feature",
    "description": "Migrate system.service.js to Prisma",
    "steps": [
      "Replace system queries with Prisma",
      "Test system endpoints"
    ],
    "passes": false
  },
  {
    "id": "prisma-15",
    "category": "cleanup",
    "description": "Remove old migration system",
    "steps": [
      "Update server.js to remove migration calls",
      "Delete or archive src/config/migrations.js",
      "Update database.js to remove Supabase DB client (keep Auth)"
    ],
    "passes": false
  },
  {
    "id": "prisma-16",
    "category": "setup",
    "description": "Create seed data script",
    "steps": [
      "Create prisma/seed.js with default data",
      "Add seed script to package.json",
      "Test seeding with npx prisma db seed"
    ],
    "passes": false
  },
  {
    "id": "prisma-17",
    "category": "testing",
    "description": "Add database testing utilities",
    "steps": [
      "Create tests/utils/prisma-test-helper.js",
      "Add test database setup/teardown",
      "Create sample integration tests for device service"
    ],
    "passes": false
  },
  {
    "id": "prisma-18",
    "category": "testing",
    "description": "Run full test suite and verify all endpoints",
    "steps": [
      "Run npm test to execute all tests",
      "Start server with npm run dev",
      "Test critical endpoints manually or via integration tests",
      "Verify no regressions from Supabase migration"
    ],
    "passes": false
  }
]
```

### Prisma Migration Success Criteria
- All existing API endpoints work identically with Prisma
- All tests pass
- No regressions from Supabase client migration
- Prisma Studio can browse all tables: `npx prisma studio`

---

## Agent Instructions (Updated)

1. Read `activity.md` first to understand current state (create if not exists)
2. Find next task with `"passes": false` (check both Phase 1 and Phase 2 tasks)
3. Complete all steps for that task
4. Verify in browser using agent-browser (for UI) or run tests
5. Update task to `"passes": true`
6. Log completion in `activity.md`
7. Repeat until all tasks pass

**Important:** Only modify the `passes` field. Do not remove or rewrite tasks.
