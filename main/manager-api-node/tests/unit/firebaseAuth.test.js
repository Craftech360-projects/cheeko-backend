'use strict';

jest.mock('firebase-admin', () => ({
  apps: [{}],
  auth: jest.fn(),
}));

jest.mock('../../src/config/database', () => ({
  prisma: {
    sys_user: {
      findFirst: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    }
  }
}));

const admin = require('firebase-admin');
const { prisma } = require('../../src/config/database');
const { requireFirebaseAuth } = require('../../src/middleware/firebaseAuth');

describe('firebaseAuth middleware', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('creates first-login mobile users with a UID-based unique username', async () => {
    admin.auth.mockReturnValue({
      verifyIdToken: jest.fn().mockResolvedValue({
        uid: 'firebase-uid-123',
        email: 'parent@example.com'
      })
    });
    prisma.sys_user.findFirst.mockResolvedValue(null);
    prisma.sys_user.create.mockResolvedValue({ id: 10n, firebase_uid: 'firebase-uid-123' });

    const req = {
      headers: { authorization: 'Bearer firebase-token' }
    };
    const res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn()
    };
    const next = jest.fn();

    await requireFirebaseAuth(req, res, next);

    expect(prisma.sys_user.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        firebase_uid: 'firebase-uid-123',
        email: 'parent@example.com',
        username: 'firebase-uid-123'
      })
    });
    expect(next).toHaveBeenCalled();
  });

  it('stores null email when Firebase does not provide one', async () => {
    admin.auth.mockReturnValue({
      verifyIdToken: jest.fn().mockResolvedValue({
        uid: 'firebase-uid-no-email',
        email: null
      })
    });
    prisma.sys_user.findFirst.mockResolvedValue(null);
    prisma.sys_user.create.mockResolvedValue({
      id: 11n,
      firebase_uid: 'firebase-uid-no-email'
    });

    const req = {
      headers: { authorization: 'Bearer firebase-token' }
    };
    const res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn()
    };
    const next = jest.fn();

    await requireFirebaseAuth(req, res, next);

    expect(prisma.sys_user.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        firebase_uid: 'firebase-uid-no-email',
        email: null,
        username: 'firebase-uid-no-email'
      })
    });
    expect(next).toHaveBeenCalled();
  });

  it('links an existing email user to a new Firebase UID instead of creating a duplicate email', async () => {
    admin.auth.mockReturnValue({
      verifyIdToken: jest.fn().mockResolvedValue({
        uid: 'new-firebase-uid',
        email: 'parent@example.com'
      })
    });
    prisma.sys_user.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: 22n, email: 'parent@example.com', firebase_uid: null });
    prisma.sys_user.update = jest.fn().mockResolvedValue({
      id: 22n,
      email: 'parent@example.com',
      firebase_uid: 'new-firebase-uid'
    });

    const req = {
      headers: { authorization: 'Bearer firebase-token' }
    };
    const res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn()
    };
    const next = jest.fn();

    await requireFirebaseAuth(req, res, next);

    expect(prisma.sys_user.create).not.toHaveBeenCalled();
    expect(prisma.sys_user.update).toHaveBeenCalledWith({
      where: { id: 22n },
      data: { firebase_uid: 'new-firebase-uid', username: 'new-firebase-uid' }
    });
    expect(next).toHaveBeenCalled();
  });

  it('recovers from duplicate email create races by linking the existing user', async () => {
    admin.auth.mockReturnValue({
      verifyIdToken: jest.fn().mockResolvedValue({
        uid: 'firebase-uid-race',
        email: 'parent@example.com'
      })
    });
    prisma.sys_user.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        id: 30n,
        email: 'parent@example.com',
        firebase_uid: null
      });
    prisma.sys_user.create.mockRejectedValue({
      code: 'P2002',
      meta: { target: ['email'] },
      message: 'Unique constraint failed on the fields: (`email`)'
    });
    prisma.sys_user.update.mockResolvedValue({
      id: 30n,
      email: 'parent@example.com',
      firebase_uid: 'firebase-uid-race'
    });

    const req = {
      headers: { authorization: 'Bearer firebase-token' }
    };
    const res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn()
    };
    const next = jest.fn();

    await requireFirebaseAuth(req, res, next);

    expect(prisma.sys_user.create).toHaveBeenCalled();
    expect(prisma.sys_user.update).toHaveBeenCalledWith({
      where: { id: 30n },
      data: { firebase_uid: 'firebase-uid-race', username: 'firebase-uid-race' }
    });
    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });
});
