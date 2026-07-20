# Active Devices Analytics — Implementation Plan

> **For agentic workers:** implement task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Add an **Active Devices** dashboard page: pick a date → see every device active that day (MAC, kid name, parent name, activity counts) → click a device → see that device's **RFID card taps, generated images, and chat history**.

**Architecture:** Reuse the existing analytics stack wherever possible. The backend already exposes RFID tap logs, chat history, voice sessions, and token usage — only **3 new pieces** are needed: (1) an "active devices by date" aggregate endpoint, (2) an S3 image-listing endpoint, (3) the Vue page + route + nav. Frontend mirrors `TokenAnalytics.vue` (Element UI date picker + tables).

**Tech Stack:** Node/Express + Prisma (`manager-api-node`), Vue + Element UI (`manager-web`), PostgreSQL (DigitalOcean), AWS S3 (`cheeko-content-382188660865-ap-south-1`).

---

## Global Constraints (read before writing any query)

These are **verified facts** from live production data — violating them produces wrong numbers:

1. **Join RFID taps on `mac_address`, NOT `device_id`.**
   `rfid_card_tap_log.device_id` is **NULL on ~67% of rows** (158 of 237 on one device). Joining on `device_id` silently undercounts by two-thirds.
2. **All date filtering must be in IST (`Asia/Kolkata`), not UTC.**
   A UTC-day query returned 0 taps for a day that actually had 34. Always use:
   `(created_at AT TIME ZONE 'Asia/Kolkata')::date = $date`
3. **S3 image key format:** `imagine/<mac-lowercase-with-hyphens>/<uuid>.jpg`
   e.g. MAC `14:C1:9F:D6:45:3C` → prefix `imagine/14-c1-9f-d6-45-3c/`. (Not colons, not bare hex.)
4. **S3 lifecycle expires `imagine/` objects after 1 day** (rule `expire-ai-imagine-images`). Image history is therefore ~24h unless that rule is raised to 7 days (see Task 5, optional).
5. **Chat history is per-agent, not per-device.** Map `ai_device.agent_id` → existing `/agent/:id/chat-history/*` endpoints.
6. Auth: admin dashboard pages use `requireAdmin`; device-scoped analytics use `requireFlexAuth`. Match the surrounding routes.
7. Do **not** return raw parent emails to the UI (PII) — display name only.

---

## What already exists — VERIFIED (read the code, don't trust the path name)

| Need | Endpoint | Verdict |
|---|---|---|
| RFID raw tap logs | `GET /rfid/card/tap-logs` (`rfid.routes.js:323`) | ✅ **Fully reusable.** Accepts `mac`, `dateFrom`, `dateTo`, `page`, `limit`, `cardType`, `recognized`. |
| RFID summary | `GET /rfid/card/tap-analytics/summary` (`rfid.routes.js:356`) | ⚠️ **NOT usable for our breakdown.** Groups by `rfid_uid` + `mac_address` only — **never by `content_pack_name`**. It cannot produce "Slokas 11, Adventure 4". Use our own `deviceRfidBreakdown` (Task 1). |
| Chat history | `GET /agent/:id/chat-history/user` (`agent.routes.js:1908`) | ⚠️ **No date filter, no pagination.** Handler passes only `req.params.id` to `getRecentUserChatHistory(agentId)`. Gives *recent* chat, cannot scope to a chosen date. See Task 6. |
| Chat history (one session) | `GET /agent/:id/chat-history/:sessionId` (`agent.routes.js:2016`) | ✅ Reusable for drill-down once you have a sessionId. |
| Voice sessions | `GET /analytics/sessions/:mac` (`analytics.routes.js:1076`) | ✅ Reusable (verify its date params before relying on them). |
| Token usage per device | `GET /usage/analytics/per-device` (`usage.routes.js:244`) | ✅ Reusable. |
| Image **upload** | `POST /imagine/upload` (`imagine.routes.js:32`) | ✅ Exists — but there is **no list endpoint** (Task 2). |

### ⚠️ Timezone landmine in the existing RFID endpoints

`buildSummaryDateRange()` in `rfid.service.js` builds its range with `new Date()` +
`setHours(0,0,0,0)` — i.e. **server-local time, not explicit IST**. If the API
server runs in UTC (typical for Docker/Linux), date-scoped calls to
`tap-logs` / `tap-analytics/summary` will reproduce exactly the bug from
Constraint 2 (a day with 34 taps reporting 0).

**Therefore:** for anything date-scoped, use the **explicit-IST raw SQL in Task 1**.
Only use `tap-logs` for un-scoped or already-verified ranges. Before trusting it,
run: `date` on the API host, or `SELECT current_setting('TIMEZONE')`.

