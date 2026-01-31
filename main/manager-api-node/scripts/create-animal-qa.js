/**
 * Create Animal Q&A Pack
 * Creates a Q&A pack with 10 animal-themed questions using inline question creation
 */

const http = require('http');
const crypto = require('crypto');

// Config
const HOST = 'localhost';
const PORT = 8002;
const BASE_PATH = '/toy';
const LOGIN_PATH = '/user/login';
const RFID_BASE = '/admin/rfid';

// Credentials
const USERNAME = 'admin1';
const PASSWORD = 'Admin@123';

// State
let authToken = '';

// Helper for HTTP Request
function request(method, path, data = null) {
    return new Promise((resolve, reject) => {
        const options = {
            hostname: HOST,
            port: PORT,
            path: BASE_PATH + path,
            method: method,
            headers: {
                'Content-Type': 'application/json'
            }
        };

        if (authToken) {
            options.headers['Authorization'] = 'Bearer ' + authToken;
        }

        const req = http.request(options, (res) => {
            let body = '';
            res.on('data', (chunk) => body += chunk);
            res.on('end', () => {
                try {
                    const json = body ? JSON.parse(body) : null;
                    resolve({ status: res.statusCode, data: json });
                } catch (e) {
                    resolve({ status: res.statusCode, data: body });
                }
            });
        });

        req.on('error', (e) => reject(e));

        if (data) {
            req.write(JSON.stringify(data));
        }
        req.end();
    });
}

async function createAnimalQAPack() {
    console.log('='.repeat(70));
    console.log('Creating Animal Q&A Pack');
    console.log('='.repeat(70));

    // 1. Login
    console.log('\n1. Logging in...');
    const loginRes = await request('POST', LOGIN_PATH, {
        username: USERNAME,
        password: PASSWORD,
        captcha: 'MOBILE_APP_BYPASS',
        captchaId: 'test-script'
    });

    if (loginRes.data && loginRes.data.code === 0 && loginRes.data.data.token) {
        authToken = loginRes.data.data.token;
        console.log('✅ Login successful');
    } else {
        console.error('❌ Login failed:', loginRes.data);
        process.exit(1);
    }

    // 2. Prepare Q&A pack data with inline questions
    console.log('\n2. Preparing Q&A pack with 10 animal questions...');

    const questions = [
        { text: 'Tell me what you know about dogs. What sound does a dog make?', audio: '' },
        { text: 'What do you know about cats? How does a cat say hello?', audio: '' },
        { text: 'Can you tell me about cows? What sound does a cow make?', audio: '' },
        { text: 'Elephants are very big! What do you know about elephants?', audio: '' },
        { text: 'Lions are the king of the jungle! What sound does a lion make?', audio: '' },
        { text: 'Birds can fly! What do you know about birds?', audio: '' },
        { text: 'Fish live in water. Can you tell me about fish?', audio: '' },
        { text: 'Monkeys love to climb trees! What else do you know about monkeys?', audio: '' },
        { text: 'Rabbits hop around! What do rabbits like to eat?', audio: '' },
        { text: 'Horses can run very fast! What sound does a horse make?', audio: '' }
    ];

    const qaPack = {
        packCode: 'ANIMALS_QA',
        name: 'Animal Friends Q&A',
        description: 'Learn about different animals through fun questions and answers',
        questions: questions,
        language: 'en',
        category: 'animals',
        active: true
    };

    console.log(`✅ Prepared pack with ${questions.length} questions`);

    // 3. Create Q&A pack with inline questions
    console.log('\n3. Creating Q&A pack...');
    const createRes = await request('POST', RFID_BASE + '/question-pack', qaPack);

    if (createRes.status === 200 && createRes.data.code === 0) {
        console.log('✅ Q&A pack created successfully!');

        // 4. Verify creation
        console.log('\n4. Verifying Q&A pack...');
        const verifyRes = await request('GET', RFID_BASE + `/question-pack/code/${qaPack.packCode}`);

        if (verifyRes.data && verifyRes.data.code === 0) {
            const pack = verifyRes.data.data;
            console.log('✅ Pack verified:');
            console.log(`   - Name: ${pack.name}`);
            console.log(`   - Code: ${pack.packCode}`);
            console.log(`   - Category: ${pack.category}`);
            console.log(`   - Language: ${pack.language}`);
            console.log(`   - Total Questions: ${pack.questionIds ? pack.questionIds.length : 0}`);
            console.log(`   - Active: ${pack.active}`);

            if (pack.questionIds && pack.questionIds.length === 10) {
                console.log('\n✅ SUCCESS: All 10 animal questions created!');
                console.log('   Question IDs:', pack.questionIds);
            } else {
                console.log(`\n⚠️  WARNING: Expected 10 questions, got ${pack.questionIds ? pack.questionIds.length : 0}`);
            }
        } else {
            console.log('❌ Failed to verify pack');
        }
    } else {
        console.log('❌ Failed to create Q&A pack');
        console.log('Response:', JSON.stringify(createRes.data, null, 2));
    }

    console.log('\n' + '='.repeat(70));
    console.log('Done!');
    console.log('='.repeat(70));
}

createAnimalQAPack().catch(err => {
    console.error('Script failed:', err);
    process.exit(1);
});
