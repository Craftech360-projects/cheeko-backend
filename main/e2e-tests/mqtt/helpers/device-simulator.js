/**
 * ESP32 Device Simulator
 *
 * Simulates an ESP32 device by publishing MQTT messages
 * in the same format the real device uses.
 */

const { MqttTestClient } = require('./mqtt-client.helper');

const INGEST_TOPIC = 'internal/server-ingest';

class DeviceSimulator {
  constructor(options = {}) {
    this.mac = options.mac || 'E2:E2:00:00:00:01';
    this.normalizedMac = this.mac.replace(/:/g, '').toLowerCase();
    this.mqttClient = new MqttTestClient(options);
    this.responseTopic = `internal/device/${this.normalizedMac}/response`;
  }

  async connect() {
    await this.mqttClient.connect(`e2e-device-${this.normalizedMac}`);
    await this.mqttClient.subscribe(this.responseTopic);
  }

  async disconnect() {
    await this.sendGoodbye();
    await this.mqttClient.disconnect();
  }

  async sendHello() {
    const payload = {
      type: 'hello',
      mac: this.normalizedMac,
      firmwareVersion: '1.0.0-e2e',
      model: 'esp32-test',
    };
    await this.mqttClient.publish(INGEST_TOPIC, payload);

    try {
      return await this.mqttClient.waitForMessage(this.responseTopic, 5000);
    } catch (_) {
      return null; // gateway might not respond to hello
    }
  }

  async sendGoodbye() {
    const payload = {
      type: 'goodbye',
      mac: this.normalizedMac,
    };
    await this.mqttClient.publish(INGEST_TOPIC, payload);
  }

  async sendModeChange(mode) {
    const payload = {
      type: 'mode-change',
      mac: this.normalizedMac,
      mode: mode,
    };
    await this.mqttClient.publish(INGEST_TOPIC, payload);

    try {
      return await this.mqttClient.waitForMessage(this.responseTopic, 5000);
    } catch (_) {
      return null;
    }
  }

  async sendCharacterChange(character) {
    const payload = {
      type: 'character-change',
      mac: this.normalizedMac,
      character: character,
    };
    await this.mqttClient.publish(INGEST_TOPIC, payload);

    try {
      return await this.mqttClient.waitForMessage(this.responseTopic, 5000);
    } catch (_) {
      return null;
    }
  }

  async sendPlaybackControl(action) {
    const payload = {
      type: 'playback_control',
      mac: this.normalizedMac,
      action: action, // 'next', 'previous', 'start_agent'
    };
    await this.mqttClient.publish(INGEST_TOPIC, payload);

    try {
      return await this.mqttClient.waitForMessage(this.responseTopic, 5000);
    } catch (_) {
      return null;
    }
  }

  async sendCardLookup(cardNo) {
    const payload = {
      type: 'card_lookup',
      mac: this.normalizedMac,
      card_no: cardNo,
    };
    await this.mqttClient.publish(INGEST_TOPIC, payload);

    try {
      return await this.mqttClient.waitForMessage(this.responseTopic, 5000);
    } catch (_) {
      return null;
    }
  }

  async sendFunctionCall(functionName, params = {}) {
    const payload = {
      type: 'function_call',
      mac: this.normalizedMac,
      name: functionName,
      params: params,
    };
    await this.mqttClient.publish(INGEST_TOPIC, payload);

    try {
      return await this.mqttClient.waitForMessage(this.responseTopic, 5000);
    } catch (_) {
      return null;
    }
  }

  async sendPlayMusic(query) {
    return this.sendFunctionCall('play_music', { query });
  }

  async sendPlayStory(query) {
    return this.sendFunctionCall('play_story', { query });
  }

  async sendAbort() {
    const payload = {
      type: 'abort',
      mac: this.normalizedMac,
    };
    await this.mqttClient.publish(INGEST_TOPIC, payload);
  }

  getMessages() {
    return this.mqttClient.getMessages();
  }

  clearMessages() {
    this.mqttClient.clearMessages();
  }
}

module.exports = { DeviceSimulator };
