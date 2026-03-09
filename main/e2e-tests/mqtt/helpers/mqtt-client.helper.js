/**
 * MQTT Client Helper
 *
 * Wraps mqtt.js for E2E testing — connect, publish, subscribe with promises.
 * Connects to the same EMQX broker as the gateway under test.
 */

const mqtt = require('mqtt');
const config = require('../../test.config');

class MqttTestClient {
  constructor(options = {}) {
    this.brokerUrl = options.brokerUrl || config.mqttGateway.brokerUrl;
    this.client = null;
    this.messages = [];
    this.subscriptions = new Map();
    this.connected = false;
  }

  async connect(clientId) {
    return new Promise((resolve, reject) => {
      this.client = mqtt.connect(this.brokerUrl, {
        clientId: clientId || `e2e-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        clean: true,
        connectTimeout: 10000,
        reconnectPeriod: 0, // no auto-reconnect in tests
        keepalive: 30,
      });

      const timeout = setTimeout(() => {
        this.client.end(true);
        reject(new Error(`MQTT connection timeout to ${this.brokerUrl}`));
      }, 10000);

      this.client.on('connect', () => {
        clearTimeout(timeout);
        this.connected = true;
        resolve();
      });

      this.client.on('error', (err) => {
        clearTimeout(timeout);
        reject(err);
      });

      this.client.on('close', () => {
        this.connected = false;
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
      if (!this.client || !this.connected) {
        return reject(new Error('Not connected'));
      }
      const data = typeof payload === 'string' ? payload : JSON.stringify(payload);
      this.client.publish(topic, data, { qos: 1 }, (err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }

  async subscribe(topic) {
    return new Promise((resolve, reject) => {
      if (!this.client || !this.connected) {
        return reject(new Error('Not connected'));
      }
      this.client.subscribe(topic, { qos: 1 }, (err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }

  /**
   * Wait for a message on a topic (with timeout).
   * Resolves with the parsed message data, or null if timeout is reached
   * and softFail is true.
   */
  waitForMessage(topic, timeoutMs = 3000, { softFail = false } = {}) {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        // Remove handler
        const handlers = this.subscriptions.get(topic) || [];
        const idx = handlers.indexOf(handler);
        if (idx >= 0) handlers.splice(idx, 1);

        if (softFail) {
          resolve(null);
        } else {
          reject(new Error(`Timeout waiting for message on ${topic} (${timeoutMs}ms)`));
        }
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

  isConnected() {
    return this.connected && this.client && !this.client.disconnecting;
  }

  async disconnect() {
    return new Promise((resolve) => {
      if (!this.client) return resolve();
      this.connected = false;
      this.client.end(false, {}, () => resolve());
    });
  }
}

module.exports = { MqttTestClient };
