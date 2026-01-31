/**
 * Direct Database Test - Inline Questions
 * Tests the Supabase insert directly to isolate the issue
 */

require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabase = createClient(supabaseUrl, supabaseKey);

async function testDirectInsert() {
    console.log('Testing direct Supabase insert...\n');

    // Test data
    const testQuestions = [
        {
            code: 'TEST_DIRECT_Q1_0001',
            title: 'Test Question 1',
            prompt_text: 'What color is the sky?',
            cached_audio_url: 'https://example.com/audio/sky.mp3',
            language: 'en',
            category: 'test',
            difficulty: 1,
            active: true,
            creator: 1
        },
        {
            code: 'TEST_DIRECT_Q2_0002',
            title: 'Test Question 2',
            prompt_text: 'How many legs does a dog have?',
            cached_audio_url: null,
            language: 'en',
            category: 'test',
            difficulty: 1,
            active: true,
            creator: 1
        }
    ];

    console.log('Inserting questions:', JSON.stringify(testQuestions, null, 2));

    const { data, error } = await supabase
        .from('rfid_question')
        .insert(testQuestions)
        .select('id, code, title');

    if (error) {
        console.error('❌ ERROR:', error);
        console.error('Error details:', JSON.stringify(error, null, 2));
    } else {
        console.log('✅ SUCCESS!');
        console.log('Created questions:', JSON.stringify(data, null, 2));
        console.log(`\nCreated ${data.length} questions with IDs:`, data.map(q => q.id));
    }
}

testDirectInsert().catch(err => {
    console.error('Test failed:', err);
    process.exit(1);
});
