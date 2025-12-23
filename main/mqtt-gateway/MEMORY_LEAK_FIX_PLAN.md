# Memory Leak Fix Plan for MQTT Gateway

## Executive Summary

| Issue | Impact | Priority |
|-------|--------|----------|
| Worker pool not terminated | ~40-60MB per device | **CRITICAL** |
| Event listeners not removed | Closures retained | HIGH |
| Maps not cleaned properly | References retained | HIGH |
| Circular references | GC blocked | MEDIUM |
| Per-device worker pool (4-8 each) | Wasteful design | FUTURE |

---

## Root Cause Analysis

### 1. Worker Pool Memory Leak (CRITICAL)

**Location:** `livekit/livekit-bridge.js`

**Problem:**
- Each `LiveKitBridge` creates its own `WorkerPoolManager` with 4-8 worker threads (line 88)
- `close()` method (line ~1998) does NOT call `workerPool.terminate()`
- Workers keep running after device disconnects

**Impact:**
```
Connect 1 device  → +4 workers (~40MB)
Disconnect        → workers NOT terminated (still 40MB leaked)
Connect 10 devices → +40 workers (~400MB)
Disconnect all    → 400MB leaked
```

### 2. Event Listener Leaks

**Location:** `mqtt/virtual-connection.js` and `livekit/livekit-bridge.js`

**Problem:**
- `bridge.on('close', ...)` listeners added but never removed
- Room event listeners (`participantConnected`, `trackSubscribed`, etc.) not cleaned up
- Each reconnection adds new listeners without removing old ones

### 3. Map Cleanup Issues

**Location:** `mqtt/virtual-connection.js` and `gateway/mqtt-gateway.js`

**Problems:**
- `deviceConnections` cleanup has 2-second `setTimeout` delay causing race conditions
- `clientConnections` Map is populated but NEVER cleaned
- Ghost cleanup has redundant/flawed `isAlive` check logic

### 4. Circular References

**Problem:**
- `VirtualMQTTConnection` → `gateway` → `connections` Map → `VirtualMQTTConnection`
- `LiveKitBridge` → `connection` → `bridge` → `LiveKitBridge`
- References not broken on close, blocking garbage collection

### 5. Buffer Retention

**Problem:**
- `udp.key`, `udp.nonce`, `headerBuffer` not nullified on close
- Audio buffers in LiveKitBridge not cleared

---

## Phase 1: Critical Fix - Worker Pool Termination ✅ COMPLETE

**Status:** ✅ **COMPLETE** (with graceful shutdown fix)

**File:** `livekit/livekit-bridge.js`

**Location:** `close()` method (line ~1998)

**Changes Required:**

```javascript
async close() {
  // NEW: Terminate worker pool FIRST
  if (this.workerPool) {
    console.log(`🛑 [CLEANUP] Terminating worker pool for ${this.macAddress}`);
    try {
      await this.workerPool.terminate();
    } catch (err) {
      console.warn(`⚠️ [CLEANUP] Worker pool termination error: ${err.message}`);
    }
    this.workerPool = null;
  }

  // ... existing room disconnect code ...
}
```

**Also Fix:** `handleDeviceModeChange` in `mqtt-gateway.js`

Before setting `existingConnection.bridge = null`, add:
```javascript
if (oldBridge.workerPool) {
  await oldBridge.workerPool.terminate();
  oldBridge.workerPool = null;
}
```

**Additional Fix Applied:** Graceful worker shutdown to prevent error exit codes
- Modified `audio-worker.js` to handle shutdown messages
- Updated `worker-pool-manager.js` to send shutdown messages before terminating
- See `PHASE1_FIX_SUMMARY.md` for details

---

## Phase 2: Event Listener Cleanup

**File:** `livekit/livekit-bridge.js`

**Changes Required:**

```javascript
// In constructor or connect(), store listener references
this._roomListeners = {
  participantConnected: this.onParticipantConnected.bind(this),
  trackSubscribed: this.onTrackSubscribed.bind(this),
  dataReceived: this.onDataReceived.bind(this),
  disconnected: this.onDisconnected.bind(this)
};

// In close(), remove listeners before disconnect
if (this.room) {
  this.room.removeAllListeners();
  // OR remove specific listeners:
  // Object.entries(this._roomListeners).forEach(([event, handler]) => {
  //   this.room.off(event, handler);
  // });
}
```

