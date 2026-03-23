# Cheeko Documentation Site Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a full Docusaurus v3 documentation site at `D:\cheeko-backend\docs-site\` covering all five Cheeko backend components (livekit-server, manager-api-node, manager-web, mqtt-gateway, firmware integration).

**Architecture:** Static Docusaurus v3 site scaffold with npm, populated by reading the actual source files from each component and writing comprehensive documentation pages. No live code generation — all docs are Markdown authored from codebase reading.

**Tech Stack:** Docusaurus v3, React, Node.js 20+, npm, MDX for interactive diagrams

---

## File Structure

### Scaffold (created by npx create-docusaurus)
```
docs-site/
├── docusaurus.config.js          # Site config, navbar, footer, theme
├── sidebars.js                   # Sidebar structure
├── package.json
├── static/
│   └── img/
│       └── cheeko-logo.svg       # Simple text logo
└── docs/
    ├── intro.md                  # Landing page: overview + architecture ASCII
    ├── architecture/
    │   ├── overview.md           # Full system diagram + data flow
    │   └── protocols.md          # MQTT / UDP / HTTP contract reference
    ├── firmware/
    │   └── integration-guide.md  # Full firmware↔backend integration (from existing doc)
    ├── backend/
    │   ├── manager-api/
    │   │   ├── overview.md       # Express app, auth, middleware stack
    │   │   ├── ota.md            # OTA + activation endpoints
    │   │   ├── device.md         # Device CRUD endpoints
    │   │   ├── agent.md          # Agent config + prompt endpoints
    │   │   ├── content.md        # Music / stories / textbooks
    │   │   └── rfid.md           # RFID card lookup + management
    │   ├── mqtt-gateway/
    │   │   ├── overview.md       # Module layers, entry point, connection lifecycle
    │   │   ├── mqtt-protocol.md  # MQTT message handling (hello, listen, speech_end...)
    │   │   └── audio-pipeline.md # UDP AES-CTR + LiveKit bridge + resampling
    │   └── livekit-server/
    │       ├── overview.md       # Worker dispatch, services, external APIs
    │       ├── cheeko-agent.md   # Main conversation agent (cheeko_worker.py)
    │       └── game-workers.md   # Math tutor, riddle solver, word ladder
    ├── admin/
    │   └── manager-web.md        # Vue.js dashboard: views, API calls, auth
    └── deployment/
        ├── environment.md        # All env vars for all components
        └── pm2.md                # PM2 ecosystem config + Docker
```

---

## Task 1: Scaffold Docusaurus Site

**Files:**
- Create: `docs-site/` (via npx)
- Modify: `docs-site/docusaurus.config.js`
- Modify: `docs-site/sidebars.js`
- Delete: `docs-site/docs/tutorial-basics/` and `docs-site/docs/tutorial-extras/` (scaffolded filler)

- [ ] **Step 1: Create Docusaurus scaffold**

Run from `D:\cheeko-backend`:
```bash
cd D:\cheeko-backend
npx create-docusaurus@latest docs-site classic --typescript=false --package-manager=npm
```
Expected: `docs-site/` directory created with default Docusaurus structure.

- [ ] **Step 2: Remove scaffold filler content**

Delete these generated folders that contain tutorial placeholders:
```bash
rm -rf docs-site/docs/tutorial-basics
rm -rf docs-site/docs/tutorial-extras
rm -rf docs-site/blog
```

- [ ] **Step 3: Configure docusaurus.config.js**

Replace `docs-site/docusaurus.config.js` entirely with:

