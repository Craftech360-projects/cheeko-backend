/**
 * MQTT Client Helper
 *
 * Wraps mqtt.js for E2E testing — connect, publish, subscribe with promises.
 */

const mqtt = require('mqtt');
const config = require('../../test.config');

class MqttTestClient {
  constructor(options = {}) {
    this.brokerUrl = options.brokerUrl || config.mqttGateway.brokerUrl;
    this.client = null;
    this.messages = [];
    this.subscriptions = new Map();
  }

  async connect(clientId) {
    return new Promise((resolve, reject) => {
      this.client = mqtt.connect(this.brokerUrl, {
        clientId: clientId || `e2e-test-${Date.now()}`,
        clean: true,
        connectTimeout: 10000,
        reconnectPeriod: 0, // no auto-reconnect in tests
      });

      const timeout = setTimeout(() => {
        reject(new Error('MQTT connection timeout'));
      }, 10000);

      this.client.on('connect', () => {
        clearTimeout(timeout);
        resolve();
      });

      this.client.on('error', (err) => {
        clearTimeout(timeout);
        reject(err);
      });

      this.client.on('message', (topic, payload) => {
        try {
          const data = JSON.parse(payload.toString());
          this.messages.push({ topic, data, timestamp: Date.now() });

          // Resolve any waiting subscriptions
          const handlers = this.subscriptions.get(topic) || [];
          handlers.forEach(handler => handler(data));
        } catch (_) {
          this.messages.push({ topic, raw: payload.toString(), timestamp: Date.now() });
        }
      });
    });
  }

  async publish(topic, payload) {
    return new Promise((resolve, reject) => {
      if (!this.client) return reject(new Error('Not connected'));
      const data = typeof payload === 'string' ? payload : JSON.stringify(payload);
      this.client.publish(topic, data, { qos: 1 }, (err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }

  async subscribe(topic) {
    return new Promise((resolve, reject) => {
      if (!this.client) return reject(new Error('Not connected'));
      this.client.subscribe(topic, { qos: 1 }, (err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }

  /**
   * Wait for a message on a topic (with timeout)
   */
  waitForMessage(topic, timeoutMs = 5000) {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error(`Timeout waiting for message on ${topic}`));
      }, timeoutMs);

      const handler = (data) => {
        clearTimeout(timeout);
        // Remove this handler
        const handlers = this.subscriptions.get(topic) || [];
        const idx = handlers.indexOf(handler);
        if (idx >= 0) handlers.splice(idx, 1);
        resolve(data);
      };

      if (!this.subscriptions.has(topic)) {
        this.subscriptions.set(topic, []);
      }
      this.subscriptions.get(topic).push(handler);
    });
  }

  getMessages(topic) {
    if (topic) return this.messages.filter(m => m.topic === topic);
    return this.messages;
  }

  clearMessages() {
    this.messages = [];
  }

  async disconnect() {
    return new Promise((resolve) => {
      if (!this.client) return resolve();
      this.client.end(false, {}, () => resolve());
    });
  }
}

module.exports = { MqttTestClient };
