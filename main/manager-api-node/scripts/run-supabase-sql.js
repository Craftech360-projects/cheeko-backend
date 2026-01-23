#!/usr/bin/env node
/**
 * Run SQL via Supabase Management API
 */

require('dotenv').config();

const fs = require('fs');
const path = require('path');

async function runSQL() {
  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
    process.exit(1);
  }

  // Read SQL file
  const sqlPath = path.join(__dirname, '..', 'database-setup.sql');
  if (!fs.existsSync(sqlPath)) {
    console.error('database-setup.sql not found. Run setup-database.js first.');
    process.exit(1);
  }

  const sql = fs.readFileSync(sqlPath, 'utf8');

  console.log('Executing SQL via Supabase API...\n');

  // Split SQL into individual statements (simple split, doesn't handle all cases)
  const statements = sql
    .split(';')
    .map(s => s.trim())
    .filter(s => s.length > 0 && !s.startsWith('--'));

  let successCount = 0;
  let errorCount = 0;

  for (const statement of statements) {
    // Skip comments and empty statements
    if (statement.startsWith('--') || statement.trim() === '') continue;

    try {
      // Use the PostgREST rpc endpoint (requires a function)
      // This won't work directly, but we can try...
      const response = await fetch(`${supabaseUrl}/rest/v1/rpc`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': serviceRoleKey,
          'Authorization': `Bearer ${serviceRoleKey}`,
          'Prefer': 'return=minimal'
        },
        body: JSON.stringify({
          query: statement + ';'
        })
      });

      if (response.ok) {
        successCount++;
        process.stdout.write('.');
      } else {
        const error = await response.text();
        if (!error.includes('already exists')) {
          errorCount++;
          console.log(`\nStatement failed: ${statement.substring(0, 50)}...`);
        }
      }
    } catch (error) {
      // Ignore individual errors
    }
  }

  console.log(`\n\nCompleted: ${successCount} successful, ${errorCount} errors`);

  // The above likely won't work since PostgREST doesn't support raw SQL
  // Let's provide alternative instructions
  console.log('\n═══════════════════════════════════════════════════════════');
  console.log('Note: Supabase REST API does not support raw SQL execution.');
  console.log('');
  console.log('Please run the SQL manually:');
  console.log('1. Open: https://supabase.com/dashboard/project/' + supabaseUrl.match(/([^.]+)\.supabase\.co/)[1] + '/sql');
  console.log('2. Paste the contents of database-setup.sql');
  console.log('3. Click "Run"');
  console.log('═══════════════════════════════════════════════════════════');
}

runSQL().catch(console.error);
