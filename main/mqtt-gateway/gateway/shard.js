/**
 * Horizontal sharding for the gateway (item 5, phase 1).
 *
 * The gateway is single-threaded and tops out around 30-40 concurrent real-audio
 * sessions, so capacity is grown by running N instances instead of one. There is
 * no shared state and no load balancer: a device is wholly owned by one instance,
 * chosen by hashing its MAC. manager-api runs the SAME hash when it answers OTA,
 * so it hands each toy the UDP port of the instance that will own it.
 *
 * FNV-1a is used because it is tiny, deterministic, and trivial to reimplement
 * identically in manager-api — the two sides agreeing matters far more than the
 * hash quality. Keep this function and manager-api's copy byte-for-byte in step.
 */

/** Strips separators/case so AA:BB.., aa-bb.. and AABB.. are one device. */
function normalizeMac(mac) {
  return String(mac || "").replace(/[^0-9a-zA-Z]/g, "").toUpperCase();
}

function shardFor(mac, count) {
  const n = parseInt(count, 10) || 1;
  if (n <= 1) return 0;

  let hash = 0x811c9dc5; // FNV-1a 32-bit offset basis
  const key = normalizeMac(mac);
  for (let i = 0; i < key.length; i++) {
    hash ^= key.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0; // FNV prime, kept unsigned
  }
  return hash % n;
}

/** True when this instance is the one that must serve the device. */
function ownsDevice(mac, index, count) {
  return shardFor(mac, count) === (parseInt(index, 10) || 0);
}

module.exports = { shardFor, normalizeMac, ownsDevice };
