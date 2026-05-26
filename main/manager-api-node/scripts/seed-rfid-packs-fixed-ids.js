/**
 * Seed the 12 RFID content packs created in this repo into another database
 * using the exact same `rfid_content_pack.id` values and CloudFront links.
 *
 * Usage:
 *   node scripts/seed-rfid-packs-fixed-ids.js
 *
 * Behavior:
 * - Reads DIRECT_URL or DATABASE_URL from .env
 * - Verifies whether the target pack IDs are already occupied by different packs
 * - Upserts each pack with the fixed ID and pack_code
 * - Replaces all content_item rows for each pack
 * - Advances the rfid_content_pack/content_item sequences to avoid future collisions
 */
require('dotenv').config();
const { Client } = require('pg');

const CDN_BASE = `https://${process.env.CLOUDFRONT_DOMAIN || 'dsmzc13oafp54.cloudfront.net'}/music`;

const PACKS = [
  {
    id: 53,
    packCode: 'rhy_eng',
    name: 'rhy_eng',
    folder: 'English',
    language: 'en',
    files: [
      'ABC Song.mp3',
      'Baa Baa Black Sheep.mp3',
      'Baby Shark Dance.mp3',
      'Bingo.mp3',
      'Five Little Monkeys Jumping On The Bed.mp3',
      'Five Little Piggies Jumping On The Bed.mp3',
      'Happy.mp3',
      'Head Shoulders Knees and Toes.mp3',
      'Hickory.mp3',
      'Hokey.mp3',
      'Hush Baby.mp3',
      "I'm A Little Teapot.mp3",
      'Johny Johny Yes Papa.mp3',
      'Mary Lamb.mp3',
      'Old MacDonald.mp3',
      'Once I Caught A Fish Alive.mp3',
      'One Two.mp3',
      'River Woods.mp3',
      'Row Your Boat.mp3',
      'Sleeping.mp3',
      'Ten Little Dinos.mp3',
      'The Wheels on the Bus.mp3',
      'Twinkle Twinkle Little Star.mp3',
    ],
  },
  {
    id: 54,
    packCode: 'rhy_kan',
    name: 'rhy_kan',
    folder: 'Kannada',
    language: 'kn',
    files: [
      'Aane banthondu Aane.mp3',
      'Indu maṅgaḷavāra.mp3',
      'Iruve Iruve.mp3',
      'Kothi Mattu Bale Hannu Haadu .mp3',
      'Namma Maneyali.mp3',
      'Nayi mari Nayi mari Tindi beke.mp3',
      'Thotake Hogu Timma.mp3',
      'nanna hasu, nanna hasu.mp3',
    ],
  },
  {
    id: 55,
    packCode: 'rhy_hin',
    name: 'rhy_hin',
    folder: 'Hindi',
    language: 'hi',
    files: [
      'Bandar Mama Aur Kele.mp3',
      'Bum Bum Bole.mp3',
      'Chidiya Rani Badi Sayani.mp3',
      'Hanuman Chalisa .mp3',
      'Happy New Year Song.mp3',
      'Hathi Raja Kahan Chale.mp3',
      'Lakdi Ki Kathi.mp3',
      'Titli Udi Ud Na Saki.mp3',
    ],
  },
  {
    id: 56,
    packCode: 'rhy_tel',
    name: 'rhy_tel',
    folder: 'Telugu',
    language: 'te',
    files: [
      'Bava Bava Panneeru.mp3',
      'Chanda mama raave.mp3',
      'Enugamma Enugu.mp3',
      'I am a Very Good Girl.mp3',
      'chitti chilakamma.mp3',
    ],
  },
  {
    id: 57,
    packCode: 'phonics',
    name: 'phonics',
    folder: 'Phonics',
    language: 'en',
    files: [
      'A For Apple , B For Ball, C For Cat.mp3',
      'Fun! Learning ABC For Kindergart.mp3',
    ],
  },
  {
    id: 58,
    packCode: 'slokas',
    name: 'slokas',
    folder: 'Slokas',
    language: 'en',
    files: [
      'Ganesh Pujan.mp3',
      'Guru Brahma Guru Vishnu.mp3',
      'Guru Vandana.mp3',
      'Hanuman Smaran.mp3',
      'Hanuman Stuti.mp3',
      'Prarthana.mp3',
      'Ram Vandana.mp3',
      'Saraswati Stuti.mp3',
      'Shanti Mantra.mp3',
      'Vishnu Dyan.mp3',
      'Vishnu Stuti.mp3',
    ],
  },
  {
    id: 60,
    packCode: 'bhagavad',
    name: 'bhagavad',
    folder: 'BhagavadGita',
    language: 'en',
    files: [
      'Bhagavad Gita Episode 1.mp3',
      'Bhagavad Gita Episode 2.mp3',
      'Bhagavad Gita Episode 3.mp3',
      'Bhagavad Gita Episode 4.mp3',
      'Bhagavad Gita Episode 5.mp3',
      'Bhagavad Gita Episode 6.mp3',
      'Bhagavad Gita Episode 7.mp3',
      'Bhagavad Gita Episode 8.mp3',
      'Bhagavad Gita Episode 9.mp3',
      'Bhagavad Gita Episode 10.mp3',
      'Bhagavad Gita Episode 11.mp3',
      'Bhagavad Gita Episode 12.mp3',
      'Bhagavad Gita Episode 13.mp3',
      'Bhagavad Gita Episode 14.mp3',
      'Bhagavad Gita Episode 15.mp3',
      'Bhagavad Gita Episode 16.mp3',
      'Bhagavad Gita Episode 17.mp3',
      'Bhagavad Gita Episode 18.mp3',
      'Bhagavad Gita Episode 19.mp3',
      'Bhagavad Gita Episode 20.mp3',
    ],
  },
  {
    id: 61,
    packCode: 'Stry_adv',
    name: 'Stry_adv',
    folder: 'Stories/Adventure',
    language: 'en',
    files: [
      'Sherlock Holmes The Mystery of the Missing Colors.mp3',
      'The Boy Who Cried Wolf.mp3',
      'The Enchanted Adventure.mp3',
      "Twinkle and Glimmer's Adventure.mp3",
    ],
  },
  {
    id: 62,
    packCode: 'sty_bed',
    name: 'sty_bed',
    folder: 'Stories/Bedtime',
    language: 'en',
    files: [
      'A Golden Gift.mp3',
      'BEANS MAKE YOU FAST.mp3',
      'Invincible Warrior.mp3',
      'honest jack.mp3',
      'princesspea-shorter.mp3',
    ],
  },
  {
    id: 63,
    packCode: 'sty_edu',
    name: 'sty_edu',
    folder: 'Stories/Educational',
    language: 'en',
    files: [
      'My Little Sister Taught Me Patience.mp3',
      'THE WISE CHILD.mp3',
      'The Arrogant Rose.mp3',
      'The Magic Of Sharing.mp3',
      'The Secret of the Wooden Box  Stories.mp3',
      'Two Lazy Brothers.mp3',
    ],
  },
  {
    id: 64,
    packCode: 'sty_fan',
    name: 'sty_fan',
    folder: 'Stories/Fantasy',
    language: 'en',
    files: [
      'The Wind and the Sun.mp3',
      'emperor new clothes.mp3',
      'king of apes.mp3',
      'thrushbeard.mp3',
    ],
  },
  {
    id: 65,
    packCode: 'sty_fry',
    name: 'sty_fry',
    folder: 'Stories/Fairy Tales',
    language: 'en',
    files: [
      'THE PRINCESS AND THE SALT.mp3',
      'hansel and gretel.mp3',
      'leap frog.mp3',
      'snow white shorter.mp3',
    ],
  },
];

