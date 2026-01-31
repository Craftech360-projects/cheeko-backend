/**
 * Check Device status
 */
require('dotenv').config({ path: 'd:/cheeko/cheeko-backend/main/manager-api-node/.env' });
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function check() {
    const mac = '00:16:3e:ac:b5:38';
    const { data, error } = await supabase
        .from('ai_device')
        .select('*')
        .eq('mac_address', mac)
        .single();

    if (error) {
        console.error('❌ Error fetching device:', error.message);
    } else {
        console.log('✅ Device data:');
        console.log(JSON.stringify(data, null, 2));
    }
}

check();
