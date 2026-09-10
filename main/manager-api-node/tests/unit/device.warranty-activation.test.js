'use strict';

// The warranty starts on a toy's first 6-digit activation and never again:
// unbinding and re-binding it, to the same family or a new one, must not
// restart it. The unique MAC in device_warranty does the "never again"; these
// pin that bindDevice always asks for it with skipDuplicates, and only on the
// 6-digit path.

jest.mock('../../src/config/database', () => ({
  prisma: {
    ai_device: { findUnique: jest.fn(), findMany: jest.fn(), update: jest.fn(), create: jest.fn() },
    ai_agent: { findFirst: jest.fn() },
    kid_profile: { findFirst: jest.fn(), findMany: jest.fn() },
    device_warranty: { createMany: jest.fn() },
    $transaction: jest.fn(),
  },
}));

const { prisma } = require('../../src/config/database');
const deviceService = require('../../src/services/device.service');

const MAC = 'AA:BB:CC:DD:EE:FF';
const AGENT = 'agent-1';
const CODE = '123456';

const seedCode = () => deviceService._activationCodeCache.set(CODE, {
  macAddress: MAC, board: 'doit-ai-01-kit', appVersion: '1.7.6', createdAt: Date.now(),
});

beforeEach(() => {
  jest.clearAllMocks();
  deviceService._activationCodeCache.clear();
  prisma.$transaction.mockImplementation((fn) => fn(prisma));
  prisma.ai_agent.findFirst.mockResolvedValue({ id: AGENT });
  prisma.kid_profile.findMany.mockResolvedValue([]); // no child: pairing is skipped
  prisma.device_warranty.createMany.mockResolvedValue({ count: 1 });
  prisma.ai_device.create.mockImplementation(async ({ data }) => ({ id: 'device-1', ...data }));
  prisma.ai_device.update.mockImplementation(async ({ data }) => ({ id: 'device-1', ...data }));
});

it('starts the warranty when a new toy is first activated with its code', async () => {
  seedCode();
  prisma.ai_device.findUnique.mockResolvedValue(null);

  await deviceService.bindDevice(12, AGENT, CODE);

  expect(prisma.device_warranty.createMany).toHaveBeenCalledTimes(1);
  const { data: [row], skipDuplicates } = prisma.device_warranty.createMany.mock.calls[0][0];
  expect(skipDuplicates).toBe(true);
  expect(row).toMatchObject({ mac_address: MAC, first_user_id: 12n });
  expect(row.warranty_start).toEqual(row.activated_at);
  const end = new Date(row.activated_at);
  end.setUTCMonth(end.getUTCMonth() + 6);
  // Same instant unless the start day is past the 28th, where addMonths clamps.
  expect(row.warranty_end.getTime()).toBeLessThanOrEqual(end.getTime());
  expect(deviceService._activationCodeCache.has(CODE)).toBe(false);
});

it('re-activating an unbound toy with a new code leaves an existing warranty alone', async () => {
  seedCode();
  prisma.ai_device.findUnique.mockResolvedValue({ id: 'device-1', mac_address: MAC, user_id: null, kid_id: null });
  prisma.device_warranty.createMany.mockResolvedValue({ count: 0 }); // the unique MAC skipped it

  await deviceService.bindDevice(34, AGENT, CODE);

  expect(prisma.device_warranty.createMany).toHaveBeenCalledWith(
    expect.objectContaining({ skipDuplicates: true }),
  );
});

it('binding by MAC instead of a code never starts a warranty', async () => {
  prisma.ai_device.findUnique.mockResolvedValue({ id: 'device-1', mac_address: MAC, user_id: null, kid_id: null });

  await deviceService.bindDevice(12, AGENT, MAC);

  expect(prisma.ai_device.update).toHaveBeenCalled();
  expect(prisma.device_warranty.createMany).not.toHaveBeenCalled();
});

it('a failed warranty write fails the bind, so no toy is bound without one', async () => {
  seedCode();
  prisma.ai_device.findUnique.mockResolvedValue(null);
  prisma.device_warranty.createMany.mockRejectedValue(new Error('db down'));

  await expect(deviceService.bindDevice(12, AGENT, CODE)).rejects.toThrow('db down');
  expect(deviceService._activationCodeCache.has(CODE)).toBe(true); // the parent can retry
});
