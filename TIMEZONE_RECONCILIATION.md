# Timezone Reconciliation — Resolving the Apparent Contradiction

Follow-up to [`TIMEZONE_INVESTIGATION.md`](TIMEZONE_INVESTIGATION.md).
Investigation only. No code was modified. No fix is proposed.

| | |
|---|---|
| **Repository** | `cheeko-backend` |
| **Branch** | `fix/timezone-mismatch` @ `bac20344` |
| **Deploy branch** | `origin/main` @ `e9775e1c` |
| **Dated** | 2026-08-21 |

---

## 0. The short answer

The contradiction dissolves once one fact is accepted:

> **"Chat / Games / Progress / Analytics reset correctly at 00:00 IST" is not
> evidence about the server clock.** Those components never ask the server what
> time it is. They name `Asia/Kolkata` explicitly. They would reset at 00:00 IST
> on a UTC host, on an IST host, and on a host in Honolulu. Their correctness is
> therefore compatible with *every* hypothesis about the server timezone, and
> carries **zero information** about it.

That means the question "if the server is already IST, why do the others work?"
has a plain answer: **they do not work *because* the server is IST. They work
because they ignore the server.**

And it leaves the real question open, which is where the second finding lands:

> **`nextQuestions` computes `day_complete` but never acts on it.** The
> `questions` array is built before the day gate is evaluated and is returned in
> full regardless. There is no early return, no empty payload, no 4xx. So a
> child can be served a second batch of ten **even on a perfectly-configured IST
> server**, because nothing on the API side stops it.

**Therefore the reported symptom — "completed at 00:05 IST, given another quiz at
10:00 IST" — occurs under BOTH server-timezone hypotheses, by two different
mechanisms.** It cannot, on its own, prove the server is UTC. §11 gives the one
observable field that does distinguish them, and §17 gives a five-minute test.

---

## Contents

