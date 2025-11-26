#!/bin/bash
set -e

echo "================================================"
echo "🚀 Starting MQTT Gateway Service"
echo "================================================"

# Function to check if a service is available
check_service() {
    local host=$1
    local port=$2
    local service_name=$3
    local max_attempts=30
    local attempt=1

    echo "⏳ Waiting for $service_name at $host:$port..."

    while [ $attempt -le $max_attempts ]; do
        if nc -z "$host" "$port" 2>/dev/null; then
            echo "✅ $service_name is ready!"
            return 0
        fi
        echo "   Attempt $attempt/$max_attempts - $service_name not ready yet..."
        sleep 2
        attempt=$((attempt + 1))
    done

    echo "❌ Failed to connect to $service_name at $host:$port after $max_attempts attempts"
    return 1
}

# Check required environment variables
echo "🔍 Checking environment variables..."

required_vars=(
    "UDP_PORT"
    "PUBLIC_IP"
    "EMQX_HOST"
    "EMQX_PORT"
    "MANAGER_API_URL"
)

missing_vars=()
for var in "${required_vars[@]}"; do
    if [ -z "${!var}" ]; then
        missing_vars+=("$var")
    fi
done

if [ ${#missing_vars[@]} -ne 0 ]; then
    echo "❌ Missing required environment variables:"
    printf '   - %s\n' "${missing_vars[@]}"
    exit 1
fi

echo "✅ All required environment variables are set"

# Display configuration
echo ""
echo "📋 Configuration:"
echo "   UDP Port: $UDP_PORT"
echo "   Public IP: $PUBLIC_IP"
echo "   EMQX Broker: $EMQX_HOST:$EMQX_PORT"
echo "   LiveKit URL: ${LIVEKIT_URL:-ws://localhost:7880}"
echo "   Manager API: $MANAGER_API_URL"
echo "   Media API: ${MEDIA_API_BASE:-http://localhost:8003}"
echo ""

# Wait for external services
echo "🔌 Checking external service connectivity..."

# Check EMQX broker
if ! check_service "$EMQX_HOST" "$EMQX_PORT" "EMQX Broker"; then
    echo "⚠️  Warning: EMQX broker not available, but continuing anyway..."
fi

# Check LiveKit server (extract host and port from URL)
LIVEKIT_HOST=$(echo "${LIVEKIT_URL:-ws://localhost:7880}" | sed -E 's|^ws://([^:]+):.*|\1|')
LIVEKIT_PORT=$(echo "${LIVEKIT_URL:-ws://localhost:7880}" | sed -E 's|^ws://[^:]+:([0-9]+).*|\1|')

if ! check_service "$LIVEKIT_HOST" "$LIVEKIT_PORT" "LiveKit Server"; then
    echo "❌ Error: LiveKit server is required but not available"
    echo "   Make sure LiveKit is running: cd ../livekit-server && docker-compose up -d"
    exit 1
fi

# Run ldconfig to ensure shared libraries are found
echo "🔧 Configuring shared libraries..."
ldconfig 2>/dev/null || true

# Display Opus library info
echo ""
echo "🎵 Opus Library Information:"
if [ -f "/app/node_modules/@discordjs/opus/prebuild" ]; then
    echo "   Native Opus bindings:"
    ls -lh /app/node_modules/@discordjs/opus/prebuild/ 2>/dev/null || echo "   (bindings directory not found)"
fi

echo ""
echo "================================================"
echo "🎯 Starting approom.js..."
echo "================================================"
echo ""

# Start the application with proper signal handling
exec node approom.js
