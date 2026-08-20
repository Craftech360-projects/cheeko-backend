/**
 * The unscored characters' no-repeat guarantee.
 *
 * Before the seen-ledger this lived entirely in the character's MEMO line, and
 * the serve endpoint rotated by a (date, device) hash with no memory — so it
 * re-served heard items within days and the prompt was the only thing in the
 * way. Exclusion is now server-side; these tests pin that, plus the two cases
 * that are easy to get backwards: an exhausted bank must recycle rather than go
 * silent, and an unfinished story must be PINNED rather than rotated away.
 */

jest.mock('../../src/config/database', () => ({
  prisma: {
    ai_device: { findFirst: jest.fn() },
    kid_content_seen: { findMany: jest.fn(), createMany: jest.fn() },
    kid_character_state: { findFirst: jest.fn() },
    joke_bank: { findMany: jest.fn() },
    story_bank: { findMany: jest.fn() },
  },
}));

const { prisma } = require('../../src/config/database');
const { nextContent, markContentSeen, RECYCLE_AFTER_DAYS } = require('../../src/services/contentbank.service');

const MAC = 'AA:BB:CC:DD:EE:FF';
const jokes = Array.from({ length: 12 }, (_, i) => ({
  id: BigInt(i + 1), code: `MJ-${i + 1}`, level: 1, language: 'en',
  setup: 's', punchline: 'p', active: true, create_date: new Date(), update_date: new Date(),
}));

beforeEach(() => {
  jest.clearAllMocks();
  prisma.ai_device.findFirst.mockResolvedValue({ kid_id: 42n });
  prisma.joke_bank.findMany.mockResolvedValue(jokes);
  prisma.kid_content_seen.findMany.mockResolvedValue([]);
  prisma.kid_character_state.findFirst.mockResolvedValue(null);
});

describe('serving excludes what the child already heard', () => {
  it('never serves a seen item while unseen ones remain', async () => {
    prisma.kid_content_seen.findMany.mockResolvedValue(
      jokes.slice(0, 6).map((j) => ({ code: j.code }))
    );

    const r = await nextContent({ character: 'Masti', deviceMac: MAC, date: '2026-09-01' });

    expect(r.items).toHaveLength(6);
    expect(r.items.map((i) => i.code)).toEqual(
      expect.not.arrayContaining(['MJ-1', 'MJ-2', 'MJ-3', 'MJ-4', 'MJ-5', 'MJ-6'])
    );
    expect(r.recycled).toBe(false);
  });

  it('recycles rather than going silent once everything is seen', async () => {
    prisma.kid_content_seen.findMany.mockResolvedValue(jokes.map((j) => ({ code: j.code })));

    const r = await nextContent({ character: 'Masti', deviceMac: MAC, date: '2026-09-01' });

    // Silence is worse than a repeat — but the caller must be able to tell.
    expect(r.items).toHaveLength(6);
    expect(r.recycled).toBe(true);
  });

  it('only counts items seen inside the recycle window', async () => {
    await nextContent({ character: 'Masti', deviceMac: MAC, date: '2026-09-01' });

    const where = prisma.kid_content_seen.findMany.mock.calls[0][0].where;
    const cutoff = where.seen_at.gte;
    const days = (Date.now() - cutoff.getTime()) / (24 * 60 * 60 * 1000);
    expect(Math.round(days)).toBe(RECYCLE_AFTER_DAYS);
  });

  it('scopes by child, not device, when the toy is linked', async () => {
    await nextContent({ character: 'Masti', deviceMac: MAC, date: '2026-09-01' });
    expect(prisma.kid_content_seen.findMany.mock.calls[0][0].where.kid_id).toBe(42n);
  });

  it('falls back to device scope for an unlinked toy', async () => {
    prisma.ai_device.findFirst.mockResolvedValue({ kid_id: null });
    await nextContent({ character: 'Masti', deviceMac: MAC, date: '2026-09-01' });

    const where = prisma.kid_content_seen.findMany.mock.calls[0][0].where;
    expect(where.kid_id).toBeNull();
    expect(where.device_mac).toEqual({ equals: MAC, mode: 'insensitive' });
  });
});