```js
// @ts-check
const { themes: prismThemes } = require('prism-react-renderer');

/** @type {import('@docusaurus/types').Config} */
const config = {
  title: 'Cheeko Docs',
  tagline: 'AI Companion for Children — Backend & Firmware Reference',
  favicon: 'img/favicon.ico',

  url: 'https://docs.cheeko.ai',
  baseUrl: '/',

  organizationName: 'cheeko',
  projectName: 'cheeko-docs',

  onBrokenLinks: 'warn',
  onBrokenMarkdownLinks: 'warn',

  i18n: {
    defaultLocale: 'en',
    locales: ['en'],
  },

  presets: [
    [
      'classic',
      /** @type {import('@docusaurus/preset-classic').Options} */
      ({
        docs: {
          sidebarPath: './sidebars.js',
          routeBasePath: '/',
        },
        blog: false,
        theme: {
          customCss: './src/css/custom.css',
        },
      }),
    ],
  ],

  themeConfig:
    /** @type {import('@docusaurus/preset-classic').ThemeConfig} */
    ({
      navbar: {
        title: 'Cheeko Docs',
        items: [
          { type: 'docSidebar', sidebarId: 'mainSidebar', position: 'left', label: 'Docs' },
          { href: 'https://github.com/cheeko', label: 'GitHub', position: 'right' },
        ],
      },
      footer: {
        style: 'dark',
        copyright: `Copyright © ${new Date().getFullYear()} Cheeko. Built with Docusaurus.`,
      },
      prism: {
        theme: prismThemes.github,
        darkTheme: prismThemes.dracula,
        additionalLanguages: ['bash', 'json', 'python', 'java', 'cpp'],
      },
    }),
};

module.exports = config;
```

- [ ] **Step 4: Configure sidebars.js**

Replace `docs-site/sidebars.js` with:

```js
/** @type {import('@docusaurus/plugin-content-docs').SidebarsConfig} */
const sidebars = {
  mainSidebar: [
    'intro',
    {
      type: 'category',
      label: 'Architecture',
      items: ['architecture/overview', 'architecture/protocols'],
    },
    {
      type: 'category',
      label: 'Firmware Integration',
      items: ['firmware/integration-guide'],
    },
    {
      type: 'category',
      label: 'Backend',
      items: [
        {
          type: 'category',
          label: 'Manager API (Node.js)',
          items: [
            'backend/manager-api/overview',
            'backend/manager-api/ota',
            'backend/manager-api/device',
            'backend/manager-api/agent',
            'backend/manager-api/content',
            'backend/manager-api/rfid',
          ],
        },
        {
          type: 'category',
          label: 'MQTT Gateway',
          items: [
            'backend/mqtt-gateway/overview',
            'backend/mqtt-gateway/mqtt-protocol',
            'backend/mqtt-gateway/audio-pipeline',
          ],
        },
        {
          type: 'category',
          label: 'LiveKit Server (AI)',
          items: [
            'backend/livekit-server/overview',
            'backend/livekit-server/cheeko-agent',
            'backend/livekit-server/game-workers',
          ],
        },
      ],
    },
    {
      type: 'category',
      label: 'Admin Dashboard',
      items: ['admin/manager-web'],
    },
    {
      type: 'category',
      label: 'Deployment',
      items: ['deployment/environment', 'deployment/pm2'],
    },
  ],
};

module.exports = sidebars;
```

- [ ] **Step 5: Verify scaffold runs**

```bash
cd docs-site && npm start
```
Expected: Browser opens at `http://localhost:3000` showing Cheeko Docs navbar. Stop with Ctrl+C.

- [ ] **Step 6: Commit scaffold**

```bash
cd D:\cheeko-backend
git add docs-site/
git commit -m "docs: scaffold Docusaurus site structure"
```

---

## Task 2: Write intro.md and Architecture Pages

**Files:**
- Create: `docs-site/docs/intro.md`
- Create: `docs-site/docs/architecture/overview.md`
- Create: `docs-site/docs/architecture/protocols.md`

Before writing, read:
- `D:\cheeko-backend\docs\cheeko_complete_integration_reference.md` sections 1–4
- `CLAUDE.md` architecture section

- [ ] **Step 1: Read source docs**

Read `D:\cheeko-backend\docs\cheeko_complete_integration_reference.md` lines 1–150 for system components and boot flow.

- [ ] **Step 2: Write docs-site/docs/intro.md**

