/**
 * Seed or replace an RFID content pack from an ordered list of file names.
 *
 * Usage:
 *   node scripts/seed-rfid-pack-from-files.js ^
 *     --pack-code=bhagavad ^
 *     --name=bhagavad ^
 *     --folder=BhagavadGita ^
 *     --language=en ^
 *     --files="Bhagavad Gita Episode 1.mp3|Bhagavad Gita Episode 2.mp3"
 *
 * Notes:
 * - This script writes directly to `rfid_content_pack` and `content_item`.
 * - If the pack already exists, it updates the pack row and replaces all items.
 * - File order in `--files` is preserved as `item_number`.
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

function splitFiles(rawFiles) {
  return rawFiles
    .split('|')
    .map((value) => value.trim())
    .filter(Boolean);
}

function buildAudioUrl(cdnBase, folder, fileName) {
  const encodedFolder = folder
    .split('/')
    .map((part) => encodeURIComponent(part))
    .join('/');
  return `${cdnBase.replace(/\/$/, '')}/${encodedFolder}/${encodeURIComponent(fileName)}`;
}

async function main() {
  const packCode = requireArg('pack-code');
  const name = getArg('name') || packCode;
  const folder = requireArg('folder');
  const language = getArg('language') || 'en';
  const contentType = getArg('content-type') || 'rfidcontent';
  const version = Number(getArg('version') || '1');
  const status = getArg('status') || 'active';
  const cdnBase = getArg('cdn-base') || `https://${process.env.CLOUDFRONT_DOMAIN || 'dsmzc13oafp54.cloudfront.net'}/music`;
  const files = splitFiles(requireArg('files'));

  if (!Number.isInteger(version) || version < 1) {
    throw new Error('--version must be a positive integer');
  }
  if (files.length === 0) {
    throw new Error('No files provided in --files');
  }

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

    const existingPack = await client.query(
      'select id from rfid_content_pack where pack_code = $1 limit 1',
      [packCode]
    );

    let packId;
    if (existingPack.rows.length > 0) {
      packId = existingPack.rows[0].id;
      await client.query(
        `update rfid_content_pack
            set name = $2,
                content_type = $3,
                language = $4,
                status = $5,
                version = $6,
                total_items = $7,
                updater = null,
                update_date = now()
          where id = $1`,
        [packId, name, contentType, language, status, version, files.length]
      );
      await client.query('delete from content_item where content_pack_id = $1', [packId]);
    } else {
      const insertPack = await client.query(
        `insert into rfid_content_pack
           (pack_code, name, content_type, language, status, version, total_items, creator, create_date, updater, update_date)
         values
           ($1, $2, $3, $4, $5, $6, $7, null, now(), null, now())
         returning id`,
        [packCode, name, contentType, language, status, version, files.length]
      );
      packId = insertPack.rows[0].id;
    }

    for (let index = 0; index < files.length; index += 1) {
      const fileName = files[index];
      const title = fileName.replace(/\.mp3$/i, '');
      const audioUrl = buildAudioUrl(cdnBase, folder, fileName);

      await client.query(
        `insert into content_item
           (content_pack_id, item_number, title, description, audio_url, audio_size_bytes, audio_duration_ms,
            images_json, image_url, lyrics_text, content_text, active, creator, create_date, updater, update_date,
            story_number, story_title)
         values
           ($1, $2, $3, null, $4, null, null,
            null, null, null, null, true, null, now(), null, now(),
            null, null)`,
        [packId, index + 1, title, audioUrl]
      );
    }

    await client.query('COMMIT');

    console.log(
      JSON.stringify(
        {
          packId,
          packCode,
          name,
          folder,
          language,
          totalItems: files.length,
        },
        null,
        2
      )
    );
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(`Failed to seed RFID pack: ${error.message}`);
  process.exit(1);
});
