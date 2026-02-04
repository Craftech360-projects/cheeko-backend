/**
 * Third-Party Integrations Configuration
 * Configuration for WhatsApp, Telegram, Slack, etc.
 */

require('dotenv').config();

module.exports = {
    // WhatsApp integration (whatsapp-web.js)
    whatsapp: {
        enabled: process.env.WHATSAPP_ENABLED === 'true',
        sessionPath: process.env.WHATSAPP_SESSION_PATH || './memory/whatsapp-session',
        maxRetries: 3,
        retryDelay: 5000, // 5 seconds
    },

    // Telegram integration
    telegram: {
        enabled: process.env.TELEGRAM_ENABLED === 'true',
        botToken: process.env.TELEGRAM_BOT_TOKEN,
        maxMessageLength: 4096,
    },

    // Slack integration
    slack: {
        enabled: process.env.SLACK_ENABLED === 'true',
        botToken: process.env.SLACK_BOT_TOKEN,
    },

    // Discord integration
    discord: {
        enabled: process.env.DISCORD_ENABLED === 'true',
        botToken: process.env.DISCORD_BOT_TOKEN,
    },

    // Smart home integrations (future)
    smartHome: {
        enabled: false,
        // Will add Home Assistant, Philips Hue, etc.
    },
};
