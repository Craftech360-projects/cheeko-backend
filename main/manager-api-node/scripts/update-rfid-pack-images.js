#!/usr/bin/env node
/**
 * Update `content_item.image_url` for existing RFID content packs.
 *
 * Usage:
 *   node scripts/update-rfid-pack-images.js ^
 *     --updates="rhy_eng=https://.../englsih.bin|rhy_hin=https://.../hindi.bin"
 *
 * Notes:
 * - Updates every item in each matching pack to the same image URL.
 * - Leaves audio URLs, ordering, and pack metadata unchanged.
 */
require('dotenv').config();
const { Client } = require('pg');

function getArg(name) {
  const prefix = `--${name}=`;
  const arg = process.argv.find((value) => value.startsWith(prefix));
  return arg ? arg.slice(prefix.length) : null;
}

function requireArg(name) {
  const value = getArg(name);
  if (!value) {
    throw new Error(`Missing required argument --${name}=...`);
  }
  return value;
}

function normalizeConnectionString(rawUrl) {
  if (!rawUrl) return '';
  return rawUrl
    .replace(/([?&])sslmode=[^&]*/g, '$1')
    .replace(/\?&/g, '?')
    .replace(/[?&]$/g, '');
}

function parseUpdates(rawUpdates) {
  return rawUpdates
    .split('|')
    .map((value) => value.trim())
    .filter(Boolean)
    .map((entry) => {
      const separatorIndex = entry.indexOf('=');
      if (separatorIndex === -1) {
        throw new Error(`Invalid update entry "${entry}". Expected pack_code=url`);
      }
      const packCode = entry.slice(0, separatorIndex).trim();
      const imageUrl = entry.slice(separatorIndex + 1).trim();
      if (!packCode || !imageUrl) {
        throw new Error(`Invalid update entry "${entry}". Expected pack_code=url`);
      }
      return { packCode, imageUrl };
    });
}

async function main() {
  const updates = parseUpdates(requireArg('updates'));
  const connectionString = normalizeConnectionString(process.env.DIRECT_URL || process.env.DATABASE_URL);

  if (!connectionString) {
    throw new Error('DATABASE_URL or DIRECT_URL is required in .env');
  }

  const client = new Client({
    connectionString,
    ssl: { rejectUnauthorized: false },
  });

  await client.connect();

  try {
    await client.query('BEGIN');

    const results = [];

    for (const { packCode, imageUrl } of updates) {
      const packResult = await client.query(
        'select id from rfid_content_pack where pack_code = $1 limit 1',
        [packCode]
      );

      if (packResult.rows.length === 0) {
        throw new Error(`Pack not found: ${packCode}`);
      }

      const packId = packResult.rows[0].id;
      const updateResult = await client.query(
        `update content_item
            set image_url = $2,
                updater = null,
                update_date = now()
          where content_pack_id = $1`,
        [packId, imageUrl]
      );

      results.push({
        packCode,
        packId,
        imageUrl,
        updatedItems: updateResult.rowCount,
      });
    }

    await client.query('COMMIT');
    console.log(JSON.stringify({ updatedPacks: results }, null, 2));
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(`Failed to update RFID pack images: ${error.message}`);
  process.exit(1);
});