```markdown
---
id: intro
slug: /
sidebar_position: 1
---

# Cheeko Backend Overview

Cheeko is an AI companion for children (ages 3–16) running on ESP32 devices.
This documentation covers all five backend/firmware components and their integration.

## System Components

| Component | Language | Role |
|-----------|----------|------|
| **livekit-server** | Python | AI voice agent (conversation, games, music/story) |
| **manager-api-node** | Node.js / Express | REST API — device registry, OTA, config, content |
| **manager-web** | Vue.js | Admin dashboard for managing devices and content |
| **mqtt-gateway** | Node.js | Protocol bridge: MQTT/UDP (ESP32) ↔ LiveKit (WebRTC) |
| **ESP32 Firmware** | C++ / ESP-IDF | On-device client (state machine, audio, MQTT, RFID) |

## High-Level Data Flow

```
ESP32 Device
  │  MQTT (control messages)
  │  UDP  (Opus audio, AES-128-CTR encrypted)
  ▼
mqtt-gateway  ──HTTP──▶  manager-api-node
  │                            │
  │ LiveKit SDK (WebRTC)       │ Supabase / PostgreSQL
  ▼                            │
LiveKit Cloud                  │
  │                            │
  ▼                            │
livekit-server (AI agent) ◀────┘
  (reads config/prompts from manager-api-node)
```

## Quick Start

See [Architecture Overview](architecture/overview) for a full system diagram,
or jump straight to [Firmware Integration Guide](firmware/integration-guide) for
the complete device↔backend protocol reference.
```

- [ ] **Step 3: Write docs-site/docs/architecture/overview.md**

Read `cheeko_complete_integration_reference.md` lines 30–120 for full boot flow. Then write a comprehensive architecture overview page covering:
- Full ASCII system diagram (copy from integration reference section 1)
- Boot-to-conversation flow summary (phases 1–8)
- Service boundaries (who calls whom)
- Port map (manager-api :8002, mqtt broker :1883, UDP :8884, LiveKit cloud)

```markdown
---
id: overview
sidebar_position: 1
---

# Architecture Overview

## System Diagram

[Full diagram from cheeko_complete_integration_reference.md section 1 — copy verbatim]

## Boot Flow Summary

The device goes through 8 phases from power-on to active conversation:

| Phase | What Happens |
|-------|-------------|
| 1 – OTA Check | POST /toy/ota/ → get MQTT creds, firmware version, activation status |
| 2 – Activation | POST /toy/ota/activate (loop until success) |
| 3 – MQTT Connect | Connect to EMQX broker using OTA credentials |
| 4 – Hello Handshake | Device sends hello → Gateway returns UDP params |
| 5 – Mode Update | Gateway queries Manager API → sends mode_update to device |
| 6 – Conversation | Listen → speak → listen loop over MQTT + UDP |
| 7 – Abort/Interrupt | User presses button → abort sent → new listen starts |
| 8 – Session End | Device sends goodbye → LiveKit room closed |

## Service Port Map

| Service | Port | Protocol |
|---------|------|----------|
| manager-api-node | 8002 | HTTP/REST |
| EMQX MQTT broker | 1883 (MQTT), 8083 (WS) | MQTT |
| UDP audio server | 8884 | UDP |
| LiveKit Cloud | 443 | WebRTC / HTTPS |
```

- [ ] **Step 4: Write docs-site/docs/architecture/protocols.md**

Read `cheeko_complete_integration_reference.md` sections 13–14 (MQTT JSON structures + UDP packet format). Write the protocols reference page covering:
- All MQTT topics and message schemas (both directions)
- UDP packet header format (16 bytes, type/flags/length/connection_id/timestamp/sequence)
- AES-128-CTR encryption details

- [ ] **Step 5: Commit**

```bash
git add docs-site/docs/
git commit -m "docs: add intro, architecture overview, and protocols pages"
```

---

## Task 3: Write Firmware Integration Guide

**Files:**
- Create: `docs-site/docs/firmware/integration-guide.md`

Before writing, read:
- `D:\cheeko-backend\docs\cheeko_complete_integration_reference.md` (full file)
- `D:\cheeko-backend\docs\firmware_from_scratch_implementation_guide.md` (full file)

- [ ] **Step 1: Read both source documents**

Read `cheeko_complete_integration_reference.md` fully (all 17 sections).
Read `firmware_from_scratch_implementation_guide.md` fully.

