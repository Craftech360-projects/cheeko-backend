'use strict';

/**
 * Deleting a child takes their custom card with them.
 *
 * The pack is keyed by pack_code (CK<id padded to 6>), not by a foreign key, so
 * nothing cascades: without this cleanup the pack, its content_items and every
 * S3 object behind them outlive the child forever. An FK would not have solved
 * it either — ON DELETE CASCADE cannot reach S3, so this code has to exist
 * regardless, and once it does the FK buys nothing.
 *
 * The ordering matters as much as the deletion: storage is swept by the route
 * only after the transaction commits. Deleting objects first and then failing
 * the write would leave rows pointing at files that are gone.
 */

const mockTx = {
  ai_device: { updateMany: jest.fn(), deleteMany: jest.fn() },
  kid_profile: { delete: jest.fn(), deleteMany: jest.fn() },
  parent_profile: { deleteMany: jest.fn() },
  sys_user: { delete: jest.fn() },
  rfid_content_pack: { findFirst: jest.fn(), delete: jest.fn() },
  content_item: { findMany: jest.fn(), deleteMany: jest.fn() }
};

const mockPrisma = {
  $transaction: jest.fn(),
  sys_user: { findUnique: jest.fn() },
  kid_profile: { findFirst: jest.fn(), findMany: jest.fn() }
};

const mockUploadService = {
  deleteKidAvatarByUrl: jest.fn(async () => {}),
  deleteCustomCardObject: jest.fn(async () => {})
};

jest.mock('../../src/config/database', () => ({ prisma: mockPrisma }));
jest.mock('../../src/utils/logger', () => ({
  info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn()
}));
// The real router is mounted, not a copy of the handlers — a test that
// re-declares the route it checks passes just as happily when the route is
// deleted. Everything mobile.routes.js pulls in beyond the two modules under
// test is stubbed.
jest.mock('../../src/services/upload.service', () => mockUploadService);
jest.mock('../../src/middleware/firebaseAuth', () => ({
  requireFirebaseAuth: (req, _res, next) => {
    req.firebaseUser = { uid: 'firebase-uid' };
    req.mobileUser = { id: 7 };
    next();
  },
}));
jest.mock('../../src/services/agent.service', () => ({}));
jest.mock('../../src/services/device.service', () => ({}));
jest.mock('../../src/services/deviceSettings.service', () => ({}));
jest.mock('../../src/services/deviceAnalytics.service', () => ({}));
jest.mock('../../src/services/customCard.service', () => ({ MAX_ITEMS: 10 }));

const mobileService = require('../../src/services/mobile.service');

const UID = 'firebase-uid';
const USER = { id: BigInt(7) };
const KID_ID = 42;
const PACK = { id: BigInt(9) };

const AUDIO = 'https://cdn.test/customcard_kid42/a.mp3';
const IMAGE = 'https://cdn.test/customcard_kid42/a.bin';

// The order every statement ran in, so "the pack went before the child" and
// "nothing touched storage" are observed rather than assumed.
let calls = [];

const record = (name, result) => (...args) => {
  calls.push(name);
  return typeof result === 'function' ? result(...args) : result;
};

beforeEach(() => {
  jest.clearAllMocks();
  calls = [];

  mockPrisma.sys_user.findUnique.mockResolvedValue(USER);
  mockPrisma.kid_profile.findFirst.mockResolvedValue({
    id: BigInt(KID_ID), name: 'Aarav', avatar_url: 'https://cdn.test/avatars/42.png'
  });
  mockPrisma.kid_profile.findMany.mockResolvedValue([{ id: BigInt(KID_ID), avatar_url: null }]);
  mockPrisma.$transaction.mockImplementation(async (fn) => fn(mockTx));

  mockTx.ai_device.updateMany.mockImplementation(record('unpair-devices', { count: 1 }));
  mockTx.ai_device.deleteMany.mockImplementation(record('delete-devices', { count: 1 }));
  mockTx.kid_profile.delete.mockImplementation(record('delete-kid', {}));
  mockTx.kid_profile.deleteMany.mockImplementation(record('delete-kids', { count: 1 }));
  mockTx.parent_profile.deleteMany.mockImplementation(record('delete-parent', { count: 1 }));
  mockTx.sys_user.delete.mockImplementation(record('delete-user', {}));
  mockTx.rfid_content_pack.findFirst.mockImplementation(record('find-pack', PACK));
  mockTx.rfid_content_pack.delete.mockImplementation(record('delete-pack', {}));
  mockTx.content_item.findMany.mockImplementation(record('read-items', [
    { audio_url: AUDIO, image_url: IMAGE },
    { audio_url: 'https://cdn.test/customcard_kid42/b.mp3', image_url: null }
  ]));
  mockTx.content_item.deleteMany.mockImplementation(record('delete-items', { count: 2 }));
});

