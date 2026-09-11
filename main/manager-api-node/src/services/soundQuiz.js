'use strict';

/**
 * Sound-quiz game packs: the device manifest, 8.3 asset names and the flat
 * prompt list, all derived from content_item rows. Pure — no I/O — so the
 * lookup, the save path and the installer script share one derivation.
 *
 * Row → round mapping (spec §4):
 *   title        → Sound (the correct option's label, uppercased in the manifest)
 *   lyrics_text  → Prompt
 *   audio_url    → sound file
 *   image_url    → icon PNG
 *   description  → "A,B": the Sound names of the two wrong answers
 */

const CLOUDFRONT_DOMAIN = process.env.CLOUDFRONT_DOMAIN || 'dsmzc13oafp54.cloudfront.net';
const APP_ID_RE = /^[a-z0-9_-]{1,8}$/;
const MANIFEST_NAME = 'manifest.jsn';
const COLOR = '#4EA8DE';
const OPTION_COUNT = 3;

/** The pack code doubles as the SD folder, which FATFS limits to 8.3. */
const isValidAppId = (code) => APP_ID_RE.test(String(code || ''));

/** 8-char stem for a round's files: "Microwave" -> "microwav". */
const assetStem = (title) => {
  const s = String(title || '').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 8);
  return s || 'snd';
};

const manifestKeyFor = (packCode) => `rfidcontent/apps/${packCode}/${MANIFEST_NAME}`;
const manifestUrlFor = (packCode) => `https://${CLOUDFRONT_DOMAIN}/${manifestKeyFor(packCode)}`;

const norm = (s) => String(s || '').trim().toUpperCase();

/**
 * Stems must be unique per pack: two rounds with the same first eight letters
 * would otherwise overwrite each other's files on the card. A collision keeps
 * seven chars and appends a digit.
 */
const assignStems = (rounds) => {
  const used = new Set();
  for (const r of rounds) {
    const base = assetStem(r.title);
    let stem = base;
    let n = 1;
    while (used.has(stem)) {
      stem = `${base.slice(0, 7)}${n}`;
      n += 1;
    }
    used.add(stem);
    r.stem = stem;
  }
};

/**
 * @param {{pack_code:string,name:string,version?:string|number}} pack
 * @param {Array} items content_item rows
 * @param {string} manifestUrl where manifest.jsn is (or will be) hosted
 * @returns {{manifest:Object, assets:Array, prompts:Array, warnings:string[]}}
 */
const buildSoundQuizPack = (pack, items, manifestUrl) => {
  const warnings = [];
  const rounds = [...(items || [])]
    .sort((a, b) => (a.item_number || 0) - (b.item_number || 0))
    .map((it) => ({
      title: String(it.title || '').trim(),
      prompt: String(it.lyrics_text || '').trim(),
      audioUrl: it.audio_url || null,
      imageUrl: it.image_url || null,
      distractors: String(it.description || '').split(',').map((s) => s.trim()).filter(Boolean),
    }));

  assignStems(rounds);
  // Distractors are resolved against every row that has a label and an icon,
  // not only the rounds that survive: a round dropped for a missing prompt can
  // still lend its icon as a wrong answer. A lent icon is still shipped in assets.
  const byLabel = new Map();
  for (const r of rounds) {
    if (r.title && r.imageUrl) byLabel.set(norm(r.title), r);
  }

  const kept = [];
  const referenced = new Set();
  for (const r of rounds) {
    const label = r.title || '(untitled)';
    if (!r.title) { warnings.push(`round dropped: missing Sound name`); continue; }
    if (!r.prompt) { warnings.push(`${label}: missing prompt`); continue; }
    if (!r.audioUrl) { warnings.push(`${label}: missing sound file`); continue; }
    if (!r.imageUrl) { warnings.push(`${label}: missing icon`); continue; }
    if (r.distractors.length !== OPTION_COUNT - 1) {
      warnings.push(`${label}: needs exactly ${OPTION_COUNT - 1} wrong answers, got ${r.distractors.length}`);
      continue;
    }
    const resolved = r.distractors.map((d) => byLabel.get(norm(d)));
    const missing = r.distractors.filter((_, i) => !resolved[i] || resolved[i] === r);
    if (missing.length) { warnings.push(`${label}: unknown wrong answer(s) ${missing.join(', ')}`); continue; }
    if (resolved[0] === resolved[1]) { warnings.push(`${label}: wrong answers must differ`); continue; }
    kept.push({ ...r, resolved });
    resolved.forEach((d) => referenced.add(d));
  }

  const manifestRounds = kept.map((r, idx) => {
    const correct = idx % OPTION_COUNT;
    const wrong = r.resolved.map((d) => ({ label: norm(d.title), icon: `${d.stem}.png` }));
    const options = [];
    for (let i = 0; i < OPTION_COUNT; i += 1) {
      options.push(i === correct ? { label: norm(r.title), icon: `${r.stem}.png` } : wrong.shift());
    }
    return { prompt: r.prompt, sound: `${r.stem}.mp3`, options, correct };
  });

  const version = parseInt(String(pack.version ?? ''), 10);
  const manifest = {
    type: 'miniapp',
    template: 'sound_quiz',
    app_id: pack.pack_code,
    name: pack.name,
    color: COLOR,
    version: Number.isFinite(version) && version > 0 ? version : 1,
    rounds: manifestRounds,
  };

  const assets = [{ name: MANIFEST_NAME, url: manifestUrl }];
  for (const r of kept) {
    assets.push({ name: `${r.stem}.mp3`, url: r.audioUrl });
    assets.push({ name: `${r.stem}.png`, url: r.imageUrl });
  }

  const keptStems = new Set(kept.map((r) => r.stem));
  for (const d of referenced) {
    if (!keptStems.has(d.stem)) assets.push({ name: `${d.stem}.png`, url: d.imageUrl });
  }

  const prompts = kept.map((r) => ({ sound: r.title, prompt: r.prompt, file: `${r.stem}.mp3` }));

  return { manifest, assets, prompts, warnings };
};

module.exports = {
  isValidAppId,
  assetStem,
  manifestKeyFor,
  manifestUrlFor,
  buildSoundQuizPack,
  MANIFEST_NAME,
};