**File:** `mqtt/virtual-connection.js`

**Change:** Use `once()` instead of `on()` for bridge close event:
```javascript
// Change from:
this.bridge.on("close", () => { ... });

// To:
this.bridge.once("close", () => { ... });
```

---

## Phase 3: Map Cleanup Improvements

**File:** `mqtt/virtual-connection.js`

**Change:** Remove setTimeout delay in `close()`:
```javascript
// Change from:
setTimeout(() => {
  this.gateway.deviceConnections.delete(this.deviceId);
}, 2000);

// To (immediate cleanup):
this.gateway.deviceConnections.delete(this.deviceId);
this.gateway.connections.delete(this.connectionId);
```

**File:** `gateway/mqtt-gateway.js`

**Fix 1:** Add `clientConnections` cleanup in `cleanupGhostRoomsAndSessions()`:
```javascript
// 4. Clean up stale clientConnections entries
for (const [clientId, info] of this.clientConnections.entries()) {
  const deviceId = info?.deviceId;
  if (!deviceId || !this.deviceConnections.has(deviceId)) {
    this.clientConnections.delete(clientId);
  }
}
```

**Fix 2:** Fix redundant `isAlive` check:
```javascript
// Change from:
if (!connection || connection.closing || !connection.isAlive || !connection.isAlive()) {

// To:
const isStale = !connection ||
                connection.closing ||
                (typeof connection.isAlive === 'function' && !connection.isAlive());
if (isStale) {
```

---

## Phase 4: Break Circular References

**File:** `livekit/livekit-bridge.js` - end of `close()` method

```javascript
// After room disconnect and deletion, nullify all references
this.connection = null;
this.room = null;
this.roomService = null;
this.workerPool = null;

// Clear Maps
if (this.pendingMcpRequests) {
  this.pendingMcpRequests.clear();
  this.pendingMcpRequests = null;
}
```

**File:** `mqtt/virtual-connection.js` - end of `close()` method

```javascript
// After bridge close, nullify all references
this.gateway = null;
this.bridge = null;
this.udp = null;
this.headerBuffer = null;
```

---

## Phase 5: Buffer Cleanup ✅ COMPLETE

**Status:** ✅ **COMPLETE**

**File:** `mqtt/virtual-connection.js` - `close()` method

```javascript
// Clear UDP buffers
if (this.udp) {
  this.udp.key = null;
  this.udp.nonce = null;
  this.udp = null;
}
this.headerBuffer = null;
```

**File:** `livekit/livekit-bridge.js` - `close()` method

```javascript
// Clear audio buffers
this.audioBufferQueue = [];
this.pendingAudioFrames = [];
if (this.opusEncoder) {
  this.opusEncoder = null;
}
if (this.opusDecoder) {
  this.opusDecoder = null;
}
```

---

## Phase 6: Ghost Cleanup Enhancements ✅ COMPLETE

**Status:** ✅ **COMPLETE**

**File:** `gateway/mqtt-gateway.js` - `cleanupGhostRoomsAndSessions()`

### Add Memory Monitoring

```javascript
async cleanupGhostRoomsAndSessions() {
  const startTime = Date.now();
  const memBefore = process.memoryUsage();

  // ... existing cleanup code ...

  const memAfter = process.memoryUsage();
  const heapDiff = (memBefore.heapUsed - memAfter.heapUsed) / 1024 / 1024;

  logger.info(`📊 [GHOST-CLEANUP] Memory: Heap ${(memAfter.heapUsed / 1024 / 1024).toFixed(1)}MB, Released: ${heapDiff.toFixed(1)}MB`);
}
```

### Add Stale Activity Check

