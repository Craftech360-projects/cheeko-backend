# MQTT Gateway Scaling Design — 1000 Concurrent Devices

**Date:** 2026-03-07
**Updated:** 2026-03-10 (code-verified revision)
**Status:** Approved
**Target:** Scale from ~50-100 to 1000 concurrent ESP32 device connections

## Current State

- Single Node.js process, 2 CPU / 8 GB RAM droplet
- 1 EMQX broker (Docker), 1 raw UDP socket (`dgram.createSocket`), 1 MQTT client, 4 Opus worker threads (auto-scales to 8)
- ~200 MB RAM usage with few connections
- Max capacity: ~50-100 concurrent devices
- MQTT subscription model: EMQX republish rule funnels all device messages to `internal/server-ingest` topic
- Per-device playback control subscriptions: `cheeko/{mac}/playback_control/next|previous`
- Reply messages published (not subscribed) to `devices/p2p/{clientId}`

## Target Architecture

```
Droplet 1 — Gateway Box (8 CPU / 32 GB — $192/mo)
+-- EMQX (Docker, same instance)
+-- mqtt-gateway instance 1 (UDP 8881, 4 Opus workers, auto-scaling disabled)
+-- mqtt-gateway instance 2 (UDP 8882, 4 Opus workers, auto-scaling disabled)
+-- mqtt-gateway instance 3 (UDP 8883, 4 Opus workers, auto-scaling disabled)
+-- mqtt-gateway instance 4 (UDP 8884, 4 Opus workers, auto-scaling disabled)

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
3. EMQX republish rule routes device messages to `internal/server-ingest`
4. EMQX distributes via shared subscription to one gateway instance
5. Gateway instance replies with its unique UDP port in hello response
6. Device streams UDP audio to that specific instance's port

### EMQX Shared Subscriptions

Current subscription (`mqtt-gateway.js:583`):
```js
this.mqttClient.subscribe(["internal/server-ingest"], handler)
```

Changed to:
```js
this.mqttClient.subscribe(["$share/gateway/internal/server-ingest"], handler)
```

EMQX auto-distributes messages round-robin across all subscribers in the `gateway` group. The EMQX republish rule continues to funnel device messages to `internal/server-ingest` — no firmware change, no rule change.

### Topic Subscription Model (Critical Detail)

| Topic | Type | Shared? | Notes |
|-------|------|---------|-------|
| `internal/server-ingest` | Subscribe | YES (`$share/gateway/`) | All device messages (hello, data, etc.) via EMQX republish rule |
| `cheeko/{mac}/playback_control/next` | Subscribe | NO | Per-device, only the owning instance subscribes |
| `cheeko/{mac}/playback_control/previous` | Subscribe | NO | Per-device, only the owning instance subscribes |
| `devices/p2p/{clientId}` | Publish only | N/A | Gateway publishes replies here, never subscribes |

The playback control topics (`mqtt-gateway.js:1157-1173`) are subscribed per-device when a media session starts. Since each instance only subscribes for its own devices, these naturally stay instance-local — no change needed.

### Per-Instance Configuration

Each gateway instance is configured via environment variables:

| Env Var | Instance 1 | Instance 2 | Instance 3 | Instance 4 |
|---------|-----------|-----------|-----------|-----------|
| INSTANCE_ID | 1 | 2 | 3 | 4 |
| UDP_PORT | 8881 | 8882 | 8883 | 8884 |
| WORKER_COUNT | 4 | 4 | 4 | 4 |
| DISABLE_WORKER_AUTOSCALE | true | true | true | true |

PM2 ecosystem config manages all 4 instances.

## Code Changes Required

### Phase 1: Fix Memory Leaks & Bottlenecks (prerequisite)

These must be done BEFORE multi-instance, otherwise each instance leaks.

#### 1.1 Increase cipher cache (`core/streaming-crypto.js:19`)
- Change `this.maxCacheSize = 20` to `this.maxCacheSize = 300`
- 1000 devices / 4 instances = 250 per instance, need ~250 cache entries
- `streamingCrypto` is a global singleton per process — each PM2 instance gets its own

#### 1.2 Add frame buffer limit (`livekit/livekit-bridge.js:93`)
- Cap `this.frameBuffer` at 10 frames (28,800 bytes)
- Add guard in `Buffer.concat` calls (lines 580, 659):
  ```js
  if (this.frameBuffer.length < 28800) {
    this.frameBuffer = Buffer.concat([this.frameBuffer, resampledBuffer]);
  }
  ```
- Prevents unbounded memory growth during sustained audio streaming

#### 1.3 Clean up event listeners on disconnect (`livekit/livekit-bridge.js:2053`)
- Add `this.room.removeAllListeners()` before `this.room.disconnect()` in `close()`
- Current `close()` does disconnect + delete room but never removes listeners
- Prevents listener accumulation on rapid reconnect cycles

#### 1.4 Clean up pending MCP requests and volume queue on close (`livekit/livekit-bridge.js:2053`)
- Add to `close()` method, after the room cleanup block:
  ```js
  // Clear pending MCP requests
  if (this.pendingMcpRequests) {
    for (const [id, req] of this.pendingMcpRequests) {
      if (req.reject) req.reject(new Error('Bridge closing'));
    }
    this.pendingMcpRequests.clear();
  }
  // Clear volume adjustment queue
  if (this.volumeAdjustmentQueue) {
    this.volumeAdjustmentQueue.length = 0;
  }
  ```

#### 1.5 Make ghost cleanup async & paginated (`gateway/mqtt-gateway.js:367-439`)
- `cleanupGhostRoomsAndSessions()` currently iterates all rooms in a single `for` loop
- Process rooms in batches of 20 instead of all at once
- Add `await new Promise(r => setTimeout(r, 50))` between batches to yield event loop
- `listRooms()` + `listParticipants()` are async API calls that already yield, but the loop body does synchronous map/connection cleanup that can block

### Phase 2: Multi-Instance Support

#### 2.1 Parameterize worker count and UDP port (`app.js:68`, `gateway/mqtt-gateway.js:232`)

**app.js** — read worker count from env:
```js
// Current (line 68):
globalWorkerPool = new WorkerPoolManager(4);

