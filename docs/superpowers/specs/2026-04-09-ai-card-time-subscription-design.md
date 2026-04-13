# AI Card Time-Based Subscription Design

**Date:** 2026-04-09  
**Status:** Draft — Pending User Review  
**Approach:** A — Inline Per-Card Table + RPC  
**Rollout Strategy:** AI cards (`card_type='ai'`) use the new system exclusively from day 1. All other card types (content, qna, prompt) continue using existing flows with no quota check. No feature flag needed. Old tables/endpoints stay for backward compatibility but are deprecated.

**Prepaid Card Model:** AI Cards work like **prepaid cards** — each physical card has its own time balance. Quota lives on the **card itself** (by `rfid_uid`), not on the user. When a child taps a card on their device, the card is "discovered" — it appears in the parent's app. The quota is **shared** — if two families tap the same physical card, both see it in their apps and both draw from the same time bucket. No activation flow needed. Company ships device + card bundle with 50 mins free pre-loaded per AI card.

---

## Requirements

- Each AI Card (RFID/NFC) is a **prepaid card** with its own independent monthly time bucket
- **No activation flow** — card is "discovered" when a child taps it on their device
- Quota lives on the **card** (`rfid_uid`), not the user. **Shared across all users/devices that tap it.**
- If User A uses 30 minutes, User B sees 20 remaining (same bucket)
- Any user who taps a card sees it in their "My Cards" list in the parent app
- Time quota **resets monthly** (`YYYY-MM` key, UTC)
- Parents can **recharge** individual cards via the parent app/website
- Company ships device + card bundle with **50 minutes free** per AI card pre-loaded
- **Hard stop** when time runs out — device plays recharge audio via MQTT
- **Replaces** the old device-level subscription quota system for AI cards only
- **Content cards** (stories, rhymes, Q&A) remain **free/unlimited**
- Time limit configured **per individual card** (`monthly_time_limit_secs` on `rfid_card_mapping`)
- `month_key` is generated in UTC by the Node.js service layer (`getCurrentMonthKey()` from `quota.service.js`), matching the Python `quota_manager.py` behavior (`datetime.now(timezone.utc)`)
- "My Cards" view in parent app: shows cards the child has tapped, with remaining time per card
- **Unconfigured cards** (`monthly_time_limit_secs = 0`) are blocked at tap with prompt to contact support

---

## Card-to-User Discovery Model

Cards are **NOT bound to users**. The relationship is discovered through taps:

```
Child taps AI Card (rfid_uid=ABC123) on Device (mac=AA:BB:CC)
  ↓
rfid_card_tap_log INSERT: { user_id: 123, rfid_uid: "ABC123", ... }
  ↓
Parent opens app → GET /subscription/my-cards
  ↓
Query: SELECT DISTINCT rfid_uid FROM rfid_card_tap_log WHERE user_id = 123
  ↓
For each card: fetch ai_card_time_quota → show remaining time
  ↓
Parent sees "Magic Card — 20 mins remaining" in "My Cards" view
```

**Shared quota behavior:** If User A and User B both tap the same physical card, both see it in their "My Cards" list. Both draw from the same `ai_card_time_quota` row keyed by `rfid_uid`. If User A consumes 30 minutes, User B sees 20 remaining. Whoever recharges the card increases the bucket for everyone.

**Edge case — card given away:** If User A gives their Magic Card to User B, User B taps it and now sees it in their app. User A also still sees it (they tapped it before). Both share the same quota. This is acceptable — physical cards can be gifted, and the quota follows the card.

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│  ESP32 Device                                               │
│  - Child taps AI Card (RFID UID: ABC123)                   │
│  - Sends MQTT card_lookup to gateway                       │
└────────┬────────────────────────────────────────────────────┘
         │ MQTT card_lookup
         ▼
┌─────────────────────────────────────────────────────────────┐
│  MQTT Gateway                                               │
│  - Calls GET /admin/rfid/card/lookup/:rfidUid              │
│    (actual path from mqtt-gateway.js)                       │
│  - Receives card info + quota status                       │
│  - If quota exhausted → sends MQTT time_quota_exhausted    │
│    → device plays recharge audio                            │
│  - If quota OK → forwards to LiveKit with rfid_uid context  │
└────────┬────────────────────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────────────────────────┐
│  Manager API (Node.js)                                      │
│  - RFID lookup checks ai_card_time_quota                    │
│  - Returns quota status in card lookup response             │
│  - POST /quota/consume/ai-card-time/:rfid_uid               │
│    consumes elapsed seconds via RPC                         │
│  - POST /subscription/recharge/:rfid_uid grants extra time   │
└────────┬────────────────────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────────────────────────┐
│  Supabase (PostgreSQL)                                      │
│  - ai_card_time_quota: (rfid_uid, month_key, seconds_used,  │
│    extra_purchased) UNIQUE(rfid_uid, month_key)             │
│  - RPC consume_ai_card_time: atomic UPSERT                  │
│  - RPC grant_ai_card_extra_time: atomic UPSERT              │
└────────┬────────────────────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────────────────────────┐
│  LiveKit Worker (Python QuotaManager)                       │
│  - initialize() fetches quota with rfid_uid context         │
│  - Background _time_tracker_loop ticks every 30s            │
│  - Reports delta seconds to manager API                     │
│  - If exhausted → hard stop, disconnect voice session       │
│  - Worker calls Manager API → Manager publishes MQTT        │
│    time_quota_exhausted to gateway → device                 │
└─────────────────────────────────────────────────────────────┘
```

**MQTT exhaust message flow:** The LiveKit worker does NOT send MQTT directly. When quota is exhausted, the worker calls `POST /quota/publish-mqtt-exhaust` on the Manager API. The Manager API (which has MQTT broker connectivity or calls the gateway API) publishes the `time_quota_exhausted` message to the device. Alternative: the Manager API calls the MQTT gateway's HTTP endpoint to trigger the downstream message.

---

## Database Changes

### 1. Add `monthly_time_limit_secs` to `rfid_card_mapping`

```sql
ALTER TABLE rfid_card_mapping
  ADD COLUMN IF NOT EXISTS monthly_time_limit_secs INTEGER NOT NULL DEFAULT 0;

