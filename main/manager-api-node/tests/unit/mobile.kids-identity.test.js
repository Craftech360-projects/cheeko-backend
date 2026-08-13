/**
 * Two defects that cost a child their history on re-activation:
 * createKid minting a duplicate profile, and getKids returning the children in
 * whatever order Postgres felt like with no indication of which toy they are on.
 */

describe('mobile kid identity', () => {
  let prisma;
  let mobileService;

  const USER = { id: 6n, firebase_uid: 'uid-6' };

  beforeEach(() => {
    jest.resetModules();
    prisma = {
      sys_user: { findUnique: jest.fn(async () => USER) },
      kid_profile: { findFirst: jest.fn(async () => null), create: jest.fn(async ({ data }) => ({ id: 99n, ...data })) },
      ai_device: { findMany: jest.fn(async () => []) },
    };
    jest.doMock('../../src/config/database', () => ({ prisma }));
    jest.doMock('../../src/utils/logger', () => ({ warn: jest.fn(), info: jest.fn(), error: jest.fn() }));
    mobileService = require('../../src/services/mobile.service');
  });

  describe('createKid', () => {
    const payload = { name: 'Kishore', birth_date: '2019-03-15', gender: 'male' };

    test('reuses the profile that already matches instead of duplicating it', async () => {
      prisma.kid_profile.findFirst.mockResolvedValue({
        id: 6n, name: 'Kishore', birth_date: new Date('2019-03-15'), interests: [],
      });

      const kid = await mobileService.createKid('uid-6', payload);

      expect(kid.id).toBe('6');
      expect(prisma.kid_profile.create).not.toHaveBeenCalled();
    });

    test('matches case-insensitively on name, as the merge script does', async () => {
      await mobileService.createKid('uid-6', { ...payload, name: 'kishore' });

      expect(prisma.kid_profile.findFirst).toHaveBeenCalledWith(expect.objectContaining({
        where: expect.objectContaining({
          user_id: USER.id,
          name: { equals: 'kishore', mode: 'insensitive' },
        }),
      }));
    });

    test('a different birth date is a different child', async () => {
      await mobileService.createKid('uid-6', payload);
      const passed = prisma.kid_profile.findFirst.mock.calls[0][0].where;
      expect(passed.birth_date).toEqual(new Date('2019-03-15'));
      expect(prisma.kid_profile.create).toHaveBeenCalled();
    });

    test('a child with no birth date is always created, never matched', async () => {
      await mobileService.createKid('uid-6', { name: 'Kishore' });

      expect(prisma.kid_profile.findFirst).not.toHaveBeenCalled();
      expect(prisma.kid_profile.create).toHaveBeenCalled();
    });
  });

  describe('updateKid', () => {
    beforeEach(() => {
      prisma.kid_profile.updateMany = jest.fn(async () => ({ count: 1 }));
      prisma.kid_profile.findUnique = jest.fn(async () => ({ id: 15n, name: 'Kishore', interests: [] }));
    });

    test('only ever touches a child belonging to the caller', async () => {
      await mobileService.updateKid('uid-6', '15', { name: 'Kishore' });

      expect(prisma.kid_profile.updateMany).toHaveBeenCalledWith(expect.objectContaining({
        where: { id: 15n, user_id: USER.id },
      }));
    });

    // Putting another parent's kid id in the URL used to edit their child.
    test('another parent\'s child is a 404, not an edit', async () => {
      prisma.kid_profile.updateMany.mockResolvedValue({ count: 0 });

      await expect(mobileService.updateKid('uid-6', '999', { name: 'Whoever' }))
        .rejects.toMatchObject({ statusCode: 404 });
      expect(prisma.kid_profile.findUnique).not.toHaveBeenCalled();
    });
  });

  describe('getKids', () => {
    beforeEach(() => {
      prisma.sys_user.findUnique.mockResolvedValue({
        ...USER,
        kid_profile: [
          { id: 8n, name: 'Rahul', birth_date: new Date('2025-08-01'), interests: [] },
          { id: 15n, name: 'Kishore', birth_date: new Date('2019-03-15'), interests: [] },
        ],
      });
      prisma.ai_device.findMany.mockResolvedValue([{ mac_address: '00:16:3E:7A:11:C4', kid_id: 15n }]);
    });

    test('says which toy each child is on, so the app need not guess', async () => {
      const kids = await mobileService.getKids('uid-6');

      const kishore = kids.find(k => k.id === '15');
      expect(kishore.device_mac).toBe('00:16:3E:7A:11:C4');
      expect(kishore.is_paired).toBe(true);

      const rahul = kids.find(k => k.id === '8');
      expect(rahul.device_mac).toBeNull();
      expect(rahul.is_paired).toBe(false);
    });

    test('asks the database for a stable order rather than accepting any', async () => {
      await mobileService.getKids('uid-6');

      expect(prisma.sys_user.findUnique).toHaveBeenCalledWith(expect.objectContaining({
        include: { kid_profile: { orderBy: [{ created_at: 'asc' }, { id: 'asc' }] } },
      }));
    });

    // A client that takes the head of the list must land on the family's active
    // child. Rahul's profile is older, so age alone put him first while Kishore's
    // toy was the one that had just been used.
    test('the child whose toy was used most recently comes first', async () => {
      prisma.sys_user.findUnique.mockResolvedValue({
        ...USER,
        kid_profile: [
          { id: 10n, name: 'Rahul', created_at: new Date('2026-08-11'), interests: [] },
          { id: 15n, name: 'Kishore', created_at: new Date('2026-08-13'), interests: [] },
        ],
      });
      prisma.ai_device.findMany.mockResolvedValue([
        { mac_address: 'AA:16:3E:AC:B5:38', kid_id: 10n, last_connected_at: new Date('2026-08-11T12:00:00Z') },
        { mac_address: '00:16:3E:7A:11:C4', kid_id: 15n, last_connected_at: new Date('2026-08-13T08:32:00Z') },
      ]);

      const kids = await mobileService.getKids('uid-6');

      expect(kids.map(k => k.name)).toEqual(['Kishore', 'Rahul']);
    });

    test('a child with no toy sorts after every child who has one', async () => {
      prisma.sys_user.findUnique.mockResolvedValue({
        ...USER,
        kid_profile: [
          { id: 1n, name: 'Unpaired', created_at: new Date('2020-01-01'), interests: [] },
          { id: 2n, name: 'Paired', created_at: new Date('2026-08-13'), interests: [] },
        ],
      });
      prisma.ai_device.findMany.mockResolvedValue([
        { mac_address: 'AA:BB:CC:DD:EE:FF', kid_id: 2n, last_connected_at: new Date('2026-08-13T08:00:00Z') },
      ]);

      const kids = await mobileService.getKids('uid-6');

      expect(kids.map(k => k.name)).toEqual(['Paired', 'Unpaired']);
    });

    test('two children with no toy keep a stable order by profile age', async () => {
      prisma.sys_user.findUnique.mockResolvedValue({
        ...USER,
        kid_profile: [
          { id: 2n, name: 'Younger', created_at: new Date('2026-08-13'), interests: [] },
          { id: 1n, name: 'Older', created_at: new Date('2026-01-01'), interests: [] },
        ],
      });
      prisma.ai_device.findMany.mockResolvedValue([]);

      const kids = await mobileService.getKids('uid-6');

      expect(kids.map(k => k.name)).toEqual(['Older', 'Younger']);
    });

    describe('?mac=', () => {
      beforeEach(() => {
        prisma.ai_device.findFirst = jest.fn(async () => ({ kid_id: 15n }));
      });

      test('returns only the child paired to that toy', async () => {
        const kids = await mobileService.getKids('uid-6', { mac: '00:16:3e:7a:11:c4' });

        expect(kids.map(k => k.name)).toEqual(['Kishore']);
      });

      test('normalises the address the caller sent', async () => {
        await mobileService.getKids('uid-6', { mac: '00-16-3e-7a-11-c4' });

        expect(prisma.ai_device.findFirst).toHaveBeenCalledWith(expect.objectContaining({
          where: expect.objectContaining({
            user_id: USER.id,
            mac_address: { equals: '00:16:3E:7A:11:C4', mode: 'insensitive' },
          }),
        }));
      });

      test('a toy this parent does not own is 404, not an empty list', async () => {
        prisma.ai_device.findFirst.mockResolvedValue(null);

        await expect(mobileService.getKids('uid-6', { mac: 'AA:BB:CC:DD:EE:FF' }))
          .rejects.toMatchObject({ statusCode: 404 });
      });

      test('an unpaired toy is an empty list, not 404', async () => {
        prisma.ai_device.findFirst.mockResolvedValue({ kid_id: null });

        await expect(mobileService.getKids('uid-6', { mac: '00:16:3e:7a:11:c4' })).resolves.toEqual([]);
      });

      test('a malformed address is refused rather than ignored', async () => {
        await expect(mobileService.getKids('uid-6', { mac: 'not-a-mac' }))
          .rejects.toMatchObject({ statusCode: 404 });
        expect(prisma.ai_device.findFirst).not.toHaveBeenCalled();
      });

      test('no mac still returns every child', async () => {
        const kids = await mobileService.getKids('uid-6');

        expect(kids).toHaveLength(2);
        expect(prisma.ai_device.findFirst).not.toHaveBeenCalled();
      });
    });

    test('only the requesting parent\'s paired devices are consulted', async () => {
      await mobileService.getKids('uid-6');

      expect(prisma.ai_device.findMany).toHaveBeenCalledWith(expect.objectContaining({
        where: { user_id: USER.id, kid_id: { not: null } },
      }));
    });
  });
});
