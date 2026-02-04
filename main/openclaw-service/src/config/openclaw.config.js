/**
 * OpenClaw Service Configuration
 * Central configuration for all OpenClaw features
 */

require('dotenv').config();

module.exports = {
    // Server configuration
    server: {
        port: parseInt(process.env.PORT) || 8003,
        env: process.env.NODE_ENV || 'development',
        corsOrigins: (process.env.ALLOWED_ORIGINS || '').split(',').filter(Boolean),
    },

    // Manager API integration
    managerApi: {
        url: process.env.MANAGER_API_URL || 'http://localhost:8002/toy',
        secret: process.env.MANAGER_API_SECRET,
    },

    // MQTT Gateway integration
    mqtt: {
        brokerUrl: process.env.MQTT_BROKER_URL || 'mqtt://localhost:1883',
        username: process.env.MQTT_USERNAME,
        password: process.env.MQTT_PASSWORD,
        clientId: `openclaw-service-${Date.now()}`,
    },

    // LiveKit integration
    livekit: {
        url: process.env.LIVEKIT_URL,
        apiKey: process.env.LIVEKIT_API_KEY,
        apiSecret: process.env.LIVEKIT_API_SECRET,
    },

    // Task scheduler
    scheduler: {
        enabled: process.env.SCHEDULER_ENABLED === 'true',
        timezone: process.env.SCHEDULER_TIMEZONE || 'Asia/Kolkata',
    },

    // Memory storage
    memory: {
        path: process.env.MEMORY_PATH || './memory',
        maxSizeMB: parseInt(process.env.MEMORY_MAX_SIZE_MB) || 100,
    },

    // Security
    security: {
        rateLimit: {
            windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 900000, // 15 minutes
            maxRequests: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS) || 100,
        },
    },

    // Feature flags
    features: {
        proactiveReminders: process.env.ENABLE_PROACTIVE_REMINDERS === 'true',
        parentNotifications: process.env.ENABLE_PARENT_NOTIFICATIONS === 'true',
        webAutomation: process.env.ENABLE_WEB_AUTOMATION === 'true',
        fileStorage: process.env.ENABLE_FILE_STORAGE === 'true',
    },

    // Logging
    logging: {
        level: process.env.LOG_LEVEL || 'info',
        filePath: process.env.LOG_FILE_PATH || './logs/openclaw.log',
    },
};
