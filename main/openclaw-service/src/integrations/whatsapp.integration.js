/**
 * WhatsApp Integration using whatsapp-web.js
 * Handles WhatsApp message sending for parent notifications
 */

const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const logger = require('../utils/logger');
const integrationsConfig = require('../config/integrations.config');

class WhatsAppIntegration {
    constructor() {
        this.client = null;
        this.isReady = false;
        this.config = integrationsConfig.whatsapp;
    }

    /**
     * Initialize WhatsApp client
     */
    async initialize() {
        if (!this.config.enabled) {
            logger.info('[WHATSAPP] Integration disabled in config');
            return;
        }

        try {
            logger.info('[WHATSAPP] Initializing WhatsApp client...');

            this.client = new Client({
                authStrategy: new LocalAuth({
                    dataPath: this.config.sessionPath,
                }),
                puppeteer: {
                    headless: true,
                    args: ['--no-sandbox', '--disable-setuid-sandbox'],
                },
            });

            // QR Code event - display for first-time setup
            this.client.on('qr', (qr) => {
                logger.info('[WHATSAPP] QR Code received. Scan with WhatsApp mobile app:');
                qrcode.generate(qr, { small: true });
            });

            // Ready event
            this.client.on('ready', () => {
                this.isReady = true;
                logger.info('[WHATSAPP] ✅ WhatsApp client ready!');
            });

            // Authentication success
            this.client.on('authenticated', () => {
                logger.info('[WHATSAPP] Authentication successful');
            });

            // Authentication failure
            this.client.on('auth_failure', (msg) => {
                logger.error('[WHATSAPP] Authentication failed:', msg);
                this.isReady = false;
            });

            // Disconnected event
            this.client.on('disconnected', (reason) => {
                logger.warn('[WHATSAPP] Client disconnected:', reason);
                this.isReady = false;
            });

            // Initialize client
            await this.client.initialize();
        } catch (error) {
            logger.error('[WHATSAPP] Initialization error:', error);
            throw error;
        }
    }

    /**
     * Send WhatsApp message
     * @param {string} phoneNumber - Phone number in format: +1234567890
     * @param {string} message - Message text
     * @param {Array} attachments - Optional attachments
     * @returns {Promise<Object>} - Result object
     */
    async sendMessage(phoneNumber, message, attachments = []) {
        if (!this.isReady) {
            throw new Error('WhatsApp client not ready');
        }

        try {
            // Format phone number (remove + and add @c.us suffix)
            const chatId = phoneNumber.replace('+', '') + '@c.us';

            logger.info(`[WHATSAPP] Sending message to ${phoneNumber}`);

            // Send text message
            const result = await this.client.sendMessage(chatId, message);

            // Send attachments if any
            if (attachments && attachments.length > 0) {
                for (const attachment of attachments) {
                    if (attachment.type === 'image' && attachment.url) {
                        const media = await this.client.sendMessage(chatId, {
                            media: attachment.url,
                            caption: attachment.caption || '',
                        });
                        logger.info(`[WHATSAPP] Sent image attachment: ${attachment.url}`);
                    }
                }
            }

            logger.info(`[WHATSAPP] ✅ Message sent successfully to ${phoneNumber}`);

            return {
                success: true,
                messageId: result.id._serialized,
                timestamp: result.timestamp,
            };
        } catch (error) {
            logger.error(`[WHATSAPP] Error sending message to ${phoneNumber}:`, error);
            throw error;
        }
    }

    /**
     * Check if WhatsApp is ready
     */
    isClientReady() {
        return this.isReady;
    }

    /**
     * Disconnect WhatsApp client
     */
    async disconnect() {
        if (this.client) {
            await this.client.destroy();
            this.isReady = false;
            logger.info('[WHATSAPP] Client disconnected');
        }
    }
}

module.exports = new WhatsAppIntegration();