- [ ] **Step 2: Write integration-guide.md**

This is the most important doc — a consolidated reference for firmware engineers. Structure:

```markdown
---
id: integration-guide
sidebar_position: 1
---

# Firmware Integration Guide

**Audience:** Firmware engineers implementing the Cheeko protocol on ESP32.

## Overview
[Brief intro]

## Phase 1: OTA Check
[From integration reference section 3 — exact HTTP request/response, all fields]

## Phase 2: Activation Loop
[From section 4]

## Phase 3: MQTT Connect and Hello Handshake
[From section 5 — topic names, hello JSON, gateway response JSON with UDP params]

## Phase 4: UDP Channel Setup
[From section 6 — how to open UDP socket, first packet format]

## Phase 5: Mode Update (Deferred)
[From section 7 — mode_update JSON structure, character/language/profile fields]

## Phase 6: Conversation Loop
[From section 8 — listen → speech_end → tts → stt → llm MQTT flow with timing]

## Phase 7: Abort / Interrupt
[From section 9 — abort JSON, when to send it]

## Phase 8: Session End (Goodbye)
[From section 10]

## RFID Card Flow
[From section 11 — card_lookup, card_not_found, card_found responses]

## Device State Machine
[From section 12 — all states, transitions, diagram]

## All MQTT Message Schemas
[From section 13 — every JSON message, both directions, with field tables]

## UDP Packet Format
[From section 14 — exact byte layout, type values, encryption]

## Manager API Endpoints Used by Firmware
[From section 15]
```

- [ ] **Step 3: Commit**

```bash
git add docs-site/docs/firmware/
git commit -m "docs: add firmware integration guide (full protocol reference)"
```

---

## Task 4: Write Manager API Node.js Docs

**Files:**
- Create: `docs-site/docs/backend/manager-api/overview.md`
- Create: `docs-site/docs/backend/manager-api/ota.md`
- Create: `docs-site/docs/backend/manager-api/device.md`
- Create: `docs-site/docs/backend/manager-api/agent.md`
- Create: `docs-site/docs/backend/manager-api/content.md`
- Create: `docs-site/docs/backend/manager-api/rfid.md`

Before writing, read these source files:
- `D:\cheeko-backend\main\manager-api-node\src\app.js`
- `D:\cheeko-backend\main\manager-api-node\src\routes\ota.routes.js`
- `D:\cheeko-backend\main\manager-api-node\src\routes\device.routes.js`
- `D:\cheeko-backend\main\manager-api-node\src\routes\agent.routes.js`
- `D:\cheeko-backend\main\manager-api-node\src\routes\content.routes.js`
- `D:\cheeko-backend\main\manager-api-node\src\routes\rfid.routes.js`
- `D:\cheeko-backend\main\manager-api-node\src\middleware\auth.js`
- `D:\cheeko-backend\main\manager-api-node\src\middleware\flexAuth.js`
- `D:\cheeko-backend\main\manager-api-node\src\services\agent.service.js`
- `D:\cheeko-backend\main\manager-api-node\src\services\device.service.js`

- [ ] **Step 1: Read all route and service files listed above**

Read each file to understand endpoints, request/response shapes, auth middleware applied, and business logic.

- [ ] **Step 2: Write overview.md**

```markdown
---
id: overview
sidebar_position: 1
---

# Manager API Overview

Express.js REST API — drop-in replacement for the original Java manager-api.

## Tech Stack
- Runtime: Node.js 20+
- Framework: Express.js
- Database: PostgreSQL via Prisma ORM
- Auth: Firebase Auth + Service Key (flexAuth middleware)
- Base path: `/toy`
- Port: 8002

## Middleware Stack
[Document auth.js, flexAuth.js, errorHandler.js, xssFilter.js, requestId.js from reading the files]

## Route Overview

| Module | Base Path | Description |
|--------|-----------|-------------|
| OTA | `/toy/ota` | Firmware update check + device activation |
| Device | `/toy/device` | Device CRUD |
| Agent | `/toy/agent` | Agent config + prompt management |
| Content | `/toy/content` | Music, stories, textbooks |
| RFID | `/toy/rfid` | RFID card management |
| Auth | `/toy/user` | User authentication |
| Analytics | `/toy/analytics` | Usage tracking |
| Mobile | `/toy/mobile` | Mobile app endpoints |

## Running the API

```bash
cd main/manager-api-node
npm install
npm run dev       # development with nodemon
npm start         # production
```
```

