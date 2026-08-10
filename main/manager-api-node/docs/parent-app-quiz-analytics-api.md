# Parent App Quiz Analytics API

One endpoint backs the parent app's Analytics screen: per-level quiz and riddle
performance for every device the signed-in parent owns.

| Endpoint | Auth | Query params |
|---|---|---|
| `GET /toy/api/mobile/progress/quiz` | Firebase ID token (`Authorization: Bearer <idToken>`) | `period`, `mac` (optional) |

Source: [`src/routes/mobile.routes.js`](../src/routes/mobile.routes.js), logic in
[`src/services/mobile.service.js`](../src/services/mobile.service.js)
(`getQuizAnalytics`). Level and cleared rules come from
[`src/services/quiz.logic.js`](../src/services/quiz.logic.js).

---

## Request

| Param | Values | Default | Notes |
|---|---|---|---|
| `period` | `today` \| `week` \| `month` | `week` | `week` is the trailing 7 days including today, not Mon–Sun. `month` is the 1st to today. |
| `mac` | a device MAC | all owned devices | Rejected with 404 if the parent does not own it. |

```
GET /toy/api/mobile/progress/quiz?period=week
Authorization: Bearer <firebase-id-token>
```

Scoping is by account, not by device: with no `mac`, results **sum across every
device the parent owns**. A household with two toys gets one combined figure.
Pass `mac` if the screen is per-device.

---

## Response

Verified against dev on 2026-08-10, question arrays truncated:

```json
{
  "period": "week",
  "start_date": "2026-08-04",
  "end_date": "2026-08-10",
  "banks": [
    {
      "bank": "quiz",
      "available": true,
      "current_level": 3,
      "attempted": 26,
      "correct": 26,
      "points": 260,
      "levels": [
        {
          "level": 1,
          "attempted": 10,
          "correct": 10,
          "wrong": 0,
          "revealed": 0,
          "accuracy": 100,
          "points": 100,
          "replay": false,
          "cleared": true,
          "questions": [
            {
              "question_text": "How many legs does a spider have?",
              "correct_answer": "eight",
              "result": "correct",
              "points": 10,
              "answered_on": "2026-08-04"
            }
          ]
        },
        { "level": 2, "attempted": 10, "cleared": true, "questions": ["…"] },
        { "level": 3, "attempted": 6, "cleared": false, "questions": ["…"] }
      ]
    },
    {
      "bank": "riddle",
      "available": true,
      "current_level": 1,
      "attempted": 6,
      "correct": 6,
      "points": 60,
      "levels": ["…"]
    }
  ],
  "trend": {
    "direction": "new",
    "accuracy": 100,
    "previous_accuracy": null,
    "delta": null
  }
}
```

Wrapped in the standard envelope (`{ code, msg, data }`) by `success()`, so the
object above is `data`.

### Fields

| Field | Type | Meaning |
|---|---|---|
| `banks[].bank` | `"quiz"` \| `"riddle"` | Quizzy and Riddler respectively. |
| `banks[].available` | bool | `false` means the bank's tables are absent on this deployment. Render the character with an empty state, not an error. |
| `banks[].current_level` | int \| null | The level the child is on **now** — lowest level with an unanswered question. `null` once every level is cleared. Not necessarily a level in `levels[]`. |
| `banks[].attempted` / `correct` / `points` | int | Totals for the period across levels. |
| `levels[].level` | int | Level number from the question bank. |
| `levels[].attempted` | int | **Answer attempts, not distinct questions.** See below. |
| `levels[].correct` / `wrong` / `revealed` | int | Sum to `attempted`. Three outcomes, not two. |
| `levels[].accuracy` | int | `correct / attempted`, rounded, 0–100. |
| `levels[].points` | int | `10 × correct`. Derived, not stored. |
| `levels[].cleared` | bool | Every active question in the level has been cleared. **Can revert to false** — see below. |
| `levels[].replay` | bool | This level was already fully cleared before the period; a practice pass. |
| `questions[].result` | `"correct"` \| `"wrong"` \| `"revealed"` | |
| `questions[].correct_answer` | string | The bank's answer. Show it for `wrong` and `revealed`; it's a spoiler on `correct`. |
| `questions[].answered_on` | `YYYY-MM-DD` | Parent's timezone. |
| `trend.direction` | `"up"` \| `"down"` \| `"flat"` \| `"new"` \| `"none"` | See the trend section. |

