#!/usr/bin/env node
/**
 * Seed RFID card mappings for existing content packs.
 *
 * - Resolves pack_code -> rfid_content_pack.id
 * - Upserts mappings by rfid_uid
 * - Treats repeated UIDs as a single mapping
 */
require('dotenv').config();
const { Client } = require('pg');

const MAPPINGS = [
  { packCode: 'phonics', uids: ['66E49726', 'D6698C26', '56C7B726'] },
  { packCode: 'rhy_hin', uids: ['4699A526', '766A9D26', '46490E26'] },
  { packCode: 'rhy_kan', uids: ['26281026', 'D63A8A26', '66DD8D26'] },
  { packCode: 'rhy_eng', uids: ['3692A826', '96579426', 'D6F4A426'] },
  { packCode: 'rhy_tel', uids: ['568F3126', '46F54926', 'D6999626'] },
  { packCode: 'slokas', uids: ['46BB8726', 'A61C4B26', '26A91226', 'A6C46126', '264FA426'] },
  { packCode: 'bhagavad', uids: ['E6369326', 'C6CF9326', 'E6381326'] },
  { packCode: 'sty_fry', uids: ['A6F3A226', '56929826', '46B49526'] },
  { packCode: 'sty_fan', uids: ['C6E78326', 'D635A926', '36379826'] },
  { packCode: 'Stry_adv', uids: ['D60A3826', '96D49B26', 'E6E75B26'] },
  { packCode: 'sty_bed', uids: ['F61C5826', 'E6979526', '96C29126', 'F61C5826'] },
];

function normalizeConnectionString(rawUrl) {
  if (!rawUrl) return '';
  return rawUrl
    .replace(/([?&])sslmode=[^&]*/g, '$1')
    .replace(/\?&/g, '?')
    .replace(/[?&]$/g, '');
}

function normalizeUid(uid) {
  return String(uid || '')
    .trim()
    .toUpperCase()
    .replace(/[:-]/g, '');
}

async function main() {
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

    const summary = [];

    for (const mapping of MAPPINGS) {
      const packResult = await client.query(
        'select id, pack_code from rfid_content_pack where pack_code = $1 limit 1',
        [mapping.packCode]
      );

      if (packResult.rows.length === 0) {
        throw new Error(`Content pack not found for pack_code=${mapping.packCode}`);
      }

      const packId = packResult.rows[0].id;
      const uniqueUids = [...new Set(mapping.uids.map(normalizeUid).filter(Boolean))];

      for (const uid of uniqueUids) {
        const existing = await client.query(
          'select id from rfid_card_mapping where rfid_uid = $1 limit 1',
          [uid]
        );

        if (existing.rows.length > 0) {
          await client.query(
            `update rfid_card_mapping
                set pack_id = null,
                    question_id = null,
                    content_pack_id = $2,
                    action_type = null,
                    action_data = '{}'::jsonb,
                    card_type = 'content',
                    notes = null,
                    active = true,
                    status = 1,
                    updater = null,
                    update_date = now()
              where id = $1`,
            [existing.rows[0].id, packId]
          );
        } else {
          await client.query(
            `insert into rfid_card_mapping
               (rfid_uid, pack_id, question_id, content_pack_id, action_type, action_data, card_type, notes, active, status, creator, create_date, updater, update_date)
             values
               ($1, null, null, $2, null, '{}'::jsonb, 'content', null, true, 1, null, now(), null, now())`,
            [uid, packId]
          );
        }
      }

      summary.push({
        packCode: mapping.packCode,
        packId,
        mappedUids: uniqueUids.length,
      });
    }

    await client.query('COMMIT');
    console.log(JSON.stringify({ mappedPacks: summary }, null, 2));
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(`Failed to seed RFID card mappings: ${error.message}`);
  process.exit(1);
});
