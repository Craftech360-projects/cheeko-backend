// Install/update character prompts + quiz/riddle bank content from the
// "database import pack" folder. Dry-run by default; --apply to write.
//
// Follows the cheeko-character skill update pattern: full backup first, then
// guarded UPDATEs (before-image in the WHERE), so a row changed under us
// updates 0 rows and is reported instead of clobbered.
//
// ponytail: local-only guard is a hostname allowlist; extend EXPECTED_DB when
// this is deliberately pointed at the dev box's DB1.
const fs = require('fs');
const path = require('path');
require('dotenv').config();
const { Client } = require('pg');
const XLSX = require('xlsx');

const PACK = process.argv[2];
const APPLY = process.argv.includes('--apply');
if (!PACK) { console.error('usage: node scripts/install-character-pack.js <pack-dir> [--apply]'); process.exit(1); }

const EXPECTED_DB = ['shlrfpbqkfnxqcmuatvs']; // local project only, for now
if (!EXPECTED_DB.some((h) => (process.env.DATABASE_URL || '').includes(h))) {
  console.error('REFUSING: DATABASE_URL is not the local project. Edit EXPECTED_DB deliberately to target another DB.');
  process.exit(1);
}

// pack folder -> existing agent_code (object = insert as new row)
const FOLDER_CODE = {
  quizzy: 'quiz_master',
  bujho: 'riddle_master',
  cheeko: 'Cheeko',
  chanda: 'calm_companion',
  masti: 'masti',
  tara: 'science_buddy',
  nani: 'story_explorer',
  mitthu: 'word_wizard',
  ginti: { code: 'math_master', name: 'Ginti' },      // new
  spell_bee: { code: 'spell_master', name: 'Tikku' }, // new
};
const BANK_CSV = { quiz: 'quizzy/quizzy-questions.csv', riddle: 'bujho/bujho-riddles.csv' };
// Rows where the PACK is wrong and the DB is right. 6-8-L01-Q01-a8: the CSV's
// accepted_answers carries an authoring note ("saat? no - sixty"); DB is clean.
const SKIP_CODES = new Set(['6-8-L01-Q01-a8']);

const read = (p) => fs.readFileSync(p, 'utf8').replace(/\r\n/g, '\n').trim();
const pipes = (s) => String(s || '').split('|').map((x) => x.trim()).filter(Boolean);
const big = (k, v) => (typeof v === 'bigint' ? String(v) : v);

const readCsvRows = (file) => {
  const wb = XLSX.readFile(file, { raw: false });
  return XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: '' });
};

