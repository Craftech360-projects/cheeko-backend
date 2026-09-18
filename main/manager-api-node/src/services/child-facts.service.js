/**
 * Child Facts Service
 *
 * Lasting facts about a child ("Has a dog named Bruno"), one row each. The worker
 * extracts them from a finished session and sends them here; this service owns
 * validation and the de-dup upsert on (kid_id, category, subject).
 *
 * Facts belong to the child, never the device: an unpaired toy stores none, so a
 * sibling picking up a hand-me-down never hears about the previous child's dog.
 *
 * Design: docs/child-memory-storage-review.md section 7.
 */

const { prisma } = require('../config/database');
const { normalizeMacAddress } = require('../utils/helpers');

const CATEGORIES = ['family', 'pet', 'likes', 'dislikes', 'school', 'event', 'other'];
const MAX_FACTS_PER_SAVE = 20;
// What the worker reads back to de-dup against, and later what the prompt shows.
const DEFAULT_LIST_LIMIT = 50;

const resolveKidId = async (macAddress) => {
  const normalizedMac = normalizeMacAddress(macAddress);
  if (!normalizedMac) throw new Error('Invalid MAC address format');
  const device = await prisma.ai_device.findUnique({
    where: { mac_address: normalizedMac },
    select: { kid_id: true }
  });
  if (!device) throw new Error('Device not found');
  return device.kid_id ?? null;
};

const clip = (value, max) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);

// 'Favourite Colour' and 'favourite_colour' must land on the same row.
const normalizeSubject = (value) => clip(value, 60).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');

/**
 * One fact from the worker, cleaned, or null to drop it. The worker's JSON comes
 * from a model, so every field is treated as untrusted.
 */
const cleanFact = (raw, now) => {
  if (!raw || typeof raw !== 'object') return null;
  const subject = normalizeSubject(raw.subject);
  const fact = clip(raw.fact, 300);
  if (!subject || !fact) return null;

  const category = CATEGORIES.includes(String(raw.category || '').toLowerCase())
    ? String(raw.category).toLowerCase()
    : 'other';

  let expiresAt = null;
  if (raw.expires_at || raw.expiresAt) {
    const parsed = new Date(raw.expires_at || raw.expiresAt);
    if (Number.isNaN(parsed.getTime())) return null; // a time-bound fact with a garbled date is not safe to keep forever
    if (parsed <= now) return null; // already over; nothing to remember
    expiresAt = parsed;
  }

  return { category, subject, fact, expiresAt };
};

/**
 * The child's current facts, newest mention first. Expired facts are left out.
 * @returns {Promise<{kidId: string|null, facts: Array}>}
 */
const listChildFacts = async (macAddress, { limit } = {}) => {
  const kidId = await resolveKidId(macAddress);
  if (!kidId) return { kidId: null, facts: [] };

  const take = Math.min(Math.max(parseInt(limit, 10) || DEFAULT_LIST_LIMIT, 1), 100);
  const rows = await prisma.child_facts.findMany({
    where: { kid_id: kidId, OR: [{ expires_at: null }, { expires_at: { gt: new Date() } }] },
    orderBy: { last_seen: 'desc' },
    take,
    select: { category: true, subject: true, fact: true, last_seen: true, expires_at: true }
  });

  return {
    kidId: String(kidId),
    facts: rows.map((r) => ({
      category: r.category,
      subject: r.subject,
      fact: r.fact,
      lastSeen: r.last_seen,
      expiresAt: r.expires_at
    }))
  };
};

/**
 * Upsert the facts extracted from one session. A known (category, subject)
 * rewrites the fact and moves last_seen; first_seen is kept.
 * @returns {Promise<{saved: number, skipped: number, reason?: string}>}
 */
const saveChildFacts = async ({ macAddress, sessionId, facts }) => {
  if (!Array.isArray(facts)) throw new Error('facts must be an array');
  const kidId = await resolveKidId(macAddress);
  if (!kidId) return { saved: 0, skipped: facts.length, reason: 'no_child' };

  const now = new Date();
  const cleaned = [];
  const seen = new Set();
  for (const raw of facts.slice(0, MAX_FACTS_PER_SAVE)) {
    const fact = cleanFact(raw, now);
    if (!fact) continue;
    const key = `${fact.category}|${fact.subject}`;
    if (seen.has(key)) continue; // one write per row; the model repeating itself is not two facts
    seen.add(key);
    cleaned.push(fact);
  }

  await prisma.$transaction(cleaned.map((f) => prisma.child_facts.upsert({
    where: { kid_id_category_subject: { kid_id: kidId, category: f.category, subject: f.subject } },
    create: {
      kid_id: kidId,
      category: f.category,
      subject: f.subject,
      fact: f.fact,
      source_session: sessionId || null,
      expires_at: f.expiresAt,
      first_seen: now,
      last_seen: now
    },
    update: {
      fact: f.fact,
      source_session: sessionId || null,
      expires_at: f.expiresAt,
      last_seen: now
    }
  })));

  return { saved: cleaned.length, skipped: facts.length - cleaned.length };
};

module.exports = {
  CATEGORIES,
  listChildFacts,
  saveChildFacts
};
