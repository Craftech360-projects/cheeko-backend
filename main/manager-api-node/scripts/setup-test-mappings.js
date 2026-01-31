/**
 * Setup Test Mappings
 */
require('dotenv').config({ path: 'd:/cheeko/cheeko-backend/main/manager-api-node/.env' });
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function setup() {
    console.log('--- Setting up Test Mappings ---');

    // 1. Find Bedtime Routine Pack
    const { data: contentPacks } = await supabase
        .from('rfid_content_pack')
        .select('id, pack_code, name')
        .eq('pack_code', 'BEDTIME_ROUTINE_FINAL')
        .single();

    if (contentPacks) {
        console.log(`✅ Found Content Pack: ${contentPacks.name} (ID: ${contentPacks.id})`);

        // Map BEDTIME001
        await supabase.from('rfid_card_mapping').upsert({
            rfid_uid: 'BEDTIME001',
            pack_id: contentPacks.id,
            action_type: 'content',
            notes: 'Test Bedtime Card',
            active: true,
            status: 1
        }, { onConflict: 'rfid_uid' });
        console.log('✅ Mapped BEDTIME001 to Bedtime Routine');
    }

    // 2. Find Animal Q&A Pack
    const { data: questionPacks } = await supabase
        .from('rfid_question_pack')
        .select('id, pack_code, name')
        .eq('pack_code', 'ANIMALS_QA')
        .single();

    if (questionPacks) {
        console.log(`✅ Found Question Pack: ${questionPacks.name} (ID: ${questionPacks.id})`);

        // Map ANIMALS001
        await supabase.from('rfid_card_mapping').upsert({
            rfid_uid: 'ANIMALS001',
            question_pack_id: questionPacks.id,
            action_type: 'qa',
            notes: 'Test Animal Q&A Card',
            active: true,
            status: 1
        }, { onConflict: 'rfid_uid' });
        console.log('✅ Mapped ANIMALS001 to Animal Q&A');
    }
}

setup();
