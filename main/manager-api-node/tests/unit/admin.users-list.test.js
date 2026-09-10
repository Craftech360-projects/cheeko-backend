'use strict';

jest.mock('../../src/config/database', () => ({
  prisma: {
    sys_user: {
      count: jest.fn(),
      findMany: jest.fn(),
    },
    ai_device: {
      findMany: jest.fn(),
    },
  }
}));

const { prisma } = require('../../src/config/database');
const adminService = require('../../src/services/admin.service');

describe('admin.service listUsersForAdmin', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    prisma.ai_device.findMany.mockResolvedValue([]);
  });

  it('returns email, parent name and Firebase uid alongside the legacy mobile field', async () => {
    prisma.sys_user.count.mockResolvedValue(3);
    prisma.sys_user.findMany.mockResolvedValue([
      {
        id: 307n,
        username: 'HMPMVHzXcWcZWg28y88kSNaTY5s1',
        email: 'jane@example.com',
        firebase_uid: 'HMPMVHzXcWcZWg28y88kSNaTY5s1',
        status: 1,
        created_at: new Date('2026-09-01T00:00:00Z'),
        parent_profile: { display_name: 'Jane Doe', email: 'other@example.com' },
      },
      {
        id: 306n,
        username: 'I6wNDREwydNYErIP',
        email: null,
        firebase_uid: 'I6wNDREwydNYErIP',
        status: 1,
        created_at: new Date('2026-08-31T00:00:00Z'),
        parent_profile: { display_name: null, email: 'profile@example.com' },
      },
      {
        id: 12n,
        username: 'webadmin',
        email: null,
        firebase_uid: null,
        status: 0,
        created_at: new Date('2026-01-01T00:00:00Z'),
        parent_profile: null,
      },
    ]);

    const { list, total } = await adminService.listUsersForAdmin({ page: 1, limit: 10 });

    expect(total).toBe(3);
    expect(list[0]).toMatchObject({
      userid: 307n,
      mobile: 'HMPMVHzXcWcZWg28y88kSNaTY5s1',
      email: 'jane@example.com',
      parentName: 'Jane Doe',
      firebaseUid: 'HMPMVHzXcWcZWg28y88kSNaTY5s1',
    });
    // Falls back to the profile's email when sys_user has none
    expect(list[1]).toMatchObject({ email: 'profile@example.com', parentName: null });
    // Web-only account: no profile, no Firebase uid
    expect(list[2]).toMatchObject({ mobile: 'webadmin', email: null, parentName: null, firebaseUid: null });

    const args = prisma.sys_user.findMany.mock.calls[0][0];
    expect(args.select).toMatchObject({
      email: true,
      firebase_uid: true,
      parent_profile: { select: { display_name: true, email: true } },
    });
  });

  it('searches username, email, Firebase uid and parent name', async () => {
    prisma.sys_user.count.mockResolvedValue(0);
    prisma.sys_user.findMany.mockResolvedValue([]);

    await adminService.listUsersForAdmin({ page: 1, limit: 10, mobile: 'jane' });

    const match = { contains: 'jane', mode: 'insensitive' };
    const expectedWhere = {
      OR: [
        { username: match },
        { email: match },
        { firebase_uid: match },
        { parent_profile: { is: { display_name: match } } },
      ],
    };
    expect(prisma.sys_user.count).toHaveBeenCalledWith({ where: expectedWhere });
    expect(prisma.sys_user.findMany.mock.calls[0][0].where).toEqual(expectedWhere);
  });

  it('does not filter when no search term is given', async () => {
    prisma.sys_user.count.mockResolvedValue(0);
    prisma.sys_user.findMany.mockResolvedValue([]);

    await adminService.listUsersForAdmin({ page: 1, limit: 10 });

    expect(prisma.sys_user.findMany.mock.calls[0][0].where).toEqual({});
  });
});
