/**
 * Check Card Mapping
 */

require('dotenv').config({ path: 'd:/cheeko/cheeko-backend/main/manager-api-node/.env' });
const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabase = createClient(supabaseUrl, supabaseKey);

async function checkMapping() {
    const rfidUid = 'E96C8A82';
    console.log(`Checking mapping for RFID UID: ${rfidUid}`);

    const { data, error } = await supabase
        .from('rfid_card_mapping')
        .select('*')
        .eq('rfid_uid', rfidUid)
        .single();

    if (error) {
        console.error('❌ Error or no mapping found:', error.message);
    } else {
        console.log('✅ Mapping found:');
        console.log(JSON.stringify(data, null, 2));
    }
}

checkMapping();