- [ ] **Step 3: Write ota.md**

Read `ota.routes.js` and the OTA service. Document:
- `POST /toy/ota/` — check OTA, returns mqtt_creds, firmware_info, activation_status
- `POST /toy/ota/activate` — activation endpoint
- Request/response JSON for each
- What fields the gateway uses from the OTA response

- [ ] **Step 4: Write device.md**

Read `device.routes.js` and `device.service.js`. Document all device CRUD endpoints with request/response examples.

- [ ] **Step 5: Write agent.md**

Read `agent.routes.js` and `agent.service.js`. Document:
- `GET /toy/agent/config/{mac}` — key endpoint used by gateway at session start
- Prompt management endpoints
- Response structure (character, mode, language, tts_voice, prompts, etc.)

- [ ] **Step 6: Write content.md and rfid.md**

Read `content.routes.js` and `rfid.routes.js`. Document all endpoints.

- [ ] **Step 7: Commit**

```bash
git add docs-site/docs/backend/manager-api/
git commit -m "docs: add manager-api-node API reference pages"
```

---

## Task 5: Write MQTT Gateway Docs

**Files:**
- Create: `docs-site/docs/backend/mqtt-gateway/overview.md`
- Create: `docs-site/docs/backend/mqtt-gateway/mqtt-protocol.md`
- Create: `docs-site/docs/backend/mqtt-gateway/audio-pipeline.md`

Before writing, read:
- `D:\cheeko-backend\main\mqtt-gateway\gateway\device-handlers.js`
- `D:\cheeko-backend\main\mqtt-gateway\gateway\emqx-broker.js`
- `D:\cheeko-backend\main\mqtt-gateway\gateway\udp-server.js`
- `D:\cheeko-backend\main\mqtt-gateway\livekit\audio-processor.js`
- `D:\cheeko-backend\main\mqtt-gateway\livekit\message-handlers.js`
- `D:\cheeko-backend\main\mqtt-gateway\livekit\mcp-handler.js`
- `D:\cheeko-backend\main\mqtt-gateway\mqtt\message-parser.js`
- `D:\cheeko-backend\main\mqtt-gateway\mqtt-protocol.js`
- `D:\cheeko-backend\main\mqtt-gateway\core\media-api-client.js`

- [ ] **Step 1: Read all gateway source files listed above**

- [ ] **Step 2: Write overview.md**

```markdown
---
id: overview
sidebar_position: 1
---

# MQTT Gateway Overview

The MQTT Gateway is the real-time protocol bridge between ESP32 devices and the LiveKit cloud.

## Module Layers

| Layer | Files | Responsibility |
|-------|-------|---------------|
| Gateway | `gateway/` | EMQX MQTT bridge, UDP server, device connection lifecycle |
| LiveKit | `livekit/` | LiveKit room creation, audio processing, data channel messages |
| MQTT | `mqtt/` | Message parsing and routing |
| Core | `core/` | Opus codec init, media API client, Mem0 memory client |
| Utils | `utils/` | Logger, config manager |

## Connection Lifecycle

[Document from device-handlers.js and emqx-broker.js: how a device connection is created, tracked, and cleaned up]

## Running

```bash
cd main/mqtt-gateway
npm install
node app.js
```
```

- [ ] **Step 3: Write mqtt-protocol.md**

Document all MQTT message types from `message-parser.js` and `device-handlers.js`:

**Device → Gateway messages:**
- `hello` — session initiation
- `listen` — start listening
- `speech_end` — user finished speaking
- `abort` — interrupt current speech
- `goodbye` — end session
- `mcp` — MCP tool call
- `card_lookup` — RFID card scan

**Gateway → Device messages:**
- `hello` — response with UDP params
- `tts` — TTS audio segment
- `stt` — speech-to-text result
- `llm` — LLM response text
- `mode_update` — character/mode config
- `card_found` / `card_not_found` — RFID responses

