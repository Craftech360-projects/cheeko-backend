'use strict';
const crypto = require('crypto');

const mockPrisma = {
  rfid_content_pack: { findFirst: jest.fn(), updateMany: jest.fn() },
};
jest.mock('../../src/config/database', () => ({ prisma: mockPrisma }));

const MASTER = crypto.randomBytes(32).toString('hex');

describe('contentKeys.service', () => {
  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
    process.env.CONTENT_MASTER_KEY = MASTER;
  });
  afterEach(() => {
    delete process.env.CONTENT_MASTER_KEY;
    delete process.env.CONTENT_WRAP_SECRET;
  });

  test('isEnabled is false without CONTENT_MASTER_KEY and every getter returns null', async () => {
    delete process.env.CONTENT_MASTER_KEY;
    const svc = require('../../src/services/contentKeys.service');
    expect(svc.isEnabled()).toBe(false);
    expect(await svc.getOrCreatePackKey('STORY01')).toBeNull();
    expect(await svc.getPackKey('STORY01')).toBeNull();
    expect(mockPrisma.rfid_content_pack.findFirst).not.toHaveBeenCalled();
    expect(mockPrisma.rfid_content_pack.updateMany).not.toHaveBeenCalled();
  });

  // A wrong-length or non-hex secret must read as "no secret", not as a short
  // key: silently wrapping under a truncated secret is unrecoverable in the
  // field, because CTR gives the toy no way to notice.
  test('getWrapSecret accepts exactly 64 hex chars and rejects everything else', async () => {
    const svc = require('../../src/services/contentKeys.service');
    const secret = crypto.randomBytes(32).toString('hex');

    process.env.CONTENT_WRAP_SECRET = secret;
    expect(svc.getWrapSecret()).toEqual(Buffer.from(secret, 'hex'));
    expect(svc.getWrapSecret().length).toBe(32);

    process.env.CONTENT_WRAP_SECRET = secret.toUpperCase();
    expect(svc.getWrapSecret()).toEqual(Buffer.from(secret, 'hex'));

    for (const bad of ['', 'short', secret.slice(0, 62), secret + 'ab', 'z'.repeat(64)]) {
      process.env.CONTENT_WRAP_SECRET = bad;
      expect(svc.getWrapSecret()).toBeNull();
    }
    delete process.env.CONTENT_WRAP_SECRET;
    expect(svc.getWrapSecret()).toBeNull();
  });

  test('getOrCreatePackKey creates a 16-byte key once and returns the same key after', async () => {
    const svc = require('../../src/services/contentKeys.service');
    const cc = require('../../src/utils/contentCrypto');
    let stored = null;
    let capturedArgs = null;
    mockPrisma.rfid_content_pack.findFirst.mockImplementation(async () => ({ id: 7n, content_key: stored }));
    mockPrisma.rfid_content_pack.updateMany.mockImplementation(async (args) => {
      capturedArgs = args;
      stored = args.data.content_key;
      return { count: 1 };
    });

    const k1 = await svc.getOrCreatePackKey('STORY01');
    expect(k1.length).toBe(16);
    expect(mockPrisma.rfid_content_pack.updateMany).toHaveBeenCalledTimes(1);
    expect(cc.decryptAtRest(stored, Buffer.from(MASTER, 'hex'))).toEqual(k1);
    // Compare-and-swap guard: the update must only apply while the row is still keyless.
    expect(capturedArgs.where).toMatchObject({ id: 7n, content_key: null });

    const k2 = await svc.getOrCreatePackKey('STORY01');
    expect(k2).toEqual(k1);
    expect(mockPrisma.rfid_content_pack.updateMany).toHaveBeenCalledTimes(1);
  });

  test('getOrCreatePackKey returns the winner\'s key when it loses the CAS race', async () => {
    const svc = require('../../src/services/contentKeys.service');
    const cc = require('../../src/utils/contentCrypto');
    const mk = Buffer.from(MASTER, 'hex');
    const winnerKey = crypto.randomBytes(16);
    const winnerEncrypted = cc.encryptAtRest(winnerKey, mk);

    // First read: no key yet, so we'll try to create one. Second read (after
    // losing the CAS): another caller's key is already in place.
    mockPrisma.rfid_content_pack.findFirst
      .mockResolvedValueOnce({ id: 9n, content_key: null })
      .mockResolvedValueOnce({ content_key: winnerEncrypted });
    // Postgres reports 0 rows matched when the `content_key: null` guard fails
    // because someone else's write landed first.
    let capturedWhere = null;
    mockPrisma.rfid_content_pack.updateMany.mockImplementation(async (args) => {
      capturedWhere = args.where;
      return { count: 0 };
    });

    const result = await svc.getOrCreatePackKey('STORY01');
    expect(capturedWhere).toMatchObject({ id: 9n, content_key: null });
    expect(result).toEqual(winnerKey);
  });

  test('getOrCreatePackKey returns null for an unknown pack code', async () => {
    const svc = require('../../src/services/contentKeys.service');
    mockPrisma.rfid_content_pack.findFirst.mockResolvedValue(null);
    expect(await svc.getOrCreatePackKey('NOPE')).toBeNull();
  });
});
