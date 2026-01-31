#!/usr/bin/env node
/**
 * Reset RFID Tables Script
 * 
 * Drops all RFID-related tables to clear data before re-running setup.
 */

require('dotenv').config();
const { Pool } = require('pg');

const DROP_SQL = `
DROP TABLE IF EXISTS rfid_card_mapping CASCADE;
DROP TABLE IF EXISTS rfid_series CASCADE;
DROP TABLE IF EXISTS content_item CASCADE;
DROP TABLE IF EXISTS rfid_content_pack CASCADE;
DROP TABLE IF EXISTS rfid_question_pack CASCADE;
DROP TABLE IF EXISTS rfid_pack CASCADE;
DROP TABLE IF EXISTS rfid_question CASCADE;
`;

async function main() {
    console.log('\n🗑️  Clearing RFID Data...\n');
    console.log('═'.repeat(60));

    if (!process.env.DATABASE_URL) {
        console.error('❌ DATABASE_URL environment variable is missing.');
        process.exit(1);
    }

    const pool = new Pool({
        connectionString: process.env.DATABASE_URL,
        ssl: { rejectUnauthorized: false }
    });

    try {
        console.log('Connecting to database...');
        const client = await pool.connect();

        console.log('Running DROP statements...');
        await client.query(DROP_SQL);

        console.log('✅ All RFID tables dropped successfully!');
        client.release();
    } catch (error) {
        console.error('❌ Error clearing tables:', error.message);
    } finally {
        await pool.end();
    }
}

main().catch(console.error);
