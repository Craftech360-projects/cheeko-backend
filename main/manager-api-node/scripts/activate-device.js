/**
 * Activate Device in ai_device table (Uppercase MAC)
 */
require('dotenv').config({ path: 'd:/cheeko/cheeko-backend/main/manager-api-node/.env' });
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function activate() {
    const mac = '00:16:3E:AC:B5:38'; // UPPERCASE to match normalizeMacAddress in helpers.js
    console.log(`Activating device in ai_device: ${mac}`);

    const { data: device, error } = await supabase
        .from('ai_device')
        .upsert({
            mac_address: mac,
            user_id: 1,
            mode: 'conversation',
            device_mode: 'manual',
            last_connected_at: new Date().toISOString()
        }, { onConflict: 'mac_address' });

    if (error) {
        console.error('❌ Error activating device:', error.message);
    } else {
        console.log('✅ Device activated successfully');
    }
}

activate();
