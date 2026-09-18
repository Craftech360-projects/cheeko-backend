describe('child facts service', () => {
  let prisma;
  let service;

  beforeEach(() => {
    jest.resetModules();
    prisma = {
      ai_device: { findUnique: jest.fn() },
      child_facts: {
        findMany: jest.fn(),
        upsert: jest.fn((args) => args)
      },
      $transaction: jest.fn(async (ops) => ops)
    };
    jest.doMock('../../src/config/database', () => ({ prisma }));
    service = require('../../src/services/child-facts.service');
  });

  afterEach(() => {
    jest.dontMock('../../src/config/database');
  });

  it('stores nothing for an unpaired device', async () => {
    prisma.ai_device.findUnique.mockResolvedValue({ kid_id: null });

    const result = await service.saveChildFacts({
      macAddress: 'aa-bb-cc-dd-ee-ff',
      sessionId: 's1',
      facts: [{ category: 'pet', subject: 'dog', fact: 'Has a dog named Bruno' }]
    });

    expect(result).toEqual({ saved: 0, skipped: 1, reason: 'no_child' });
    expect(prisma.child_facts.upsert).not.toHaveBeenCalled();
  });

  it('cleans, de-dups and upserts on the (kid, category, subject) key', async () => {
    prisma.ai_device.findUnique.mockResolvedValue({ kid_id: 77n });

    const result = await service.saveChildFacts({
      macAddress: 'aa-bb-cc-dd-ee-ff',
      sessionId: 's1',
      facts: [
        { category: 'PET', subject: 'Dog', fact: '  Has a dog   named Bruno ' },
        { category: 'pet', subject: 'dog', fact: 'Duplicate in the same reply' },
        { category: 'made-up', subject: 'Favourite Colour', fact: 'Likes blue' },
        { category: 'event', subject: 'trip', fact: 'Went to Goa', expires_at: '2000-01-01T00:00:00Z' },
        { category: 'event', subject: 'party', fact: 'Party soon', expires_at: 'not a date' },
        { category: 'pet', subject: '', fact: 'no subject' },
        'not an object'
      ]
    });

    expect(result).toEqual({ saved: 2, skipped: 5 });
    const calls = prisma.child_facts.upsert.mock.calls.map(([args]) => args);
    expect(calls[0].where).toEqual({ kid_id_category_subject: { kid_id: 77n, category: 'pet', subject: 'dog' } });
    expect(calls[0].create).toEqual(expect.objectContaining({ fact: 'Has a dog named Bruno', source_session: 's1', expires_at: null }));
    // first_seen is only set on create, so a re-mention keeps the original date.
    expect(calls[0].update).not.toHaveProperty('first_seen');
    expect(calls[1].where.kid_id_category_subject).toEqual({ kid_id: 77n, category: 'other', subject: 'favourite_colour' });
  });

  it('keeps a future expiry', async () => {
    prisma.ai_device.findUnique.mockResolvedValue({ kid_id: 77n });
    const future = new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString();

    await service.saveChildFacts({
      macAddress: 'aa-bb-cc-dd-ee-ff',
      sessionId: 's1',
      facts: [{ category: 'event', subject: 'birthday', fact: 'Birthday next week', expires_at: future }]
    });

    expect(prisma.child_facts.upsert.mock.calls[0][0].create.expires_at).toEqual(new Date(future));
  });

  it('rejects a non-array payload and an unknown device', async () => {
    await expect(service.saveChildFacts({ macAddress: 'aa-bb-cc-dd-ee-ff', facts: 'x' })).rejects.toThrow('facts must be an array');
    prisma.ai_device.findUnique.mockResolvedValue(null);
    await expect(service.listChildFacts('aa-bb-cc-dd-ee-ff')).rejects.toThrow('Device not found');
  });

  it('lists only unexpired facts for the child, newest first', async () => {
    prisma.ai_device.findUnique.mockResolvedValue({ kid_id: 77n });
    prisma.child_facts.findMany.mockResolvedValue([
      { category: 'pet', subject: 'dog', fact: 'Has a dog named Bruno', last_seen: new Date('2026-09-15'), expires_at: null }
    ]);

    const result = await service.listChildFacts('aa-bb-cc-dd-ee-ff');

    const query = prisma.child_facts.findMany.mock.calls[0][0];
    expect(query.where.kid_id).toBe(77n);
    expect(query.where.OR).toEqual([{ expires_at: null }, { expires_at: { gt: expect.any(Date) } }]);
    expect(query.orderBy).toEqual({ last_seen: 'desc' });
    expect(result).toEqual({
      kidId: '77',
      facts: [{ category: 'pet', subject: 'dog', fact: 'Has a dog named Bruno', lastSeen: new Date('2026-09-15'), expiresAt: null }]
    });
  });
});
