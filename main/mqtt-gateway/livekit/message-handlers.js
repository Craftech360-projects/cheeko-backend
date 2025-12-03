/**
 * LiveKit Message Handlers
 * 
 * Handles TTS, STT, emotion, and other LiveKit agent messages.
 * Sends appropriate messages back to ESP32 device.
 */

/**
 * Message handlers for LiveKit events
 */
class MessageHandlers {
    constructor(bridge) {
        this.bridge = bridge;
    }

    /**
     * Send TTS start message to device
     * @param {string} text - TTS text
     */
    sendTtsStartMessage(text) {
        if (!this.bridge.connection || !this.bridge.connection.sendMqttMessage) {
            console.error(`❌ [TTS] No connection available`);
            return;
        }

        const message = {
            type: 'tts_start',
            text: text || '',
            timestamp: Date.now(),
        };

        this.bridge.connection.sendMqttMessage(JSON.stringify(message));
        console.log(`🎵 [TTS-START] Sent to device: ${this.bridge.macAddress}`);
    }

    /**
     * Send TTS stop message to device
     */
    sendTtsStopMessage() {
        if (!this.bridge.connection || !this.bridge.connection.sendMqttMessage) {
            console.error(`❌ [TTS] No connection available`);
            return;
        }

        const message = {
            type: 'tts_stop',
            timestamp: Date.now(),
        };

        this.bridge.connection.sendMqttMessage(JSON.stringify(message));
        console.log(`🎵 [TTS-STOP] Sent to device: ${this.bridge.macAddress}`);
    }

    /**
     * Send STT message to device
     * @param {string} transcript - Transcribed text
     */
    sendSttMessage(transcript) {
        if (!this.bridge.connection || !this.bridge.connection.sendMqttMessage) {
            console.error(`❌ [STT] No connection available`);
            return;
        }

        const message = {
            type: 'stt',
            text: transcript,
            timestamp: Date.now(),
        };

        this.bridge.connection.sendMqttMessage(JSON.stringify(message));
        console.log(`🎤 [STT] Sent transcript: "${transcript}"`);
    }

    /**
     * Send emotion message to device
     * @param {string} text - Emotion text
     * @param {string} emotion - Emotion type
     */
    sendEmotionMessage(text, emotion) {
        if (!this.bridge.connection || !this.bridge.connection.sendMqttMessage) {
            console.error(`❌ [EMOTION] No connection available`);
            return;
        }

        const message = {
            type: 'emotion',
            text: text,
            emotion: emotion,
            timestamp: Date.now(),
        };

        this.bridge.connection.sendMqttMessage(JSON.stringify(message));
        console.log(`😊 [EMOTION] Sent: ${emotion} - "${text}"`);
    }

    /**
     * Send LLM thinking message to device
     */
    sendLLMThinkMessage() {
        if (!this.bridge.connection || !this.bridge.connection.sendMqttMessage) {
            console.error(`❌ [LLM] No connection available`);
            return;
        }

        const message = {
            type: 'llm_thinking',
            timestamp: Date.now(),
        };

        this.bridge.connection.sendMqttMessage(JSON.stringify(message));
        console.log(`🤔 [LLM] Sent thinking message`);
    }

    /**
     * Handle mobile music request
     * @param {Object} data - Music request data
     */
    handleMobileMusicRequest(data) {
        console.log(`🎵 [MOBILE-MUSIC] Processing request:`, data);

        // Forward to device or handle appropriately
        if (this.bridge.connection && this.bridge.connection.sendMqttMessage) {
            this.bridge.connection.sendMqttMessage(JSON.stringify({
                type: 'mobile_music_request',
                ...data,
                timestamp: Date.now(),
            }));
        }
    }

    /**
     * Convert device control commands to MCP function calls
     * @param {Object} data - Device control data
     */
    convertDeviceControlToMcp(data) {
        console.log(`🎛️ [DEVICE-CONTROL] Converting to MCP:`, data.action);

        // Map device control actions to MCP function calls
        const actionMap = {
            'set_volume': 'self.audio_speaker.set_volume',
            'mute': 'self.audio_speaker.mute',
            'unmute': 'self.audio_speaker.unmute',
            'set_led_color': 'self.led.set_color',
            'set_led_mode': 'self.led.set_mode',
        };

        const mcpFunction = actionMap[data.action];
        if (mcpFunction && this.bridge.mcpHandler) {
            this.bridge.mcpHandler.sendMcpRequest(
                mcpFunction,
                data.params || {},
                data.id
            );
        } else {
            console.warn(`⚠️ [DEVICE-CONTROL] Unknown action: ${data.action}`);
        }
    }
}

module.exports = {
    MessageHandlers,
};
