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
    device_kid_assignment: {
      findFirst: jest.fn(),
      updateMany: jest.fn(),
      create: jest.fn(),
    },
    quiz_question_answer: { updateMany: jest.fn() },
    riddle_question_answer: { updateMany: jest.fn() },
    device_workspace_artifacts: { updateMany: jest.fn() },
    device_memory_documents: { updateMany: jest.fn() },
    device_memory_chunks: { updateMany: jest.fn() },
    imagine_image: { updateMany: jest.fn() },
    $transaction: jest.fn(),
  }
}));

const { prisma } = require('../../src/config/database');
const deviceService = require('../../src/services/device.service');

describe('device.service mobile ownership helpers', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    prisma.$transaction.mockImplementation((fn) => fn(prisma));
    prisma.device_kid_assignment.findFirst.mockResolvedValue(null);
    prisma.device_kid_assignment.updateMany.mockResolvedValue({ count: 0 });
    prisma.device_kid_assignment.create.mockResolvedValue({ id: 1n });
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

  // Re-pairing used to throw 'Device already has a child assigned', which made a
  // wrong pairing permanent — the app's kid picker could never correct it. The
  // boundary this covered is kept: the incoming child must belong to the caller.
  it('re-pairs a device that already has a different child', async () => {
    prisma.kid_profile.findFirst.mockResolvedValue({ id: 9n });
    prisma.ai_device.findFirst.mockResolvedValue({
      id: 'device-1',
      mac_address: 'AA:BB:CC:DD:EE:FF',
      kid_id: 7n,
    });
    prisma.ai_device.update.mockResolvedValue({ id: 'device-1', kid_id: 9n });

    await expect(
      deviceService.assignKidByMac('AA:BB:CC:DD:EE:FF', '9', 12n),
    ).resolves.toEqual({ id: 'device-1', kid_id: 9n });

    expect(prisma.ai_device.update).toHaveBeenCalled();
  });

  it('refuses a child that does not belong to the caller', async () => {
    prisma.kid_profile.findFirst.mockResolvedValue(null);

    await expect(
      deviceService.assignKidByMac('AA:BB:CC:DD:EE:FF', '9', 12n),
    ).rejects.toThrow('Kid profile not found');

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
