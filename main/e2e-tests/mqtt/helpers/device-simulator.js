/**
 * ESP32 Device Simulator
 *
 * Simulates an ESP32 device by publishing MQTT messages to `internal/server-ingest`
 * in the EMQX republish format:
 *   { sender_client_id: "device@@@aa_bb_cc_dd_ee_ff", orginal_payload: { ... } }
 *
 * Subscribes to `devices/p2p/{clientId}` for gateway responses.
 *
 * Note: "orginal_payload" is intentionally misspelled — legacy gateway code.
 */

const { MqttTestClient } = require('./mqtt-client.helper');

const INGEST_TOPIC = 'internal/server-ingest';

class DeviceSimulator {
  constructor(options = {}) {
    this.mac = options.mac || 'E2:E2:00:00:00:01';
    // Normalized MAC: lowercase, no separators (e.g. "e2e200000001")
    this.normalizedMac = this.mac.replace(/[:\-]/g, '').toLowerCase();
    // EMQX client ID format: device@@@aa_bb_cc_dd_ee_ff
    this.clientId = this._buildClientId();
    // Response topic the gateway publishes to
    this.responseTopic = `devices/p2p/${this.clientId}`;
    this.mqttClient = new MqttTestClient(options);
  }

  /**
   * Build the EMQX-style client ID from MAC address.
   * E.g., MAC "E2:E2:00:00:00:01" → "device@@@e2_e2_00_00_00_01"
   */
  _buildClientId() {
    // Split MAC into bytes (supports : or - separators, or raw hex)
    const clean = this.mac.replace(/[:\-]/g, '').toLowerCase();
    const pairs = clean.match(/.{2}/g);
    return `device@@@${pairs.join('_')}`;
  }

  /**
   * Wrap a payload in the EMQX republish envelope.
   */
  _wrapPayload(payload) {
    return {
      sender_client_id: this.clientId,
      orginal_payload: payload,
    };
  }

  async connect() {
    await this.mqttClient.connect(`e2e-device-${this.normalizedMac}`);
    await this.mqttClient.subscribe(this.responseTopic);
  }

  async disconnect() {
    await this.sendGoodbye();
    await this.mqttClient.disconnect();
  }

  /**
   * Disconnect without sending goodbye (for abrupt disconnect tests).
   */
  async disconnectQuiet() {
    await this.mqttClient.disconnect();
  }

  /**
   * Wait for a response on the device's p2p topic.
   * Returns null if no response within timeout (soft fail).
   */
  async _waitResponse(timeoutMs = 3000) {
    return this.mqttClient.waitForMessage(this.responseTopic, timeoutMs, { softFail: true });
  }

  // ── Message senders ──────────────────────────────────────────────

  async sendHello(options = {}) {
    const payload = {
      type: 'hello',
      mac: this.normalizedMac,
      firmwareVersion: options.firmwareVersion || '1.0.0-e2e',
      model: options.model || 'esp32-test',
    };
    await this.mqttClient.publish(INGEST_TOPIC, this._wrapPayload(payload));
    return this._waitResponse();
  }

  async sendGoodbye() {
    const payload = {
      type: 'goodbye',
      mac: this.normalizedMac,
    };
    await this.mqttClient.publish(INGEST_TOPIC, this._wrapPayload(payload));
  }

  async sendModeChange(mode) {
    const payload = {
      type: 'mode-change',
      mac: this.normalizedMac,
      mode: mode,
    };
    await this.mqttClient.publish(INGEST_TOPIC, this._wrapPayload(payload));
    return this._waitResponse();
  }

  async sendCharacterChange(characterName) {
    const payload = {
      type: 'character-change',
      mac: this.normalizedMac,
      characterName: characterName,
    };
    await this.mqttClient.publish(INGEST_TOPIC, this._wrapPayload(payload));
    return this._waitResponse();
  }

  async sendPlaybackControl(action) {
    const payload = {
      type: 'playback_control',
      mac: this.normalizedMac,
      action: action, // 'next', 'previous', 'start_agent'
    };
    await this.mqttClient.publish(INGEST_TOPIC, this._wrapPayload(payload));
    return this._waitResponse();
  }

