---
id: pm2
sidebar_position: 2
---

# PM2 and Deployment

PM2 is used to manage all Cheeko services as persistent processes on the server. The ecosystem config lives at `ecosystem.config.js` in the repo root.

## Ecosystem Config

The root `ecosystem.config.js` defines five PM2 applications:

```js
module.exports = {
  apps: [
    {
      name: "manager-api",
      script: "npm",
      args: "start",
      cwd: "/root/xiaozhi-esp32-server/main/manager-api-node",
      interpreter: "none"
    },
    {
      name: "manager-web",
      script: "npm",
      args: "run serve",
      cwd: "/root/xiaozhi-esp32-server/main/manager-web",
      interpreter: "none"
    },
    {
      name: "mqtt-gateway",
      script: "app.js",
      cwd: "/root/xiaozhi-esp32-server/main/mqtt-gateway",
      interpreter: "node",
      watch: false
    },
    {
      name: "livekit-server",
      script: "main.py",
      args: "dev",
      cwd: "/root/xiaozhi-esp32-server/main/livekit-server",
      interpreter: "python3"
    },
    {
      name: "livekit-react-cheeko",
      script: "npm",
      args: "run dev",
      cwd: "/root/xiaozhi-esp32-server/livkit-react-with-python-cheeko",
      interpreter: "none",
      env: {
        NODE_ENV: "development"
      }
    }
  ]
};
```

Update the `cwd` paths to match your actual deployment directory before use.

## Starting All Services

```bash
# Start (or restart) all services defined in the ecosystem file
pm2 start ecosystem.config.js

# Restart a single service
pm2 restart manager-api

# Stop all services
pm2 stop all
```

## Monitoring

```bash
# Interactive real-time monitor (CPU, memory, logs per process)
pm2 monit

# View logs for all services (tails all log streams)
pm2 logs

# View logs for a specific service
pm2 logs manager-api
pm2 logs mqtt-gateway

# Show process list with status
pm2 list

# Show detailed info for one process
pm2 show mqtt-gateway
```

## Persistence Across Reboots

```bash
# Save current process list so PM2 restarts services after reboot
pm2 save

# Generate and enable the startup script for your OS
pm2 startup
```

Follow the command that `pm2 startup` prints to enable the systemd/init hook.

## Docker

Dockerfiles are present for all four primary services:

| Service | Dockerfile |
|---|---|
| manager-api-node | `main/manager-api-node/Dockerfile` |
| manager-web | `main/manager-web/Dockerfile` (development) and `main/manager-web/Dockerfile.production` (production) |
| mqtt-gateway | `main/mqtt-gateway/Dockerfile` |
| livekit-server | `main/livekit-server/Dockerfile` and `main/livekit-server/Dockerfile.cerebrium` (Cerebrium deployment) |

Build individual images:

```bash
docker build -t cheeko-manager-api ./main/manager-api-node
docker build -t cheeko-mqtt-gateway ./main/mqtt-gateway
docker build -t cheeko-livekit ./main/livekit-server
docker build -f main/manager-web/Dockerfile.production -t cheeko-manager-web ./main/manager-web
```

## Health Checks

### manager-api-node

A health check endpoint is available outside the `/toy` context path:

```
GET /health
```

Response (HTTP 200):
```json
{
  "status": "healthy",
  "timestamp": "2025-01-01T00:00:00.000Z",
  "uptime": 1234.56
}
```

This endpoint is excluded from rate limiting and request logging in production.

### Swagger / API Docs

```
GET /toy/doc.html
```

The OpenAPI documentation is served at this URL when `manager-api-node` is running.

## CI/CD

The CircleCI pipeline at `.circleci/config.yml` handles:

- Branch-specific deployments (dev and production branches)
- Docker image builds for each component
- EMQX broker deployment

Refer to `.circleci/config.yml` for the full pipeline definition.
