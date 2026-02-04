/**
 * MQTT Client for OpenClaw Service
 * Sends reminders and messages to Cheeko devices via MQTT gateway
 */

const mqtt = require('mqtt');
const logger = require('../utils/logger');
const config = require('../config/openclaw.config');

class MQTTClient {
    constructor() {
        this.client = null;
        this.connected = false;
        this.deviceStatus = new Map(); // deviceMac -> { online, lastSeen }
    }

    /**
     * Initialize MQTT connection
     */
    async initialize() {
        const mqttUrl = config.mqtt?.brokerUrl || 'mqtt://localhost:1883';

        logger.info(`[MQTT] Connecting to ${mqttUrl}...`);

        this.client = mqtt.connect(mqttUrl, {
            clientId: `openclaw_${Date.now()}`,
            clean: true,
            reconnectPeriod: 5000,
        });

        this.client.on('connect', () => {
            logger.info('[MQTT] ✅ Connected to MQTT broker');
            this.connected = true;

            // Subscribe to device status updates
            this.client.subscribe('device/+/status', (err) => {
                if (err) {
                    logger.error('[MQTT] Failed to subscribe to device status:', err);
                } else {
                    logger.info('[MQTT] Subscribed to device status updates');
                }
            });
        });

        this.client.on('message', (topic, message) => {
            this.handleMessage(topic, message);
        });

        this.client.on('error', (error) => {
            logger.error('[MQTT] Connection error:', error);
            this.connected = false;
        });

        this.client.on('close', () => {
            logger.warn('[MQTT] Connection closed');
            this.connected = false;
        });

        this.client.on('reconnect', () => {
            logger.info('[MQTT] Reconnecting...');
        });
    }

    /**
     * Handle incoming MQTT messages
     * @param {string} topic - MQTT topic
     * @param {Buffer} message - Message payload
     */
    handleMessage(topic, message) {
        try {
            // Parse device status updates
            // Topic format: device/{deviceMac}/status
            const match = topic.match(/device\/(.+)\/status/);
            if (match) {
                const deviceMac = match[1];
                const status = JSON.parse(message.toString());

                this.deviceStatus.set(deviceMac, {
                    online: status.online || false,
                    lastSeen: new Date().toISOString(),
                });

                logger.info(`[MQTT] Device ${deviceMac} status: ${status.online ? 'online' : 'offline'}`);

                // Notify reminder queue if device came online
                if (status.online) {
                    const reminderQueue = require('./reminder-queue');
                    reminderQueue.onDeviceOnline(deviceMac);
                }
            }
        } catch (error) {
            logger.error('[MQTT] Error handling message:', error);
        }
    }

    /**
     * Send reminder to device via internal/server-ingest topic
     * @param {string} deviceMac - Device MAC address
     * @param {string} text - Reminder text
     * @returns {Promise<boolean>} - Success status
     */
    async sendReminder(deviceMac, text) {
        if (!this.connected) {
            logger.error('[MQTT] Cannot send reminder - not connected');
            return false;
        }

        try {
            // Format device MAC for client ID (replace : with _)
            const deviceMacFormatted = deviceMac.replace(/:/g, '_');
            const clientId = `openclaw@@@${deviceMacFormatted}`;

            // Create payload in EMQX republish format (same as gateway expects)
            const payload = {
                sender_client_id: clientId,
                orginal_payload: {
                    type: 'reminder',
                    text: text,
                    timestamp: new Date().toISOString(),
                }
            };

            return new Promise((resolve, reject) => {
                this.client.publish('internal/server-ingest', JSON.stringify(payload), { qos: 1 }, (err) => {
                    if (err) {
                        logger.error(`[MQTT] Failed to send reminder to ${deviceMac}:`, err);
                        reject(err);
                    } else {
                        logger.info(`[MQTT] ✅ Reminder sent to internal/server-ingest for ${deviceMac}: ${text}`);
                        resolve(true);
                    }
                });
            });
        } catch (error) {
            logger.error('[MQTT] Error sending reminder:', error);
            return false;
        }
    }

    /**
     * Check if device is online
     * @param {string} deviceMac - Device MAC address
     * @returns {boolean} - Online status
     */
    isDeviceOnline(deviceMac) {
        const status = this.deviceStatus.get(deviceMac);
        if (!status) return false;

        // Consider device offline if last seen > 5 minutes ago
        const lastSeen = new Date(status.lastSeen);
        const now = new Date();
        const diffMinutes = (now - lastSeen) / 1000 / 60;

        return status.online && diffMinutes < 5;
    }

    /**
     * Shutdown MQTT client
     */
    shutdown() {
        if (this.client) {
            logger.info('[MQTT] Shutting down...');
            this.client.end();
            this.connected = false;
        }
    }
}

module.exports = new MQTTClient();
