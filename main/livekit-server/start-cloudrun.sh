#!/bin/bash
set -e

echo "============================================"
echo "Starting LiveKit Agent for Cloud Run"
echo "Region: asia-south1 (Mumbai, India)"
echo "Health Check Port: ${PORT:-8080}"
echo "============================================"

# The LiveKit agents SDK automatically starts a health check server
# main.py reads PORT env var and passes it to WorkerOptions

echo "Starting LiveKit agent..."
exec python main.py start