// Changed to:
const workerCount = parseInt(process.env.WORKER_COUNT) || 4;
globalWorkerPool = new WorkerPoolManager(workerCount);
```

**mqtt-gateway.js** — UDP port already reads from env (line 232):
```js
this.udpPort = parseInt(process.env.UDP_PORT) || 1883;
```
No change needed. Each PM2 instance passes a different `UDP_PORT`.

#### 2.2 Disable worker auto-scaling in multi-instance mode (`core/worker-pool-manager.js`)

The WorkerPoolManager auto-scales from `minWorkers=4` to `maxWorkers=8`. With 4 PM2 instances, worst case = 4 x 8 = 32 threads on 8 cores — severely oversubscribed.

Add env check to disable auto-scaling:
```js
// In constructor, after this.startAutoScaling():
if (process.env.DISABLE_WORKER_AUTOSCALE === 'true') {
  this.stopAutoScaling();
  this.maxWorkers = this.workerCount; // Lock to configured count
}
```

#### 2.3 EMQX shared subscription (`gateway/mqtt-gateway.js:583`)

Change the subscription topic to use EMQX shared subscription:
```js
// Current (line 583):
this.mqttClient.subscribe(["internal/server-ingest"], ...)

// Changed to:
this.mqttClient.subscribe(["$share/gateway/internal/server-ingest"], ...)
```

The EMQX `on('message')` handler (line 614-615) checks `topic === "internal/server-ingest"`. With shared subscriptions, the actual delivered topic strips the `$share/gateway/` prefix, so **this check still works without modification**.

Playback control subscriptions (`cheeko/{mac}/playback_control/next|previous`, lines 1157-1173) remain as-is — they are per-device and only the owning instance subscribes.

#### 2.4 Add INSTANCE_ID to MQTT client ID for debugging (`gateway/mqtt-gateway.js:564`)

```js
// Current (line 564):
const clientId = `mqtt-gateway-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

// Changed to:
const instanceId = process.env.INSTANCE_ID || '0';
const clientId = `mqtt-gateway-${instanceId}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
```

The existing `Date.now() + random` already prevents collisions. Adding INSTANCE_ID makes logs and EMQX dashboard easier to debug.

#### 2.5 Worker pool per instance (`app.js`)
- Each PM2 instance creates its own `WorkerPoolManager(4)` — already happens naturally since PM2 runs separate Node.js processes
- 4 instances x 4 workers = 16 total Opus threads on 8 cores (good 2:1 ratio)
- Auto-scaling disabled (2.2) prevents thread explosion

#### 2.6 PM2 ecosystem config (`ecosystem.config.js`)

Replace current single-instance config:
```javascript
module.exports = {
  apps: [
    {
      name: "gateway-1",
      script: "app.js",
      cwd: "./main/mqtt-gateway",
      env: {
        INSTANCE_ID: "1",
        UDP_PORT: "8881",
        WORKER_COUNT: "4",
        DISABLE_WORKER_AUTOSCALE: "true"
      }
    },
    {
      name: "gateway-2",
      script: "app.js",
      cwd: "./main/mqtt-gateway",
      env: {
        INSTANCE_ID: "2",
        UDP_PORT: "8882",
        WORKER_COUNT: "4",
        DISABLE_WORKER_AUTOSCALE: "true"
      }
    },
    {
      name: "gateway-3",
      script: "app.js",
      cwd: "./main/mqtt-gateway",
      env: {
        INSTANCE_ID: "3",
        UDP_PORT: "8883",
        WORKER_COUNT: "4",
        DISABLE_WORKER_AUTOSCALE: "true"
      }
    },
    {
      name: "gateway-4",
      script: "app.js",
      cwd: "./main/mqtt-gateway",
      env: {
        INSTANCE_ID: "4",
        UDP_PORT: "8884",
        WORKER_COUNT: "4",
        DISABLE_WORKER_AUTOSCALE: "true"
      }
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
- Verify EMQX republish rule is preserved (routes device messages to `internal/server-ingest`)
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

## Dead Code Note

`gateway/udp-server.js` defines a `UdpServer` class that is NOT used by `mqtt-gateway.js`. The gateway creates a raw `dgram.createSocket('udp4')` directly at line 302. The `UdpServer` class can be removed or adopted in a future refactor, but is not part of this scaling work.

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
| 16 (4x4) | 32,000 | ~2,000 | 4 instances, auto-scaling disabled |

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
| Memory leak | Frame buffer cap + listener cleanup + worker session GC + MCP request cleanup |
| Uneven distribution | EMQX round-robin on shared subscription is fair. Monitor per-instance counts |
| Worker thread explosion | Auto-scaling disabled in multi-instance mode. Fixed 4 workers per instance |
| Server failure | Single point of failure at this scale. Future: add 2nd server |
| EMQX overload | EMQX handles 100K+ connections easily. Not a concern at 1000 |
| EMQX republish rule | Must verify rule is preserved when migrating EMQX to new droplet |

## Implementation Order

1. Phase 1 (memory fixes) — 2-3 hours
2. Phase 2 (multi-instance code) — 3-4 hours
3. Phase 3 (infrastructure migration) — 2-3 hours
4. Phase 4 (monitoring) — 1-2 hours

**Total estimated effort: 1-2 days**

## Appendix: Code Reference Map

Key files and the lines affected by this plan:

| File | Lines | What |
|------|-------|------|
| `core/streaming-crypto.js` | 19 | `maxCacheSize = 20` -> 300 |
| `livekit/livekit-bridge.js` | 93, 580, 659 | Frame buffer — add size cap |
| `livekit/livekit-bridge.js` | 2053-2129 | `close()` — add removeAllListeners, clear pendingMcpRequests/volumeAdjustmentQueue |
| `gateway/mqtt-gateway.js` | 367-439 | Ghost cleanup — batch processing |
| `gateway/mqtt-gateway.js` | 564 | MQTT client ID — add INSTANCE_ID |
| `gateway/mqtt-gateway.js` | 583 | Subscription — `$share/gateway/internal/server-ingest` |
| `gateway/mqtt-gateway.js` | 1157-1173 | Playback control subs — no change (already per-device) |
| `app.js` | 68 | WorkerPoolManager — read WORKER_COUNT from env |
| `core/worker-pool-manager.js` | 46 | Auto-scaling — add disable flag |
| `ecosystem.config.js` | all | Rewrite for 4 instances |
| `gateway/udp-server.js` | — | Dead code (not used by mqtt-gateway.js) |
