---
id: scaling
sidebar_position: 3
---

# Scaling the MQTT Gateway

This page documents the approved design for scaling the MQTT Gateway from ~50-100 to 1000 concurrent ESP32 device connections.

---

## Current State

- Single Node.js process on a 2 CPU / 8 GB RAM droplet
- 1 EMQX broker (Docker), 1 UDP socket, 1 MQTT client, 4 Opus worker threads
- ~200 MB RAM usage with few connections
- Max capacity: ~50-100 concurrent devices

---

## Target Architecture

```
Droplet 1 - Gateway Box (8 CPU / 32 GB)
+-- EMQX (Docker, same instance)
+-- mqtt-gateway instance 1 (UDP 8881, 4 Opus workers)
+-- mqtt-gateway instance 2 (UDP 8882, 4 Opus workers)
+-- mqtt-gateway instance 3 (UDP 8883, 4 Opus workers)
+-- mqtt-gateway instance 4 (UDP 8884, 4 Opus workers)

Droplet 2 - API Box (2 CPU / 4 GB)
+-- manager-api-node
+-- manager-web (static build)

Cloud Services (existing):
+-- LiveKit Cloud Scale plan - 5000 concurrent connections
+-- Cerebrium (AI agents, hosted separately)
+-- DigitalOcean PostgreSQL
```

---

## Why Multi-Instance (Not Single Process)

Node.js runs JavaScript on a single CPU core. At 1000 devices, the main thread must handle ~33,400 audio frames/sec (encode + decode), plus UDP I/O, encryption, MQTT routing, and LiveKit events — totaling ~3,300 ms of work per second. One core only has 1,000 ms. So we split across 4 cores via 4 processes.

PM2 manages all 4 instances. Linux kernel auto-assigns each process to a different CPU core.

---

## How It Works

### Device Connection Flow (no firmware change)

```
1. Device --> manager-api: POST /toy/ota/  (gets MQTT broker IP:1883)
2. Device --> EMQX: MQTT connect (port 1883, same for all devices)
3. EMQX distributes "hello" via shared subscription to one gateway instance
4. Gateway instance replies with its unique UDP port in hello response
5. Device streams UDP audio to that specific instance's port
```

The device always connects to EMQX on port 1883. EMQX handles load distribution. The device does not know which gateway instance it is talking to.

### EMQX Shared Subscriptions

Current single-instance subscription:
```javascript
broker.subscribe("device-server", handler)
```

Changed to shared subscription:
```javascript
broker.subscribe("$share/gateway/device-server", handler)
```

EMQX auto-distributes messages round-robin across all subscribers in the `gateway` group. Devices still publish to `device-server` — no firmware change needed.

### Reply Topic Handling (Critical)

When a gateway instance owns a device, it subscribes to that device's p2p reply topic:
```
devices/p2p/{MAC_ADDRESS}
```

This does **not** use shared subscription — only the instance that owns the device should receive its replies. Each instance only subscribes to reply topics for its own connected devices.

### Per-Instance Configuration

| Env Var | Instance 1 | Instance 2 | Instance 3 | Instance 4 |
|---------|-----------|-----------|-----------|-----------|
| `INSTANCE_ID` | 1 | 2 | 3 | 4 |
| `UDP_PORT` | 8881 | 8882 | 8883 | 8884 |
| `WORKER_COUNT` | 4 | 4 | 4 | 4 |

---

## PM2 Ecosystem Config

```javascript
module.exports = {
  apps: [
    {
      name: "gateway-1",
      script: "app.js",
      cwd: "./main/mqtt-gateway",
      env: { INSTANCE_ID: "1", UDP_PORT: "8881", WORKER_COUNT: "4" }
    },
    {
      name: "gateway-2",
      script: "app.js",
      cwd: "./main/mqtt-gateway",
      env: { INSTANCE_ID: "2", UDP_PORT: "8882", WORKER_COUNT: "4" }
    },
    {
      name: "gateway-3",
      script: "app.js",
      cwd: "./main/mqtt-gateway",
      env: { INSTANCE_ID: "3", UDP_PORT: "8883", WORKER_COUNT: "4" }
    },
    {
      name: "gateway-4",
      script: "app.js",
      cwd: "./main/mqtt-gateway",
      env: { INSTANCE_ID: "4", UDP_PORT: "8884", WORKER_COUNT: "4" }
    }
  ]
};
```

---

## Implementation Phases

### Phase 1: Fix Memory Leaks and Bottlenecks (prerequisite)

These must be done before multi-instance, otherwise each instance leaks.

