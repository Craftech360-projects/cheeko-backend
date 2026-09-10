'use strict';
const crypto = require('crypto');

const mockPrisma = {
  rfid_card_mapping: { findFirst: jest.fn() },
  rfid_content_pack: { findFirst: jest.fn() },
  rfid_series: { findFirst: jest.fn() },
  custom_card: { findFirst: jest.fn() },
  ai_agent_template: { findFirst: jest.fn() },
  $queryRaw: jest.fn(async () => []),
  $queryRawUnsafe: jest.fn(async () => []),
};
jest.mock('../../src/config/database', () => ({ prisma: mockPrisma }));

const K = crypto.randomBytes(16);
const S = crypto.randomBytes(32);
const mockKeys = {
  isEnabled: jest.fn(() => true),
  getPackKey: jest.fn(async () => K),
  getDeviceSecret: jest.fn(async () => S),
};
jest.mock('../../src/services/contentKeys.service', () => mockKeys);

const rfid = require('../../src/services/rfid.service');
const cc = require('../../src/utils/contentCrypto');

const PACK = { id: 7n, pack_code: 'STORY01', name: 'Jungle', content_type: 'story_pack', version: '2', content_hash: 'h' };

beforeEach(() => {
  jest.clearAllMocks();
  mockPrisma.rfid_card_mapping.findFirst.mockResolvedValue({ id: 1n, content_pack_id: 7n, card_type: 'content' });
  mockPrisma.rfid_content_pack.findFirst.mockResolvedValue(PACK);
});

test('content pack lookup carries a wrapped key the device secret can unwrap', async () => {
  const res = await rfid.lookupCardByUid('04A1B2C3', 'AA:BB:CC:DD:EE:FF');
  expect(res.encryption.v).toBe(2);
  const wrapKey = crypto.createHmac('sha256', S).update(cc.WRAP_INFO).digest().subarray(0, 16);
  const iv = Buffer.concat([Buffer.from(res.encryption.nonce, 'hex'), Buffer.alloc(8, 0)]);
  expect(crypto.createDecipheriv('aes-128-ctr', wrapKey, iv).update(Buffer.from(res.encryption.key, 'hex'))).toEqual(K);
  expect(mockKeys.getDeviceSecret).toHaveBeenCalledWith('AA:BB:CC:DD:EE:FF');
});

test('no field when the pack has no key', async () => {
  mockKeys.getPackKey.mockResolvedValueOnce(null);
  const res = await rfid.lookupCardByUid('04A1B2C3', 'AA:BB:CC:DD:EE:FF');
  expect(res.encryption).toBeUndefined();
});

test('no field, and no error, when the device has no secret (unknown mac or mainboard swap)', async () => {
  mockKeys.getDeviceSecret.mockResolvedValueOnce(null);
  const res = await rfid.lookupCardByUid('04A1B2C3', 'AA:BB:CC:DD:EE:FF');
  expect(res.encryption).toBeUndefined();
  expect(res.packCode).toBe('STORY01');
});

test('no field when no mac was supplied', async () => {
  const res = await rfid.lookupCardByUid('04A1B2C3', undefined);
  expect(res.encryption).toBeUndefined();
});

test('download manifest carries a wrapped key the device secret can unwrap', async () => {
  const res = await rfid.getContentDownloadManifest('04A1B2C3', 'AA:BB:CC:DD:EE:FF');
  expect(res.encryption.v).toBe(2);
  const wrapKey = crypto.createHmac('sha256', S).update(cc.WRAP_INFO).digest().subarray(0, 16);
  const iv = Buffer.concat([Buffer.from(res.encryption.nonce, 'hex'), Buffer.alloc(8, 0)]);
  expect(crypto.createDecipheriv('aes-128-ctr', wrapKey, iv).update(Buffer.from(res.encryption.key, 'hex'))).toEqual(K);
});

test('download manifest has no encryption field when the device has no secret', async () => {
  mockKeys.getDeviceSecret.mockResolvedValueOnce(null);
  const res = await rfid.getContentDownloadManifest('04A1B2C3', 'AA:BB:CC:DD:EE:FF');
  expect(res.encryption).toBeUndefined();
  expect(res.packCode).toBe('STORY01');
});