COMMENT ON COLUMN rfid_card_mapping.monthly_time_limit_secs
  IS 'Monthly time limit in seconds for this AI card. 0 = disabled until recharged.';
```

### 2. New table `ai_card_time_quota`

```sql
CREATE TABLE IF NOT EXISTS ai_card_time_quota (
  id BIGSERIAL PRIMARY KEY,
  rfid_uid VARCHAR(100) NOT NULL,
  month_key VARCHAR(7) NOT NULL,              -- 'YYYY-MM'
  seconds_used INTEGER NOT NULL DEFAULT 0,
  extra_purchased INTEGER NOT NULL DEFAULT 0,  -- admin/parent granted
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(rfid_uid, month_key)
);

CREATE INDEX idx_ai_card_time_quota_rfid ON ai_card_time_quota(rfid_uid);
CREATE INDEX idx_ai_card_time_quota_month ON ai_card_time_quota(month_key);

COMMENT ON TABLE ai_card_time_quota IS 'Tracks session time per AI card (RFID UID) per month';
```

### 3. RPC: `consume_ai_card_time`

```sql
CREATE OR REPLACE FUNCTION consume_ai_card_time(
  p_rfid_uid VARCHAR(100),
  p_month_key VARCHAR(7),
  p_seconds INTEGER,
  p_time_limit INTEGER
)
RETURNS TABLE(
  out_seconds_used INTEGER,
  out_extra_purchased INTEGER,
  out_remaining INTEGER,
  out_is_exhausted BOOLEAN,
  out_month_key VARCHAR(7)
)
LANGUAGE plpgsql AS $$
DECLARE
  v_seconds_used INTEGER;
  v_extra_purchased INTEGER;
  v_total_allowed INTEGER;
  v_remaining INTEGER;
BEGIN
  INSERT INTO ai_card_time_quota (rfid_uid, month_key, seconds_used, extra_purchased)
  VALUES (p_rfid_uid, p_month_key, p_seconds, 0)
  ON CONFLICT (rfid_uid, month_key)
  DO UPDATE SET
    seconds_used = ai_card_time_quota.seconds_used + p_seconds,
    updated_at = CURRENT_TIMESTAMP
  RETURNING
    ai_card_time_quota.seconds_used,
    ai_card_time_quota.extra_purchased
  INTO v_seconds_used, v_extra_purchased;

  IF p_time_limit = -1 THEN
    v_remaining := -1;
    RETURN QUERY SELECT v_seconds_used, v_extra_purchased, v_remaining, FALSE, p_month_key;
    RETURN;
  END IF;

  v_total_allowed := p_time_limit + v_extra_purchased;
  v_remaining := GREATEST(0, v_total_allowed - v_seconds_used);

  RETURN QUERY SELECT
    v_seconds_used,
    v_extra_purchased,
    v_remaining,
    (v_remaining <= 0),
    p_month_key;
END;
$$;
```

### 4. RPC: `grant_ai_card_extra_time`

```sql
CREATE OR REPLACE FUNCTION grant_ai_card_extra_time(
  p_rfid_uid VARCHAR(100),
  p_month_key VARCHAR(7),
  p_amount INTEGER,
  p_time_limit INTEGER
)
RETURNS TABLE(
  out_seconds_used INTEGER,
  out_extra_purchased INTEGER,
  out_remaining INTEGER,
  out_is_exhausted BOOLEAN,
  out_month_key VARCHAR(7)
)
LANGUAGE plpgsql AS $$
DECLARE
  v_seconds_used INTEGER;
  v_extra_purchased INTEGER;
  v_total_allowed INTEGER;
  v_remaining INTEGER;
BEGIN
  INSERT INTO ai_card_time_quota (rfid_uid, month_key, seconds_used, extra_purchased)
  VALUES (p_rfid_uid, p_month_key, 0, p_amount)
  ON CONFLICT (rfid_uid, month_key)
  DO UPDATE SET
    extra_purchased = ai_card_time_quota.extra_purchased + p_amount,
    updated_at = CURRENT_TIMESTAMP
  RETURNING
    ai_card_time_quota.seconds_used,
    ai_card_time_quota.extra_purchased
  INTO v_seconds_used, v_extra_purchased;

  IF p_time_limit = -1 THEN
    v_remaining := -1;
    RETURN QUERY SELECT v_seconds_used, v_extra_purchased, v_remaining, FALSE, p_month_key;
    RETURN;
  END IF;

  v_total_allowed := p_time_limit + v_extra_purchased;
  v_remaining := GREATEST(0, v_total_allowed - v_seconds_used);

  RETURN QUERY SELECT
    v_seconds_used,
    v_extra_purchased,
    v_remaining,
    (v_remaining <= 0),
    p_month_key;
END;
$$;
```

### 5. Down Migration (Rollback)

```sql
-- Safe to run at any time. Preserves data, removes schema.
DROP FUNCTION IF EXISTS consume_ai_card_time CASCADE;
DROP FUNCTION IF EXISTS grant_ai_card_extra_time CASCADE;
DROP TABLE IF EXISTS ai_card_time_quota CASCADE;
-- Note: monthly_time_limit_secs column on rfid_card_mapping is kept (harmless)
-- To fully remove: ALTER TABLE rfid_card_mapping DROP COLUMN monthly_time_limit_secs;
```

---

## Quota Check Flow (Card Tap)

```
1. ESP32 scans RFID → sends MQTT card_lookup with rfid_uid
2. Gateway calls GET /admin/rfid/card/lookup/:rfidUid
3. Manager API:
   a. Finds rfid_card_mapping where rfid_uid matches
   b. Checks card_type == 'ai'
   c. If AI card → checks ai_card_time_quota (rfid_uid, current month_key)
   d. limit = card.monthly_time_limit_secs + quota.extra_purchased
   e. used = quota.seconds_used (or 0 if no row exists)
   f. remaining = limit - used
