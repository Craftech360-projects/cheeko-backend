/**
 * Apply kid_profile migration to Supabase
 */

const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

const supabaseUrl = process.env.SUPABASE_URL || 'https://rpzbnpymcaqtnfxvhllt.supabase.co';
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJwemJucHltY2FxdG5meHZobGx0Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc1OTc0Mjk5OSwiZXhwIjoyMDc1MzE4OTk5fQ.HjUJJs970bAghCq52MbU2YOyNutn-fxnYWBCM6sbnrc';

const supabase = createClient(supabaseUrl, supabaseServiceKey);

async function applyMigration() {
  try {
    console.log('🔄 Reading migration file...');
    const migrationPath = path.join(__dirname, '..', 'supabase', 'migrations', '20240109000001_fix_kid_profile_schema.sql');
    const sql = fs.readFileSync(migrationPath, 'utf8');

    console.log('🔄 Applying migration to Supabase...');

    // Execute SQL using Supabase RPC
    const { data, error } = await supabase.rpc('exec_sql', { sql_query: sql });

    if (error) {
      console.error('❌ Migration failed:', error);

      // If exec_sql doesn't exist, we need to run SQL commands directly
      console.log('⚠️ exec_sql RPC not found, running SQL directly via REST API...');

      // Use fetch to call Supabase REST API directly
      const response = await fetch(`${supabaseUrl}/rest/v1/rpc/exec_sql`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': supabaseServiceKey,
          'Authorization': `Bearer ${supabaseServiceKey}`,
        },
        body: JSON.stringify({ sql_query: sql })
      });

      if (!response.ok) {
        console.error('❌ Direct API call also failed. Please run the SQL manually in Supabase dashboard.');
        console.log('\n📋 Copy this SQL to Supabase Dashboard > SQL Editor:\n');
        console.log(sql);
        process.exit(1);
      }
    }

    console.log('✅ Migration applied successfully!');
    console.log('✅ kid_profile table is now ready for use');

  } catch (err) {
    console.error('❌ Error:', err.message);
    console.log('\n📋 Please run this SQL manually in Supabase Dashboard > SQL Editor:\n');
    const migrationPath = path.join(__dirname, '..', 'supabase', 'migrations', '20240109000001_fix_kid_profile_schema.sql');
    const sql = fs.readFileSync(migrationPath, 'utf8');
    console.log(sql);
    process.exit(1);
  }
}

applyMigration();