function normalizeConnectionString(rawUrl) {
  if (!rawUrl) return '';
  return rawUrl
    .replace(/([?&])sslmode=[^&]*/g, '$1')
    .replace(/\?&/g, '?')
    .replace(/[?&]$/g, '');
}

function buildAudioUrl(folder, fileName) {
  const encodedFolder = folder
    .split('/')
    .map((part) => encodeURIComponent(part))
    .join('/');
  return `${CDN_BASE}/${encodedFolder}/${encodeURIComponent(fileName)}`;
}

async function assertNoIdConflicts(client) {
  const ids = PACKS.map((pack) => pack.id);
  const result = await client.query(
    'select id, pack_code from rfid_content_pack where id = any($1::bigint[]) order by id',
    [ids]
  );

  const conflicts = result.rows.filter((row) => {
    const expected = PACKS.find((pack) => pack.id === Number(row.id));
    return expected && expected.packCode !== row.pack_code;
  });

  if (conflicts.length > 0) {
    const details = conflicts
      .map((row) => {
        const expected = PACKS.find((pack) => pack.id === Number(row.id));
        return `id ${row.id}: found ${row.pack_code}, expected ${expected.packCode}`;
      })
      .join('; ');
    throw new Error(`Target DB already uses one or more fixed pack IDs for different packs: ${details}`);
  }
}

