const winston = require('winston');
const DailyRotateFile = require('winston-daily-rotate-file');
const LokiTransport = require('winston-loki');
require('dotenv').config();

// Store original console methods before any overrides
const originalConsole = {
    log: console.log,
    warn: console.warn,
    error: console.error
};

const logger = winston.createLogger({
    level: process.env.LOG_LEVEL || 'info',
    format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.json()
    ),
    transports: [
        // 1. Console Transport (for PM2/Dev)
        new winston.transports.Console({
            format: winston.format.combine(
                winston.format.colorize(),
                winston.format.simple()
            )
        }),
        // 2. File Transport (Rotates daily, keeps 14 days)
        new DailyRotateFile({
            filename: 'logs/application-%DATE%.log',
            datePattern: 'YYYY-MM-DD',
            maxSize: '20m',
            maxFiles: '14d'
        }),
    ]
});

// 3. Loki Transport (Only if configured)
if (process.env.LOKI_HOST) {
    console.log('🔧 [LOKI] Initializing Loki transport...');

    const lokiTransport = new LokiTransport({
        host: process.env.LOKI_HOST,
        basicAuth: `${process.env.LOKI_USER}:${process.env.LOKI_PASSWORD}`,
        labels: { app: 'mqtt-gateway' },
        json: true,
        batching: true,
        interval: 500, // Send batches every 0.5 seconds (faster than default 1s)
        timeout: 30000, // 30 second timeout
        onConnectionError: (err) => {
            console.error('❌ [LOKI] Connection error:', err.message);
            console.error('❌ [LOKI] Full error:', err);
        }
    });

    // Add event listeners for debugging
    lokiTransport.on('error', (err) => {
        console.error('❌ [LOKI] Transport error:', err.message);
        console.error('❌ [LOKI] Full error:', err);
    });

    lokiTransport.on('warn', (warning) => {
        console.warn('⚠️ [LOKI] Transport warning:', warning);
    });

    lokiTransport.on('logged', (info) => {
        // Log queued for batching (debug disabled)
    });

    // Add batch sent confirmation (if available)
    if (lokiTransport.on) {
        lokiTransport.on('batch', (batch) => {
            console.log(`📦 [LOKI] Batch sent with ${batch?.streams?.length || 'unknown'} streams`);
        });
    }

    logger.add(lokiTransport);
    console.log('✅ [LOKI] Transport added to logger');

    // Register logger with console override (if it exists)
    if (global.setConsoleLogger) {
        global.setConsoleLogger(logger);
    }

    // Test the transport immediately
    setTimeout(() => {
        logger.info('🧪 [LOKI-TEST] Transport test log from main app');
        console.log('📤 [LOKI] Test log sent to transport');
    }, 1000);
} else {
    console.log('⚠️ [LOKI] No LOKI_HOST found, skipping Loki transport');
}

// NOTE: Console override is now handled by console-override.js
// Do NOT override console methods here as it causes duplicate logs
// The console-override.js file handles forwarding console output to the logger

module.exports = logger;
