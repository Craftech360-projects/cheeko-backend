/**
 * Migration Script: MySQL (Railway) to Supabase
 *
 * Copies content data from Railway MySQL to Supabase content_library table
 *
 * Usage:
 *   cd main/manager-api-node
 *   npm install mysql2  (if not already installed)
 *   node scripts/migrate-mysql-to-supabase.js
 *
 * Environment variables needed:
 *   - SUPABASE_URL
 *   - SUPABASE_SERVICE_ROLE_KEY
 */

const mysql = require('mysql2/promise');
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

// MySQL Configuration (Railway)
const MYSQL_CONFIG = {
  host: 'nozomi.proxy.rlwy.net',
  port: 25037,
  database: 'railway',
  user: 'root',
  password: 'OcaVNLKcwNdyElfaeUPqvvfYZiiEHgdm',
  ssl: { rejectUnauthorized: false }
};

// Supabase Configuration
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY environment variables');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function migrateContentItems(mysqlConnection) {
  console.log('\n--- Migrating Content Items ---');

  const [rows] = await mysqlConnection.query('SELECT * FROM content_items');
  console.log(`Found ${rows.length} content items in MySQL`);

  if (rows.length === 0) return 0;

  // Supabase content_library schema:
  // id, content_type, title, description, url, thumbnail_url, duration_seconds,
  // category, tags, age_min, age_max, language, metadata, status, created_at, updated_at
  const contentItems = rows.map(row => ({
    title: row.title,
    content_type: row.content_type || 'music',
    description: row.romanized || null,
    url: row.file_url || null,
    thumbnail_url: row.thumbnail_url || null,
    duration_seconds: row.duration_seconds || null,
    category: row.category || null,
    tags: row.alternatives || [],
    language: 'en',
    metadata: { filename: row.filename, romanized: row.romanized },
    status: 1
  }));

  // Insert in batches of 100
  let inserted = 0;
  for (let i = 0; i < contentItems.length; i += 100) {
    const batch = contentItems.slice(i, i + 100);
    const { data, error } = await supabase
      .from('content_library')
      .insert(batch)
      .select();

    if (error) {
      console.error(`Error inserting batch ${i}:`, error.message);
      // Try inserting one by one to find problematic records
      for (const item of batch) {
        const { error: singleError } = await supabase
          .from('content_library')
          .insert(item);
        if (singleError) {
          console.error(`  Failed to insert: ${item.title} - ${singleError.message}`);
        } else {
          inserted++;
        }
      }
    } else {
      inserted += batch.length;
      console.log(`Inserted batch ${Math.floor(i/100) + 1}: ${batch.length} items`);
    }
  }

  return inserted;
}

async function migrateStories(mysqlConnection) {
  console.log('\n--- Migrating Stories ---');

  const [rows] = await mysqlConnection.query('SELECT * FROM ai_story WHERE status = 1');
  console.log(`Found ${rows.length} story items in MySQL`);

  if (rows.length === 0) return 0;

  const contentItems = rows.map(row => ({
    title: row.title,
    romanized: row.romanized || null,
    filename: row.file_name || row.filename || null,
    content_type: 'story',
    category: row.category || row.age_group || null,
    alternatives: row.alternatives ? (typeof row.alternatives === 'string' ? JSON.parse(row.alternatives) : row.alternatives) : [],
    aws_s3_url: row.audio_url || row.file_url || row.url || null,
    duration_seconds: row.duration || null,
    file_size_bytes: row.file_size || null,
    status: 1,
    created_at: row.created_at || new Date().toISOString(),
    updated_at: row.updated_at || new Date().toISOString()
  }));

  // Insert in batches of 100
  let inserted = 0;
  for (let i = 0; i < contentItems.length; i += 100) {
    const batch = contentItems.slice(i, i + 100);
    const { data, error } = await supabase
      .from('content_library')
      .insert(batch)
      .select();

    if (error) {
      console.error(`Error inserting story batch ${i}:`, error.message);
      // Try inserting one by one
      for (const item of batch) {
        const { error: singleError } = await supabase
          .from('content_library')
          .insert(item);
        if (singleError) {
          console.error(`  Failed to insert: ${item.title} - ${singleError.message}`);
        } else {
          inserted++;
        }
      }
    } else {
      inserted += batch.length;
      console.log(`Inserted story batch ${Math.floor(i/100) + 1}: ${batch.length} items`);
    }
  }

  return inserted;
}

