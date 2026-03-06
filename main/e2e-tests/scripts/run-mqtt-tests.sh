#!/bin/bash
#
# Run MQTT Gateway E2E Tests
#
# Uses a dedicated jest config that only requires MQTT broker + gateway
# (no Manager API auth needed).
#
# Usage:
#   ./scripts/run-mqtt-tests.sh
#   ./scripts/run-mqtt-tests.sh --verbose
#

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

cd "$PROJECT_DIR"

echo "============================================"
echo "  MQTT Gateway E2E Tests"
echo "============================================"
echo ""
echo "  Broker: ${DEV_HOST:-localhost}:${DEV_MQTT_PORT:-1883}"
echo "  Gateway: ${DEV_HOST:-localhost}:${DEV_GATEWAY_PORT:-8000}"
echo ""

npx jest \
  --config jest.mqtt.config.js \
  --forceExit \
  --detectOpenHandles \
  "$@"
