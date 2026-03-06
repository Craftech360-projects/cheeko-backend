#!/bin/bash
#
# Run ALL E2E Tests and generate unified dashboard report.
#
# Runs in sequence:
#   1. API tests (PactumJS/Jest)   -> reports/jest/api/{timestamp}/
#   2. MQTT tests (Jest)           -> reports/jest/mqtt/{timestamp}/
#   3. LiveKit tests (Jest)        -> reports/jest/livekit/{timestamp}/
#   4. UI tests (Playwright)       -> reports/playwright/{timestamp}/
#   4. Updates the unified reports.json index
#   5. Starts the report dashboard server
#
# Usage:
#   ./scripts/run-all-tests.sh          # Run all 3 modules
#   ./scripts/run-all-tests.sh --api    # Run only API tests
#   ./scripts/run-all-tests.sh --mqtt   # Run only MQTT tests
#   ./scripts/run-all-tests.sh --livekit # Run only LiveKit tests
#   ./scripts/run-all-tests.sh --ui     # Run only UI tests
#   ./scripts/run-all-tests.sh --no-dashboard  # Skip dashboard at end

set -o pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
cd "$PROJECT_DIR"

RUN_API=false
RUN_MQTT=false
RUN_LIVEKIT=false
RUN_UI=false
NO_DASHBOARD=false
EXIT_CODE=0

# Parse arguments
if [ $# -eq 0 ]; then
  RUN_API=true
  RUN_MQTT=true
  RUN_LIVEKIT=true
  RUN_UI=true
else
  for arg in "$@"; do
    case "$arg" in
      --api)  RUN_API=true ;;
      --mqtt) RUN_MQTT=true ;;
      --livekit) RUN_LIVEKIT=true ;;
      --ui)   RUN_UI=true ;;
      --no-dashboard) NO_DASHBOARD=true ;;
    esac
  done
fi

echo ""
echo "=========================================="
echo "  Cheeko E2E Test Suite"
echo "=========================================="
echo ""
echo "  Modules:  API=$RUN_API  MQTT=$RUN_MQTT  LIVEKIT=$RUN_LIVEKIT  UI=$RUN_UI"
echo ""

# ── 1. API Tests ─────────────────────────────────────────────────────
if [ "$RUN_API" = true ]; then
  echo ""
  echo "──────────────────────────────────────────"
  echo "  1/4  API Tests (manager-api-node)"
  echo "──────────────────────────────────────────"
  echo ""
  npx jest --config jest.config.js --testPathPattern=api/scenarios --forceExit --detectOpenHandles || EXIT_CODE=1
fi

# ── 2. MQTT Tests ────────────────────────────────────────────────────
if [ "$RUN_MQTT" = true ]; then
  echo ""
  echo "──────────────────────────────────────────"
  echo "  2/4  MQTT Tests (mqtt-gateway)"
  echo "──────────────────────────────────────────"
  echo ""
  npx jest --config jest.mqtt.config.js --forceExit --detectOpenHandles || EXIT_CODE=1
fi

# ── 3. LiveKit Tests ─────────────────────────────────────────────────
if [ "$RUN_LIVEKIT" = true ]; then
  echo ""
  echo "──────────────────────────────────────────"
  echo "  3/4  LiveKit Tests (media-api)"
  echo "──────────────────────────────────────────"
  echo ""
  npx jest --config jest.livekit.config.js --forceExit --detectOpenHandles || EXIT_CODE=1
fi

# ── 4. UI Tests ──────────────────────────────────────────────────────
if [ "$RUN_UI" = true ]; then
  echo ""
  echo "──────────────────────────────────────────"
  echo "  4/4  UI Tests (manager-web)"
  echo "──────────────────────────────────────────"
  echo ""
  npx playwright test || EXIT_CODE=1
fi

# ── 4. Update unified report index ──────────────────────────────────
echo ""
echo "──────────────────────────────────────────"
echo "  Updating report index..."
echo "──────────────────────────────────────────"
node scripts/update-report-index.js

# ── 5. Start dashboard (unless --no-dashboard) ──────────────────────
if [ "$NO_DASHBOARD" = false ]; then
  echo ""
  echo "──────────────────────────────────────────"
  echo "  Starting Report Dashboard..."
  echo "──────────────────────────────────────────"
  node scripts/report-server.js &
  DASHBOARD_PID=$!
  echo ""
  echo "  Dashboard PID: $DASHBOARD_PID"
  echo "  Press Ctrl+C to stop."
  echo ""
  wait $DASHBOARD_PID
fi

exit $EXIT_CODE
