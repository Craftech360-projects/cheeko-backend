/**
 * Message Router
 * Routes messages to appropriate platforms (WhatsApp, Telegram, etc.)
 */

const logger = require('../utils/logger');
const whatsappIntegration = require('../integrations/whatsapp.integration');
const config = require('../config/integrations.config');

class MessageRouter {
    constructor() {
        this.platforms = {
            whatsapp: whatsappIntegration,
            // telegram: telegramIntegration, // Future
            // slack: slackIntegration, // Future
        };
    }

    /**
     * Send message via specified platform
     * @param {string} platform - Platform name (whatsapp, telegram, etc.)
     * @param {string} recipient - Recipient identifier (phone number, chat ID, etc.)
     * @param {string} message - Message text
     * @param {Array} attachments - Optional attachments
     * @returns {Promise<Object>} - Result object
     */
    async sendMessage(platform, recipient, message, attachments = []) {
        try {
            logger.info(`[MESSAGE-ROUTER] Routing message to ${platform}: ${recipient}`);

            // Validate platform
            if (!this.platforms[platform]) {
                throw new Error(`Unsupported platform: ${platform}`);
            }

            // Check if platform is enabled
            if (!config[platform]?.enabled) {
                throw new Error(`Platform ${platform} is not enabled in config`);
            }

            // Route to appropriate platform
            const integration = this.platforms[platform];

            // Check if integration is ready
            if (platform === 'whatsapp' && !integration.isClientReady()) {
                throw new Error('WhatsApp client not ready. Please scan QR code first.');
            }

            // Send message
            const result = await integration.sendMessage(recipient, message, attachments);

            logger.info(`[MESSAGE-ROUTER] ✅ Message sent via ${platform}`);

            return {
                success: true,
                platform,
                recipient,
                result,
            };
        } catch (error) {
            logger.error(`[MESSAGE-ROUTER] Error sending message via ${platform}:`, error);
            throw error;
        }
    }

    /**
     * Send message to parent (convenience method)
     * Looks up parent contact from device MAC address
     * @param {string} deviceMac - Device MAC address
     * @param {string} message - Message text
     * @param {Array} attachments - Optional attachments
     * @returns {Promise<Object>} - Result object
     */
    async sendToParent(deviceMac, message, attachments = []) {
        try {
            logger.info(`[MESSAGE-ROUTER] Sending message to parent of device: ${deviceMac}`);

            // Get parent contact from Manager API
            const parentContact = await this.getParentContact(deviceMac);

            if (!parentContact) {
                throw new Error(`No parent contact found for device: ${deviceMac}`);
            }

            // Send via preferred platform (default: WhatsApp)
            const platform = parentContact.preferredPlatform || 'whatsapp';
            const recipient = parentContact.phoneNumber || parentContact.chatId;

            return await this.sendMessage(platform, recipient, message, attachments);
        } catch (error) {
            logger.error(`[MESSAGE-ROUTER] Error sending to parent:`, error);
            throw error;
        }
    }

    /**
     * Get parent contact from Manager API
     * @param {string} deviceMac - Device MAC address
     * @returns {Promise<Object>} - Parent contact object
     */
    async getParentContact(deviceMac) {
        try {
            const axios = require('axios');
            const openclawConfig = require('../config/openclaw.config');

            const response = await axios.get(
                `${openclawConfig.managerApi.url}/device/parent-contact/${deviceMac}`,
                {
                    headers: {
                        'X-Service-Secret': openclawConfig.managerApi.secret,
                    },
                }
            );

            if (response.data && response.data.code === 0) {
                return response.data.data;
            }

            return null;
        } catch (error) {
            logger.error('[MESSAGE-ROUTER] Error fetching parent contact:', error);
            return null;
        }
    }

    /**
     * Initialize all enabled integrations
     */
    async initializeIntegrations() {
        logger.info('[MESSAGE-ROUTER] Initializing integrations...');

        // Initialize WhatsApp if enabled
        if (config.whatsapp.enabled) {
            try {
                await whatsappIntegration.initialize();
            } catch (error) {
                logger.error('[MESSAGE-ROUTER] WhatsApp initialization failed:', error);
            }
        }

        // Future: Initialize Telegram, Slack, etc.

        logger.info('[MESSAGE-ROUTER] ✅ Integrations initialized');
    }

    /**
     * Shutdown all integrations
     */
    async shutdown() {
        logger.info('[MESSAGE-ROUTER] Shutting down integrations...');

        if (config.whatsapp.enabled) {
            await whatsappIntegration.disconnect();
        }

        logger.info('[MESSAGE-ROUTER] ✅ Integrations shut down');
    }
}

module.exports = new MessageRouter();