1. [What the change yesterday actually changed](#1-what-the-change-yesterday-actually-changed)
2. [The DEV server timezone](#2-the-dev-server-timezone)
3. [The PRODUCTION server timezone](#3-the-production-server-timezone)
4. [Chat](#4-chat)
5. [Games](#5-games)
6. [Progress](#6-progress)
7. [Analytics](#7-analytics)
8. [Quizzy Bee](#8-quizzy-bee)
9. [Riddler](#9-riddler)
10. [Direct comparison table](#10-direct-comparison-table)
11. [If the server IS IST, why would Quizzy fail?](#11-if-the-server-is-ist-why-would-quizzy-fail)
12. [The exact flow, 00:05 IST → 10:00 IST, both hypotheses](#12-the-exact-flow-0005-ist--1000-ist-both-hypotheses)
13. [TRUE or FALSE: "Quizzy uses UTC, the others use IST"](#13-true-or-false-quizzy-uses-utc-the-others-use-ist)
14. [Did the change alter the GLOBAL server timezone?](#14-did-the-change-alter-the-global-server-timezone)
15. [If the server IS IST — why Quizzy and Riddler still misbehave](#15-if-the-server-is-ist--why-quizzy-and-riddler-still-misbehave)
16. [If the server is NOT IST — how the others still reset at IST midnight](#16-if-the-server-is-not-ist--how-the-others-still-reset-at-ist-midnight)
17. [The decisive runtime test](#17-the-decisive-runtime-test)
18. [Confidence register](#18-confidence-register)

---

## 1. What the change yesterday actually changed

### The complete file list — nothing else was touched

```
$ git show --name-only --format="" bac20344
client.py
main/manager-api-node/.env.example
main/manager-api-node/docs/parent-app-progress-ring.md
main/manager-api-node/prisma/migrations/20260820000000_rollups_repair_kid/migration.sql
main/manager-api-node/src/services/deviceAnalytics.service.js
main/manager-api-node/src/services/mobile.service.js
main/manager-api-node/src/services/profile.service.js
main/manager-api-node/src/utils/timezone.js
main/manager-api-node/tests/unit/deviceAnalytics.service.test.js
main/manager-api-node/tests/unit/mobile.kid-chat-history.test.js
main/manager-api-node/tests/unit/mobile.service.test.js
main/manager-api-node/tests/unit/mobile.timezone-day-boundary.test.js
main/manager-api-node/tests/unit/timezone.test.js
```

Thirteen files. **Not one of them is an infrastructure file.** No `Dockerfile`, no
`docker-compose.yml`, no `ecosystem.config.js`, no `deploy/deploy.sh`, no
`.github/workflows/*`, no `package.json`, no `server.js`, no systemd unit, no
shell profile.

### Did it change the GLOBAL Node/server timezone?

**No. CONFIRMED — and deliberately so.** The commit's own `.env.example` block
says this in as many words:

```bash
# Which calendar day the analytics are bucketed into for a parent whose
# profile stores no timezone of its own. An IANA zone name — abbreviations
# ("IST") and offsets ("+05:30") are refused. A timezone stored on the parent
# profile always wins over this. Defaults to Asia/Kolkata.
# Note this is NOT the container clock: leave the TZ variable unset.
DEFAULT_PARENT_TIMEZONE=Asia/Kolkata
```
<sub>`main/manager-api-node/.env.example`, added by `bac20344`</sub>

`DEFAULT_PARENT_TIMEZONE` is **not** `TZ`. It is a plain application variable read
once at module load by `timezone.js:42`:

```js
const DEFAULT_TIMEZONE = isValidTimezone(process.env.DEFAULT_PARENT_TIMEZONE)
    ? process.env.DEFAULT_PARENT_TIMEZONE.trim()
    : 'Asia/Kolkata';
```

Setting it changes **which zone string gets passed to `Intl.DateTimeFormat`**. It
does not touch `process.env.TZ`, `/etc/localtime`, or anything the operating
system or the V8 runtime consults for `new Date().getHours()`.

### So what did it change?

It made **four specific application code paths** stop defaulting to the literal
string `'UTC'` and start defaulting to the literal string `'Asia/Kolkata'`:

| Location | Before (`origin/main`) | After (`bac20344`) |
|---|---|---|
| `deviceAnalytics.service.js:339` | `let timezone = 'UTC';` | `let timezone = resolveTimezone(null);` |
| `deviceAnalytics.service.js:345` | `timezone = profile?.timezone \|\| 'UTC';` | `timezone = resolveTimezone(profile?.timezone);` |
| `deviceAnalytics.service.js:69` | private `formatDateInTimezone(v, timezone = 'UTC')` | deleted; imports the shared util |
| `mobile.service.js:2446` | `timezone: user.parent_profile?.timezone \|\| 'UTC'` | `timezone: resolveTimezone(user.parent_profile?.timezone)` |
| `mobile.service.js:2490–2496` | `let timezone = 'UTC'; … \|\| 'UTC'` | `resolveTimezone(...)` |
| `mobile.service.js:155` | private `formatDateInTimezone(v, timezone = 'UTC')` | deleted; imports the shared util |
| `profile.service.js:361` | `target.timezone = data.timezone` (unvalidated) | validated with `isValidTimezone`, 400 on bad input |
| new | — | `mobile.service.js:4038–4062` chat-by-date bounded with `startOfDayInstant` |

**Verdict on Q1 — CONFIRMED:** the change was purely application-level. It made
individual components use an explicit `Asia/Kolkata` timezone utility. It did not
and could not change the server's clock, and its own documentation instructs the
reader **not** to change the server's clock.

---

## 2. The DEV server timezone

### What the repository identifies

| Fact | Evidence |
|---|---|
| The dev box is `64.227.170.31` | `docs/gateway-capacity-and-hardening.md:175` — "Harness lives on the dev box (`64.227.170.31`)" |
| It runs the manager API with a rate limit of 1000 req/15 min | same file, line ~185 — "dev's manager-api rate limit (1000 req/15 min) throttles OTA" |
| Nothing in the repository sets `TZ` for it | repo-wide search for `ENV TZ`, `TZ=`, `TZ:`, `process.env.TZ` returns **zero** matches |
| The local `.env` (which points at the **prod** Supabase project) sets no `TZ` and no `DEFAULT_PARENT_TIMEZONE` | `main/manager-api-node/.env` — contains `PORT`, `NODE_ENV=development`, `HOST=0.0.0.0`, `SUPABASE_*`, `DATABASE_URL` (project `cohtfpenuqwxawtcbdji`, `aws-0-ap-south-1`), and no timezone key of any kind |

### Verdict

**UNKNOWN FROM REPOSITORY.** The dev host's operating-system timezone is not
represented anywhere in this repository, and the application never overrides it.

This is not a new gap. The team's own analytics plan, written months before this
investigation, flags the same unknown and prescribes the same check:

> ### ⚠️ Timezone landmine in the existing RFID endpoints
>
> `buildSummaryDateRange()` in `rfid.service.js` builds its range with `new Date()`
> + `setHours(0,0,0,0)` — i.e. **server-local time, not explicit IST**. If the API
> server runs in UTC (typical for Docker/Linux), date-scoped calls to
> `tap-logs` / `tap-analytics/summary` will reproduce exactly the bug from
> Constraint 2 (a day with 34 taps reporting 0).
>
> **Therefore:** for anything date-scoped, use the **explicit-IST raw SQL in Task 1**.
> Only use `tap-logs` for un-scoped or already-verified ranges. **Before trusting it,
> run: `date` on the API host, or `SELECT current_setting('TIMEZONE')`.**
<sub>`main/ACTIVE_DEVICES_ANALYTICS_PLAN.md:44–52`</sub>

The same document records, as a **verified fact from live production data**:

> **All date filtering must be in IST (`Asia/Kolkata`), not UTC.**
> A UTC-day query returned 0 taps for a day that actually had 34.
<sub>`main/ACTIVE_DEVICES_ANALYTICS_PLAN.md:19–21`</sub>

That observation proves a UTC *day boundary* produced wrong answers against real
production rows. It does **not** by itself prove the Node process's timezone,
because that query was explicit SQL, not `new Date()`. It is corroborating, not
decisive. **HIGH CONFIDENCE that the team has already been bitten by a non-IST
day boundary in production. UNKNOWN whether the mechanism was the process clock.**

---

## 3. The PRODUCTION server timezone

### How the Node API actually runs in production

```bash
ROOT=/opt/cheeko-backend/main
cd /opt/cheeko-backend
git fetch origin main
git reset --hard origin/main
cd "$ROOT/manager-api-node"
npm ci --omit=dev || npm install --omit=dev
npx prisma generate
npx prisma migrate deploy || echo "WARN: prisma migrate deploy failed"
pm2 startOrReload /opt/ecosystem.config.js --only manager-api --update-env
```
<sub>`deploy/deploy.sh`, invoked over SSH by `.github/workflows/deploy.yml` on push to `main`</sub>

| Question | Answer | Status |
|---|---|---|
| Does Node inherit the host OS timezone? | **Yes.** Node reads `process.env.TZ` if set, otherwise the OS zone. The app never sets it. | CONFIRMED |
| Is it Docker? | **No, not for `manager-api-node`.** It is a bare PM2 process on `139.59.7.72` (`root@`, `/opt/cheeko-backend`). | CONFIRMED |
| Does PM2 inject a TZ? | `/opt/ecosystem.config.js` is **outside the repository**. The in-repo `ecosystem.config.js` has exactly one `env` block (`NODE_ENV: "development"`, on `livekit-react-cheeko`) and no `TZ` — and points at a stale path `/root/xiaozhi-esp32-server/...` that `deploy.sh` does not use. | UNKNOWN (in-repo copy: no TZ, CONFIRMED) |
| Kubernetes / Helm? | **None exists** in this repository. | CONFIRMED |
| Does CircleCI deploy this API? | **No.** `.circleci/config.yml` builds `main/manager-api` — the **Java Spring Boot** API with MySQL (`SPRING_PROFILES_ACTIVE=prod`, `MYSQL_HOST`, …). `manager-api-node` appears nowhere in it. That pipeline sets no `TZ` either. | CONFIRMED |
| Would the Docker path be UTC? | **Yes** — `node:20-alpine`, no `tzdata`, no `ENV TZ`, no `/etc/localtime`. But this image is not what serves production. | CONFIRMED |
| Is `DEFAULT_PARENT_TIMEZONE` set in production? | Introduced only in `.env.example` by the **undeployed** commit. The production `.env` is outside the repo. | UNKNOWN (LIKELY unset) |

### Verdict

**Production process timezone = UNKNOWN FROM REPOSITORY.** It is the host OS zone
of `139.59.7.72`, and no artefact in this repository records it.

Three commands settle it:

```bash
ssh root@139.59.7.72 'timedatectl'
ssh root@139.59.7.72 'pm2 env $(pm2 id manager-api | tr -d "[] ")'
ssh root@139.59.7.72 'node -e "console.log(process.env.TZ, Intl.DateTimeFormat().resolvedOptions().timeZone, new Date().getTimezoneOffset())"'
```

---

## 4. Chat

### Reset boundary calculation, traced

```js
// mobile.service.js:2440–2493
resolveProgressScope(firebaseUid)
  → prisma.sys_user.findUnique({ select: { id, parent_profile: { select: { timezone } } } })
  → timezone: resolveTimezone(user.parent_profile?.timezone)

// utils/timezone.js:47–49
resolveTimezone(value) → isValidTimezone(value) ? value.trim() : DEFAULT_TIMEZONE

// utils/timezone.js:42–44
DEFAULT_TIMEZONE = isValidTimezone(process.env.DEFAULT_PARENT_TIMEZONE)
                     ? process.env.DEFAULT_PARENT_TIMEZONE.trim()
                     : 'Asia/Kolkata'

// mobile.service.js:4038–4062
if (startDate) filter.gte = startOfDayInstant(startDate, timezone);
if (endDate)   filter.lt  = endOfDayInstantExclusive(endDate, timezone);

// utils/timezone.js:130–135 → zoneOffsetMs → Intl.DateTimeFormat('en-US', { timeZone, hourCycle:'h23', … })
```

| | |
|---|---|
| **Timezone** | Explicit `Asia/Kolkata` |
| **Source** | `parent_profile.timezone` (NULL on every live account) → `DEFAULT_PARENT_TIMEZONE` (unset) → **hardcoded literal at `timezone.js:44`** |
| **Server-local or explicit?** | **Explicit.** `Intl.DateTimeFormat({ timeZone })` never consults the process clock. |
| **Where computed** | Node computes the instants; PostgreSQL performs the `gte`/`lt` comparison |
| **Expected reset in IST** | **00:00 IST** |
| **Depends on server TZ?** | **No.** |

Chat has no daily limit and no daily counter of its own; a repo-wide search for
`daily_limit`, `dailyLimit`, `daily_quota`, `usage_limit`, `screen_time` across
`main/` returns nothing. Its only day-sensitive behaviour is the date-filtered
session list above, plus the `ai_talk_end` → `device_ai_interactions_daily`
rollup, which is bucketed by the same explicit zone (§7).

---

## 5. Games

Two independent paths, both explicit.

**Projected count** — `device_games_played` rows are counted by `activity_date`,
a `@db.Date` column written by the rollup writer:

```js
// deviceAnalytics.service.js:345–348
const eventInstant    = eventTime(rawEventRow) || new Date();
const activityDateKey = formatDateInTimezone(eventInstant, timezone) || dateKeyUtc(eventInstant);
const activityDate    = toDateOnlyValue(activityDateKey);
```

**Raw fallback** — when the projected count is 0:

```js
// mobile.service.js:220–237
const rows = await prisma.device_analytics_event.findMany({
  where: { ...progressOwnerFilter(scope), event_name: 'game_start',
           server_received_at: rangeInstantWindow(range) },
  select: { server_received_at: true },
});
return rows.filter(row => rangeContainsDateKey(
  range, formatDateInTimezone(row.server_received_at, scope.timezone)
)).length;
```

| | |
|---|---|
| **Timezone** | Explicit `Asia/Kolkata` |
| **Source** | Same chain as Chat |
| **Server-local or explicit?** | **Explicit** |
| **Expected reset in IST** | **00:00 IST** |
| **Depends on server TZ?** | **No** |

Note: `new Date()` *does* appear at `deviceAnalytics.service.js:345`, but only as
a fallback **instant** when the row carries no timestamp. It is immediately handed
to `formatDateInTimezone(..., timezone)`, which applies the named zone. An
instant has no timezone; only the getter applied to it does.

Nothing in `livekit-server` or `mqtt-gateway` computes a game day. The Python game
workers track in-session streaks in memory (`src/utils/helpers.py:312–367`) with
no date arithmetic at all.

---

## 6. Progress

```js
// mobile.service.js:268–295
function buildProgressDateRange(period, timezone, now = new Date()) {
    const today = formatDateInTimezone(now, timezone);   // ← named zone applied here
    …
    dates.push(shiftDateKey(today, -i));
}
```

`now` is an instant. `formatDateInTimezone` resolves it against the named zone.
The range is then a list of date **keys** (`"2026-08-21"`), and the SQL compares
`@db.Date` columns that were themselves written from parent-zone date keys.

| | |
|---|---|
| **Timezone** | Explicit `Asia/Kolkata` |
| **Source** | `scope.timezone` from `resolveProgressScope` |
| **Server-local or explicit?** | **Explicit** |
| **Expected reset in IST** | **00:00 IST** |
| **Depends on server TZ?** | **No** |

Covers `getProgressSummary`, `getProgressTrend`, `getProgressDetails`,
`getHomepageActivity`, `getHomepageActivityDetails`.

---

## 7. Analytics

The rollup writer is where the analytics day is decided:

```js
// deviceAnalytics.service.js:317–330
let timezone = resolveTimezone(null);                    // → 'Asia/Kolkata'
if (device?.user_id != null) {
  const profile = await prisma.parent_profile.findUnique({ …, select: { timezone: true } });
  timezone = resolveTimezone(profile?.timezone);
}
```

| | |
|---|---|
| **Timezone** | Explicit `Asia/Kolkata` |
| **Source** | `parent_profile.timezone` → default |
| **Server-local or explicit?** | **Explicit** |
| **Expected reset in IST** | **00:00 IST** |
| **Depends on server TZ?** | **No** |

Two analytics surfaces are **not** on this path and remain UTC regardless of the
server clock — `getAnalyticsTimeSeriesByMac` (`deviceAnalytics.service.js:730`,
via `dateKeyUtc`) and `logStreak` (`analytics.service.js:404–407`, via
`Date.UTC(getUTC*)`). Those cut at 05:30 IST on every host.

---

## 8. Quizzy Bee

### The reset boundary

```js
// quiz.service.js:368–372
const startOfDay = new Date();
startOfDay.setHours(0, 0, 0, 0);            // ← process clock, no zone named
const todayRows = await tables.answers.findMany({
  where: { ...scope, answered_at: { gte: startOfDay } },
  select: { question_id: true }
});
const answeredToday = todayRows.length;

// quiz.service.js:390–391
const dayComplete = answeredToday >= DAILY_QUESTION_TARGET
  || levelCompletedToday(bank, clearedIds, todayRows.map((r) => String(r.question_id)));
```

And the second, independent day key used by the anti-trap:

```js
// quiz.service.js:221–224
const dayKey = (value) => {
  const d = new Date(value);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;   // ← process clock
};
```

| | |
|---|---|
| **Timezone** | **Server-local — whatever the host OS says** |
| **Source** | The Node process's TZ. Not `parent_profile`, not a request parameter, not a constant. |
| **Server-local or explicit?** | **Server-local** |
| **Expected reset in IST** | **00:00 IST if the host is `Asia/Kolkata`; 05:30 IST if the host is UTC.** Undefined from the repository. |
| **Depends on server TZ?** | **Yes — entirely.** |

### It cannot reach a timezone even if it wanted one

```js
// quiz.service.js:43–70
const resolveDeviceContext = async (deviceMac) => {
  const device = await prisma.ai_device.findUnique({
    where: { mac_address: normalizedMac }, select: { kid_id: true }
  });
  const kid = device?.kid_id
    ? await prisma.kid_profile.findUnique({
        where: { id: device.kid_id }, select: { birth_date: true, language: true }
      })
    : null;
  return { profileMissing, language, kidId, deviceMac };
};
```

No join to `sys_user`. No read of `parent_profile`. And the route accepts no zone:

```js
// quiz.routes.js:57–71
router.get('/next-questions', requireServiceKey, asyncHandler(async (req, res) => {
  const deviceMac = String(req.query.device_mac || '').trim();
  const bank = await bankForCharacterRef({ character: req.query.character,
                                           characterId: req.query.character_id });
  const batch = await quizService.nextQuestions(deviceMac, bank);
  return success(res, { ...batch, bank });
}));
```

**Parameters accepted: `device_mac`, `character`, `character_id`. That is all.**

---

## 9. Riddler

Riddler is **the same code**. `banks.js` maps character → table pair only:

```js
const BANKS = {
  quiz:   { questions: prisma.quiz_question,   answers: prisma.quiz_question_answer,
            answerTable: 'quiz_question_answer',   subject: 'quiz',   label: 'QUIZ',
            clearOnReveal: false },
  riddle: { questions: prisma.riddle_question, answers: prisma.riddle_question_answer,
            answerTable: 'riddle_question_answer', subject: 'riddle', label: 'RIDDLE',
            clearOnReveal: true },
};
const CHARACTER_BANK = { quiz_master: 'quiz', riddle_master: 'riddle' };
```

`nextQuestions`, `recordAnswer`, `dayKey`, `startOfDay`, `levelCompletedToday`,
`clearDayGate` — every one of them is shared. The only behavioural difference is
`clearOnReveal`, which changes what counts as *cleared*, not what counts as *today*.

| | |
|---|---|
| **Timezone** | **Server-local** — identical to Quizzy Bee |
| **Expected reset in IST** | Identical to Quizzy Bee |
| **Depends on server TZ?** | **Yes** |

Riddler additionally has 80 questions per level (vs 10), so `idsForLevel` caps at
`DAILY_QUESTION_TARGET` and a level is far harder to clear in one sitting —
meaning `levelCompletedToday` fires much less often for Riddler, and its
`day_complete` is driven almost entirely by the `answered_today >= 10` arm.

---

## 10. Direct comparison table

| Component | Function | Date calculation | Timezone source | Server-local or explicit | Expected reset in IST |
|---|---|---|---|---|---|
| **Chat** — sessions by date | `parseSessionDateWindow` (`mobile.service.js:4038`) | `startOfDayInstant(key, tz)` / `endOfDayInstantExclusive(key, tz)` → `Intl` offset probe | `parent_profile.timezone` → `DEFAULT_PARENT_TIMEZONE` → `'Asia/Kolkata'` | **Explicit** | **00:00 IST** |
| **Chat** — AI interaction counter | `applyProjectionForEvent` (`deviceAnalytics.service.js:347`) | `formatDateInTimezone(instant, tz)` | same chain | **Explicit** | **00:00 IST** |
| **Games** — played today (projected) | `getProgressSummary` (`mobile.service.js:2611`) | `date` between `dateOnlyFromKey(start)` and `…(end)`, rows written by `formatDateInTimezone` | same chain | **Explicit** | **00:00 IST** |
| **Games** — played today (raw) | `countRawGameStartsForRange` (`mobile.service.js:220`) | widen window, then `formatDateInTimezone` per row | same chain | **Explicit** | **00:00 IST** |
| **Progress** — summary / trend / details | `buildProgressDateRange` (`mobile.service.js:268`) | `formatDateInTimezone(now, tz)` + `shiftDateKey` | same chain | **Explicit** | **00:00 IST** |
| **Analytics** — rollup writer | `applyProjectionForEvent` (`deviceAnalytics.service.js:347`) | `formatDateInTimezone(instant, tz)` | same chain | **Explicit** | **00:00 IST** |
| **Analytics** — per-MAC time series | `getAnalyticsTimeSeriesByMac` (`deviceAnalytics.service.js:730`) | `dateKeyUtc` = `toISOString().slice(0,10)` | hardcoded UTC | **Explicit UTC** | **05:30 IST** |
| **Analytics** — streaks | `logStreak` (`analytics.service.js:404–407`) | `Date.UTC(getUTCFullYear, getUTCMonth, getUTCDate)` | hardcoded UTC | **Explicit UTC** | **05:30 IST** |
| **Quizzy Bee** — Daily Ten gate | `nextQuestions` (`quiz.service.js:368`) | `new Date()` + `setHours(0,0,0,0)` | **host OS clock** | **Server-local** | **00:00 IST if host=IST · 05:30 IST if host=UTC** |
| **Quizzy Bee** — anti-trap day key | `dayKey` (`quiz.service.js:221`) | `getFullYear/getMonth/getDate` | **host OS clock** | **Server-local** | same |
| **Quizzy Bee** — admin console | `allDeviceProgress` (`quiz.service.js:881`) | `new Date()` + `setHours(0,0,0,0)` | **host OS clock** | **Server-local** | same |
| **Quizzy Bee** — admin Reset day | `clearDayGate` (`quiz.service.js:1058`) | `new Date()` + `setHours(0,0,0,0)` | **host OS clock** | **Server-local** | same |
| **Riddler** — all four | shared with Quizzy Bee | identical | **host OS clock** | **Server-local** | same |
| **Quiz analytics (parent app)** | `buildQuizAnalyticsForScope` (`mobile.service.js:3723`) | `formatDateInTimezone(answered_at, tz)` | `parent_profile.timezone` → default | **Explicit** | **00:00 IST** |
| **Founder dashboard** | `todayIstKey` (`founderDashboard.service.js:111`) | `IST_DAY_FORMATTER.format(...)` | hardcoded `'Asia/Kolkata'` | **Explicit** | **00:00 IST** |
| **Active devices** | `listActiveDevices` (`activeDevices.service.js:30`) | `(col AT TIME ZONE 'Asia/Kolkata')::date` | hardcoded, in SQL | **Explicit** | **00:00 IST** |
| **Usage summary push** | `startOfDayIST` (`jobs/usageSummaryNotification.js:29`) | `new Date(ref.getTime() + 5.5*3600*1000)` | hardcoded fixed offset | **Explicit** | **00:00 IST** |
| **Daily email report** | `generateReportData` (`emailReport.service.js:107`) | `setHours(0,0,0,0)` / `setHours(23,59,59,999)` | **host OS clock** | **Server-local** | host-dependent |
| **RFID tap analytics** | `parseDateInput`, `buildTapTrendDays` (`rfid.service.js:83, 297`) | `setHours(0,0,0,0)`; UTC labels | **host OS clock** + hardcoded UTC | **Mixed** | host-dependent |
| **Agent "what day is it"** | `_get_current_time_info` (`prompt_manager.py:137`) | `datetime.now(pytz.timezone('Asia/Kolkata'))` | hardcoded IST | **Explicit** | **00:00 IST** |

**Read the "Server-local or explicit" column.** Every component the user reports
as working is **Explicit**. Every component reported as broken is **Server-local**.
That is a perfect split, and it holds no matter what the server clock is.

---

## 11. If the server IS IST, why would Quizzy fail?

This is the crux, and the answer is **yes — there is other logic, and it is
sufficient on its own.**

### Finding A — `nextQuestions` never enforces `day_complete`

Read the order of operations in `nextQuestions` (`quiz.service.js:252–424`):

```js
// 1. Level state and the payload are built FIRST — lines 274–312
const state = deriveLevelState(bank.map(q => ({ id: q.id, level: q.level })), clearedIds, agedOut);
let level  = state.currentLevel;
let selectedIds = idsForLevel(level);              // ← the 10 questions are chosen HERE

// 2. …then, 56 lines later, the day gate is evaluated — lines 368–391
const startOfDay = new Date();
startOfDay.setHours(0, 0, 0, 0);
const todayRows    = await tables.answers.findMany({ where: { ...scope, answered_at: { gte: startOfDay } }, … });
const answeredToday = todayRows.length;
const dayComplete   = answeredToday >= DAILY_QUESTION_TARGET || levelCompletedToday(...);

// 3. …and the payload is returned in full REGARDLESS — lines 393–423
return {
  …,
  answered_today: answeredToday,
  day_complete:   dayComplete,          // ← a FLAG, not a gate
  questions: [
    ...selectedIds.map(id => byId.get(String(id))).filter(Boolean).map(toQuestion),
    ...bank.filter(q => bonus.has(String(q.id))).map(q => ({ ...toQuestion(q), bonus: true }))
  ]
};
```

**There is no `if (dayComplete) return { …, questions: [] }`.** There is no early
return, no 409, no empty array. `selectedIds` is computed before `dayComplete`
exists and is never re-consulted after it does.

The route confirms the contract:

```
*       200:
*         description: Question batch (questions may be empty when the bank has
*                      no content for the band)
```
<sub>`quiz.routes.js:51–53` — the **only** documented reason for an empty payload</sub>

And the commit that introduced the field states the design intent explicitly:

```
feat(quiz): return answered_today and day_complete from next-questions

The worker needs the day-gate as a fact from the log; the model cannot be
trusted to derive it while restored transcripts claim the day is finished.
```
<sub>`b369713c`, 2026-08-04</sub>

**Enforcement was deliberately placed in the LiveKit worker**, which is not in
this repository. **CONFIRMED.**

### Finding B — nothing tests or documents `day_complete`

```
$ grep -rn "day_complete\|dayComplete\|answered_today" tests/unit/*.test.js
(no matches)

$ grep -rn "day_complete" --include="*.md" <repo root>
(no matches)
```

Zero tests. Zero specification. The only in-repo consumer is a display string in
the admin console (`main/admin-dashboard/public/test.js:517`). A regression in
worker-side enforcement would produce no failing test anywhere. **CONFIRMED.**

### Finding C — level progression actively supplies the next batch

`deriveLevelState` is recomputed from the lifetime answer log on **every** call
(`quiz.logic.js:29–52`). The moment level *N* is fully cleared it is skipped, and
`currentLevel` becomes *N+1*:

```js
for (const level of levels) {
  if (skipLevels.has(level)) continue;
  const uncleared = questions.filter(q => q.level === level && !clearedIds.has(String(q.id)));
  if (uncleared.length) return { currentLevel: level, unclearedIds: …, allCleared: false };
}
```

Then `idsForLevel(N+1)` returns ten fresh, never-seen questions
(`quiz.service.js:307–312`). The code's own comment says this is exactly what
`levelCompletedToday` exists to prevent:

```js
// Finishing a level also ends the scored day: the Daily Ten is a cap, not a
// quota. Without this, a level finished on question 6 pulled 4 questions
// from the next level the same day just to reach ten.
```
<sub>`quiz.service.js:386–388`</sub>

But `levelCompletedToday` only sets `dayComplete`. It does not touch
`selectedIds`. **The prevention was never wired to the payload. CONFIRMED.**

### Finding D — the payload is never empty, in any state

| Child's state at the second request | `currentLevel` | `idsForLevel` returns | Questions in payload |
|---|---|---|---|
| Cleared level *N* completely | *N+1* | 10 fresh from *N+1* | **10** |
| Answered 10 but did not clear *N* (`clearOnReveal:false` — only `correct` clears) | *N* | outstanding-first, then cleared-as-practice, capped at 10 | **10** |
| Cleared every level in the bank | `null` → `replay = true` → `leastRecentlyPlayedLevel` | that level's full set | **10** |

There is no path through `nextQuestions` that returns an empty batch for a
completed day. **CONFIRMED.**

### Finding E — `levelCompletedToday` can fire after a single answer

```js
const levelCompletedToday = (questions, clearedIds, todayQuestionIds) => {
  const levelById  = new Map(questions.map(q => [String(q.id), q.level]));
  const todayLevels = new Set(todayQuestionIds.map(id => levelById.get(String(id))).filter(l => l !== undefined));
  return [...todayLevels].some(level => questions.every(q => q.level !== level || clearedIds.has(String(q.id))));
};
```
<sub>`quiz.logic.js:129–137`</sub>

`clearedIds` is the **lifetime** cleared set, not today's. One practice answer on
a level cleared weeks ago makes `todayLevels = {thatLevel}`, and every question in
it is already in `clearedIds` → `day_complete = true` after **one** question.
Harmless while nothing enforces the flag; a live bug the moment something does.
**CONFIRMED.**

### Finding F — `answered_today` is counted over a different row set than everything else

The main read is bank-filtered; the day-gate read is not:

```js
// line 260 — bank-filtered
const answerRows = (await tables.answers.findMany({ where: scope, … }))
  .filter((row) => bankIds.has(String(row.question_id)));

// line 370 — NOT bank-filtered
const todayRows = await tables.answers.findMany({
  where: { ...scope, answered_at: { gte: startOfDay } }, select: { question_id: true }
});
```

An answer to a question since deactivated, or in another language, counts toward
`answered_today` but not toward clearing. Minor, but it means `answered_today`
and `levels cleared` are not derived from the same population. **CONFIRMED, minor.**

### Finding G — two independent day keys in one file

`dayKey` (`:221`, for the anti-trap) and `startOfDay` (`:368`, for the gate) are
separate implementations. Both are server-local, so they agree with **each
other** — the file's own comment says that was the point:

```js
/**
 * Server-local midnight day key. The same boundary the Daily Ten gate uses —
 * two definitions of "day" in one file would eventually disagree by one, and
 * the disagreement shows up as a child gaining or losing a day.
 */
```
<sub>`quiz.service.js:216–220`</sub>

They agree with each other and with nothing else in the system. **CONFIRMED.**

### Finding H — the admin "Reset day" button slides the entire log back 24h

```js
const clearDayGate = async (deviceMac, bankName = DEFAULT_BANK) => {
  …
  const moved = context.kidId
    ? await prisma.$executeRawUnsafe(
        `UPDATE ${tables.answerTable} SET answered_at = answered_at - INTERVAL '1 day' WHERE kid_id = $1`,
        context.kidId)
    : …;
```
<sub>`quiz.service.js:1055–1090`, route `POST /quiz/admin/reset-day` (`requireAuth`)</sub>

If this was pressed during testing, every answer in the log moved back a day and
the gate reopened — a human action producing exactly the reported symptom, with
no timezone involvement. Worth ruling in or out from the API logs
(`[QUIZ] admin reset-day device=… backdated=N`). **CONFIRMED as a mechanism;
UNKNOWN whether it occurred.**

### Ruled OUT

| Hypothesis | Verdict |
|---|---|
| Completion stored under a different date | **No.** Nothing is stored. There is no `day_complete` column, no session row, no daily-quiz table. Everything is derived from `quiz_question_answer` on every call. |
| Response caching / stale reads | **No.** No cache middleware on `/quiz/*`; `app.js` has `helmet` and `express-rate-limit` only. |
| `recordAnswer` writing a wrong date | **No.** It omits `answered_at`; the column default is `TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP` — an absolute instant. |
| `kid_learning_progress` gating anything | **No.** `recordLevelMilestone` writes it for the dashboard; no read path gates on it. |
| Prisma / PostgreSQL day arithmetic | **No.** Every column involved is `timestamptz`; India has no DST, so `INTERVAL '1 day'` is exact. |

---

## 12. The exact flow, 00:05 IST → 10:00 IST, both hypotheses

**Scenario.** Parent zone `Asia/Kolkata` (NULL on the profile → default).
Child completes ten Quizzy questions at **00:05 IST on 2026-08-21**, clearing
level *N*. Toy requests a new batch at **10:00 IST the same morning**.

**Instants (identical under both hypotheses — an instant has no timezone):**

```
answer written  00:05 IST 2026-08-21  =  2026-08-20T18:35:00Z
request made    10:00 IST 2026-08-21  =  2026-08-21T04:30:00Z
```

### Hypothesis A — host TZ = `Asia/Kolkata`

| Value | Result |
|---|---|
| `new Date()` (line 368) | instant `2026-08-21T04:30:00Z`, wall `10:00 IST` |
| `.setHours(0,0,0,0)` | wall `00:00 IST 21 Aug` → instant **`2026-08-20T18:30:00Z`** |
| `answered_at` of the ten rows | `2026-08-20T18:35:00Z` |
| `18:35Z >= 18:30Z` ? | **Yes — all ten counted** |
| `answered_today` | **10** |
| `levelCompletedToday` | **true** (level *N* fully in `clearedIds`) |
| `day_complete` | **true** |
| `dayKey(18:35Z)` | `"2026-7-21"` (0-based month) — same IST day |
| `deriveLevelState` | level *N* cleared → `currentLevel = N+1` |
| `idsForLevel(N+1)` | ten fresh questions from level *N+1* |
| HTTP response | **200, `questions: [10 items]`, `day_complete: true`, `answered_today: 10`** |
| Child gets a second quiz? | **YES — if the worker ignores `day_complete`.** The API offered the questions. |

### Hypothesis B — host TZ = `UTC`

| Value | Result |
|---|---|
| `new Date()` (line 368) | instant `2026-08-21T04:30:00Z`, wall `04:30 UTC` |
| `.setHours(0,0,0,0)` | wall `00:00 UTC 21 Aug` → instant **`2026-08-21T00:00:00Z`** (= 05:30 IST) |
| `answered_at` of the ten rows | `2026-08-20T18:35:00Z` |
| `18:35Z >= 00:00Z 21 Aug` ? | **No — all ten excluded** |
| `answered_today` | **0** |
| `levelCompletedToday([])` | **false** (no `todayQuestionIds`) |
| `day_complete` | **false** |
| `dayKey(18:35Z)` | `"2026-7-20"` — filed under the **previous** day |
| `deriveLevelState` | identical → `currentLevel = N+1` |
| `idsForLevel(N+1)` | ten fresh questions from level *N+1* |
| HTTP response | **200, `questions: [10 items]`, `day_complete: false`, `answered_today: 0`** |
| Child gets a second quiz? | **YES — guaranteed.** The API affirmatively reports a fresh day. |

### What this proves

| | A (host IST) | B (host UTC) |
|---|---|---|
| Chat / Games / Progress / Analytics reset at 00:00 IST | ✅ | ✅ |
| Quizzy's `startOfDay` is IST midnight | ✅ | ❌ (05:30 IST) |
| `questions` array returned in full | ✅ | ✅ |
| **Reported symptom reproduces** | **✅** | **✅** |
| `answered_today` observed at 10:00 IST | **10** | **0** |
| `day_complete` observed at 10:00 IST | **true** | **false** |

**The symptom is identical under both. The two response fields are not.**

---

## 13. TRUE or FALSE: "Quizzy uses UTC, the others use IST"

> "Quizzy Bee is broken because it uses UTC while all the other components use IST."

### **FALSE as stated.** Two independent reasons.

**Reason 1 — "uses UTC" is not what the code says.**

There are three distinct things, and the statement collapses two of them:

| | Meaning | Where it appears | Depends on host? |
|---|---|---|---|
| **Server-local** | `new Date()` + `setHours`/`getHours`/`getDate`/`getMonth`/`getFullYear`. Resolves to `process.env.TZ` if set, else the host OS zone. | `quiz.service.js:221, 368, 881, 1058`; `rfid.service.js`; `emailReport.service.js`; `admin.service.js`; four functions in `analytics.service.js` | **Yes** |
| **Explicit UTC** | `toISOString()`, `getUTC*`, `Date.UTC(...)`. Always UTC, on every host. | `analytics.service.js:406`; `deviceAnalytics.service.js:252`; `admin.service.js` groupings; `timezone.js:84` (`dateOnlyKey`, correct there) | **No** |
| **Explicit `Asia/Kolkata`** | `Intl.DateTimeFormat({ timeZone: 'Asia/Kolkata' })`, `AT TIME ZONE 'Asia/Kolkata'`, `+05:30` literals, `pytz.timezone('Asia/Kolkata')` | `timezone.js`; `founderDashboard.service.js`; `activeDevices.service.js`; `usageSummaryNotification.js`; LiveKit agent | **No** |

Quizzy Bee is in row 1, **not** row 2. It becomes UTC-equivalent *only if the host
happens to be UTC*, which the repository does not establish. Calling it "UTC" states
a runtime conclusion as if it were a code fact.

**Reason 2 — even with a correct boundary, the symptom persists.**

Under Hypothesis A the boundary is exactly right and the API still hands back ten
questions (§11 Finding A, §12). A statement that attributes the symptom solely to
UTC would predict the symptom disappears on an IST host. **It would not.**

### The accurate statement

> Quizzy Bee's and Riddler's day boundary is **undefined by the repository** — it
> is whatever the host OS clock says, because they are the only user-facing daily
> features that never name a timezone. Every other daily component names
> `Asia/Kolkata` explicitly and is therefore correct on any host.
>
> **Separately and independently**, `nextQuestions` computes `day_complete` but
> never acts on it: the question payload is assembled before the gate is
> evaluated and is returned in full regardless. Enforcement was placed in the
> LiveKit worker, which is not in this repository and is covered by no test.
>
> Either defect alone reproduces the reported symptom. Which one is active in
> production is settled by the value of `answered_today`.

---

## 14. Did the change alter the GLOBAL server timezone?

### **No. CONFIRMED.**

| Check | Result |
|---|---|
| Files in `bac20344` | 13 — see §1. Zero infrastructure files. |
| `Dockerfile` modified? | No |
| `docker-compose.yml` modified? | No |
| `ecosystem.config.js` modified? | No |
| `deploy/deploy.sh` modified? | No |
| `.github/workflows/*` modified? | No |
| `package.json` / `server.js` modified? | No |
| `process.env.TZ` assigned anywhere in the repo? | **No** — repo-wide search returns zero matches, before *and* after the commit |
| `ENV TZ` / `TZ=` / `TZ:` in any Dockerfile, compose file or workflow? | **No** — zero matches |
| Does `DEFAULT_PARENT_TIMEZONE` affect the process clock? | **No.** It is read at `timezone.js:42` and used only as a string argument to `Intl.DateTimeFormat`. |
| Does the commit say anything about the server clock? | **Yes, and it says do not touch it:** `# Note this is NOT the container clock: leave the TZ variable unset.` |

### What it did change, precisely

It replaced the literal `'UTC'` with the literal `'Asia/Kolkata'` as the
**application-level default zone name** in four code paths (§1 table), and added
`src/utils/timezone.js` to hold that decision in one place.

Everything on the server-local mechanism — Quizzy Bee, Riddler, RFID analytics,
the daily email report, four admin stat functions, the OTA `server_time` block —
was untouched and behaves exactly as it did the day before.

### And it is not deployed

```
$ git branch -a --contains bac20344
* fix/timezone-mismatch
  remotes/origin/fix/timezone-mismatch

$ git cat-file -e origin/main:main/manager-api-node/src/utils/timezone.js
fatal: path 'main/manager-api-node/src/utils/timezone.js' exists on disk, but not in 'origin/main'

$ git show origin/main:.../deviceAnalytics.service.js | grep "timezone = "
69:  function formatDateInTimezone(value, timezone = 'UTC') {
339:   let timezone = 'UTC';
345:   timezone = profile?.timezone || 'UTC';
```

`deploy/deploy.sh` runs `git reset --hard origin/main`. **CONFIRMED in repo;
whether production is actually on `origin/main` is UNKNOWN and should be checked
with `git -C /opt/cheeko-backend rev-parse HEAD`.**

> **This matters to the premise.** If production really is on `origin/main`, then
> the parent-facing analytics are *still* defaulting to `'UTC'` there, and would
> reset at 05:30 IST — not at midnight. If Chat/Games/Progress/Analytics are
> genuinely observed resetting at 00:00 IST in the environment that was tested,
> then that environment is running `fix/timezone-mismatch`, not `origin/main`.
> Establishing which environment the observation came from is a prerequisite for
> everything else.

---

## 15. If the server IS IST — why Quizzy and Riddler still misbehave

Under Hypothesis A the timezone is **not the mechanism**. Three things are:

**1. The gate is advisory.** `day_complete: true` goes out in the same response as
ten playable questions. Whatever consumes that response decides whether to honour
it. The API expresses a preference, not a constraint. (§11 Finding A)

**2. Level progression refills the payload.** Progress is derived, never stored.
Clearing level *N* makes `currentLevel` become *N+1* on the very next call, and
`idsForLevel(N+1)` produces ten unseen questions. The `levelCompletedToday` guard
that was written to stop same-day advancement only sets the flag — it never
filters `selectedIds`. (§11 Findings C, D)

**3. Enforcement lives outside this repository.** Commit `b369713c` states the
design: *"The worker needs the day-gate as a fact from the log."* The LiveKit
Quizzy worker is not in `main/livekit-server` — no file there or in
`main/mqtt-gateway` mentions "quiz" at all, and the design spec `quiz.service.js`
cites (`2026-08-04-quizzy-question-bank-design.md`) is absent. If that worker
does not read `day_complete`, caches it from a restored transcript, or starts a
fresh session without re-checking, the child gets a second quiz and the API is
behaving exactly as written. **UNKNOWN — requires the worker's source.**

Plus one human path: the admin **Reset day** button slides the whole answer log
back 24 hours (§11 Finding H). If it was pressed during testing, the gate reopened
for reasons unrelated to any clock.

---

## 16. If the server is NOT IST — how the others still reset at IST midnight

Because **not one of them reads the process clock.** Trace it end to end:

```
resolveProgressScope(firebaseUid)                          mobile.service.js:2440
  └─ sys_user.findUnique({ parent_profile: { timezone } })
  └─ resolveTimezone(user.parent_profile?.timezone)         mobile.service.js:2484
       └─ parent_profile.timezone is NULL                  (asserted timezone.js:13–15)
       └─ → DEFAULT_TIMEZONE                                timezone.js:47–49
            └─ process.env.DEFAULT_PARENT_TIMEZONE unset   (absent from .env)
            └─ → literal 'Asia/Kolkata'                     timezone.js:44
                 └─ Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Kolkata', … })
                                                            timezone.js:64–68, 103–109
```

`Intl.DateTimeFormat` with an explicit `timeZone` resolves against ICU's tz
database for **that named zone**. It does not read `process.env.TZ`, does not read
`/etc/localtime`, and produces byte-identical output on a UTC host, an IST host,
and a host set to `Pacific/Honolulu`.

The same is true of the other explicit mechanisms:

| Mechanism | Where | Why the host cannot affect it |
|---|---|---|
| `Intl.DateTimeFormat({ timeZone })` | `timezone.js`, `founderDashboard.service.js:74–92` | Zone is a parameter |
| `(col AT TIME ZONE 'Asia/Kolkata')::date` | `activeDevices.service.js` ×9 | Evaluated by PostgreSQL against a named zone |
| `` new Date(`${key}T00:00:00.000+05:30`) `` | `founderDashboard.service.js:147–148` | Offset is in the literal |
| `ref.getTime() + 5.5*60*60*1000` | `usageSummaryNotification.js:29–42` | Pure millisecond arithmetic |
| `datetime.now(pytz.timezone('Asia/Kolkata'))` | `prompt_manager.py:137`, `main_agent.py:1963` | Zone is a parameter |
| `startOfDayInstant(key, tz)` | `timezone.js:130` | Offset derived from the named zone via `Intl` |

**So the correct behaviour of Chat / Games / Progress / Analytics is not evidence
that the server is IST.** They are correct on a UTC server too. The user's
premise — "these work, therefore the server must be IST, therefore Quizzy should
work too" — has a false middle step.

---

## 17. The decisive runtime test

Two independent checks. Neither modifies anything.

### A. Read the server clock directly

```bash
ssh root@139.59.7.72 'timedatectl; echo "---"; pm2 env $(pm2 id manager-api | tr -d "[] ")| grep -i "^TZ" || echo "TZ not set in pm2 env"'
ssh root@139.59.7.72 'node -e "console.log({TZ: process.env.TZ, resolved: Intl.DateTimeFormat().resolvedOptions().timeZone, offsetMin: new Date().getTimezoneOffset()})"'
ssh root@139.59.7.72 'git -C /opt/cheeko-backend rev-parse HEAD; git -C /opt/cheeko-backend status -sb | head -1'
```

| Output | Means |
|---|---|
| `offsetMin: -330` / `Asia/Kolkata` | **Hypothesis A.** Quizzy's boundary is correct; the symptom is the unenforced gate. |
| `offsetMin: 0` / `UTC` | **Hypothesis B.** Both defects are live. |
| `HEAD` ≠ `e9775e1c` | The fix branch was hand-deployed; re-read §14's premise note. |

### B. Read the API's own answer — no SSH needed

After a session that finished the Daily Ten between 00:00 and 05:29 IST, call the
endpoint the worker calls, any time after 06:00 IST the same day:

```bash
curl -s -H "x-service-key: $SERVICE_SECRET_KEY" \
  'http://139.59.7.72:8002/toy/quiz/next-questions?device_mac=AA:BB:CC:DD:EE:FF' \
  | jq '{answered_today, day_complete, level, replay, question_count: (.questions|length)}'
```

| Response | Conclusion |
|---|---|
| `answered_today: 10, day_complete: true, question_count: 10` | **Server is IST.** The boundary is fine; the API is offering questions on a completed day. Root cause = unenforced gate (worker side). |
| `answered_today: 0, day_complete: false, question_count: 10` | **Server is not IST.** The 00:05 answers fell outside `startOfDay`. Root cause = server-local boundary **plus** the unenforced gate. |
| `question_count: 10` in **either** case | Confirms §11 Finding A independently of timezone. |

Also worth pulling, to rule out §11 Finding H:

```bash
ssh root@139.59.7.72 'pm2 logs manager-api --lines 2000 --nostream | grep -E "admin reset-day|GET /quiz/next-questions"'
```

---

## 18. Confidence register

| # | Conclusion | Status | Evidence |
|---|---|---|---|
| 1 | The commit changed **no** infrastructure file and did not alter the global server timezone | **CONFIRMED** | `git show --name-only bac20344` — 13 files, none infra |
| 2 | `.env.example` explicitly instructs leaving `TZ` unset | **CONFIRMED** | `.env.example`: "Note this is NOT the container clock: leave the TZ variable unset." |
| 3 | `DEFAULT_PARENT_TIMEZONE` is an application variable, not the process clock | **CONFIRMED** | `timezone.js:42–44`, consumed only by `Intl.DateTimeFormat` |
| 4 | Nothing in the repository sets `TZ` anywhere, ever | **CONFIRMED** | Repo-wide search: Dockerfiles, compose, workflows, PM2 config, `.env`, all source |
| 5 | Chat / Games / Progress / Analytics use explicit `Asia/Kolkata` and are **independent of the host clock** | **CONFIRMED** | `timezone.js:44,64,103`; `mobile.service.js:2484,268,4059`; `deviceAnalytics.service.js:323,347` |
| 6 | Therefore "the others reset at IST midnight" is **compatible with any host timezone** and proves nothing about it | **CONFIRMED** | Follows from 5 |
| 7 | Quizzy Bee and Riddler use **server-local**, not explicit UTC | **CONFIRMED** | `quiz.service.js:221,368,881,1058` |
| 8 | Quizzy Bee and Riddler share one implementation | **CONFIRMED** | `banks.js` BANKS map; one `nextQuestions` |
| 9 | The quiz service cannot reach any timezone — no `parent_profile` read, no route parameter | **CONFIRMED** | `quiz.service.js:43–70`; `quiz.routes.js:57–71` |
| 10 | **`nextQuestions` returns the full question batch regardless of `day_complete`** | **CONFIRMED** | `quiz.service.js:252–424` — `selectedIds` built at :312, gate evaluated at :368–391, payload returned at :393–423 with no branch |
| 11 | Enforcement was deliberately delegated to the LiveKit worker | **CONFIRMED** | `b369713c` commit message; `quiz.routes.js:51–53` swagger contract |
| 12 | `day_complete` / `answered_today` are covered by **no test and no spec** | **CONFIRMED** | `grep` over `tests/unit/*.test.js` and all `*.md` — zero matches |
| 13 | Level progression supplies ten fresh questions the moment a level clears | **CONFIRMED** | `quiz.logic.js:29–52`; `quiz.service.js:307–312` |
| 14 | The payload is never empty for a completed day, in any state | **CONFIRMED** | `idsForLevel` / `replay` / `leastRecentlyPlayedLevel` paths all return ≥1 |
| 15 | `levelCompletedToday` can return true after a single practice answer | **CONFIRMED** | `quiz.logic.js:129–137` — `clearedIds` is lifetime, not today's |
| 16 | `answered_today` is counted over a non-bank-filtered row set | **CONFIRMED** | `quiz.service.js:260` vs `:370` |
| 17 | Admin "Reset day" slides the whole answer log back 24h | **CONFIRMED** (mechanism) | `quiz.service.js:1055–1090` |
| 18 | The reported symptom reproduces under **both** server-timezone hypotheses | **CONFIRMED** | §12 walkthrough, from the code paths above |
| 19 | The statement "Quizzy is broken because it uses UTC while others use IST" is **FALSE as stated** | **CONFIRMED** | Follows from 7, 10, 18 |
| 20 | Production runs `manager-api-node` as a bare PM2 process, not a container | **CONFIRMED** | `deploy/deploy.sh`; `.github/workflows/deploy.yml` |
| 21 | The CircleCI pipeline builds the **Java** manager-api, not this one | **CONFIRMED** | `.circleci/config.yml:318–343` (`SPRING_PROFILES_ACTIVE`, `MYSQL_*`) |
| 22 | The Docker image, if used, would run UTC | **CONFIRMED** | `Dockerfile` — `node:20-alpine`, no `tzdata`, no `ENV TZ` |
| 23 | `bac20344` is absent from `origin/main` | **CONFIRMED** | `git cat-file -e origin/main:.../timezone.js` → fatal |
| 24 | `parent_profile.timezone` is NULL on every live account | **HIGH CONFIDENCE** | `timezone.js:13–15`; `mobile.timezone-day-boundary.test.js:5–7`; no writer, no backfill |
| 25 | `DEFAULT_PARENT_TIMEZONE` is unset in production | **HIGH CONFIDENCE** | Present only in `.env.example`, added by the undeployed commit; absent from the local `.env` |
| 26 | The team was already unable to verify the API host's TZ months ago | **CONFIRMED** | `ACTIVE_DEVICES_ANALYTICS_PLAN.md:44–52` — "Before trusting it, run: `date` on the API host" |
| 27 | A UTC day boundary has previously produced wrong counts against live production data | **CONFIRMED** (as a recorded observation) | `ACTIVE_DEVICES_ANALYTICS_PLAN.md:19–21` — "returned 0 taps for a day that actually had 34" |
| 28 | The dev box is `64.227.170.31`; production is `139.59.7.72` | **CONFIRMED** | `gateway-capacity-and-hardening.md:13,175` |
| 29 | **DEV server process timezone** | **UNKNOWN** | Not represented in the repository. Run `date` / `node -e` on the host. |
| 30 | **PRODUCTION server process timezone** | **UNKNOWN** | Host OS zone of `139.59.7.72`; `/opt/ecosystem.config.js` is outside the repo. HIGH CONFIDENCE it is UTC *only* if `answered_today` reads 0 in the §17B test. |
| 31 | Which branch production is actually running | **UNKNOWN** | `deploy.sh` implies `origin/main`; hand-deploys cannot be ruled out from here |
| 32 | Whether the LiveKit Quizzy worker honours `day_complete` | **UNKNOWN** | Worker is not in this repository; no file in `main/livekit-server` or `main/mqtt-gateway` mentions "quiz" |
| 33 | Whether admin "Reset day" was pressed during the observed test | **UNKNOWN** | Check `pm2 logs manager-api` for `[QUIZ] admin reset-day` |

---

## The one-line reconciliation

> **Chat, Games, Progress and Analytics reset at 00:00 IST because they name
> `Asia/Kolkata` — not because the server does. Quizzy Bee and Riddler are the
> only daily features that ask the host what midnight is, so their boundary is
> whatever the host says and the repository cannot say what that is. And even if
> the host says IST, `nextQuestions` still hands back ten questions on a
> completed day, because `day_complete` is a field in the response, not a gate on
> it.**

Run §17B. `answered_today` tells you which of the two you are looking at — or
whether it is both.

---

<sub>Investigation only — no files were modified, no fix proposed. Evidence base: `cheeko-backend` @ `bac20344` (branch `fix/timezone-mismatch`), compared against `origin/main` @ `e9775e1c`. 2026-08-21.</sub>
