/**
 * Test Content Pack Items Loading
 * Verifies that getContentPackByCode returns items
 */

const http = require('http');

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

async function testItemsLoading() {
    console.log('='.repeat(70));
    console.log('Testing Content Pack Items Loading');
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
        console.error('❌ Login failed');
        process.exit(1);
    }

    // 2. Fetch content pack by code
    console.log('\n2. Fetching BEDTIME_ROUTINE_FINAL pack...');
    const packRes = await request('GET', RFID_BASE + '/content-pack/code/BEDTIME_ROUTINE_FINAL');

    if (packRes.status === 200 && packRes.data.code === 0) {
        const pack = packRes.data.data;
        console.log('✅ Pack fetched successfully');
        console.log(`   - Name: ${pack.name}`);
        console.log(`   - Code: ${pack.packCode}`);
        console.log(`   - Total Items: ${pack.totalItems}`);
        console.log(`   - Items Array Length: ${pack.items ? pack.items.length : 0}`);

        if (pack.items && pack.items.length > 0) {
            console.log('\n✅ SUCCESS: Items loaded!');
            console.log(`   Found ${pack.items.length} items:`);
            pack.items.forEach((item, index) => {
                console.log(`   ${index + 1}. ${item.title}`);
                console.log(`      - Sequence: ${item.sequence}`);
                console.log(`      - Audio: ${item.audioUrl ? '✓' : '✗'}`);
                console.log(`      - Image: ${item.imageUrl ? '✓' : '✗'}`);
            });
        } else {
            console.log('\n❌ FAIL: No items in response');
            console.log('Response:', JSON.stringify(pack, null, 2));
        }
    } else {
        console.log('❌ Failed to fetch pack');
        console.log('Response:', JSON.stringify(packRes.data, null, 2));
    }

    console.log('\n' + '='.repeat(70));
    console.log('Done!');
    console.log('='.repeat(70));
}

testItemsLoading().catch(err => {
    console.error('Test failed:', err);
    process.exit(1);
});
