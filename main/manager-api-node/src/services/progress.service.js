/**
 * Character progress persistence — every character, not just the scored banks.
 *
 * The worker POSTs each session's final MEMO line per state type; this service
 * parses the "MEMO: k=v | k=v" fields into JSONB and writes:
 *   - kid_character_state   (current state, upserted — the restore source)
 *   - kid_session_progress  (append-only — parent app / analytics feed)
 *
 * Attribution follows the child like the quiz answer log: kid_id when the
 * device is linked, device_mac fallback otherwise.
 */

const { prisma } = require('../config/database');
const logger = require('../utils/logger');

// Same normalization stance as quiz.service: rows are written with the caller's
// spelling and read case-insensitively.
const macFilter = (deviceMac) => ({ equals: deviceMac, mode: 'insensitive' });

const resolveKidId = async (deviceMac) => {
  const device = await prisma.ai_device.findFirst({
    where: { mac_address: macFilter(deviceMac) },
    select: { kid_id: true },
  });
  return device?.kid_id ?? null;
};

/**
 * Parse a MEMO line into a plain object. "MEMO: type=spell_bee | current_level=4"
 * -> { type: 'spell_bee', current_level: '4' }. Values stay strings — the MEMO
 * is model-authored free text; typing it here would reject real sessions.
 */
const parseMemo = (memo) => {
  const out = {};
  const body = String(memo || '').replace(/^\s*MEMO:\s*/i, '');
  for (const part of body.split('|')) {
    const idx = part.indexOf('=');
    if (idx <= 0) continue;
    const key = part.slice(0, idx).trim();
    const value = part.slice(idx + 1).trim();
    if (key) out[key] = value;
  }
  return out;
};

/**
 * Record one session's progress: one entry per MEMO type.
 *
 * @param {{deviceMac: string, character?: string, memos: Array<{type: string, memo: string}>}} payload
 * @returns {Promise<{saved: number}>}
 */
const recordSessionProgress = async ({ deviceMac, character, memos }) => {
  const kidId = await resolveKidId(deviceMac);
  let saved = 0;

  for (const entry of Array.isArray(memos) ? memos : []) {
    const stateType = String(entry?.type || '').trim().toLowerCase();
    const memo = String(entry?.memo || '').trim();
    if (!stateType || !memo) continue;
    const data = parseMemo(memo);

    // Upsert current state. Partial unique indexes (kid vs unlinked-device) are
    // not expressible as a Prisma upsert target, so find-then-write; the worker
    // POSTs once per session end, so the race window is theoretical.
    const where = kidId
      ? { kid_id: kidId, state_type: stateType }
      : { device_mac: macFilter(deviceMac), kid_id: null, state_type: stateType };
    const existing = await prisma.kid_character_state.findFirst({ where, select: { id: true } });
    if (existing) {
      await prisma.kid_character_state.update({
        where: { id: existing.id },
        data: { memo, data, character: character || null, device_mac: deviceMac, updated_at: new Date() },
      });
    } else {
      await prisma.kid_character_state.create({
        data: { kid_id: kidId, device_mac: deviceMac, state_type: stateType, character: character || null, memo, data },
      });
    }

    await prisma.kid_session_progress.create({
      data: { kid_id: kidId, device_mac: deviceMac, character: character || null, state_type: stateType, memo, data },
    });
    saved++;
  }

  logger.info(`[PROGRESS] ${deviceMac} kid=${kidId ?? 'unlinked'} saved ${saved} memo type(s)`);
  return { saved };
};

/**
 * Current state for a device's child — the worker's Saved State restore source.
 * Linked device: the child's rows (their progress follows them across toys).
 * Unlinked: the device-fallback rows.
 *
 * @returns {Promise<Array<{state_type: string, memo: string, updated_at: Date}>>}
 */
const getCurrentState = async (deviceMac) => {
  const kidId = await resolveKidId(deviceMac);
  const where = kidId
    ? { kid_id: kidId }
    : { device_mac: macFilter(deviceMac), kid_id: null };
  return prisma.kid_character_state.findMany({
    where,
    select: { state_type: true, memo: true, updated_at: true },
    orderBy: { state_type: 'asc' },
  });
};

module.exports = { recordSessionProgress, getCurrentState, parseMemo };
