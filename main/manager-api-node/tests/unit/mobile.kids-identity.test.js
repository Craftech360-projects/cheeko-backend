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

    test('only the requesting parent\'s paired devices are consulted', async () => {
      await mobileService.getKids('uid-6');

      expect(prisma.ai_device.findMany).toHaveBeenCalledWith(expect.objectContaining({
        where: { user_id: USER.id, kid_id: { not: null } },
      }));
    });
  });
});
