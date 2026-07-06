#!/usr/bin/env bash
# Bootstrap EMQX rule(s) via the REST API. Idempotent: skips a rule if its
# name already exists. Runs on the server where EMQX is reachable on localhost.
#
#   Rule rule_server_ingest:
#     SQL   : SELECT payload,clientid FROM "device-server"
#     Action: republish -> internal/server-ingest
#     Payload: {"orginal_payload":${payload},"sender_client_id":"${clientid}"}
set -euo pipefail

EMQX_URL="${EMQX_URL:-http://localhost:18083}"
EMQX_USER="${EMQX_USER:-admin}"
EMQX_PASS="${EMQX_PASS:-public}"

TOKEN=$(curl -s -X POST "$EMQX_URL/api/v5/login" -H "Content-Type: application/json" \
  -d "{\"username\":\"$EMQX_USER\",\"password\":\"$EMQX_PASS\"}" \
  | python3 -c "import sys,json;print(json.load(sys.stdin)['token'])")

if curl -s "$EMQX_URL/api/v5/rules?limit=1000" -H "Authorization: Bearer $TOKEN" \
   | grep -q '"name":"rule_server_ingest"'; then
  echo "rule_server_ingest already exists — skipping"
  exit 0
fi

curl -s -X POST "$EMQX_URL/api/v5/rules" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{
    "name": "rule_server_ingest",
    "sql": "SELECT payload,clientid FROM \"device-server\"",
    "enable": true,
    "actions": [
      {
        "function": "republish",
        "args": {
          "topic": "internal/server-ingest",
          "qos": 0,
          "retain": false,
          "payload": "{\"orginal_payload\":${payload},\"sender_client_id\":\"${clientid}\"}"
        }
      }
    ]
  }' -w "\nHTTP:%{http_code}\n"
echo "rule_server_ingest created"
