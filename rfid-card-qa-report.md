# RFID Card Tap, Content Sync, and Analytics QA Report

Date: 2026-04-06

Environment:
- MQTT broker: `192.168.1.168:1883`
- Manager API: `http://127.0.0.1:8002/toy`
- Test client: `C:\Users\Acer\Cheeko-esp32-server\client.py`
- Python interpreter used for client runs: `C:\Users\Acer\Cheeko-esp32-server\main\livekit-server\env\Scripts\python.exe`

Scope:
- Validate RFID tap routing
- Validate content version handshake
- Validate content download/update behavior
- Validate tap analytics persistence behavior
- Cover normal paths and practical edge cases observed in this codebase

## Overall Result

Status: Mostly Pass

Summary:
- RFID routing works for unknown, AI, and content cards.
- Version comparison works for missing, matching, and stale client versions.
- Download manifest flow works for outdated and current content states.
- Tap analytics persistence works after Prisma client regeneration and service restart.
- Some edge cases are covered by behavior, but a few are still limited by current data model/runtime conditions, especially hash-based update checks where the current content pack has `latest_content_hash = null`.

## Test Matrix

| ID | Test Case | Input / Setup | Expected Result | Actual Result | Status |
|---|---|---|---|---|---|
| TC-01 | Unknown card lookup | `rfid_uid=E96C8A82` | Device receives `card_unknown` | Received `card_unknown` | Pass |
| TC-02 | AI card lookup | `rfid_uid=7AF0CBAD` | Device receives `card_ai` | Received `card_ai` | Pass |
| TC-03 | Content card, no local version | `rfid_uid=C94CB205` | Device receives `card_content` and update flag | Received `card_content`, `update_required=true`, `latest_version=\"1\"` | Pass |
| TC-04 | Content card, matching version | `rfid_uid=C94CB205`, `local_version=1` | Device receives `card_up_to_date` | Received `card_up_to_date`, `update_required=false` | Pass |
| TC-05 | Content card, stale version | `rfid_uid=C94CB205`, `local_version=0` | Device receives `card_content` and update flag | Received `card_content`, `update_required=true` | Pass |
| TC-06 | Download flow when version is stale | `rfid_uid=C94CB205`, `local_version=0`, `download_current_version=0`, `--request-download` | `download_response` with download required and file links | Received `download_response` with `status=\"download_required\"` and content manifest URLs | Pass |
| TC-07 | Download flow when version matches | `rfid_uid=C94CB205`, `local_version=1`, `download_current_version=1`, `--request-download` | `download_response` with up-to-date status | Received `download_response` with `status=\"up_to_date\"` | Pass |
| TC-08 | UID case normalization | `rfid_uid=c94cb205`, `local_version=1` | Same behavior as uppercase UID | Received `card_up_to_date`; server resolved pack correctly | Pass |
| TC-09 | Malformed / unmapped UID string | `rfid_uid=INVALID123` | Graceful non-crashing response, ideally unknown | Received `card_unknown` | Pass |
| TC-10 | Unknown card with irrelevant version metadata | `rfid_uid=E96C8A82`, `local_version=99` | Still treated as unknown | Received `card_unknown` | Pass |
| TC-11 | Duplicate `event_id` idempotency | Direct POST twice with `event_id=dup_event_readme_001` and changing `local_version` from `0` to `1` | Same log row updated, not duplicated | Both responses returned `logId=12`; second response reflected updated version state | Pass |
| TC-12 | Tap analytics table presence | Verify `rfid_card_tap_log` support in running stack | Tap logs persist instead of warning-only fallback | Confirmed working after stale Prisma client issue was resolved | Pass |

## Detailed Results

### TC-01 Unknown card lookup

Command:

```powershell
python client.py --mode rfid --rfid-uid E96C8A82
```

Observed result:
- Gateway responded with `card_unknown`
- No crash or timeout after correct broker configuration

Conclusion:
- Unknown-card routing is working.

### TC-02 AI card lookup

Command:

```powershell
python client.py --mode rfid --rfid-uid 7AF0CBAD
```

Observed result:
- Gateway responded with `card_ai`

Conclusion:
- AI card detection and routing are working.

### TC-03 Content card with no local version

Command:

```powershell
python client.py --mode rfid --rfid-uid C94CB205
```

Observed result:
- Gateway responded with `card_content`
- `skill_id = BEDTIME_ROUTINE_FINAL`
- `version = 1`
- `update_required = true`
- `latest_version = "1"`

Conclusion:
- First-time or metadata-missing content taps correctly trigger update-needed behavior.

### TC-04 Content card with matching version

Command:

```powershell
python client.py --mode rfid --rfid-uid C94CB205 --local-version 1
```

Observed result:
- Gateway responded with `card_up_to_date`
- `update_required = false`

Conclusion:
- Matching version short-circuit behavior is working.

### TC-05 Content card with stale version

Command:

```powershell
python client.py --mode rfid --rfid-uid C94CB205 --local-version 0
```