(async () => {
  const c = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  await c.connect();
  const stamp = new Date().toISOString().slice(0, 10);
  const bakDir = path.join(__dirname, '..', 'backups', 'character-pack-' + stamp);

  // ---- backup everything we may touch
  const rows = (await c.query('SELECT * FROM ai_agent_template')).rows;
  const banksBak = {};
  for (const [bank, table] of [['quiz', 'quiz_question'], ['riddle', 'riddle_question']]) {
    banksBak[bank] = (await c.query('SELECT * FROM ' + table + ' ORDER BY code')).rows;
  }
  if (APPLY) {
    fs.mkdirSync(bakDir, { recursive: true });
    fs.writeFileSync(path.join(bakDir, 'ai_agent_template.json'), JSON.stringify(rows, big, 2));
    for (const bank of Object.keys(banksBak)) {
      fs.writeFileSync(path.join(bakDir, bank + '_question.json'), JSON.stringify(banksBak[bank], big, 2));
    }
    console.log('backup -> ' + bakDir);
  }

  // ---- prompts
  for (const [folder, target] of Object.entries(FOLDER_CODE)) {
    const dir = path.join(PACK, folder);
    const [sys, soul, greet] = ['agent.md', 'soul.md', 'greeting.md'].map((f) => read(path.join(dir, f)));
    if (sys.includes('<!-- LANGUAGE -->')) { console.error('SKIP ' + folder + ': system_prompt contains the LANGUAGE slot (would replace the scaffold)'); continue; }

    if (typeof target === 'string') {
      const cur = rows.find((r) => r.agent_code === target);
      if (!cur) { console.error('MISSING row for agent_code=' + target + ' (' + folder + ')'); continue; }
      const same = (cur.system_prompt || '').trim() === sys && (cur.soul || '').trim() === soul && (cur.greeting_prompt || '').trim() === greet;
      if (same) { console.log(folder + ' (' + target + '): unchanged'); continue; }
      if (!APPLY) {
        console.log(folder + ' (' + target + '): WOULD UPDATE (sys ' + String(cur.system_prompt || '').length + '->' + sys.length +
          ', soul ' + String(cur.soul || '').length + '->' + soul.length +
          ', greet ' + String(cur.greeting_prompt || '').length + '->' + greet.length + ')');
        continue;
      }
      const res = await c.query(
        'UPDATE ai_agent_template SET system_prompt=$1, soul=$2, greeting_prompt=$3, updated_at=now() ' +
        'WHERE agent_code=$4 AND system_prompt IS NOT DISTINCT FROM $5 AND soul IS NOT DISTINCT FROM $6 AND greeting_prompt IS NOT DISTINCT FROM $7',
        [sys, soul, greet, target, cur.system_prompt, cur.soul, cur.greeting_prompt]);
      console.log(res.rowCount === 1 ? folder + ' (' + target + '): UPDATED' : folder + ' (' + target + '): GUARD FAILED - row changed under us, re-dump');
    } else {
      const exists = rows.find((r) => r.agent_code === target.code);
      if (exists) { console.log(folder + ' (' + target.code + '): row already exists - treating as update next run'); continue; }
      if (!APPLY) { console.log(folder + ': WOULD INSERT agent_code=' + target.code + ' agent_name=' + target.name + ' (models/voice copied from Cheeko)'); continue; }
      // Copy model/voice wiring from Cheeko so the session pipeline works; voice
      // is a placeholder until a real one is chosen.
      await c.query(
        'INSERT INTO ai_agent_template (agent_code, agent_name, system_prompt, soul, greeting_prompt, ' +
        '  asr_model_id, vad_model_id, llm_model_id, tts_model_id, tts_voice_id, sarvam_voice_id, elevenlabs_voice_id, ' +
        '  mem_model_id, intent_model_id, lang_code, language, chat_history_conf, is_visible, sort) ' +
        'SELECT $1, $2, $3, $4, $5, ' +
        '  asr_model_id, vad_model_id, llm_model_id, tts_model_id, tts_voice_id, sarvam_voice_id, elevenlabs_voice_id, ' +
        '  mem_model_id, intent_model_id, lang_code, language, chat_history_conf, 1, coalesce(sort,0)+100 ' +
        "FROM ai_agent_template WHERE agent_code='Cheeko'",
        [target.code, target.name, sys, soul, greet]);
      console.log(folder + ': INSERTED ' + target.code);
    }
  }

  // ---- bank content, update-by-code, diff only
  for (const [bank, rel] of Object.entries(BANK_CSV)) {
    const table = bank === 'quiz' ? 'quiz_question' : 'riddle_question';
    const byCode = new Map(banksBak[bank].map((r) => [r.code, r]));
    let same = 0, changed = 0, missing = 0;
    for (const row of readCsvRows(path.join(PACK, rel))) {
      if (SKIP_CODES.has(row.code)) { console.log('  ' + bank + ' ' + row.code + ': skipped (pack row known-bad, DB kept)'); continue; }
      const cur = byCode.get(row.code);
      if (!cur) { missing++; console.log('  ' + bank + ' ' + row.code + ': NOT IN DB (insert not implemented - investigate first)'); continue; }
      const want = {
        question_text: String(row.question_text).trim(), answer_text: String(row.answer_text).trim(),
        accepted_answers: pipes(row.accepted_answers), distractors: pipes(row.distractors),
        teach_text: String(row.teach_text || '').trim() || null, category: String(row.category || '').trim() || null,
        level: parseInt(row.level, 10), language: String(row.language || 'en').trim(),
        active: !['false', '0', 'no'].includes(String(row.active).toLowerCase()),
      };
      const eq = want.question_text === cur.question_text && want.answer_text === cur.answer_text
        && JSON.stringify(want.accepted_answers) === JSON.stringify(cur.accepted_answers)
        && JSON.stringify(want.distractors) === JSON.stringify(cur.distractors)
        && (want.teach_text || null) === (cur.teach_text || null) && (want.category || null) === (cur.category || null)
        && want.level === cur.level && want.language === cur.language && want.active === cur.active;
      if (eq) { same++; continue; }
      changed++;
      if (!APPLY) { console.log('  ' + bank + ' ' + row.code + ': WOULD UPDATE'); continue; }
      await c.query(
        'UPDATE ' + table + ' SET question_text=$1, answer_text=$2, accepted_answers=$3, distractors=$4, ' +
        '  teach_text=$5, category=$6, level=$7, language=$8, active=$9, update_date=now() WHERE code=$10',
        [want.question_text, want.answer_text, JSON.stringify(want.accepted_answers), JSON.stringify(want.distractors),
         want.teach_text, want.category, want.level, want.language, want.active, row.code]);
    }
    console.log(bank + ': ' + same + ' identical, ' + changed + (APPLY ? ' updated, ' : ' to update, ') + missing + ' missing');
  }

  await c.end();
  console.log(APPLY ? 'DONE (applied)' : 'DRY RUN ONLY - rerun with --apply');
})().catch((e) => { console.error('ERR', e.message); process.exit(1); });
