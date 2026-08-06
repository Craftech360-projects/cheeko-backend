/**
 * Sync content_items (legacy DigitalOcean Postgres DB) → content_library
 * (production DigitalOcean Postgres DB, via this app's own Prisma client)
 * without creating duplicates.
 *
 * Also reports (and optionally cleans up) duplicate rows already sitting in
 * content_library from earlier non-idempotent runs.
 *
 * A row is considered the "same" as another when content_type + title +
 * (url or filename) match (case-insensitive, trimmed). content_library has
 * no unique constraint, so this identity check is done in application code
 * on every run.
 *
 * Writes go through this app's own Prisma client (src/config/database.js),
 * i.e. the same DigitalOcean Postgres database the live app and founder
 * dashboard read from — not a separate Supabase project.
 *
 * Usage:
 *   cd main/manager-api-node
 *   node scripts/sync-content-library-unique.js
 *   node scripts/sync-content-library-unique.js --delete-duplicates
 *
 * Flags:
 *   --delete-duplicates   Also delete extra rows within each duplicate
 *                         group already in content_library, keeping the
 *                         oldest. Off by default — the default run only
 *                         reports.
 *
 * Environment variables needed:
 *   - SOURCE_DATABASE_URL   Postgres connection string for the legacy DB
 *                           that holds content_items.
 *   - DATABASE_URL          Already required by this app (see .env) —
 *                           used implicitly via src/config/database.js.
 */

require('dotenv').config();

const { Pool } = require('pg');
const { prisma } = require('../src/config/database');

const DELETE_DUPLICATES = process.argv.includes('--delete-duplicates');

function loadSourcePool() {
  const sourceUrl = process.env.SOURCE_DATABASE_URL;
  if (!sourceUrl) {
    console.error('Missing required environment variable: SOURCE_DATABASE_URL');
    process.exit(1);
  }
  // Same SSL handling as src/config/database.js — DigitalOcean uses a
  // self-signed CA chain that Node's default TLS trust store rejects.
  return new Pool({ connectionString: sourceUrl, ssl: { rejectUnauthorized: false } });
}

function makeKey({ content_type, title, url, metadata }) {
  const identifier = (url || metadata?.filename || '').trim().toLowerCase();
  const normalizedTitle = (title || '').trim().toLowerCase();
  return `${content_type}::${normalizedTitle}::${identifier}`;
}

function mapSourceRow(row) {
  return {
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
    status: 1,
  };
}

async function fetchExistingLibrary() {
  return prisma.content_library.findMany({
    select: { id: true, content_type: true, title: true, url: true, metadata: true, created_at: true },
  });
}

function findDuplicateGroups(existingRows) {
  const byKey = new Map();
  for (const row of existingRows) {
    const key = makeKey(row);
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key).push(row);
  }

  return [...byKey.entries()]
    .filter(([, rows]) => rows.length > 1)
    .map(([key, rows]) => ({
      key,
      // oldest first, so index 0 is the one we keep
      rows: rows.sort((a, b) => new Date(a.created_at) - new Date(b.created_at)),
    }));
}

async function reportAndCleanDuplicates(existingRows) {
  const groups = findDuplicateGroups(existingRows);

  if (groups.length === 0) {
    console.log('No duplicate rows found in content_library.');
    return existingRows;
  }

  console.log(`\nFound ${groups.length} duplicate group(s) in content_library:`);
  for (const group of groups) {
    const ids = group.rows.map((r) => r.id.toString()).join(', ');
    console.log(`  "${group.rows[0].title}" (${group.rows[0].content_type}) — ${group.rows.length} copies, ids: ${ids}`);
  }

  if (!DELETE_DUPLICATES) {
    console.log('\nRun with --delete-duplicates to remove the extra copies (oldest of each group is kept).');
    return existingRows;
  }

  console.log('\nDeleting extra copies (keeping oldest per group)...');
  const idsToDelete = groups.flatMap((group) => group.rows.slice(1).map((r) => r.id));
  let deleted = 0;
  for (const id of idsToDelete) {
    try {
      await prisma.content_library.delete({ where: { id } });
      deleted++;
    } catch (error) {
      console.error(`  Failed to delete id ${id}: ${error.message}`);
    }
  }
  console.log(`Deleted ${deleted}/${idsToDelete.length} duplicate rows.`);

  const deletedIds = new Set(idsToDelete.map(String));
  return existingRows.filter((row) => !deletedIds.has(row.id.toString()));
}

async function syncContentItems(sourcePool, existingKeys) {
  console.log('\n--- Syncing Content Items ---');

  const { rows } = await sourcePool.query('SELECT * FROM content_items');
  console.log(`Found ${rows.length} content items in source DB`);

  const toInsert = [];
  let alreadySynced = 0;
  let duplicateInSource = 0;
  const seenInThisRun = new Set();

  for (const row of rows) {
    const mapped = mapSourceRow(row);
    const key = makeKey(mapped);

    if (existingKeys.has(key)) {
      alreadySynced++;
      continue;
    }
    if (seenInThisRun.has(key)) {
      duplicateInSource++;
      continue;
    }
    seenInThisRun.add(key);
    toInsert.push(mapped);
  }

  console.log(`  Already in content_library: ${alreadySynced}`);
  console.log(`  Duplicate within source: ${duplicateInSource}`);
  console.log(`  New items to insert: ${toInsert.length}`);

  let inserted = 0;
  for (let i = 0; i < toInsert.length; i += 100) {
    const batch = toInsert.slice(i, i + 100);
    try {
      const result = await prisma.content_library.createMany({ data: batch });
      inserted += result.count;
      console.log(`Inserted batch ${Math.floor(i / 100) + 1}: ${result.count} items`);
    } catch (error) {
      console.error(`Error inserting batch ${i}:`, error.message);
      for (const item of batch) {
        try {
          await prisma.content_library.create({ data: item });
          inserted++;
        } catch (singleError) {
          console.error(`  Failed to insert: ${item.title} - ${singleError.message}`);
        }
      }
    }
  }

  return inserted;
}

async function main() {
  console.log('='.repeat(60));
  console.log('Content Library Sync (duplicate-safe)');
  console.log('='.repeat(60));

  const sourcePool = loadSourcePool();

  try {
    console.log('\nFetching existing content_library rows...');
    let existingRows = await fetchExistingLibrary();
    console.log(`Found ${existingRows.length} existing rows.`);

    existingRows = await reportAndCleanDuplicates(existingRows);
    const existingKeys = new Set(existingRows.map(makeKey));

    const insertedCount = await syncContentItems(sourcePool, existingKeys);

    console.log('\n' + '='.repeat(60));
    console.log('Sync Summary:');
    console.log('='.repeat(60));
    console.log(`  New content items inserted: ${insertedCount}`);
    console.log('='.repeat(60));
  } catch (error) {
    console.error('Sync failed:', error.message);
    console.error(error);
  } finally {
    await sourcePool.end();
    await prisma.$disconnect();
  }
}

main();