```javascript
// Check for connections with no recent activity
const now = Date.now();
const STALE_THRESHOLD = 5 * 60 * 1000; // 5 minutes

for (const [deviceId, deviceInfo] of this.deviceConnections.entries()) {
  const connection = deviceInfo?.connection;
  const lastActivity = connection?.lastActivityTime || 0;
  const isStale = (now - lastActivity) > STALE_THRESHOLD;

  if (isStale && connection?.bridge === null) {
    staleDevices.push(deviceId);
  }
}
```

---

## Implementation Order

| Step | Phase | Files | Estimated Time |
|------|-------|-------|----------------|
| 1 | Phase 1 | livekit-bridge.js, mqtt-gateway.js | 15 min |
| 2 | Phase 3 | virtual-connection.js, mqtt-gateway.js | 10 min |
| 3 | Phase 4 | livekit-bridge.js, virtual-connection.js | 10 min |
| 4 | Phase 2 | livekit-bridge.js, virtual-connection.js | 15 min |
| 5 | Phase 5 | virtual-connection.js, livekit-bridge.js | 5 min |
| 6 | Phase 6 | mqtt-gateway.js | 10 min |

**Total Estimated Time: ~65 minutes**

---

## Future Optimization: Global Shared Worker Pool

### Current Architecture (Wasteful)
```
Device 1 → LiveKitBridge → WorkerPoolManager (4 workers)
Device 2 → LiveKitBridge → WorkerPoolManager (4 workers)
Device 3 → LiveKitBridge → WorkerPoolManager (4 workers)
───────────────────────────────────────────────────────
Total: 12 workers for 3 devices (~120MB)
```

### Proposed Architecture (Optimal)
```
                    ┌─────────────────────────┐
                    │  Global Worker Pool     │
                    │  (4-8 workers shared)   │
                    └───────────┬─────────────┘
                                │
         ┌──────────────────────┼──────────────────────┐
         │                      │                      │
    Device 1              Device 2               Device 3
    LiveKitBridge         LiveKitBridge          LiveKitBridge
───────────────────────────────────────────────────────────────
Total: 4-8 workers for ALL devices (~40-80MB)
```

### Benefits
| Metric | Per-Device Pool | Shared Pool | Savings |
|--------|-----------------|-------------|---------|
| 10 devices | 40 workers | 6 workers | 85% |
| 50 devices | 200 workers | 8 workers | 96% |
| Memory (10 dev) | ~400MB | ~60MB | 85% |

### Implementation Notes
1. Create `WorkerPoolManager` singleton in `MQTTGateway`
2. Pass reference to each `LiveKitBridge` instance
3. Scale formula: `min(4 + floor(deviceCount/10), 8)`
4. Never terminate pool on device disconnect (only on gateway stop)

---

## Testing Plan

### Manual Test
1. Start gateway, note baseline memory: `pm2 monit`
2. Connect 5 ESP32 devices
3. Note memory usage (should be ~baseline + 5×overhead)
4. Disconnect all 5 devices
5. Wait 60 seconds for cleanup
6. Check memory - should return close to baseline

### Automated Test Script
```bash
#!/bin/bash
echo "=== Memory Leak Test ==="
echo "Baseline:"
pm2 show mqtt-gateway | grep memory

echo "Connecting 10 devices..."
# (device connection simulation)
sleep 10

echo "After connections:"
pm2 show mqtt-gateway | grep memory

echo "Disconnecting all..."
# (device disconnection simulation)
sleep 60

echo "After cleanup:"
pm2 show mqtt-gateway | grep memory
```

### Success Criteria
- Memory returns to within 10% of baseline after all disconnections
- No increase in worker thread count after disconnections
- Ghost cleanup logs show rooms/sessions being cleaned

---

## Monitoring Commands

```bash
# Check PM2 memory
pm2 monit

# Check process memory details
ps aux | grep mqtt-gateway

# Check worker threads
ps -eLf | grep mqtt-gateway | wc -l

# Force garbage collection (if --expose-gc enabled)
node -e "global.gc()"
```

---

## Rollback Plan

If issues occur after implementation:
1. Revert changes via git
2. Restart gateway: `pm2 restart mqtt-gateway`
3. Monitor memory for stability

---

## Document History

| Date | Version | Changes |
|------|---------|---------|
| 2024-12-23 | 1.0 | Initial plan created |