describe('an unfinished story is pinned, not rotated away', () => {
  const stories = Array.from({ length: 5 }, (_, i) => ({
    id: BigInt(i + 1), code: `story-${i + 1}`, level: 1, language: 'en',
    title: 't', active: true, create_date: new Date(), update_date: new Date(),
  }));

  beforeEach(() => {
    prisma.story_bank.findMany.mockResolvedValue(stories);
  });

  it('re-serves the story a previous session left unfinished', async () => {
    prisma.kid_character_state.findFirst.mockResolvedValue({
      data: { story_key: 'story-4', completed: 'false', beat: '3_of_6' },
    });

    // A different date: the rotation alone would deal a different story, which
    // is exactly the bug — Nani would resume beat 3 of a story she never began.
    const r = await nextContent({ character: 'Nani', deviceMac: MAC, date: '2026-09-09' });

    expect(r.items.map((i) => i.code)).toEqual(['story-4']);
    expect(r.resumed).toBe(true);
  });

  it('moves on once the story is completed', async () => {
    prisma.kid_character_state.findFirst.mockResolvedValue({
      data: { story_key: 'story-4', completed: 'true' },
    });
    prisma.kid_content_seen.findMany.mockResolvedValue([{ code: 'story-4' }]);

    const r = await nextContent({ character: 'Nani', deviceMac: MAC, date: '2026-09-09' });

    expect(r.items.map((i) => i.code)).not.toContain('story-4');
    expect(r.resumed).toBeUndefined();
  });

  it('does not strand a child on a story that has been retired', async () => {
    prisma.kid_character_state.findFirst.mockResolvedValue({
      data: { story_key: 'story-gone', completed: 'false' },
    });

    const r = await nextContent({ character: 'Nani', deviceMac: MAC, date: '2026-09-09' });

    expect(r.items).toHaveLength(1);
    expect(r.resumed).toBeUndefined();
  });
});

describe('markContentSeen', () => {
  it('writes only codes not already recorded', async () => {
    prisma.kid_content_seen.findMany.mockResolvedValue([{ code: 'MJ-1' }]);
    prisma.kid_content_seen.createMany.mockResolvedValue({ count: 2 });

    const n = await markContentSeen({ deviceMac: MAC, bank: 'joke', codes: ['MJ-1', 'MJ-2', 'MJ-3'] });

    expect(n).toBe(2);
    expect(prisma.kid_content_seen.createMany.mock.calls[0][0].data.map((r) => r.code))
      .toEqual(['MJ-2', 'MJ-3']);
  });

  it('is a no-op when every code is already known (a retried POST)', async () => {
    prisma.kid_content_seen.findMany.mockResolvedValue([{ code: 'MJ-1' }]);

    expect(await markContentSeen({ deviceMac: MAC, bank: 'joke', codes: ['MJ-1'] })).toBe(0);
    expect(prisma.kid_content_seen.createMany).not.toHaveBeenCalled();
  });

  it('ignores blanks and duplicates in the reported list', async () => {
    prisma.kid_content_seen.findMany.mockResolvedValue([]);
    prisma.kid_content_seen.createMany.mockResolvedValue({ count: 1 });

    await markContentSeen({ deviceMac: MAC, bank: 'joke', codes: ['MJ-9', 'MJ-9', '', '  '] });

    expect(prisma.kid_content_seen.createMany.mock.calls[0][0].data).toHaveLength(1);
  });

  it('writes nothing without a bank or codes', async () => {
    expect(await markContentSeen({ deviceMac: MAC, bank: '', codes: ['x'] })).toBe(0);
    expect(await markContentSeen({ deviceMac: MAC, bank: 'joke', codes: [] })).toBe(0);
    expect(prisma.kid_content_seen.createMany).not.toHaveBeenCalled();
  });
});
