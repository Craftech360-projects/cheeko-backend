#!/usr/bin/env node
/**
 * Test Supabase Connection
 */

require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

console.log('\n🔍 Supabase Connection Test\n');
console.log('═'.repeat(60));

console.log('SUPABASE_URL:', process.env.SUPABASE_URL || 'NOT SET');
console.log('SUPABASE_SERVICE_ROLE_KEY:', process.env.SUPABASE_SERVICE_ROLE_KEY ? 'SET (hidden)' : 'NOT SET');

if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
  console.log('\n❌ Missing Supabase credentials');
  process.exit(1);
}

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function test() {
  try {
    console.log('\nTesting Supabase REST API...');

    // Try to query sys_user table
    const { data, error } = await supabase.from('sys_user').select('id').limit(1);

    if (error) {
      console.log('Query error:', error.message);
      console.log('Error code:', error.code);

      if (error.code === '42P01' || error.message.includes('does not exist')) {
        console.log('\n✅ Supabase connection works, but tables do not exist yet.');
        console.log('   Migrations need to be run.');
        return;
      }
    } else {
      console.log('\n✅ Supabase connection successful!');
      console.log('   Tables exist, data:', data);
    }

    // Test RPC capability
    console.log('\nChecking database info...');
    const { data: versionData, error: versionError } = await supabase.rpc('version');
    if (!versionError && versionData) {
      console.log('Database version:', versionData);
    }

  } catch (e) {
    console.error('\n❌ Error:', e.message);
  }
}

test().then(() => {
  console.log('\n');
  process.exit(0);
}).catch(e => {
  console.error(e);
  process.exit(1);
});
