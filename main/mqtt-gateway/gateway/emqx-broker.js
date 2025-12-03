/**
 * EMQX Broker Connection
 * 
 * Manages connection to EMQX MQTT broker.
 * Handles topic subscriptions and message publishing.
 */

const mqtt = require('mqtt');

/**
 * EMQX Broker connection manager
 */
class EmqxBroker {
    constructor(config) {
        this.config = config;
        this.client = null;
        this.messageHandlers = new Map();
        this.connected = false;
    }

    /**
     * Connect to EMQX broker
     */
    connect() {
        return new Promise((resolve, reject) => {
            const { protocol, host, port, username, password } = this.config;

            const brokerUrl = `${protocol}://${host}:${port}`;
            console.log(`🔌 [MQTT] Connecting to broker: ${brokerUrl}`);

            const options = {
                clientId: `mqtt-gateway-${Date.now()}`,
                clean: true,
                connectTimeout: 4000,
                reconnectPeriod: 1000,
            };

            if (username) {
                options.username = username;
            }
            if (password) {
                options.password = password;
            }

            this.client = mqtt.connect(brokerUrl, options);

            this.client.on('connect', () => {
                console.log(`✅ [MQTT] Connected to broker`);
                this.connected = true;
                resolve();
            });

            this.client.on('error', (err) => {
                console.error(`❌ [MQTT] Connection error:`, err);
                if (!this.connected) {
                    reject(err);
                }
            });

            this.client.on('message', (topic, message) => {
                // Route message to registered handlers
                const handlers = this.messageHandlers.get(topic);
                if (handlers) {
                    handlers.forEach(handler => {
                        try {
                            handler(message, topic);
                        } catch (error) {
                            console.error(`❌ [MQTT] Handler error for topic ${topic}:`, error);
                        }
                    });
                }

                // Also check wildcard handlers
                this.messageHandlers.forEach((handlers, subscribedTopic) => {
                    if (this.topicMatches(subscribedTopic, topic)) {
                        handlers.forEach(handler => {
                            try {
                                handler(message, topic);
                            } catch (error) {
                                console.error(`❌ [MQTT] Handler error:`, error);
                            }
                        });
                    }
                });
            });

            this.client.on('close', () => {
                console.log(`🔌 [MQTT] Connection closed`);
                this.connected = false;
            });

            this.client.on('reconnect', () => {
                console.log(`🔄 [MQTT] Reconnecting...`);
            });
        });
    }

    /**
     * Subscribe to topic
     * @param {string} topic - MQTT topic (supports wildcards)
     * @param {Function} handler - Message handler function
     */
    subscribe(topic, handler) {
        if (!this.client) {
            console.error(`❌ [MQTT] Client not initialized`);
            return;
        }

        this.client.subscribe(topic, (err) => {
            if (err) {
                console.error(`❌ [MQTT] Subscribe error for ${topic}:`, err);
            } else {
                console.log(`✅ [MQTT] Subscribed to: ${topic}`);
            }
        });

        // Register handler
        if (!this.messageHandlers.has(topic)) {
            this.messageHandlers.set(topic, []);
        }
        this.messageHandlers.get(topic).push(handler);
    }

    /**
     * Publish message to topic
     * @param {string} topic - MQTT topic
     * @param {string|Buffer} message - Message to publish
     * @param {Object} options - Publish options
     */
    publish(topic, message, options = {}) {
        if (!this.client) {
            console.error(`❌ [MQTT] Client not initialized`);
            return;
        }

        this.client.publish(topic, message, options, (err) => {
            if (err) {
                console.error(`❌ [MQTT] Publish error for ${topic}:`, err);
            }
        });
    }

    /**
     * Check if topic matches subscription pattern
     * @param {string} pattern - Subscription pattern (with wildcards)
     * @param {string} topic - Actual topic
     * @returns {boolean} True if matches
     */
    topicMatches(pattern, topic) {
        // Simple wildcard matching
        // + matches single level, # matches multiple levels
        const patternParts = pattern.split('/');
        const topicParts = topic.split('/');

        for (let i = 0; i < patternParts.length; i++) {
            if (patternParts[i] === '#') {
                return true; // # matches everything after
            }
            if (patternParts[i] === '+') {
                continue; // + matches any single level
            }
            if (patternParts[i] !== topicParts[i]) {
                return false;
            }
        }

        return patternParts.length === topicParts.length;
    }

    /**
     * Disconnect from broker
     */
    disconnect() {
        return new Promise((resolve) => {
            if (this.client) {
                this.client.end(false, () => {
                    console.log(`🛑 [MQTT] Disconnected from broker`);
                    this.connected = false;
                    resolve();
                });
            } else {
                resolve();
            }
        });
    }

    /**
     * Check if connected
     */
    isConnected() {
        return this.connected && this.client && this.client.connected;
    }
}

module.exports = {
    EmqxBroker,
};