---

## Three things that are easy to render wrongly

### 1. `attempted` counts attempts, so it can exceed the level's question count

A `wrong` answer does not clear a question — it comes back on a later day and
produces a second row. A ten-question level can legitimately report
`attempted: 12, correct: 8, wrong: 4`.

Do **not** label this "12 questions" or draw it as `x / 10`. Label it "12
answers" or "12 attempts". A parent seeing "12 of 10" will file a bug.

### 2. `revealed` is a third outcome, and it still advances the child

The quiz engine treats `correct` and `revealed` as *cleared*, so a revealed
question moves the child forward without them answering it. A level can read
`cleared: true` with `revealed: 3`, meaning three of the ten were given away.

Folding `revealed` into `wrong` overstates failure; folding it into `correct`
hides that the child never answered. It needs its own tile and its own icon.

### 3. `cleared: true` is not permanent

Cleared is computed live against the current bank. Adding a question to an
already-cleared level reopens it, deliberately — it pulls the child back to
finish. So a level can show cleared one week and active the next, and
`current_level` can move *backwards*.

Don't cache "level N cleared" as an achievement, and don't animate a
congratulation on every fetch where it's true.

---

## Trend

Compares this period's accuracy against the equal-length period immediately
before it, across both banks combined.

| `direction` | When | Suggested copy |
|---|---|---|
| `up` | ≥5 points better | "Better than last week" |
| `down` | ≥5 points worse | Neutral phrasing — no scolding |
| `flat` | within ±5 points | "About the same" |
| `new` | there is data now, none in the previous period | "First week of quizzes" — **never** "improving" |
| `none` | no attempts in this period either | Hide the banner entirely |

The ±5 dead band is deliberate. Accuracy over ten questions moves in whole-question
steps, so a 10-point swing is one question and not news. `previous_accuracy` and
`delta` are `null` for `new` and `none` — guard before formatting them.

---

## Empty and edge states the UI must handle

| Situation | Response | Render |
|---|---|---|
| Nothing played this period | `banks[]` entries with `levels: []` | Character card with "nothing yet", no ring |
| Bank tables absent | `available: false`, `levels: []` | Same empty state, no error |
| Parent owns no devices | `banks: []` | Whole-screen empty state |
| All levels cleared | `current_level: null` | "Finished every level" — do not print "Level null" |
| Replay pass | `replay: true` | Badge it. Otherwise repeated level numbers read as regression |

⚠️ **Known shape wart.** When a bank has no rows in the period, the entry omits
`correct` and `current_level`; when `available: false`, it also omits `attempted`
and `points`. Treat missing numeric fields as `0` and missing `current_level` as
`null`. This inconsistency should be fixed server-side — do not build a
dependency on the keys being absent.

---

## Not available in this version

Two fields in the original design are **not** in the response, because nothing in
the system records them. Don't leave placeholders for them:

- **The child's spoken answer** ("Your answer: 6"). The answer tables store only
  `(device_mac, question_id, result, answered_at)`.
- **Per-question timing** ("25s", "Avg. Time"). Derivable-looking from
  `answered_at` deltas, but that interval includes the character speaking and the
  child thinking, so it would be wrong.

Both need a schema change and are planned separately.

---

## Errors

| Code | Cause |
|---|---|
| 401 | Missing or invalid Firebase ID token. Returned by middleware before routing, so a typo'd path also 401s. |
| 403 | Token valid but no `sys_user` row for that uid. |
| 404 | `mac` supplied that the parent does not own. |
| 400 | `period` not one of `today`, `week`, `month`. |

---

## Caveats worth knowing

**Days are bucketed in the parent's timezone** (`parent_profile.timezone`, default
UTC), while the quiz engine's day-gate uses **server-local** midnight. A
late-evening answer can appear on a different date here than the day the engine
counted it in. Tracked separately.

**Levels per band are few** — 3 in the riddle bank — so children reach "all
cleared" and enter replay quickly. Expect `replay: true` in normal use, not as a
rare case.

**A device unbound from the account contributes nothing**, even if it has answer
rows: scoping starts from `ai_device.user_id`. If a parent reports missing
history, check the device is still bound before looking at this endpoint.
