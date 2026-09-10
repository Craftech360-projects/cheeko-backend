'use strict';

jest.mock('../../src/config/database', () => ({
  prisma: {
    kid_profile: { count: jest.fn(), findMany: jest.fn(), create: jest.fn(), update: jest.fn() },
    ai_device: { findMany: jest.fn() },
  },
}));

const { prisma } = require('../../src/config/database');
const adminService = require('../../src/services/admin.service');

const OWN = 'https://dsmzc13oafp54.cloudfront.net/kids/avatars/8-abc.jpg';
const STOCK = 'https://t4.ftcdn.net/jpg/14/24/51/47/240_F_1424514793.jpg';

// A stock-photo URL stored on a profile showed up as that child's photo on the
// dashboard. Only photos uploaded through the avatar route may be shown or set.
describe('admin.service kid avatars', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, 'log').mockImplementation(() => {});
    prisma.ai_device.findMany.mockResolvedValue([]);
    prisma.kid_profile.create.mockImplementation(async ({ data }) => ({ id: 8n, ...data }));
    prisma.kid_profile.update.mockImplementation(async ({ data }) => ({ id: 8n, ...data }));
  });

  afterEach(() => {
    console.log.mockRestore();
  });

  it('the roster shows only photos we uploaded', async () => {
    prisma.kid_profile.count.mockResolvedValue(2);
    prisma.kid_profile.findMany.mockResolvedValue([
      { id: 8n, name: 'Rahul', avatar_url: STOCK, user_id: null },
      { id: 9n, name: 'Maya', avatar_url: OWN, user_id: null },
    ]);

    const { items } = await adminService.listAllKidProfiles({ page: 1, limit: 50 });

    expect(items.map((kid) => kid.avatar_url)).toEqual([null, OWN]);
  });

  it("a family's kid list hides a stock photo too", async () => {
    prisma.kid_profile.findMany.mockResolvedValue([{ id: 8n, name: 'Rahul', avatar_url: STOCK }]);

    const [kid] = await adminService.getKidProfilesByUserId(6);

    expect(kid.avatar_url).toBeNull();
  });

  it('create drops an avatar that is not one of our uploads', async () => {
    await adminService.createKidProfileForUser(6, { name: 'Rahul', avatarUrl: STOCK });

    expect(prisma.kid_profile.create.mock.calls[0][0].data.avatar_url).toBeNull();
  });

  it('update ignores a stock photo but still allows setting ours or clearing', async () => {
    await adminService.updateKidProfile(8, { name: 'Rahul', avatarUrl: STOCK });
    expect(prisma.kid_profile.update.mock.calls[0][0].data).not.toHaveProperty('avatar_url');

    await adminService.updateKidProfile(8, { avatarUrl: OWN });
    expect(prisma.kid_profile.update.mock.calls[1][0].data.avatar_url).toBe(OWN);

    await adminService.updateKidProfile(8, { avatarUrl: null });
    expect(prisma.kid_profile.update.mock.calls[2][0].data.avatar_url).toBeNull();
  });
});
