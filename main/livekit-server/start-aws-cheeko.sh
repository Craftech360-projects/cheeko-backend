#!/bin/bash
set -euo pipefail

if [[ -z "${LIVEKIT_URL:-}" || -z "${LIVEKIT_API_KEY:-}" || -z "${LIVEKIT_API_SECRET:-}" ]]; then
  echo "LIVEKIT_URL, LIVEKIT_API_KEY, and LIVEKIT_API_SECRET are required."
  exit 1
fi

if [[ -z "${GOOGLE_API_KEY:-}" ]]; then
  echo "Warning: GOOGLE_API_KEY is not set. Gemini features may fail."
fi

if [[ -z "${MANAGER_API_URL:-}" || -z "${MANAGER_API_SECRET:-}" ]]; then
  echo "Warning: MANAGER_API_URL or MANAGER_API_SECRET is missing. Device/profile APIs may fail."
fi

export CHEEKO_PORT="${CHEEKO_PORT:-8081}"

echo "============================================"
echo "Starting Cheeko LiveKit worker on AWS"
echo "Worker: cheeko-agent"
echo "Health endpoint: http://0.0.0.0:${CHEEKO_PORT}/"
echo "============================================"

exec python workers/cheeko_worker.py start