4. If remaining <= 0 or monthly_time_limit_secs == 0:
   → Response includes { quotaExhausted: true }
   → Gateway sends MQTT time_quota_exhausted to device
   → Device plays recharge audio
   → Session does NOT start
5. If remaining > 0 or no quota check needed:
   → Normal flow → session starts
```

---

## Time Consumption Flow

```
1. LiveKit session starts with rfid_uid context from card tap
2. QuotaManager._time_tracker_loop ticks every 30 seconds:
   a. elapsed_total = monotonic_now - session_start
   b. delta = elapsed_total - total_seconds_reported
   c. POST /subscription/consume/ai-card-time/:rfid_uid { seconds: delta }
   d. RPC consume_ai_card_time → seconds_used += delta
   e. Returns { remaining, isExhausted }
3. If isExhausted:
   → stop_time_tracker() → report final delta
   → Disconnect voice session
   → Worker sends MQTT time_quota_exhausted via gateway
   → Device plays recharge audio
4. Session ends naturally → stop_time_tracker() reports final seconds
```

---

## Parent App Recharge Flow

```
1. Parent visits web dashboard
2. Sees card "Magic Card (ABC123)" — Time: 0 / 1800s this month
3. Clicks "Recharge" → enters additional seconds (e.g., 3600s = 1hr)
4. POST /subscription/recharge/:rfid_uid { amount: 3600 }
5. RPC grant_ai_card_extra_time → extra_purchased += 3600
6. Response: { remaining: 3600, extraPurchased: 3600 }
7. Parent app shows "Recharged! 1 hour added."
```

---

## Corner Cases

| # | Case | Handling |
|---|------|----------|
| 1 | **Quota exhausted at tap** | Card lookup returns `quotaExhausted: true`. Gateway sends `time_quota_exhausted` MQTT → device plays recharge audio. Session never starts. |
| 2 | **Quota expires mid-session** | `_time_tracker_loop` detects `remaining <= 0`. Calls `stop_time_tracker()`. Final seconds reported. Worker disconnects voice session. MQTT `time_quota_exhausted` sent → device plays recharge audio. **Hard stop.** |
| 3 | **Network unreachable during quota check** | **Fail-open** (child safety). Allow session, track locally. Log warning. Sync when network recovers. Configurable via `ai_card_quota_fail_mode` sys_param with values `open` (unlimited) or `capped` (allow up to 600s locally, then hard stop). Default: `open`. |
| 4 | **Network unreachable during time consumption** | Retry with exponential backoff (3 attempts: 0.5s, 1.0s delays). If all fail, continue tracking locally. Next successful tick sends cumulative delta. No hard stop from API failure. |
| 5 | **Concurrent taps on same card (same rfid_uid)** | Each tap creates its own LiveKit session with independent QuotaManager. Both report to same `ai_card_time_quota` row. Race condition handled by RPC UPSERT (`seconds_used += delta`). Total time consumed = sum of both sessions. |
| 6 | **Recharge during active session** | If parent recharges while session is running, next tick from `_fire_and_update_time` will see increased `extra_purchased` in RPC response. Session continues if newly recharged quota > used. No restart needed. |
| 7 | **Card has `monthly_time_limit_secs = 0` (admin forgot)** | Treated as 0 limit. `remaining = 0 + extra_purchased`. If no extra purchased → blocked at tap. If admin recharges → works. Card effectively disabled until configured or recharged. |
| 8 | **Admin changes `monthly_time_limit_secs` mid-month** | **No recalculation.** The limit is read at tap time from `rfid_card_mapping`. Subsequent quota checks use the new limit. Already-consumed time stays. `remaining = new_limit - used`. If new limit < used → exhausted immediately. |
| 9 | **Month boundary rollover during active session** | Session starts at month M1, crosses into M2 at midnight. `month_key` changes. RPC UPSERT inserts new row for M2 with `seconds_used = delta`. M1 row stays as-is. No double-charging. |
| 10 | **Card deleted/unmapped mid-session** | Quota check at tap already passed. Session continues until exhaustion or natural end. If card is re-added later, new month gets fresh quota. Historical data preserved in `rfid_card_tap_log`. |
| 11 | **Device offline during session** | `stop_time_tracker()` called on disconnect. Reports final elapsed seconds. If API unreachable, seconds are lost (fair trade-off for child safety). Next tap re-syncs from server. |
| 12 | **Partial/delayed seconds reporting** | `_time_tracker_loop` uses `monotonic()` clock. Each tick reports `delta = elapsed_total - total_reported`. Late ticks send accumulated delta. UPSERT handles any order. |
| 13 | **RFID UID format inconsistency** (ABC123 vs abc123 vs AB:C1:23) | Normalize in service layer: strip colons/hyphens, lowercase. All lookups and consumes use normalized UID. |
| 14 | **Multiple rapid card taps (card swap mid-conversation)** | Each tap triggers a new `card_lookup`. If a different card is tapped, the previous session is still tracked by its own QuotaManager (tied to original `rfid_uid`). New session starts with new card's quota. No interference. |
| 15 | **Duplicate quota consumption on API retry** | RPC is **additive** (`seconds_used += p_seconds`). If the same 30s tick is reported twice (unlikely), it double-consumes. Mitigation: client tracks `_total_seconds_reported` and only sends new delta. |

---

## API Endpoints

### Agent Worker (Service Key Auth)

| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/subscription/quota/ai-card/:rfid_uid` | Get AI card time quota at session start |
| `POST` | `/subscription/consume/ai-card-time/:rfid_uid` | Consume elapsed seconds (every 30s tick) |

### Admin / Parent App

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| `POST` | `/subscription/recharge/:rfid_uid` | requireAuth | Grant extra time to a card (recharge) |
| `GET` | `/subscription/ai-card-status/:rfid_uid` | requireAuth | Get card time usage and remaining |
| `GET` | `/subscription/my-cards` | requireAuth | Parent's discovered cards with quota |
| `GET` | `/subscription/ai-cards/summary` | requireAdmin | List all AI cards with time usage |
| `POST` | `/quota/publish-mqtt-exhaust` | requireServiceKey | Worker triggers MQTT exhaust to device |

---

