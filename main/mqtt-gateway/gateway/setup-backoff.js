/**
 * Damping for the LiveKit setup path.
 *
 * On 2026-08-18 every setup failed, every device got a `goodbye`, and all ~50
 * toys re-sent `hello` at the same instant — repeatedly. Two levers here:
 *
 *  - per-device exponential backoff with jitter, so a fleet that fails together
 *    does not retry together;
 *  - a circuit breaker, so once the whole fleet is failing we stop attempting
 *    expensive setups against a dependency that is plainly down.
 */

// ponytail: tuning knobs, not config — a real fleet needs these calibrated.
const BASE_MS = 1000;
const MAX_MS = 30000;
const BREAKER_THRESHOLD = 5;
const BREAKER_COOLDOWN_MS = 30000;

class SetupBackoff {
  constructor({ now = Date.now } = {}) {
    this.now = now;
    this.failures = new Map(); // deviceId -> { count, jitter }
    this.consecutiveFailures = 0;
    this.openedAt = null;
  }

  /** How long to wait before attempting setup for this device. */
  delayFor(deviceId) {
    const entry = this.failures.get(deviceId);
    if (!entry) return 0;

    const base = Math.min(BASE_MS * 2 ** (entry.count - 1), MAX_MS);
    return Math.round(base * (1 + entry.jitter * 0.5));
  }

  recordFailure(deviceId) {
    const entry = this.failures.get(deviceId) || { count: 0, jitter: 0 };
    entry.count += 1;
    entry.jitter = Math.random(); // re-rolled so a device never stays in phase
    this.failures.set(deviceId, entry);

    this.consecutiveFailures += 1;
    if (this.consecutiveFailures >= BREAKER_THRESHOLD && this.openedAt === null) {
      this.openedAt = this.now();
    }
  }

  recordSuccess(deviceId) {
    this.failures.delete(deviceId);
    this.consecutiveFailures = 0;
    this.openedAt = null;
  }

  /** True while we should skip the setup attempt entirely and fail fast. */
  isOpen() {
    if (this.openedAt === null) return false;

    if (this.now() - this.openedAt > BREAKER_COOLDOWN_MS) {
      this.openedAt = null;
      this.consecutiveFailures = 0;
      return false;
    }
    return true;
  }
}

module.exports = { SetupBackoff, BREAKER_COOLDOWN_MS };
