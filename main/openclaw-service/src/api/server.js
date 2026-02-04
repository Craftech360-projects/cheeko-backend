/**
 * OpenClaw Service - Main Server
 * Express server for OpenClaw integration API
 */

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const logger = require('../utils/logger');
const config = require('../config/openclaw.config');
const messageRouter = require('../core/message-router');

// Create Express app
const app = express();

// Middleware
app.use(helmet()); // Security headers
app.use(cors({
    origin: config.server.corsOrigins.length > 0 ? config.server.corsOrigins : '*',
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Rate limiting
const limiter = rateLimit({
    windowMs: config.security.rateLimit.windowMs,
    max: config.security.rateLimit.maxRequests,
    message: 'Too many requests from this IP, please try again later.',
});
app.use('/api/', limiter);

// Request logging middleware
app.use((req, res, next) => {
    logger.info(`${req.method} ${req.path}`, {
        ip: req.ip,
        userAgent: req.get('user-agent'),
    });
    next();
});

// Health check endpoint
app.get('/health', (req, res) => {
    res.json({
        status: 'ok',
        service: 'openclaw-service',
        timestamp: new Date().toISOString(),
    });
});

// API Routes
app.use('/api/message', require('./routes/message.routes'));
app.use('/api/task', require('./routes/task.routes'));

// 404 handler
app.use((req, res) => {
    res.status(404).json({
        code: 404,
        msg: 'Endpoint not found',
        data: null,
    });
});

// Error handler
app.use((err, req, res, next) => {
    logger.error('Unhandled error:', err);
    res.status(500).json({
        code: 500,
        msg: 'Internal server error',
        data: null,
    });
});

// Start server
async function startServer() {
    try {
        logger.info('🚀 Starting OpenClaw Service...');

        // Initialize message router and integrations
        await messageRouter.initializeIntegrations();

        // Initialize MQTT client
        const mqttClient = require('../core/mqtt-client');
        await mqttClient.initialize();

        // Start Express server
        const PORT = config.server.port;
        app.listen(PORT, () => {
            logger.info(`✅ OpenClaw Service running on port ${PORT}`);
            logger.info(`📍 Environment: ${config.server.env}`);
            logger.info(`🔗 Health check: http://localhost:${PORT}/health`);

            // Log enabled features
            logger.info('📋 Enabled features:');
            Object.entries(config.features).forEach(([feature, enabled]) => {
                if (enabled) {
                    logger.info(`   ✅ ${feature}`);
                }
            });
        });
    } catch (error) {
        logger.error('❌ Failed to start server:', error);
        process.exit(1);
    }
}

// Graceful shutdown
process.on('SIGINT', async () => {
    logger.info('\\n🛑 Received SIGINT, shutting down gracefully...');
    await messageRouter.shutdown();
    process.exit(0);
});

process.on('SIGTERM', async () => {
    logger.info('\\n🛑 Received SIGTERM, shutting down gracefully...');
    await messageRouter.shutdown();
    process.exit(0);
});

// Start if run directly
if (require.main === module) {
    startServer();
}

module.exports = app;
