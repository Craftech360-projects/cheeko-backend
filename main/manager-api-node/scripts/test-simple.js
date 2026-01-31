/**
 * Simple RFID API Test - Q&A Pack with Inline Questions
 */

const http = require('http');
const fs = require('fs');

const logFile = 'test-results.log';
const logs = [];

function log(message) {
    console.log(message);
    logs.push(message);
}

function saveLog() {
    fs.writeFileSync(logFile, logs.join('\n'));
}

function request(method, path, data = null) {
    return new Promise((resolve, reject) => {
        const options = {
            hostname: 'localhost',
            port: 3000,
            path: path,
            method: method,
            headers: {
                'Content-Type': 'application/json'
            }
        };

        const req = http.request(options, (res) => {
            let body = '';
            res.on('data', chunk => body += chunk);
            res.on('end', () => {
                try {
                    resolve({
                        status: res.statusCode,
                        data: JSON.parse(body)
                    });
                } catch (e) {
                    resolve({
                        status: res.statusCode,
                        data: { error: 'Parse failed', raw: body }
                    });
                }
            });
        });

        req.on('error', reject);

        if (data) {
            req.write(JSON.stringify(data));
        }

        req.end();
    });
}

function randomString(length = 6) {
    return Math.random().toString(36).substring(2, 2 + length).toUpperCase();
}

async function test() {
    try {
        log('='.repeat(60));
        log('TEST: Q&A Pack with Inline Questions');
        log('='.repeat(60));

        const packCode = 'TEST_QA_' + randomString(6);
        const payload = {
            packCode: packCode,
            name: 'Test Q&A Pack',
            description: 'Testing inline questions',
            questions: [
                { text: 'What color is the sky?', audio: 'https://example.com/sky.mp3' },
                { text: 'How many legs does a dog have?', audio: '' },
                { text: 'What sound does a cat make?', audio: 'https://example.com/cat.mp3' }
            ],
            language: 'en',
            category: 'test',
            active: true
        };

        log('\n1. Creating Q&A Pack...');
        log('Payload: ' + JSON.stringify(payload, null, 2));

        const createRes = await request('POST', '/admin/rfid/question-pack', payload);
        log('Response Status: ' + createRes.status);
        log('Response: ' + JSON.stringify(createRes.data, null, 2));

        if (createRes.status === 200 && createRes.data.code === 0) {
            log('✅ Pack created successfully!');

            log('\n2. Verifying pack...');
            const verifyRes = await request('GET', `/admin/rfid/question-pack/code/${packCode}`);
            log('Verify Response: ' + JSON.stringify(verifyRes.data, null, 2));

            if (verifyRes.data.code === 0) {
                const pack = verifyRes.data.data;
                log(`✅ Pack found: ${pack.name}`);
                log(`   Questions: ${pack.questionIds ? pack.questionIds.length : 0}`);
                log(`   Question IDs: ${JSON.stringify(pack.questionIds)}`);

                if (pack.questionIds && pack.questionIds.length === 3) {
                    log('✅ SUCCESS: All 3 questions created!');
                } else {
                    log('❌ FAIL: Expected 3 questions');
                }
            }
        } else {
            log('❌ FAIL: Pack creation failed');
            log('Error: ' + (createRes.data.msg || 'Unknown'));
        }

        log('\n' + '='.repeat(60));
        log('Test complete. Results saved to: ' + logFile);
        log('='.repeat(60));

    } catch (error) {
        log('❌ ERROR: ' + error.message);
        log(error.stack);
    } finally {
        saveLog();
    }
}

test();
