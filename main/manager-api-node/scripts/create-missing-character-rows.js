// Create ai_agent_template rows for characters an environment does not have yet.
//
// install-character-pack.js cannot do this. Its FOLDER_CODE maps these folders
// to a plain agent_code string, and the string branch SKIPS when the row is
// absent ("MISSING row for agent_code=..."). Flipping them back to the object
// form is not the fix either: the object branch skips once the row EXISTS, so
// Ginti and Tikku would stop receiving prompt updates everywhere they are
// already installed. Hence a separate one-off.
//
// After this runs, install-character-pack.js keeps owning the prompts — the
// rows exist, so its string branch updates them like everyone else's.
//
//   node scripts/create-missing-character-rows.js <pack-dir>
//   node scripts/create-missing-character-rows.js <pack-dir> --apply
//
// Model/voice wiring is copied from Cheeko so the session pipeline resolves.
// The VOICE IS A PLACEHOLDER: these characters will sound like Cheeko until a
// real voice is chosen per character. That is a product decision, not a
// deployment detail — pick voices before promoting them to children.
const fs = require('fs');
const path = require('path');
require('dotenv').config();
const { Client } = require('pg');

const PACK = process.argv[2];
const APPLY = process.argv.includes('--apply');
if (!PACK) {
  console.error('usage: node scripts/create-missing-character-rows.js <pack-dir> [--apply]');
  process.exit(1);
}

// pack folder -> { code, name } for rows that may need creating.
const WANT = [
  { folder: 'ginti', code: 'math_master', name: 'Ginti' },
  { folder: 'spell_bee', code: 'spell_master', name: 'Tikku' },
  { folder: 'vanya', code: 'forest_ranger', name: 'Vanya' },
];

const read = (p) => fs.readFileSync(p, 'utf8').trim();

(async () => {
  // Strip sslmode: newer pg treats 'require' as verify-full, which rejects the
  // managed provider's chain. Verification is set on the ssl option instead.
  const c = new Client({
    connectionString: (process.env.DATABASE_URL || '').replace(/[?&]sslmode=[^&]*/, ''),
    ssl: { rejectUnauthorized: false },
  });
  await c.connect();

  const donor = (await c.query("SELECT agent_code FROM ai_agent_template WHERE agent_code='Cheeko'")).rows[0];
  if (!donor) {
    console.error("REFUSING: no Cheeko row to copy model/voice wiring from.");
    await c.end();
    process.exit(1);
  }

  let created = 0;
  for (const w of WANT) {
    const dir = path.join(PACK, w.folder);
    if (!fs.existsSync(path.join(dir, 'agent.md'))) {
      console.log(`  ${w.code.padEnd(16)} SKIP - no ${w.folder}/ in the pack`);
      continue;
    }
    const exists = (await c.query('SELECT agent_name FROM ai_agent_template WHERE agent_code=$1', [w.code])).rows[0];
    if (exists) {
      console.log(`  ${w.code.padEnd(16)} exists as "${exists.agent_name}" - leaving to install-character-pack.js`);
      continue;
    }
    const [sys, soul, greet] = ['agent.md', 'soul.md', 'greeting.md'].map((f) => read(path.join(dir, f)));
    // Same guard install-character-pack.js uses: an unsubstituted scaffold slot
    // would overwrite the runtime's own template block.
    if (sys.includes('<!-- LANGUAGE -->')) {
      console.error(`  ${w.code.padEnd(16)} SKIP - system_prompt still carries the LANGUAGE slot`);
      continue;
    }
    if (!APPLY) {
      console.log(`  ${w.code.padEnd(16)} WOULD INSERT agent_name=${w.name} (sys=${sys.length} soul=${soul.length} greet=${greet.length}, models/voice from Cheeko)`);
      continue;
    }
    // is_visible=1 and sort pushed past Cheeko's, matching the installer's own
    // insert. No ON CONFLICT: agent_code carries no unique constraint, so there
    // is nothing for it to match. The existence check above is the guard, which
    // is sound for a hand-run one-off; a NOT EXISTS in the SELECT closes the
    // remaining gap if this ever runs unattended.
    const res = await c.query(
      'INSERT INTO ai_agent_template (agent_code, agent_name, system_prompt, soul, greeting_prompt, ' +
      '  asr_model_id, vad_model_id, llm_model_id, tts_model_id, tts_voice_id, sarvam_voice_id, elevenlabs_voice_id, ' +
      '  mem_model_id, intent_model_id, lang_code, language, chat_history_conf, is_visible, sort) ' +
      'SELECT $1, $2, $3, $4, $5, ' +
      '  asr_model_id, vad_model_id, llm_model_id, tts_model_id, tts_voice_id, sarvam_voice_id, elevenlabs_voice_id, ' +
      '  mem_model_id, intent_model_id, lang_code, language, chat_history_conf, 1, coalesce(sort,0)+100 ' +
      "FROM ai_agent_template WHERE agent_code='Cheeko' " +
      '  AND NOT EXISTS (SELECT 1 FROM ai_agent_template t WHERE t.agent_code=$1)',
      [w.code, w.name, sys, soul, greet]);
    console.log(res.rowCount === 1
      ? `  ${w.code.padEnd(16)} INSERTED as ${w.name}`
      : `  ${w.code.padEnd(16)} NOT INSERTED (row appeared concurrently) - re-run to inspect`);
    created += res.rowCount;
  }

  const all = (await c.query('SELECT agent_code, agent_name FROM ai_agent_template ORDER BY agent_code')).rows;
  console.log(`\n${APPLY ? `created ${created}; ` : 'DRY RUN ONLY - rerun with --apply\n'}${all.length} characters:`);
  all.forEach((r) => console.log(`  ${String(r.agent_code).padEnd(16)} ${r.agent_name}`));
  await c.end();
})().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
