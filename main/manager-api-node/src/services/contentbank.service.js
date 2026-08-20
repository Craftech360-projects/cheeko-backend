/**
 * Content banks for the unscored characters — the serve side.
 *
 * GET one payload per session: a rotated slice of the bank (or the whole bank
 * for Tikku, whose ladder level lives in its MEMO and picks its own words).
 * Selection is a deterministic daily rotation seeded by (date, device) so a
 * child gets fresh content each day without any server-side progress state —
 * no-repeat within/across days is the character's MEMO ledger job.
 *
 * No answer tables, no level derivation, no day gate. Spec: the cheeko-character
 * skill + Wave 3 plan (progress lives in kid_character_state).
 */

const { prisma } = require('../config/database');

// display-name/agent_code -> bank config. Both spellings resolve because the
// worker fetches BEFORE the persona pull (same constraint as banks.js).
const CONTENT_BANKS = Object.assign(Object.create(null), {
  masti: { bank: 'joke', table: () => prisma.joke_bank, perDay: 6 },
  science_buddy: { bank: 'why', table: () => prisma.why_bank, perDay: 4 },
  tara: { bank: 'why', table: () => prisma.why_bank, perDay: 4 },
  word_wizard: { bank: 'word', table: () => prisma.word_bank, perDay: 6 },
  mitthu: { bank: 'word', table: () => prisma.word_bank, perDay: 6 },
  story_explorer: { bank: 'story', table: () => prisma.story_bank, perDay: 1 },
  nani: { bank: 'story', table: () => prisma.story_bank, perDay: 1 },
  spell_master: { bank: 'spell', table: () => prisma.spell_bank, perDay: 0 }, // 0 = whole bank
  tikku: { bank: 'spell', table: () => prisma.spell_bank, perDay: 0 },
});

// Small deterministic hash so the same (device, date) always serves the same
// slice — a reconnect mid-day must not deal a fresh set.
const seedFrom = (s) => {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h;
};

/**
 * Rotated daily slice: stable order, window advances by date+device seed.
 */
const rotate = (rows, count, seed) => {
  if (!rows.length || count <= 0 || count >= rows.length) return rows;
  const start = seed % rows.length;
  const out = [];
  for (let i = 0; i < count; i++) out.push(rows[(start + i) % rows.length]);
  return out;
};

/**
 * @param {{character?: string, deviceMac: string, date?: string}} args
 * @returns {Promise<null | {bank: string, items: object[]}>} null = character has no content bank
 */
const nextContent = async ({ character, deviceMac, date }) => {
  const key = String(character || '').trim().toLowerCase();
  const cfg = CONTENT_BANKS[key];
  if (!cfg) return null;

  const rows = await cfg.table().findMany({
    where: { active: true },
    orderBy: [{ level: 'asc' }, { code: 'asc' }],
  });
  const day = date || new Date().toISOString().slice(0, 10);
  const seed = seedFrom(day + '|' + String(deviceMac).toLowerCase());
  const items = rotate(rows, cfg.perDay, seed).map((r) => {
    const { id, create_date, update_date, ...rest } = r;
    return rest;
  });
  return { bank: cfg.bank, items };
};

module.exports = { nextContent, CONTENT_BANKS };
