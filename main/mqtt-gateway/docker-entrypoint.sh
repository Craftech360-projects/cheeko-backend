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

# Skip connectivity checks - the Node.js app handles connections
echo "🔌 Skipping external service checks (app will connect on startup)..."

# Run ldconfig to ensure shared libraries are found
echo "🔧 Configuring shared libraries..."
ldconfig 2>/dev/null || true

echo ""
echo "================================================"
echo "🎯 Starting mqtt-gateway..."
echo "================================================"
echo ""

# Start the application with proper signal handling
exec node app.js
