# Cheeko Managed Platform — Setup Guide

> Step-by-step guide to deploy the Cheeko managed platform using Hypercore microVMs and Docker. This covers everything from server preparation to spawning per-user OpenClaw instances.

---

## Table of Contents

1. [Overview](#overview)
2. [Prerequisites](#prerequisites)
3. [Step 1: Prepare the Server](#step-1-prepare-the-server)
4. [Step 2: Build the Docker Image](#step-2-build-the-docker-image)
5. [Step 3: Push to Docker Registry](#step-3-push-to-docker-registry)
6. [Step 4: Install Hypercore](#step-4-install-hypercore)
7. [Step 5: Set Up Containerd](#step-5-set-up-containerd)
8. [Step 6: Configure DNS & TLS](#step-6-configure-dns--tls)
9. [Step 7: Start Hypercore Cluster](#step-7-start-hypercore-cluster)
10. [Step 8: Spawn a User VM](#step-8-spawn-a-user-vm)
11. [Step 9: Device Activation Flow](#step-9-device-activation-flow)
12. [Step 10: Managing VMs](#step-10-managing-vms)
13. [Updating the Platform](#updating-the-platform)
14. [Troubleshooting](#troubleshooting)

---

## Overview

The Cheeko managed platform provisions a fully configured OpenClaw + Bridge instance for each user who doesn't have their own OpenClaw setup. When a user buys a Cheeko ESP32 device, we spin up an isolated microVM with everything pre-configured. The user powers on the device, enters an activation code, and voice conversations work immediately.

```
What each user gets (inside their own microVM):

┌──────────────────────────────────────────────────┐
│  MicroVM (Firecracker)                           │
│                                                  │
│  ┌──────────────┐    ┌─────────────────────────┐ │
│  │  OpenClaw    │    │  Cheekoclaw Bridge      │ │
│  │  Gateway     │◄──►│  (Voice Pipeline)       │ │
│  │  :18789      │    │  :8081                  │ │
│  │              │    │                         │ │
│  │  • LLM Agent │    │  • Deepgram STT         │ │
│  │  • Cheeko    │    │  • ElevenLabs TTS       │ │
│  │    Plugin    │    │  • Opus Audio Codec     │ │
│  │  • OTA       │    │                         │ │
│  │  • Dashboard │    │                         │ │
│  └──────────────┘    └─────────────────────────┘ │
│                                                  │
└──────────────────────────────────────────────────┘
         ▲                      ▲
         │ HTTPS                │ WebSocket
         │                      │
    Dashboard              ESP32 Device
    (browser)              (user's device)
```

**Flow**: `ESP32 Device → Bridge (:8081) → OpenClaw (:18789) → LLM (Gemini/Claude)`

---

## Prerequisites

### Server Requirements

- **OS**: Ubuntu 22.04+ or Debian 12+
- **CPU**: Minimum 4 cores (8+ recommended). Must support KVM virtualization.
- **RAM**: Minimum 8GB (16GB+ recommended)
- **Disk**: Minimum 50GB SSD
- **Network**: Static public IP address
- **KVM**: Hardware virtualization enabled (`/dev/kvm` must exist)

### Software Requirements

- Docker (for building the image locally)
- A domain name with DNS access (for wildcard subdomains)
- `certbot` (for TLS certificates)
- `dmsetup` (for containerd device-mapper snapshotter)

### API Keys Required

| Service | Purpose | Get it from |
|---------|---------|-------------|
| Google AI / Anthropic | LLM (AI responses) | https://aistudio.google.com or https://console.anthropic.com |
| Deepgram | Speech-to-Text | https://console.deepgram.com |
| ElevenLabs | Text-to-Speech | https://elevenlabs.io |

---

## Step 1: Prepare the Server

### 1.1 Verify KVM Support

SSH into your server and check that KVM is available:

```bash
ls -la /dev/kvm
```

You should see `/dev/kvm` listed. If not, your server doesn't support hardware virtualization — you need a KVM-enabled VPS or bare-metal server.

### 1.2 Install Required Packages

```bash
sudo apt update && sudo apt install -y \
  curl wget git \
  docker.io docker-compose \
  thin-provisioning-tools \
  dmsetup \
  bc \
  certbot \
  python3 python3-pip
```

### 1.3 Enable Docker

```bash
sudo systemctl enable docker
sudo systemctl start docker
sudo usermod -aG docker $USER
```

Log out and back in for the group change to take effect.

### 1.4 Check Server Resources

```bash
# Check CPU cores
nproc

# Check RAM
free -h

# Check disk space
df -h /

# Check KVM capabilities
lscpu | grep Virtualization
```

**Capacity planning**: Each user VM uses 1 CPU core + 2GB RAM. Reserve 2 cores + 2GB for the host OS and Hypercore. On an 8-core/16GB server, you can run ~6 user VMs.

---

## Step 2: Build the Docker Image

The Docker image contains everything a user needs: OpenClaw, the Cheeko Plugin (OTA + Dashboard), and the Cheekoclaw Bridge. It's built once and reused for every user.

### 2.1 Create the Project Directory

```bash
mkdir -p ~/cheeko-platform
cd ~/cheeko-platform
```

### 2.2 Prepare OpenClaw Source

Clone and build OpenClaw (or copy your existing build):

```bash
# Clone OpenClaw
git clone <your-openclaw-repo> openclaw
cd openclaw
npm install
npm run build
cd ..
```

### 2.3 Prepare the Cheeko Plugin

Copy the Cheeko plugin into the extensions directory:

```bash
# The plugin should be at openclaw/extensions/cheeko/
# It includes OTA routes, dashboard, and bridge manager
ls openclaw/extensions/cheeko/
```

### 2.4 Prepare the Bridge

Copy the Cheekoclaw Bridge Python code:

```bash
# The bridge is bundled inside the plugin at:
# openclaw/extensions/cheeko/bridge/
ls openclaw/extensions/cheeko/bridge/
```

### 2.5 Create the Dockerfile

```bash
cat > Dockerfile << 'DOCKEREOF'
# Cheeko OpenClaw — Docker Image for Hypercore MicroVMs
# Contains: OpenClaw + Cheeko Plugin + Cheekoclaw Bridge
# Usage: hypercore cluster spawn --image-ref cheeko/openclaw:latest

FROM node:22-bookworm AS builder

# Install pnpm for build
RUN npm install -g pnpm

# Copy OpenClaw source and build
WORKDIR /build
COPY openclaw/ .
RUN pnpm install --frozen-lockfile
RUN pnpm build

# Create tarball for global install
RUN pnpm pack

# ---------- Runtime image ----------
FROM node:22-bookworm-slim

# Install system dependencies
RUN apt-get update && apt-get install -y \
    curl \
    git \
    ca-certificates \
    python3 \
    python3-pip \
    python3-venv \
    libopus0 \
    && rm -rf /var/lib/apt/lists/*

# Install Python dependencies for the Bridge
RUN pip3 install --break-system-packages \
    opuslib \
    websockets \
    deepgram-sdk \
    httpx \
    fastapi \
    uvicorn

# Install OpenClaw from built tarball
COPY --from=builder /build/*.tgz /tmp/openclaw.tgz
RUN npm install -g /tmp/openclaw.tgz && rm /tmp/openclaw.tgz

# Create app user
RUN useradd -m -s /bin/bash cheeko
USER cheeko
WORKDIR /home/cheeko
ENV HOME=/home/cheeko

# Create config directories
RUN mkdir -p ~/.openclaw/agents/main/agent

# Copy entrypoint script
COPY --chown=cheeko:cheeko entrypoint.sh /opt/entrypoint.sh
RUN chmod +x /opt/entrypoint.sh

# Expose ports: OpenClaw gateway + Bridge
EXPOSE 18789 8081

# Health check
HEALTHCHECK --interval=10s --timeout=5s --start-period=30s --retries=3 \
    CMD curl -f http://localhost:18789/health || exit 1

# Default environment (overridden per-user at spawn time)
ENV OPENCLAW_PORT=18789
ENV BRIDGE_PORT=8081

CMD ["/opt/entrypoint.sh"]
DOCKEREOF
```

### 2.6 Create the Entrypoint Script

This script runs inside every VM on boot. It reads environment variables and writes the per-user configuration.

```bash
cat > entrypoint.sh << 'ENTRYEOF'
#!/bin/bash
# Cheeko OpenClaw — Entrypoint Script
# Runs inside each user's microVM on boot.
# Configures OpenClaw + Cheeko Plugin from environment variables.

set -e

echo "=== Cheeko OpenClaw Starting ==="

# --- Generate defaults for optional values ---
GATEWAY_TOKEN="${OPENCLAW_GATEWAY_TOKEN:-$(openssl rand -hex 24)}"
GATEWAY_PORT="${OPENCLAW_PORT:-18789}"
BRIDGE_PORT="${BRIDGE_PORT:-8081}"
LLM_PROVIDER="${LLM_PROVIDER:-google}"
LLM_MODEL="${LLM_MODEL:-google/gemini-3-pro-preview}"

# Validate token is safe for JSON
if [[ ! "$GATEWAY_TOKEN" =~ ^[a-zA-Z0-9_-]+$ ]]; then
  echo "WARNING: Token contains special characters, generating safe token"
  GATEWAY_TOKEN=$(openssl rand -hex 24)
fi

# --- Check required API keys ---
MISSING=""
if [ -z "$DEEPGRAM_API_KEY" ]; then MISSING="$MISSING DEEPGRAM_API_KEY"; fi
if [ -z "$ELEVENLABS_API_KEY" ]; then MISSING="$MISSING ELEVENLABS_API_KEY"; fi

if [ -z "$GOOGLE_API_KEY" ] && [ -z "$ANTHROPIC_API_KEY" ]; then
  MISSING="$MISSING GOOGLE_API_KEY|ANTHROPIC_API_KEY"
fi

if [ -n "$MISSING" ]; then
  echo "ERROR: Missing required environment variables:$MISSING"
  echo "Cannot start without API keys."
  exit 1
fi

# --- Determine LLM auth profile ---
if [ -n "$GOOGLE_API_KEY" ]; then
  AUTH_PROFILE_KEY="google:default"
  AUTH_PROFILE_JSON=$(cat <<AUTHEOF
{
  "version": 1,
  "profiles": {
    "google:default": {
      "type": "api_key",
      "provider": "google",
      "key": "${GOOGLE_API_KEY}"
    }
  },
  "lastGood": {
    "google": "google:default"
  }
}
AUTHEOF
  )
  AUTH_SECTION='"google:default": { "provider": "google", "mode": "api_key" }'
elif [ -n "$ANTHROPIC_API_KEY" ]; then
  AUTH_PROFILE_KEY="anthropic:default"
  LLM_MODEL="${LLM_MODEL:-anthropic/claude-sonnet-4-20250514}"
  AUTH_PROFILE_JSON=$(cat <<AUTHEOF
{
  "version": 1,
  "profiles": {
    "anthropic:default": {
      "type": "api_key",
      "provider": "anthropic",
      "key": "${ANTHROPIC_API_KEY}"
    }
  },
  "lastGood": {
    "anthropic": "anthropic:default"
  }
}
AUTHEOF
  )
  AUTH_SECTION='"anthropic:default": { "provider": "anthropic", "mode": "api_key" }'
fi

# --- Write auth-profiles.json ---
mkdir -p ~/.openclaw/agents/main/agent
echo "$AUTH_PROFILE_JSON" > ~/.openclaw/agents/main/agent/auth-profiles.json
echo "Created auth-profiles.json"

# --- Write openclaw.json (main config) ---
cat > ~/.openclaw/openclaw.json << CFGEOF
{
  "auth": {
    "profiles": {
      ${AUTH_SECTION}
    }
  },
  "agents": {
    "defaults": {
      "model": {
        "primary": "${LLM_MODEL}"
      },
      "workspace": "/home/cheeko/workspace"
    }
  },
  "gateway": {
    "port": ${GATEWAY_PORT},
    "mode": "local",
    "bind": "lan",
    "auth": {
      "mode": "token",
      "token": "${GATEWAY_TOKEN}"
    }
  },
  "plugins": {
    "entries": {
      "cheeko": {
        "enabled": true,
        "config": {
          "deepgramApiKey": "${DEEPGRAM_API_KEY}",
          "deepgramModel": "${DEEPGRAM_MODEL:-nova-2}",
          "elevenlabsApiKey": "${ELEVENLABS_API_KEY}",
          "elevenlabsVoiceId": "${ELEVENLABS_VOICE_ID:-21m00Tcm4TlvDq8ikWAM}",
          "elevenlabsModelId": "${ELEVENLABS_MODEL_ID:-eleven_turbo_v2_5}",
          "bridgePort": ${BRIDGE_PORT}
        }
      }
    }
  }
}
CFGEOF

# --- Create workspace ---
mkdir -p ~/workspace

echo ""
echo "============================================"
echo "  CHEEKO OPENCLAW READY"
echo "============================================"
echo ""
echo "  Gateway:   http://0.0.0.0:${GATEWAY_PORT}"
echo "  Bridge:    ws://0.0.0.0:${BRIDGE_PORT}/voice/stream"
echo "  Dashboard: http://0.0.0.0:${GATEWAY_PORT}/cheeko/dashboard"
echo "  OTA:       http://0.0.0.0:${GATEWAY_PORT}/toy/ota"
echo "  Token:     ${GATEWAY_TOKEN}"
echo ""

# --- Start OpenClaw gateway (plugin auto-starts bridge) ---
exec openclaw gateway run --bind lan --port "${GATEWAY_PORT}"
ENTRYEOF

chmod +x entrypoint.sh
```

### 2.7 Build the Image

```bash
cd ~/cheeko-platform
docker build -t cheeko/openclaw:latest .
```

### 2.8 Test Locally (Optional but Recommended)

Before pushing, verify the image works:

```bash
docker run -d --name cheeko-test \
  -p 18789:18789 \
  -p 8081:8081 \
  -e GOOGLE_API_KEY="your-google-api-key" \
  -e DEEPGRAM_API_KEY="your-deepgram-key" \
  -e ELEVENLABS_API_KEY="your-elevenlabs-key" \
  cheeko/openclaw:latest

# Check logs
docker logs -f cheeko-test

# Test OTA endpoint
curl http://localhost:18789/toy/ota -H "Device-Id: test-001"

# Test health
curl http://localhost:18789/health

# Clean up
docker stop cheeko-test && docker rm cheeko-test
```

---

## Step 3: Push to Docker Registry

### Option A: Docker Hub (Public/Private)

```bash
# Login to Docker Hub
docker login

# Tag and push
docker tag cheeko/openclaw:latest docker.io/cheeko/openclaw:latest
docker push docker.io/cheeko/openclaw:latest
```

### Option B: Vistara Registry (Hypercore's built-in registry)

```bash
docker tag cheeko/openclaw:latest registry.vistara.dev/cheeko/openclaw:latest
docker push registry.vistara.dev/cheeko/openclaw:latest
```

Use whichever registry you prefer. The image reference will be used when spawning VMs.

---

## Step 4: Install Hypercore

### 4.1 Download Hypercore

```bash
# Download the latest release
curl -LO https://github.com/Vistara-Labs/hypercore/releases/download/v0.0.2/hypercore.tar.gz

# Extract to /opt
sudo tar -xf hypercore.tar.gz -C /opt

# Add to PATH
echo 'export PATH="$PATH:/opt/hypercore/bin"' >> ~/.bashrc
source ~/.bashrc
```

### 4.2 Verify Installation

```bash
# Check hypercore binary
hypercore --help

# Verify containerd is included
ls /opt/hypercore/bin/
# Should show: hypercore, containerd, firecracker, cloud-hypervisor, runc, etc.
```

### 4.3 Build from Source (Alternative)

If you need the latest version:

```bash
git clone https://github.com/Vistara-Labs/hypercore.git /tmp/hypercore
cd /tmp/hypercore
make build
sudo ln -s $PWD/bin/containerd-shim-hypercore-example /usr/local/bin/
```

---

## Step 5: Set Up Containerd

Hypercore uses containerd with a device-mapper snapshotter to manage container images for VMs.

### 5.1 Run the Containerd Setup Script

```bash
# This creates the device-mapper thin-pool and starts containerd
sudo /opt/hypercore/bin/hypercore-containerd
```

**What this does:**
- Creates `/var/lib/hypercore/devmapper/data` (512MB thin-pool data file)
- Creates `/var/lib/hypercore/devmapper/metadata` (1GB metadata file)
- Sets up a device-mapper thin-pool named `hypercore-dev-thinpool`
- Starts containerd listening on `/var/lib/hypercore/containerd.sock`

### 5.2 Verify Containerd

In another terminal:

```bash
# Check containerd is running
sudo ls /var/lib/hypercore/containerd.sock

# Check the device-mapper pool
sudo dmsetup status hypercore-dev-thinpool
```

**Important**: The containerd process must stay running. Run it in a separate terminal, tmux session, or set it up as a systemd service:

```bash
# Create systemd service for containerd
sudo tee /etc/systemd/system/hypercore-containerd.service << 'EOF'
[Unit]
Description=Hypercore Containerd
After=network.target

[Service]
Type=simple
ExecStart=/opt/hypercore/bin/hypercore-containerd
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable hypercore-containerd
sudo systemctl start hypercore-containerd
```

---

## Step 6: Configure DNS & TLS

Each user VM gets a unique subdomain (e.g., `user-abc.cheeko.io`). This requires wildcard DNS and TLS.

### 6.1 Set Up Wildcard DNS

Go to your domain registrar's DNS settings and add:

```
Type: A
Name: *.cheeko.io    (or your domain)
Value: <YOUR_SERVER_PUBLIC_IP>
TTL: 300
```

This makes `anything.cheeko.io` point to your server. Hypercore's reverse proxy routes each subdomain to the correct VM.

Also add these records for your core services:

```
Type: A    Name: cheeko.io            Value: <YOUR_SERVER_IP>
Type: A    Name: cluster.cheeko.io    Value: <YOUR_SERVER_IP>
```

### 6.2 Generate Wildcard TLS Certificate

```bash
# Install certbot if not already installed
sudo apt install -y certbot

# Generate wildcard certificate
# (You'll need to add a DNS TXT record for verification)
sudo certbot certonly -d '*.cheeko.io' --manual

# Follow the prompts:
# 1. Certbot will ask you to create a DNS TXT record
# 2. Add the TXT record at your registrar
# 3. Wait for DNS propagation (~1-5 minutes)
# 4. Press Enter to continue verification
```

After successful verification, certificates are stored at:
```
Certificate: /etc/letsencrypt/live/cheeko.io/fullchain.pem
Private Key: /etc/letsencrypt/live/cheeko.io/privkey.pem
```

### 6.3 Set Up Auto-Renewal

```bash
# Test renewal
sudo certbot renew --dry-run

# Certbot auto-renewal is usually set up via systemd timer or cron
sudo systemctl enable certbot.timer
```

---

## Step 7: Start Hypercore Cluster

### 7.1 Get Your Public IP

```bash
export PUBLIC_IP="$(curl -s ip.me)"
echo "Public IP: $PUBLIC_IP"
```

### 7.2 Start the First Node

```bash
export PATH="$PATH:/opt/hypercore/bin"
export PUBLIC_IP="$(curl -s ip.me)"
export BASE_URL="cheeko.io"
export TLS_CERT="/etc/letsencrypt/live/cheeko.io/fullchain.pem"
export TLS_KEY="/etc/letsencrypt/live/cheeko.io/privkey.pem"

sudo hypercore cluster \
    --cluster-bind-addr "$PUBLIC_IP:7946" \
    --cluster-base-url "$BASE_URL" \
    --cluster-tls-cert "$TLS_CERT" \
    --cluster-tls-key "$TLS_KEY"
```

**What this does:**
- Starts Hypercore listening on port 7946 (Serf gossip protocol for cluster communication)
- Starts gRPC API on port 8000 (for spawn/stop/list commands)
- Starts reverse proxy on port 443 (routes `*.cheeko.io` to VMs with TLS)
- First node becomes the cluster seed

### 7.3 Run as Systemd Service (Production)

```bash
sudo tee /etc/systemd/system/hypercore.service << EOF
[Unit]
Description=Hypercore MicroVM Cluster
After=network.target hypercore-containerd.service
Requires=hypercore-containerd.service

[Service]
Type=simple
Environment=PATH=/opt/hypercore/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin
ExecStart=/opt/hypercore/bin/hypercore cluster \
    --cluster-bind-addr $(curl -s ip.me):7946 \
    --cluster-base-url cheeko.io \
    --cluster-tls-cert /etc/letsencrypt/live/cheeko.io/fullchain.pem \
    --cluster-tls-key /etc/letsencrypt/live/cheeko.io/privkey.pem
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable hypercore
sudo systemctl start hypercore
```

### 7.4 Adding More Nodes (Scaling)

To add a second server to the cluster:

```bash
# On the new server (after installing Hypercore + containerd):
export PUBLIC_IP="$(curl -s ip.me)"
export CLUSTER_SEED_IP="<first-node-public-ip>"

sudo hypercore cluster \
    --cluster-bind-addr "$PUBLIC_IP:7946" \
    "$CLUSTER_SEED_IP:7946" \
    --cluster-base-url "cheeko.io" \
    --cluster-tls-cert "/etc/letsencrypt/live/cheeko.io/fullchain.pem" \
    --cluster-tls-key "/etc/letsencrypt/live/cheeko.io/privkey.pem"
```

The new node auto-discovers existing nodes via Serf gossip. VMs can be spawned on any node in the cluster.

---

## Step 8: Spawn a User VM

When a new user needs an OpenClaw instance, spawn a VM with their unique configuration.

### 8.1 Spawn Command

```bash
# Replace the API keys and token with actual values for this user
hypercore cluster spawn \
    --grpc-bind-addr "$PUBLIC_IP:8000" \
    --ports 443:18789 \
    --image-ref docker.io/cheeko/openclaw:latest \
    --env GOOGLE_API_KEY="AIzaSy..." \
    --env DEEPGRAM_API_KEY="dg-xxx" \
    --env ELEVENLABS_API_KEY="xi-xxx" \
    --env OPENCLAW_GATEWAY_TOKEN="$(openssl rand -hex 24)" \
    --env LLM_MODEL="google/gemini-3-pro-preview"
```

### 8.2 Response

Hypercore returns a VM ID and a public URL:

```
INFO Got response: id:"a1b2c3d4-e5f6-7890-abcd-ef1234567890"
     url:"a1b2c3d4-e5f6-7890-abcd-ef1234567890.cheeko.io"
```

The user's instance is now accessible at:
- **OTA**: `https://a1b2c3d4-...cheeko.io/toy/ota`
- **Dashboard**: `https://a1b2c3d4-...cheeko.io/cheeko/dashboard`
- **Bridge**: `wss://a1b2c3d4-...cheeko.io:8081/voice/stream`

### 8.3 Store the Mapping

Save the VM ID and URL for each user in your backend database:

```
user_id:    "user_001"
vm_id:      "a1b2c3d4-e5f6-7890-abcd-ef1234567890"
subdomain:  "a1b2c3d4-e5f6-7890-abcd-ef1234567890.cheeko.io"
created_at: "2026-02-24T10:00:00Z"
status:     "running"
```

### 8.4 Using HTTP API (Alternative to CLI)

You can also spawn VMs via HTTP calls (useful for automation):

```bash
curl -X POST https://cluster.cheeko.io/spawn \
  -H "Content-Type: application/json" \
  -d '{
    "image_ref": "docker.io/cheeko/openclaw:latest",
    "cores": 2,
    "memory": 2048,
    "ports": {"443": "18789"},
    "env": [
      "GOOGLE_API_KEY=AIzaSy...",
      "DEEPGRAM_API_KEY=dg-xxx",
      "ELEVENLABS_API_KEY=xi-xxx",
      "OPENCLAW_GATEWAY_TOKEN=random-token-here",
      "LLM_MODEL=google/gemini-3-pro-preview"
    ]
  }'
```

---

## Step 9: Device Activation Flow

Once the VM is running, the ESP32 device needs to be activated.

### 9.1 Device Powers On

The ESP32 firmware is pre-configured to hit the OTA endpoint. It sends:

```
GET /toy/ota
Headers:
  Device-Id: AA:BB:CC:DD:EE:FF
  (optional) Content-Type: application/json
  (optional) Body: { "board": "cheeko-s3", "app_version": "1.0.2" }
```

### 9.2 First-Time Device (New Device)

The plugin creates a new device record and returns an activation code:

```json
{
  "activation": {
    "code": "847293",
    "message": "Please enter this code in the Cheeko dashboard to activate your device."
  }
}
```

The ESP32 displays or speaks this code to the user.

### 9.3 Device Polls for Activation

The device periodically calls:

```
POST /toy/ota/activate
Headers:
  Device-Id: AA:BB:CC:DD:EE:FF
```

While pending, it gets:
```json
{ "status": "pending" }
```
(HTTP 202)

### 9.4 User Activates via Dashboard

The user opens the dashboard in their browser:

```
https://a1b2c3d4-...cheeko.io/cheeko/dashboard
```

1. Enters the dashboard password (the gateway token, or a custom password)
2. Enters the activation code `847293`
3. Optionally sets a device nickname
4. Clicks **Activate**

### 9.5 Device Gets Bridge Credentials

After activation, the next poll returns HTTP 200:

```json
{ "status": "activated" }
```

The device then re-fetches `/toy/ota` and gets:

```json
{
  "server_time": {
    "timestamp": 1740000000000,
    "timezone": "UTC"
  },
  "websocket": {
    "url": "wss://a1b2c3d4-...cheeko.io:8081/voice/stream",
    "token": "bridge-auth-token",
    "version": 1
  }
}
```

### 9.6 Voice Conversations Work

The device connects to the Bridge WebSocket and voice conversations flow:

```
User speaks → ESP32 → Bridge (STT via Deepgram) → OpenClaw (LLM) → Bridge (TTS via ElevenLabs) → ESP32 → Speaker
```

---

## Step 10: Managing VMs

All VM management is done via Hypercore's HTTP API.

### List All Running VMs

```bash
hypercore cluster list --grpc-bind-addr "$PUBLIC_IP:8000"

# Or via HTTP:
curl https://cluster.cheeko.io/list
```

### Stop (Delete) a VM

```bash
# Free all resources instantly
curl "https://cluster.cheeko.io/stop?id=a1b2c3d4-e5f6-7890-abcd-ef1234567890"
```

The VM is destroyed, resources freed, subdomain removed. Device will get connection errors until a new VM is spawned.

### Re-create a VM

Spawn a fresh VM with the same configuration:

```bash
hypercore cluster spawn \
    --grpc-bind-addr "$PUBLIC_IP:8000" \
    --ports 443:18789 \
    --image-ref docker.io/cheeko/openclaw:latest \
    --env GOOGLE_API_KEY="same-key" \
    --env DEEPGRAM_API_KEY="same-key" \
    --env ELEVENLABS_API_KEY="same-key" \
    --env OPENCLAW_GATEWAY_TOKEN="same-token"
```

The device will reconnect on its next OTA poll. If user data is stored in an external database, nothing is lost.

### VM Lifetime

- VMs run **permanently** once created (always-on, not serverless)
- They survive server reboots (Hypercore shim restarts them)
- They only stop when explicitly deleted via the API
- The device can connect/disconnect anytime — the VM is always there

### When to Delete a VM

- User cancels subscription
- Non-payment after grace period
- User requests account deletion
- Admin maintenance (re-spawn immediately after)

---

## Updating the Platform

### Update the Docker Image

When you release a new version of OpenClaw or the Cheeko Plugin:

```bash
cd ~/cheeko-platform

# Pull latest code changes
# (update openclaw source, plugin code, bridge code)

# Rebuild the image
docker build -t cheeko/openclaw:latest .

# Push to registry
docker push docker.io/cheeko/openclaw:latest
```

### Update Existing User VMs

New VMs automatically get the latest image. To update existing users:

```bash
# 1. Stop old VM
curl "https://cluster.cheeko.io/stop?id=<old-vm-id>"

# 2. Spawn fresh VM with latest image (same env vars)
hypercore cluster spawn \
    --grpc-bind-addr "$PUBLIC_IP:8000" \
    --ports 443:18789 \
    --image-ref docker.io/cheeko/openclaw:latest \
    --env GOOGLE_API_KEY="..." \
    --env DEEPGRAM_API_KEY="..." \
    --env ELEVENLABS_API_KEY="..." \
    --env OPENCLAW_GATEWAY_TOKEN="..."

# 3. Device auto-reconnects on next OTA poll
```

### Hypercore Caching

Hypercore pulls the Docker image **once per server node** and caches it. After the first pull, subsequent VMs on the same node boot instantly from cache. When you push a new image version, the next spawn will pull the updated image.

---

## Troubleshooting

### VM won't start

```bash
# Check hypercore logs
sudo journalctl -u hypercore -f

# Check containerd logs
sudo journalctl -u hypercore-containerd -f

# Verify KVM is available
ls -la /dev/kvm

# Verify containerd socket exists
ls -la /var/lib/hypercore/containerd.sock

# Check device-mapper pool
sudo dmsetup status
```

### Device can't connect

```bash
# Check if VM is running
curl https://cluster.cheeko.io/list

# Test OTA endpoint from server
curl -H "Device-Id: test" https://<vm-subdomain>.cheeko.io/toy/ota

# Check VM logs
curl "https://cluster.cheeko.io/logs?id=<vm-id>"
```

### Bridge not starting inside VM

The Bridge requires Python 3 and the `opuslib` package. If it's failing, check that the Dockerfile includes Python dependencies:

```bash
# Inside the VM (if you can attach)
hypercore attach <vm-id>

# Check Python
python3 --version
python3 -c "import opuslib; print('opuslib OK')"

# Check bridge process
ps aux | grep python
```

### TLS certificate issues

```bash
# Check certificate validity
sudo openssl x509 -in /etc/letsencrypt/live/cheeko.io/fullchain.pem -text -noout | grep -A2 "Validity"

# Renew if expired
sudo certbot renew

# Restart hypercore after renewal
sudo systemctl restart hypercore
```

### Running out of resources

```bash
# Check current resource usage
free -h
nproc
df -h

# Count running VMs
curl https://cluster.cheeko.io/list | jq '. | length'

# Add another server to the cluster (see Step 7.4)
```

---

## Quick Reference

| Action | Command |
|--------|---------|
| Build image | `docker build -t cheeko/openclaw:latest .` |
| Push image | `docker push docker.io/cheeko/openclaw:latest` |
| Start containerd | `sudo systemctl start hypercore-containerd` |
| Start hypercore | `sudo systemctl start hypercore` |
| Spawn VM | `hypercore cluster spawn --grpc-bind-addr $IP:8000 --ports 443:18789 --image-ref docker.io/cheeko/openclaw:latest --env ...` |
| List VMs | `curl https://cluster.cheeko.io/list` |
| Stop VM | `curl "https://cluster.cheeko.io/stop?id=<vm-id>"` |
| View logs | `curl "https://cluster.cheeko.io/logs?id=<vm-id>"` |
| Renew TLS | `sudo certbot renew && sudo systemctl restart hypercore` |

---

## Capacity Planning

| Server Spec | Users Supported | Monthly Cost |
|-------------|-----------------|--------------|
| 4 CPU / 8GB RAM | 2-3 users | ~$20-25 |
| 8 CPU / 16GB RAM | 5-6 users | ~$35-50 |
| 16 CPU / 32GB RAM | 12-14 users | ~$70-100 |
| 32 CPU / 64GB RAM | 28-30 users | ~$120-180 |

**Per-user resource allocation**: 1 CPU core + 2GB RAM per VM.
**Host reservation**: 2 CPU cores + 2GB RAM for OS + Hypercore + containerd.

For 30+ users, consider switching to a multi-tenant Docker container architecture (shared OpenClaw + per-user bridges) for better cost efficiency.
