# Home-screen progress ring — parent app brief

The backend side of the ring was fixed on 2026-08-20. This is the contract the
app should be written against, and the list of things that make a ring render
`null` when the API is behaving.

## The endpoint

```
GET /toy/api/mobile/homepage-activity
Authorization: Bearer <Firebase ID token>
```

Optional query params: `kidId` (or `kid_id`) to scope to one child, `mac` to
scope to one toy. Send neither and you get the whole account.

Response — note the envelope:

```json
{
  "code": 0,
  "msg": "success",
  "data": {
    "today_progress": {
      "date": "2026-08-20",
      "usage_time_seconds": 1320,
      "usageTimeSeconds": 1320,
      "card_tap_count": 4,
      "cardTapCount": 4,
      "ai_interaction_count": 3,
      "aiInteractionCount": 3,
      "games_played": 2,
      "gamesPlayed": 2
    },
    "todayProgress": { "date": "…", "usageTimeSeconds": 1320, "…": "…" },
    "recent_activity": null,
    "recent_activities": [],
    "moment_of_the_day": null
  }
}
```

Every field in `today_progress` is an integer. **None of them is ever `null`,
including for an account with no toys and no history — that case returns
explicit zeros.** If the app is showing `null`, it is not reading a `null` the
API sent.

## The five ways this renders `null`

**1. Reading past the envelope.** The payload is `{code, msg, data}`. The ring
value is `body.data.today_progress.usage_time_seconds`. Reading
`body.today_progress` gives `undefined`, which most JSON layers surface as
`null`. This is easy to get wrong here because sibling endpoints are
inconsistent: `/api/mobile/user-state` and `/api/mobile/parent-profile` return
the bare object with no envelope, while `/homepage-activity`,
`/progress/summary`, `/progress/trend` and `/progress/details` all use the
envelope. Check which one each call site expects.

**2. Dividing by a goal the API does not have.** There is no daily goal, target,
limit, or quota field anywhere in this API or its database. If the ring is
"minutes used out of a daily target", the target has to come from the app — a
constant, a remote-config value, or a parent setting the app owns. A ring
computing `used / data.daily_limit` will produce `null`/`NaN` on every account
forever, because `daily_limit` does not exist. **Check this first — it matches
the reported symptom exactly: null for every user, regardless of their data.**

**3. Treating an error body as data.** A non-200, or a 200 with `code != 0`,
has no usable `data`. The two that actually happen:
- **403 `Access denied`** — the Firebase uid on the token has no matching
  `sys_user` row. The parent needs to re-authenticate; the ring should not be
  the thing that reports this.
- **404 `Kid not found` / `Device not found`** — a `kidId` or `mac` was sent
  that this account does not own. Usually a stale id cached from a child or toy
  that was since removed. Clear it and retry unscoped.

Both need a visible error/retry state. A ring that silently renders the failure
as an empty value is indistinguishable from a quiet day.

**4. Conflating "nothing yet" with "failed to load".** `0` is a real, correct
value — a child who has not picked the toy up today has zero seconds. Model the
ring state as `loading | error | data(seconds)`. `0` belongs in `data`, and
should draw an empty ring with a "nothing yet today" label, never a spinner and
never a blank.

**5. Recomputing "today" on the device.** The API decides which calendar day the
numbers belong to, in the parent's timezone (from `parent_profile.timezone`,
defaulting to `Asia/Kolkata`), and returns it as `today_progress.date`. Render
that date. Deriving "today" from the phone clock puts the label and the number
out of step for anyone travelling or near midnight.

## Units and formatting

`usage_time_seconds` is seconds, already floored to whole completed minutes by
the backend — a day of 133 seconds returns `120`, not `133`. So
`seconds / 60` is a whole number; `Math.floor(seconds / 60)` is safe and a
no-op. Do not round up: showing "1 min" for 20 seconds of use is exactly what
the floor exists to prevent.

The same rule applies to `/progress/trend` bars and the `total_seconds` on
`/progress/details`, so the ring, the bars and the details total all agree for
the same window. The per-category items on the details screen (Game / Card /
AI Talk / Radio) each round down on their own, so they can add up to slightly
less than the total shown. That is expected — do not "fix" it by summing the
items to derive the total.

## Verifying against a real account

```bash
curl -s -H "Authorization: Bearer $FIREBASE_ID_TOKEN" \
  'https://<api-host>/toy/api/mobile/homepage-activity' | jq .
```

If `data.today_progress.usage_time_seconds` is a number and the ring still
reads null, the bug is in the app and one of the five above will be it. If the
call returns a non-zero `code`, fix that first.
