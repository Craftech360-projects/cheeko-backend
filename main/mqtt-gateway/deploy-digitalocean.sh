#!/bin/bash

# Deployment script for EMQX + MQTT Gateway to DigitalOcean

set -e

echo "================================================"
echo "🚀 Deploying EMQX + MQTT Gateway to DigitalOcean"
echo "================================================"

# Configuration
DROPLET_IP="${DROPLET_IP:-139.59.11.236}"
DEPLOY_USER="${DEPLOY_USER:-root}"
DEPLOY_DIR="/opt/mqtt-gateway"

echo "📋 Configuration:"
echo "   Droplet IP: $DROPLET_IP"
echo "   Deploy User: $DEPLOY_USER"
echo "   Deploy Directory: $DEPLOY_DIR"
echo ""

# Files to include in deployment
DEPLOY_FILES=(
    "Dockerfile"
    "docker-compose.digitalocean.yml"
    "docker-entrypoint.sh"
    "package.json"
    "package-lock.json"
    "apppushtotalk.js"
    "app.js"
    "audio-worker.js"
    "mqtt-protocol.js"
    "ecosystem.config.js"
    ".env.digitalocean"
)

# Directories to include
DEPLOY_DIRS=(
    "core"
    "gateway"
    "mqtt"
    "livekit"
    "config"
    "audio"
    "utils"
    "constants"
)

echo "📦 Creating deployment package..."

# Create temp directory
TEMP_DIR=$(mktemp -d)
mkdir -p "$TEMP_DIR/mqtt-gateway"

# Copy files
for file in "${DEPLOY_FILES[@]}"; do
    if [ -f "$file" ]; then
        cp "$file" "$TEMP_DIR/mqtt-gateway/"
        echo "   ✓ $file"
    else
        echo "   ⚠ $file not found, skipping"
    fi
done

# Copy directories
for dir in "${DEPLOY_DIRS[@]}"; do
    if [ -d "$dir" ]; then
        cp -r "$dir" "$TEMP_DIR/mqtt-gateway/"
        echo "   ✓ $dir/"
    else
        echo "   ⚠ $dir/ not found, skipping"
    fi
done

# Rename docker-compose file and env file
mv "$TEMP_DIR/mqtt-gateway/docker-compose.digitalocean.yml" "$TEMP_DIR/mqtt-gateway/docker-compose.yml"
mv "$TEMP_DIR/mqtt-gateway/.env.digitalocean" "$TEMP_DIR/mqtt-gateway/.env"

# Create tarball
cd "$TEMP_DIR"
tar -czf mqtt-gateway.tar.gz mqtt-gateway
echo "✅ Package created"

# Upload to droplet
echo "⬆️  Uploading to droplet..."
scp mqtt-gateway.tar.gz ${DEPLOY_USER}@${DROPLET_IP}:/tmp/

# Deploy on droplet
echo "🔧 Deploying on droplet..."
ssh ${DEPLOY_USER}@${DROPLET_IP} << 'ENDSSH'
    set -e

    # Install Docker if not installed
    if ! command -v docker &> /dev/null; then
        echo "📦 Installing Docker..."
        curl -fsSL https://get.docker.com | sh
        systemctl enable docker
        systemctl start docker
    fi

    # Install Docker Compose if not installed
    if ! command -v docker-compose &> /dev/null; then
        echo "📦 Installing Docker Compose..."
        apt-get update
        apt-get install -y docker-compose-plugin
        # Create symlink for docker-compose command
        ln -sf /usr/libexec/docker/cli-plugins/docker-compose /usr/local/bin/docker-compose || true
    fi

    # Stop existing containers
    echo "🛑 Stopping existing containers..."
    cd /opt/mqtt-gateway 2>/dev/null && docker-compose down || true

    # Create deployment directory
    mkdir -p /opt/mqtt-gateway
    cd /opt/mqtt-gateway

    # Extract package
    echo "📦 Extracting package..."
    tar -xzf /tmp/mqtt-gateway.tar.gz --strip-components=1
    rm /tmp/mqtt-gateway.tar.gz

    # Create logs directory
    mkdir -p logs

    # Build and start containers
    echo "🏗️  Building and starting containers..."
    docker-compose build
    docker-compose up -d

    # Wait for services to start
    echo "⏳ Waiting for services to start..."
    sleep 10

    # Check status
    echo ""
    echo "📊 Service Status:"
    docker-compose ps

    echo ""
    echo "📋 Container Logs (last 20 lines):"
    docker-compose logs --tail=20

ENDSSH

# Cleanup
rm -rf "$TEMP_DIR"

echo ""
echo "================================================"
echo "✅ Deployment Complete!"
echo "================================================"
echo ""
echo "📍 EMQX Broker: $DROPLET_IP:1883 (MQTT)"
echo "📍 EMQX Dashboard: http://$DROPLET_IP:18083"
echo "📍 MQTT Gateway UDP: $DROPLET_IP:8884"
echo ""
echo "🔍 View logs: ssh $DEPLOY_USER@$DROPLET_IP 'cd /opt/mqtt-gateway && docker-compose logs -f'"
echo "🔄 Restart: ssh $DEPLOY_USER@$DROPLET_IP 'cd /opt/mqtt-gateway && docker-compose restart'"
echo "🛑 Stop: ssh $DEPLOY_USER@$DROPLET_IP 'cd /opt/mqtt-gateway && docker-compose down'"
echo ""
echo "⚠️  Don't forget to update manager-api OTA config to point to:"
echo "   - MQTT Broker: $DROPLET_IP:1883"
echo "   - UDP Server: $DROPLET_IP:8884"
echo ""
echo "✨ Done!"