Observed result:
- Gateway responded with `card_content`
- `update_required = true`

Conclusion:
- Version mismatch detection is working.

### TC-06 Download flow with stale version

Command:

```powershell
python client.py --mode rfid --rfid-uid C94CB205 --local-version 0 --request-download --download-current-version 0
```

Observed result:
- Lookup returned update-needed state
- Follow-up `download_response` returned `status="download_required"`
- Manifest contained pack/file download links

Conclusion:
- When server version is newer, links are returned during the download request phase.

### TC-07 Download flow with matching version

Command:

```powershell
python client.py --mode rfid --rfid-uid C94CB205 --local-version 1 --request-download --download-current-version 1
```

Observed result:
- `download_response` returned `status="up_to_date"`

Conclusion:
- Download path correctly avoids unnecessary refresh when the toy is already current.

### TC-08 UID case normalization

Command:

```powershell
python client.py --mode rfid --rfid-uid c94cb205 --local-version 1
```

Observed result:
- Gateway responded with `card_up_to_date`
- `download_manifest_path` resolved to uppercase canonical UID path `/admin/rfid/card/content/download/C94CB205`

Conclusion:
- UID normalization is working.

### TC-09 Malformed / unmapped UID handling

Command:

```powershell
python client.py --mode rfid --rfid-uid INVALID123
```

Observed result:
- Gateway responded with `card_unknown`

Conclusion:
- The path is resilient to malformed or non-matching identifiers and degrades safely to unknown-card handling.

### TC-10 Unknown card with extra version metadata

Command:

```powershell
python client.py --mode rfid --rfid-uid E96C8A82 --local-version 99
```

Observed result:
- Gateway still responded with `card_unknown`

Conclusion:
- Unknown-card classification is not incorrectly influenced by client version metadata.

### TC-11 Duplicate event idempotency

Direct API calls:

```powershell
Invoke-RestMethod -Method Post -Uri 'http://127.0.0.1:8002/toy/admin/rfid/card/tap' -ContentType 'application/json' -Body (@{
  event_id='dup_event_readme_001'
  mac_address='00:16:3e:ac:b5:38'
  rfid_uid='C94CB205'
  local_version='0'
  source='qa_readme_test'
} | ConvertTo-Json)
```

```powershell
Invoke-RestMethod -Method Post -Uri 'http://127.0.0.1:8002/toy/admin/rfid/card/tap' -ContentType 'application/json' -Body (@{
  event_id='dup_event_readme_001'
  mac_address='00:16:3e:ac:b5:38'
  rfid_uid='C94CB205'
  local_version='1'
  source='qa_readme_test'
} | ConvertTo-Json)
```

Observed result:
- First response returned `logId = 12`, `clientVersion = "0"`, `updateRequired = true`
- Second response also returned `logId = 12`, `clientVersion = "1"`, `updateRequired = false`

Conclusion:
- `event_id` idempotency is working through upsert semantics.

### TC-12 Analytics persistence behavior

Observed result:
- The running stack persists tap events into the card-tap log path instead of only returning handshake data
- This was previously blocked by a stale generated Prisma client, not by missing schema

Conclusion:
- Analytics persistence is functional in the current environment.

## Corner Cases Covered

Covered:
- Unknown UID
- Recognized AI card
- Recognized content card
- Missing local version
- Matching local version
- Lower local version
- Lowercase known UID
- Non-standard / malformed UID string
- Unknown card combined with client-side version metadata
- Duplicate event replay with same `event_id`
- Download request when stale
- Download request when current

## Corner Cases Not Fully Verified

These are included for completeness, but they were not fully executable with the current content data:

1. Same version, different content hash
- Reason:
  Current tested content pack returned `latest_content_hash = null`
- Impact:
  Hash-only mismatch logic could not be meaningfully validated end to end

2. Blank UID payload through client CLI
- Reason:
  `client.py` requires a non-empty `--rfid-uid`
- Impact:
  This specific malformed-input case was not exercised through the client entrypoint

3. Authenticated analytics readback via REST
- Reason:
  No bearer token was provided during the test run
- Impact:
  The protected endpoints `GET /admin/rfid/card/tap-logs` and `GET /admin/rfid/card/tap-analytics/summary` were not called from the client in this round, although persistence behavior itself was verified

## Quality Notes

- The lookup/update/download flow is consistent with the current implementation plan.
- Download URLs are not pushed in the initial `card_lookup` response when a version is stale; instead, the initial response marks the content as needing update and provides `download_manifest_path`, and the actual file links are returned on `download_request`.
- During QA, one real client-side issue was found and corrected earlier in the session: the test client had been sending `content_download_request`, while the gateway expects `download_request`.

## Final Assessment

Recommendation: Accept for backend/gateway QA with one noted residual gap.

Accepted areas:
- RFID routing
- Version handshake
- Download decision logic
- Duplicate-event idempotency
- Analytics persistence path

Residual gap:
- Hash-only update comparison still needs one explicit end-to-end test against a content pack that has a non-null `content_hash`
