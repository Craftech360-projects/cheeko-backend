'use strict';
jest.mock('../../src/services/contentKeys.service', () => ({
  registerDeviceSecret: jest.fn(async () => {}),
  isEnabled: () => true,
}));
jest.mock('../../src/config/database', () => ({ prisma: {
  ai_device: { findFirst: jest.fn(async () => null), findUnique: jest.fn(async () => null), update: jest.fn(), create: jest.fn() },
  sys_params: { findUnique: jest.fn(async () => null) },
  ai_ota: { findFirst: jest.fn(async () => null), findMany: jest.fn(async () => []) },
} }));

const contentKeys = require('../../src/services/contentKeys.service');
const deviceService = require('../../src/services/device.service');

beforeEach(() => {
  jest.clearAllMocks();
});

test('checkOtaVersion registers content_secret from the report and does not echo it', async () => {
  const secret = 'ab'.repeat(32);
  const res = await deviceService.checkOtaVersion('AA:BB:CC:DD:EE:FF', 'client', {
    version: '1.2.3', board: 'cheeko-v2', contentSecret: secret,
  });
  expect(contentKeys.registerDeviceSecret).toHaveBeenCalledWith('AA:BB:CC:DD:EE:FF', secret);
  expect(JSON.stringify(res)).not.toContain(secret);
});

test('a malformed content_secret is ignored, not fatal', async () => {
  contentKeys.registerDeviceSecret.mockRejectedValueOnce(new Error('content_secret must be 64 hex chars'));
  await expect(deviceService.checkOtaVersion('AA:BB:CC:DD:EE:FF', 'client', { version: '1', contentSecret: 'nope' })).resolves.toBeDefined();
});
