/**
 * Loki HTTP Verification Script
 * This script directly tests HTTP requests to Grafana Loki API
 */

require('dotenv').config();
const axios = require('axios');

const LOKI_HOST = process.env.LOKI_HOST;
const LOKI_USER = process.env.LOKI_USER;
const LOKI_PASSWORD = process.env.LOKI_PASSWORD;

console.log('🔍 [VERIFY] Testing direct HTTP connection to Grafana Loki...');
console.log(`📋 [CONFIG] Host: ${LOKI_HOST}`);
console.log(`📋 [CONFIG] User: ${LOKI_USER}`);

if (!LOKI_HOST || !LOKI_USER || !LOKI_PASSWORD) {
    console.error('❌ [ERROR] Missing Loki environment variables');
    process.exit(1);
}

// Test 1: Check if Loki endpoint is reachable
async function testLokiEndpoint() {
    try {
        console.log('\n🧪 [TEST 1] Testing Loki endpoint reachability...');
        
        const response = await axios.get(`${LOKI_HOST}/ready`, {
            timeout: 5000,
            auth: {
                username: LOKI_USER,
                password: LOKI_PASSWORD
            }
        });
        
        console.log('✅ [TEST 1] Loki endpoint is reachable');
        console.log(`📊 [TEST 1] Status: ${response.status}`);
        return true;
    } catch (error) {
        console.error('❌ [TEST 1] Loki endpoint test failed:');
        console.error(`   Status: ${error.response?.status || 'No response'}`);
        console.error(`   Message: ${error.message}`);
        if (error.response?.data) {
            console.error(`   Response: ${JSON.stringify(error.response.data)}`);
        }
        return false;
    }
}

// Test 2: Send a direct log entry
async function testDirectLogPush() {
    try {
        console.log('\n🧪 [TEST 2] Sending direct log entry to Loki...');
        
        const logEntry = {
            streams: [
                {
                    stream: {
                        app: 'mqtt-gateway-test',
                        level: 'info'
                    },
                    values: [
                        [
                            String(Date.now() * 1000000), // Nanosecond timestamp
                            JSON.stringify({
                                message: '🧪 Direct test log entry',
                                timestamp: new Date().toISOString(),
                                test: true
                            })
                        ]
                    ]
                }
            ]
        };

        const response = await axios.post(`${LOKI_HOST}/loki/api/v1/push`, logEntry, {
            timeout: 10000,
            headers: {
                'Content-Type': 'application/json'
            },
            auth: {
                username: LOKI_USER,
                password: LOKI_PASSWORD
            }
        });
        
        console.log('✅ [TEST 2] Direct log push successful');
        console.log(`📊 [TEST 2] Status: ${response.status}`);
        return true;
    } catch (error) {
        console.error('❌ [TEST 2] Direct log push failed:');
        console.error(`   Status: ${error.response?.status || 'No response'}`);
        console.error(`   Message: ${error.message}`);
        if (error.response?.data) {
            console.error(`   Response: ${JSON.stringify(error.response.data)}`);
        }
        return false;
    }
}

// Test 3: Query logs to see if they're stored
async function testLogQuery() {
    try {
        console.log('\n🧪 [TEST 3] Querying recent logs from Loki...');
        
        const now = Date.now();
        const oneHourAgo = now - (60 * 60 * 1000);
        
        const queryParams = new URLSearchParams({
            query: '{app="mqtt-gateway"}',
            start: String(oneHourAgo * 1000000), // Nanoseconds
            end: String(now * 1000000),
            limit: '10'
        });

        const response = await axios.get(`${LOKI_HOST}/loki/api/v1/query_range?${queryParams}`, {
            timeout: 10000,
            auth: {
                username: LOKI_USER,
                password: LOKI_PASSWORD
            }
        });
        
        console.log('✅ [TEST 3] Log query successful');
        console.log(`📊 [TEST 3] Status: ${response.status}`);
        
        const data = response.data;
        if (data.data && data.data.result) {
            console.log(`📈 [TEST 3] Found ${data.data.result.length} log streams`);
            
            let totalLogs = 0;
            data.data.result.forEach((stream, index) => {
                console.log(`   Stream ${index + 1}: ${JSON.stringify(stream.stream)}`);
                console.log(`   Entries: ${stream.values?.length || 0}`);
                totalLogs += stream.values?.length || 0;
            });
            
            console.log(`📊 [TEST 3] Total log entries found: ${totalLogs}`);
            
            if (totalLogs > 0) {
                console.log('🎉 [SUCCESS] Logs are being stored in Grafana Loki!');
                console.log('💡 [TIP] Check your Grafana dashboard filters and time range');
            } else {
                console.log('⚠️ [WARNING] No logs found. They might not be reaching Loki or are outside the time range');
            }
        }
        
        return true;
    } catch (error) {
        console.error('❌ [TEST 3] Log query failed:');
        console.error(`   Status: ${error.response?.status || 'No response'}`);
        console.error(`   Message: ${error.message}`);
        if (error.response?.data) {
            console.error(`   Response: ${JSON.stringify(error.response.data)}`);
        }
        return false;
    }
}

// Run all tests
async function runTests() {
    console.log('🚀 [START] Running Grafana Loki verification tests...\n');
    
    const test1 = await testLokiEndpoint();
    const test2 = await testDirectLogPush();
    
    // Wait a bit for log ingestion
    console.log('\n⏳ [WAIT] Waiting 3 seconds for log ingestion...');
    await new Promise(resolve => setTimeout(resolve, 3000));
    
    const test3 = await testLogQuery();
    
    console.log('\n📋 [SUMMARY] Test Results:');
    console.log(`   Endpoint Reachable: ${test1 ? '✅' : '❌'}`);
    console.log(`   Direct Log Push: ${test2 ? '✅' : '❌'}`);
    console.log(`   Log Query: ${test3 ? '✅' : '❌'}`);
    
    if (test1 && test2 && test3) {
        console.log('\n🎉 [SUCCESS] All tests passed! Loki connection is working.');
        console.log('💡 [TIP] If you still can\'t see logs in Grafana, check:');
        console.log('   1. Time range in Grafana dashboard');
        console.log('   2. Label filters (app="mqtt-gateway")');
        console.log('   3. Grafana datasource configuration');
    } else {
        console.log('\n❌ [FAILURE] Some tests failed. Check the errors above.');
    }
}

runTests().catch(console.error);