**Missing → build:** active-devices-by-date aggregate, per-pack RFID breakdown,
image listing, date-scoped chat history, and the UI.

---

## File Structure

| File | Responsibility | Change |
|---|---|---|
| `manager-api-node/src/services/activeDevices.service.js` | Active-device aggregate queries | **Create** |
| `manager-api-node/src/routes/analytics.routes.js` | Mount 2 new endpoints | Modify |
| `manager-api-node/src/services/imagine.service.js` | S3 list + presign | **Create** |
| `manager-api-node/src/routes/imagine.routes.js` | Mount image-list endpoint | Modify |
| `manager-web/src/apis/module/activeDevices.js` | API client | **Create** |
| `manager-web/src/views/ActiveDevices.vue` | The page | **Create** |
| `manager-web/src/router/index.js` | Route entry | Modify |
| `manager-web/src/views/home.vue` (nav header) | Nav link | Modify |

---

## Task 1: Backend — active devices by date

**Files:** Create `src/services/activeDevices.service.js`; modify `src/routes/analytics.routes.js`.

**Produces:** `listActiveDevices(dateISO)` → array of
`{ mac_address, kid_name, parent_name, agent_id, tap_count, session_count, first_activity, last_activity }`

- [ ] **Step 1: Write the service**

> **VERIFIED SCHEMA (do not guess):**
> - Prisma import is **`const { prisma } = require('../config/database');`**
> - `voice_sessions` columns: `id, session_id, mac_address, device_id, agent_id, kid_id, room_name, worker_id, status, started_at, ended_at, last_event_at, metadata`
>   → **there is NO `created_at`; use `started_at`.** It also has `mac_address` directly, so **no `ai_device` join is needed**.
> - `ai_agent_chat_history` columns: `id, mac_address, agent_id, session_id, chat_type, content, audio_id, created_at`
>   → has **`mac_address` AND `created_at`**, so chat history is queryable by MAC + date directly (no agent join).

```js
// src/services/activeDevices.service.js
const { prisma } = require('../config/database');

const IST = 'Asia/Kolkata';

/**
 * Devices with any activity (RFID tap OR voice session) on the given IST date.
 * NOTE: taps join on mac_address — device_id is NULL on ~67% of tap rows.
 */
const listActiveDevices = async (dateISO) => {
  return prisma.$queryRaw`
    WITH taps AS (
      SELECT t.mac_address,
             count(*)::int              AS tap_count,
             min(t.created_at)          AS first_tap,
             max(t.created_at)          AS last_tap
      FROM rfid_card_tap_log t
      WHERE (t.created_at AT TIME ZONE ${IST})::date = ${dateISO}::date
      GROUP BY t.mac_address
    ),
    sess AS (
      -- voice_sessions has mac_address directly and uses started_at (NOT created_at)
      SELECT v.mac_address,
             count(*)::int              AS session_count,
             min(v.started_at)          AS first_sess,
             max(v.started_at)          AS last_sess
      FROM voice_sessions v
      WHERE (v.started_at AT TIME ZONE ${IST})::date = ${dateISO}::date
      GROUP BY v.mac_address
    ),
    macs AS (
      SELECT mac_address FROM taps
      UNION
      SELECT mac_address FROM sess
    )
    SELECT m.mac_address,
           d.id            AS device_id,
           d.agent_id,
           k.name          AS kid_name,
           p.display_name  AS parent_name,
           COALESCE(t.tap_count, 0)     AS tap_count,
           COALESCE(s.session_count, 0) AS session_count,
           LEAST(t.first_tap, s.first_sess) AS first_activity,
           GREATEST(t.last_tap, s.last_sess) AS last_activity
    FROM macs m
    LEFT JOIN taps t ON t.mac_address = m.mac_address
    LEFT JOIN sess s ON s.mac_address = m.mac_address
    LEFT JOIN ai_device d ON d.mac_address = m.mac_address
    LEFT JOIN kid_profile k ON k.id = d.kid_id
    LEFT JOIN parent_profile p ON p.user_id = k.user_id
    ORDER BY (COALESCE(t.tap_count,0) + COALESCE(s.session_count,0)) DESC;
  `;
};

/** Per-device RFID breakdown for one IST date. */
const deviceRfidBreakdown = async (mac, dateISO) => {
  return prisma.$queryRaw`
    SELECT COALESCE(NULLIF(content_pack_name,''), card_type) AS pack,
           count(*)::int AS taps,
           count(DISTINCT rfid_uid)::int AS cards,
           max(created_at) AS last_tap
    FROM rfid_card_tap_log
    WHERE mac_address ILIKE ${mac}
      AND (created_at AT TIME ZONE ${IST})::date = ${dateISO}::date
    GROUP BY 1 ORDER BY taps DESC;
  `;
};

module.exports = { listActiveDevices, deviceRfidBreakdown };
```

