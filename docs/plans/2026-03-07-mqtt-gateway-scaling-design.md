# MQTT Gateway Scaling Design — 1000 Concurrent Devices

**Date:** 2026-03-07
**Status:** Approved
**Target:** Scale from ~50-100 to 1000 concurrent ESP32 device connections

## Current State

- Single Node.js process, 2 CPU / 8 GB RAM droplet
- 1 EMQX broker (Docker), 1 UDP socket, 1 MQTT client, 4 Opus worker threads
- ~200 MB RAM usage with few connections
- Max capacity: ~50-100 concurrent devices

## Target Architecture

```
Droplet 1 — Gateway Box (8 CPU / 32 GB — $192/mo)
+-- EMQX (Docker, same instance)
+-- mqtt-gateway instance 1 (UDP 8881, 4 Opus workers)
+-- mqtt-gateway instance 2 (UDP 8882, 4 Opus workers)
+-- mqtt-gateway instance 3 (UDP 8883, 4 Opus workers)
+-- mqtt-gateway instance 4 (UDP 8884, 4 Opus workers)

Droplet 2 — API Box (2 CPU / 4 GB — $24/mo)
+-- manager-api (Node.js)
+-- manager-web (Vue.js dev server or static build)
+-- content-poc

Cloud Services (existing):
+-- LiveKit Cloud Scale plan ($500/mo) — 5000 concurrent connections, 1.5M WebRTC min/mo
+-- Cerebrium (AI agents, hosted separately — not subject to LiveKit agent session limits)
+-- Supabase (PostgreSQL)
+-- DigitalOcean PostgreSQL (source DB)
```

**Infrastructure cost: ~$216/mo | LiveKit Cloud (Scale plan): ~$500/mo | Total: ~$716/mo + Cerebrium**

## How It Works

### Device Connection Flow (unchanged for firmware)

1. Device -> manager-api: `POST /toy/ota/` (gets MQTT broker IP:1883)
2. Device -> EMQX: MQTT connect (port 1883, same for all devices)
3. EMQX distributes `hello` via shared subscription to one gateway instance
4. Gateway instance replies with its unique UDP port in hello response
5. Device streams UDP audio to that specific instance's port

### EMQX Shared Subscriptions

Current subscription:
```
broker.subscribe("device-server", handler)
```

Changed to:
```
broker.subscribe("$share/gateway/device-server", handler)
```

EMQX auto-distributes messages round-robin across all subscribers in the `gateway` group. Devices still publish to `device-server` — no firmware change.

### Per-Instance Configuration

Each gateway instance is configured via environment variables:

| Env Var | Instance 1 | Instance 2 | Instance 3 | Instance 4 |
|---------|-----------|-----------|-----------|-----------|
| INSTANCE_ID | 1 | 2 | 3 | 4 |
| UDP_PORT | 8881 | 8882 | 8883 | 8884 |
| WORKER_COUNT | 4 | 4 | 4 | 4 |

PM2 ecosystem config manages all 4 instances.

## Code Changes Required

### Phase 1: Fix Memory Leaks & Bottlenecks (prerequisite)

These must be done BEFORE multi-instance, otherwise each instance leaks.

#### 1.1 Increase cipher cache (streaming-crypto.js)
- Change `this.maxCacheSize = 20` to `this.maxCacheSize = 300`
- 1000 devices / 4 instances = 250 per instance, need ~250 cache entries

#### 1.2 Add frame buffer limit (livekit-bridge.js)
- Cap `this.frameBuffer` at 10 frames (28,800 bytes)
- Prevents unbounded memory growth during sustained audio streaming

#### 1.3 Clean up event listeners on disconnect (livekit-bridge.js)
- Call `this.room.removeAllListeners()` before `this.room.disconnect()` in `close()`
- Prevents listener accumulation on rapid reconnect cycles

#### 1.4 Clean up pending MCP requests on close (livekit-bridge.js)
- Clear `this.pendingMcpRequests` Map in `close()` method
- Clear `this.volumeAdjustmentQueue` array in `close()` method

#### 1.5 Make ghost cleanup async & paginated (mqtt-gateway.js)
- Process rooms in batches of 20 instead of all at once
- Use `await` between batches to avoid blocking event loop
- Currently `listRooms()` + `listParticipants()` blocks main thread

### Phase 2: Multi-Instance Support

#### 2.1 Parameterize UDP port (app.js + mqtt-gateway.js)
- Read `UDP_PORT` from env, default to 8881
- Pass to `UdpServer` constructor and `MQTTGateway`
- Read `INSTANCE_ID` from env for unique MQTT client ID

#### 2.2 EMQX shared subscriptions (emqx-broker.js)
- Prefix subscription topics with `$share/gateway/`
- Only for device-to-server topics (not p2p reply topics)
- Reply topics (`devices/p2p/{mac}`) remain normal subscriptions — each instance only subscribes to topics for devices it owns

#### 2.3 Unique MQTT client ID per instance (emqx-broker.js)
- Change `mqtt-gateway-${Date.now()}` to `mqtt-gateway-${INSTANCE_ID}-${Date.now()}`
- EMQX requires unique client IDs

#### 2.4 Instance-aware hello response (virtual-connection.js)
- `this.gateway.udpPort` already reads from gateway — just needs to reflect the env-configured port
- No change needed in virtual-connection.js itself

#### 2.5 Worker pool per instance (app.js)
- Each instance creates its own `WorkerPoolManager(4)`
- 4 instances x 4 workers = 16 total Opus threads on 8 cores (good ratio)

#### 2.6 PM2 ecosystem config (ecosystem.config.js)
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

### Phase 3: Infrastructure Migration

