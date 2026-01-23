#!/usr/bin/env node
/**
 * Database Connection Test Script
 *
 * Tests the PostgreSQL connection using the configured credentials.
 * Run: node scripts/test-db.js
 */

require('dotenv').config();

const { Pool } = require('pg');

console.log('\n🔍 Database Connection Test\n');
console.log('═'.repeat(60));

// Check environment variables
const envVars = {
  'DATABASE_URL': process.env.DATABASE_URL ? '✓ Set' : '✗ Not set',
  'SUPABASE_URL': process.env.SUPABASE_URL ? '✓ Set' : '✗ Not set',
  'SUPABASE_DB_PASSWORD': process.env.SUPABASE_DB_PASSWORD ? '✓ Set' : '✗ Not set',
  'DB_HOST': process.env.DB_HOST ? '✓ Set' : '✗ Not set',
  'DB_PASSWORD': process.env.DB_PASSWORD ? '✓ Set' : '✗ Not set'
};

console.log('\nEnvironment Variables:');
Object.entries(envVars).forEach(([key, value]) => {
  console.log(`  ${key}: ${value}`);
});

// Determine connection method
let connectionMethod = null;
let pool = null;

if (process.env.DATABASE_URL) {
  connectionMethod = 'DATABASE_URL';
  pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_SSL === 'false' ? false : { rejectUnauthorized: false }
  });
} else if (process.env.SUPABASE_URL && process.env.SUPABASE_DB_PASSWORD) {
  connectionMethod = 'Supabase Pooler';
  const match = process.env.SUPABASE_URL.match(/https:\/\/([^.]+)\.supabase\.co/);
  if (match) {
    const projectRef = match[1];
    const regions = ['aws-0-ap-south-1', 'aws-0-us-east-1', 'aws-0-eu-west-1'];
    const region = process.env.SUPABASE_REGION || regions[0];

    const connectionString = `postgresql://postgres.${projectRef}:${encodeURIComponent(process.env.SUPABASE_DB_PASSWORD)}@${region}.pooler.supabase.com:6543/postgres`;

    console.log(`\nProject Ref: ${projectRef}`);
    console.log(`Region: ${region}`);

    pool = new Pool({
      connectionString,
      ssl: { rejectUnauthorized: false }
    });
  }
} else if (process.env.DB_HOST && process.env.DB_PASSWORD) {
  connectionMethod = 'Individual Parameters';
  pool = new Pool({
    host: process.env.DB_HOST,
    port: parseInt(process.env.DB_PORT || '5432'),
    database: process.env.DB_NAME || 'postgres',
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD,
    ssl: process.env.DATABASE_SSL === 'false' ? false : { rejectUnauthorized: false }
  });
}

console.log(`\nConnection Method: ${connectionMethod || 'None configured'}`);
console.log('═'.repeat(60));

if (!pool) {
  console.log('\n❌ No valid database configuration found!\n');
  console.log('Please configure one of the following in your .env file:\n');
  console.log('Option 1: DATABASE_URL (recommended)');
  console.log('  DATABASE_URL=postgresql://user:password@host:5432/database\n');
  console.log('Option 2: Supabase credentials');
  console.log('  SUPABASE_URL=https://xxxxx.supabase.co');
  console.log('  SUPABASE_DB_PASSWORD=your-database-password');
  console.log('  (Find in Supabase Dashboard > Settings > Database > Connection string)\n');
  console.log('Option 3: Individual parameters');
  console.log('  DB_HOST=your-host');
  console.log('  DB_PASSWORD=your-password\n');
  process.exit(1);
}

async function testConnection() {
  console.log('\nTesting connection...\n');

  try {
    const client = await pool.connect();
    console.log('✅ Connection successful!\n');

    // Test basic query
    const result = await client.query('SELECT NOW() as time, current_database() as db');
    console.log(`Database: ${result.rows[0].db}`);
    console.log(`Server Time: ${result.rows[0].time}`);

    // Check if tables exist
    const tablesResult = await client.query(`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
      ORDER BY table_name
    `);

    console.log(`\nTables in public schema: ${tablesResult.rows.length}`);
    if (tablesResult.rows.length > 0) {
      tablesResult.rows.forEach(row => {
        console.log(`  - ${row.table_name}`);
      });
    } else {
      console.log('  (No tables found - run migrations)');
    }

    client.release();
    await pool.end();

    console.log('\n✅ All tests passed!\n');

  } catch (error) {
    console.log('❌ Connection failed!\n');
    console.log(`Error: ${error.message}`);

    if (error.code === 'ENOTFOUND') {
      console.log('\n💡 Host not found. Check your database host address.');
    } else if (error.code === 'ECONNREFUSED') {
      console.log('\n💡 Connection refused. Is the database server running?');
    } else if (error.code === '28P01') {
      console.log('\n💡 Authentication failed. Check your password.');
    } else if (error.code === '28000') {
      console.log('\n💡 No permission. Check your database user permissions.');
    } else if (error.message.includes('timeout')) {
      console.log('\n💡 Connection timeout. Check firewall/network settings.');
    }

    console.log('\nFor Supabase:');
    console.log('  1. Go to Supabase Dashboard > Settings > Database');
    console.log('  2. Copy the "Connection string" (URI format)');
    console.log('  3. Replace [YOUR-PASSWORD] with your database password');
    console.log('  4. Set it as DATABASE_URL in your .env file\n');

    try {
      await pool.end();
    } catch (e) {}

    process.exit(1);
  }
}

testConnection();