- [ ] **Step 2: Mount the routes** in `src/routes/analytics.routes.js` (near the other `requireFlexAuth` GETs):

```js
const activeDevicesService = require('../services/activeDevices.service');

router.get('/active-devices', requireFlexAuth, asyncHandler(async (req, res) => {
  const date = (req.query.date || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return badRequest(res, 'date=YYYY-MM-DD required');
  success(res, await activeDevicesService.listActiveDevices(date));
}));

router.get('/active-devices/:mac/rfid', requireFlexAuth, asyncHandler(async (req, res) => {
  const date = (req.query.date || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return badRequest(res, 'date=YYYY-MM-DD required');
  success(res, await activeDevicesService.deviceRfidBreakdown(req.params.mac, date));
}));
```

- [ ] **Step 3: Verify against known-good data.**

> ### ⚠️ TWO DATABASES — verify against the right one
> - **LOCAL DEV = Supabase** (`aws-1-ap-south-1.pooler.supabase.com`) — this is
>   what `manager-api-node/.env` `DATABASE_URL` points to, and what the local
>   API on `:8002` and the dashboard use. **Verify here.**
> - **PRODUCTION = DigitalOcean** (`db-postgresql-blr1-...ondigitalocean.com`) —
>   used by the remote manager (`139.59.7.72`) that the EKS voice agents call.
>
> The two have completely different data. Production values (e.g. kid "Abhilash",
> 34 taps on 2026-07-19) **do not exist in local dev** — do not treat their
> absence as a bug.

**Local-dev expectations (VERIFIED against Supabase):**

```bash
curl -s "$BASE/analytics/active-devices?date=2026-07-06" | jq '.data[]'
# EXPECT: 00:16:3E:AC:B5:38 — kid "Rahul", parent "SUB-2 smoke test parent",
#         tap_count 10, session_count 4

curl -s "$BASE/analytics/active-devices?date=2026-07-15" | jq '.data[]'
# EXPECT 2 rows:
#   00:16:3E:AC:B5:38 — "Rahul" — tap_count 0, session_count 16
#     ^ critical: proves the sessions-only branch works (a taps-only query misses it)
#   AA:BB:CC:DD:EE:FF — kid/parent NULL — tap_count 1, session_count 0
#     ^ critical: orphaned activity (no ai_device row) must still appear
```

**Failure signals:**
- `2026-07-15` returns only 1 row → your UNION is dropping the sessions-only device.
- `2026-07-15` returns 0 rows → date filter is running in **UTC**, not IST (Constraint 2).
- `AA:BB:CC:DD:EE:FF` missing → you used an INNER JOIN to `ai_device` instead of LEFT.

**Auth note:** these routes use `requireFlexAuth`, which rejects the service key
(`X-Service-Key`) with 401. Test with an admin JWT from the dashboard login, or
call the service functions directly via a node script. A 401 means the route is
mounted and auth is working — it is not a routing failure.

---

## Task 2: Backend — list generated images from S3

**Files:** Create `src/services/imagine.service.js`; modify `src/routes/imagine.routes.js`.

**Produces:** `listDeviceImages(mac, dateISO?)` → `[{ key, url, size, createdAt }]`

- [ ] **Step 1: Service** (reuse whatever AWS SDK version `imagine.routes.js` already imports for upload — do not add a new one):

```js
// src/services/imagine.service.js
const { S3Client, ListObjectsV2Command, GetObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');

const BUCKET = process.env.S3_BUCKET || 'cheeko-content-382188660865-ap-south-1';
const REGION = process.env.AWS_REGION || 'ap-south-1';
const s3 = new S3Client({ region: REGION });

/** MAC -> S3 prefix. 14:C1:9F:D6:45:3C -> imagine/14-c1-9f-d6-45-3c/ */
const macToPrefix = (mac) =>
  `imagine/${String(mac).trim().toLowerCase().replace(/:/g, '-')}/`;

const listDeviceImages = async (mac, dateISO) => {
  const out = await s3.send(new ListObjectsV2Command({
    Bucket: BUCKET, Prefix: macToPrefix(mac), MaxKeys: 1000,
  }));
  let items = (out.Contents || []).map((o) => ({
    key: o.Key, size: o.Size, createdAt: o.LastModified,
  }));
  if (dateISO) {
    // filter by IST calendar date
    items = items.filter((i) =>
      new Date(i.createdAt).toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' }) === dateISO);
  }
  items.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  return Promise.all(items.map(async (i) => ({
    ...i,
    url: await getSignedUrl(s3, new GetObjectCommand({ Bucket: BUCKET, Key: i.key }), { expiresIn: 3600 }),
  })));
};

module.exports = { listDeviceImages, macToPrefix };
```