async function migrateTextbooks(mysqlConnection) {
  console.log('\n--- Migrating Textbooks ---');

  try {
    const [rows] = await mysqlConnection.query('SELECT * FROM ai_textbook WHERE status = 1');
    console.log(`Found ${rows.length} textbook items in MySQL`);

    if (rows.length === 0) return 0;

    const contentItems = rows.map(row => ({
      title: row.title,
      romanized: null,
      filename: null,
      content_type: 'textbook',
      category: row.subject || row.grade || null,
      alternatives: [],
      aws_s3_url: row.cover_url || null,
      duration_seconds: null,
      file_size_bytes: null,
      status: 1,
      created_at: row.created_at || new Date().toISOString(),
      updated_at: row.updated_at || new Date().toISOString()
    }));

    // Insert in batches of 100
    let inserted = 0;
    for (let i = 0; i < contentItems.length; i += 100) {
      const batch = contentItems.slice(i, i + 100);
      const { data, error } = await supabase
        .from('content_library')
        .insert(batch)
        .select();

      if (error) {
        console.error(`Error inserting textbook batch ${i}:`, error.message);
      } else {
        inserted += batch.length;
        console.log(`Inserted textbook batch ${Math.floor(i/100) + 1}: ${batch.length} items`);
      }
    }

    return inserted;
  } catch (err) {
    console.log('No ai_textbook table found or error:', err.message);
    return 0;
  }
}

async function showMySQLTables(mysqlConnection) {
  console.log('\n--- MySQL Tables ---');
  const [tables] = await mysqlConnection.query('SHOW TABLES');
  console.log('Available tables:');
  tables.forEach(t => {
    const tableName = Object.values(t)[0];
    console.log(`  - ${tableName}`);
  });
  return tables;
}

async function showMusicSchema(mysqlConnection) {
  console.log('\n--- ai_music Schema ---');
  try {
    const [columns] = await mysqlConnection.query('DESCRIBE ai_music');
    columns.forEach(col => {
      console.log(`  ${col.Field}: ${col.Type}`);
    });
  } catch (err) {
    console.log('Could not describe ai_music:', err.message);
  }
}

async function showStorySchema(mysqlConnection) {
  console.log('\n--- ai_story Schema ---');
  try {
    const [columns] = await mysqlConnection.query('DESCRIBE ai_story');
    columns.forEach(col => {
      console.log(`  ${col.Field}: ${col.Type}`);
    });
  } catch (err) {
    console.log('Could not describe ai_story:', err.message);
  }
}

async function previewData(mysqlConnection) {
  console.log('\n--- Preview Data ---');

  try {
    const [contentSample] = await mysqlConnection.query('SELECT * FROM content_items LIMIT 3');
    console.log('\nSample content_items data:');
    console.log(JSON.stringify(contentSample, null, 2));

    const [countResult] = await mysqlConnection.query('SELECT COUNT(*) as total FROM content_items');
    console.log(`\nTotal content_items: ${countResult[0].total}`);

    const [typeCount] = await mysqlConnection.query('SELECT content_type, COUNT(*) as count FROM content_items GROUP BY content_type');
    console.log('\nBy content_type:');
    typeCount.forEach(t => console.log(`  ${t.content_type}: ${t.count}`));
  } catch (err) {
    console.log('Could not preview content_items:', err.message);
  }
}

async function main() {
  console.log('='.repeat(60));
  console.log('MySQL to Supabase Content Migration');
  console.log('='.repeat(60));

  let mysqlConnection;

  try {
    // Connect to MySQL
    console.log('\nConnecting to MySQL (Railway)...');
    mysqlConnection = await mysql.createConnection(MYSQL_CONFIG);
    console.log('Connected to MySQL successfully!');

    // Show available tables
    await showMySQLTables(mysqlConnection);

    // Show schemas
    await showMusicSchema(mysqlConnection);
    await showStorySchema(mysqlConnection);

    // Preview some data
    await previewData(mysqlConnection);

    // Ask for confirmation (in a real scenario, you might want to add readline here)
    console.log('\n--- Starting Migration ---');

    // Migrate data from content_items table
    const contentCount = await migrateContentItems(mysqlConnection);

    console.log('\n' + '='.repeat(60));
    console.log('Migration Summary:');
    console.log('='.repeat(60));
    console.log(`  Content items migrated: ${contentCount}`);
    console.log('='.repeat(60));

  } catch (error) {
    console.error('Migration failed:', error.message);
    console.error(error);
  } finally {
    if (mysqlConnection) {
      await mysqlConnection.end();
      console.log('\nMySQL connection closed.');
    }
  }
}

main();
