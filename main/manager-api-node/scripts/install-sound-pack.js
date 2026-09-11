// main/manager-api-node/scripts/install-sound-pack.js
// Install a sound-quiz game pack from a Phase 1 pack folder through the API.
//
//   node scripts/install-sound-pack.js <folder> [--uid <RFID_UID>] [--apply]
//
// The folder is the one the firmware plays from the SD card: manifest.jsn plus
// the sounds and icons it names. One content_item row is made per manifest
// round: Sound = the correct option's label, Prompt, wrong answers = the other
// two labels, File and Icon = the correct option's files. Dry-run by default.
//
// Goes through the REST API rather than SQL so the same save path that the
// dashboard uses derives content_hash, bumps version and rewrites manifest.jsn.
// Needs CHEEKO_API and SERVICE_SECRET_KEY, same as the MCP.
'use strict';
const fs = require('fs');
const path = require('path');
require('dotenv').config();
const { isValidAppId } = require('../src/services/soundQuiz');

const args = process.argv.slice(2);
const folder = args.find((a) => !a.startsWith('--'));
const APPLY = args.includes('--apply');
const uidIdx = args.indexOf('--uid');
const UID = uidIdx !== -1 ? String(args[uidIdx + 1] || '').toUpperCase().replace(/[:-]/g, '') : null;
if (!folder) { console.error('usage: node scripts/install-sound-pack.js <folder> [--uid <RFID_UID>] [--apply]'); process.exit(1); }

const BASE = (process.env.CHEEKO_API || '').replace(/\/$/, '');
const KEY = process.env.SERVICE_SECRET_KEY;
if (APPLY && (!BASE || !KEY)) { console.error('CHEEKO_API and SERVICE_SECRET_KEY are required with --apply'); process.exit(1); }

const MIME = { '.mp3': 'audio/mpeg', '.png': 'image/png' };
const titleCase = (label) => { const s = String(label || '').trim().toLowerCase(); return s.charAt(0).toUpperCase() + s.slice(1); };