- [ ] **Step 2: Route** in `src/routes/imagine.routes.js`:

```js
const imagineService = require('../services/imagine.service');

router.get('/device/:mac/images', requireFlexAuth, asyncHandler(async (req, res) => {
  success(res, await imagineService.listDeviceImages(req.params.mac, (req.query.date || '').trim() || null));
}));
```

- [ ] **Step 3: Verify.**
```bash
curl -s "$BASE/imagine/device/14:C1:9F:D6:45:3C/images" | jq '.data | length'
# EXPECT: >0 only if images are within the S3 lifecycle window (currently 1 day).
```
⚠️ If this returns 0, check the lifecycle rule before assuming a bug (Constraint 4 / Task 5).

---

## Task 3: Frontend — API client

**Files:** Create `manager-web/src/apis/module/activeDevices.js`.

- [ ] **Step 1:** Mirror the callback style used in `src/apis/module/analytics.js`:

```js
import { getServiceUrl } from '../api';
import RequestService from '../httpRequest';

export default {
  getActiveDevices(date, callback, errorCallback) {
    RequestService.sendRequest()
      .url(`${getServiceUrl()}/analytics/active-devices?date=${encodeURIComponent(date)}`)
      .method('GET')
      .success((res) => callback(res))
      .networkFail((err) => { (errorCallback || console.error)(err); })
      .send();
  },
  getDeviceRfid(mac, date, callback, errorCallback) {
    RequestService.sendRequest()
      .url(`${getServiceUrl()}/analytics/active-devices/${encodeURIComponent(mac)}/rfid?date=${encodeURIComponent(date)}`)
      .method('GET')
      .success((res) => callback(res))
      .networkFail((err) => { (errorCallback || console.error)(err); })
      .send();
  },
  getDeviceImages(mac, date, callback, errorCallback) {
    RequestService.sendRequest()
      .url(`${getServiceUrl()}/imagine/device/${encodeURIComponent(mac)}/images?date=${encodeURIComponent(date)}`)
      .method('GET')
      .success((res) => callback(res))
      .networkFail((err) => { (errorCallback || console.error)(err); })
      .send();
  },
};
```
> Open `analytics.js` first and copy its **exact** import paths and builder chain — this file must match the house pattern, not the sketch above.

---

## Task 4: Frontend — `ActiveDevices.vue` page + route + nav

**Files:** Create `src/views/ActiveDevices.vue`; modify `src/router/index.js`, nav header.

- [ ] **Step 1: Page skeleton** — copy `TokenAnalytics.vue` as the base (it already has the header, date picker, and `el-table` styling) and replace its body with:
  - a **single** `el-date-picker` (`type="date"`, `value-format="yyyy-MM-dd"`, default = today)
  - `el-table` of active devices: columns **MAC**, **Kid Name**, **Parent Name**, **Taps**, **Sessions**, **Last Activity**, and a **View** action
  - a detail `el-drawer` (or dialog) opened by **View**, with 3 `el-tabs`:
    - **RFID** → `getDeviceRfid(mac, date)` → table: pack / taps / cards / last tap
    - **Images** → `getDeviceImages(mac, date)` → grid of `<el-image :src="row.url" lazy>` + timestamp
    - **Chat History** → existing agent endpoint using the row's `agent_id`
      (`GET /agent/{agent_id}/chat-history/user`); show "No agent linked" when `agent_id` is null.

- [ ] **Step 2: Route** in `src/router/index.js` (mirror the `/token-analytics` entry at line ~125):

```js
{
  path: '/active-devices',
  name: 'ActiveDevices',
  component: () => import('../views/ActiveDevices.vue'),
  meta: { requiresAuth: true },
},
```

- [ ] **Step 3: Nav** — add an "Active Devices" item to the header nav beside **Token Analytics** (same component that renders the Agent/User/Device/Token/Game/RFID buttons).

- [ ] **Step 4: Manual verify** — load `/active-devices`, set date **2026-07-19** → expect exactly **one row**: `14:C1:9F:D6:45:44` / Abhilash / Abilash / 34 taps. Set **2026-07-17** → `14:C1:9F:D6:45:3C` / Cheeku / Naveen TL / 23 taps. Click **View** → RFID tab shows Slokas 11, Adventure Stories 4, Fairy Tales 3, Fantasy Stories 3, English Rhymes 2.

