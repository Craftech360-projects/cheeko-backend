/**
 * Check Main App Logs in Loki
 */

require('dotenv').config();
const axios = require('axios');

async function checkMainAppLogs() {
    try {
        console.log('🔍 [CHECK] Searching for main app logs...');
        
        const now = Date.now();
        const oneHourAgo = now - (60 * 60 * 1000);
        
        // Check for main app logs
        const queryParams = new URLSearchParams({
            query: '{app="mqtt-gateway"}',
            start: String(oneHourAgo * 1000000),
            end: String(now * 1000000),
            limit: '50'
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
            console.log('🎉 [SUCCESS] Found main app logs in Loki!');
            
            let totalLogs = 0;
            data.data.result.forEach((stream, index) => {
                console.log(`\n📋 Stream ${index + 1}: ${JSON.stringify(stream.stream)}`);
                console.log(`   Entries: ${stream.values?.length || 0}`);
                totalLogs += stream.values?.length || 0;
                
                // Show last 5 logs
                if (stream.values && stream.values.length > 0) {
                    console.log('   Recent logs:');
                    stream.values.slice(-5).forEach((logEntry, logIndex) => {
                        const timestamp = new Date(parseInt(logEntry[0]) / 1000000);
                        const message = logEntry[1];
                        console.log(`   ${logIndex + 1}. [${timestamp.toISOString()}] ${message}`);
                    });
                }
            });
            
            console.log(`\n✅ [SUCCESS] Total main app logs: ${totalLogs}`);
            console.log('\n🎯 [GRAFANA] Use this query in your Grafana dashboard:');
            console.log('   {app="mqtt-gateway"}');
            
        } else {
            console.log('⚠️ [INFO] No main app logs found yet');
            console.log('💡 [TIP] Run your main app first: node app-new-modular.js');
        }
        
        // Also check all available app values
        console.log('\n🏷️ [INFO] All available app labels:');
        const labelsResponse = await axios.get(
            `${process.env.LOKI_HOST}/loki/api/v1/label/app/values`,
            {
                auth: {
                    username: process.env.LOKI_USER,
                    password: process.env.LOKI_PASSWORD
                },
                timeout: 10000
            }
        );
        
        console.log('   Available apps:', labelsResponse.data.data);
        
    } catch (error) {
        console.error('❌ [ERROR] Failed to check logs:', error.message);
    }
}

checkMainAppLogs();