| Fix | File | Change |
|-----|------|--------|
| Increase cipher cache | `streaming-crypto.js` | `maxCacheSize = 20` to `300` (250 devices per instance) |
| Cap frame buffer | `livekit-bridge.js` | Limit `frameBuffer` to 10 frames (28,800 bytes) |
| Clean up event listeners | `livekit-bridge.js` | Call `room.removeAllListeners()` before `room.disconnect()` in `close()` |
| Clear pending MCP requests | `livekit-bridge.js` | Clear `pendingMcpRequests` Map and `volumeAdjustmentQueue` array in `close()` |
| Async ghost cleanup | `mqtt-gateway.js` | Process rooms in batches of 20 with `await` between batches |

### Phase 2: Multi-Instance Code Changes

| Change | File | Description |
|--------|------|-------------|
| Parameterize UDP port | `app.js`, `mqtt-gateway.js` | Read `UDP_PORT` from env, default 8881 |
| Shared subscriptions | `emqx-broker.js` | Prefix `$share/gateway/` on device-to-server topics only |
| Unique MQTT client ID | `emqx-broker.js` | `mqtt-gateway-${INSTANCE_ID}-${Date.now()}` |
| Worker pool per instance | `app.js` | Each instance creates `WorkerPoolManager(4)` |

### Phase 3: Infrastructure Migration

1. Provision gateway droplet: DigitalOcean 8 CPU / 32 GB RAM
2. Move EMQX Docker to new droplet, same port 1883
3. Deploy 4 gateway instances via PM2
4. Open firewall: UDP 8881-8884, TCP 1883
5. Update manager-api OTA response to point to new IP
6. Move manager-api to separate smaller droplet (2 CPU / 4 GB)

### Phase 4: Monitoring and Validation

| Item | Description |
|------|-------------|
| Health endpoint | HTTP per instance (ports 9001-9004): connection count, worker utilization, memory, uptime |
| Connection alerts | Log totals every 30 s; alert if any instance exceeds 300 |
| Load testing | Simulate 100, 250, 500, 1000 connections; measure latency, memory, CPU |

---

## Capacity Planning

| Connections | Instances | RAM per Instance | Total RAM | CPU Threads |
|------------|-----------|-----------------|-----------|-------------|
| 250 | 1 | ~6 GB | 6 GB | 5 (1 main + 4 workers) |
| 500 | 2 | ~6 GB | 12 GB | 10 |
| 750 | 3 | ~6 GB | 18 GB | 15 |
| 1000 | 4 | ~6 GB | 24 GB | 20 |

Leaves ~8 GB headroom on 32 GB server for EMQX + OS + spikes.

### Opus Throughput

| Workers | Capacity (fps) | Handles Devices | Notes |
|---------|---------------|-----------------|-------|
| 4 | 8,000 | ~500 | Single instance |
| 16 (4x4) | 32,000 | ~2,000 | 4 instances, plenty of headroom |

Realistic load at 1000 devices (30% talk time): ~10,000 fps. 16 workers at 32,000 fps = 31% utilization. RAM is the real bottleneck, not Opus CPU.

---

## LiveKit Cloud Plan

Agents are hosted on Cerebrium (not LiveKit Agents), so they join as regular participants. The LiveKit "concurrent agent sessions" limit does not apply.

| Plan | Cost | Concurrent Connections | WebRTC min/mo | Fits 1000 devices? |
|------|------|----------------------|---------------|---------------------|
| Ship | $50/mo | 1,000 | 150,000 | No — 1000 devices x 2 participants = 2000 |
| **Scale** | **$500/mo** | **5,000** | **1,500,000** | **Yes — comfortable** |

1000 devices x 2 participants x avg 30 min/day x 30 days = ~900,000 WebRTC min/mo (within 1.5M).

---

## Cost Summary

| Item | Monthly Cost |
|------|-------------|
| Gateway droplet (8 CPU / 32 GB) | $192 |
| API droplet (2 CPU / 4 GB) | $24 |
| LiveKit Cloud Scale plan | $500 |
| Cerebrium | existing |
| DigitalOcean PostgreSQL | existing |
| **Total** | **~$716 + Cerebrium** |

---

## Risk Mitigation

| Risk | Mitigation |
|------|-----------|
| Instance crash | PM2 auto-restarts; devices reconnect via OTA and get assigned to surviving instances |
| Memory leak | Frame buffer cap + listener cleanup + worker session GC (Phase 1 fixes) |
| Uneven distribution | EMQX round-robin is fair; monitor per-instance connection counts |
| Server failure | Single point of failure at this scale; future: add 2nd server |
| EMQX overload | EMQX handles 100K+ connections; not a concern at 1000 |