---

## Task 6: Date-scoped chat history (the existing endpoint can't do it)

`GET /agent/:id/chat-history/user` takes **only an agent id** — no date, no paging.
For "chat history on the selected date" you need one of these. **Pick A** unless
`ai_agent_chat_history` turns out not to have a usable timestamp.

- [ ] **Step 1: Confirm the table shape first**

```sql
SELECT column_name, data_type FROM information_schema.columns
WHERE table_name='ai_agent_chat_history' ORDER BY ordinal_position;
```

- [ ] **Step 2 (Option A — preferred): add a date-scoped endpoint**

Add to `analytics.routes.js`, and a matching service function using the same
explicit-IST pattern as Task 1:

```js
router.get('/active-devices/:mac/chat', requireFlexAuth, asyncHandler(async (req, res) => {
  const date = (req.query.date || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return badRequest(res, 'date=YYYY-MM-DD required');
  success(res, await activeDevicesService.deviceChatHistory(req.params.mac, date));
}));
```

```js
// activeDevices.service.js
// VERIFIED: ai_agent_chat_history has mac_address + created_at directly,
// so NO join to ai_device/agent is required.
const deviceChatHistory = async (mac, dateISO) => prisma.$queryRaw`
  SELECT id, session_id, chat_type, content, audio_id, created_at
  FROM ai_agent_chat_history
  WHERE mac_address ILIKE ${mac}
    AND (created_at AT TIME ZONE ${IST})::date = ${dateISO}::date
  ORDER BY created_at ASC
  LIMIT 500;
`;
```
**`chat_type` — VERIFIED against production rows (do not re-derive):**
- `1` = **user** (1561 rows; sample content is a spoken child utterance)
- `2` = **assistant** (1485 rows; sample content is a Cheeko reply)

Map these to labels in the API response so the UI doesn't hardcode magic numbers.

> ⚠️ **`ai_agent_chat_history` has 0 rows in LOCAL DEV (Supabase).** The chat tab
> will legitimately render empty locally. Verify chat rendering against
> production data or seed a few dev rows — do **not** chase it as a bug.

- [ ] **Step 3 (Option B — fallback):** if adding an endpoint is not acceptable,
the Chat tab must be labelled **"Recent chat (not date-filtered)"** and call the
existing `/agent/:id/chat-history/user`. Do **not** present unfiltered recent chat
as if it were the selected day's conversation.

- [ ] **Step 4: Verify** — pick a device/date with known activity (e.g.
`14:C1:9F:D6:45:44` on `2026-07-19`) and confirm returned messages fall inside
that IST day.

---

## Task 5 (optional): Extend image retention 1 day → 7 days

Needed only if you want image history to survive for back-dated lookups.

```bash
aws s3api put-bucket-lifecycle-configuration \
  --bucket cheeko-content-382188660865-ap-south-1 \
  --lifecycle-configuration '{"Rules":[{"ID":"expire-ai-imagine-images","Status":"Enabled",
    "Filter":{"Prefix":"imagine/"},"Expiration":{"Days":7},
    "AbortIncompleteMultipartUpload":{"DaysAfterInitiation":1}}]}'
aws s3api get-bucket-lifecycle-configuration --bucket cheeko-content-382188660865-ap-south-1
```
Cost impact is negligible (166 objects ≈ 2.4 MB today).

---

## Known data-quality issues (surface in UI, don't silently hide)

| Issue | Effect | Suggested handling |
|---|---|---|
| `device_id` NULL on ~67% of tap rows | Undercount if joined wrongly | Constraint 1 (join on MAC) |
| `session_id` empty on tap rows | Taps can't tie to a voice session | Don't promise per-session tap linkage |
| Unresolved taps logged as bare `content` / `unknown` (68% on one device) | Pack name blank | Show as **"Unresolved"** rather than blank |
| Rapid repeat taps of same card (3× in 90s) | Tap count ≠ engagement | Consider a "unique cards" column beside raw taps |
| Some devices have taps under 2 different `kid_id`s | Per-kid attribution drifts | Attribute by device, note the caveat |

---

## Assumptions I made (change if wrong)

1. **"Active" = ≥1 RFID tap OR ≥1 voice session that day.** Image generation alone is not counted (S3 isn't reliably queryable by date once the 1-day lifecycle purges it).
2. **All dates are IST.** The dashboard is India-facing (`country_region = IN`).
3. **Admin-facing page** — shows real parent/kid names; email deliberately excluded.