Include full JSON schema for each message type.

- [ ] **Step 4: Write audio-pipeline.md**

Document from `udp-server.js` and `audio-processor.js`:
- UDP socket setup and AES-128-CTR encryption/decryption
- Opus audio packet format (16-byte header)
- Uplink flow: device→gateway→LiveKit (16kHz → resampled)
- Downlink flow: LiveKit→gateway→device (48kHz → 24kHz resample → encrypted UDP)
- Audio worker thread architecture

- [ ] **Step 5: Commit**

```bash
git add docs-site/docs/backend/mqtt-gateway/
git commit -m "docs: add mqtt-gateway protocol and audio pipeline docs"
```

---

## Task 6: Write LiveKit Server (AI) Docs

**Files:**
- Create: `docs-site/docs/backend/livekit-server/overview.md`
- Create: `docs-site/docs/backend/livekit-server/cheeko-agent.md`
- Create: `docs-site/docs/backend/livekit-server/game-workers.md`

Before writing, read:
- `D:\cheeko-backend\main\livekit-server\workers\cheeko_worker.py`
- `D:\cheeko-backend\main\livekit-server\workers\math_tutor_worker.py`
- `D:\cheeko-backend\main\livekit-server\workers\riddle_solver_worker.py`
- `D:\cheeko-backend\main\livekit-server\workers\word_ladder_worker.py`
- `D:\cheeko-backend\main\livekit-server\src\services\prompt_service.py`
- `D:\cheeko-backend\main\livekit-server\src\services\analytics_service.py`
- `D:\cheeko-backend\main\livekit-server\src\mcp\mcp_handler.py`
- `D:\cheeko-backend\main\livekit-server\src\utils\audio_state_manager.py`

- [ ] **Step 1: Read all livekit-server source files listed above**

- [ ] **Step 2: Write overview.md**

```markdown
---
id: overview
sidebar_position: 1
---

# LiveKit Server Overview

Python AI agent workers that run inside LiveKit rooms and provide voice AI for Cheeko devices.

## Workers

| Worker | File | Mode |
|--------|------|------|
| Main conversation | `workers/cheeko_worker.py` | Default Cheeko AI companion |
| Math Tutor | `workers/math_tutor_worker.py` | Math game mode |
| Riddle Solver | `workers/riddle_solver_worker.py` | Riddle game mode |
| Word Ladder | `workers/word_ladder_worker.py` | Word game mode |

## Services

[Document from src/services/ — prompt_service, analytics_service, audio_player, music_service, etc.]

## External AI Providers

| Service | Purpose |
|---------|---------|
| Groq / Google Gemini | LLM (language model) |
| Deepgram / Whisper | STT (speech-to-text) |
| ElevenLabs / Edge-TTS | TTS (text-to-speech) |
| Qdrant | Vector search for content matching |
| Mem0 | Memory / personalization |

## Running

```bash
cd main/livekit-server
pip install -r requirements.txt

# Main conversation agent
python workers/cheeko_worker.py dev

# Game workers
python workers/math_tutor_worker.py dev
python workers/riddle_solver_worker.py dev
python workers/word_ladder_worker.py dev
```
```

- [ ] **Step 3: Write cheeko-agent.md**

Document `cheeko_worker.py` in detail:
- Agent class structure and initialization
- How it reads config from Manager API
- Data channel message handling (ready_for_greeting, end_prompt, shutdown_request, user_text)
- STT → LLM → TTS pipeline
- MCP tool integration (`src/mcp/mcp_handler.py`)
- Prompt loading (`src/services/prompt_service.py`)
- Analytics logging (`src/services/analytics_service.py`)

- [ ] **Step 4: Write game-workers.md**

Document each game worker:
- How they differ from cheeko_worker (game-specific prompts, scoring logic)
- How mode switching works (gateway dispatches different worker based on character/mode)
- Math tutor: problem generation, answer validation
- Riddle solver: riddle selection, hint system
- Word ladder: word validation, progression

- [ ] **Step 5: Commit**

