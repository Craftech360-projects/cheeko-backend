# Timezone Architecture Investigation — The 05:30 Boundary

> Where every part of the Cheeko stack decides which calendar day a timestamp
> belongs to, and why Quizzy Bee cuts that day in a different place from Chat,
> Games, Progress and Analytics.

| | |
|---|---|
| **Repository** | `cheeko-backend` |
| **Branch investigated** | `fix/timezone-mismatch` |
| **HEAD** | `bac20344` |
| **Deploy branch** | `origin/main` @ `e9775e1c` |
| **Dated** | 2026-08-21 |
| **Scope** | Investigation only. No files were modified, no fixes applied. |

---

## Answer in one paragraph

**Quizzy Bee is the only daily feature in the system whose day boundary is
inherited from the operating system the Node process happens to be running on.**
Every other daily feature was migrated to an explicitly-named IANA zone — the
parent's, defaulting to `Asia/Kolkata`. Quizzy Bee's day gate is three
`new Date(); setHours(0,0,0,0)` calls and one `getFullYear/getMonth/getDate` day
key inside `quiz.service.js`. It never reads `parent_profile.timezone`, its API
accepts no timezone parameter, and the recent timezone commit did not touch the
file. On a UTC host that means the Daily Ten resets at 05:30 IST, not at
midnight.

Two things must be checked at runtime before this is closed: the **actual TZ of
the Node process in production**, and **which branch production is running** —
because the timezone fix is not on the branch the deploy script pulls from.

---

## Contents