#### 3.1 Provision new gateway droplet
- DigitalOcean: 8 CPU / 32 GB RAM (s-8vcpu-32gb-amd, ~$192/mo)
- Same region as current droplet (BLR1 or closest)
- Install Node.js 22, PM2, Docker

#### 3.2 Move EMQX Docker to new droplet
- Export EMQX config from current instance
- Run EMQX on new droplet, same port 1883
- Update manager-api OTA response to point to new droplet's IP

#### 3.3 Deploy 4 gateway instances on new droplet
- Clone repo, install deps
- Configure PM2 ecosystem with 4 instances
- Open firewall: UDP 8881-8884, TCP 1883 (EMQX)

#### 3.4 Move manager-api to separate small droplet (or keep on current)
- Current 2 CPU / 8 GB droplet is fine for manager-api + manager-web
- Just remove EMQX Docker and mqtt-gateway from it
- Much lighter load — could even downgrade to 2 CPU / 4 GB ($24/mo)

#### 3.5 Remove local LiveKit server Docker
- Already using LiveKit Cloud (`wss://cheeko-prod-*.livekit.cloud`)
- Local `livekit/livekit-server` container appears unused — remove to free resources

### Phase 4: Monitoring & Validation

#### 4.1 Per-instance health endpoint
- Add HTTP health endpoint per instance (ports 9001-9004)
- Reports: connection count, worker pool utilization, memory usage, uptime

#### 4.2 Connection count alerts
- Log total connections per instance every 30 seconds
- Alert if any instance exceeds 300 connections (rebalance needed)

#### 4.3 Load testing
- Simulate 100, 250, 500, 1000 concurrent connections
- Measure: connection success rate, audio latency, memory growth, CPU usage
- Tools: custom MQTT client script or mqtt-bench

## Reply Topic Handling (Critical Detail)

When a device connects, the gateway subscribes to its p2p reply topic:
```
devices/p2p/{MAC_ADDRESS}
```

This MUST NOT use shared subscription — only the instance that owns the device should receive its replies. Current code already does per-device subscription, so this works naturally. Each instance only subscribes to reply topics for its own connected devices.

## Capacity Planning

| Connections | Instances | RAM per Instance | Total RAM | CPU Threads |
|------------|-----------|-----------------|-----------|-------------|
| 250 | 1 | ~6 GB | 6 GB | 5 (1 + 4 workers) |
| 500 | 2 | ~6 GB | 12 GB | 10 |
| 750 | 3 | ~6 GB | 18 GB | 15 |
| 1000 | 4 | ~6 GB | 24 GB | 20 |

Leaves ~8 GB headroom on 32 GB server for EMQX + OS + spikes.

## Why Multi-Instance (Not Single Process)

Node.js runs JavaScript on a single CPU core. One process = one event loop = one core.
At 1000 devices, the main thread must handle ~33,400 frames/sec (encode + decode directions),
plus UDP I/O, encryption, MQTT routing, LiveKit events — totaling ~3,300ms of work per second.
One core only has 1,000ms. So we split across 4 cores via 4 processes.

Linux kernel auto-assigns each process to a different CPU core — no pinning needed.

## Opus Throughput Capacity

Opus decode/encode takes ~0.1-0.5ms per frame. Device frame duration: 60ms = 16.7 fps per device.

| Workers | Capacity (fps) | Handles Devices | Notes |
|---------|---------------|-----------------|-------|
| 4 | 8,000 | ~500 | Single instance |
| 16 (4x4) | 32,000 | ~2,000 | 4 instances, plenty of headroom |

Realistic load at 1000 devices (30% talk time): ~10,000 fps. 16 workers at 32,000 fps = 31% utilization.

RAM is the real bottleneck, not Opus CPU. Each LiveKit Room + AudioSource + Resampler = ~5-10 MB native C++ memory per connection.

## LiveKit Cloud Plan Requirements

Agents are hosted on Cerebrium (not LiveKit Agents), so they join as regular participants.
LiveKit "concurrent agent sessions" limit does NOT apply.

| Plan | Cost | Concurrent Connections | WebRTC min/mo | Fits? |
|------|------|----------------------|---------------|-------|
| Ship | $50/mo | 1,000 | 150,000 | Max ~500 devices (2 conn each), overage likely |
| **Scale** | **$500/mo** | **5,000** | **1,500,000** | **1000 devices comfortable, no overage** |

1000 devices x 2 participants = 2000 concurrent connections (within Scale's 5000 limit).
1000 devices x 2 participants x avg 30 min/day x 30 days = ~900,000 WebRTC min/mo (within 1.5M).

## Cost Summary

| Item | Monthly Cost |
|------|-------------|
| Gateway droplet (8 CPU / 32 GB) | $192 |
| API droplet (2 CPU / 4 GB) | $24 |
| LiveKit Cloud Scale plan | $500 |
| Cerebrium | (existing cost) |
| Supabase | (existing cost) |
| **Total infrastructure** | **~$716 + Cerebrium** |

## Risk Mitigation

| Risk | Mitigation |
|------|-----------|
| Instance crash | PM2 auto-restarts. Devices reconnect via OTA -> get assigned to surviving instances |
| Memory leak | Frame buffer cap + listener cleanup + worker session GC |
| Uneven distribution | EMQX round-robin is fair. Monitor per-instance counts |
| Server failure | Single point of failure at this scale. Future: add 2nd server for Approach B |
| EMQX overload | EMQX handles 100K+ connections easily. Not a concern at 1000 |

## Implementation Order

1. Phase 1 (memory fixes) — 2-3 hours
2. Phase 2 (multi-instance code) — 3-4 hours
3. Phase 3 (infrastructure migration) — 2-3 hours
4. Phase 4 (monitoring) — 1-2 hours

**Total estimated effort: 1-2 days**