```bash
git add docs-site/docs/backend/livekit-server/
git commit -m "docs: add livekit-server AI agent documentation"
```

---

## Task 7: Write Admin Dashboard and Deployment Docs

**Files:**
- Create: `docs-site/docs/admin/manager-web.md`
- Create: `docs-site/docs/deployment/environment.md`
- Create: `docs-site/docs/deployment/pm2.md`

Before writing, read:
- `D:\cheeko-backend\main\manager-web\src\views\` (glob all .vue files)
- `D:\cheeko-backend\main\manager-web\README.md`
- `D:\cheeko-backend\ecosystem.config.js` (if exists, else check main/ for PM2 config)
- `D:\cheeko-backend\main\manager-api-node\.env.example`
- `CLAUDE.md` environment variables section

- [ ] **Step 1: Read source files**

Glob `D:\cheeko-backend\main\manager-web\src\views\*.vue` and read README.md.
Read `.env.example` from manager-api-node.
Check for `ecosystem.config.js` at root.

- [ ] **Step 2: Write admin/manager-web.md**

```markdown
---
id: manager-web
sidebar_position: 1
---

# Admin Dashboard (Manager Web)

Vue.js admin interface for managing devices, content, models, and users.

## Running

```bash
cd main/manager-web
npm install
npm run serve    # dev server (hot reload)
npm run build    # production build → dist/
```

## Views / Screens

[Document each view from src/views/ — what it does, which API endpoints it calls]

| View | Route | Description |
|------|-------|-------------|
| ... | ... | ... |

## Authentication

[How admin auth works — login flow, session management]
```

- [ ] **Step 3: Write deployment/environment.md**

Document ALL environment variables across all components, organized by service:

```markdown
---
id: environment
sidebar_position: 1
---

# Environment Variables

## manager-api-node

| Variable | Required | Description | Example |
|----------|----------|-------------|---------|
| PORT | Yes | HTTP server port | `8002` |
| NODE_ENV | Yes | Environment | `development` |
| SUPABASE_URL | Yes | Supabase project URL | `https://xxx.supabase.co` |
| ... | ... | ... | ... |

## mqtt-gateway

| Variable | Required | Description |
|----------|----------|-------------|
| ... | ... | ... |

## livekit-server

| Variable | Required | Description |
|----------|----------|-------------|
| LIVEKIT_URL | Yes | LiveKit Cloud URL |
| LIVEKIT_API_KEY | Yes | LiveKit API key |
| LIVEKIT_API_SECRET | Yes | LiveKit API secret |
| ... | ... | ... |
```

- [ ] **Step 4: Write deployment/pm2.md**

Document the PM2 ecosystem config and how to run all services together.

- [ ] **Step 5: Commit**

```bash
git add docs-site/docs/admin/ docs-site/docs/deployment/
git commit -m "docs: add admin dashboard and deployment docs"
```

---

## Task 8: Final Build Verification and Polish

- [ ] **Step 1: Build the full site**

```bash
cd docs-site
npm run build
```
Expected: `Build Success` with no broken link errors. Fix any broken links if they appear.

- [ ] **Step 2: Serve production build and verify all pages load**

```bash
npm run serve
```
Open browser and navigate through every sidebar item. Verify:
- All pages render without 404
- Code blocks have syntax highlighting
- All internal links work

- [ ] **Step 3: Fix any broken sidebar links**

If any doc page is missing (sidebar entry exists but file doesn't), create a placeholder:
```markdown
---
id: <id>
---
# <Title>

Coming soon.
```

- [ ] **Step 4: Final commit**

```bash
cd D:\cheeko-backend
git add docs-site/
git commit -m "docs: complete Cheeko documentation site"
```

---

## Execution Notes

- Read source files before writing each page — don't invent API shapes
- Use exact field names from the actual code
- ASCII diagrams: copy verbatim from `cheeko_complete_integration_reference.md` where they exist
- For MQTT JSON schemas: copy exact structures from source code comments or message-parser.js
- Use Docusaurus `:::tip`, `:::warning`, `:::info` admonitions for important callouts
- Tables preferred over prose for: endpoints, env vars, message fields, state transitions