  async sendCardLookup(rfidUid) {
    const payload = {
      type: 'card_lookup',
      mac: this.normalizedMac,
      rfid_uid: rfidUid,
    };
    await this.mqttClient.publish(INGEST_TOPIC, this._wrapPayload(payload));
    return this._waitResponse();
  }

  async sendStartGreeting(rfidUid, sequence) {
    const payload = {
      type: 'start_greeting',
      mac: this.normalizedMac,
      rfid_uid: rfidUid,
    };
    if (sequence !== undefined) {
      payload.sequence = sequence;
    }
    await this.mqttClient.publish(INGEST_TOPIC, this._wrapPayload(payload));
    return this._waitResponse();
  }

  async sendStartGreetingText(rfidUid) {
    const payload = {
      type: 'start_greeting_text',
      mac: this.normalizedMac,
      rfid_uid: rfidUid,
    };
    await this.mqttClient.publish(INGEST_TOPIC, this._wrapPayload(payload));
    return this._waitResponse();
  }

  async sendDownloadRequest(rfidUid) {
    const payload = {
      type: 'download_request',
      mac: this.normalizedMac,
      rfid_uid: rfidUid,
    };
    await this.mqttClient.publish(INGEST_TOPIC, this._wrapPayload(payload));
    return this._waitResponse();
  }

  async sendFunctionCall(functionName, args = {}) {
    const payload = {
      type: 'function_call',
      mac: this.normalizedMac,
      function_call: {
        name: functionName,
        arguments: args,
      },
    };
    await this.mqttClient.publish(INGEST_TOPIC, this._wrapPayload(payload));
    return this._waitResponse();
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
    await this.mqttClient.publish(INGEST_TOPIC, this._wrapPayload(payload));
  }

  async sendListen(state, mode) {
    const payload = {
      type: 'listen',
      mac: this.normalizedMac,
      state: state, // 'start', 'stop'
    };
    if (mode) payload.mode = mode; // 'manual', 'vad'
    await this.mqttClient.publish(INGEST_TOPIC, this._wrapPayload(payload));
    return this._waitResponse();
  }

  async sendSpeechEnd() {
    const payload = {
      type: 'speech_end',
      mac: this.normalizedMac,
    };
    await this.mqttClient.publish(INGEST_TOPIC, this._wrapPayload(payload));
    return this._waitResponse();
  }

  async sendMcpResponse(data = {}) {
    const payload = {
      type: 'mcp',
      mac: this.normalizedMac,
      ...data,
    };
    await this.mqttClient.publish(INGEST_TOPIC, this._wrapPayload(payload));
    return this._waitResponse();
  }

  async sendMobileMusicRequest(songName, contentType = 'music', language = 'en') {
    const payload = {
      type: 'mobile_music_request',
      mac: this.normalizedMac,
      song_name: songName,
      content_type: contentType,
      language: language,
    };
    await this.mqttClient.publish(INGEST_TOPIC, this._wrapPayload(payload));
    return this._waitResponse();
  }

  async sendHabitDownloadRequest(rfidUid) {
    const payload = {
      type: 'habit_download_request',
      mac: this.normalizedMac,
      rfid_uid: rfidUid,
    };
    await this.mqttClient.publish(INGEST_TOPIC, this._wrapPayload(payload));
    return this._waitResponse();
  }

  async sendRhymeDownloadRequest(rfidUid) {
    const payload = {
      type: 'rhyme_download_request',
      mac: this.normalizedMac,
      rfid_uid: rfidUid,
    };
    await this.mqttClient.publish(INGEST_TOPIC, this._wrapPayload(payload));
    return this._waitResponse();
  }

  async sendReadyForGreeting() {
    const payload = {
      type: 'ready_for_greeting',
      mac: this.normalizedMac,
    };
    await this.mqttClient.publish(INGEST_TOPIC, this._wrapPayload(payload));
    return this._waitResponse();
  }

  // ── Message inspection ────────────────────────────────────────────

  getMessages() {
    return this.mqttClient.getMessages();
  }

  getResponseMessages() {
    return this.mqttClient.getMessages(this.responseTopic);
  }

  clearMessages() {
    this.mqttClient.clearMessages();
  }

  isConnected() {
    return this.mqttClient.isConnected();
  }
}

module.exports = { DeviceSimulator };
