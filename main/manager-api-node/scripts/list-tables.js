/**
 * List Tables
 */
require('dotenv').config({ path: 'd:/cheeko/cheeko-backend/main/manager-api-node/.env' });
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function listTables() {
    const { data, error } = await supabase
        .from('information_schema.tables')
        .select('table_name')
        .eq('table_schema', 'public');

    if (error) {
        console.error('❌ Error listing tables:', error.message);
    } else {
        console.log('Tables in public schema:');
        data.forEach(t => console.log(`- ${t.table_name}`));
    }
}

listTables();
