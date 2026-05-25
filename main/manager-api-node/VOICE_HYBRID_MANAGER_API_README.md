# Voice Hybrid Manager API Plan (Pre-Implementation)

## Goal
Enable LiveKit voice workers to fetch **global active provider settings** (LLM/STT/TTS) from Manager API + Prisma, with fallback to worker `config.json`, while keeping session persistence on **room close only**.

## Confirmed Scope From Earlier Decisions
- Global provider settings are common for all devices.
- Manager API is source of truth when available.
- Worker falls back to local `config.json` when manager is unavailable or incomplete.
- Session persistence is room-close only (summary/end/chat-history batch), not per-message durability.
- Voice runtime keeps native tools and no `exec` in runtime allowlist.

## Current State (Audit)
- Present:
  - Device settings sync tables and flows (`device_settings`, `device_runtime_state`, `device_sync_event`).
  - Voice session persistence endpoints in `/agent/.../summary`, `/agent/.../end`, `/agent/chat-history/session`.
  - Token usage ingestion endpoints.
- Missing:
  - No `GET /livekit/providers/active` endpoint.
  - Prisma does not model `stt_providers` yet in this repo.
  - No dedicated Prisma tables for global active `llm` and `tts` runtime selection.

## What We Will Add

### 1) Prisma schema + migrations (required first)
Use existing STT table and add two sibling tables for runtime activation:

- Reuse existing `stt_providers` table
  - Add Prisma model in this repo.
  - Keep worker-compatible fields (`provider_name`, `api_key`, `model`, `language`, `is_active`, `priority`).

- Add `llm_providers` table
  - `model_name`, `model`, `api_base`, `api_key`, `is_active`, `priority`, timestamps.

- Add `tts_providers` table
  - `provider_name`, `voice_id`, `model_id`, `output_format`, `sample_rate_hz`, `temperature`, `api_key`, `is_active`, `priority`, timestamps.

Notes:
- Single active row per table is enforced by API transaction logic (`deactivate all -> activate target`).
- Keep plaintext keys in worker-facing runtime tables for this phase (as requested).

### 2) Manager API service + routes
Add internal and admin routes:

- Service-key route:
  - `GET /livekit/providers/active`
  - Response shape:
    - `{ llm: {...}, stt: {...}, tts: {...}, updated_at }`
  - Returns only enabled rows; missing sections omitted or null.

- Admin routes (dashboard/backend auth):
  - `PUT /livekit/providers/active/llm`
  - `PUT /livekit/providers/active/stt`
  - `PUT /livekit/providers/active/tts`
  - Optional `GET` list route for admin UI preload.

Validation:
- Required fields by provider type.
- Normalize provider names and model strings.
- Reject invalid combinations early (400).

### 3) Worker integration contract
- Worker calls `GET /livekit/providers/active` at room start.
- Apply runtime overrides for that room only.
- If manager fetch fails or payload is partial, keep configured fallback from `config.json`.
- No hot-switch within active room (applies to new sessions only).

### 4) Security and operational guardrails
- Service-key required for `GET /livekit/providers/active`.
- Audit log provider changes (who changed, when, what fields).
- Keep plaintext key storage as requested for now, but isolate access to privileged endpoints only.

## What We Are Removing / Restricting
- No runtime `exec` dependency for time/weather behavior in voice runtime.
- No per-device provider override logic in this phase (global only).
- No per-message crash-safe persistence path in this phase (room-close only).
- No frontend coupling in voice worker fork (already removed in picoclaw branch).

## Implementation Plan (Phase 1 & 2)

## Phase 1: Data + API contract
- [ ] Add Prisma models + SQL migration files (`stt_providers` modeled, `llm_providers` + `tts_providers` created)  
  -> Verify: `prisma migrate` applies cleanly on fresh and existing DB.
- [ ] Add service methods for read/update active LLM/STT/TTS rows  
  -> Verify: unit tests for validation and upsert behavior.
- [ ] Add `GET /livekit/providers/active` with service-key auth  
  -> Verify: returns expected JSON and rejects missing/invalid service key.
- [ ] Add admin update routes for LLM/STT/TTS active rows  
  -> Verify: update/read roundtrip works and invalid payloads fail with 400.

## Phase 2: Runtime alignment + rollout safety
- [ ] Confirm worker-room-start fetch contract against manager payload  
  -> Verify: new room picks manager values; ongoing room remains unchanged.
- [ ] Ensure fallback behavior to `config.json` on manager failure  
  -> Verify: simulated manager timeout still boots session.
- [ ] Add integration tests for room-close-only persistence compatibility  
  -> Verify: summary/end/chat-history batch still succeeds with provider tables enabled.
- [ ] Add docs/runbook for operations and rollback  
  -> Verify: operators can disable provider rows and revert to config fallback quickly.

## Test Checklist (One-by-One)
1. `GET /livekit/providers/active` with valid service key.
2. `GET /livekit/providers/active` without service key (expect 401/403).
3. Admin update LLM provider with valid OpenRouter config.
4. Admin update STT provider and confirm reflected in read endpoint.
5. Admin update TTS provider with `voice_id` and output params.
6. Start new room session and confirm manager settings applied.
7. Keep existing room running and change provider in DB (should not switch mid-room).
8. Bring manager endpoint down; start new room; confirm `config.json` fallback.
9. Close room and verify summary/end/chat-history persisted as before.

## Approval Gate (No Code Beyond This Doc Yet)
Proceed only after your explicit approval for:
- Sibling table names/fields above.
- Endpoint paths above.
- Plaintext key storage in DB for this phase.
- “New sessions only” provider application behavior.
