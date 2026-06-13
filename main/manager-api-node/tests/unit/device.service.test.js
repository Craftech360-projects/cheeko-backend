'use strict';

jest.mock('../../src/config/database', () => ({
  prisma: {
    ai_device: {
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    kid_profile: {
      findFirst: jest.fn(),
    },
  }
}));

const { prisma } = require('../../src/config/database');
const deviceService = require('../../src/services/device.service');

describe('device.service mobile ownership helpers', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns the device only when the normalized MAC belongs to the user', async () => {
    prisma.ai_device.findFirst.mockResolvedValue({
      id: 'device-1',
      mac_address: 'AA:BB:CC:DD:EE:FF',
      user_id: 12n
    });

    const device = await deviceService.getOwnedDeviceByMac(12n, 'aabbccddeeff');

    expect(prisma.ai_device.findFirst).toHaveBeenCalledWith({
      where: {
        mac_address: 'AA:BB:CC:DD:EE:FF',
        user_id: 12n
      }
    });
    expect(device).toEqual({
      id: 'device-1',
      mac_address: 'AA:BB:CC:DD:EE:FF',
      user_id: 12n
    });
  });

  it('returns null for invalid MAC values before querying', async () => {
    const device = await deviceService.getOwnedDeviceByMac(12n, 'not-a-mac');

    expect(device).toBeNull();
    expect(prisma.ai_device.findFirst).not.toHaveBeenCalled();
  });

  it('rejects assigning a different child to a device that already has one', async () => {
    prisma.kid_profile.findFirst.mockResolvedValue({ id: 9n });
    prisma.ai_device.findFirst.mockResolvedValue({
      id: 'device-1',
      kid_id: 7n,
    });

    await expect(
      deviceService.assignKidByMac('AA:BB:CC:DD:EE:FF', '9', 12n),
    ).rejects.toThrow('Device already has a child assigned');

    expect(prisma.ai_device.update).not.toHaveBeenCalled();
  });

  it('allows assigning the same child id again for idempotent saves', async () => {
    prisma.kid_profile.findFirst.mockResolvedValue({ id: 7n });
    prisma.ai_device.findFirst.mockResolvedValue({
      id: 'device-1',
      kid_id: 7n,
    });
    prisma.ai_device.update.mockResolvedValue({ id: 'device-1', kid_id: 7n });

    await expect(
      deviceService.assignKidByMac('AA:BB:CC:DD:EE:FF', '7', 12n),
    ).resolves.toEqual({ id: 'device-1', kid_id: 7n });

    expect(prisma.ai_device.update).toHaveBeenCalled();
  });
});
