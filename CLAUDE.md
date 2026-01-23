# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Cheeko is an AI companion for children (ages 3-16) running on ESP32 devices. The system consists of five main components that work together to provide real-time voice interaction:

1. **livekit-server** (Python) - LiveKit voice agent with AI conversation, games, music/story playback
2. **manager-api** (Java/Spring Boot) - Backend REST API for device management, user authentication, configuration
3. **manager-api-node** (Node.js/Express) - **NEW** JavaScript port of manager-api using Supabase
4. **manager-web** (Vue.js) - Admin dashboard for managing devices, users, models, and content
5. **mqtt-gateway** (Node.js) - Protocol bridge converting MQTT/UDP from ESP32 devices to WebSocket for LiveKit

## Architecture

```
ESP32 Device ──MQTT/UDP──> mqtt-gateway ──WebSocket──> LiveKit Cloud
                               │                           │
                               │                           ▼
                               │                     livekit-server
                               │                      (AI Agent)
                               ▼                           │
                     manager-api (Java)                    │
                           OR                              │
                     manager-api-node (JS) <───────────────┘
                               │              (config, prompts, analytics)
                               ▼
                          manager-web
                         (Admin Dashboard)
```

## Build and Run Commands

### livekit-server (Python)
```bash
cd main/livekit-server
pip install -r requirements.txt

# Run agent (main conversation AI)
python workers/cheeko_worker.py dev
python workers/math_tutor_worker.py dev
python workers/riddle_solver_worker.py dev
python workers/word_ladder_worker.py dev

# Run media API (music/story bots)
python media_api.py
```

### manager-api (Spring Boot) - Original Java API
```bash
cd main/manager-api
mvn spring-boot:run -Dspring-boot.run.profiles=dev

# Build JAR
mvn clean package -DskipTests
```
Runs on port 8002 with context path `/toy`. Profiles: dev, prod, local, azure, cloudrun, railway.

### manager-api-node (Express.js) - NEW JavaScript API
```bash
cd main/manager-api-node
npm install

# Development with auto-reload
npm run dev

# Production start
npm start

# Run tests
npm test

# Run tests with coverage
npm run test:coverage

# Supabase migrations
npx supabase init
npx supabase migration new [name]
npx supabase db push
```
Runs on port 8002 with context path `/toy`. Drop-in replacement for manager-api (Java).

**Tech Stack:**
- Runtime: Node.js 20+
- Framework: Express.js
- Database: Supabase (PostgreSQL)
- Auth: Supabase Auth
- ORM: Supabase JS Client
- Docs: Swagger/OpenAPI at `/toy/doc.html`

### manager-web (Vue.js)
```bash
cd main/manager-web
npm install
npm run serve        # Development
npm run build        # Production build
npm run analyze      # Bundle analyzer
```

### mqtt-gateway (Node.js)
```bash
cd main/mqtt-gateway
npm install
node app.js
```

### PM2 (All Services)
```bash
pm2 start ecosystem.config.js
```

## Key Concepts

### LiveKit Agent Workers
The `livekit-server/workers/` directory contains specialized AI agents:
- `cheeko_worker.py` - Main conversation agent
- `math_tutor_worker.py` - Math game mode
- `riddle_solver_worker.py` - Riddle game mode
- `word_ladder_worker.py` - Word game mode

### Configuration Sources
- Agent reads config from manager-api (`/toy/agent/config/{mac}`)
- YAML prompts in `livekit-server/src/prompts/`
- Runtime config in `livekit-server/config.yaml`

### MQTT Gateway Module Structure
Gateway is organized into layers under `main/mqtt-gateway/`:
- `gateway/` - MQTT/UDP protocol handlers (mqtt-gateway.js, udp-server.js, emqx-broker.js)
- `livekit/` - LiveKit integration (livekit-bridge.js, audio-processor.js, mcp-handler.js)
- `core/` - Shared utilities (opus-initializer.js, worker-pool-manager.js)
- `utils/` - Logging, config management

### Manager API Modules (Java & Node.js)
Both APIs share the same module structure:
- `agent/` - Agent configuration and prompts
- `device/` - ESP32 device management
- `content/` - Music, stories, textbooks
- `rfid/` - RFID tag management
- `security/` - User auth (Shiro in Java, Supabase Auth in Node.js)
- `sys/` - System settings, dictionaries
- `timbre/` - Voice/TTS configuration
- `analytics/` - Game sessions, media playback, usage stats

### Database
**Java (manager-api):**
- MySQL with Liquibase migrations
- Connection pools via Druid
- MyBatis-Plus for ORM

**Node.js (manager-api-node):**
- Supabase (PostgreSQL)
- Supabase CLI for migrations
- Supabase JS Client for queries

## manager-api-node Project Structure

```
main/manager-api-node/
├── src/
│   ├── config/
│   │   ├── database.js       # Supabase client setup
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
│   │       ├── qdrant.service.js   # Vector search
│   │       └── mem0.service.js     # Memory/personalization
│   ├── utils/
│   │   ├── logger.js
│   │   ├── response.js       # Standardized responses
│   │   └── helpers.js
│   └── app.js                # Express app setup
├── supabase/
│   └── migrations/           # Database migrations
├── tests/
│   ├── unit/
│   └── integration/
├── .env.example
├── package.json
├── prd.md                    # Product Requirements Document
└── server.js                 # Entry point
```

## CI/CD
CircleCI pipeline in `.circleci/config.yml` handles:
- Branch-specific deployments (dev, production)
- Docker builds for each component
- EMQX broker deployment

## External Services
- **LiveKit Cloud** - Real-time voice/video
- **Groq/Google** - LLM providers
- **ElevenLabs/Edge-TTS** - Text-to-speech
- **Deepgram/Whisper** - Speech-to-text
- **Qdrant** - Vector search for semantic content matching
- **Mem0** - Memory/personalization
- **Grafana Loki** - Centralized logging
- **Supabase** - Database and Auth (for manager-api-node)

## Environment Variables (manager-api-node)

Required environment variables for the Node.js API:

```bash
# Server
PORT=8002
NODE_ENV=development

# Supabase
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_ANON_KEY=your-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key

# Service Auth (for backend-to-backend calls)
SERVICE_SECRET_KEY=your-service-secret

# Qdrant (Vector DB for RAG)
QDRANT_URL=https://your-cluster.qdrant.io
QDRANT_API_KEY=your-qdrant-api-key

# Mem0 (Memory/Personalization)
MEM0_API_KEY=your-mem0-api-key
```
