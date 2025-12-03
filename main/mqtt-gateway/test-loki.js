/**
 * Loki Connection Test
 * This script tests the Grafana Loki connection independently
 */

require('dotenv').config();
const winston = require('winston');
const LokiTransport = require('winston-loki');

console.log('🔍 [TEST] Testing Loki connection...');
console.log('📋 [CONFIG] Environment variables:');
console.log(`   LOKI_HOST: ${process.env.LOKI_HOST}`);
console.log(`   LOKI_USER: ${process.env.LOKI_USER}`);
console.log(`   LOKI_PASSWORD: ${process.env.LOKI_PASSWORD ? '[SET]' : '[NOT SET]'}`);

if (!process.env.LOKI_HOST || !process.env.LOKI_USER || !process.env.LOKI_PASSWORD) {
    console.error('❌ [ERROR] Missing Loki environment variables');
    process.exit(1);
}

// Create a test logger with only Loki transport
const testLogger = winston.createLogger({
    level: 'info',
    format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.json()
    ),
    transports: [
        new winston.transports.Console({
            format: winston.format.simple()
        })
    ]
});

// Create Loki transport with detailed error handling
const lokiTransport = new LokiTransport({
    host: process.env.LOKI_HOST,
    basicAuth: `${process.env.LOKI_USER}:${process.env.LOKI_PASSWORD}`,
    labels: { app: 'mqtt-gateway-test' },
    json: true,
    batching: true,
    interval: 2000, // 2 seconds for quick testing
    onConnectionError: (err) => {
        console.error('❌ [LOKI] Connection error:', err.message);
        console.error('❌ [LOKI] Full error:', err);
    }
});

// Add detailed event listeners
lokiTransport.on('error', (err) => {
    console.error('❌ [LOKI] Transport error:', err.message);
    console.error('❌ [LOKI] Full error:', err);
});

lokiTransport.on('warn', (warning) => {
    console.warn('⚠️ [LOKI] Transport warning:', warning);
});

lokiTransport.on('logged', (info) => {
    console.log('✅ [LOKI] Log successfully queued for batching');
});

// Add the transport
testLogger.add(lokiTransport);

console.log('📤 [TEST] Sending test logs to Loki...');

// Send test logs
testLogger.info('🧪 [TEST] Test log message 1 - Connection test');
testLogger.warn('🧪 [TEST] Test warning message 2 - Warning test');
testLogger.error('🧪 [TEST] Test error message 3 - Error test');

console.log('⏳ [TEST] Waiting 5 seconds for batching and transmission...');

setTimeout(() => {
    console.log('✅ [TEST] Test completed. Check your Grafana Loki dashboard for logs.');
    console.log('🔍 [TEST] If no logs appear, there may be authentication or network issues.');
    process.exit(0);
}, 5000);