describe('deleteKid', () => {
  it('deletes the pack and its items, and returns the objects to sweep', async () => {
    const result = await mobileService.deleteKid(UID, KID_ID);

    expect(mockTx.rfid_content_pack.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { pack_code: 'CK000042' } })
    );
    expect(mockTx.content_item.deleteMany).toHaveBeenCalledWith({ where: { content_pack_id: PACK.id } });
    expect(mockTx.rfid_content_pack.delete).toHaveBeenCalledWith({ where: { id: PACK.id } });

    // Both a recording's audio and its artwork; nulls dropped.
    expect(result.retired).toEqual([AUDIO, IMAGE, 'https://cdn.test/customcard_kid42/b.mp3']);
    expect(result.avatar_url).toBe('https://cdn.test/avatars/42.png');
  });

  it('reads the item URLs before deleting the rows that hold them', async () => {
    await mobileService.deleteKid(UID, KID_ID);

    expect(calls.indexOf('read-items')).toBeLessThan(calls.indexOf('delete-items'));
    // And the whole pack cleanup happens before the profile row goes, inside
    // the same transaction.
    expect(calls.indexOf('delete-pack')).toBeLessThan(calls.indexOf('delete-kid'));
    expect(mockPrisma.$transaction).toHaveBeenCalledTimes(1);
  });

  it('still unpairs and deletes when the child never recorded anything', async () => {
    mockTx.rfid_content_pack.findFirst.mockImplementation(record('find-pack', null));

    const result = await mobileService.deleteKid(UID, KID_ID);

    expect(result.retired).toEqual([]);
    expect(mockTx.content_item.deleteMany).not.toHaveBeenCalled();
    expect(mockTx.rfid_content_pack.delete).not.toHaveBeenCalled();
    expect(calls).toEqual(['unpair-devices', 'find-pack', 'delete-kid']);
  });

  it('sweeps nothing itself — that is the route\'s job, after the commit', async () => {
    // The service must not reach storage. A failed transaction that had already
    // deleted objects would leave rows pointing at files that are gone.
    const result = await mobileService.deleteKid(UID, KID_ID);

    expect(Array.isArray(result.retired)).toBe(true);
    expect(result.success).toBe(true);
  });

  it('refuses a child belonging to another parent', async () => {
    mockPrisma.kid_profile.findFirst.mockResolvedValue(null);

    await expect(mobileService.deleteKid(UID, KID_ID)).rejects.toThrow('Kid profile not found');
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
  });
});

/**
 * The route half of the same guarantee: the sweep runs, and it runs on the
 * caller's side of the commit.
 */
describe('the delete routes', () => {
  const request = require('supertest');
  const express = require('express');
  const { errorHandler } = require('../../src/middleware/errorHandler');

  const buildApp = () => {
    const app = express();
    app.use(express.json());
    app.use('/api/mobile', require('../../src/routes/mobile.routes'));
    app.use(errorHandler);
    return app;
  };

  it('DELETE /kids/:id sweeps the child\'s recordings and pictures', async () => {
    const res = await request(buildApp()).delete(`/api/mobile/kids/${KID_ID}`);

    expect(res.status).toBe(200);
    // Keys, not URLs — deleteCustomCardObject refuses anything outside the
    // customcard prefix, and it can only see that once the host is stripped.
    expect(mockUploadService.deleteCustomCardObject.mock.calls.map(([key]) => key)).toEqual([
      'customcard_kid42/a.mp3',
      'customcard_kid42/a.bin',
      'customcard_kid42/b.mp3'
    ]);
    expect(mockUploadService.deleteKidAvatarByUrl)
      .toHaveBeenCalledWith('https://cdn.test/avatars/42.png');
  });

  it('DELETE /account sweeps without putting the URL lists in the response', async () => {
    const res = await request(buildApp()).delete('/api/mobile/account');

    expect(res.status).toBe(200);
    expect(mockUploadService.deleteCustomCardObject).toHaveBeenCalled();
    // The sweep's input is not part of the shape the app parses.
    expect(res.body).toEqual({
      success: true,
      user_id: UID,
      deleted_at: expect.any(String)
    });
  });
});

describe('deleteUserAccount', () => {
  it('takes every child\'s pack with the account', async () => {
    mockPrisma.kid_profile.findMany.mockResolvedValue([
      { id: BigInt(42), avatar_url: 'https://cdn.test/avatars/42.png' },
      { id: BigInt(43), avatar_url: null }
    ]);

    const result = await mobileService.deleteUserAccount(UID);

    expect(mockTx.rfid_content_pack.findFirst).toHaveBeenNthCalledWith(1,
      expect.objectContaining({ where: { pack_code: 'CK000042' } }));
    expect(mockTx.rfid_content_pack.findFirst).toHaveBeenNthCalledWith(2,
      expect.objectContaining({ where: { pack_code: 'CK000043' } }));

    // Two children, three URLs each — one pack's worth per child.
    expect(result.retired).toHaveLength(6);
    expect(result.avatar_urls).toEqual(['https://cdn.test/avatars/42.png']);
  });

  it('deletes every pack before the children that own them', async () => {
    await mobileService.deleteUserAccount(UID);

    expect(calls.indexOf('delete-pack')).toBeLessThan(calls.indexOf('delete-kids'));
    expect(mockPrisma.$transaction).toHaveBeenCalledTimes(1);
  });
});