async function api(route, { method = 'GET', body, form } = {}) {
  const res = await fetch(`${BASE}${route}`, {
    method,
    headers: { 'X-Service-Key': KEY, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: form || (body ? JSON.stringify(body) : undefined),
  });
  const json = await res.json().catch(() => ({ code: res.status, msg: res.statusText }));
  if (!res.ok || json.code !== 0) {
    const err = new Error(`${method} ${route} -> ${json.code}: ${json.msg}`);
    // The API answers a missing pack with 404/code 404; that is the one
    // failure a lookup may treat as "not there". Anything else — a bad
    // service key, a 500, a dropped connection — must stop the run, or the
    // script would create a duplicate on top of a pack it could not see.
    err.notFound = res.status === 404 || json.code === 404;
    throw err;
  }
  return json.data;
}
const orNull = (err) => { if (err.notFound) return null; throw err; };

async function upload(packCode, file) {
  const ext = path.extname(file).toLowerCase();
  const form = new FormData();
  form.append('file', new Blob([fs.readFileSync(file)], { type: MIME[ext] }), path.basename(file));
  form.append('purpose', 'game_asset');
  form.append('packCode', packCode);
  form.append('category', `apps/${packCode}`);
  return (await api('/admin/rfid/content-pack/upload', { method: 'POST', form })).url;
}

(async () => {
  // ---- read + validate the folder
  const manifestPath = path.join(folder, 'manifest.jsn');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const packCode = String(manifest.app_id || path.basename(folder)).toLowerCase();
  const errors = [];
  if (manifest.template !== 'sound_quiz') errors.push(`template is "${manifest.template}", expected sound_quiz`);
  if (!isValidAppId(packCode)) errors.push(`app_id "${packCode}" must be 1-8 chars of a-z 0-9 _ -`);
  const rounds = (manifest.rounds || manifest.questions || []).map((r, i) => {
    const opts = r.options || r.answers || [];
    const correct = opts[r.correct];
    if (!r.prompt) errors.push(`round ${i + 1}: missing prompt`);
    if (!correct || typeof correct !== 'object') errors.push(`round ${i + 1}: correct index ${r.correct} out of range`);
    const others = opts.filter((_, k) => k !== r.correct).map((o) => titleCase(o.label));
    if (others.length !== 2) errors.push(`round ${i + 1}: needs 3 options, got ${opts.length}`);
    const soundFile = path.join(folder, r.sound || '');
    const iconFile = path.join(folder, (correct && correct.icon) || '');
    if (!r.sound || !fs.existsSync(soundFile)) errors.push(`round ${i + 1}: sound file "${r.sound}" missing`);
    if (!correct || !correct.icon || !fs.existsSync(iconFile)) errors.push(`round ${i + 1}: icon "${correct && correct.icon}" missing`);
    return { title: titleCase(correct && correct.label), prompt: r.prompt, distractors: others.join(','), soundFile, iconFile };
  });
  if (rounds.length < 2 || rounds.length > 16) errors.push(`pack has ${rounds.length} rounds; need 2-16`);
  // Every wrong answer must be another round's Sound, or the manifest builder drops the round.
  const titles = new Set(rounds.map((r) => r.title.toUpperCase()));
  rounds.forEach((r, i) => r.distractors.split(',').forEach((d) => {
    if (!titles.has(d.toUpperCase())) errors.push(`round ${i + 1}: wrong answer "${d}" is not a round in this pack`);
  }));

  console.log(`pack ${packCode} "${manifest.name}" — ${rounds.length} rounds, ${rounds.length * 2} files`);
  console.log('Sound | Prompt | File | Icon | Wrong answers');
  for (const r of rounds) console.log(`${r.title} | ${r.prompt} | ${path.basename(r.soundFile)} | ${path.basename(r.iconFile)} | ${r.distractors}`);
  if (errors.length) { console.error('\nERRORS:\n  ' + errors.join('\n  ')); process.exit(1); }
  if (!APPLY) { console.log('\nDRY RUN ONLY - rerun with --apply' + (UID ? ` (will map card ${UID})` : '')); return; }

  // ---- create or find the pack
  let pack = await api(`/admin/rfid/content-pack/code/${encodeURIComponent(packCode)}`).catch(orNull);
  if (!pack) {
    await api('/admin/rfid/content-pack', { method: 'POST', body: { packCode, name: manifest.name || packCode, contentType: 'sound_quiz', language: 'en', status: 'active', active: true } });
    pack = await api(`/admin/rfid/content-pack/code/${encodeURIComponent(packCode)}`);
    console.log(`created pack id=${pack.id}`);
  } else {
    console.log(`updating pack id=${pack.id} (v${pack.version})`);
  }

  // ---- upload every file, then save the rows (one PUT so version bumps once)
  const items = [];
  for (const [i, r] of rounds.entries()) {
    const audioUrl = await upload(packCode, r.soundFile);
    const imageUrl = await upload(packCode, r.iconFile);
    console.log(`  ${i + 1}/${rounds.length} ${r.title}: uploaded`);
    items.push({ itemNumber: i + 1, title: r.title, text: r.prompt, description: r.distractors, audioUrl, imageUrl });
  }
  await api('/admin/rfid/content-pack', { method: 'PUT', body: { id: pack.id, contentType: 'sound_quiz', name: manifest.name || packCode, items } });
  const saved = await api(`/admin/rfid/content-pack/code/${encodeURIComponent(packCode)}`);
  console.log(`saved pack ${packCode} v${saved.version} hash=${saved.contentHash}`);

  // ---- map the card
  if (UID) {
    const existing = await api(`/admin/rfid/card/uid/${encodeURIComponent(UID)}`).catch(orNull);
    const body = { rfidUid: UID, contentPackId: pack.id, cardType: 'game', actionType: null, questionPackId: null, notes: `Game: ${manifest.name || packCode}`, active: true };
    if (existing && existing.id) {
      await api('/admin/rfid/card', { method: 'PUT', body: { id: existing.id, ...body } });
      console.log(`card ${UID}: updated -> game pack ${packCode}`);
    } else {
      await api('/admin/rfid/card', { method: 'POST', body });
      console.log(`card ${UID}: mapped -> game pack ${packCode}`);
    }
  }
  console.log('DONE (applied)');
})().catch((e) => { console.error('ERR', e.message); process.exit(1); });
