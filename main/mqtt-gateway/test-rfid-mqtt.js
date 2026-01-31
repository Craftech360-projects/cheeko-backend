/**
 * Test MQTT Gateway RFID Integration
 * Simulates an RFID card scan via MQTT message
 */

const mqtt = require('mqtt');

// Configuration
const MQTT_BROKER = 'mqtt://localhost:1883';
const DEVICE_ID = 'TEST_DEVICE_001';
const RFID_UID = 'E96C8A82'; // From our test - this UID is mapped to a content pack

// Test scenarios
const testScenarios = [
    {
        name: 'Test 1: Card Mapping Lookup',
        description: 'Test RFID UID that is mapped to content pack',
        rfidUid: 'E96C8A82', // This should return the Test Story Pack
        sequence: null
    },
    {
        name: 'Test 2: Bedtime Routine Content Pack',
        description: 'Test with a card mapped to bedtime routine',
        rfidUid: 'BEDTIME001', // We'll need to create a mapping for this
        sequence: 1
    },
    {
        name: 'Test 3: Unknown RFID',
        description: 'Test with unknown RFID UID',
        rfidUid: 'UNKNOWN123',
        sequence: null
    }
];

async function testMQTTGateway() {
    console.log('='.repeat(70));
    console.log('MQTT Gateway RFID Integration Test');
    console.log('='.repeat(70));

    console.log(`\nConnecting to MQTT broker: ${MQTT_BROKER}`);

    const client = mqtt.connect(MQTT_BROKER, {
        clientId: `test_client_${Date.now()}`,
        clean: true,
        connectTimeout: 4000,
        reconnectPeriod: 1000,
    });

    return new Promise((resolve, reject) => {
        let currentTest = 0;
        let timeout;

        client.on('connect', () => {
            console.log('✅ Connected to MQTT broker\n');

            // Subscribe to response topics
            const responseTopic = `cheeko/device/${DEVICE_ID}/response`;
            client.subscribe(responseTopic, (err) => {
                if (err) {
                    console.error('❌ Failed to subscribe:', err);
                    client.end();
                    reject(err);
                    return;
                }
                console.log(`✅ Subscribed to: ${responseTopic}\n`);

                // Start first test
                runTest(currentTest);
            });
        });

        client.on('message', (topic, message) => {
            try {
                const payload = JSON.parse(message.toString());
                console.log(`\n📨 Received response on ${topic}:`);
                console.log(JSON.stringify(payload, null, 2));

                // Move to next test after a delay
                clearTimeout(timeout);
                timeout = setTimeout(() => {
                    currentTest++;
                    if (currentTest < testScenarios.length) {
                        runTest(currentTest);
                    } else {
                        console.log('\n' + '='.repeat(70));
                        console.log('All tests completed!');
                        console.log('='.repeat(70));
                        client.end();
                        resolve();
                    }
                }, 2000);
            } catch (err) {
                console.error('❌ Error parsing message:', err);
            }
        });

        client.on('error', (err) => {
            console.error('❌ MQTT Error:', err);
            client.end();
            reject(err);
        });

        function runTest(index) {
            const test = testScenarios[index];
            console.log('\n' + '-'.repeat(70));
            console.log(`${test.name}`);
            console.log(`Description: ${test.description}`);
            console.log('-'.repeat(70));

            // Simulate RFID card scan message
            const topic = `cheeko/device/${DEVICE_ID}/greeting`;
            const payload = {
                type: 'text_greeting',
                rfid_uid: test.rfidUid,
                sequence: test.sequence,
                text: 'Hello from RFID card!',
                timestamp: Date.now()
            };

            console.log(`\n📤 Publishing to: ${topic}`);
            console.log('Payload:', JSON.stringify(payload, null, 2));

            client.publish(topic, JSON.stringify(payload), { qos: 1 }, (err) => {
                if (err) {
                    console.error('❌ Publish failed:', err);
                } else {
                    console.log('✅ Message published');
                    console.log('⏳ Waiting for response...');
                }
            });

            // Set timeout for this test
            timeout = setTimeout(() => {
                console.log('⚠️  No response received within 5 seconds');
                currentTest++;
                if (currentTest < testScenarios.length) {
                    runTest(currentTest);
                } else {
                    console.log('\n' + '='.repeat(70));
                    console.log('All tests completed!');
                    console.log('='.repeat(70));
                    client.end();
                    resolve();
                }
            }, 5000);
        }
    });
}

// Run the test
console.log('Starting MQTT Gateway RFID Integration Test...\n');
testMQTTGateway()
    .then(() => {
        console.log('\n✅ Test completed successfully');
        process.exit(0);
    })
    .catch((err) => {
        console.error('\n❌ Test failed:', err);
        process.exit(1);
    });
