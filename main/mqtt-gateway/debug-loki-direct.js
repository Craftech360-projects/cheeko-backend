/**
 * Direct Loki Debug - Send logs exactly like Grafana expects
 */

require('dotenv').config();
const axios = require('axios');

async function sendDirectLokiLog() {
    try {
        console.log('🔧 [DEBUG] Sending log directly to Loki API...');
        
        const timestamp = String(Date.now() * 1000000); // Nanoseconds
        const logMessage = JSON.stringify({
            level: 'info',
            message: '🧪 Direct API test log',
            timestamp: new Date().toISOString(),
            source: 'direct-test'
        });
        
        const payload = {
            streams: [
                {
                    stream: {
                        app: 'mqtt-gateway-debug',
                        level: 'info',
                        source: 'direct'
                    },
                    values: [
                        [timestamp, logMessage]
                    ]
                }
            ]
        };
        
        console.log('📤 [DEBUG] Payload:', JSON.stringify(payload, null, 2));
        
        const response = await axios.post(
            `${process.env.LOKI_HOST}/loki/api/v1/push`,
            payload,
            {
                headers: {
                    'Content-Type': 'application/json'
                },
                auth: {
                    username: process.env.LOKI_USER,
                    password: process.env.LOKI_PASSWORD
                },
                timeout: 10000
            }
        );
        
        console.log('✅ [DEBUG] Direct push successful:', response.status);
        
        // Wait and query back
        console.log('⏳ [DEBUG] Waiting 5 seconds...');
        await new Promise(resolve => setTimeout(resolve, 5000));
        
        // Query with broader search
        const queries = [
            '{app="mqtt-gateway-debug"}',
            '{source="direct"}',
            '{level="info"}',
            '{}' // All logs
        ];
        
        for (const query of queries) {
            try {
                console.log(`\n🔍 [DEBUG] Testing query: ${query}`);
                
                const now = Date.now();
                const oneHourAgo = now - (60 * 60 * 1000);
                
                const queryParams = new URLSearchParams({
                    query: query,
                    start: String(oneHourAgo * 1000000),
                    end: String(now * 1000000),
                    limit: '10'
                });
                
                const queryResponse = await axios.get(
                    `${process.env.LOKI_HOST}/loki/api/v1/query_range?${queryParams}`,
                    {
                        auth: {
                            username: process.env.LOKI_USER,
                            password: process.env.LOKI_PASSWORD
                        },
                        timeout: 10000
                    }
                );
                
                const data = queryResponse.data;
                if (data.data && data.data.result && data.data.result.length > 0) {
                    console.log(`✅ [DEBUG] Found ${data.data.result.length} streams with query: ${query}`);
                    
                    data.data.result.forEach((stream, index) => {
                        console.log(`   Stream ${index + 1}: ${JSON.stringify(stream.stream)}`);
                        console.log(`   Entries: ${stream.values?.length || 0}`);
                        
                        if (stream.values && stream.values.length > 0) {
                            const latestLog = stream.values[stream.values.length - 1];
                            const timestamp = new Date(parseInt(latestLog[0]) / 1000000);
                            console.log(`   Latest: [${timestamp.toISOString()}] ${latestLog[1]}`);
                        }
                    });
                } else {
                    console.log(`❌ [DEBUG] No results for query: ${query}`);
                }
                
            } catch (queryError) {
                console.error(`❌ [DEBUG] Query failed for ${query}:`, queryError.message);
            }
        }
        
    } catch (error) {
        console.error('❌ [DEBUG] Direct push failed:', error.message);
        if (error.response) {
            console.error('   Status:', error.response.status);
            console.error('   Response:', error.response.data);
        }
    }
}

// Also test label discovery
async function testLabelDiscovery() {
    try {
        console.log('\n🏷️ [DEBUG] Testing label discovery...');
        
        const response = await axios.get(
            `${process.env.LOKI_HOST}/loki/api/v1/labels`,
            {
                auth: {
                    username: process.env.LOKI_USER,
                    password: process.env.LOKI_PASSWORD
                },
                timeout: 10000
            }
        );
        
        console.log('✅ [DEBUG] Available labels:', response.data.data);
        
        // Test label values for 'app'
        const appValuesResponse = await axios.get(
            `${process.env.LOKI_HOST}/loki/api/v1/label/app/values`,
            {
                auth: {
                    username: process.env.LOKI_USER,
                    password: process.env.LOKI_PASSWORD
                },
                timeout: 10000
            }
        );
        
        console.log('✅ [DEBUG] Available app label values:', appValuesResponse.data.data);
        
    } catch (error) {
        console.error('❌ [DEBUG] Label discovery failed:', error.message);
    }
}

async function runDebug() {
    await sendDirectLokiLog();
    await testLabelDiscovery();
}

runDebug();