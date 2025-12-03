#!/bin/bash
set -e

echo "Starting LiveKit app (room.py dev)..."
python main.py dev &

echo "Starting Media API server on port 8003..."
python -m uvicorn media_api:app --host 0.0.0.0 --port 8003 &

# Wait for any process to exit so logs stay visible
wait -n
exit $?