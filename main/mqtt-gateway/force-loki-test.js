/**
 * Force Loki Test - Disable batching and send immediately
 */

require('dotenv').config();
const winston = require('winston');
const LokiTransport = require('winston-loki');
const axios = require('axios');

console.log('🧪 [FORCE-TEST] Testing immediate Loki sending...');

// Create logger with immediate sending (no batching)
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

// Add Loki transport with NO batching
const lokiTransport = new LokiTransport({
    host: process.env.LOKI_HOST,
    basicAuth: `${process.env.LOKI_USER}:${process.env.LOKI_PASSWORD}`,
    labels: { app: 'mqtt-gateway' }, // Same label as main app
    json: true,
    batching: false, // DISABLE batching for immediate sending
    onConnectionError: (err) => {
        console.error('❌ [LOKI] Connection error:', err.message);
    }
});

lokiTransport.on('error', (err) => {
    console.error('❌ [LOKI] Transport error:', err.message);
});

lokiTransport.on('logged', (info) => {
    console.log('✅ [LOKI] Log sent immediately (no batching)');
});

testLogger.add(lokiTransport);

async function testImmediateSending() {
    console.log('📤 [TEST] Sending logs with immediate mode...');
    
    // Send test logs
    testLogger.info('🧪 [IMMEDIATE-TEST] Test log 1 - Main app label');
    testLogger.warn('🧪 [IMMEDIATE-TEST] Test log 2 - Warning level');
    testLogger.error('🧪 [IMMEDIATE-TEST] Test log 3 - Error level');
    
    console.log('⏳ [TEST] Waiting 5 seconds for immediate sending...');
    await new Promise(resolve => setTimeout(resolve, 5000));
    
    // Query for the logs
    try {
        console.log('🔍 [TEST] Querying for immediate test logs...');
        
        const now = Date.now();
        const fiveMinutesAgo = now - (5 * 60 * 1000);
        
        const queryParams = new URLSearchParams({
            query: '{app="mqtt-gateway"}',
            start: String(fiveMinutesAgo * 1000000),
            end: String(now * 1000000),
            limit: '100'
        });

        const response = await axios.get(
            `${process.env.LOKI_HOST}/loki/api/v1/query_range?${queryParams}`,
            {
                auth: {
                    username: process.env.LOKI_USER,
                    password: process.env.LOKI_PASSWORD
                },
                timeout: 10000
            }
        );
        
        const data = response.data;
        if (data.data && data.data.result && data.data.result.length > 0) {
            console.log('🎉 [SUCCESS] Found mqtt-gateway logs in Loki!');
            
            let totalLogs = 0;
            data.data.result.forEach((stream, index) => {
                console.log(`\n📋 Stream ${index + 1}: ${JSON.stringify(stream.stream)}`);
                console.log(`   Entries: ${stream.values?.length || 0}`);
                totalLogs += stream.values?.length || 0;
                
                // Show recent logs
                if (stream.values && stream.values.length > 0) {
                    console.log('   Recent logs:');
                    stream.values.slice(-5).forEach((logEntry, logIndex) => {
                        const timestamp = new Date(parseInt(logEntry[0]) / 1000000);
                        const message = logEntry[1];
                        console.log(`   ${logIndex + 1}. [${timestamp.toISOString()}] ${message}`);
                    });
                }
            });
            
            console.log(`\n✅ [SUCCESS] Total mqtt-gateway logs: ${totalLogs}`);
            console.log('🎯 [RESULT] The app="mqtt-gateway" label is working!');
            
        } else {
            console.log('❌ [FAILURE] Still no mqtt-gateway logs found');
            console.log('🔍 [DEBUG] This suggests a winston-loki configuration issue');
        }
        
    } catch (error) {
        console.error('❌ [ERROR] Query failed:', error.message);
    }
}

testImmediateSending();