## MQTT Messages

### `time_quota_exhausted` (Gateway → Device)

Sent when an AI card's time quota is exhausted (at tap or mid-session).

```json
{
  "topic": "device/down/{mac}/time_quota_exhausted",
  "payload": {
    "rfid_uid": "ABC123",
    "card_name": "Magic Card",
    "message": "Time quota exhausted for this month. Please recharge.",
    "audio_prompt": "recharge_required"
  }
}
```

Device behavior: plays pre-loaded audio file saying "Your time for this card is used up. Ask your parents to recharge."

### `card_not_configured` (Gateway → Device)

Sent when an AI card has `monthly_time_limit_secs = 0` (admin hasn't configured the time limit).

```json
{
  "topic": "device/down/{mac}/card_not_configured",
  "payload": {
    "rfid_uid": "ABC123",
    "card_name": "Magic Card",
    "message": "This card is not yet configured. Please contact support.",
    "audio_prompt": "card_not_configured"
  }
}
```

Device behavior: plays pre-loaded audio file saying "This card is not ready yet. Ask your parents to contact support."

---

## Files Modified

| File | Changes |
|------|---------|
| `supabase/migrations/20260409_create_ai_card_time_quota.sql` | New migration: table, RPCs, column on rfid_card_mapping |
| `src/services/subscription.service.js` | Add `getAiCardTimeQuota()`, `consumeAiCardTime()`, `rechargeAiCard()`, `getAiCardStatus()`, `listAiCardsSummary()` |
| `src/services/rfid.service.js` | Modify `lookupCardByRfidUid()` to check AI card time quota and include in response |
| `src/routes/subscription.routes.js` | Add `/quota/ai-card/:rfid_uid`, `/consume/ai-card-time/:rfid_uid`, `/recharge/:rfid_uid`, `/ai-card-status/:rfid_uid`, `/ai-cards/summary` |
| `mqtt-gateway/gateway/mqtt-gateway.js` | Handle AI card quota exhaustion in lookup response, send MQTT `time_quota_exhausted` |
| `livekit-server/src/utils/quota_manager.py` | Add `rfid_uid` parameter, `_consume_ai_card_time()`, modify initialize/consume dispatch for AI card mode |
| `manager-web/src/apis/module/subscription.js` | Add recharge and status API calls |
| `manager-web/src/views/QuotaSettings.vue` | Add AI card time quota management UI |
| `manager-web/src/components/AiCardRechargeDialog.vue` | New component for recharging cards |

---

## Migration from Old System

Since this **replaces** the old device-level subscription quota system:

1. **Old tables stay** (`user_question_quota`, `user_token_quota`, `user_time_quota`) for backward compatibility during migration
2. **Old endpoints remain** but are deprecated — no new code should call them
3. **`QuotaManager.initialize()`** now prioritizes AI card quota when `rfid_uid` is provided, falls back to old system if not
4. **Game session protection** (`start_game_session`/`end_game_session`) is removed — only relevant for question-based quota
5. **Phased rollout**: AI cards use new system, content cards skip quota entirely, unbound devices get unlimited

---

## Seeded Data

```sql
-- Set default time limits for existing AI cards (50 minutes = 3000 seconds)
UPDATE rfid_card_mapping
SET monthly_time_limit_secs = 3000
WHERE card_type = 'ai' AND monthly_time_limit_secs = 0;
```

Admins can then adjust per-card limits as needed.

---

## Prisma Schema Updates

### `rfid_card_mapping` model addition

```prisma
// Add to existing rfid_card_mapping model:
monthly_time_limit_secs Int @default(0) @map("monthly_time_limit_secs")
```

### New `ai_card_time_quota` model

```prisma
model ai_card_time_quota {
  id              BigInt   @id @default(autoincrement())
  rfid_uid        String   @db.VarChar(100)
  month_key       String   @db.VarChar(7)
  seconds_used    Int      @default(0)
  extra_purchased Int      @default(0)
  created_at      DateTime @default(now()) @db.Timestamptz
  updated_at      DateTime @default(now()) @db.Timestamptz

  @@unique([rfid_uid, month_key])
  @@index([rfid_uid])
  @@map("ai_card_time_quota")
}
```

**Note on `rfid_uid` type consistency:** `rfid_card_mapping.rfid_uid` is `VARCHAR(50)` in Prisma but `rfid_card_tap_log.rfid_uid` is `VARCHAR(100)`. The new `ai_card_time_quota` uses `VARCHAR(100)` to match the tap_log table.

**UID normalization standard:** All components MUST normalize RFID UIDs to **UPPERCASE, no separators**. Example: `ab:cd:12:34` → `ABCD1234`.
- Node.js (`rfid.service.js`): `uid.trim().toUpperCase().replace(/[^0-9A-F]/g, '')`
- Python (`quota_manager.py`): `rfid_uid.strip().upper().replace(':', '').replace('-', '')`
- Both sides must agree on this format. The RPC receives the normalized UID. Database stores uppercase.

---

## API Endpoint Schemas

### `GET /subscription/quota/ai-card/:rfid_uid` (Service Key Auth)

**Request:**
```
GET /subscription/quota/ai-card/abc123
Headers: X-Service-Key: <key>
```

**Response 200:**
```json
{
  "success": true,
  "data": {
    "rfidUid": "abc123",
    "cardName": "Magic Card",
    "quotaType": "ai_card_time",
    "remaining": 1200,
    "isExhausted": false,
    "limit": 1800,
    "used": 600,
    "extraPurchased": 0,
    "monthKey": "2026-04"
  },
  "message": "AI card quota retrieved"
}
```

**Response 200 (exhausted):**
```json
{
  "success": true,
  "data": {
    "rfidUid": "abc123",
    "cardName": "Magic Card",
    "quotaType": "ai_card_time",
    "remaining": 0,
    "isExhausted": true,
    "limit": 1800,
    "used": 1800,
    "extraPurchased": 0,
    "monthKey": "2026-04",
    "quotaExhausted": true
  },
  "message": "AI card quota retrieved"
}
```

### `POST /subscription/consume/ai-card-time/:rfid_uid` (Service Key Auth)

**Request:**
```
POST /subscription/consume/ai-card-time/abc123
Headers: X-Service-Key: <key>
Content-Type: application/json

{
  "seconds": 30,
  "monthKey": "2026-04"
}
```

**Response 200:**
```json
{
  "success": true,
  "data": {
    "remaining": 1170,
    "isExhausted": false,
    "secondsUsed": 630,
    "extraPurchased": 0,
    "rfidUid": "abc123",
    "monthKey": "2026-04"
  },
  "message": "AI card time consumed"
}
```

### `POST /subscription/recharge/:rfid_uid` (Auth: requireAuth for parent, requireAdmin for admin)

**Request:**
```
POST /subscription/recharge/ABC123
Headers: Authorization: Bearer <token>
Content-Type: application/json

{
  "amount": 3600
}
```

**Validation rules:**
- `amount` must be a positive integer (> 0)
- `amount` maximum: 86400 (24 hours) per single recharge
- Rate limit: max 5 recharges per card per day

**Response 200:**
```json
{
  "success": true,
  "data": {
    "remaining": 3600,
    "isExhausted": false,
    "secondsUsed": 1800,
    "extraPurchased": 3600,
    "rfidUid": "ABC123",
    "monthKey": "2026-04"
  },
  "message": "Granted 3600 extra seconds"
}
```

**Error response 400:**
```json
{
  "success": false,
  "message": "Amount must be between 1 and 86400 seconds"
}
```

### `GET /subscription/ai-card-status/:rfid_uid` (Auth: requireAuth)

**Request:**
```
GET /subscription/ai-card-status/abc123
Headers: Authorization: Bearer <token>
```

**Response 200:**
```json
{
  "success": true,
  "data": {
    "rfidUid": "abc123",
    "cardName": "Magic Card",
    "notes": "AI conversation card",
    "monthlyTimeLimit": 1800,
    "secondsUsed": 1800,
    "extraPurchased": 0,
    "remaining": 0,
    "isExhausted": true,
    "monthKey": "2026-04"
  },
  "message": "AI card status retrieved"
}
```

### `GET /subscription/ai-cards/summary` (Auth: requireAdmin)

**Request:**
```
GET /subscription/ai-cards/summary?page=1&limit=20&monthKey=2026-04
Headers: Authorization: Bearer <token>
```

**Response 200:**
```json
{
  "success": true,
  "data": {
    "cards": [
      {
        "id": 1,
        "rfidUid": "ABC123",
        "notes": "Magic Card",
        "cardType": "ai",
        "monthlyTimeLimit": 3000,
        "secondsUsed": 1800,
        "extraPurchased": 0,
        "remaining": 1200,
        "isExhausted": false
      }
    ],
    "total": 15,
    "page": 1,
    "limit": 20
  },
  "message": "AI cards summary retrieved"
}
```

### `GET /subscription/my-cards` (Auth: requireAuth)

**Request:**
```
GET /subscription/my-cards
Headers: Authorization: Bearer <token>
```

**Response 200:**
```json
{
  "success": true,
  "data": {
    "cards": [
      {
        "rfidUid": "ABC123",
        "cardName": "Magic Card",
        "notes": "AI conversation card",
        "monthlyTimeLimit": 3000,
        "secondsUsed": 600,
        "extraPurchased": 0,
        "remaining": 2400,
        "isExhausted": false,
        "monthKey": "2026-04",
        "lastTapped": "2026-04-08T14:30:00Z"
      }
    ]
  },
  "message": "My cards retrieved successfully"
}
```

**Implementation note:** `listAiCardsForUser` queries `rfid_card_tap_log` for distinct `rfid_uid` values where `user_id = ?`, then joins with `rfid_card_mapping` for card metadata and `ai_card_time_quota` for current month usage. Since `ai_card_time_quota` won't exist in Prisma client until after migration, use `prisma.$queryRaw` for the join.

### `POST /quota/publish-mqtt-exhaust` (Auth: requireServiceKey)

**Request:**
```
POST /quota/publish-mqtt-exhaust
Headers: X-Service-Key: <key>
Content-Type: application/json

{
  "macAddress": "AA:BB:CC:DD:EE:FF",
  "rfidUid": "ABC123",
  "cardName": "Magic Card",
  "messageType": "time_quota_exhausted",
  "payload": {
    "rfid_uid": "ABC123",
    "card_name": "Magic Card",
    "message": "Time quota exhausted for this month. Please recharge.",
    "audio_prompt": "recharge_required"
  }
}
```

**Response 200:**
```json
{
  "success": true,
  "data": {
    "published": true,
    "topic": "device/down/AA:BB:CC:DD:EE:FF/time_quota_exhausted"
  },
  "message": "MQTT exhaust message published"
}
```

**Implementation note:** The Manager API publishes the MQTT message directly to the EMQX broker (via MQTT client library) OR calls the MQTT gateway's HTTP endpoint. The exact mechanism depends on whether the Manager API has direct MQTT broker connectivity. If not, it calls `POST http://mqtt-gateway:3000/publish` with the same payload.

---

## QuotaManager Code Changes (Python)

### Constructor addition

```python
class QuotaManager:
    def __init__(self, mac_address: str, manager_api_url: str, secret: str,
                 rfid_uid: Optional[str] = None):
        # ... existing init ...
        self.rfid_uid = rfid_uid  # NEW: set when session triggered by AI card tap
        self._ai_card_initialized = False
        self._ai_card_time_limit = 0
```

### Modified `initialize()` method

```python
async def initialize(self) -> None:
    """Fetch quota from server. If rfid_uid is set, use AI card quota."""
    if self.rfid_uid:
        await self._initialize_ai_card_quota()
        self._ai_card_initialized = True
        return

    # Existing MAC-based quota initialization...
```

### New `_initialize_ai_card_quota()` method

```python
async def _initialize_ai_card_quota(self) -> None:
    """Fetch AI card time quota from server."""
    # Normalize UID to uppercase (matches Node.js normalization)
    normalized_uid = self.rfid_uid.strip().upper().replace(':', '').replace('-', '')
    try:
        data = await self._api_get(f"/subscription/quota/ai-card/{normalized_uid}")
        if data:
            self.quota_type = "time"
            self.remaining = data.get("remaining", 0)
            self.is_exhausted = data.get("isExhausted", False)
            self.limit = data.get("limit", 0)
            self.used = data.get("used", 0)
            self.extra_purchased = data.get("extraPurchased", 0)
            self._ai_card_time_limit = self.limit
            self.plan_name = data.get("cardName", "AI Card")

            if not self.is_exhausted:
                self.start_time_tracker()

            logger.info(
                f"[QUOTA] AI card quota initialized for {normalized_uid}: "
                f"remaining={self.remaining}s, limit={self.limit}s"
            )
        else:
            logger.warning(f"[QUOTA] No AI card quota data for {normalized_uid}, fail-open")
            self._fail_open()
    except Exception as e:
        logger.warning(f"[QUOTA] Failed to initialize AI card quota: {e}, fail-open")
        self._fail_open()
```

### New `_fire_and_update_time()` method (AI card variant)

```python
async def _fire_and_update_time(self, delta: int) -> None:
    """POST time consumption to server with retry. Routes to AI card endpoint if applicable."""
    if self.rfid_uid:
        # Normalize UID to uppercase (matches Node.js normalization)
        normalized_uid = self.rfid_uid.strip().upper().replace(':', '').replace('-', '')
        endpoint = f"/subscription/consume/ai-card-time/{normalized_uid}"
    else:
        endpoint = f"/quota/consume/time/{self.mac_address}"

    backoff_delays = [0.5, 1.0]
    for attempt in range(3):
        try:
            data = await self._api_post(
                endpoint,
                body={"seconds": delta, "monthKey": self._month_key}
            )
            if data:
                self.remaining = data.get("remaining", self.remaining)
                self.is_exhausted = data.get("isExhausted", self.is_exhausted)
                self.used = data.get("secondsUsed", self.used)
                self.extra_purchased = data.get("extraPurchased", self.extra_purchased)
                logger.debug(f"[QUOTA] Server sync (time): remaining={self.remaining}s")

                # If exhausted, caller should handle disconnect
                if self.is_exhausted:
                    logger.warning(f"[QUOTA] AI card time exhausted for {normalized_uid if self.rfid_uid else self.mac_address}")
            return
        except Exception as e:
            if attempt < len(backoff_delays):
                logger.debug(f"[QUOTA] Time consume attempt {attempt + 1} failed: {e}, retrying...")
                await asyncio.sleep(backoff_delays[attempt])
            else:
                logger.debug(f"[QUOTA] All time consume retries failed: {e}")
```

### Modified `_time_tracker_loop()` exhaustion handling

```python
async def _time_tracker_loop(self) -> None:
    """Background loop that ticks every TIME_REPORT_INTERVAL seconds."""
    try:
        while self._time_tracker_running:
            await asyncio.sleep(TIME_REPORT_INTERVAL)

            if not self._time_tracker_running:
                break

            elapsed_total = int(time_module.monotonic() - self._session_start_time)
            delta = elapsed_total - self._total_seconds_reported

            if delta <= 0:
                continue

            # Update local state
            self._update_local_time(elapsed_total)
            self._total_seconds_reported = elapsed_total

            # Report to server
            await self._fire_and_update_time(delta)

            # If exhausted, stop the loop
            if self.is_exhausted:
                logger.info(f"[QUOTA] Time exhausted for {self.rfid_uid or self.mac_address}")
                # Signal to worker that session should end
                self._on_quota_exhausted_callback and self._on_quota_exhausted_callback()
                break

    except asyncio.CancelledError:
        pass
```

### How the LiveKit worker passes `rfid_uid`

When the gateway forwards the card tap to LiveKit, it includes the `rfid_uid` in the `user_text` data channel message. The LiveKit worker extracts it and passes it to QuotaManager:

```python
# In cheeko_worker.py (or relevant worker):
async def on_user_text(msg):
    rfid_uid = msg.get("rfid_uid") or msg.get("action_data", {}).get("rfid_uid")

    quota_mgr = QuotaManager(
        mac_address=device_mac,
        manager_api_url=CONFIG.manager_api_url,
        secret=CONFIG.service_secret,
        rfid_uid=rfid_uid  # NEW parameter
    )
    await quota_mgr.initialize()

    if quota_mgr.is_exhausted:
        # Send rejection message, don't start conversation
        await session.generate_reply(instructions=quota_mgr.get_limit_message())
        return
```

---

## RFID Service Integration Point

The quota check is inserted in `lookupCardByUid` in `rfid.service.js`, **after** the card type is determined but **before** returning the response:

```javascript
// In rfid.service.js, lookupCardByUid():

// ... existing lookup logic ...

// After determining card is an AI card (card_type === 'ai'):
if (cardType === 'ai') {
  const quotaInfo = await subscriptionService.getAiCardTimeQuota(mapping.rfid_uid);
  result.quotaExhausted = quotaInfo.isExhausted;
  result.monthlyTimeLimit = quotaInfo.limit;
  result.timeUsed = quotaInfo.secondsUsed;
  result.timeRemaining = quotaInfo.remaining;
  result.extraPurchased = quotaInfo.extraPurchased;
}

return result;
```

**Note on series/bulk-range cards:** AI cards defined in `rfid_series` (UID ranges) do **not** support `monthly_time_limit_secs`. Only individually mapped cards in `rfid_card_mapping` support per-card time quotas. If an AI card is found via series lookup, it gets unlimited access (same as current behavior). To add time quotas to series cards, `monthly_time_limit_secs` would need to be added to `rfid_series` as well — this is out of scope for this spec.

---

## Additional Corner Cases (from review)

| # | Case | Handling |
|---|------|----------|
| 16 | **AI card defined in series (bulk UID range)** | Series cards do not have `monthly_time_limit_secs`. They get unlimited access. Only individually mapped cards in `rfid_card_mapping` support time quotas. |
| 17 | **Fail-open configurable** | Add sys_param `ai_card_quota_fail_mode` with values `open` (unlimited on API failure) or `capped` (allow up to X seconds locally, then hard stop). Default: `open`. |
| 18 | **Device offline — lost seconds** | If `stop_time_tracker()` cannot reach API, consumed seconds are not recorded. Mitigation: QuotaManager persists unreported seconds to local file/SQLite and syncs on next session initialization for the same `rfid_uid`. |
| 19 | **Concurrent taps — shared bucket awareness** | Two sessions on the same card share the same `seconds_used` counter. If parent sets 30 min/month, two kids using simultaneously burn through it 2x faster. This is **expected behavior** — the bucket is per-card, not per-session. Parent-facing UI should clarify this. |

---

## Testing Strategy

| Layer | Tests |
|-------|-------|
| **Database RPCs** | Unit tests for `consume_ai_card_time` and `grant_ai_card_extra_time`: verify UPSERT behavior, remaining calculation, unlimited plan (-1), month boundary handling |
| **Service layer** | Unit tests for `getAiCardTimeQuota`, `consumeAiCardTime`, `rechargeAiCard`: mock Supabase client, test quota exhaustion, recharge during session |
| **API endpoints** | Integration tests: auth checks, request validation, response schemas, error handling |
| **RFID service** | Integration test: card lookup with quota check, exhausted card blocking, series card bypass |
| **QuotaManager (Python)** | Unit tests: `_initialize_ai_card_quota`, `_fire_and_update_time`, `_time_tracker_loop` exhaustion, fail-open behavior |
| **MQTT Gateway** | Integration test: quota exhaustion → `time_quota_exhausted` message sent to device |
| **E2E** | Full flow: tap AI card → session starts → 30s ticks → quota exhausted → disconnect → MQTT recharge audio |
| **Concurrency** | RPC UPSERT with 10 simultaneous consume calls on same card → verify `seconds_used` is correct sum |
| **Network degradation** | QuotaManager retry behavior with simulated API downtime (kill API server mid-session, verify local tracking, restart API, verify sync) |

---

## Observability

| Metric | Source | Alert |
|--------|--------|-------|
| Quota check failures | `rfid.service.js` error logs | > 10 failures in 5 min |
| Time consumption API errors | `subscription.routes.js` error logs | > 5% error rate |
| Fail-open activations | `quota_manager.py` warning logs | Any occurrence |
| Recharge events | `POST /subscription/recharge` success logs | Monitor for fraud patterns |
| Exhausted card taps | Gateway `time_quota_exhausted` MQTT publishes | Track conversion to recharge |

---

## Rollback Plan

1. **Immediate rollback**: Set sys_param `ai_card_quota_fail_mode = open` — all AI cards get unlimited access
2. **Code rollback**: Revert the RFID service quota check injection and QuotaManager changes
3. **Data preservation**: `ai_card_time_quota` table stays — no data loss on rollback
4. **Gradual re-enable**: After fixing issues, re-inject quota check and reset fail_mode to `capped` or `open` based on business needs

---

## Phase-Wise Execution Plan

This feature is built in **5 independent, shippable phases**. Each phase is testable and can be deployed without waiting for the next.

---

### Phase 1: Database + Backend Infrastructure

**Goal:** Database schema, RPCs, service functions, and API endpoints. No UI changes. No enforcement yet.

**Deliverables:**
- [ ] Migration: `20260409_create_ai_card_time_quota.sql`
  - `ALTER TABLE rfid_card_mapping ADD COLUMN monthly_time_limit_secs INTEGER DEFAULT 0`
  - `CREATE TABLE ai_card_time_quota` with UNIQUE(rfid_uid, month_key)
  - RPC `consume_ai_card_time` (atomic UPSERT)
  - RPC `grant_ai_card_extra_time` (atomic UPSERT)
- [ ] Seed existing AI cards with 3000s (50 min) default: `UPDATE rfid_card_mapping SET monthly_time_limit_secs = 3000 WHERE card_type = 'ai'`
- [ ] Prisma schema updates (`rfid_card_mapping` + `ai_card_time_quota` models)
- [ ] Run `npx supabase migration up` to apply migration
- [ ] Run `npx prisma generate` to regenerate Prisma client with new models
- [ ] `subscription.service.js` — new functions:
  - `getAiCardTimeQuota(rfidUid)` — returns { limit, used, remaining, extraPurchased, isExhausted, monthKey }
  - `consumeAiCardTime(rfidUid, seconds)` — calls RPC, returns remaining
  - `rechargeAiCard(rfidUid, amount)` — calls grant RPC, returns remaining
  - `getAiCardStatus(rfidUid)` — card details + quota for parent app
  - `listAiCardsForUser(userId)` — "My Cards": `SELECT DISTINCT rfid_uid FROM rfid_card_tap_log WHERE user_id = ?` joined with quota
  - `listAiCardsSummary(page, limit)` — admin view of all AI cards
- [ ] `subscription.routes.js` — new endpoints:
  - `GET /subscription/quota/ai-card/:rfid_uid` (service key)
  - `POST /subscription/consume/ai-card-time/:rfid_uid` (service key)
  - `POST /subscription/recharge/:rfid_uid` (auth: requireAuth)
  - `GET /subscription/ai-card-status/:rfid_uid` (auth: requireAuth)
  - `GET /subscription/my-cards` (auth: requireAuth) — parent's discovered cards
  - `GET /subscription/ai-cards/summary` (auth: requireAdmin)
- [ ] Unit tests for service functions + API endpoint integration tests

**How to test:**
- Call endpoints directly with curl/Postman
- Verify RPC behavior: consume, recharge, month rollover
- Verify `listAiCardsForUser` returns cards the user has tapped
- Deploy and verify no regressions (no enforcement yet)

**Dependencies:** None

---

### Phase 2: Tap-Time Quota Check + MQTT Exhaustion

**Goal:** When a child taps an AI card, check quota. If exhausted, block the session and send MQTT message to device.

**Deliverables:**
- [ ] `rfid.service.js` — modify `lookupCardByUid()`:
  - After determining `card_type === 'ai'`, call `getAiCardTimeQuota(rfid_uid)`
  - Append `quotaExhausted`, `monthlyTimeLimit`, `timeUsed`, `timeRemaining` to response
  - If `monthly_time_limit_secs === 0` (unconfigured), set `quotaExhausted: true`
- [ ] `mqtt-gateway/gateway/mqtt-gateway.js` — handle AI card quota:
  - If response has `quotaExhausted: true` → send MQTT `time_quota_exhausted` to device
  - If response has `monthly_time_limit_secs === 0` → send MQTT `card_not_configured` to device
  - Device plays appropriate audio prompt
- [ ] Integration tests: tap exhausted card → MQTT message sent
- [ ] Integration tests: tap unconfigured card → "not configured" message

**How to test:**
- Simulate card tap with exhausted quota → verify MQTT message
- Simulate card tap with remaining quota → verify normal flow
- Test with `monthly_time_limit_secs = 0` card

**Dependencies:** Phase 1 (service functions + endpoints)

---

### Phase 3: LiveKit Quota Consumption (Time Tracking)

**Goal:** During an AI card session, track wall-clock time and consume quota every 30 seconds.

**Deliverables:**
- [ ] `quota_manager.py` modifications:
  - Add `rfid_uid` optional parameter to `__init__`
  - Add `_initialize_ai_card_quota()` method (calls new `/subscription/quota/ai-card/:rfid_uid`)
  - Modify `initialize()` to route to AI card quota when `rfid_uid` is set
  - Modify `_fire_and_update_time()` to route to `/subscription/consume/ai-card-time/:rfid_uid` when `rfid_uid` is set
  - Modify `_time_tracker_loop()` exhaustion handling — signal worker to disconnect session
- [ ] `cheeko_worker.py` (or relevant worker):
  - Extract `rfid_uid` from `user_text` message (from gateway)
  - Pass `rfid_uid` to `QuotaManager.__init__`
  - If quota exhausted at init → play rejection message, don't start conversation
  - If quota exhausted mid-session → disconnect voice, trigger MQTT exhaust via API
- [ ] MQTT publish endpoint on Manager API (for worker → device communication):
  - `POST /quota/publish-mqtt-exhaust` (service key auth)
  - Manager API calls MQTT gateway HTTP endpoint to send `time_quota_exhausted` to device
- [ ] Unit tests for QuotaManager AI card mode
- [ ] Integration test: session starts → 30s ticks → quota consumed

**How to test:**
- Mock API calls, verify QuotaManager tracks time correctly
- Test exhaustion mid-session → verify disconnect
- Test recharge during active session → verify session continues
- End-to-end: tap card → talk for 60s → verify 60s consumed in DB

**Dependencies:** Phase 2 (quota check at tap), Phase 1 (endpoints)

---

### Phase 4: Parent App — My Cards View + Recharge UI

**Goal:** Parent sees their child's discovered cards with time balance. Can recharge cards.

**Deliverables:**
- [ ] `manager-web/src/apis/module/subscription.js` — API client functions:
  - `getMyCards()` → GET `/subscription/my-cards`
  - `getAiCardStatus(rfidUid)` → GET `/subscription/ai-card-status/:rfid_uid`
  - `rechargeCard(rfidUid, amount)` → POST `/subscription/recharge/:rfid_uid`
- [ ] `manager-web/src/views/MyCards.vue` — new page:
  - List of cards: card name, icon, time remaining (formatted as "X hrs Y mins")
  - Visual indicator: green (> 50%), amber (10-50%), red (< 10% or exhausted)
  - "Recharge" button per card
  - Empty state: "No cards yet — let your child tap an AI card on their device!"
- [ ] `manager-web/src/components/AiCardRechargeDialog.vue` — recharge modal:
  - Preset amounts: 30 min, 1 hr, 2 hr, custom
  - Shows current balance + new balance after recharge
  - Confirmation dialog
- [ ] Navigation: add "My Cards" to parent app sidebar/menu
- [ ] Integration tests: recharge → balance updates → visible in UI

**How to test:**
- Tap card → verify it appears in parent's "My Cards"
- Exhaust quota → verify red indicator
- Recharge card → verify balance updates
- Test with no cards → verify empty state

**Dependencies:** Phase 1 (API endpoints)

---

### Phase 5: Admin Dashboard + Analytics + Observability

**Goal:** Admins can manage AI card time quotas, view usage analytics, and monitor system health.

**Deliverables:**
- [ ] `manager-web/src/views/QuotaSettings.vue` — extend with AI Card section:
  - Table of all AI cards: card name, rfid_uid, monthly limit, seconds used this month, remaining, status
  - Edit `monthly_time_limit_secs` per card
  - Bulk edit: set same limit for all cards of a type
  - "Grant time" button (admin recharge)
- [ ] Analytics dashboard:
  - Top AI cards by usage (time consumed this month)
  - Cards nearing exhaustion (remaining < 10%)
  - Recharge frequency per card
  - Cards tapped but never recharged (free users)
- [ ] Observability:
  - Logging for quota check failures, exhaustion events, recharges
  - Alert: > 10 quota check failures in 5 min
  - Alert: > 5% error rate on time consumption API
- [ ] Sys_param `ai_card_quota_fail_mode` for fail-open/capped configuration
- [ ] End-to-end test: full flow from tap to exhaustion to recharge

**How to test:**
- Admin changes card limit → next tap uses new limit
- Monitor fail-open mode → verify unlimited access when API down
- Verify analytics show correct top-used cards
- Verify alerts fire on quota check failures

**Dependencies:** Phase 3 (LiveKit consumption), Phase 4 (parent UI)

---

### Phase Dependencies Graph

```
Phase 1 (DB + Backend)
  ├── Phase 2 (Tap Check + MQTT) ── Phase 3 (LiveKit Tracking)
  │                                      │
  │                                      └── Phase 5 (Admin + Analytics)
  └── Phase 4 (Parent UI) ───────────────┘
```

**Recommended order:** 1 → 2 → 3 → 4 → 5

Phase 4 can be built in parallel with Phase 3 since they only share Phase 1 as a dependency.
