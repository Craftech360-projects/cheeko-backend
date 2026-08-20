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

// How long a served item stays "seen". Past this it may come round again — a
// bank of sixty jokes must not go silent forever once a child has heard them
// all, and a joke from three months ago is new again to a six-year-old. Story
// and question ledgers age out for the same reason (30 and 14 days); this sits
// between them and applies to every unscored bank.
const RECYCLE_AFTER_DAYS = 45;

const macFilter = (deviceMac) => ({ equals: deviceMac, mode: 'insensitive' });

/** Rows scoped to the child, falling back to the device when unlinked. */
const seenScope = (kidId, deviceMac, bank) => (kidId
  ? { kid_id: kidId, bank }
  : { device_mac: macFilter(deviceMac), kid_id: null, bank });

const resolveKidId = async (deviceMac) => {
  const device = await prisma.ai_device.findFirst({
    where: { mac_address: macFilter(deviceMac) },
    select: { kid_id: true },
  });
  return device?.kid_id ?? null;
};

/**
 * The story a previous session left unfinished, or null.
 *
 * Read from the saved `story` MEMO — the same line Nani herself resumes from,
 * so the briefing she is handed and the beat she continues at cannot disagree.
 * A story whose code is no longer in the active bank is treated as finished:
 * retiring content must not strand a child on it forever.
 *
 * @returns {Promise<object|null>} the bank row to re-serve
 */
const pinnedStory = async (kidId, deviceMac, rows) => {
  const where = kidId
    ? { kid_id: kidId, state_type: 'story' }
    : { device_mac: macFilter(deviceMac), kid_id: null, state_type: 'story' };
  const state = await prisma.kid_character_state.findFirst({ where, select: { data: true } });
  const data = state?.data;
  if (!data || String(data.completed || '').toLowerCase() === 'true') return null;
  const key = String(data.story_key || '').trim();
  if (!key) return null;
  return rows.find((r) => r.code === key) || null;
};

/**
 * The session's content, excluding what this child has already been given.
 *
 * Exclusion is server-side on purpose. The MEMO's jokes_told= still tells the
 * model what it said, but a repeat must not depend on the model noticing: the
 * rotation hash has no memory, so before this it re-served heard items within
 * days and the prompt was the only thing standing in the way.
 *
 * @param {{character?: string, deviceMac: string, date?: string}} args
 * @returns {Promise<null | {bank: string, items: object[], recycled: boolean}>}
 *   null = character has no content bank
 */
const nextContent = async ({ character, deviceMac, date }) => {
  const key = String(character || '').trim().toLowerCase();
  const cfg = CONTENT_BANKS[key];
  if (!cfg) return null;

  const [rows, kidId] = await Promise.all([
    cfg.table().findMany({ where: { active: true }, orderBy: [{ level: 'asc' }, { code: 'asc' }] }),
    resolveKidId(deviceMac),
  ]);

  const cutoff = new Date(Date.now() - RECYCLE_AFTER_DAYS * 24 * 60 * 60 * 1000);
  const seen = new Set((await prisma.kid_content_seen.findMany({
    where: { ...seenScope(kidId, deviceMac, cfg.bank), seen_at: { gte: cutoff } },
    select: { code: true },
  })).map((r) => r.code));

  // An unfinished story is PINNED: Nani resumes from the saved beat next
  // session, and the daily rotation would otherwise hand her a different story
  // to resume into — the ledger alone cannot prevent this, because an
  // unfinished story is deliberately never marked seen. Found 2026-08-20:
  // the resume gate held, the rotation defeated it anyway.
  if (cfg.bank === 'story') {
    const pinned = await pinnedStory(kidId, deviceMac, rows);
    if (pinned) {
      const { id, create_date, update_date, ...rest } = pinned;
      return { bank: cfg.bank, items: [rest], recycled: false, resumed: true };
    }
  }

  const unseen = rows.filter((r) => !seen.has(r.code));
  // Everything within the recycle window has been heard: fall back to the whole
  // bank rather than serving nothing. Silence is worse than a repeat, and the
  // flag lets the caller log which happened.
  const recycled = unseen.length === 0 && rows.length > 0;
  const pool = recycled ? rows : unseen;

  const day = date || new Date().toISOString().slice(0, 10);
  const seed = seedFrom(day + '|' + String(deviceMac).toLowerCase());
  const items = rotate(pool, cfg.perDay, seed).map((r) => {
    const { id, create_date, update_date, ...rest } = r;
    return rest;
  });
  return { bank: cfg.bank, items, recycled };
};

/**
 * Record items as given. Called at session close with the codes the character's
 * MEMO says it actually used — not at serve time, because a served joke the
 * session never reached is not one the child has heard.
 *
 * Idempotent: re-reporting a code is a no-op, so a retried POST cannot corrupt
 * the ledger.
 *
 * @param {{deviceMac: string, bank: string, codes: string[]}} args
 * @returns {Promise<number>} rows written
 */
const markContentSeen = async ({ deviceMac, bank, codes }) => {
  const list = [...new Set((Array.isArray(codes) ? codes : [])
    .map((c) => String(c || '').trim())
    .filter(Boolean))];
  if (!list.length || !bank) return 0;

  const kidId = await resolveKidId(deviceMac);
  const existing = new Set((await prisma.kid_content_seen.findMany({
    where: { ...seenScope(kidId, deviceMac, bank), code: { in: list } },
    select: { code: true },
  })).map((r) => r.code));

  const fresh = list.filter((code) => !existing.has(code));
  if (!fresh.length) return 0;
  const { count } = await prisma.kid_content_seen.createMany({
    data: fresh.map((code) => ({ kid_id: kidId, device_mac: deviceMac, bank, code })),
  });
  return count;
};

module.exports = { nextContent, markContentSeen, CONTENT_BANKS, RECYCLE_AFTER_DAYS };
