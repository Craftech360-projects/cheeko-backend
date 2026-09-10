'use strict';

jest.mock('../../src/config/database', () => ({
  prisma: {
    device_warranty: { findUnique: jest.fn(), upsert: jest.fn(), deleteMany: jest.fn() },
    sys_user: { findMany: jest.fn() },
  },
}));

const { prisma } = require('../../src/config/database');
const warranty = require('../../src/services/warranty.service');

const MAC = 'AA:BB:CC:DD:EE:FF';
const NOW = new Date('2026-09-10T12:00:00Z');

describe('addMonths', () => {
  it('clamps to the last day of a shorter month', () => {
    expect(warranty.addMonths(new Date('2026-08-31T10:00:00Z'), 6).toISOString()).toBe('2027-02-28T10:00:00.000Z');
    expect(warranty.addMonths(new Date('2027-08-31T10:00:00Z'), 6).toISOString()).toBe('2028-02-29T10:00:00.000Z');
  });

  it('keeps the day and time when the target month has it', () => {
    expect(warranty.addMonths(new Date('2026-01-15T08:30:00Z'), 6).toISOString()).toBe('2026-07-15T08:30:00.000Z');
  });
});

describe('startWarrantyIfNew', () => {
  it('inserts start + 6 months and lets the unique MAC skip every later activation', async () => {
    const tx = { device_warranty: { createMany: jest.fn(async () => ({ count: 1 })) } };

    await warranty.startWarrantyIfNew(tx, { macAddress: MAC, userId: 12, at: NOW });

    expect(tx.device_warranty.createMany).toHaveBeenCalledWith({
      data: [{
        mac_address: MAC,
        activated_at: NOW,
        warranty_start: NOW,
        warranty_end: new Date('2027-03-10T12:00:00Z'),
        first_user_id: 12n,
      }],
      skipDuplicates: true,
    });
  });
});

describe('getWarrantyByMac', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    jest.setSystemTime(NOW);
    prisma.sys_user.findMany.mockResolvedValue([
      { id: 12n, username: 'u12', email: null, parent_profile: { display_name: 'Priya' } },
      { id: 1n, username: 'admin', email: null, parent_profile: null },
    ]);
  });
  afterEach(() => jest.useRealTimers());

  it('reports a toy with no record as not registered', async () => {
    prisma.device_warranty.findUnique.mockResolvedValue(null);

    await expect(warranty.getWarrantyByMac('aabbccddeeff')).resolves.toEqual({
      macAddress: MAC, registered: false, status: 'not_registered', warrantyMonths: 6,
    });
    expect(prisma.device_warranty.findUnique).toHaveBeenCalledWith({ where: { mac_address: MAC } });
  });

  it('reports an active warranty with days left and who registered it', async () => {
    prisma.device_warranty.findUnique.mockResolvedValue({
      mac_address: MAC,
      activated_at: new Date('2026-09-01T00:00:00Z'),
      warranty_start: new Date('2026-09-01T00:00:00Z'),
      warranty_end: new Date('2026-09-20T12:00:00Z'),
      first_user_id: 12n,
      note: null,
      updated_by: 1n,
      update_date: null,
    });

    const result = await warranty.getWarrantyByMac(MAC);

    expect(result).toMatchObject({
      registered: true,
      status: 'active',
      daysRemaining: 10,
      firstUser: { id: 12n, name: 'Priya' },
      updatedBy: { id: 1n, name: 'admin' },
    });
  });

  it('reports an expired warranty with zero days left', async () => {
    prisma.device_warranty.findUnique.mockResolvedValue({
      mac_address: MAC,
      activated_at: null,
      warranty_start: new Date('2026-01-01T00:00:00Z'),
      warranty_end: new Date('2026-07-01T00:00:00Z'),
      first_user_id: null,
      updated_by: null,
    });

    await expect(warranty.getWarrantyByMac(MAC)).resolves.toMatchObject({
      status: 'expired', daysRemaining: 0, firstUser: null,
    });
    expect(prisma.sys_user.findMany).not.toHaveBeenCalled();
  });

  it('rejects a malformed MAC before querying', async () => {
    await expect(warranty.getWarrantyByMac('not-a-mac')).rejects.toMatchObject({ statusCode: 400 });
    expect(prisma.device_warranty.findUnique).not.toHaveBeenCalled();
  });
});

describe('upsertWarranty', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    prisma.device_warranty.upsert.mockResolvedValue({});
    prisma.device_warranty.findUnique.mockResolvedValue(null);
  });

  it('refuses an end date before the start date', async () => {
    await expect(
      warranty.upsertWarranty(MAC, { warrantyStart: '2026-09-10', warrantyEnd: '2026-09-01' }, 1),
    ).rejects.toMatchObject({ statusCode: 400 });
    expect(prisma.device_warranty.upsert).not.toHaveBeenCalled();
  });

  it('refuses a missing or invalid start date', async () => {
    await expect(warranty.upsertWarranty(MAC, {}, 1)).rejects.toMatchObject({ statusCode: 400 });
    await expect(warranty.upsertWarranty(MAC, { warrantyStart: 'nope' }, 1)).rejects.toMatchObject({ statusCode: 400 });
    expect(prisma.device_warranty.upsert).not.toHaveBeenCalled();
  });

  it('defaults the end to start + 6 months and never invents an activation time', async () => {
    await warranty.upsertWarranty(MAC, { warrantyStart: '2026-09-10', note: '  replaced unit ' }, 1);

    const { where, create, update } = prisma.device_warranty.upsert.mock.calls[0][0];
    expect(where).toEqual({ mac_address: MAC });
    expect(create).toMatchObject({
      mac_address: MAC,
      warranty_start: new Date('2026-09-10'),
      warranty_end: new Date('2027-03-10'),
      note: 'replaced unit',
      updated_by: 1n,
    });
    expect(create).not.toHaveProperty('activated_at');
    expect(update).not.toHaveProperty('activated_at');
  });
});

describe('deleteWarranty', () => {
  it('removes the record so the next activation starts afresh', async () => {
    prisma.device_warranty.deleteMany.mockResolvedValue({ count: 1 });

    await expect(warranty.deleteWarranty('aa-bb-cc-dd-ee-ff')).resolves.toEqual({ macAddress: MAC, deleted: true });
    expect(prisma.device_warranty.deleteMany).toHaveBeenCalledWith({ where: { mac_address: MAC } });
  });
});
