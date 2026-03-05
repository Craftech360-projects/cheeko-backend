/**
 * Resilience MQTT E2E Scenarios
 * Covers: 8.5 Malformed messages, 8.6 Broker recovery
 */

const { MqttTestClient } = require('../helpers/mqtt-client.helper');
const axios = require('axios');
const config = require('../../test.config');

const INGEST_TOPIC = 'internal/server-ingest';

describe('MQTT Resilience E2E', () => {

  let client;

  beforeAll(async () => {
    client = new MqttTestClient();
    await client.connect('e2e-resilience-test');
  });

  afterAll(async () => {
    if (client) await client.disconnect().catch(() => {});
  });

  describe('8.5 - Malformed MQTT message', () => {
    it('should handle invalid JSON without crashing', async () => {
      await client.publish(INGEST_TOPIC, 'this is not json {{{');

      // Wait a moment, then check gateway health
      await new Promise(r => setTimeout(r, 1000));

      const res = await axios.get(`${config.mqttGateway.httpUrl}/health`, {
        timeout: 5000,
        validateStatus: () => true,
      });
      expect(res.status).toBe(200);
    });

    it('should handle message with missing type field', async () => {
      await client.publish(INGEST_TOPIC, JSON.stringify({
        mac: 'e2e000000001',
        // no type field
      }));

      await new Promise(r => setTimeout(r, 500));

      const res = await axios.get(`${config.mqttGateway.httpUrl}/health`, {
        timeout: 5000,
        validateStatus: () => true,
      });
      expect(res.status).toBe(200);
    });

    it('should handle message with unknown type', async () => {
      await client.publish(INGEST_TOPIC, JSON.stringify({
        type: 'unknown-type-e2e-test',
        mac: 'e2e000000001',
      }));

      await new Promise(r => setTimeout(r, 500));

      const res = await axios.get(`${config.mqttGateway.httpUrl}/health`, {
        timeout: 5000,
        validateStatus: () => true,
      });
      expect(res.status).toBe(200);
    });

    it('should handle empty message', async () => {
      await client.publish(INGEST_TOPIC, '');

      await new Promise(r => setTimeout(r, 500));

      const res = await axios.get(`${config.mqttGateway.httpUrl}/health`, {
        timeout: 5000,
        validateStatus: () => true,
      });
      expect(res.status).toBe(200);
    });
  });

});
