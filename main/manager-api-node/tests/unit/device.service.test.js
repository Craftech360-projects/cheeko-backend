'use strict';

jest.mock('../../src/config/database', () => ({
  prisma: {
    ai_device: {
      findFirst: jest.fn()
    }
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
});
