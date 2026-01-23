/**
 * Run Database Migrations
 *
 * Executes all SQL migration files against Supabase.
 * Usage: node scripts/run-migrations.js
 */

require('dotenv').config();

const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

const migrationsDir = path.join(__dirname, '../supabase/migrations');

async function runMigrations() {
  console.log('Starting migrations...\n');

  // Get all migration files sorted by name
  const files = fs.readdirSync(migrationsDir)
    .filter(f => f.endsWith('.sql'))
    .sort();

  console.log(`Found ${files.length} migration files:\n`);
  files.forEach(f => console.log(`  - ${f}`));
  console.log('');

  for (const file of files) {
    const filePath = path.join(migrationsDir, file);
    const sql = fs.readFileSync(filePath, 'utf8');

    console.log(`Running: ${file}...`);

    try {
      // Execute SQL using Supabase's rpc or raw query
      // Note: Supabase JS client doesn't support raw SQL directly,
      // so we'll use the REST API endpoint for SQL
      const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/exec_sql`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': SUPABASE_SERVICE_ROLE_KEY,
          'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`
        },
        body: JSON.stringify({ sql_query: sql })
      });

      if (!response.ok) {
        // Try alternative: use pg connection if available
        // For now, print the SQL for manual execution
        console.log(`  ⚠ Cannot execute via API. Please run manually in Supabase SQL Editor.`);
        continue;
      }

      console.log(`  ✓ Completed`);
    } catch (error) {
      console.log(`  ⚠ Error: ${error.message}`);
      console.log(`  Please run this migration manually in Supabase SQL Editor.`);
    }
  }

  console.log('\n✓ Migration process complete!');
  console.log('\nIf any migrations failed, please run them manually:');
  console.log('1. Go to https://supabase.com/dashboard');
  console.log('2. Open your project > SQL Editor');
  console.log('3. Copy and paste each migration file content');
}

// Alternative: Print all SQL for manual execution
async function printMigrations() {
  console.log('='.repeat(60));
  console.log('DATABASE MIGRATIONS - Copy and run in Supabase SQL Editor');
  console.log('='.repeat(60));
  console.log('\nGo to: https://supabase.com/dashboard > Your Project > SQL Editor\n');

  const files = fs.readdirSync(migrationsDir)
    .filter(f => f.endsWith('.sql'))
    .sort();

  for (const file of files) {
    const filePath = path.join(migrationsDir, file);
    const sql = fs.readFileSync(filePath, 'utf8');

    console.log('\n' + '='.repeat(60));
    console.log(`-- FILE: ${file}`);
    console.log('='.repeat(60));
    console.log(sql);
  }
}

// Check command line args
const args = process.argv.slice(2);
if (args.includes('--print')) {
  printMigrations();
} else {
  runMigrations().catch(console.error);
}
