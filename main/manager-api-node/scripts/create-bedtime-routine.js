/**
 * Create Bedtime Routine Content Pack
 * Inserts a content pack with 10 bedtime routine steps
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

async function createBedtimeRoutine() {
    console.log('='.repeat(70));
    console.log('Creating Bedtime Routine Content Pack');
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

    // 2. Prepare content pack data
    console.log('\n2. Preparing content pack data...');

    const items = [
        {
            sequence: 1,
            title: "Step 1",
            text: "Bed time routine step 1",
            audioUrl: "https://d23u4d6oyrni77.cloudfront.net/habits/bed-time/step-01/audio.mp3",
            imageUrl: "https://d23u4d6oyrni77.cloudfront.net/habits/bed-time/step-01/image.png"
        },
        {
            sequence: 2,
            title: "Step 2",
            text: "Bed time routine step 2",
            audioUrl: "https://d23u4d6oyrni77.cloudfront.net/habits/bed-time/step-02/audio.mp3",
            imageUrl: "https://d23u4d6oyrni77.cloudfront.net/habits/bed-time/step-02/image.png"
        },
        {
            sequence: 3,
            title: "Step 3",
            text: "Bed time routine step 3",
            audioUrl: "https://d23u4d6oyrni77.cloudfront.net/habits/bed-time/step-03/audio.mp3",
            imageUrl: "https://d23u4d6oyrni77.cloudfront.net/habits/bed-time/step-03/image.png"
        },
        {
            sequence: 4,
            title: "Step 4",
            text: "Bed time routine step 4",
            audioUrl: "https://d23u4d6oyrni77.cloudfront.net/habits/bed-time/step-04/audio.mp3",
            imageUrl: "https://d23u4d6oyrni77.cloudfront.net/habits/bed-time/step-04/image.png"
        },
        {
            sequence: 5,
            title: "Step 5",
            text: "Bed time routine step 5",
            audioUrl: "https://d23u4d6oyrni77.cloudfront.net/habits/bed-time/step-05/audio.mp3",
            imageUrl: "https://d23u4d6oyrni77.cloudfront.net/habits/bed-time/step-05/image.png"
        },
        {
            sequence: 6,
            title: "Step 6",
            text: "Bed time routine step 6",
            audioUrl: "https://d23u4d6oyrni77.cloudfront.net/habits/bed-time/step-06/audio.mp3",
            imageUrl: "https://d23u4d6oyrni77.cloudfront.net/habits/bed-time/step-06/image.png"
        },
        {
            sequence: 7,
            title: "Step 7",
            text: "Bed time routine step 7",
            audioUrl: "https://d23u4d6oyrni77.cloudfront.net/habits/bed-time/step-07/audio.mp3",
            imageUrl: "https://d23u4d6oyrni77.cloudfront.net/habits/bed-time/step-07/image.png"
        },
        {
            sequence: 8,
            title: "Step 8",
            text: "Bed time routine step 8",
            audioUrl: "https://d23u4d6oyrni77.cloudfront.net/habits/bed-time/step-08/audio.mp3",
            imageUrl: "https://d23u4d6oyrni77.cloudfront.net/habits/bed-time/step-08/image.png"
        },
        {
            sequence: 9,
            title: "Step 9",
            text: "Bed time routine step 9",
            audioUrl: "https://d23u4d6oyrni77.cloudfront.net/habits/bed-time/step-09/audio.mp3",
            imageUrl: "https://d23u4d6oyrni77.cloudfront.net/habits/bed-time/step-09/image.png"
        },
        {
            sequence: 10,
            title: "Step 10",
            text: "Bed time routine step 10",
            audioUrl: "https://d23u4d6oyrni77.cloudfront.net/habits/bed-time/step-10/audio.mp3",
            imageUrl: "https://d23u4d6oyrni77.cloudfront.net/habits/bed-time/step-10/image.png"
        }
    ];

    const contentPack = {
        packCode: 'BEDTIME_ROUTINE_FINAL',
        name: 'Bed time routine',
        description: 'A 10-step bedtime routine to help children wind down and prepare for sleep',
        contentType: 'tts',
        language: 'en',
        category: 'habits',
        items: items,
        active: true
    };

    console.log(`✅ Prepared pack with ${items.length} items`);

    // 3. Create content pack
    console.log('\n3. Creating content pack...');
    const createRes = await request('POST', RFID_BASE + '/content-pack', contentPack);

    if (createRes.status === 200 && createRes.data.code === 0) {
        console.log('✅ Content pack created successfully!');

        // 4. Verify creation
        console.log('\n4. Verifying content pack...');
        const verifyRes = await request('GET', RFID_BASE + `/content-pack/code/${contentPack.packCode}`);

        if (verifyRes.data && verifyRes.data.code === 0) {
            const pack = verifyRes.data.data;
            console.log('✅ Pack verified:');
            console.log(`   - Name: ${pack.name}`);
            console.log(`   - Code: ${pack.packCode}`);
            console.log(`   - Total Items: ${pack.totalItems}`);
            console.log(`   - Language: ${pack.language}`);
            console.log(`   - Category: ${pack.category}`);
            console.log(`   - Active: ${pack.active}`);

            if (pack.totalItems === 10) {
                console.log('\n✅ SUCCESS: All 10 bedtime routine steps created!');
            } else {
                console.log(`\n⚠️  WARNING: Expected 10 items, got ${pack.totalItems}`);
            }
        } else {
            console.log('❌ Failed to verify pack');
        }
    } else {
        console.log('❌ Failed to create content pack');
        console.log('Response:', JSON.stringify(createRes.data, null, 2));
    }

    console.log('\n' + '='.repeat(70));
    console.log('Done!');
    console.log('='.repeat(70));
}

createBedtimeRoutine().catch(err => {
    console.error('Script failed:', err);
    process.exit(1);
});
