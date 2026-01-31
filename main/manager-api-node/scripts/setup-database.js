#!/usr/bin/env node
/**
 * Database Setup Script
 *
 * Generates SQL for Supabase SQL Editor or uses direct connection if available.
 * Run: node scripts/setup-database.js
 */

require('dotenv').config();

const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

const MIGRATIONS_SQL = fs.readFileSync(path.join(__dirname, 'complete-schema.sql'), 'utf8');

async function main() {
  console.log('\n🔧 Cheeko Database Setup\n');
  console.log('═'.repeat(60));

  // Try direct PostgreSQL connection first
  let pool = null;

  if (process.env.DATABASE_URL) {
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: { rejectUnauthorized: false }
    });
  }

  if (pool) {
    try {
      console.log('\nAttempting direct PostgreSQL connection...\n');
      const client = await pool.connect();
      console.log('✅ Connected! Running migrations...\n');

      await client.query(MIGRATIONS_SQL);

      console.log('✅ Database setup complete!\n');
      client.release();
      await pool.end();
      return;
    } catch (error) {
      console.log('❌ Direct connection failed:', error.message);
      console.log('\nFalling back to manual SQL...\n');
      try { await pool.end(); } catch (e) { }
    }
  }

  // Fallback: Generate SQL file for manual execution
  const outputPath = path.join(__dirname, '..', 'database-setup.sql');
  fs.writeFileSync(outputPath, MIGRATIONS_SQL);

  console.log('═'.repeat(60));
  console.log('\n📋 SQL file generated: database-setup.sql\n');
  console.log('To set up your database:\n');
  console.log('1. Go to https://supabase.com/dashboard');
  console.log('2. Open your project');
  console.log('3. Go to SQL Editor');
  console.log('4. Click "New Query"');
  console.log('5. Copy the contents of database-setup.sql and paste it');
  console.log('6. Click "Run" to execute\n');
  console.log('Or run this command to copy SQL to clipboard:');
  console.log('  type database-setup.sql | clip\n');
  console.log('═'.repeat(60));
}

main().catch(console.error);
