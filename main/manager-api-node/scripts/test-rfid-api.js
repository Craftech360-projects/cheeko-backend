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
function request(method, path, data = null, headers = {}) {
    return new Promise((resolve, reject) => {
        const options = {
            hostname: HOST,
            port: PORT,
            path: BASE_PATH + path,
            method: method,
            headers: {
                'Content-Type': 'application/json',
                ...headers
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

function randomString(length) {
    return crypto.randomBytes(Math.ceil(length / 2))
        .toString('hex') /** convert to hexadecimal format */
        .slice(0, length);   /** return required number of characters */
}

async function runTests() {
    console.log('Starting RFID API Tests...');

    // 1. Login
    console.log('\n--- 1. Testing Login ---');
    const loginRes = await request('POST', LOGIN_PATH, {
        username: USERNAME,
        password: PASSWORD,
        captcha: 'MOBILE_APP_BYPASS',
        captchaId: 'test-script'
    });
    console.log('Login Status:', loginRes.status);

    if (loginRes.data && loginRes.data.code === 0 && loginRes.data.data.token) {
        authToken = loginRes.data.data.token;
        console.log('Login Successful.');
    } else {
        console.error('Login Failed:', JSON.stringify(loginRes.data, null, 2));
        process.exit(1);
    }

    // 2. Create Product SKU (Pack)
    console.log('\n--- 2. Testing Create RFID Pack (Product SKU) ---');
    const packCode = 'TEST_PACK_' + randomString(6);
    const packRes = await request('POST', RFID_BASE + '/pack', {
        packCode: packCode,
        name: 'Test Pack ' + Date.now(),
        description: 'Created by test script',
        ageMin: 3,
        ageMax: 5,
        active: true
    });
    console.log('Create Pack Status:', packRes.status);
    console.log('Response:', JSON.stringify(packRes.data));

    // 3. Create Content Pack (Story)
    console.log('\n--- 3. Testing Create Content Pack (Story) ---');
    const contentPackCode = 'TEST_CONTENT_' + randomString(6);
    const contentPackRes = await request('POST', RFID_BASE + '/content-pack', {
        packCode: contentPackCode,
        name: 'Test Story Pack',
        description: 'A test story',
        contentType: 'read_only', // Story
        contentMd: '# Story Title\nOnce upon a time...',
        totalItems: 1,
        language: 'en',
        active: true
    });
    console.log('Create Content Pack Status:', contentPackRes.status);
    console.log('Response:', JSON.stringify(contentPackRes.data));

    // 4. Create Question
    console.log('\n--- 4. Testing Create Question ---');
    const questionCode = 'TEST_Q_' + randomString(6);
    const questionRes = await request('POST', RFID_BASE + '/question', {
        code: questionCode,
        title: 'Test Question',
        promptText: 'System: You are a helpful assistant.\nUser: Tell me a joke.',
        language: 'en',
        category: 'general',
        difficulty: 1,
        active: true
    });
    console.log('Create Question Status:', questionRes.status);
    console.log('Response:', JSON.stringify(questionRes.data));

    // Get Question ID by Code
    const questionListRes = await request('GET', RFID_BASE + `/question/code/${questionCode}`);
    let questionId = null;
    if (questionListRes.data && questionListRes.data.code === 0) {
        questionId = questionListRes.data.data.id;
        console.log('Question ID:', questionId);
    } else {
        console.error('Failed to retrieve Question ID');
    }

    // 5. Create Question Pack (Q&A)
    if (questionId) {
        console.log('\n--- 5. Testing Create Question Pack ---');
        const qPackCode = 'TEST_QPACK_' + randomString(6);
        const qPackRes = await request('POST', RFID_BASE + '/question-pack', {
            packCode: qPackCode,
            name: 'Test Setup Pack',
            description: 'Testing Q&A Pack creation',
            questionIds: [questionId],
            language: 'en',
            category: 'test',
            active: true
        });
        console.log('Create Question Pack Status:', qPackRes.status);
        console.log('Response:', JSON.stringify(qPackRes.data));
    }

    // 5b. Create Question Pack with INLINE Questions (NEW FEATURE)
    console.log('\n--- 5b. Testing Create Question Pack with INLINE Questions ---');
    const inlineQPackCode = 'TEST_INLINE_' + randomString(6);
    const inlineQuestions = [
        { text: 'What color is the sky?', audio: 'https://example.com/audio/sky.mp3' },
        { text: 'How many legs does a dog have?', audio: 'https://example.com/audio/dog.mp3' },
        { text: 'What sound does a cat make?', audio: '' }
    ];

    const inlineQPackRes = await request('POST', RFID_BASE + '/question-pack', {
        packCode: inlineQPackCode,
        name: 'Test Inline Questions Pack',
        description: 'Testing inline question creation',
        questions: inlineQuestions,
        language: 'en',
        category: 'test',
        active: true
    });
    console.log('Create Inline Q&A Pack Status:', inlineQPackRes.status);
    console.log('Response:', JSON.stringify(inlineQPackRes.data));

    // Verify inline questions were created
    if (inlineQPackRes.status === 200 && inlineQPackRes.data.code === 0) {
        console.log('Verifying inline question pack...');
        const verifyRes = await request('GET', RFID_BASE + `/question-pack/code/${inlineQPackCode}`);
        if (verifyRes.data && verifyRes.data.code === 0) {
            const pack = verifyRes.data.data;
            console.log(`✅ Pack verified: ${pack.name}`);
            console.log(`   Question IDs: ${JSON.stringify(pack.questionIds)}`);
            console.log(`   Total Questions: ${pack.questionIds ? pack.questionIds.length : 0}`);

            if (pack.questionIds && pack.questionIds.length === 3) {
                console.log('✅ SUCCESS: All 3 inline questions created correctly!');
            } else {
                console.log('❌ FAIL: Expected 3 questions, got:', pack.questionIds ? pack.questionIds.length : 0);
            }
        } else {
            console.log('❌ FAIL: Could not verify inline question pack');
        }
    } else {
        console.log('❌ FAIL: Inline question pack creation failed');
    }


    // 6. Create Card Mapping
    console.log('\n--- 6. Testing Create Card Mapping ---');
    // Need Pack ID and Content Pack ID
    // Get Pack ID
    const packListRes = await request('GET', RFID_BASE + `/pack/code/${packCode}`);
    let packId = null;
    if (packListRes.data && packListRes.data.code === 0) {
        packId = packListRes.data.data.id;
        console.log('Pack ID:', packId);
    }

    // Get Content Pack ID
    const contentPackListRes = await request('GET', RFID_BASE + `/content-pack/code/${contentPackCode}`);
    let contentPackId = null;
    if (contentPackListRes.data && contentPackListRes.data.code === 0) {
        contentPackId = contentPackListRes.data.data.id;
        console.log('Content Pack ID:', contentPackId);
    }

    // Use a HEX uid like real RFID
    const rfidUid = randomString(8).toUpperCase();
    console.log('Creating Card for UID:', rfidUid);

    const cardRes = await request('POST', RFID_BASE + '/card', {
        rfidUid: rfidUid,
        packId: packId,
        contentPackId: contentPackId,
        questionId: questionId,
        notes: 'Automated Test Card'
    });
    console.log('Create Card Status:', cardRes.status);
    console.log('Response:', JSON.stringify(cardRes.data));


    // 7. Verify Lookup
    console.log('\n--- 7. Testing Card Lookup ---');
    const lookupRes = await request('GET', RFID_BASE + `/card/lookup/${rfidUid}`);
    console.log('Lookup Status:', lookupRes.status);
    console.log('Lookup Data:', JSON.stringify(lookupRes.data, null, 2));

    if (lookupRes.data && lookupRes.data.code === 0) {
        console.log('SUCCESS: Card Lookup returned valid data.');
        // Verify links
        const d = lookupRes.data.data;
        if (d.packCode === contentPackCode) console.log(`PASS: Content Pack Code matches (${d.packCode}).`); else console.error(`FAIL: Content Pack Code mismatch. Expected ${contentPackCode}, got ${d.packCode}`);
        if (d.title === 'Test Story Pack') console.log('PASS: Title matches.'); else console.error(`FAIL: Title mismatch. Expected 'Test Story Pack', got ${d.title}`);
    } else {
        console.error('FAIL: Card Lookup failed');
    }

    // 8. Create Series
    console.log('\n--- 8. Testing Create Series ---');
    const prefix = crypto.randomBytes(3).toString('hex').toUpperCase(); // 6 chars
    const sUid = prefix + '000000'; // 12 chars
    const eUid = prefix + 'FFFFFF';

    const seriesRes = await request('POST', RFID_BASE + '/series', {
        name: 'Test Series ' + prefix,
        startUid: sUid,
        endUid: eUid,
        contentPackId: contentPackId,
        active: true
    });
    console.log('Create Series Status:', seriesRes.status);
    console.log('Response:', JSON.stringify(seriesRes.data));

    // Verify Series Lookup
    const testUid = prefix + '000123';
    console.log(`Verifying Series Lookup for UID: ${testUid}`);
    // Using find endpoint which returns range matches
    const seriesLookupRes = await request('GET', RFID_BASE + `/series/find/${testUid}`);

    console.log('Series Lookup Status:', seriesLookupRes.status);
    console.log('Series Lookup Data:', JSON.stringify(seriesLookupRes.data, null, 2));

    if (seriesLookupRes.data && seriesLookupRes.data.code === 0 && seriesLookupRes.data.data && seriesLookupRes.data.data.length > 0) {
        console.log("SUCCESS: Series found for UID in range.");
    } else {
        console.log("FAIL: Series not found for UID in range.");
    }
}

runTests().catch(e => {
    console.error("Test Script Error:", e);
});
