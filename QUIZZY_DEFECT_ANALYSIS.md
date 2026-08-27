# Quizzy Bee / Riddler — Defect Analysis and Fix Surface

Companion to [`TIMEZONE_INVESTIGATION.md`](TIMEZONE_INVESTIGATION.md) and
[`TIMEZONE_RECONCILIATION.md`](TIMEZONE_RECONCILIATION.md).

**This document explains what is wrong, why it is wrong, and where the fix has to
land. It contains no patches and no code changes were made.** Every line number
below was re-verified against the working tree at `bac20344` before publication;
corrections to the two earlier documents are listed in §9.

| | |
|---|---|
| **Repository** | `cheeko-backend` |
| **Branch** | `fix/timezone-mismatch` @ `bac20344` |
| **Deploy branch** | `origin/main` @ `e9775e1c` |
| **Node used for probes** | v20.20.2, ICU 78.3 |
| **Dated** | 2026-08-21 |

---

## Contents

- [1. Empirical proof — the two mechanisms, measured](#1-empirical-proof--the-two-mechanisms-measured)
- [2. The defects](#2-the-defects)
  - [D1 — The day boundary is inherited from the host OS](#d1--the-day-boundary-is-inherited-from-the-host-os)
  - [D2 — The quiz service cannot reach a timezone](#d2--the-quiz-service-cannot-reach-a-timezone)
  - [D3 — The gate is computed after the payload and never applied](#d3--the-gate-is-computed-after-the-payload-and-never-applied)
  - [D4 — `levelCompletedToday` ends a replay day after one answer](#d4--levelcompletedtoday-ends-a-replay-day-after-one-answer)
  - [D5 — `answered_today` counts a different population than clearing](#d5--answered_today-counts-a-different-population-than-clearing)
  - [D6 — The admin console and the toy can disagree](#d6--the-admin-console-and-the-toy-can-disagree)
  - [D7 — `clearDayGate` reads the same broken boundary](#d7--cleardaygate-reads-the-same-broken-boundary)
  - [D8 — No test can see any of this, and two tests lock the bug in](#d8--no-test-can-see-any-of-this-and-two-tests-lock-the-bug-in)
  - [D9 — Enforcement lives in a repository we cannot inspect](#d9--enforcement-lives-in-a-repository-we-cannot-inspect)
  - [D10 — The "user timezone" arrow carries no data](#d10--the-user-timezone-arrow-carries-no-data)
  - [D11 — The fix branch is not on the deploy branch](#d11--the-fix-branch-is-not-on-the-deploy-branch)
  - [D12 — Minor: dead variable, and a wrong comment in `.env.example`](#d12--minor-dead-variable-and-a-wrong-comment-in-envexample)
- [3. Why the symptom looks like "a second quiz"](#3-why-the-symptom-looks-like-a-second-quiz)
- [4. Fix surface — every file and function that must change](#4-fix-surface--every-file-and-function-that-must-change)
- [5. Order of operations, and what breaks if you reorder it](#5-order-of-operations-and-what-breaks-if-you-reorder-it)
- [6. Decisions that are product calls, not engineering calls](#6-decisions-that-are-product-calls-not-engineering-calls)
- [7. Same bug class elsewhere — not blocking Quizzy](#7-same-bug-class-elsewhere--not-blocking-quizzy)
- [8. What to measure before and after](#8-what-to-measure-before-and-after)
- [9. Corrections to the earlier documents](#9-corrections-to-the-earlier-documents)
- [10. Confidence register](#10-confidence-register)

---

## 1. Empirical proof — the two mechanisms, measured

Everything in this document rests on one measurable difference. This probe runs
the **exact expressions** from [quiz.service.js:368-369](main/manager-api-node/src/services/quiz.service.js#L368-L369)
and [quiz.service.js:221-223](main/manager-api-node/src/services/quiz.service.js#L221-L223)
alongside the **exact functions** from [utils/timezone.js](main/manager-api-node/src/utils/timezone.js),
against the same two fixed instants, under three host timezones.

Fixed inputs, identical in every run:

```
request  2026-08-21T04:30:00.000Z   (= 10:00 IST, the second session)
answer   2026-08-20T18:35:00.000Z   (= 00:05 IST, the first session)
```

Measured output:

| Host `TZ` | Quizzy `startOfDay` | Counts the 00:05 answer? | Quizzy `dayKey` | Explicit `formatDateInTimezone` | Explicit `startOfDayInstant` |
|---|---|---|---|---|---|
| `UTC` | `2026-08-21T00:00:00.000Z` | **false** | `2026-7-20` | `2026-08-21` | `2026-08-20T18:30:00.000Z` |
| `Asia/Kolkata` | `2026-08-20T18:30:00.000Z` | **true** | `2026-7-21` | `2026-08-21` | `2026-08-20T18:30:00.000Z` |
| `Pacific/Honolulu` | `2026-08-20T10:00:00.000Z` | **true** | `2026-7-20` | `2026-08-21` | `2026-08-20T18:30:00.000Z` |

Read the last two columns: **byte-identical on all three hosts.** That is why
Chat, Games, Progress and Analytics are correct everywhere — and it is proof that
their correctness says nothing whatsoever about the server's clock.

Read the first three columns: **different on every host.** That is Quizzy Bee.

Two further facts fall out of the probe:

- `Asia/Kolkata` and the abbreviation `IST` both resolve, on this ICU build, to
  the canonical id `Asia/Calcutta` and produce identical boundaries. The two
  names are interchangeable here.
- The quiz's two day computations (`startOfDay` and `dayKey`) **agree with each
  other** on every host — UTC says "Aug 20 / not today", IST says "Aug 21 /
  today", Honolulu says "Aug 20 / today, because Aug 20 is today there". The file
  is internally consistent. It is only externally wrong.

---

## 2. The defects

Each entry: what you observe → what causes it → why → where the fix goes → what
it breaks if fixed in isolation.

---

### D1 — The day boundary is inherited from the host OS

**Severity: high · Status: CONFIRMED**

#### What you observe
On a host that is not `Asia/Kolkata`, Quizzy Bee's Daily Ten does not reset at
midnight. On a UTC host it resets at 05:30 IST. A child playing between 00:00 and
05:29 IST has those answers charged to the *previous* day.

#### What causes it
Four call sites compute "today" from the process clock and never name a zone:

| # | Location | Expression | What it feeds |
|---|---|---|---|
| 1 | [quiz.service.js:368-369](main/manager-api-node/src/services/quiz.service.js#L368-L369) | `new Date()` + `setHours(0,0,0,0)` | **The Daily Ten gate.** `todayRows` at :370-373 → `answeredToday` at :374 → `day_complete` at :379-380 |
| 2 | [quiz.service.js:221-224](main/manager-api-node/src/services/quiz.service.js#L221-L224) | `` `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}` `` | `daysByQuestionId` (:234) → `agedOutLevels` (:276) → the anti-trap; also `days_on_level` on the admin card |
| 3 | [quiz.service.js:881-882](main/manager-api-node/src/services/quiz.service.js#L881-L882) | `new Date()` + `setHours(0,0,0,0)` | `allDeviceProgress` — the admin console's `answered_today` / `day_complete` |
| 4 | [quiz.service.js:1058-1059](main/manager-api-node/src/services/quiz.service.js#L1058-L1059) | `new Date()` + `setHours(0,0,0,0)` | `clearDayGate` — the "Reset day" precondition count |

#### Why
`new Date()` produces an **instant**, which carries no timezone. The timezone is
decided by the *getter* applied afterwards. `setHours`, `getHours`, `getDate`,
`getMonth`, `getFullYear` all resolve against `process.env.TZ` if set, otherwise
the host OS zone. Nothing in this repository sets `TZ` — not the Dockerfile, not
docker-compose, not `ecosystem.config.js`, not `deploy/deploy.sh`, not any GitHub
workflow, not `.env`. So the boundary is whatever the machine happens to be set to.

The file states the choice deliberately, in a comment that is honest about what it
is doing:

```js
/**
 * Server-local midnight day key. The same boundary the Daily Ten gate uses —
 * two definitions of "day" in one file would eventually disagree by one, and the
 * disagreement shows up as a child gaining or losing a day.
 */
```
<sub>[quiz.service.js:216-220](main/manager-api-node/src/services/quiz.service.js#L216-L220)</sub>

The comment's goal — internal consistency — is achieved (see §1). The problem is
that the boundary was never anchored to anything outside the process.

#### Where the fix goes
All four sites, in [quiz.service.js](main/manager-api-node/src/services/quiz.service.js).
They need **two different** utilities, not one:

- Sites 1, 3, 4 push a boundary **into SQL** against `answered_at`, a
  `timestamptz` column. They need an **instant**: `startOfDayInstant(dateKey, tz)`
  from [utils/timezone.js:130](main/manager-api-node/src/utils/timezone.js#L130).
  Its docstring says exactly this: *"Needed wherever a local day has to be pushed
  down into SQL against an instant column — filtering in JS instead would make a
  paginated count wrong."*
- Site 2 buckets rows **in JS**, one at a time. It needs a **date key**:
  `formatDateInTimezone(instant, tz)` from
  [utils/timezone.js:59](main/manager-api-node/src/utils/timezone.js#L59). Same
  docstring: *"Where the day is bucketed in JS, prefer formatDateInTimezone on
  each row."*

Getting today's date key in the parent's zone is
`formatDateInTimezone(new Date(), tz)`, then `startOfDayInstant(thatKey, tz)`.

#### If fixed in isolation
Sites 1 and 2 **must move together**. The file's own comment explains why: if the
gate moves to IST and the anti-trap key stays server-local, the two disagree by
one day on a UTC host, and a child gains or loses a day on the level cap. Site 3
must move too or the admin console will report a different `answered_today` than
the toy receives (see D6).

---

### D2 — The quiz service cannot reach a timezone

**Severity: high (blocks D1) · Status: CONFIRMED**

#### What you observe
There is no way to pass a timezone into the quiz engine, from the profile or from
the request.

#### What causes it
`resolveDeviceContext` reads exactly two tables and neither reaches the parent:

```js
const resolveDeviceContext = async (deviceMac) => {
  const normalizedMac = normalizeMacAddress(deviceMac) || deviceMac;
  const device = await prisma.ai_device.findUnique({
    where: { mac_address: normalizedMac },
    select: { kid_id: true }            // ← user_id NOT selected
  });
  const kid = device?.kid_id
    ? await prisma.kid_profile.findUnique({
        where: { id: device.kid_id },
        select: { birth_date: true, language: true }   // ← timezone NOT selected
      })
    : null;
  return { profileMissing, language, kidId, deviceMac };
};
```
<sub>[quiz.service.js:43-70](main/manager-api-node/src/services/quiz.service.js#L43-L70)</sub>

And the route accepts three parameters, none of them a zone:

```js
router.get('/next-questions', requireServiceKey, asyncHandler(async (req, res) => {
  const deviceMac = String(req.query.device_mac || '').trim();
  const bank = await bankForCharacterRef({ character: req.query.character,
                                           characterId: req.query.character_id });
  …
```
<sub>[quiz.routes.js:57-71](main/manager-api-node/src/routes/quiz.routes.js#L57-L71)</sub>

#### Why
The service was designed around one question — *what should this device be asked
next* — and progression is scoped by child, not by account. The parent account was
never needed, so it was never joined.

#### Where the fix goes
[`resolveDeviceContext`](main/manager-api-node/src/services/quiz.service.js#L43-L70)
is the single choke point. It is called from **seven** places — lines
[254](main/manager-api-node/src/services/quiz.service.js#L254) (`nextQuestions`),
[473](main/manager-api-node/src/services/quiz.service.js#L473) (`recordWonderQuestion`),
[538](main/manager-api-node/src/services/quiz.service.js#L538) (`recordUnresolvedAttempts`),
[630](main/manager-api-node/src/services/quiz.service.js#L630) (`recordAnswer`),
[767](main/manager-api-node/src/services/quiz.service.js#L767) (`progress`),
[992](main/manager-api-node/src/services/quiz.service.js#L992) (`setLevel`),
[1057](main/manager-api-node/src/services/quiz.service.js#L1057) (`clearDayGate`)
— so adding the zone there reaches every entry point at once.

The lookup is `ai_device.user_id → parent_profile.user_id`. Both sides are indexed
and the parent side is unique:

- [`ai_device.user_id`](main/manager-api-node/prisma/schema.prisma#L97) — `BigInt?`, with `@@index([user_id])` at :124 and a `sys_user` relation at :114
- [`parent_profile.user_id`](main/manager-api-node/prisma/schema.prisma#L703) — `BigInt? @unique`

The pattern already exists and can be copied verbatim from the analytics writer:

```js
let timezone = resolveTimezone(null);
if (device?.user_id != null) {
  const profile = await prisma.parent_profile.findUnique({
    where: { user_id: device.user_id }, select: { timezone: true },
  });
  timezone = resolveTimezone(profile?.timezone);
}
```
<sub>[deviceAnalytics.service.js:324-331](main/manager-api-node/src/services/deviceAnalytics.service.js#L324-L331)</sub>

#### Things that will bite
- **`ai_device.user_id` is nullable.** An unbound device has no parent, and
  `allDeviceProgress` even synthesises rows with `mac_address: ''` for children
  who own answers but no device ([quiz.service.js:876-879](main/manager-api-node/src/services/quiz.service.js#L876-L879)).
  The fallback to `DEFAULT_TIMEZONE` must be deliberate, not accidental.
- **Latency.** `/quiz/next-questions` sits on the voice path — the worker pulls
  the batch while the child is waiting. `resolveDeviceContext` is currently two
  sequential primary-key reads; a naive third makes it three. Prefer one query
  with a nested `select` through the `sys_user` relation.
- **`resolveTimezone` never throws.** A junk zone already in the column falls back
  to the default rather than 500-ing the read
  ([timezone.js:49-51](main/manager-api-node/src/utils/timezone.js#L49-L51)). Keep
  that property — a quiz that 500s is worse than a quiz on the wrong day.

---

### D3 — The gate is computed after the payload and never applied

**Severity: high · Status: CONFIRMED · This one is independent of timezone**

#### What you observe
The API returns ten playable questions in the same response that says
`day_complete: true`.

#### What causes it
Order of operations inside `nextQuestions`:

| Line | What happens |
|---|---|
| [277-281](main/manager-api-node/src/services/quiz.service.js#L277-L281) | `deriveLevelState(...)` → `state.currentLevel` |
| [308-313](main/manager-api-node/src/services/quiz.service.js#L308-L313) | `idsForLevel(n)` defined |
| [315-320](main/manager-api-node/src/services/quiz.service.js#L315-L320) | `level` resolved; `replay` decided |
| **[321](main/manager-api-node/src/services/quiz.service.js#L321)** | **`let selectedIds = idsForLevel(level)` — the ten questions are chosen here** |
| [368-374](main/manager-api-node/src/services/quiz.service.js#L368-L374) | …47 lines later… `startOfDay`, `todayRows`, `answeredToday` |
| [379-380](main/manager-api-node/src/services/quiz.service.js#L379-L380) | `dayComplete` computed |
| [391-424](main/manager-api-node/src/services/quiz.service.js#L391-L424) | `return { …, day_complete: dayComplete, questions: [ …selectedIds… ] }` |

`selectedIds` is fixed before `dayComplete` exists and is never re-consulted after
it does. **There is no `if (dayComplete)` branch anywhere in the function.**

#### Why
This is by design, and the design is recorded. The commit that added the field:

```
feat(quiz): return answered_today and day_complete from next-questions

The worker needs the day-gate as a fact from the log; the model cannot be
trusted to derive it while restored transcripts claim the day is finished.
```
<sub>`b369713c`, 2026-08-04</sub>

The API was made the *source of truth for the fact*; the LiveKit worker was left
as the *enforcer of the rule*. The route's own swagger confirms the payload is
never gated:

```
*       200:
*         description: Question batch (questions may be empty when the bank has
*                      no content for the band)
```
<sub>[quiz.routes.js:51-53](main/manager-api-node/src/routes/quiz.routes.js#L51-L53) — the only documented reason for an empty payload</sub>

#### Where the fix goes
[`nextQuestions`](main/manager-api-node/src/services/quiz.service.js#L252-L424).
Two changes, both structural:

1. **Move the day-gate block (:365-380) above the selection (:308-321)**, so
   `dayComplete` is known before `selectedIds` is built. Note this changes the
   query order — the gate query at :370 currently runs after `leastRecentlyPlayedLevel`
   at :319, which is an `await` inside the `replay` branch.
2. **Decide what a gated response looks like on the wire** (see §6 — this is a
   contract decision, not a code decision).

#### Things that will bite
- **The wire contract changes.** Any consumer that assumes `questions.length > 0`
  breaks. Today's consumers: the LiveKit worker (outside this repo) and the admin
  test page ([main/admin-dashboard/public/test.js:517](main/admin-dashboard/public/test.js#L517)).
- **The worker improvises when it runs out.** This is a recorded production
  incident, not a hypothetical:

  ```js
  // Serving only the uncleared ones made a session as short as the number left:
  // clear nine of ten and the next day is a one-question session, after which
  // the model had nothing to ask and invented a question by walking to the next
  // id (seen live 2026-08-15, and the id it reached was a Level 2 question).
  ```
  <sub>[quiz.service.js:285-289](main/manager-api-node/src/services/quiz.service.js#L285-L289)</sub>

  An empty array is the extreme case of "nothing to ask". The worker needs a
  defined, tested "come back tomorrow" path shipped *in the same release*, or you
  trade a wrong day boundary for a hallucinating character.
- **The worker cannot currently distinguish "day complete" from "bank empty".**
  Both would be `questions: []`. It needs a discriminator on the wire.
- **Two existing tests assert the current behaviour** — see D8.

---

### D4 — `levelCompletedToday` ends a replay day after one answer

**Severity: high, but latent · Status: CONFIRMED**

#### What you observe
Nothing today, because nothing enforces `day_complete`. **The moment you enforce
it (D3), a child in replay mode is locked out for the day after a single
question.**

#### What causes it

```js
const levelCompletedToday = (questions, clearedIds, todayQuestionIds) => {
  const levelById = new Map(questions.map((q) => [String(q.id), q.level]));
  const todayLevels = new Set(
    todayQuestionIds.map((id) => levelById.get(String(id))).filter((l) => l !== undefined)
  );
  return [...todayLevels].some((level) =>
    questions.every((q) => q.level !== level || clearedIds.has(String(q.id)))
  );
};
```
<sub>[quiz.logic.js:128-136](main/manager-api-node/src/services/quiz.logic.js#L128-L136)</sub>

`clearedIds` is the **lifetime** cleared set, built at
[quiz.service.js:266-268](main/manager-api-node/src/services/quiz.service.js#L266-L268)
from the whole answer log. The function asks "is this level fully cleared *now*",
not "did today's answer close it".

#### Why this is a real mismatch, not a nitpick
The function's own docstring states the intended rule, and the implementation does
not achieve it:

> *"Levels completed before today don't count — only a level that one of today's
> answers closed."*
> <sub>[quiz.logic.js:122-123](main/manager-api-node/src/services/quiz.logic.js#L122-L123)</sub>

#### When it actually fires
Walking every path through `nextQuestions`:

| Path | Is a fully-cleared level in `todayLevels`? | False positive? |
|---|---|---|
| Normal play on current level *N* | No — *N* has outstanding questions by definition of `deriveLevelState` | No |
| Practice items inside the current level (`[...outstanding, ...practice]`, [:312](main/manager-api-node/src/services/quiz.service.js#L312)) | No — *N* still has the outstanding one | No |
| Anti-trap bonus items from level *N−1* | No — an aged-out level always has uncleared questions (`if (!uncleared.length) continue; // mastered, not aged out`, [quiz.logic.js:106](main/manager-api-node/src/services/quiz.logic.js#L106)) | No |
| **Replay** (`state.allCleared` → [:316-320](main/manager-api-node/src/services/quiz.service.js#L316-L320)) | **Yes — by definition every level is cleared** | **Yes, guaranteed on the first answer of the day** |

So it is not an edge case in replay; it is the *only* case in replay.

#### How reachable is replay?
The seed banks in this repo are 3 levels × 80 questions each (`quiz-bank-all.csv`,
`riddle-bank-all.csv`; the ages-3-5 variants are 3 × 30). At a cap of ten scored
questions per day, clearing all 240 takes 24 perfect days minimum for Riddler
(where `revealed` also clears) and longer for Quizzy (where only `correct`
clears). The published parent-app doc nonetheless warns:

> **Levels per band are few** — 3 in the riddle bank — so children reach "all
> cleared" and enter replay quickly. Expect `replay: true` in normal use, not as
> a rare case.
> <sub>[parent-app-quiz-analytics-api.md:245-247](main/manager-api-node/docs/parent-app-quiz-analytics-api.md#L245-L247)</sub>

The **live** bank contents are not in this repository, so how soon real children
reach replay is **UNKNOWN**. Either way the defect is deterministic once they do.

#### Where the fix goes
[`levelCompletedToday`](main/manager-api-node/src/services/quiz.logic.js#L128-L136)
needs to distinguish "cleared" from "cleared today". The caller at
[quiz.service.js:380](main/manager-api-node/src/services/quiz.service.js#L380)
passes only `question_id` from `todayRows`
([:370-373](main/manager-api-node/src/services/quiz.service.js#L370-L373)); it does
not currently select `result`, so the caller cannot tell which of today's answers
*cleared* anything. That select has to widen too. `quiz.logic.js` is pure and
fully unit-tested — the change belongs there, with its own cases.

#### Ordering
**This must ship with or before D3.** Enforcement without it converts a dormant
logic error into a customer-visible lockout.

---

### D5 — `answered_today` counts a different population than clearing

**Severity: low today, medium after D3 · Status: CONFIRMED**

#### What causes it
The two reads in `nextQuestions` are scoped differently:

```js
// :260-263 — the full log, then filtered to the active bank
const answerRows = (await tables.answers.findMany({
  where: scope, select: { question_id: true, result: true, answered_at: true }
})).filter((row) => bankIds.has(String(row.question_id)));

// :370-373 — today's rows, NOT filtered to the bank
const todayRows = await tables.answers.findMany({
  where: { ...scope, answered_at: { gte: startOfDay } },
  select: { question_id: true }
});
```

`bankIds` ([:259](main/manager-api-node/src/services/quiz.service.js#L259)) is
built from `loadBank`, which selects `where: { language, active: true }`
([:92-105](main/manager-api-node/src/services/quiz.service.js#L92-L105)).

#### Why it matters
An answer to a question that has since been deactivated, or that belongs to
another language, counts toward `answered_today` but contributes nothing to
clearing. While the number is only displayed this is cosmetic. Once it gates
access, a child can be locked out by answers to questions the engine no longer
considers part of their bank.

#### Where the fix goes
[quiz.service.js:370-374](main/manager-api-node/src/services/quiz.service.js#L370-L374)
— apply the same `bankIds` filter, or scope the query by `question_id: { in: … }`.

---

### D6 — The admin console and the toy can disagree

**Severity: medium · Status: CONFIRMED**

#### What you observe
The admin quiz page can show a different `answered_today` / `day_complete` than
the toy is actually being served — and once D1 is fixed in `nextQuestions` only,
it *will*.

#### What causes it
`allDeviceProgress` recomputes the day independently:

```js
const startOfDay = new Date();
startOfDay.setHours(0, 0, 0, 0);
```
<sub>[quiz.service.js:881-882](main/manager-api-node/src/services/quiz.service.js#L881-L882)</sub>

and again for the anti-trap column, via the same `dayKey`:

```js
days_on_level: … new Set(deviceAnswers.filter(…).map((a) => dayKey(a.answered_at))).size
```
<sub>[quiz.service.js:958-963](main/manager-api-node/src/services/quiz.service.js#L958-L963)</sub>

The function's own comment says keeping the two in step is the point:

```js
// Same anti-trap derivation nextQuestions runs, so the card names the level
// the next session will ACTUALLY serve. Deriving it without the cap printed
// "level 1" while Quizzy was asking level 2 — the panel and the toy
// disagreeing about the one thing the panel exists to report.
```
<sub>[quiz.service.js:910-914](main/manager-api-node/src/services/quiz.service.js#L910-L914)</sub>

#### Where the fix goes
[`allDeviceProgress`](main/manager-api-node/src/services/quiz.service.js#L821-L970).
Note it is a **batched, whole-page** function: it reads every device and every
answer once, then joins in memory. If the timezone becomes per-parent, it has to
resolve a zone **per device** rather than once for the page — which is a different
shape of change from the single-device path, and the most likely place to
introduce an N+1 query.

---

### D7 — `clearDayGate` reads the same broken boundary

**Severity: low · Status: CONFIRMED**

#### What causes it
The admin "Reset day" button first counts today's answers to decide whether the
gate is already open:

```js
const startOfDay = new Date();
startOfDay.setHours(0, 0, 0, 0);
…
const today = await tables.answers.count({
  where: { ...scope, answered_at: { gte: startOfDay } }
});
if (!today) return { device_mac: deviceMac, backdated: 0, day_already_open: true };
```
<sub>[quiz.service.js:1058-1069](main/manager-api-node/src/services/quiz.service.js#L1058-L1069)</sub>

On a UTC host, pressing Reset day between 00:00 and 05:29 IST reports
`day_already_open: true` and does nothing — even though the child is, in their own
day, blocked.

#### Also worth knowing while diagnosing
When it *does* fire, it slides **the entire answer log** back 24 hours:

```sql
UPDATE quiz_question_answer SET answered_at = answered_at - INTERVAL '1 day' WHERE kid_id = $1
```
<sub>[quiz.service.js:1078-1090](main/manager-api-node/src/services/quiz.service.js#L1078-L1090)</sub>

That is deliberate — the comment at :1043-1050 explains that moving only today's
rows flattened the anti-trap day count. But it means **a press of this button
reproduces the reported symptom exactly**, with no timezone involvement. Rule it
in or out from the logs before concluding anything:

```
[QUIZ] admin reset-day device=… bank=… backdated=N
```
<sub>emitted at [quiz.routes.js:427-429](main/manager-api-node/src/routes/quiz.routes.js#L427-L429)</sub>

---

### D8 — No test can see any of this, and two tests lock the bug in

**Severity: high (this is why it shipped) · Status: CONFIRMED**

#### Cause 1 — the mock cannot distinguish the two queries

Only two test files exercise `nextQuestions`, and both stub the answer table with
a single `mockResolvedValue` that **ignores the `where` clause**:

```js
prisma.quiz_question_answer.findMany.mockResolvedValue(cleared(1,2,3,4,5,6,7,8,9,10));
```
<sub>[quiz.level-batch.test.js:69-71](main/manager-api-node/tests/unit/quiz.level-batch.test.js#L69-L71)</sub>

So the full-log read at [:260](main/manager-api-node/src/services/quiz.service.js#L260)
and the day-gate read at [:370](main/manager-api-node/src/services/quiz.service.js#L370)
receive **identical data**. No test can tell them apart, and no test can express
"these answers were yesterday".

#### Cause 2 — two tests assert exactly the behaviour that must change

With that mock, `answered_today` is 10 and `day_complete` is true, and the test
asserts ten questions come back anyway:

```js
it('still moves on once the last outstanding question clears', async () => {
  prisma.quiz_question_answer.findMany.mockResolvedValue(cleared(1,2,3,4,5,6,7,8,9,10));
  const result = await quizService.nextQuestions(MAC);
  expect(result.level).toBe(2);
  expect(result.questions).toHaveLength(10);      // ← fails the moment D3 is fixed
});
```
<sub>[quiz.level-batch.test.js:68-77](main/manager-api-node/tests/unit/quiz.level-batch.test.js#L68-L77)</sub>

The same shape appears at
[:104-114](main/manager-api-node/tests/unit/quiz.level-batch.test.js#L104-L114) and
[:132-…](main/manager-api-node/tests/unit/quiz.level-batch.test.js#L132).
These are not bad tests — they were written to prove the batch-size fix — but they
encode "a full day still returns ten questions" as expected behaviour.

#### Cause 3 — the reset-day test reimplements the bug in its assertions

```js
const startOfToday = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; };
const dayKey = (d) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
```
<sub>[quiz.reset-day.test.js:39-40](main/manager-api-node/tests/unit/quiz.reset-day.test.js#L39-L40)</sub>

Test and implementation share the same defect, so they agree in **every** timezone.
The test can never fail because of it.

#### Cause 4 — no TZ is pinned anywhere

The jest block in [package.json:100-111](main/manager-api-node/package.json#L100-L111)
sets `testEnvironment`, `coverageDirectory`, `collectCoverageFrom`, `testMatch`,
`verbose` — and no `globalSetup`, no `setupFiles`, no `TZ`. Tests inherit the
developer's machine. On this machine that is `Asia/Calcutta`, where the bug is
invisible.

#### Cause 5 — the fixtures are themselves timezone-sensitive

```js
answered_at: new Date(`${d}T06:00:00`)
```
<sub>[quiz.level-batch.test.js:100](main/manager-api-node/tests/unit/quiz.level-batch.test.js#L100), [:157](main/manager-api-node/tests/unit/quiz.level-batch.test.js#L157)</sub>

A date-time string with no offset is parsed as **local time**. These fixtures
survive a TZ change only because `06:00` is far from any boundary. At `00:30` or
`23:30` they would flip.

#### Cause 6 — zero coverage of the fields themselves

```
grep -rn "day_complete|dayComplete|answered_today" tests/unit/*.test.js   → no matches
grep -rn "day_complete" --include="*.md" <repo root>                      → no matches
```

Not one assertion, not one line of specification.

#### Where the fix goes
- Pin `TZ` in the jest config (a `globalSetup` or `setupFiles` entry) so the suite
  runs somewhere the bug is visible — UTC is the obvious choice.
- Make the mocks honour the `where` clause, at least for `answered_at.gte`, so the
  gate can be tested at all.
- Rewrite the two `toHaveLength(10)` assertions to reflect the new contract.
- Replace the reimplemented `startOfToday`/`dayKey` in `quiz.reset-day.test.js`
  with the real utility, so the test tracks the implementation instead of
  duplicating it.
- Add explicit boundary cases: an answer at 23:59 IST, one at 00:01 IST, one at
  05:29 IST, asserted against a fixed `now`.

---

### D9 — Enforcement lives in a repository we cannot inspect

**Severity: unresolvable from here · Status: UNKNOWN**

#### What we know
- No file under [main/livekit-server](main/livekit-server) or
  [main/mqtt-gateway](main/mqtt-gateway) mentions "quiz" at all.
- The design spec `quiz.service.js` cites —
  `docs/superpowers/specs/2026-08-04-quizzy-question-bank-design.md`
  ([quiz.service.js:10](main/manager-api-node/src/services/quiz.service.js#L10)) —
  does not exist in this repository.
- `banks.js` references a spec in a different repository:
  `picoclaw docs/issues/riddle-bank/000-design.md`
  ([banks.js:17](main/manager-api-node/src/services/banks.js#L17)).
- Commit `b369713c` says the worker is the enforcer.

#### Why it matters
Even a perfect API-side fix leaves an unverified dependency if enforcement stays
worker-side. Three failure modes are possible and none can be ruled out from here:
the worker never reads `day_complete`; it reads it once and caches it across a
session; or it starts a fresh room without re-pulling. **UNKNOWN — requires the
worker's source.**

---

### D10 — The "user timezone" arrow carries no data

**Severity: medium (scoping) · Status: HIGH CONFIDENCE**

#### What causes it
`parent_profile.timezone` is nullable with no default
([schema.prisma:710](main/manager-api-node/prisma/schema.prisma#L710)), no
migration backfills it, and no evidence exists that any client writes it. Two
in-repo sources state it directly:

> *"parent_profile.timezone is nullable and no client writes it yet, so a NULL
> falls back to DEFAULT_TIMEZONE rather than to UTC."*
> <sub>[utils/timezone.js:13-15](main/manager-api-node/src/utils/timezone.js#L13-L15)</sub>

> *"The reported bug: a parent's 'today' ran 05:30 → 05:30 IST, because
> parent_profile.timezone is NULL on every account and the fallback was UTC."*
> <sub>[mobile.timezone-day-boundary.test.js:5-7](main/manager-api-node/tests/unit/mobile.timezone-day-boundary.test.js#L5-L7)</sub>

#### What it means for the fix
After D1+D2, every device will resolve to `DEFAULT_TIMEZONE` — the literal
`'Asia/Kolkata'` at [timezone.js:44-46](main/manager-api-node/src/utils/timezone.js#L44-L46),
because `DEFAULT_PARENT_TIMEZONE` is absent from the local `.env` and was
introduced only in `.env.example` by the undeployed commit.

**That is the correct answer for an India-only user base — but the fix will be
working because the default is right, not because the plumbing carries real data.**
Genuine per-user zones require the parent app to send one. Until then, the
architecture is right and the data is a constant.

#### A related trap
`kid_profile.timezone` also exists
([schema.prisma:647](main/manager-api-node/prisma/schema.prisma#L647)), is
writable through `profile.service.createKid` / `updateKid`
([:87](main/manager-api-node/src/services/profile.service.js#L87),
[:123](main/manager-api-node/src/services/profile.service.js#L123)) with **no
validation at all**, and is read by nothing except the founder dashboard's display
payload ([founderDashboard.service.js:939](main/manager-api-node/src/services/founderDashboard.service.js#L939)).
A client that populates the wrong column gets no error and no effect. Do not let
the quiz fix turn it into a third source of truth.

---

### D11 — The fix branch is not on the deploy branch

**Severity: blocking · Status: CONFIRMED**

```
$ git branch -a --contains bac20344
* fix/timezone-mismatch
  remotes/origin/fix/timezone-mismatch

$ git cat-file -e origin/main:main/manager-api-node/src/utils/timezone.js
fatal: path … exists on disk, but not in 'origin/main'
```

`src/utils/timezone.js` does not exist on `origin/main`, and
[deploy/deploy.sh](deploy/deploy.sh) runs `git reset --hard origin/main`. Any quiz
fix that does `require('../utils/timezone')` would throw at module load on the
deploy branch.

Two consequences:

1. **Merge and deploy `fix/timezone-mismatch` first.** It is a prerequisite, not a
   parallel task.
2. **The premise needs checking.** If production really is on `origin/main`, then
   `deviceAnalytics.service.js` there still reads
   `timezone = profile?.timezone || 'UTC'` (lines 339, 345 on that ref) and the
   parent-facing analytics are *also* cutting at 05:30 IST — not at midnight. If
   Chat/Games/Progress/Analytics were genuinely observed resetting at 00:00 IST,
   the environment tested was **not** running `origin/main`. Confirm with
   `git -C /opt/cheeko-backend rev-parse HEAD`.

---

### D12 — Minor: dead variable, and a wrong comment in `.env.example`

**Severity: cosmetic · Status: CONFIRMED**

**Dead variable.** `const now = new Date();` at
[quiz.service.js:883](main/manager-api-node/src/services/quiz.service.js#L883) is
declared inside `allDeviceProgress` and never read. Harmless; worth removing while
that function is being touched for D6.

**Wrong comment.** The `.env.example` block added by `bac20344` says:

> *"An IANA zone name — abbreviations ("IST") and offsets ("+05:30") are refused."*

Offsets are indeed refused. **Abbreviations are not.** Measured on Node v20.20.2 /
ICU 78.3:

| Input | `isValidTimezone` | `resolveTimezone` |
|---|---|---|
| `'Asia/Kolkata'` | `true` | `Asia/Kolkata` |
| `'IST'` | **`true`** | `IST` (ICU resolves to `Asia/Calcutta`) |
| `'+05:30'` | `false` | `Asia/Kolkata` |
| `'UTC'` | `true` | `UTC` |
| `'Etc/GMT-5'` | `true` | `Etc/GMT-5` |

The **code is deliberate** and the test says so explicitly — *"Documenting rather
than asserting a preference: ICU resolves the legacy abbreviation, so it is
storable and reads back as the right day"*
([timezone.test.js:35-41](main/manager-api-node/tests/unit/timezone.test.js#L35-L41)).
Only the `.env.example` comment is wrong. Worth correcting so nobody relies on a
guarantee that does not exist: `'IST'` resolving to India Standard Time is an ICU
behaviour, not something this code enforces.

---

## 3. Why the symptom looks like "a second quiz"

The reported symptom is *completed at 00:05 IST, given another quiz at 10:00 IST*.
Three independent things combine to produce it, and it is worth separating them
because they need different fixes.

**Progress is derived, never stored.** There is no `day_complete` column, no
session row, no daily-quiz table. Every call recomputes state from
`quiz_question_answer`:

```js
const state = deriveLevelState(bank.map((q) => ({ id: q.id, level: q.level })), clearedIds, agedOut);
```
<sub>[quiz.service.js:277-281](main/manager-api-node/src/services/quiz.service.js#L277-L281)</sub>

**Clearing a level moves the child on immediately.** `deriveLevelState` returns
the *lowest level with an uncleared question*
([quiz.logic.js:35-47](main/manager-api-node/src/services/quiz.logic.js#L35-L47)).
The instant level *N*'s last question clears, `currentLevel` becomes *N+1* and
`idsForLevel(N+1)` produces ten questions the child has never seen. The code
comment says `levelCompletedToday` exists precisely to stop that happening the
same day:

```js
// Finishing a level also ends the scored day: the Daily Ten is a cap, not a
// quota. Without this, a level finished on question 6 pulled 4 questions
// from the next level the same day just to reach ten.
```
<sub>[quiz.service.js:376-378](main/manager-api-node/src/services/quiz.service.js#L376-L378)</sub>

But it only sets a flag. **The prevention was never wired to `selectedIds`.**

**The payload is never empty while the bank has content.** Every path produces
questions:

| Child's state | `currentLevel` | What `idsForLevel` returns | Count |
|---|---|---|---|
| Cleared level *N* completely | *N+1* | ten fresh from *N+1* | 10 |
| Answered ten but did not clear *N* (Quizzy: only `correct` clears) | *N* | outstanding first, then already-cleared as practice, capped at ten ([:312](main/manager-api-node/src/services/quiz.service.js#L312)) | 10 |
| Cleared every level (`replay`) | `null` → `leastRecentlyPlayedLevel` ([:127-148](main/manager-api-node/src/services/quiz.service.js#L127-L148)) | that level's set, capped at ten | 10 |
| **Bank has no active questions in the language** | `null` | `bank.filter(q => q.level === null)` → `[]` | **0** |

The last row is the only empty case, and it is the one the swagger documents.

**Net effect.** Under an IST host: `answered_today: 10`, `day_complete: true`,
`questions: [10 items]` — the API says the day is done and hands over the next
level anyway. Under a UTC host: `answered_today: 0`, `day_complete: false`,
`questions: [10 items]` — the API affirmatively reports a fresh day. **Same
symptom, different cause.** The response fields tell you which.

---

## 4. Fix surface — every file and function that must change

| # | File | Function / lines | What has to change | Blocking? |
|---|---|---|---|---|
| 1 | [quiz.service.js](main/manager-api-node/src/services/quiz.service.js) | `resolveDeviceContext` [:43-70](main/manager-api-node/src/services/quiz.service.js#L43-L70) | Resolve and return the parent's zone (`ai_device.user_id → parent_profile.timezone`, `resolveTimezone` fallback). Single choke point for all seven callers. | **Yes** |
| 2 | [quiz.service.js](main/manager-api-node/src/services/quiz.service.js) | `nextQuestions` gate [:368-380](main/manager-api-node/src/services/quiz.service.js#L368-L380) | Replace `new Date()`+`setHours` with `startOfDayInstant(todayKeyInZone, tz)`. | **Yes** |
| 3 | [quiz.service.js](main/manager-api-node/src/services/quiz.service.js) | `dayKey` [:221-224](main/manager-api-node/src/services/quiz.service.js#L221-L224) + `daysByQuestionId` [:234-241](main/manager-api-node/src/services/quiz.service.js#L234-L241) | Replace local getters with `formatDateInTimezone(row.answered_at, tz)`; thread `tz` through both callers ([:276](main/manager-api-node/src/services/quiz.service.js#L276), [:912](main/manager-api-node/src/services/quiz.service.js#L912)). | **Yes** (D1) |
| 4 | [quiz.service.js](main/manager-api-node/src/services/quiz.service.js) | `nextQuestions` ordering [:308-321](main/manager-api-node/src/services/quiz.service.js#L308-L321) vs [:365-380](main/manager-api-node/src/services/quiz.service.js#L365-L380) | Move the gate above the selection; apply it to the payload. | **Yes** |
| 5 | [quiz.logic.js](main/manager-api-node/src/services/quiz.logic.js) | `levelCompletedToday` [:128-136](main/manager-api-node/src/services/quiz.logic.js#L128-L136) | Distinguish "cleared" from "cleared today". Caller must widen its `select` to include `result`. | **Yes, with #4** |
| 6 | [quiz.service.js](main/manager-api-node/src/services/quiz.service.js) | `todayRows` select [:370-373](main/manager-api-node/src/services/quiz.service.js#L370-L373) | Filter to `bankIds`; add `result` for #5. | Yes |
| 7 | [quiz.routes.js](main/manager-api-node/src/routes/quiz.routes.js) | `/next-questions` [:22-78](main/manager-api-node/src/routes/quiz.routes.js#L22-L78) | Update the swagger contract for the gated response; add a discriminator so "day complete" ≠ "bank empty". | Yes |
| 8 | [quiz.service.js](main/manager-api-node/src/services/quiz.service.js) | `allDeviceProgress` [:881-882](main/manager-api-node/src/services/quiz.service.js#L881-L882), [:958-963](main/manager-api-node/src/services/quiz.service.js#L958-L963) | Same boundary as #2/#3, resolved **per device**. Watch for N+1. Remove dead `now` at [:883](main/manager-api-node/src/services/quiz.service.js#L883). | Yes (D6) |
| 9 | [quiz.service.js](main/manager-api-node/src/services/quiz.service.js) | `clearDayGate` [:1058-1069](main/manager-api-node/src/services/quiz.service.js#L1058-L1069) | Same boundary as #2. | Yes (D7) |
| 10 | [package.json](main/manager-api-node/package.json#L100-L111) | jest block | Pin `TZ` (e.g. via `globalSetup` / `setupFiles`) so the suite runs where the bug is visible. | **Yes (D8)** |
| 11 | [quiz.level-batch.test.js](main/manager-api-node/tests/unit/quiz.level-batch.test.js#L68-L77) | `:68-77`, `:104-114`, `:132+` | Mocks must honour `answered_at.gte`; `toHaveLength(10)` assertions must reflect the new contract. | **Yes (D8)** |
| 12 | [quiz.reset-day.test.js](main/manager-api-node/tests/unit/quiz.reset-day.test.js#L39-L40) | `:39-40` | Stop reimplementing `startOfToday` / `dayKey`; use the real utility. | Yes (D8) |
| 13 | — | new tests | Boundary cases at 23:59 / 00:01 / 05:29 IST against a fixed `now`; replay + one answer (D4); gated-response shape (D3). | **Yes** |
| 14 | LiveKit Quizzy worker | *(outside this repo)* | Honour the gated response; define the "come back tomorrow" path. | **Yes — coordinate release** |
| 15 | [.env.example](main/manager-api-node/.env.example) | tz block | Correct the "abbreviations are refused" claim (D12). | No |
| 16 | [parent-app-quiz-analytics-api.md](main/manager-api-node/docs/parent-app-quiz-analytics-api.md#L240-L243) | `:240-243` | Retire the "engine uses server-local, analytics uses parent zone" caveat once they agree. | No |

Nothing outside `quiz.service.js`, `quiz.logic.js`, `quiz.routes.js` and the tests
needs to change for Quizzy. `utils/timezone.js` already exposes every function
required — no new utility is needed.

---

## 5. Order of operations, and what breaks if you reorder it

**Step 0 — Verify the premise.** Run the `/quiz/next-questions` probe after a
00:00–05:29 IST session (§8). If `answered_today` returns `10`, the boundary was
never the production problem and D3+D4 are the entire fix. Building D1/D2 first
without this is building on an unverified assumption.

**Step 1 — Merge and deploy `fix/timezone-mismatch`.** `utils/timezone.js` must
exist on the deploy branch before anything requires it (D11). Confirm production's
`HEAD` afterwards.

**Step 2 — D4 before D3.** Fixing `levelCompletedToday` is harmless on its own.
Enforcing the gate first, without it, locks every replay child out after one
question. This ordering is not a preference.

**Step 3 — D1 + D2 + D5 together, all four sites.** Splitting them reintroduces
exactly the disagreement `dayKey`'s comment warns about: the gate on one calendar
and the anti-trap on another, differing by a day on a non-IST host.

**Step 4 — D8 alongside, not after.** The suite currently passes in both the
broken and the fixed state. Until `TZ` is pinned and the mocks honour `where`,
there is no way to demonstrate that any of this worked.

**Step 5 — D3 and the worker, same release.** The API can start returning a gated
response only when the worker knows what to do with it. Shipping the API first
gives you a character with nothing to say — the 2026-08-15 failure mode.

**Step 6 — D6, D7 after.** Admin surfaces; no child is affected by getting these
last, but leaving them behind means the panel and the toy disagree in the interim.

---

## 6. Decisions that are product calls, not engineering calls

**What does a gated response look like on the wire?**
`questions: []` makes the API authoritative but is indistinguishable from "bank
has no content", which the swagger already reserves that shape for. A separate
signal — an explicit blocked flag, or a `next_available_at` instant the worker can
voice as "come back after breakfast" — costs nothing and removes the ambiguity.
Whatever is chosen has to be agreed with the worker before either side ships.

**Does the Daily Ten cap apply in replay?**
Replay is practice on already-cleared content
([:316-320](main/manager-api-node/src/services/quiz.service.js#L316-L320)).
Enforcing the gate caps practice at ten per day too. Intended, or should replay be
uncapped? This decision also changes how D4 should be fixed — if replay is
uncapped, `levelCompletedToday` never needs to fire there at all.

**Whose timezone is "the child's day"?**
The toy is physically with the child; the parent's phone might be anywhere. The
system's only usable zone is `parent_profile.timezone`, which is what every other
component uses. Using it keeps Quizzy consistent with Chat, Games, Progress and
Analytics — which is the whole point of the change — but it is a proxy, and worth
stating as one. Do not introduce `kid_profile.timezone` as a second source
(see D10).

**Should the API enforce, or the worker?**
Commit `b369713c` chose the worker. If that stands, the fix is a contract and a
test in a repository not covered by this analysis, and the same class of failure
can recur silently. If the API enforces, the gate becomes a constraint and the
worker's job shrinks to voicing it.

---

## 7. Same bug class elsewhere — not blocking Quizzy

Listed so they are not rediscovered later. None of these affects the Daily Ten.

| Component | Location | Mechanism | Boundary |
|---|---|---|---|
| Game streaks | [analytics.service.js:404-407](main/manager-api-node/src/services/analytics.service.js#L404-L407) | explicit UTC — `Date.UTC(getUTC*)` | 05:30 IST on every host |
| Per-MAC analytics time series | [deviceAnalytics.service.js:730](main/manager-api-node/src/services/deviceAnalytics.service.js#L730) | explicit UTC — `dateKeyUtc` | 05:30 IST on every host |
| Daily email report window | [emailReport.service.js:105-112](main/manager-api-node/src/services/emailReport.service.js#L105-L112) | server-local `setHours`, but the cron fires on IST | host-dependent |
| RFID tap analytics | [rfid.service.js:83-92](main/manager-api-node/src/services/rfid.service.js#L83-L92), [:297-331](main/manager-api-node/src/services/rfid.service.js#L297-L331) | server-local ranges, UTC labels | host-dependent, labels can be off by one |
| Admin device/user/session/token stats | [admin.service.js:521-724](main/manager-api-node/src/services/admin.service.js#L521-L724) | server-local ranges, UTC day keys | host-dependent |
| `getToday/MonthDeviceCount`, `getTodayActiveDevices` | [analytics.service.js:1358](main/manager-api-node/src/services/analytics.service.js#L1358), [:1397](main/manager-api-node/src/services/analytics.service.js#L1397), [:1435](main/manager-api-node/src/services/analytics.service.js#L1435), [:1536](main/manager-api-node/src/services/analytics.service.js#L1536) | server-local `setHours` | host-dependent |
| OTA `server_time` | [device.service.js:879-886](main/manager-api-node/src/services/device.service.js#L879-L886) | ships the **server's** zone name and offset to every ESP32 | — |

And one that is not a timezone bug but will be mistaken for one: the rollup writer
buckets `event_timestamp || server_received_at` — the **firmware** clock first
([deviceAnalytics.service.js:345-347](main/manager-api-node/src/services/deviceAnalytics.service.js#L345-L347))
— while the detail endpoints bucket `server_received_at` only
([mobile.service.js:234](main/manager-api-node/src/services/mobile.service.js#L234),
[:264](main/manager-api-node/src/services/mobile.service.js#L264)). A device with a
drifted clock can put the same event on two different days in two adjacent screens.

---

## 8. What to measure before and after

**The API's own answer.** After a session that finished the Daily Ten between
00:00 and 05:29 IST, any time after 06:00 IST the same day:

```bash
curl -s -H "x-service-key: $SERVICE_SECRET_KEY" \
  'http://139.59.7.72:8002/toy/quiz/next-questions?device_mac=AA:BB:CC:DD:EE:FF' \
  | jq '{answered_today, day_complete, level, replay, question_count:(.questions|length)}'
```

| Result | Meaning |
|---|---|
| `answered_today: 10, day_complete: true` | Host is IST. D1 was never the production problem; D3+D4 are the whole fix. |
| `answered_today: 0, day_complete: false` | Host is not IST. D1 and D3 are both live. |
| `question_count: 10` in either case | Confirms D3 independently of the timezone. |

**The host clock.**

```bash
ssh root@139.59.7.72 'timedatectl'
ssh root@139.59.7.72 'pm2 env $(pm2 id manager-api | tr -d "[] ") | grep -i "^TZ" || echo "TZ not set"'
ssh root@139.59.7.72 'node -e "console.log(process.env.TZ, Intl.DateTimeFormat().resolvedOptions().timeZone, new Date().getTimezoneOffset())"'
ssh root@139.59.7.72 'git -C /opt/cheeko-backend rev-parse HEAD'
```

**Rule out the human path (D7).**

```bash
ssh root@139.59.7.72 'pm2 logs manager-api --lines 5000 --nostream | grep "admin reset-day"'
```

**Whether real zones exist at all (D10).**

```sql
SELECT count(*) AS total,
       count(*) FILTER (WHERE timezone IS NOT NULL) AS with_timezone
FROM parent_profile;
```

**After the fix, the regression guard.** The probe in §1 is the acceptance test:
run the suite under `TZ=UTC` and under `TZ=Asia/Kolkata` and require identical
results. Today they differ; after the fix they must not.

---

## 9. Corrections to the earlier documents

Re-verification found four line-number errors in
[`TIMEZONE_RECONCILIATION.md`](TIMEZONE_RECONCILIATION.md) and one substantive
correction. None changes any conclusion.

| Where | Said | Correct |
|---|---|---|
| Reconciliation §7, §16 | `deviceAnalytics.service.js:323, 328` | **:324, :330** |
| Reconciliation §4, §16 | `timezone.js:42-44` for `DEFAULT_TIMEZONE` | **:44-46** (`:42` is a closing brace) |
| Reconciliation §8, §11 | `dayComplete` at `quiz.service.js:390-391` | **:379-380** (`:391` is `return {`) |
| Reconciliation §11 | *"the gate is evaluated 56 lines later"* | **47 lines** (:321 → :368) |
| Both documents | `.env.example` quoted as saying abbreviations are refused | The **quote is accurate**, but the claim inside it is **wrong** — `isValidTimezone('IST')` returns `true`, and [timezone.test.js:38-41](main/manager-api-node/tests/unit/timezone.test.js#L38-L41) documents that deliberately. See D12. |

Additionally, one earlier statement was under-qualified: *"the payload is never
empty."* It is never empty **while the bank has active content in the child's
language**. An empty bank yields `currentLevel: null` and therefore no questions —
which is the case the swagger already documents. Corrected in §3.

---

## 10. Confidence register

| # | Statement | Status | Evidence |
|---|---|---|---|
| 1 | Four sites in `quiz.service.js` compute the day from the process clock | **CONFIRMED** | :221-224, :368-369, :881-882, :1058-1059, all re-read |
| 2 | Those sites produce different boundaries on different hosts | **CONFIRMED** | §1 probe, three timezones, fixed inputs |
| 3 | `formatDateInTimezone` / `startOfDayInstant` are byte-identical across hosts | **CONFIRMED** | §1 probe |
| 4 | The quiz's gate and its anti-trap key agree with each other on every host | **CONFIRMED** | §1 probe — internally consistent, externally wrong |
| 5 | `resolveDeviceContext` never reads `parent_profile` | **CONFIRMED** | :43-70 |
| 6 | `resolveDeviceContext` has exactly seven callers | **CONFIRMED** | :254, :473, :538, :630, :767, :992, :1057 |
| 7 | `ai_device.user_id → parent_profile.user_id` is a single indexed unique lookup | **CONFIRMED** | schema.prisma :97, :124, :703 |
| 8 | `selectedIds` is built at :321, the gate at :368-380, and never re-consulted | **CONFIRMED** | full read of :252-424 |
| 9 | No `if (dayComplete)` branch exists in `nextQuestions` | **CONFIRMED** | full read of :252-424 |
| 10 | Enforcement was deliberately delegated to the worker | **CONFIRMED** | `b369713c` message; quiz.routes.js :51-53 |
| 11 | `levelCompletedToday` tests today's levels against the **lifetime** cleared set | **CONFIRMED** | quiz.logic.js :128-136; clearedIds built at :266-268 |
| 12 | Its implementation contradicts its own docstring | **CONFIRMED** | quiz.logic.js :122-123 vs :133-135 |
| 13 | In replay, it returns true on the first answer of the day | **CONFIRMED** | replay ⇒ `allCleared` ⇒ every level in `clearedIds` |
| 14 | It does **not** false-positive in normal play, practice or bonus paths | **CONFIRMED** | path analysis in D4; quiz.logic.js :106 |
| 15 | `todayRows` is not bank-filtered while `answerRows` is | **CONFIRMED** | :260-263 vs :370-373 |
| 16 | The payload is empty only when the bank has no active content | **CONFIRMED** | `idsForLevel` / replay / `leastRecentlyPlayedLevel` paths |
| 17 | Only two test files exercise `nextQuestions`, both with `where`-blind mocks | **CONFIRMED** | grep + read of both files |
| 18 | `quiz.level-batch.test.js:68-77` asserts ten questions in a day-complete state | **CONFIRMED** | read; mock returns the same rows to both queries |
| 19 | `quiz.reset-day.test.js:39-40` reimplements the defect in its assertions | **CONFIRMED** | read |
| 20 | The jest config pins no `TZ` | **CONFIRMED** | package.json :100-111 |
| 21 | Test fixtures use offset-less date strings (local-time parsing) | **CONFIRMED** | quiz.level-batch.test.js :100, :157 |
| 22 | Zero tests and zero docs mention `day_complete` / `answered_today` | **CONFIRMED** | grep over `tests/unit/*.test.js` and all `*.md` |
| 23 | `isValidTimezone('IST')` returns `true`, contradicting `.env.example` | **CONFIRMED** | measured on Node v20.20.2 / ICU 78.3; timezone.test.js :38-41 |
| 24 | `const now` at :883 is dead | **CONFIRMED** | read of :883-975 |
| 25 | `clearDayGate` slides the whole log back 24h and can reproduce the symptom | **CONFIRMED** | :1078-1090 |
| 26 | `utils/timezone.js` is absent from `origin/main` | **CONFIRMED** | `git cat-file -e` → fatal |
| 27 | Seed banks are 3 levels × 80 (or × 30) questions | **CONFIRMED** | `prisma/seed-data/*.csv` |
| 28 | `parent_profile.timezone` is NULL on every live account | **HIGH CONFIDENCE** | timezone.js :13-15; test header :5-7; no writer, no backfill |
| 29 | `DEFAULT_PARENT_TIMEZONE` is unset in production | **HIGH CONFIDENCE** | present only in `.env.example`, added by the undeployed commit |
| 30 | Production is running `origin/main` | **LIKELY** | `deploy.sh` hard-resets to it; hand-deploys not ruled out |
| 31 | How soon real children reach replay | **UNKNOWN** | live bank contents not in this repository |
| 32 | Production / dev host process timezone | **UNKNOWN** | not represented anywhere in this repository |
| 33 | Whether the LiveKit worker honours `day_complete` | **UNKNOWN** | worker source is in another repository |
| 34 | Whether "Reset day" was pressed during the observed test | **UNKNOWN** | check `pm2 logs manager-api` |

---

<sub>Analysis only — no files were modified and no fix was implemented. Evidence base: `cheeko-backend` @ `bac20344` (branch `fix/timezone-mismatch`), compared against `origin/main` @ `e9775e1c`. Probes run on Node v20.20.2 / ICU 78.3. 2026-08-21.</sub>
