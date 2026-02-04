/**
 * Message Routes
 * API endpoints for sending messages via OpenClaw
 */

const express = require('express');
const router = express.Router();
const messageRouter = require('../../core/message-router');
const logger = require('../../utils/logger');
const Joi = require('joi');

// Validation schemas
const sendMessageSchema = Joi.object({
    platform: Joi.string().valid('whatsapp', 'telegram', 'slack').required(),
    recipient: Joi.string().required(),
    message: Joi.string().required(),
    attachments: Joi.array().items(
        Joi.object({
            type: Joi.string().valid('image', 'document').required(),
            url: Joi.string().uri().required(),
            caption: Joi.string().optional(),
        })
    ).optional(),
});

const sendToParentSchema = Joi.object({
    deviceMac: Joi.string().required(),
    message: Joi.string().required(),
    attachments: Joi.array().items(
        Joi.object({
            type: Joi.string().valid('image', 'document').required(),
            url: Joi.string().uri().required(),
            caption: Joi.string().optional(),
        })
    ).optional(),
});

/**
 * POST /api/message/send
 * Send message via specified platform
 */
router.post('/send', async (req, res) => {
    try {
        // Validate request
        const { error, value } = sendMessageSchema.validate(req.body);
        if (error) {
            return res.status(400).json({
                code: 400,
                msg: error.details[0].message,
                data: null,
            });
        }

        const { platform, recipient, message, attachments } = value;

        // Send message
        const result = await messageRouter.sendMessage(platform, recipient, message, attachments);

        res.json({
            code: 0,
            msg: 'success',
            data: result,
        });
    } catch (error) {
        logger.error('[API] Error sending message:', error);
        res.status(500).json({
            code: 500,
            msg: error.message || 'Failed to send message',
            data: null,
        });
    }
});

/**
 * POST /api/message/send-to-parent
 * Send message to parent (convenience endpoint)
 */
router.post('/send-to-parent', async (req, res) => {
    try {
        // Validate request
        const { error, value } = sendToParentSchema.validate(req.body);
        if (error) {
            return res.status(400).json({
                code: 400,
                msg: error.details[0].message,
                data: null,
            });
        }

        const { deviceMac, message, attachments } = value;

        // Send to parent
        const result = await messageRouter.sendToParent(deviceMac, message, attachments);

        res.json({
            code: 0,
            msg: 'success',
            data: result,
        });
    } catch (error) {
        logger.error('[API] Error sending to parent:', error);
        res.status(500).json({
            code: 500,
            msg: error.message || 'Failed to send message to parent',
            data: null,
        });
    }
});

/**
 * GET /api/message/status
 * Get integration status
 */
router.get('/status', async (req, res) => {
    try {
        const whatsappIntegration = require('../../integrations/whatsapp.integration');

        const status = {
            whatsapp: {
                enabled: require('../../config/integrations.config').whatsapp.enabled,
                ready: whatsappIntegration.isClientReady(),
            },
            // Future: telegram, slack, etc.
        };

        res.json({
            code: 0,
            msg: 'success',
            data: status,
        });
    } catch (error) {
        logger.error('[API] Error getting status:', error);
        res.status(500).json({
            code: 500,
            msg: error.message || 'Failed to get status',
            data: null,
        });
    }
});

module.exports = router;