1. [Executive summary](#1-executive-summary)
2. [Timezone sources](#2-timezone-sources)
3. [Server runtime timezone](#3-server-runtime-timezone)
4. [Device timezone](#4-device-timezone)
5. [Parent / user timezone](#5-parent--user-timezone)
6. [Central timezone utilities](#6-central-timezone-utilities)
7. [Chat](#7-chat)
8. [Games](#8-games)
9. [Quizzy Bee](#9-quizzy-bee)
10. [Analytics](#10-analytics)
11. [Progress / daily counters](#11-progress--daily-counters)
12. [Database](#12-database)
13. [`new Date()` inventory](#13-new-date-inventory)
14. ["Today" / start-of-day inventory](#14-today--start-of-day-inventory)
15. [Component comparison](#15-component-comparison)
16. [Timezone inconsistencies](#16-timezone-inconsistencies)
17. [The recent timezone change](#17-the-recent-timezone-change)
18. [Production vs local](#18-production-vs-local)
19. [Midnight IST simulation](#19-midnight-ist-simulation)
20. [Root cause / findings](#20-root-cause--findings)
21. [Confidence matrix](#21-confidence-matrix)
22. [Final conclusion](#22-final-conclusion)

---

## 1. Executive summary

There is no single timezone in this system. There are **five independent
mechanisms** for deciding which calendar day an instant belongs to, and they do
not agree:

| Mechanism | What it resolves to | Used by |
|---|---|---|
| **A — explicit parent zone** | `parent_profile.timezone` → `DEFAULT_PARENT_TIMEZONE` → hardcoded `Asia/Kolkata` | Progress, Analytics, Chat-by-date, the rollup writer, parent-app quiz analytics |
| **B — hardcoded IST** | `Asia/Kolkata`, fixed | Founder dashboard, active-devices SQL, usage-summary cron, LiveKit agent prompts |
| **C — server-local** | Whatever TZ the process has | **Quizzy Bee**, **Riddler**, RFID admin analytics, several admin stats, the daily email report |
| **D — explicit UTC** | UTC day via `toISOString().slice(0,10)` | Streak rows, per-MAC analytics time series, several admin groupings, date-only column reads |
| **E — none** | Instants only | MQTT gateway, chat transcripts, OTA payloads. Correct by construction. |

The recent commit `bac20344 "fix: timezone converted to IST standards"`
introduced Mechanism A and migrated the parent-facing analytics/progress family
onto it. It did not touch anything on Mechanism C. Quizzy Bee is on Mechanism C.
That is the whole discrepancy.

Two further complications sit underneath the code:

- The **process timezone is never set anywhere in the repository** — no `ENV TZ`,
  no `process.env.TZ`, no PM2 `env` block, no compose variable. Mechanism C
  therefore resolves to whatever the deployment host's OS says, which the
  repository cannot prove.
- The timezone commit is **not on the branch the deploy script pulls**.
  `deploy/deploy.sh` runs `git reset --hard origin/main`; `origin/main` does not
  contain `src/utils/timezone.js` at all.

---

## 2. Timezone sources

Every place in the repository from which a timezone could be obtained, and
whether anything actually obtains it from there.

| Source | Exists? | Read by | Evidence |
|---|---|---|---|
| **Parent profile** `parent_profile.timezone` | Yes — nullable `VarChar(50)` | `mobile.service`, `deviceAnalytics.service`, founder dashboard (display only) | `schema.prisma:710` |
| **Kid profile** `kid_profile.timezone` | Column exists, writable, **unvalidated** | **Nothing.** Only echoed by the founder dashboard. | `schema.prisma:647`, `founderDashboard.service.js:939` |
| **Environment** `DEFAULT_PARENT_TIMEZONE` | Documented in `.env.example` only | `timezone.js` at module load | `.env.example` (added by `bac20344`), `timezone.js:42` |
| **Process / OS** `TZ` | **Never set anywhere in the repo** | Every `setHours`/`getDate` call — Quizzy Bee included | no match for `ENV TZ`, `TZ=`, `process.env.TZ` |
| **Hardcoded default** `'Asia/Kolkata'` | Yes | `timezone.js`, `founderDashboard`, `activeDevices`, `usageSummaryNotification`, `dailyEmailReport`, LiveKit agent | `timezone.js:44`, `founderDashboard.service.js:7` |
| **Device / firmware** | Receives, never sends | Device is *told* the server's zone in the OTA response; it never reports one back | `device.service.js:878–886` |
| **Flutter parent app** | Not in this repo | Could `PATCH /api/mobile/parent-profile` with `timezone`; no evidence any build does | `mobile.service.js:1660–1666` |
| **Database** | Instants only | All event columns are `timestamptz`; day columns are `@db.Date` written by the app | `schema.prisma` throughout |
| **Docker / Kubernetes / Helm** | Irrelevant in prod | No Kubernetes or Helm exists. Docker exists for the API but production uses PM2 on a bare host. | `deploy/deploy.sh` |

> **Schema discrepancy worth noting — UNKNOWN.**
> `schema.prisma` declares `timezone String? @db.VarChar(50)` and `timezone.js`
> caps input at 50 characters on that basis. The only migration that creates the
> column — `20260124000000_init/migration.sql:91` — declares `VARCHAR(100)`, and
> no later migration alters it. That init migration's `parent_profile` also
> differs structurally from the current model (`full_name` vs `display_name`,
> `preferred_language` vs `language`), so the live column width cannot be
> established from the repository.

---

## 3. Server runtime timezone

### What the repository proves

| Layer | Timezone | Proof |
|---|---|---|
| Application-configured | **None.** The app never sets its own TZ. | Repo-wide search for a `process.env.TZ` assignment returns nothing. |
| Container image (`manager-api-node/Dockerfile`) | **UTC.** `node:20-alpine`, no `tzdata` install, no `ENV TZ`, no `/etc/localtime`. | Full file read; only `ENV NODE_ENV=production` is set. |
| Docker Compose | **UTC.** Environment block lists 9 variables; `TZ` is not among them. | `main/manager-api-node/docker-compose.yml` |
| **Production process** | **UNKNOWN FROM REPOSITORY** | See below — production does not use the Dockerfile. |
| Host / server OS | **UNKNOWN** | Not represented in the repository. |
| Database (Supabase Postgres) | **Irrelevant to correctness.** Every timestamp column is `timestamptz`, an absolute instant. | `schema.prisma`. Explicit `AT TIME ZONE 'Asia/Kolkata'` is used where SQL needs a calendar day. |
| Local dev machine (this checkout) | **Asia/Calcutta (UTC+05:30)** | `Intl.DateTimeFormat().resolvedOptions().timeZone` → `Asia/Calcutta`; `getTimezoneOffset()` → `-330`. |

### The Dockerfile is not what runs in production

This is the single most misleading thing in the codebase. `timezone.js`'s own
header comment says:

```js
// The container sets no TZ (Dockerfile) so it runs UTC, and reading an
// instant with local getters would start an Indian parent's day at 05:30
// instead of midnight.
```
<sub>`main/manager-api-node/src/utils/timezone.js:8–11`</sub>

The *conclusion* (UTC) may well be right, but the *reason* given is not
load-bearing, because `manager-api-node` is not deployed as a container:

```bash
ROOT=/opt/cheeko-backend/main
cd /opt/cheeko-backend
git fetch origin main
git reset --hard origin/main          # <-- deploy branch
cd "$ROOT/manager-api-node"
npm ci --omit=dev
npx prisma generate
npx prisma migrate deploy
pm2 startOrReload /opt/ecosystem.config.js --only manager-api --update-env
```
<sub>`deploy/deploy.sh` — invoked over SSH by `.github/workflows/deploy.yml` on push to `main`</sub>

So the Node process is a bare PM2-managed process on a Linux host, inheriting the
**host OS timezone**. `/opt/ecosystem.config.js` is outside the repository and
could set `env: { TZ: ... }` — the in-repo `ecosystem.config.js` does not, and in
any case points at a stale path (`/root/xiaozhi-esp32-server/...`) that
`deploy.sh` does not use.

CircleCI's production workflow builds Docker images for `main/manager-api` (the
**Java** API), `manager-web`, `mqtt-gateway` and `livekit-server` —
`manager-api-node` appears nowhere in `.circleci/config.yml`. Neither pipeline
sets `TZ`.

### Production runtime timezone = UNKNOWN FROM REPOSITORY

To settle it, three commands on the API host are needed:

```bash
timedatectl                      # host OS zone
pm2 env $(pm2 id manager-api)    # whether ecosystem.config.js injects TZ
node -e "console.log(process.env.TZ, Intl.DateTimeFormat().resolvedOptions().timeZone, new Date().getTimezoneOffset())"
```

The *reported symptom* is itself strong indirect evidence: if the process ran
`Asia/Kolkata`, Quizzy Bee's server-local day gate would already cut at IST
midnight and there would be no discrepancy to investigate.
**HIGH CONFIDENCE: UTC (offset 0).**

**Counter-evidence to weigh.** Two firmware documents show the OTA `server_time`
block as `{"timeZone": "Asia/Kolkata", "timezone_offset": 330}`
(`docs-site/docs/firmware/integration-guide.md:215–218`,
`docs/firmware_from_scratch_implementation_guide.md:294–297`). Those values are
computed live from the Node process (§4), so if the examples were captured from a
real server, that server was running IST. They may equally be hand-written
examples. Not conclusive either way.

---

## 4. Device timezone

### The Flutter app is not in this repository

Searches for `pubspec.yaml` and `*.dart` return nothing. The parent app is
documented at `docs-site/docs/mobile/parent-app.md` (Flutter SDK ^3.7.2, app
version 3.8.5+3) but lives in a separate repository. Therefore:

| Question | Answer |
|---|---|
| Does Flutter use device timezone? | **UNKNOWN** — cannot be determined from this repository. |
| Where is it obtained / what value? | **UNKNOWN** — no Dart source. |
| Is it sent to the backend? | **Almost certainly not.** The API accepts one, but every timezone-reading code path is written on the premise that the column is NULL. |
| Which API would send it? | `PATCH /toy/api/mobile/parent-profile` (or `profile.service` equivalents). |
| Which DB field receives it? | `parent_profile.timezone`. |
| Can the backend later use it? | Yes — `resolveProgressScope` and `resolveProjectionContext` read it on every request. |
| Does Flutter ever force UTC or IST? | **UNKNOWN.** |

### What the backend says about the app's behaviour

Two in-repo documents assert the column is empty in practice:

```js
// parent_profile.timezone is nullable and no client writes it yet, so a
// NULL falls back to DEFAULT_TIMEZONE rather than to UTC.
```
<sub>`src/utils/timezone.js:13–15`</sub>

```js
* The reported bug: a parent's "today" ran 05:30 → 05:30 IST, because
* parent_profile.timezone is NULL on every account and the fallback was UTC.
```
<sub>`tests/unit/mobile.timezone-day-boundary.test.js:5–7`</sub>

The API surface that *would* accept it: `collectParentProfileUpdates`
(`mobile.service.js:1660–1666`) and `applyParentProfileFields`
(`profile.service.js:363–369`) both accept a `timezone` / camelCase field,
validate it with `isValidTimezone`, and 400 on an abbreviation or offset. Blank
and null are ignored rather than clearing a working zone.

### The ESP32 device receives a timezone; it never reports one

```js
const now = new Date();
const timezoneOffset = -now.getTimezoneOffset(); // minutes, positive east of UTC
const response = {
  server_time: {
    timestamp: Date.now(),
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
    timezone_offset: timezoneOffset
  }
};
```
<sub>`main/manager-api-node/src/services/device.service.js:879–886`</sub>

Both values are read straight off the Node process. The firmware is documented to
persist `server_time` to NVS and sync its clock from it. Only `timestamp` matters
for correctness — it is epoch milliseconds, so timezone-independent — but the
device is being handed the *server's* zone as if it were the child's.

Firmware analytics events carry a `timestamp` field parsed by
`parseFirmwareTimestampOrNull` (`deviceAnalytics.service.js:32–39`, accepting
seconds or milliseconds) and stored in `device_analytics_event.event_timestamp`.
That is an instant, not a local time. `config.service.getDeviceLocation` returns
`timezone: null` unconditionally — a stub.

---

## 5. Parent / user timezone

### Who owns it

The **parent** owns the timezone that matters. `parent_profile.timezone` is the
only zone column any day-bucketing code reads. `kid_profile.timezone` exists, is
writable through `profile.service.createKid`/`updateKid` (lines 87 and 123) with
**no validation at all**, and is read by nothing except the founder dashboard's
display payload. The mobile `createKid`/`updateKid` path does not expose it. The
device owns no timezone; there is no `ai_device.timezone` column.

### Lifecycle, as the repository actually implements it

```
Device ─────────────────► never contributes a timezone
Flutter ────────────────► UNKNOWN — may PATCH /api/mobile/parent-profile
API ────────────────────► collectParentProfileUpdates (mobile.service.js:1660)
                          applyParentProfileFields   (profile.service.js:363)
                          → isValidTimezone() → 400 on "IST" or "+05:30"
Database ───────────────► parent_profile.timezone  (nullable, no default)
Backend read ───────────► resolveProgressScope           (mobile.service.js:2484)
                          resolveAdminProgressScopeByMac (mobile.service.js:2528–2534)
                          resolveProjectionContext       (deviceAnalytics.service.js:317–330)
Feature use ────────────► formatDateInTimezone / startOfDayInstant / buildProgressDateRange
                          ^ Quizzy Bee's day gate is NOT on this path
```

### Classification of the stored value

**User-selected, in principle; defaulted, in practice.** The write path exists and
validates; there is no server-side derivation, no IP geolocation, no
device-derived population, and no migration that backfills it. Every read is
written to expect NULL.

---

## 6. Central timezone utilities

There is exactly one central utility:
`main/manager-api-node/src/utils/timezone.js`, 153 lines, created by commit
`bac20344`.

| Function | Lines | In → Out | Zone source | Fallback |
|---|---|---|---|---|
| `isValidTimezone` | 32–40 | string → boolean | n/a — probes `new Intl.DateTimeFormat(…, {timeZone})` | `false` for non-string, blank, >50 chars, or RangeError |
| `DEFAULT_TIMEZONE` | 42–44 | const | `process.env.DEFAULT_PARENT_TIMEZONE`, read once at module load | hardcoded `'Asia/Kolkata'` |
| `resolveTimezone` | 47–49 | string \| null → string | caller's value if valid | `DEFAULT_TIMEZONE` |
| `formatDateInTimezone` | 57–75 | instant + zone → `YYYY-MM-DD` | explicit IANA zone via `Intl.formatToParts` | `null` for null/NaN; default zone for a bad zone. Never throws. |
| `dateOnlyKey` | 84–91 | `@db.Date` value → `YYYY-MM-DD` | **UTC by design** — Prisma hands date-only columns back as midnight UTC | `null` for junk |
| `shiftDateKey` | 93–99 | dateKey + Δdays → dateKey | UTC arithmetic on a naked date key — correct, no zone involved | `null` on invalid |
| `zoneOffsetMs` | 102–116 | instant + zone → ms | explicit IANA zone, `hourCycle:'h23'` | default zone via `resolveTimezone` |
| `startOfDayInstant` | 130–135 | dateKey + zone → Date | explicit IANA zone; offset sampled twice for DST | `null` on invalid key |
| `endOfDayInstantExclusive` | 138–141 | dateKey + zone → Date | as above, half-open | `null` |

### Every caller — and every bypass

| File | Uses the utility? | What it imports / does instead |
|---|---|---|
| `services/mobile.service.js` | **Yes** | All 7 exports (lines 6–14). The heaviest consumer. |
| `services/deviceAnalytics.service.js` | **Partly** | `formatDateInTimezone`, `resolveTimezone` (line 5) for the rollup writer — but keeps a private `dateKeyUtc` (line 250) used by `getAnalyticsTimeSeriesByMac`. |
| `services/profile.service.js` | **Validation only** | `isValidTimezone` (line 10). |
| `services/quiz.service.js` | **No** | Private `dayKey` (line 221) + three `setHours(0,0,0,0)`. |
| `services/founderDashboard.service.js` | No | Own `IST_TIMEZONE` / `IST_OFFSET` constants and three private `Intl` formatters (lines 7–8, 74–92). |
| `services/activeDevices.service.js` | No | Own `const IST = 'Asia/Kolkata'` pushed into SQL as `AT TIME ZONE` (line 16). |
| `jobs/usageSummaryNotification.js` | No | Own `TIMEZONE` + `IST_OFFSET_MS = 5.5*60*60*1000` (lines 21–22) and hand-rolled `startOfDayIST`. |
| `jobs/dailyEmailReport.js` | No | Default `'Asia/Kolkata'` for cron scheduling only (line 38); the report's own window is server-local. |
| `services/analytics.service.js` | No | Mix of UTC (`toISOString`) and server-local (`setHours`). |
| `services/admin.service.js` | No | Server-local ranges, UTC day keys. |
| `services/rfid.service.js` | No | Server-local `setHours`, UTC labels. |
| `services/emailReport.service.js` | No | Server-local `setHours`. |

**Four services use it. Eight bypass it.** Of the bypasses, five are hardcoded-IST
(defensible for an India-only user base but not parent-aware) and three are
server-local (undefined without runtime knowledge).

---

## 7. Chat

Chat has **no daily reset, no daily limit and no daily counter**. A repo-wide
search for `daily_limit`, `dailyLimit`, `daily_quota`, `usage_limit`,
`screen_time` across `main/` returns **nothing**. Chat's only day-sensitive
behaviour is *filtering a session list by date*, plus its contribution to the
AI-interaction rollup.

### Chat sessions by date — parent zone, pushed into SQL

```js
function parseSessionDateWindow(options, timezone) {
  …
  const filter = {};
  if (startDate) filter.gte = startOfDayInstant(startDate, timezone);
  if (endDate)   filter.lt  = endOfDayInstantExclusive(endDate, timezone);
  return { startDate, endDate, filter };
}
```
<sub>`src/services/mobile.service.js:4038–4062`, called from `getKidCharacterSessions:4067`</sub>

| | |
|---|---|
| **Timezone** | Parent IANA zone |
| **Source** | `scope.timezone` ← `resolveTimezone(user.parent_profile?.timezone)` → `Asia/Kolkata` |
| **Calculation** | Local midnight converted to an absolute instant, then a half-open `gte`/`lt` range against `voice_sessions.started_at` (`timestamptz`) |
| **Performed on** | Node computes the instants; PostgreSQL performs the comparison |
| **Reset boundary** | **00:00 local — correct** |

This is the *only* place in the codebase that uses
`startOfDayInstant`/`endOfDayInstantExclusive`. The half-open form is deliberate —
the comment at lines 4055–4057 explains that "the last local instant of a day is
not a round number in any zone".

### Chat's contribution to daily counters

An `ai_talk_end` event increments
`device_ai_interactions_daily.ai_interaction_count` for the row keyed on
`(activityDate, mac_address)`, where `activityDate` is computed in the parent's
zone (§10). Chat therefore appears in the parent-app "AI interactions today"
number on an IST calendar day.

### Transcripts

`getKidSessionMessages` returns `createdAt: isoOrNull(row.created_at)` — a UTC
ISO-8601 string (`mobile.service.js:3933`). No calendar-day decision is made;
display-local conversion is the client's job. **Timezone-neutral.**

### Proof that Chat resets at 00:00 IST

Not "it appears to" — the chain is: `resolveProgressScope` reads
`parent_profile.timezone` → NULL → `resolveTimezone(null)` → `DEFAULT_TIMEZONE` →
`process.env.DEFAULT_PARENT_TIMEZONE` is unset in `.env` → literal
`'Asia/Kolkata'` → `startOfDayInstant('2026-08-21','Asia/Kolkata')` =
`2026-08-20T18:30:00Z`. Every link is in `timezone.js:42–49` and
`mobile.service.js:2484`. There is no server-local getter anywhere on that path.

---

## 8. Games

"Games" in this system means three distinct things, on two different mechanisms.

### a. Game analytics — the parent-facing "games played today"

Two sources, both parent-zone, reconciled in `getProgressSummary`:

- **Projected:** `device_games_played` counted by `activity_date` (a `@db.Date`
  column) between `dateOnlyFromKey(range.startDate)` and `…endDate`. The rows
  were written with `activity_date = formatDateInTimezone(eventInstant, parentZone)`.
- **Raw fallback:** if the projected count is 0, `countRawGameStartsForRange`
  (`mobile.service.js:220–237`) reads `game_start` events over a deliberately
  widened instant window and re-buckets each row with
  `formatDateInTimezone(row.server_received_at, scope.timezone)`.

Day boundary: **00:00 in the parent's zone. Correct.**

### b. Quizzy Bee and Riddler — the only games with a daily *gate*

Both are served by the same service and the same endpoints. `banks.js` maps
`quiz_master → quiz` and `riddle_master → riddle` onto different table pairs, but
`nextQuestions`, `recordAnswer`, `dayKey` and the Daily Ten gate are shared code.
**Riddler carries the identical defect.** Detail in §9.

### c. Legacy game session analytics

| Function | File:line | Zone | Boundary |
|---|---|---|---|
| `logStreak` | `analytics.service.js:404–407` | UTC — `Date.UTC(getUTCFullYear, getUTCMonth, getUTCDate)` | UTC midnight. A streak at 02:00 IST is filed on the previous day. |
| `getSessionStats` | `admin.service.js:647–670` | Mixed — server-local range start, UTC day keys | Undefined without runtime TZ |
| `getTodayDeviceCount` | `analytics.service.js:1358–1359` | Server-local `setHours(0,0,0,0)` | Follows the process TZ |
| `getTodayActiveDevices` | `analytics.service.js:1435–1436` | Server-local | Follows the process TZ |
| `listActiveDevices` | `activeDevices.service.js:30–58` | Explicit IST in SQL: `(played_at AT TIME ZONE 'Asia/Kolkata')::date` | 00:00 IST |

Nothing in `livekit-server` or `mqtt-gateway` computes a game day. The Python game
workers (`math_tutor_worker`, `riddle_solver_worker`, `word_ladder_worker`) track
in-session streaks in memory (`src/utils/helpers.py:312–367`) with no date
arithmetic at all.

---

## 9. Quizzy Bee

### The trace

```
Flutter parent app ─── read-only. Calls /api/mobile/quiz-analytics and
                       /quiz-character-progress. NOT on the gate path.

LiveKit worker ─────── NOT IN THIS REPOSITORY. No file under
                       main/livekit-server or main/mqtt-gateway mentions
                       "quiz" at all. The spec referenced by quiz.service.js
                       (2026-08-04-quizzy-question-bank-design.md) is absent.

Quiz API ───────────── GET  /toy/quiz/next-questions ?device_mac&character&character_id
                       POST /toy/quiz/answer
                       No timezone parameter exists on any quiz route.
                       routes/quiz.routes.js:57–78, 138

Quiz service ───────── services/quiz.service.js — server-local throughout

Database ───────────── quiz_question_answer.answered_at
                       TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP
```

### Every date calculation in `quiz.service.js`

| Line | Code | Used by | Zone |
|---|---|---|---|
| 221–224 | ``dayKey = d => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}` `` | `daysByQuestionId` → `agedOutLevels` anti-trap; `days_on_level` in the admin panel | **SERVER LOCAL** |
| 368–369 | `const startOfDay = new Date(); startOfDay.setHours(0,0,0,0)` | **`nextQuestions` — the Daily Ten gate.** Feeds `answered_today` and `day_complete`. | **SERVER LOCAL** |
| 881–882 | `const startOfDay = new Date(); startOfDay.setHours(0,0,0,0)` | `allDeviceProgress` — admin console `answered_today` / `day_complete` | **SERVER LOCAL** |
| 1058–1059 | `const startOfDay = new Date(); startOfDay.setHours(0,0,0,0)` | `clearDayGate` — admin "Reset day" precondition count | **SERVER LOCAL** |
| 1007 | `new Date(Date.now() - 24*60*60*1000)` | `setLevel` backdating | Instant math — TZ-neutral |
| 732 | `updated_at: new Date()` | milestone upsert | Instant |

The comment above `dayKey` states the choice explicitly and non-accidentally:

```js
/**
 * Server-local midnight day key. The same boundary the Daily Ten gate uses —
 * two definitions of "day" in one file would eventually disagree by one, and
 * the disagreement shows up as a child gaining or losing a day.
 */
```
<sub>`src/services/quiz.service.js:216–220`</sub>

The file is internally consistent. It is externally inconsistent with everything
else.

### The named functions, answered directly

| Symbol | Where | Timezone | Comes from |
|---|---|---|---|
| `nextQuestions()` | `quiz.service.js:252–424` | Server local | `setHours` at line 369; nothing else consulted |
| `recordAnswer()` | `quiz.service.js:584–661` | None — writes no date | `answered_at` omitted from the insert; `DEFAULT CURRENT_TIMESTAMP` / Prisma `now()` supplies an instant |
| `dayKey()` | `quiz.service.js:221` | Server local | `getFullYear/getMonth/getDate`. Note `getMonth()` is 0-based and unpadded — keys read `2026-7-21` for August. Harmless (set cardinality only) but it is not a date format. |
| `levelCompletedToday()` | `quiz.logic.js:129–137` | None — pure | Receives `todayQuestionIds` already filtered by the caller's server-local `startOfDay`. The zone defect is inherited, not introduced. |
| `answered_today` | `quiz.service.js:401, 965` | Server local | Count of rows with `answered_at >= startOfDay` |
| `day_complete` | `quiz.service.js:402, 966` | Server local | `answeredToday >= 10 \|\| levelCompletedToday(…)` |
| `answered_at` | `schema.prisma:1426` | UTC instant | `TIMESTAMPTZ(6)` |

### Does it use the parent timezone? No — and it cannot.

`resolveDeviceContext` (`quiz.service.js:43–70`) reads exactly two tables:

```js
prisma.ai_device.findUnique({ where:{mac_address}, select:{ kid_id:true } })
prisma.kid_profile.findUnique({ where:{id}, select:{ birth_date:true, language:true } })
```

It never joins `sys_user` and never reaches `parent_profile`. The quiz service has
**no path to a timezone**, from the profile or from the request.
`/quiz/next-questions` accepts `device_mac`, `character` and `character_id` only,
behind `requireServiceKey`.

### Against Chat and Games

The divergence is documented in the codebase, twice, as a known and deferred
issue:

```js
// Bucketing happens in the parent's timezone, so the window is widened a day
// at each edge and filtered per row. Note the quiz day-gate itself uses
// SERVER-local midnight (quiz.service.js), so a late-evening answer can sit
// in a different day here than the gate counted it in.
```
<sub>`src/services/mobile.service.js:3682–3686`</sub>

```
**Days are bucketed in the parent's timezone** (`parent_profile.timezone`,
default UTC), while the quiz engine's day-gate uses **server-local** midnight.
A late-evening answer can appear on a different date here than the day the
engine counted it in. Tracked separately.
```
<sub>`main/manager-api-node/docs/parent-app-quiz-analytics-api.md:240–243`</sub>

So the parent app's quiz *analytics* and the quiz *engine* disagree even with each
other, on the same rows, in the same request cycle.

---

## 10. Analytics

### The rollup writer — where the analytics day is actually decided

```js
let timezone = resolveTimezone(null);                    // → Asia/Kolkata
if (device?.user_id != null) {
  const profile = await prisma.parent_profile.findUnique({…});
  timezone = resolveTimezone(profile?.timezone);
}
…
const eventInstant    = eventTime(rawEventRow) || new Date();
const activityDateKey = formatDateInTimezone(eventInstant, timezone) || dateKeyUtc(eventInstant);
const activityDate    = toDateOnlyValue(activityDateKey);   // `${key}T00:00:00.000Z`
```
<sub>`src/services/deviceAnalytics.service.js:317–348`</sub>

Every rollup row — `device_usage_daily`, `device_card_taps_daily`,
`device_ai_interactions_daily`, `device_games_played`, `device_radio_played` — is
keyed on this date. It is the parent's calendar day, stored as midnight-UTC in a
`@db.Date` column, and read back with `dateOnlyKey`, which uses UTC getters
precisely because of that.

> **Internal inconsistency — which instant is bucketed. CONFIRMED, secondary.**
> The rollup writer buckets `eventTime(row) = row.event_timestamp ||
> row.server_received_at` — **firmware clock first**. The detail endpoints
> (`getProgressEventsForRange`, `countRawGameStartsForRange`,
> `getHomepageActivityDetails`) filter and bucket on `server_received_at` only
> (`mobile.service.js:234, 264`). For a device whose clock has drifted or was
> never synced, the summary tile and the detail list behind it can put the same
> event on different days. Independent of any timezone setting.

### The UTC island inside the same file

```js
function dateKeyUtc(dateValue) {
  return new Date(dateValue).toISOString().slice(0, 10);
}
…
const key = dateKeyUtc(eventTime(row) || row.server_received_at);
```
<sub>`src/services/deviceAnalytics.service.js:250–252, 730` (`getAnalyticsTimeSeriesByMac`)</sub>

The per-MAC analytics time series never learns the parent's zone. Its daily
buckets cut at 05:30 IST.

### Analytics surfaces, by mechanism

| Surface | File | Mechanism | Boundary |
|---|---|---|---|
| Parent app — homepage ring, progress summary / trend / details | `mobile.service.js` | A — parent zone | 00:00 IST |
| Rollup projection writer | `deviceAnalytics.service.js:347` | A — parent zone | 00:00 IST |
| Per-MAC analytics time series | `deviceAnalytics.service.js:730` | D — UTC | 05:30 IST |
| Founder dashboard (all ranges, hour histograms, weekday splits) | `founderDashboard.service.js:74–148` | B — hardcoded IST | 00:00 IST |
| Active-devices analytics | `activeDevices.service.js` | B — hardcoded IST, in SQL | 00:00 IST |
| Streaks | `analytics.service.js:404–407` | D — UTC | 05:30 IST |
| Admin device/user/session/token stats | `admin.service.js:521–724` | C + D mixed | Undefined |
| RFID tap analytics + daily trend | `rfid.service.js:83–92, 297–331` | C for ranges, D for labels | Undefined; labels can be off by one |
| Daily email report window | `emailReport.service.js:105–112` | C — server local | Follows process TZ (cron fires on IST) |
| Usage summary notifications | `jobs/usageSummaryNotification.js:21–42` | B — hand-rolled fixed +05:30 | 00:00 IST (no DST handling, correct for India) |

---

## 11. Progress / daily counters

The progress family is the most carefully built part of the system. All five
entry points — `getProgressSummary`, `getProgressTrend`, `getProgressDetails`,
`getHomepageActivity`, `getHomepageActivityDetails` — resolve one scope and thread
one zone through everything.

```js
resolveProgressScope(firebaseUid)
  → sys_user.findUnique({ select:{ id, parent_profile:{ select:{ timezone } } } })
  → timezone: resolveTimezone(user.parent_profile?.timezone)
buildProgressDateRange(period, scope.timezone, now)
  → const today = formatDateInTimezone(now, timezone)
  → dates: [ shiftDateKey(today, -n) … today ]
```
<sub>`src/services/mobile.service.js:2440–2493, 268–295`</sub>

### What `startOfDay` actually means, per query shape

| Pattern | Where | What the boundary is |
|---|---|---|
| `date: { gte: dateOnlyFromKey(startDate), lte: … }` | `getProgressSummary:2574–2577` | Compares `@db.Date` columns against midnight-UTC Date objects. Correct *because* the rows were written from parent-zone date keys through the same `${key}T00:00:00.000Z` construction. Not a UTC-day boundary — a parent-day boundary encoded UTC-ly. |
| `server_received_at: rangeInstantWindow(range)` | `mobile.service.js:213–218` | Deliberately over-wide (−1 day / +2 days) to cover any zone offset, then **re-filtered per row** with `formatDateInTimezone`. The SQL window is not the boundary; the JS filter is. |
| `started_at: { gte: startOfDayInstant(…), lt: endOfDayInstantExclusive(…) }` | `mobile.service.js:4059–4060` | A true parent-local midnight pushed into SQL. Used only by chat sessions. |
| `answered_at: { gte: startOfDay }` | `quiz.service.js:372, 884, 1063` | **Server-local midnight.** The one `>= startOfDay` in the codebase that is not zone-aware. |
| `answered_at: { lt: windowOpened }` | `mobile.service.js:3688` | ``new Date(`${range.startDate}T00:00:00Z`)`` — a UTC instant used as the "cleared before this window" cutoff, while the range keys around it are parent-zone. Off by up to one zone offset when classifying replay vs first pass. Cosmetic, but a real seam. |

### Daily counters that exist

- `device_usage_daily.usage_time_seconds` (+ four per-category buckets) — parent zone
- `device_card_taps_daily.card_tap_count` — parent zone, with a 60-second debounce
- `device_ai_interactions_daily.ai_interaction_count` — parent zone
- `device_games_played` / `device_radio_played` rows by `activity_date` — parent zone
- `quiz_question_answer` counted since `startOfDay` — **server local**

There is **no daily goal, target, limit or quota field anywhere in this API or its
database** — stated explicitly in `docs/parent-app-progress-ring.md` and confirmed
by search. The Daily Ten is the only quota in the system, and it is Quizzy's.

---

## 12. Database

### The distinction that matters

| | |
|---|---|
| **Stored timestamp timezone** | *Not a real thing here.* Every event column is `timestamptz`. PostgreSQL stores an absolute instant (microseconds from an epoch) and attaches no zone to the row. Prisma returns a JavaScript `Date`, which is also an instant. Nothing is lost, nothing is ambiguous. |
| **Calendar-day timezone** | *Entirely an application decision.* "Which day does this instant belong to" is answered nowhere in the database. It is answered by whichever JS function looks at the `Date` — and the answer differs depending on which function that is. **This is where the bug lives.** |

### Column inventory

| Column | Type | Written by | Meaning |
|---|---|---|---|
| `quiz_question_answer.answered_at`<br>`riddle_question_answer.answered_at` | `TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP` | DB default (column omitted from the insert) | Absolute instant |
| `device_analytics_event.event_timestamp` | `TIMESTAMPTZ(6)` nullable | Firmware epoch value, parsed by `parseFirmwareTimestampOrNull` | Absolute instant, *as the device's clock believes it* |
| `device_analytics_event.server_received_at` | `TIMESTAMPTZ(6) DEFAULT now()` | Database | Absolute instant of ingest |
| `voice_sessions.started_at` / `ended_at` | `TIMESTAMPTZ(6)` | Session writer | Absolute instant |
| `device_usage_daily.date`<br>`device_card_taps_daily.date`<br>`device_ai_interactions_daily.date` | `@db.Date` | **Application**, from `formatDateInTimezone(instant, parentZone)` | **A parent-local calendar day.** Prisma round-trips it as midnight UTC — an encoding, not a meaning. |
| `device_games_played.activity_date`<br>`device_radio_played.activity_date` | `@db.Date` | Application, same source | Parent-local calendar day |
| `device_games_played.played_at` | `TIMESTAMPTZ(6)` | Application | Absolute instant — and it is `played_at`, not `activity_date`, that `activeDevices.service.js` and `buildGamePlayedWeekSections` re-bucket |
| `analytics_streaks.streak_date` | `@db.Date` | Application, from `Date.UTC(getUTC*)` | **A UTC calendar day.** Same column type as the rollups, different meaning. |

Two `@db.Date` columns in the same database therefore encode two different
calendars. Nothing in the schema records which is which.

### Does the application convert before comparing?

Yes, in three distinguishable ways:

1. **Key-then-compare** (rollups): rows already carry a parent-zone date key; the
   query compares date keys. No conversion needed.
2. **Widen-then-filter** (event details): SQL fetches an over-wide instant window;
   JS converts each row with `formatDateInTimezone` and discards misses.
3. **Convert-then-push** (chat sessions): JS computes the local-midnight instant
   and lets PostgreSQL compare. Required whenever a count or a paginated result
   must be correct.

Quizzy Bee uses a fourth: **compare against a locally-derived instant that nobody
chose the zone for.**

---

## 13. `new Date()` inventory

Only occurrences whose result reaches a calendar-day decision. Instant arithmetic
(`Date.now() - n`, `updated_at: new Date()`, ISO serialisation, sort comparators)
is timezone-neutral and excluded — those are the majority of raw hits.

| File : line | Function | Feature | Code | Class |
|---|---|---|---|---|
| `quiz.service.js:368` | `nextQuestions` | Quizzy / Riddler Daily Ten gate | `new Date()` + `setHours(0,0,0,0)` | **SERVER LOCAL** |
| `quiz.service.js:222` | `dayKey` | Anti-trap day count, `days_on_level` | `new Date(v).getFullYear/getMonth/getDate` | **SERVER LOCAL** |
| `quiz.service.js:881` | `allDeviceProgress` | Admin quiz console | `new Date()` + `setHours(0,0,0,0)` | **SERVER LOCAL** |
| `quiz.service.js:1058` | `clearDayGate` | Admin "Reset day" | `new Date()` + `setHours(0,0,0,0)` | **SERVER LOCAL** |
| `mobile.service.js:2553, 2657, 2763, 2992 …` | `getProgress*` | Progress family | `options.now \|\| new Date()` → `buildProgressDateRange(…, tz, now)` | EXPLICIT USER TZ |
| `mobile.service.js:169, 268, 297` | range builders | Progress / details / calendar | `formatDateInTimezone(now, timezone)` | EXPLICIT USER TZ |
| `mobile.service.js:3596` | `getQuizCharacterProgress` | Home quiz card date stamp | `formatDateInTimezone(options.now \|\| new Date(), scope.timezone)` | EXPLICIT USER TZ |
| `deviceAnalytics.service.js:345–347` | `applyProjectionForEvent` | All rollups | `eventTime(row) \|\| new Date()` → `formatDateInTimezone(…, tz)` | EXPLICIT USER TZ |
| `deviceAnalytics.service.js:730` | `getAnalyticsTimeSeriesByMac` | Per-MAC time series | `dateKeyUtc(eventTime(row))` | UTC |
| `analytics.service.js:404–407` | `logStreak` | Game streaks | `Date.UTC(getUTCFullYear, getUTCMonth, getUTCDate)` | UTC |
| `analytics.service.js:1358, 1397, 1435, 1536` | `getToday/MonthDeviceCount`, `getTodayActiveDevices` | Admin dashboards | `new Date()` + `setHours(0,0,0,0)` | SERVER LOCAL |
| `admin.service.js:521, 570, 646, 693` | registration / session / token stats | Admin stats | `setDate(getDate()-n)` + `setHours(0,0,0,0)` | SERVER LOCAL |
| `admin.service.js:535, 584, 669, 724` | same, grouping step | Admin stats | `toISOString().split('T')[0]` | UTC |
| `rfid.service.js:83–92, 150–180, 297–308` | `parseDateInput`, `buildTapTrendDays` | RFID admin analytics | `setHours(0,0,0,0)` / `setHours(23,59,59,999)` | SERVER LOCAL |
| `rfid.service.js:329, 3132` | trend labels | RFID daily trend | `dayStart.toISOString().slice(0,10)` | UTC label on a server-local day |
| `emailReport.service.js:105–112` | `generateReportData` | Daily email report | `setHours(0,0,0,0)` / `setHours(23,59,59,999)` | SERVER LOCAL |
| `founderDashboard.service.js:111, 145–148` | `todayIstKey`, `boundsFromKeys` | Founder dashboard | `IST_DAY_FORMATTER.format(new Date())`; `` `T00:00:00.000+05:30` `` | HARDCODED IST |
| `jobs/usageSummaryNotification.js:29–42` | `startOfDayIST`, `startOfWeekIST` | Push notifications | `new Date(ref.getTime() + IST_OFFSET_MS)` | HARDCODED fixed +05:30 |
| `device.service.js:879–885` | `checkOtaUpdate` | OTA `server_time` | `-now.getTimezoneOffset()`; `Intl…resolvedOptions().timeZone` | **SERVER LOCAL, exported to devices** |
| `routes/analytics.routes.js:1974, 2027–2037` | today/month device-count | Admin API response labels | `toISOString().split('T')[0]`; `getFullYear/getMonth` | UTC label on a server-local count |
| `mobile.service.js:24–33` | `ageFromBirthDate` | Kid age display | `new Date()` + `getFullYear/getMonth/getDate` | SERVER LOCAL (±1 day at a birthday edge; cosmetic) |
| `mqtt-gateway` (17 sites) | various | Telemetry, control frames | `new Date().toISOString()` | Instant only |
| `livekit-server prompt_manager.py:137–142`<br>`main_agent.py:1963–1997`<br>`cheeko_worker.py:306` | time/date tools & prompt vars | What the agent tells the child | `datetime.now(pytz.timezone('Asia/Kolkata'))` | HARDCODED IST — explicit, so process-TZ-independent |

> **On "`new Date()` does not mean UTC".**
> Confirmed for this codebase. `new Date()` is an instant with no zone. What
> decides the zone is the *getter* applied afterwards: `getHours/getDate/setHours`
> use the process TZ; `getUTC*`/`toISOString` use UTC;
> `Intl.DateTimeFormat({timeZone})` uses whatever zone is named. The same is true
> of Python's `datetime.now()` — naive, process-local — which is why the agent code
> always passes `pytz.timezone(...)`, and why the one fallback that does not
> (`prompt_manager.py:152`, reached only on exception) is process-local.

---

## 14. "Today" / start-of-day inventory

Eleven distinct implementations of "reduce this instant to a calendar day" exist
in `manager-api-node`.

| # | Implementation | Location | Instant in → date out |
|---|---|---|---|
| 1 | `formatDateInTimezone(v, tz)` | `utils/timezone.js:57` | Any instant → the day it falls on in an **explicitly named zone**. The reference implementation. |
| 2 | `dateOnlyKey(v)` | `utils/timezone.js:84` | A `@db.Date` value → its own key, read with UTC getters. Correct only for date-only columns; wrong for instants. |
| 3 | `startOfDayInstant` / `endOfDayInstantExclusive` | `utils/timezone.js:130, 138` | Date key + zone → the instant the local day opens / the next one opens. DST-corrected. |
| 4 | `dateOnlyFromKey(k)` | `mobile.service.js:195` | `` `${k}T00:00:00.000Z` ``. Not a boundary — the encoding used to talk to `@db.Date` columns. |
| 5 | `new Date(); setHours(0,0,0,0)` | `quiz.service.js:368/881/1058`; `analytics.service.js` ×4; `admin.service.js` ×4; `rfid.service.js` ×6; `emailReport.service.js:107` | Now → **process-local** midnight. **18 sites.** |
| 6 | `` `${getFullYear()}-${getMonth()}-${getDate()}` `` | `quiz.service.js:223` | Instant → **process-local** day, 0-based unpadded month. |
| 7 | `toISOString().slice(0,10)` / `.split('T')[0]` | `deviceAnalytics.service.js:252`; `admin.service.js` ×4; `analytics.service.js` ×8; `rfid.service.js` ×2; `emailReport.service.js` ×3; `routes/analytics.routes.js:1974` | Instant → **UTC** day. |
| 8 | `Date.UTC(getUTCFullYear(), getUTCMonth(), getUTCDate())` | `analytics.service.js:406` | Instant → UTC-midnight `Date` for the streak unique key. |
| 9 | `IST_DAY_FORMATTER.format(v)` | `founderDashboard.service.js:74–98` | Instant → **hardcoded Asia/Kolkata** day, via `en-CA` (which yields ISO order). |
| 10 | `new Date(ref.getTime() + IST_OFFSET_MS)` | `jobs/usageSummaryNotification.js:29–42` | Instant → IST day by fixed offset arithmetic. No DST logic — deliberate and safe for India, wrong anywhere else. |
| 11 | `(col AT TIME ZONE 'Asia/Kolkata')::date` | `activeDevices.service.js` ×9 | Instant → IST day, computed by PostgreSQL. The only day boundary in the system evaluated by the database. |

Implementations 1–4 are one coherent family. 5 and 6 are Quizzy Bee's. 7–11 are
five more.

---

## 15. Component comparison

| Component | Function | Timezone | Source | Computed on | Reset boundary | Correct? |
|---|---|---|---|---|---|---|
| **Chat — sessions by date** | `parseSessionDateWindow` | Parent IANA | `parent_profile.timezone` → default | Node → SQL | 00:00 local | ✅ Yes |
| **Chat — AI interaction counter** | `applyProjectionForEvent` | Parent IANA | Same | Node | 00:00 local | ✅ Yes |
| **Chat — transcripts** | `getKidSessionMessages` | None | — | Client renders | n/a | ✅ Yes |
| **Games — played today** | `getProgressSummary` | Parent IANA | `activity_date` written in parent zone | Node → SQL | 00:00 local | ✅ Yes |
| **Quizzy Bee — Daily Ten** | `nextQuestions` | **Server local** | Host OS / process TZ | Node | 00:00 *server* = 05:30 IST on UTC | ❌ **No** |
| **Quizzy Bee — anti-trap days** | `dayKey` / `agedOutLevels` | **Server local** | Host OS / process TZ | Node | Same | ❌ **No** |
| **Riddler — Daily Ten** | `nextQuestions` (shared) | **Server local** | Host OS / process TZ | Node | Same | ❌ **No** |
| **Quiz analytics (parent app)** | `buildQuizAnalyticsForScope` | Parent IANA | `parent_profile.timezone` | Node | 00:00 local | ⚠️ Yes, but disagrees with the engine |
| **Progress summary / trend / details** | `getProgress*` | Parent IANA | `parent_profile.timezone` | Node → SQL | 00:00 local | ✅ Yes |
| **Homepage ring** | `getHomepageActivity` | Parent IANA | Delegates to progress summary | Node | 00:00 local | ✅ Yes |
| **Rollup writer** | `applyProjectionForEvent` | Parent IANA | `parent_profile.timezone` | Node | 00:00 local | ✅ Yes |
| **Streaks** | `logStreak` | UTC | Hardcoded `getUTC*` | Node | 05:30 IST | ⚠️ No |
| **Per-MAC time series** | `getAnalyticsTimeSeriesByMac` | UTC | Hardcoded `dateKeyUtc` | Node | 05:30 IST | ⚠️ No |
| **Founder dashboard** | `buildDateRange` etc. | IST, hardcoded | `IST_TIMEZONE` const | Node → SQL | 00:00 IST | ⚠️ Right answer, wrong mechanism |
| **Active devices** | `listActiveDevices` | IST, hardcoded | `AT TIME ZONE` in SQL | PostgreSQL | 00:00 IST | ⚠️ Right answer, wrong mechanism |
| **Usage summary push** | `startOfDayIST` + cron | IST, fixed offset | `IST_OFFSET_MS` | Node | 00:00 IST, fires 22:00 IST | ⚠️ Right answer, wrong mechanism |
| **Daily email report** | `generateReportData` | Server local | Host OS | Node | Follows process TZ; cron fires on IST | ⚠️ No |
| **Admin device/user stats** | `admin.service.js` ×4 | Server local + UTC | Host OS / hardcoded | Node | Undefined | ⚠️ No |
| **RFID tap analytics** | `rfid.service.js` | Server local + UTC labels | Host OS / hardcoded | Node | Undefined | ⚠️ No |
| **Agent "what day is it"** | `prompt_manager` / `get_time_date` | IST, hardcoded | `pytz.timezone('Asia/Kolkata')` | Python worker | 00:00 IST | ⚠️ Right answer, and it contradicts Quizzy in the same session |
| **OTA `server_time`** | `checkOtaUpdate` | Server local | Host OS | Node → device | n/a (clock sync) | ❌ Exports the wrong zone name to firmware |
| **MQTT gateway** | 17 sites | None | — | — | n/a | ✅ Yes, by construction |

---

## 16. Timezone inconsistencies

1. **Quizzy Bee's engine vs everything parent-facing.** Server-local vs parent
   IANA. The headline defect. — CONFIRMED
2. **Quizzy Bee's engine vs Quizzy Bee's own analytics.** The same
   `quiz_question_answer` rows are bucketed one way by `nextQuestions` and another
   by `buildQuizAnalyticsForScope`. Documented in-code at `mobile.service.js:3682`
   and in `parent-app-quiz-analytics-api.md`. — CONFIRMED
3. **Riddler inherits the same defect silently**, because `banks.js` makes the two
   characters share one service. — CONFIRMED
4. **Two `@db.Date` meanings.** The rollup `date` columns hold a parent-local day;
   `analytics_streaks.streak_date` holds a UTC day. Same type, no discriminator. —
   CONFIRMED
5. **Rollups bucket `event_timestamp`; detail endpoints bucket
   `server_received_at`.** Divergence proportional to device clock drift,
   independent of timezone. — CONFIRMED
6. **`getAnalyticsTimeSeriesByMac` is a UTC island** in a file whose other half is
   parent-zone. — CONFIRMED
7. **Five hardcoded-IST implementations** (founder dashboard, active devices,
   usage-summary cron, email-report cron zone, LiveKit agent) that will all be
   wrong on the first non-Indian account, and none of which reads the profile
   column that exists for exactly this. — CONFIRMED
8. **`windowOpened` uses a UTC instant to cut a parent-zone range** when deciding
   replay vs first pass (`mobile.service.js:3688`). — CONFIRMED, minor
9. **RFID daily-trend labels are UTC strings for server-local day buckets**
   (`rfid.service.js:297–331`). Off by one whenever the two disagree. — CONFIRMED,
   minor
10. **`kid_profile.timezone` is writable and unvalidated but read by nothing**,
    while `parent_profile.timezone` is validated and authoritative. A client that
    populates the wrong one gets no error and no effect. — CONFIRMED
11. **The OTA handshake tells the device the *server's* zone**, so if the process
    is UTC every ESP32 is told `timeZone: "UTC", timezone_offset: 0` while the
    agent in the same session insists it is IST. — CONFIRMED
12. **Schema/migration width mismatch** on `parent_profile.timezone` (50 vs 100). —
    UNKNOWN which the live DB has

### Grouped by mechanism

- **Share the central utility:** `mobile.service`, `deviceAnalytics` (writer half),
  `profile.service` (validation).
- **Independent but explicit:** `founderDashboard`, `activeDevices`,
  `usageSummaryNotification`, LiveKit agent.
- **Bypass the utility *and* depend on the host OS:** `quiz.service`,
  `rfid.service`, `emailReport.service`, `admin.service`, `analytics.service` (the
  `setHours` half).

---

## 17. The recent timezone change

### Commit

```
bac20344  fix: timezone converted to IST standards
          Jeee3T <prasanjeetpanda06@gmail.com>  Thu 20 Aug 2026 17:21:35 +0530
          13 files changed, 1328 insertions(+), 307 deletions(-)
```

### What it actually changed

| File | Old behaviour | New behaviour | Touches Quizzy? |
|---|---|---|---|
| `src/utils/timezone.js` | Did not exist | New 153-line module; `DEFAULT_TIMEZONE` = env or `Asia/Kolkata` | No |
| `deviceAnalytics.service.js` | Private `formatDateInTimezone(v, tz='UTC')`; `let timezone = 'UTC'`; `profile?.timezone \|\| 'UTC'` | Imports the shared util; `resolveTimezone(null)` → `Asia/Kolkata`. Plus an unrelated `ownerRepair` fix re-stamping `kid_id`. | No |
| `mobile.service.js` | Private `formatDateInTimezone`; `timezone: user.parent_profile?.timezone \|\| 'UTC'` | `resolveTimezone(...)`; adds `startOfDayInstant`-bounded chat-by-date; adds timezone write validation | Only its *analytics* view of quiz rows |
| `profile.service.js` | `target.timezone = data.timezone`, unvalidated | Validates with `isValidTimezone`, 400s on bad input, ignores blank | No |
| `.env.example` | — | Documents `DEFAULT_PARENT_TIMEZONE=Asia/Kolkata` and instructs "leave the TZ variable unset" | No |
| `prisma/migrations/20260820000000_rollups_repair_kid` | — | Backfills `kid_id` on six rollup tables. Not a timezone change. | No |
| `client.py` | `SERVER_IP=139.59.7.72`, MAC `…11:c4` | `SERVER_IP=192.168.0.246`, MAC `…11:c6` | No — an unrelated local test-client change swept into the commit |
| `tests/` (5 files, ~700 lines) | — | New `timezone.test.js` and `mobile.timezone-day-boundary.test.js` | No quiz test asserts anything about a zone |

### Verdict on propagation

> **The change cannot have affected Quizzy Bee's day gate.**
> `main/manager-api-node/src/services/quiz.service.js` is not in the commit's file
> list. It does not import `utils/timezone`. Its `nextQuestions` gate at lines
> 368–369 is byte-identical before and after. The only Quizzy-adjacent thing the
> commit changed is `buildQuizAnalyticsForScope`'s default zone — which moves the
> parent app's *reporting* of quiz answers from UTC days to IST days, while
> leaving the *engine* on server-local days. **It widened the gap between the two
> rather than closing it.**

### Is the changed code even deployed?

> **No, not on the branch the deploy script pulls.**

```bash
$ git branch -a --contains bac20344
* fix/timezone-mismatch
  remotes/origin/fix/timezone-mismatch

$ git rev-parse bac20344^  ==  git rev-parse origin/main   # e9775e1c

$ git cat-file -e origin/main:main/manager-api-node/src/utils/timezone.js
fatal: path … exists on disk, but not in 'origin/main'

$ git show origin/main:…/deviceAnalytics.service.js | grep 'timezone = '
69:  function formatDateInTimezone(value, timezone = 'UTC') {
339:   let timezone = 'UTC';
345:   timezone = profile?.timezone || 'UTC';
```

`.github/workflows/deploy.yml` triggers on push to `main`; `deploy/deploy.sh` runs
`git reset --hard origin/main`. Unless someone deployed the branch by hand,
**production is still on the UTC fallback for analytics too**. That contradicts
the premise that Chat/Games/Analytics currently reset correctly at IST — so either
the branch was hand-deployed, or the correct-IST observation was made against a
non-production environment. **This must be established before any conclusion about
Quizzy is acted on.**

---

## 18. Production vs local

| Environment | How the API runs | TZ set? | Effective process zone | Confidence |
|---|---|---|---|---|
| This checkout (macOS) | `npm run dev` / `npm test` | No | **Asia/Calcutta (−330)** — measured | CONFIRMED |
| Docker (`docker-compose up api`) | `node:20-alpine`, `CMD node server.js` | No | **UTC** — Alpine ships no `/etc/localtime` and no `tzdata` is installed | CONFIRMED from Dockerfile |
| Staging | No staging config exists in the repository | — | — | UNKNOWN |
| **Production** | PM2 on a bare host, `/opt/cheeko-backend`, `pm2 startOrReload /opt/ecosystem.config.js --only manager-api` | Not in the repo; `/opt/ecosystem.config.js` is outside it | **Host OS zone.** Behaviour reported ⇒ almost certainly UTC. | HIGH CONFIDENCE, not confirmed |

Other services, for completeness: `mqtt-gateway` builds from `node:20-bullseye`
(Debian default UTC, no `TZ`); `livekit-server` from `python:3.x-slim` (UTC, but
every date call passes `pytz.timezone('Asia/Kolkata')` explicitly so the process
zone is irrelevant to it); `manager-web` is a static nginx build with no
server-side dates.

> **The trap this creates.**
> On this developer machine, Quizzy Bee's day gate is *correct* — server-local
> midnight is IST midnight. Every quiz test passes, including
> `quiz.reset-day.test.js`, which reimplements the buggy `setHours(0,0,0,0)` and
> `dayKey` in its own assertions (lines 39–40) and therefore agrees with the
> service in any zone. The defect is invisible to the test suite and invisible in
> local development. It only appears where the host is not IST.

---

## 19. Midnight IST simulation

Parent zone `Asia/Kolkata`, no zone stored on the profile. Quiz answered at
**00:05 IST on 2026-08-21**; the toy asks for its next batch at **10:00 IST** the
same morning.

```
IST DAY — what Chat, Games, Progress and Analytics use
|00:00 IST ─────────────────────────────────────────────────── 24:00 IST|
 ^ Aug 21 begins

SERVER-LOCAL DAY on a UTC host — what Quizzy Bee and Riddler use
|…still Aug 20 ──┤05:30 IST ──────────────────────────────────────────  |
                  ^ Aug 21 begins HERE

 ^ 00:05  answer recorded            2026-08-20T18:35Z
              ^ 10:00  next-questions requested   2026-08-21T04:30Z
 |<── 5h30m in which the two calendars disagree ──>|
```

Any Quizzy answer between 00:00 and 05:29 IST is filed by the engine under the
*previous* day, while every other feature files it under the current one. A child
playing before dawn finds the Daily Ten already spent; the parent's screens show
those same answers as today's.

### Component by component

| Component | Start-of-day value it computes at 10:00 IST | 00:05 answer inside it? | Result |
|---|---|---|---|
| **Quizzy Bee**<br>`quiz.service.js:368` | `new Date()` = `2026-08-21T04:30Z`; `setHours(0,0,0,0)` with TZ=UTC → **`2026-08-21T00:00:00Z`** | `18:35Z Aug 20 < 00:00Z Aug 21` → **No** | `answered_today` excludes it. If the child answered ten questions between 00:05 and 05:29, the gate says 0 today — but those ten were charged against Aug 20, which may already have been complete, so the gate was *closed* when they played and is *open* now. |
| **Quizzy anti-trap**<br>`dayKey` | `getFullYear/getMonth/getDate` on `18:35Z` with TZ=UTC → **`"2026-7-20"`** | Filed under Aug 20 | Two sessions on the same IST day (00:05 and 23:00) produce two distinct day keys, inflating `days_on_level` and advancing the child early. Conversely 06:00 and 23:00 on the previous IST day collapse to one. |
| **Chat sessions by date**<br>`mobile.service.js:4059` | `startOfDayInstant('2026-08-21','Asia/Kolkata')` → **`2026-08-20T18:30:00Z`** | `18:35Z ≥ 18:30Z` → **Yes** | Correct. |
| **Rollup writer**<br>`deviceAnalytics.service.js:347` | `formatDateInTimezone(18:35Z,'Asia/Kolkata')` → **`"2026-08-21"`** | Yes | Any usage/card/AI/game event at 00:05 IST lands on Aug 21. Correct. |
| **Progress summary**<br>`mobile.service.js:2553` | `buildProgressDateRange('today','Asia/Kolkata', 04:30Z)` → range **`2026-08-21 … 2026-08-21`** | Yes, via the rollup row | Ring reports the 00:05 activity. Correct. |
| **Parent-app quiz analytics**<br>`mobile.service.js:3723` | `formatDateInTimezone(answered_at,'Asia/Kolkata')` → **`"2026-08-21"`** | Yes | Shows the answer under today — while the toy behaves as though it were yesterday's. |
| **Streaks**<br>`analytics.service.js:406` | `Date.UTC(2026,7,20)` → **`2026-08-20`** | Filed under Aug 20 | Same 05:30 shift as Quizzy, by a different route. |
| **Founder dashboard**<br>`founderDashboard.service.js:111` | `IST_DAY_FORMATTER.format(04:30Z)` → **`"2026-08-21"`**; `tsStart` **`2026-08-20T18:30Z`** | Yes | Correct, via its own hardcoded IST. |
| **Same run on this Mac** (TZ = Asia/Calcutta) | Quizzy `setHours(0,0,0,0)` → **`2026-08-20T18:30:00Z`** | Yes | Quizzy is *correct* locally. This is why the defect never surfaced in development. |

---

## 20. Root cause / findings

### Primary

**Finding 1 — the day gate has no timezone at all. CONFIRMED.**
`quiz.service.js` decides "today" with `new Date(); setHours(0,0,0,0)` (lines 368,
881, 1058) and `getFullYear/getMonth/getDate` (line 223). None of these names a
zone, so each resolves to the Node process's TZ, which nothing in the repository
sets. On a UTC host the Quizzy/Riddler day runs **05:30 IST → 05:30 IST**. Every
other daily feature was moved to `Asia/Kolkata` and runs **00:00 → 00:00**.

**Finding 2 — the quiz service is structurally unable to know the zone.
CONFIRMED.**
`resolveDeviceContext` reads `ai_device` and `kid_profile` only; it never reaches
`sys_user` or `parent_profile`. `/quiz/next-questions` accepts no timezone
parameter. The information is not merely unused — it is not reachable from
anywhere on the request path.

**Finding 3 — the recent commit did not and could not have fixed it. CONFIRMED.**
`bac20344` touched 13 files; `quiz.service.js` is not among them. It moved the
parent-app's quiz *reporting* from UTC days to IST days, which widened the
disagreement between the reporting view and the engine.

**Finding 4 — the fix is not on the deploy branch. CONFIRMED in repo; deployment
state unknown.**
`bac20344` exists only on `fix/timezone-mismatch`. `origin/main` — the ref
`deploy.sh` hard-resets to — has no `src/utils/timezone.js` and still defaults to
`'UTC'` in `deviceAnalytics.service.js`. Whether production is running this branch
is the first thing to establish.

### Secondary — same class, different components

5. **Riddler** shares `quiz.service.js` and carries the identical boundary. —
   CONFIRMED
6. **Streaks** (`analytics.service.js:406`) file on UTC days — the same 05:30
   shift. — CONFIRMED
7. **Per-MAC analytics time series** (`deviceAnalytics.service.js:730`) buckets on
   UTC days. — CONFIRMED
8. **Daily email report** (`emailReport.service.js:107`) uses a server-local window
   but a cron scheduled in IST — on a UTC host it reports the wrong 24 hours. —
   CONFIRMED
9. **RFID and admin analytics** mix server-local ranges with UTC labels. —
   CONFIRMED
10. **OTA `server_time`** ships the server's zone to every device. — CONFIRMED
11. **Rollup writer buckets `event_timestamp`, detail endpoints bucket
    `server_received_at`** — a device-clock-drift divergence unrelated to timezone.
    — CONFIRMED
12. **Five hardcoded-IST implementations** that will break on the first
    non-Indian account, none reading the profile column. — CONFIRMED
13. **`kid_profile.timezone`** is writable, unvalidated, and read by nothing. —
    CONFIRMED

### Why the test suite never caught it

`quiz.reset-day.test.js:39–40` defines its own `startOfToday()` and `dayKey()`
using the same `setHours(0,0,0,0)` and `getFullYear/getMonth/getDate` as the
service. Test and implementation share the defect, so they agree in every zone. No
quiz test sets `TZ`, and no jest config pins one. The ~490 lines of new timezone
tests added by `bac20344` assert only against `mobile.service` and
`utils/timezone`.

---

## 21. Confidence matrix

| Finding | Status | Evidence | Runtime verification needed |
|---|---|---|---|
| Quizzy Bee's day gate uses process-local midnight | **CONFIRMED** | `quiz.service.js:368–369, 881–882, 1058–1059, 221–224` | None |
| The quiz service cannot reach a parent timezone | **CONFIRMED** | `resolveDeviceContext:43–70`; `quiz.routes.js:57–78` | None |
| Riddler shares the defect | **CONFIRMED** | `banks.js` BANKS map; one shared `nextQuestions` | None |
| Nothing in the repo sets `TZ` | **CONFIRMED** | Repo-wide search across Dockerfiles, compose, workflows, PM2 config, `.env`, source | None |
| The Docker image would run UTC | **CONFIRMED** | Dockerfile — `node:20-alpine`, no `tzdata`, no `ENV TZ` | None (but the image is not what production runs) |
| Production runs PM2 on a bare host, not Docker | **CONFIRMED** | `deploy/deploy.sh`; `.github/workflows/deploy.yml` | None |
| Chat / Progress / Analytics use the parent zone with an `Asia/Kolkata` default | **CONFIRMED** | `timezone.js:42–49`; `mobile.service.js:2484`; `deviceAnalytics.service.js:323–328` | None |
| `bac20344` does not touch `quiz.service.js` | **CONFIRMED** | `git show --stat bac20344` | None |
| The fix is absent from `origin/main` | **CONFIRMED** | `git cat-file -e origin/main:…/timezone.js` → fatal | None |
| **The production Node process runs UTC** | **HIGH CONFIDENCE** | No `TZ` anywhere; reported symptom is precisely what a UTC process produces; local IST checkout shows no symptom | `timedatectl`, `pm2 env`, and a one-line `node -e` on the API host |
| `parent_profile.timezone` is NULL on all live accounts | **HIGH CONFIDENCE** | Asserted in `timezone.js:13–15` and the test header; no writer, no backfill migration | `SELECT count(*) FILTER (WHERE timezone IS NOT NULL) FROM parent_profile;` |
| `DEFAULT_PARENT_TIMEZONE` is unset in production | **HIGH CONFIDENCE** | Present in `.env.example` only; absent from the local `.env`; added by the undeployed commit | Inspect the production `.env` / `pm2 env` |
| Production is running `origin/main`, i.e. without the fix | **LIKELY** | `deploy.sh` hard-resets to `origin/main` | `git -C /opt/cheeko-backend rev-parse HEAD` and `git status` on the host |
| The Flutter app sends a timezone | **UNKNOWN** | App not in this repository | Inspect the parent-app repo for a `timezone` field on the profile PATCH; or check the DB column for non-NULLs |
| Which zone the Flutter app computes "today" in | **UNKNOWN** | No Dart source | Inspect the app repo. `docs/parent-app-progress-ring.md` instructs it to render `today_progress.date` rather than deriving one. |
| Which zone the Quizzy LiveKit worker assumes | **UNKNOWN** | No file in `main/livekit-server` or `main/mqtt-gateway` mentions quiz; the design spec it cites is absent | Locate the worker (the "picoclaw" repo referenced by `banks.js`) and check whether it caches `day_complete` or re-derives a day itself |
| Live width of `parent_profile.timezone` | **UNKNOWN** | `schema.prisma` says 50; the only creating migration says 100; no ALTER exists | `\d parent_profile` |
| Whether `/opt/ecosystem.config.js` injects a TZ | **UNKNOWN** | File is outside the repository; the in-repo copy is stale and unused | Read the file on the host |
| Database session `TimeZone` setting | **UNKNOWN** | Not configured in `src/config/database.js` or the connection string | `SHOW TimeZone;` — expected to be immaterial, since every day boundary is either computed in JS or written with an explicit `AT TIME ZONE` |

---

## 22. Final conclusion

### 1. Is the backend globally running in UTC?

**No — there is no global setting at all.** The repository never sets `TZ`, so each
process inherits its host. The Docker image would be UTC; production does not use
that image, it uses PM2 on a host whose zone the repository cannot show.
**Production process zone: high confidence UTC, not confirmed.** Crucially, most of
the backend does not *care*, because it names its zone explicitly — only the
`setHours`/`getDate` family is exposed, and Quizzy Bee is in it.

### 2. Is Flutter using device timezone?

**UNKNOWN** — the app is in a different repository. What can be said: the backend
expects *not* to be told, every fallback is written for NULL, and
`docs/parent-app-progress-ring.md:112–117` explicitly instructs the app to render
the server's `today_progress.date` rather than derive "today" from the phone clock.

### 3. Is the user's timezone stored?

There is a column — `parent_profile.timezone`, nullable, validated on write since
`bac20344`. **It is almost certainly NULL on every live account**, per
`timezone.js:13–15` and the test header. `kid_profile.timezone` also exists, is
unvalidated, and is read by nothing.

### 4. Which components use the user's timezone?

Progress summary / trend / details, homepage activity and its details, the quiz
analytics and quiz-character-progress endpoints, chat sessions filtered by date,
and the analytics rollup writer. All in `mobile.service.js` and
`deviceAnalytics.service.js`.

### 5. Which components use server-local time?

**Quizzy Bee and Riddler** (the Daily Ten gate, the anti-trap day key, the admin
console counts, and Reset day), plus `rfid.service.js`, `emailReport.service.js`,
four functions in `analytics.service.js`, four in `admin.service.js`, and the OTA
`server_time` block in `device.service.js`.

### 6. Which components explicitly use UTC?

`analytics_streaks` row keys, `getAnalyticsTimeSeriesByMac`, the
`toISOString().split('T')[0]` groupings in `admin.service.js` and
`analytics.service.js`, the RFID trend labels, and `dateOnlyKey` — the last of
which is correct, because it reads `@db.Date` columns that Prisma hands back as
midnight UTC.

### 7. Which components use the central timezone utility?

`mobile.service.js` (all seven exports), `deviceAnalytics.service.js` (the writer
half), `profile.service.js` (validation only). Four files including the utility
itself.

### 8. Which components bypass it?

Eight services. `quiz.service.js`, `rfid.service.js`, `emailReport.service.js`,
`admin.service.js` and `analytics.service.js` bypass it *into server-local or UTC*.
`founderDashboard.service.js`, `activeDevices.service.js` and
`jobs/usageSummaryNotification.js` bypass it *into their own hardcoded IST* — right
answer today, three more places to change tomorrow.

### 9. Why do Chat and Games reset at the expected IST time?

Because their day is named, not inherited. The chain, every link provable:
`resolveProgressScope` → `resolveTimezone(parent_profile.timezone)` → NULL →
`DEFAULT_TIMEZONE` → `process.env.DEFAULT_PARENT_TIMEZONE` unset → the literal
`'Asia/Kolkata'` at `timezone.js:44` →
`Intl.DateTimeFormat({timeZone:'Asia/Kolkata'})`. No process getter appears
anywhere on that path, so the host's zone cannot affect it. *Provided* the branch
carrying `timezone.js` is what is deployed — see §17.

### 10. Why does Quizzy Bee behave differently?

Because its day is inherited, not named. `new Date(); setHours(0,0,0,0)` asks the
process what midnight is, and on a UTC host the answer is 05:30 IST. It is the
only user-facing daily reset left on that mechanism, and its service has no route
to a timezone even if it wanted one.

### 11. Did the recent timezone change actually affect Quizzy Bee?

**No.** `quiz.service.js` is not in the commit. The gate at line 368 is unchanged.
The commit did change the parent app's quiz *analytics* default from UTC to IST —
which moved the reporting view further away from the engine rather than closer.
And the commit is not on `origin/main`, so on the deploy branch it has changed
nothing at all yet.

### 12. Are there any other components with the same potential bug?

Yes — nine, in three tiers:

- **Same defect, same severity:** Riddler (shares the file).
- **Same 05:30 shift by a different route:** game streaks, the per-MAC analytics
  time series.
- **Host-dependent, therefore undefined:** the daily email report window, RFID tap
  analytics, four admin device/user/session/token stat functions, four
  `analytics.service` "today"/"month" counts, and the OTA `server_time` block that
  hands the server's zone to every ESP32.

And a latent one that is not a timezone bug at all but will look like one: the
rollup writer buckets on the firmware clock while the detail endpoints bucket on
the ingest clock, so a drifted device can put the same event on two different days
in two adjacent screens.

---

<sub>Investigation only — no files were modified. Evidence base: `cheeko-backend` @ `bac20344` (branch `fix/timezone-mismatch`), compared against `origin/main` @ `e9775e1c`. 2026-08-21.</sub>
