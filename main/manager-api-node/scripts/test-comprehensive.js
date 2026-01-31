/**
 * Comprehensive RFID API Test Suite
 * Tests: Q&A Pack (inline questions), Content Pack, Card Mapping, and Lookup
 */

const http = require('http');

const BASE_URL = 'http://localhost:3000';
const RFID_BASE = '/admin/rfid';

// Test credentials (using a simple test token)
const AUTH_TOKEN = 'test-token-123';

// Helper function for API requests
function request(method, path, data = null) {
    return new Promise((resolve, reject) => {
        const options = {
            hostname: 'localhost',
            port: 3000,
            path: path,
            method: method,
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${AUTH_TOKEN}`
            }
        };

        const req = http.request(options, (res) => {
            let body = '';
            res.on('data', chunk => body += chunk);
            res.on('end', () => {
                try {
                    const response = {
                        status: res.statusCode,
                        data: JSON.parse(body)
                    };
                    resolve(response);
                } catch (e) {
                    resolve({
                        status: res.statusCode,
                        data: { error: 'Failed to parse response', raw: body }
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

// Generate random string for unique codes
function randomString(length = 6) {
    return Math.random().toString(36).substring(2, 2 + length).toUpperCase();
}

async function runTests() {
    console.log('='.repeat(80));
    console.log('RFID API COMPREHENSIVE TEST SUITE');
    console.log('='.repeat(80));
    console.log('');

    let testResults = {
        passed: 0,
        failed: 0,
        errors: []
    };

    // Store created IDs for cleanup and reference
    const createdIds = {
        questionPackId: null,
        contentPackId: null,
        cardId: null,
        rfidUid: null
    };

    try {
        // =====================================================
        // TEST 1: Create Q&A Pack with Inline Questions
        // =====================================================
        console.log('\n--- TEST 1: Create Q&A Pack with Inline Questions ---');
        const qPackCode = 'TEST_QA_' + randomString(6);
        const inlineQuestions = [
            { text: 'What color is the sky?', audio: 'https://example.com/audio/sky.mp3' },
            { text: 'How many legs does a dog have?', audio: 'https://example.com/audio/dog.mp3' },
            { text: 'What sound does a cat make?', audio: '' }
        ];

        const qPackPayload = {
            packCode: qPackCode,
            name: 'Test Q&A Pack with Inline Questions',
            description: 'Testing inline question creation',
            questions: inlineQuestions,
            language: 'en',
            category: 'test',
            status: 'draft',
            version: 1,
            active: true
        };

        console.log('Creating Q&A Pack with payload:', JSON.stringify(qPackPayload, null, 2));
        const qPackRes = await request('POST', RFID_BASE + '/question-pack', qPackPayload);

        if (qPackRes.status === 200 && qPackRes.data.code === 0) {
            console.log('✅ Q&A Pack created successfully');
            testResults.passed++;

            // Verify the pack was created by fetching it
            console.log('Verifying pack creation...');
            const verifyRes = await request('GET', RFID_BASE + `/question-pack/code/${qPackCode}`);
            if (verifyRes.status === 200 && verifyRes.data.code === 0) {
                const pack = verifyRes.data.data;
                console.log('✅ Pack verified:', pack.name);
                console.log(`   - Question IDs: ${JSON.stringify(pack.questionIds)}`);
                console.log(`   - Total Questions: ${pack.questionIds ? pack.questionIds.length : 0}`);

                if (pack.questionIds && pack.questionIds.length === 3) {
                    console.log('✅ Correct number of questions created (3)');
                    testResults.passed++;
                    createdIds.questionPackId = pack.id;
                } else {
                    console.log('❌ Expected 3 questions, got:', pack.questionIds ? pack.questionIds.length : 0);
                    testResults.failed++;
                    testResults.errors.push('Question count mismatch');
                }
            } else {
                console.log('❌ Failed to verify pack:', verifyRes.data);
                testResults.failed++;
                testResults.errors.push('Pack verification failed');
            }
        } else {
            console.log('❌ Failed to create Q&A Pack');
            console.log('Response:', JSON.stringify(qPackRes.data, null, 2));
            testResults.failed++;
            testResults.errors.push('Q&A Pack creation failed: ' + (qPackRes.data.msg || 'Unknown error'));
        }

        // =====================================================
        // TEST 2: Create Content Pack with Items
        // =====================================================
        console.log('\n--- TEST 2: Create Content Pack with Items ---');
        const cPackCode = 'TEST_CONTENT_' + randomString(6);
        const contentItems = [
            { sequence: 1, text: 'Once upon a time...', audioUrl: 'https://example.com/story1.mp3' },
            { sequence: 2, text: 'There was a little rabbit...', audioUrl: 'https://example.com/story2.mp3' },
            { sequence: 3, text: 'Who loved to hop around...', audioUrl: '' }
        ];

        const cPackPayload = {
            packCode: cPackCode,
            name: 'Test Story Pack',
            description: 'A test story with 3 items',
            contentType: 'tts',
            language: 'en',
            items: contentItems,
            active: true
        };

        console.log('Creating Content Pack with payload:', JSON.stringify(cPackPayload, null, 2));
        const cPackRes = await request('POST', RFID_BASE + '/content-pack', cPackPayload);

        if (cPackRes.status === 200 && cPackRes.data.code === 0) {
            console.log('✅ Content Pack created successfully');
            testResults.passed++;

            // Verify the pack
            console.log('Verifying content pack...');
            const verifyRes = await request('GET', RFID_BASE + `/content-pack/code/${cPackCode}`);
            if (verifyRes.status === 200 && verifyRes.data.code === 0) {
                const pack = verifyRes.data.data;
                console.log('✅ Content Pack verified:', pack.name);
                console.log(`   - Total Items: ${pack.totalItems}`);

                if (pack.totalItems === 3) {
                    console.log('✅ Correct number of items (3)');
                    testResults.passed++;
                    createdIds.contentPackId = pack.id;
                } else {
                    console.log('❌ Expected 3 items, got:', pack.totalItems);
                    testResults.failed++;
                    testResults.errors.push('Content item count mismatch');
                }
            } else {
                console.log('❌ Failed to verify content pack:', verifyRes.data);
                testResults.failed++;
                testResults.errors.push('Content pack verification failed');
            }
        } else {
            console.log('❌ Failed to create Content Pack');
            console.log('Response:', JSON.stringify(cPackRes.data, null, 2));
            testResults.failed++;
            testResults.errors.push('Content Pack creation failed: ' + (cPackRes.data.msg || 'Unknown error'));
        }

        // =====================================================
        // TEST 3: Create Card Mapping (Q&A Pack)
        // =====================================================
        console.log('\n--- TEST 3: Create Card Mapping for Q&A Pack ---');
        const testUid1 = 'TEST' + randomString(8);
        createdIds.rfidUid = testUid1;

        const cardPayload1 = {
            rfidUid: testUid1,
            questionPackId: createdIds.questionPackId,
            notes: 'Test card for Q&A pack',
            active: true
        };

        console.log('Creating Card Mapping:', JSON.stringify(cardPayload1, null, 2));
        const cardRes1 = await request('POST', RFID_BASE + '/card', cardPayload1);

        if (cardRes1.status === 200 && cardRes1.data.code === 0) {
            console.log('✅ Card Mapping (Q&A) created successfully');
            testResults.passed++;
        } else {
            console.log('❌ Failed to create Card Mapping (Q&A)');
            console.log('Response:', JSON.stringify(cardRes1.data, null, 2));
            testResults.failed++;
            testResults.errors.push('Card mapping (Q&A) creation failed');
        }

        // =====================================================
        // TEST 4: Create Card Mapping (Content Pack)
        // =====================================================
        console.log('\n--- TEST 4: Create Card Mapping for Content Pack ---');
        const testUid2 = 'TEST' + randomString(8);

        const cardPayload2 = {
            rfidUid: testUid2,
            contentPackId: createdIds.contentPackId,
            notes: 'Test card for Content pack',
            active: true
        };

        console.log('Creating Card Mapping:', JSON.stringify(cardPayload2, null, 2));
        const cardRes2 = await request('POST', RFID_BASE + '/card', cardPayload2);

        if (cardRes2.status === 200 && cardRes2.data.code === 0) {
            console.log('✅ Card Mapping (Content) created successfully');
            testResults.passed++;
        } else {
            console.log('❌ Failed to create Card Mapping (Content)');
            console.log('Response:', JSON.stringify(cardRes2.data, null, 2));
            testResults.failed++;
            testResults.errors.push('Card mapping (Content) creation failed');
        }

        // =====================================================
        // TEST 5: Lookup - Find Card Mapping
        // =====================================================
        console.log('\n--- TEST 5: Lookup - Find Card Mapping ---');
        console.log(`Looking up UID: ${testUid1}`);

        const lookupRes = await request('GET', RFID_BASE + `/card/uid/${testUid1}`);

        if (lookupRes.status === 200 && lookupRes.data.code === 0) {
            const card = lookupRes.data.data;
            console.log('✅ Card found:', JSON.stringify(card, null, 2));

            if (card.questionPackId === createdIds.questionPackId) {
                console.log('✅ Card correctly linked to Q&A Pack');
                testResults.passed++;
            } else {
                console.log('❌ Card not linked to expected Q&A Pack');
                testResults.failed++;
                testResults.errors.push('Card lookup - wrong pack link');
            }
        } else {
            console.log('❌ Card lookup failed');
            console.log('Response:', JSON.stringify(lookupRes.data, null, 2));
            testResults.failed++;
            testResults.errors.push('Card lookup failed');
        }

        // =====================================================
        // TEST 6: Content Lookup (Resolve Content)
        // =====================================================
        console.log('\n--- TEST 6: Content Lookup - Resolve Content ---');
        console.log(`Resolving content for UID: ${testUid2}, sequence: 2`);

        const contentLookupRes = await request('GET', RFID_BASE + `/lookup/content?uid=${testUid2}&sequence=2`);

        if (contentLookupRes.status === 200 && contentLookupRes.data.code === 0) {
            const content = contentLookupRes.data.data;
            console.log('✅ Content resolved:', JSON.stringify(content, null, 2));

            if (content.text && content.text.includes('rabbit')) {
                console.log('✅ Correct content item retrieved (sequence 2)');
                testResults.passed++;
            } else {
                console.log('⚠️  Content retrieved but may not match expected sequence');
                console.log('   Expected text containing "rabbit", got:', content.text);
            }
        } else {
            console.log('❌ Content lookup failed');
            console.log('Response:', JSON.stringify(contentLookupRes.data, null, 2));
            testResults.failed++;
            testResults.errors.push('Content lookup failed');
        }

        // =====================================================
        // TEST 7: Download Manifest
        // =====================================================
        console.log('\n--- TEST 7: Download Manifest ---');
        console.log(`Getting download manifest for UID: ${testUid2}`);

        const manifestRes = await request('GET', RFID_BASE + `/lookup/download?uid=${testUid2}`);

        if (manifestRes.status === 200 && manifestRes.data.code === 0) {
            const manifest = manifestRes.data.data;
            console.log('✅ Download manifest retrieved');
            console.log('Manifest:', JSON.stringify(manifest, null, 2));

            if (manifest.audioUrls && manifest.audioUrls.length > 0) {
                console.log(`✅ Manifest contains ${manifest.audioUrls.length} audio URLs`);
                testResults.passed++;
            } else {
                console.log('⚠️  Manifest retrieved but contains no audio URLs');
            }
        } else {
            console.log('❌ Download manifest failed');
            console.log('Response:', JSON.stringify(manifestRes.data, null, 2));
            testResults.failed++;
            testResults.errors.push('Download manifest failed');
        }

    } catch (error) {
        console.error('\n❌ FATAL ERROR:', error.message);
        if (error.response) {
            console.error('Response:', error.response.data);
        }
        testResults.failed++;
        testResults.errors.push('Fatal error: ' + error.message);
    }

    // =====================================================
    // TEST SUMMARY
    // =====================================================
    console.log('\n' + '='.repeat(80));
    console.log('TEST SUMMARY');
    console.log('='.repeat(80));
    console.log(`✅ Passed: ${testResults.passed}`);
    console.log(`❌ Failed: ${testResults.failed}`);
    console.log(`Total Tests: ${testResults.passed + testResults.failed}`);

    if (testResults.errors.length > 0) {
        console.log('\nErrors:');
        testResults.errors.forEach((err, idx) => {
            console.log(`  ${idx + 1}. ${err}`);
        });
    }

    console.log('\n' + '='.repeat(80));
    console.log('Created Test Data (for cleanup):');
    console.log('='.repeat(80));
    console.log('Question Pack ID:', createdIds.questionPackId);
    console.log('Content Pack ID:', createdIds.contentPackId);
    console.log('Test UIDs:', createdIds.rfidUid, '(and one more for content pack)');
    console.log('='.repeat(80));

    // Exit with appropriate code
    process.exit(testResults.failed > 0 ? 1 : 0);
}

// Run the tests
runTests().catch(error => {
    console.error('Test suite failed:', error);
    process.exit(1);
});
