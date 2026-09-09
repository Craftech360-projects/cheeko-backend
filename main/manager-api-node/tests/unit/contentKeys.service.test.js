'use strict';
const crypto = require('crypto');

const mockPrisma = {
  rfid_content_pack: { findFirst: jest.fn(), updateMany: jest.fn() },
  ai_device: { findFirst: jest.fn(), updateMany: jest.fn() },
};
jest.mock('../../src/config/database', () => ({ prisma: mockPrisma }));

const MASTER = crypto.randomBytes(32).toString('hex');

describe('contentKeys.service', () => {
  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
    process.env.CONTENT_MASTER_KEY = MASTER;
  });
  afterEach(() => { delete process.env.CONTENT_MASTER_KEY; });

  test('isEnabled is false without CONTENT_MASTER_KEY and every getter returns null', async () => {
    delete process.env.CONTENT_MASTER_KEY;
    const svc = require('../../src/services/contentKeys.service');
    expect(svc.isEnabled()).toBe(false);
    expect(await svc.getOrCreatePackKey('STORY01')).toBeNull();
    expect(await svc.getDeviceSecret('AA:BB:CC:DD:EE:FF')).toBeNull();
    expect(mockPrisma.rfid_content_pack.findFirst).not.toHaveBeenCalled();
  });

  test('getOrCreatePackKey creates a 16-byte key once and returns the same key after', async () => {
    const svc = require('../../src/services/contentKeys.service');
    const cc = require('../../src/utils/contentCrypto');
    let stored = null;
    mockPrisma.rfid_content_pack.findFirst.mockImplementation(async () => ({ id: 7n, content_key: stored }));
    mockPrisma.rfid_content_pack.updateMany.mockImplementation(async ({ data }) => { stored = data.content_key; return { count: 1 }; });

    const k1 = await svc.getOrCreatePackKey('STORY01');
    expect(k1.length).toBe(16);
    expect(mockPrisma.rfid_content_pack.updateMany).toHaveBeenCalledTimes(1);
    expect(cc.decryptAtRest(stored, Buffer.from(MASTER, 'hex'))).toEqual(k1);

    const k2 = await svc.getOrCreatePackKey('STORY01');
    expect(k2).toEqual(k1);
    expect(mockPrisma.rfid_content_pack.updateMany).toHaveBeenCalledTimes(1);
  });

  test('getOrCreatePackKey returns null for an unknown pack code', async () => {
    const svc = require('../../src/services/contentKeys.service');
    mockPrisma.rfid_content_pack.findFirst.mockResolvedValue(null);
    expect(await svc.getOrCreatePackKey('NOPE')).toBeNull();
  });

  test('registerDeviceSecret stores encrypted, normalises the mac, and rejects bad input', async () => {
    const svc = require('../../src/services/contentKeys.service');
    const cc = require('../../src/utils/contentCrypto');
    const secret = crypto.randomBytes(32).toString('hex');
    mockPrisma.ai_device.updateMany.mockResolvedValue({ count: 1 });

    await svc.registerDeviceSecret('aa-bb-cc-dd-ee-ff', secret);
    const call = mockPrisma.ai_device.updateMany.mock.calls[0][0];
    expect(call.where.mac_address).toBe('AA:BB:CC:DD:EE:FF');
    expect(cc.decryptAtRest(call.data.content_secret, Buffer.from(MASTER, 'hex')).toString('hex')).toBe(secret);

    await expect(svc.registerDeviceSecret('AA:BB:CC:DD:EE:FF', 'short')).rejects.toThrow('content_secret must be 64 hex chars');
  });

  test('getDeviceSecret decrypts, and returns null when the column is empty', async () => {
    const svc = require('../../src/services/contentKeys.service');
    const cc = require('../../src/utils/contentCrypto');
    const s = crypto.randomBytes(32);
    mockPrisma.ai_device.findFirst.mockResolvedValue({ content_secret: cc.encryptAtRest(s, Buffer.from(MASTER, 'hex')) });
    expect(await svc.getDeviceSecret('AA:BB:CC:DD:EE:FF')).toEqual(s);

    mockPrisma.ai_device.findFirst.mockResolvedValue({ content_secret: null });
    expect(await svc.getDeviceSecret('AA:BB:CC:DD:EE:FF')).toBeNull();
  });
});
