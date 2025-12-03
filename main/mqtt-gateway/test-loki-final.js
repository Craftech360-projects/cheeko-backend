/**
 * Final Loki Test - Send logs and wait for them to appear
 */

require('dotenv').config();
const winston = require('winston');
const LokiTransport = require('winston-loki');
const axios = require('axios');

console.log('🧪 [FINAL TEST] Testing winston-loki integration...');

// Create logger with Loki transport (same as your app)
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

// Add Loki transport
const lokiTransport = new LokiTransport({
    host: process.env.LOKI_HOST,
    basicAuth: `${process.env.LOKI_USER}:${process.env.LOKI_PASSWORD}`,
    labels: { app: 'mqtt-gateway-final-test' },
    json: true,
    batching: true,
    interval: 1000, // 1 second for quick testing
    onConnectionError: (err) => {
        console.error('❌ [LOKI] Connection error:', err.message);
    }
});

lokiTransport.on('error', (err) => {
    console.error('❌ [LOKI] Transport error:', err.message);
});

lokiTransport.on('logged', (info) => {
    console.log('✅ [LOKI] Log queued for batching');
});

testLogger.add(lokiTransport);

async function testWinstonLoki() {
    console.log('📤 [TEST] Sending test logs via winston-loki...');
    
    // Send multiple test logs
    testLogger.info('🧪 [WINSTON-TEST] Test message 1 - Info level');
    testLogger.warn('🧪 [WINSTON-TEST] Test message 2 - Warning level');
    testLogger.error('🧪 [WINSTON-TEST] Test message 3 - Error level');
    
    console.log('⏳ [TEST] Waiting 10 seconds for batching and ingestion...');
    await new Promise(resolve => setTimeout(resolve, 10000));
    
    // Query for our test logs
    try {
        console.log('🔍 [TEST] Querying for test logs...');
        
        const now = Date.now();
        const tenMinutesAgo = now - (10 * 60 * 1000);
        
        const queryParams = new URLSearchParams({
            query: '{app="mqtt-gateway-final-test"}',
            start: String(tenMinutesAgo * 1000000),
            end: String(now * 1000000),
            limit: '100'
        });

        const response = await axios.get(`${process.env.LOKI_HOST}/loki/api/v1/query_range?${queryParams}`, {
            timeout: 10000,
            auth: {
                username: process.env.LOKI_USER,
                password: process.env.LOKI_PASSWORD
            }
        });
        
        const data = response.data;
        if (data.data && data.data.result && data.data.result.length > 0) {
            console.log('🎉 [SUCCESS] Found test logs in Grafana Loki!');
            
            let totalLogs = 0;
            data.data.result.forEach((stream, index) => {
                console.log(`\n📋 Stream ${index + 1}: ${JSON.stringify(stream.stream)}`);
                console.log(`   Entries: ${stream.values.length}`);
                totalLogs += stream.values.length;
                
                // Show recent logs
                stream.values.slice(-3).forEach((logEntry, logIndex) => {
                    const timestamp = new Date(parseInt(logEntry[0]) / 1000000);
                    const message = logEntry[1];
                    console.log(`   ${logIndex + 1}. [${timestamp.toISOString()}] ${message}`);
                });
            });
            
            console.log(`\n✅ [SUCCESS] Total logs found: ${totalLogs}`);
            console.log('🎯 [RESULT] winston-loki is working correctly!');
            console.log('💡 [TIP] Your main app logs should now appear in Grafana Loki');
            
        } else {
            console.log('⚠️ [WARNING] No test logs found yet');
            console.log('💡 [TIP] Logs might take a few more minutes to appear in Grafana');
            console.log('🔍 [TIP] Check your Grafana dashboard with label: app="mqtt-gateway"');
        }
        
    } catch (error) {
        console.error('❌ [ERROR] Query failed:', error.message);
    }
}

testWinstonLoki();