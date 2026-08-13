/**
 * resolveOwnerKeyForMac is what the worker names its local workspace directory
 * from, so the cases that matter are the ones where the directory would
 * otherwise carry the wrong child: a paired toy, a handed-on toy, and a device
 * the manager has never heard of.
 */

describe('resolveOwnerKeyForMac', () => {
  let prisma;
  let workspaceService;

  const MAC = '00:16:3E:7A:11:C4';

  beforeEach(() => {
    jest.resetModules();
    prisma = { ai_device: { findFirst: jest.fn(), findUnique: jest.fn() } };
    jest.doMock('../../src/config/database', () => ({ prisma }));
    jest.doMock('../../src/utils/logger', () => ({ warn: jest.fn(), info: jest.fn(), error: jest.fn() }));
    workspaceService = require('../../src/services/workspace.service');
  });

  const stubDevice = (device) => {
    prisma.ai_device.findFirst.mockResolvedValue(device);
    prisma.ai_device.findUnique.mockResolvedValue(device);
  };

  test('a paired toy belongs to the child', async () => {
    stubDevice({ mac_address: MAC, kid_id: 1n });
    await expect(workspaceService.resolveOwnerKeyForMac(MAC)).resolves.toBe('kid:1');
  });

  test('the same child on a different toy gets the same key', async () => {
    stubDevice({ mac_address: 'AA:BB:CC:DD:EE:FF', kid_id: 1n });
    await expect(workspaceService.resolveOwnerKeyForMac('AA:BB:CC:DD:EE:FF')).resolves.toBe('kid:1');
  });

  test('an unpaired toy falls back to its own MAC, lowercased', async () => {
    stubDevice({ mac_address: MAC, kid_id: null });
    await expect(workspaceService.resolveOwnerKeyForMac(MAC)).resolves.toBe('mac:00:16:3e:7a:11:c4');
  });

  test('an unknown device returns null rather than throwing', async () => {
    stubDevice(null);
    await expect(workspaceService.resolveOwnerKeyForMac(MAC)).resolves.toBeNull();
  });

  test('a malformed MAC returns null without touching the database', async () => {
    await expect(workspaceService.resolveOwnerKeyForMac('not-a-mac')).resolves.toBeNull();
    expect(prisma.ai_device.findFirst).not.toHaveBeenCalled();
    expect(prisma.ai_device.findUnique).not.toHaveBeenCalled();
  });
});
