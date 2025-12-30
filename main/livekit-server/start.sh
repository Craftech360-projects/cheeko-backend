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

# Start simple health check server on port 8080 (required by Cerebrium)
echo "Starting health check server on port 8080..."
python -c "
from http.server import HTTPServer, BaseHTTPRequestHandler
import threading

class HealthHandler(BaseHTTPRequestHandler):
    def do_GET(self):
        self.send_response(200)
        self.send_header('Content-type', 'application/json')
        self.end_headers()
        self.wfile.write(b'{\"status\": \"healthy\"}')
    def log_message(self, format, *args):
        pass  # Suppress logging

server = HTTPServer(('0.0.0.0', 8080), HealthHandler)
print('Health check server running on port 8080')
server.serve_forever()
" &

# Give health check server time to start
sleep 1

echo "Starting Cheeko Agent Worker on port 8081..."
python workers/cheeko_worker.py dev &

echo "Starting Math Tutor Agent Worker on port 8082..."
python workers/math_tutor_worker.py dev &

echo "Starting Riddle Solver Agent Worker on port 8083..."
python workers/riddle_solver_worker.py dev &

echo "Starting Word Ladder Agent Worker on port 8084..."
python workers/word_ladder_worker.py dev &

echo "Starting Media API server on port 8003..."
python -m uvicorn media_api:app --host 0.0.0.0 --port 8003 &

# Wait for any process to exit so logs stay visible
wait -n
exit $?