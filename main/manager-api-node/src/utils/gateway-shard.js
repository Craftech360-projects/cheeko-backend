/**
 * Device -> gateway-instance routing (gateway item 5, phase 1).
 *
 * MUST stay byte-for-byte identical to main/mqtt-gateway/gateway/shard.js.
 * The gateway drops MQTT messages for devices it does not own, so if these two
 * hashes ever disagree, manager-api pushes settings to an instance that will
 * silently ignore them. tests/gateway-shard.test.js pins the agreement.
 */

function normalizeMac(mac) {
  return String(mac || '').replace(/[^0-9a-zA-Z]/g, '').toUpperCase();
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

/**
 * Base URL of the gateway instance that owns this device.
 * Single-instance deployments keep using MQTT_GATEWAY_INTERNAL_URL unchanged.
 */
function gatewayUrlFor(mac) {
  const base = (process.env.MQTT_GATEWAY_INTERNAL_URL || 'http://127.0.0.1:8091').replace(/\/$/, '');
  const count = parseInt(process.env.GATEWAY_SHARD_COUNT, 10) || 1;
  if (count <= 1) return base;

  const basePort = parseInt(process.env.GATEWAY_INTERNAL_BASE_PORT, 10) || 8091;
  const port = basePort + shardFor(mac, count);
  return base.replace(/:\d+$/, `:${port}`);
}

module.exports = { shardFor, normalizeMac, gatewayUrlFor };
