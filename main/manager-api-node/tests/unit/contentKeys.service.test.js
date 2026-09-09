'use strict';
const crypto = require('crypto');

const mockPrisma = {
  rfid_content_pack: { findFirst: jest.fn(), updateMany: jest.fn() },
  ai_device: { findFirst: jest.fn(), updateMany: jest.fn() },
  ai_agent_template: { findFirst: jest.fn(), updateMany: jest.fn() },
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
    expect(await svc.getPackKey('STORY01')).toBeNull();
    expect(await svc.getDeviceSecret('AA:BB:CC:DD:EE:FF')).toBeNull();
    expect(await svc.getCharacterKey('cheeko')).toBeNull();
    expect(await svc.getOrCreateCharacterKey('cheeko')).toBeNull();
    await svc.registerDeviceSecret('AA:BB:CC:DD:EE:FF', crypto.randomBytes(32).toString('hex'));
    expect(mockPrisma.rfid_content_pack.findFirst).not.toHaveBeenCalled();
    expect(mockPrisma.rfid_content_pack.updateMany).not.toHaveBeenCalled();
    expect(mockPrisma.ai_device.findFirst).not.toHaveBeenCalled();
    expect(mockPrisma.ai_device.updateMany).not.toHaveBeenCalled();
    expect(mockPrisma.ai_agent_template.findFirst).not.toHaveBeenCalled();
    expect(mockPrisma.ai_agent_template.updateMany).not.toHaveBeenCalled();
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

  test('getOrCreateCharacterKey creates a 16-byte key once and returns the same key after', async () => {
    const svc = require('../../src/services/contentKeys.service');
    const cc = require('../../src/utils/contentCrypto');
    let stored = null;
    let capturedArgs = null;
    mockPrisma.ai_agent_template.findFirst.mockImplementation(async () => ({ id: 3n, art_content_key: stored }));
    mockPrisma.ai_agent_template.updateMany.mockImplementation(async (args) => {
      capturedArgs = args;
      stored = args.data.art_content_key;
      return { count: 1 };
    });

    const k1 = await svc.getOrCreateCharacterKey('cheeko');
    expect(k1.length).toBe(16);
    expect(mockPrisma.ai_agent_template.updateMany).toHaveBeenCalledTimes(1);
    expect(cc.decryptAtRest(stored, Buffer.from(MASTER, 'hex'))).toEqual(k1);
    // Compare-and-swap guard: the update must only apply while the row is still keyless.
    expect(capturedArgs.where).toMatchObject({ id: 3n, art_content_key: null });

    const k2 = await svc.getOrCreateCharacterKey('cheeko');
    expect(k2).toEqual(k1);
    expect(mockPrisma.ai_agent_template.updateMany).toHaveBeenCalledTimes(1);
  });

  test('getOrCreateCharacterKey returns the winner\'s key when it loses the CAS race', async () => {
    const svc = require('../../src/services/contentKeys.service');
    const cc = require('../../src/utils/contentCrypto');
    const mk = Buffer.from(MASTER, 'hex');
    const winnerKey = crypto.randomBytes(16);
    const winnerEncrypted = cc.encryptAtRest(winnerKey, mk);

    // First read: no key yet, so we'll try to create one. Second read (after
    // losing the CAS): another caller's key is already in place.
    mockPrisma.ai_agent_template.findFirst
      .mockResolvedValueOnce({ id: 5n, art_content_key: null })
      .mockResolvedValueOnce({ art_content_key: winnerEncrypted });
    // Postgres reports 0 rows matched when the `art_content_key: null` guard
    // fails because someone else's write landed first.
    let capturedWhere = null;
    mockPrisma.ai_agent_template.updateMany.mockImplementation(async (args) => {
      capturedWhere = args.where;
      return { count: 0 };
    });

    const result = await svc.getOrCreateCharacterKey('cheeko');
    expect(capturedWhere).toMatchObject({ id: 5n, art_content_key: null });
    expect(result).toEqual(winnerKey);
  });

  test('getOrCreateCharacterKey returns null for an unknown sd_folder', async () => {
    const svc = require('../../src/services/contentKeys.service');
    mockPrisma.ai_agent_template.findFirst.mockResolvedValue(null);
    expect(await svc.getOrCreateCharacterKey('nope')).toBeNull();
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