async function upsertPack(client, pack) {
  const existingByCode = await client.query(
    'select id from rfid_content_pack where pack_code = $1 limit 1',
    [pack.packCode]
  );

  if (existingByCode.rows.length > 0 && Number(existingByCode.rows[0].id) !== pack.id) {
    throw new Error(
      `Pack code ${pack.packCode} already exists with id ${existingByCode.rows[0].id}, expected ${pack.id}`
    );
  }

  const existingById = await client.query(
    'select id from rfid_content_pack where id = $1 limit 1',
    [pack.id]
  );

  if (existingById.rows.length > 0) {
    await client.query(
      `update rfid_content_pack
          set pack_code = $2,
              name = $3,
              content_type = $4,
              language = $5,
              status = $6,
              version = $7,
              total_items = $8,
              updater = null,
              update_date = now()
        where id = $1`,
      [pack.id, pack.packCode, pack.name, 'rfidcontent', pack.language, 'active', 1, pack.files.length]
    );
  } else {
    await client.query(
      `insert into rfid_content_pack
         (id, pack_code, name, content_type, language, status, version, total_items, creator, create_date, updater, update_date)
       values
         ($1, $2, $3, $4, $5, $6, $7, $8, null, now(), null, now())`,
      [pack.id, pack.packCode, pack.name, 'rfidcontent', pack.language, 'active', 1, pack.files.length]
    );
  }

  await client.query('delete from content_item where content_pack_id = $1', [pack.id]);

  for (let index = 0; index < pack.files.length; index += 1) {
    const fileName = pack.files[index];
    const title = fileName.replace(/\.mp3$/i, '');
    const audioUrl = buildAudioUrl(pack.folder, fileName);

    await client.query(
      `insert into content_item
         (content_pack_id, item_number, title, description, audio_url, audio_size_bytes, audio_duration_ms,
          images_json, image_url, lyrics_text, content_text, active, creator, create_date, updater, update_date,
          story_number, story_title)
       values
         ($1, $2, $3, null, $4, null, null,
          null, null, null, null, true, null, now(), null, now(),
          null, null)`,
      [pack.id, index + 1, title, audioUrl]
    );
  }
}

async function syncSequences(client) {
  await client.query(`
    select setval(
      pg_get_serial_sequence('rfid_content_pack', 'id'),
      coalesce((select max(id) from rfid_content_pack), 1),
      true
    )
  `);

  await client.query(`
    select setval(
      pg_get_serial_sequence('content_item', 'id'),
      coalesce((select max(id) from content_item), 1),
      true
    )
  `);
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
    await assertNoIdConflicts(client);

    for (const pack of PACKS) {
      await upsertPack(client, pack);
    }

    await syncSequences(client);
    await client.query('COMMIT');

    console.log(
      JSON.stringify(
        {
          totalPacks: PACKS.length,
          packCodes: PACKS.map((pack) => `${pack.id}:${pack.packCode}`),
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
  console.error(`Failed to seed fixed-ID RFID packs: ${error.message}`);
  process.exit(1);
});
