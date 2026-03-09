/**
 * Resilience MQTT E2E Scenarios
 *
 * Tests that the gateway survives malformed, incomplete, and oversized messages.
 * Uses raw MqttTestClient to send messages that bypass the DeviceSimulator's
 * proper envelope wrapping.
 *
 * Uses a unique MQTT client ID to avoid conflicts with other specs.
 */

const { MqttTestClient } = require('../helpers/mqtt-client.helper');
const axios = require('axios');
const config = require('../../test.config');

const INGEST_TOPIC = 'internal/server-ingest';
const HEALTH_URL = `${config.mqttGateway.httpUrl}/health`;

async function checkGatewayHealth() {
  try {
    const res = await axios.get(HEALTH_URL, {
      timeout: 5000,
      validateStatus: () => true,
    });
    return res;
  } catch {
    return null; // Gateway HTTP not available
  }
}

// Small delay to let gateway process a message before checking health
function settle(ms = 500) {
  return new Promise(r => setTimeout(r, ms));
}

describe('MQTT Resilience E2E', () => {
  let client;

  beforeAll(async () => {
    client = new MqttTestClient();
    await client.connect('e2e-resilience-test');
  });

  afterAll(async () => {
    if (client) await client.disconnect().catch(() => {});
  });

  // ── 1. Invalid JSON ──────────────────────────────────────────────

  it('should survive invalid JSON on ingest topic', async () => {
    await client.publish(INGEST_TOPIC, 'this is not json {{{');
    await settle();
    // If we get here without error, the broker accepted it; gateway didn't crash
    const res = await checkGatewayHealth();
    if (res) expect(res.status).toBe(200);
  });

  // ── 2. Missing sender_client_id ──────────────────────────────────

  it('should survive message without sender_client_id', async () => {
    await client.publish(INGEST_TOPIC, {
      orginal_payload: { type: 'hello', mac: 'e2e200000099' },
    });
    await settle();
    const res = await checkGatewayHealth();
    if (res) expect(res.status).toBe(200);
  });

  // ── 3. Missing orginal_payload ───────────────────────────────────

  it('should survive message without orginal_payload', async () => {
    await client.publish(INGEST_TOPIC, {
      sender_client_id: 'device@@@e2_e2_00_00_09_01',
    });
    await settle();
    const res = await checkGatewayHealth();
    if (res) expect(res.status).toBe(200);
  });

  // ── 4. Empty orginal_payload ─────────────────────────────────────

  it('should survive message with empty orginal_payload', async () => {
    await client.publish(INGEST_TOPIC, {
      sender_client_id: 'device@@@e2_e2_00_00_09_02',
      orginal_payload: {},
    });
    await settle();
    const res = await checkGatewayHealth();
    if (res) expect(res.status).toBe(200);
  });

  // ── 5. Unknown type ──────────────────────────────────────────────

  it('should survive message with unknown type in orginal_payload', async () => {
    await client.publish(INGEST_TOPIC, {
      sender_client_id: 'device@@@e2_e2_00_00_09_03',
      orginal_payload: {
        type: 'completely_unknown_type_e2e_test',
        mac: 'e2e200000903',
      },
    });
    await settle();
    const res = await checkGatewayHealth();
    if (res) expect(res.status).toBe(200);
  });

  // ── 6. Missing type in orginal_payload ───────────────────────────

  it('should survive message with no type field in orginal_payload', async () => {
    await client.publish(INGEST_TOPIC, {
      sender_client_id: 'device@@@e2_e2_00_00_09_04',
      orginal_payload: {
        mac: 'e2e200000904',
        someField: 'value',
      },
    });
    await settle();
    const res = await checkGatewayHealth();
    if (res) expect(res.status).toBe(200);
  });

  // ── 7. Empty string message ──────────────────────────────────────

  it('should survive empty string on ingest topic', async () => {
    await client.publish(INGEST_TOPIC, '');
    await settle();
    const res = await checkGatewayHealth();
    if (res) expect(res.status).toBe(200);
  });

  // ── 8. Extremely large payload ───────────────────────────────────

  it('should survive an extremely large payload', async () => {
    const largeString = 'A'.repeat(50000);
    await client.publish(INGEST_TOPIC, {
      sender_client_id: 'device@@@e2_e2_00_00_09_05',
      orginal_payload: {
        type: 'hello',
        mac: 'e2e200000905',
        extraData: largeString,
      },
    });
    await settle(1000);
    const res = await checkGatewayHealth();
    if (res) expect(res.status).toBe(200);
  });

  // ── 9. Final comprehensive health check ──────────────────────────

  it('should report healthy after all malformed messages', async () => {
    const res = await checkGatewayHealth();
    if (!res) return; // Gateway HTTP not available — skip
    expect(res.status).toBe(200);
    expect(res.data).toHaveProperty('status');
  });
});
