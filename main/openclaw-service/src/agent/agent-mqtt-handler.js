/**
 * Agent MQTT Handler
 * Handles MQTT communication for the OpenClaw agent
 */

const logger = require('../utils/logger');

class AgentMQTTHandler {
    constructor(mqttClient, agent, livekitHandler) {
        this.mqttClient = mqttClient;
        this.agent = agent;
        this.livekitHandler = livekitHandler;

        this.setupListeners();
        logger.info('[AGENT-MQTT] Handler initialized');
    }

    /**
     * Set up MQTT listeners
     */
    setupListeners() {
        // Check if MQTT client is ready
        if (!this.mqttClient || !this.mqttClient.client) {
            logger.warn('[AGENT-MQTT] MQTT client not ready, will subscribe when connected');
            // Set up listener for when client connects
            if (this.mqttClient) {
                const checkInterval = setInterval(() => {
                    if (this.mqttClient.client && this.mqttClient.connected) {
                        clearInterval(checkInterval);
                        this.actuallySetupListeners();
                    }
                }, 1000);
            }
            return;
        }

        this.actuallySetupListeners();
    }

    /**
     * Actually set up the MQTT listeners (called when client is ready)
     */
    actuallySetupListeners() {
        // Listen for voice data from gateway
        this.mqttClient.client.on('message', async (topic, message) => {
            try {
                // Handle internal/server-ingest messages (device events)
                if (topic === 'internal/server-ingest') {
                    try {
                        const payload = JSON.parse(message.toString());
                        const originalPayload = payload.orginal_payload;

                        if (originalPayload && originalPayload.type === 'ready_for_greeting') {
                            // Extract device MAC from client ID
                            const clientId = payload.sender_client_id;
                            if (clientId) {
                                const parts = clientId.split('@@@');
                                if (parts.length >= 2) {
                                    const deviceMac = parts[1].replace(/_/g, ':');
                                    await this.handleReadyForGreeting(deviceMac);
                                }
                            }
                        }
                    } catch (parseError) {
                        // Ignore parse errors for non-JSON messages
                    }
                    return;
                }

                // Check if this is a voice data message
                if (topic.startsWith('device/') && topic.endsWith('/voice')) {
                    await this.handleVoiceData(topic, message);
                }

                // Check if this is a text message (RFID, reminders, etc.)
                if (topic.startsWith('device/') && topic.endsWith('/text')) {
                    await this.handleTextData(topic, message);
                }
            } catch (error) {
                logger.error('[AGENT-MQTT] Error handling message:', error);
            }
        });

        // Subscribe to relevant topics
        this.subscribeToTopics();
        logger.info('[AGENT-MQTT] Listeners set up successfully');
    }

    /**
     * Subscribe to device topics
     */
    subscribeToTopics() {
        // Subscribe to all device voice and text topics
        this.mqttClient.client.subscribe('device/+/voice', (err) => {
            if (err) {
                logger.error('[AGENT-MQTT] Error subscribing to voice topics:', err);
            } else {
                logger.info('[AGENT-MQTT] Subscribed to device/+/voice');
            }
        });

        this.mqttClient.client.subscribe('device/+/text', (err) => {
            if (err) {
                logger.error('[AGENT-MQTT] Error subscribing to text topics:', err);
            } else {
                logger.info('[AGENT-MQTT] Subscribed to device/+/text');
            }
        });

        // Subscribe to internal/server-ingest for device messages (including ready_for_greeting)
        this.mqttClient.client.subscribe('internal/server-ingest', (err) => {
            if (err) {
                logger.error('[AGENT-MQTT] Error subscribing to server-ingest:', err);
            } else {
                logger.info('[AGENT-MQTT] Subscribed to internal/server-ingest for device events');
            }
        });

        // Setup Agent Audio Response Callback (for streaming responses)
        this.agent.onAudioResponse = async (deviceMac, audioBuffer) => {
            try {
                if (audioBuffer) {
                    await this.livekitHandler.sendAudio(deviceMac, audioBuffer);
                    logger.info(`[AGENT-MQTT] Sent async audio response to ${deviceMac}`);
                }
            } catch (err) {
                logger.error(`[AGENT-MQTT] Error sending async response: ${err.message}`);
            }
        };
    }

    /**
     * Handle ready_for_greeting message
     * @param {string} deviceMac - Device MAC address
     */
    async handleReadyForGreeting(deviceMac) {
        try {
            logger.info(`[AGENT-MQTT] Device ${deviceMac} ready for greeting`);

            // Generate greeting using agent
            const greetingText = "Hello! I'm Cheeko, your friendly companion. How can I help you today?";

            const response = await this.agent.processTextInput(
                deviceMac,
                greetingText,
                { isGreeting: true }
            );

            if (response) {
                // Send audio greeting via LiveKit
                await this.livekitHandler.sendAudio(deviceMac, response.audioBuffer);
                logger.info(`[AGENT-MQTT] Sent greeting to ${deviceMac}`);
            }

        } catch (error) {
            logger.error('[AGENT-MQTT] Error sending greeting:', error);
        }
    }

    /**
     * Handle voice data from device
     * @param {string} topic - MQTT topic
     * @param {Buffer} message - Audio data
     */
    async handleVoiceData(topic, message) {
        try {
            // Extract device MAC from topic: device/{MAC}/voice
            const deviceMac = topic.split('/')[1];

            // logger.debug(`[AGENT-MQTT] Received voice data from ${deviceMac} (${message.length} bytes)`);

            // Process voice input through agent (Streaming Mode)
            // We feed chunks to the persist Deepgram session
            await this.agent.processVoiceStream(deviceMac, message);

        } catch (error) {
            logger.error('[AGENT-MQTT] Error handling voice data:', error);
        }
    }

    /**
     * Handle text data from device (RFID, reminders, etc.)
     * @param {string} topic - MQTT topic
     * @param {Buffer} message - Text data
     */
    async handleTextData(topic, message) {
        try {
            // Extract device MAC from topic
            const deviceMac = topic.split('/')[1];
            const data = JSON.parse(message.toString());

            logger.info(`[AGENT-MQTT] Received text data from ${deviceMac}:`, data);

            // Check if this is a reminder
            const isReminder = data.type === 'reminder' || (data.text && data.text.startsWith('Reminder:'));

            // Process text input through agent
            const response = await this.agent.processTextInput(
                deviceMac,
                data.text || data.content,
                { isReminder }
            );

            if (response) {
                // Send audio response via LiveKit
                await this.livekitHandler.sendAudio(deviceMac, response.audioBuffer);

                logger.info(`[AGENT-MQTT] Sent response to ${deviceMac}: "${response.responseText}"`);
            }

        } catch (error) {
            logger.error('[AGENT-MQTT] Error handling text data:', error);
        }
    }

    /**
     * Send text message to device
     * @param {string} deviceMac - Device MAC address
     * @param {string} text - Text message
     */
    async sendTextToDevice(deviceMac, text) {
        try {
            const topic = `device/${deviceMac}/agent_message`;
            const message = JSON.stringify({ text, timestamp: Date.now() });

            this.mqttClient.client.publish(topic, message, { qos: 1 });
            logger.info(`[AGENT-MQTT] Sent text to ${deviceMac}: "${text}"`);

        } catch (error) {
            logger.error('[AGENT-MQTT] Error sending text:', error);
        }
    }
}

module.exports = AgentMQTTHandler;
