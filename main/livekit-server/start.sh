#!/bin/bash
set -e

# Export all environment variables for child processes
export LIVEKIT_URL="${LIVEKIT_URL}"
export LIVEKIT_API_KEY="${LIVEKIT_API_KEY}"
export LIVEKIT_API_SECRET="${LIVEKIT_API_SECRET}"
export GOOGLE_API_KEY="${GOOGLE_API_KEY}"
export MANAGER_API_URL="${MANAGER_API_URL}"
export MANAGER_API_SECRET="${MANAGER_API_SECRET}"

echo "Environment variables exported for workers"
echo "LIVEKIT_URL: ${LIVEKIT_URL}"

# Start Media API FIRST on port 8080 (Cerebrium's exposed port) - includes /health endpoint
echo "Starting Media API server on port 8080 (Cerebrium main port)..."
python -m uvicorn media_api:app --host 0.0.0.0 --port 8080 &

# Give media_api time to bind to port 8080
sleep 2

# Workers use their DEFAULT_PORT values (8081-8084) defined in each worker file
# They ignore the global PORT env var set by Cerebrium
echo "Starting Cheeko Agent Worker on port 8081..."
python workers/cheeko_xai.py dev &

# Wait for any process to exit so logs stay visible
wait -n
exit $?
