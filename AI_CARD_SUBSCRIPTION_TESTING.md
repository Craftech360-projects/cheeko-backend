# AI Card Time Subscription - Testing Guide

## Prerequisites

- Migration applied to Supabase
- manager-api-node running locally on port 8002
- SERVICE_SECRET_KEY set in `.env`

## 1. Verify Migration

Run in Supabase SQL Editor to confirm tables exist:

```sql
-- Check table exists with constraint
SELECT constraint_name, constraint_type
FROM information_schema.table_constraints
WHERE table_name = 'ai_card_time_quota';

-- Check column was added to rfid_card_mapping
SELECT column_name, data_type, column_default
FROM information_schema.columns
WHERE table_name = 'rfid_card_mapping' AND column_name = 'monthly_time_limit_secs';

-- Check functions exist
SELECT routine_name
FROM information_schema.routines
WHERE routine_schema = 'public' AND routine_name LIKE '%ai_card%';
```

## 2. Seed Test Data

Run in Supabase SQL Editor:

```sql
-- Ensure you have at least one AI card mapped
INSERT INTO rfid_card_mapping (rfid_uid, card_type, notes, monthly_time_limit_secs, active)
VALUES ('ABCD1234', 'ai', 'Test Magic Card', 300, true)
ON CONFLICT (rfid_uid) DO UPDATE SET monthly_time_limit_secs = 300;

-- Ensure sys_user has a test user
-- (Skip if you already have users in sys_user)
```

## 3. API Testing

Set your base URL and service key:

```bash
BASE_URL="http://localhost:8002/toy"
SERVICE_KEY="your-service-secret-key"
```

### Test: Get AI Card Quota (Service Key)

```bash
# Should return quota for a card that exists
curl -s "$BASE_URL/subscription/quota/ai-card/ABCD1234" \
  -H "X-Service-Key: $SERVICE_KEY" | jq

# Should return 404 for non-existent card
curl -s "$BASE_URL/subscription/quota/ai-card/INVALID" \
  -H "X-Service-Key: $SERVICE_KEY" | jq
```

**Expected response (first call):**
```json
{
  "success": true,
  "data": {
    "rfidUid": "ABCD1234",
    "cardName": "Test Magic Card",
    "quotaType": "ai_card_time",
    "remaining": 300,
    "isExhausted": false,
    "limit": 300,
    "used": 0,
    "extraPurchased": 0,
    "monthKey": "2026-04"
  }
}
```

### Test: Consume Time (Service Key)

```bash
# Consume 30 seconds
curl -s -X POST "$BASE_URL/subscription/consume/ai-card-time/ABCD1234" \
  -H "X-Service-Key: $SERVICE_KEY" \
  -H "Content-Type: application/json" \
  -d '{"seconds": 30, "monthKey": "2026-04"}' | jq

# Consume 100 more seconds
curl -s -X POST "$BASE_URL/subscription/consume/ai-card-time/ABCD1234" \
  -H "X-Service-Key: $SERVICE_KEY" \
  -H "Content-Type: application/json" \
  -d '{"seconds": 100, "monthKey": "2026-04"}' | jq
```

**Expected:** `remaining: 170`, `secondsUsed: 130`

### Test: Recharge Card (Parent Auth)

```bash
# Need a valid bearer token for a parent user
PARENT_TOKEN="your-parent-jwt-token"

curl -s -X POST "$BASE_URL/subscription/recharge/ABCD1234" \
  -H "Authorization: Bearer $PARENT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"amount": 3600}' | jq
```

**Expected:** `remaining: 3470` (300 - 130 + 3600 = 3770), `extraPurchased: 3600`

### Test: Recharge Validation (Should Fail)

```bash
# Negative amount → 400
curl -s -X POST "$BASE_URL/subscription/recharge/ABCD1234" \
  -H "Authorization: Bearer $PARENT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"amount": -100}' | jq

# Over 24 hours → 400
curl -s -X POST "$BASE_URL/subscription/recharge/ABCD1234" \
  -H "Authorization: Bearer $PARENT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"amount": 99999}' | jq

# Missing amount → 400
curl -s -X POST "$BASE_URL/subscription/recharge/ABCD1234" \
  -H "Authorization: Bearer $PARENT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{}' | jq
```

### Test: My Cards (Parent Auth)

```bash
# Need user_id that has tapped cards
# First, ensure rfid_card_tap_log has entries for your user
curl -s "$BASE_URL/subscription/my-cards" \
  -H "Authorization: Bearer $PARENT_TOKEN" | jq
```

### Test: AI Card Summary (Admin Auth)

```bash
ADMIN_TOKEN="your-admin-jwt-token"

curl -s "$BASE_URL/subscription/ai-cards/summary?page=1&limit=10" \
  -H "Authorization: Bearer $ADMIN_TOKEN" | jq
```

### Test: AI Card Analytics (Admin Auth)

```bash
curl -s "$BASE_URL/subscription/ai-card-analytics" \
  -H "Authorization: Bearer $ADMIN_TOKEN" | jq
```

### Test: Quota Settings (Admin Auth)

```bash
# Get current settings
curl -s "$BASE_URL/subscription/ai-card-quota-settings" \
  -H "Authorization: Bearer $ADMIN_TOKEN" | jq

# Update fail mode
curl -s -X PUT "$BASE_URL/subscription/ai-card-quota-settings" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"failMode": "capped"}' | jq
```

### Test: Publish MQTT Exhaust (Service Key)

```bash
# This requires the MQTT gateway to be running
curl -s -X POST "$BASE_URL/subscription/publish-mqtt-exhaust" \
  -H "X-Service-Key: $SERVICE_KEY" \
  -H "Content-Type: application/json" \
  -d '{"macAddress": "AABBCCDDEEFF", "rfidUid": "ABCD1234", "cardName": "Test Magic Card"}' | jq
```

## 4. Exhaustion Test

Consume until exhausted, then verify the blocked state:

```bash
# Drain the card (it has 300s limit)
# After consuming enough, check that quotaExhausted is true
curl -s "$BASE_URL/subscription/quota/ai-card/ABCD1234" \
  -H "X-Service-Key: $SERVICE_KEY" | jq '.data.isExhausted'

# Should return true once exhausted
```

## 5. Database Verification

```sql
-- Check quota row was created
SELECT * FROM ai_card_time_quota WHERE rfid_uid = 'ABCD1234';

-- Verify the unique constraint works
-- This should fail with duplicate key error
INSERT INTO ai_card_time_quota (rfid_uid, month_key, seconds_used)
VALUES ('ABCD1234', '2026-04', 0);
```

## 6. Integration Test (Full Flow)

To test the complete flow including MQTT:

1. Start mqtt-gateway: `cd main/mqtt-gateway && node app.js`
2. Connect ESP32 device (or use MQTT client simulator)
3. Tap AI card → verify quota check passes
4. Talk for 30+ seconds → verify 30s consumed
5. Consume all quota → verify device receives `time_quota_exhausted` message

## Troubleshooting

| Error | Cause | Fix |
|-------|-------|-----|
| `42P10: no unique constraint` | Migration failed partially | Run cleanup SQL first (see migration file Step 0) |
| `401 Unauthorized` | Wrong SERVICE_SECRET_KEY | Check `.env` matches what you're sending |
| `Database not configured` | Supabase client not initialized | Verify `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` in `.env` |
| `Card not found` | rfid_uid doesn't exist in rfid_card_mapping | Insert test data first |
| `amount must not exceed 86400` | Validation working as expected | Use a smaller amount |
