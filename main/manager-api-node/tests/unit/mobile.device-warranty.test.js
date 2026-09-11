/**
 * GET /api/mobile/devices/warranty — the warranty of a parent's own toys, for
 * the web onboarding page.
 *
 * The real router and the real warranty service are mounted; only the device
 * list and the database are stubbed. The property worth pinning beyond "it
 * returns the dates": a warranty outlives an unbind, so its record can name a
 * previous owner, and none of that may reach the current one.
 */

const mockListDevices = jest.fn();
const mockFindMany = jest.fn();

jest.mock('../../src/middleware/firebaseAuth', () => ({
  requireFirebaseAuth: (req, _res, next) => {
    req.mobileUser = { id: 6 };
    req.firebaseUser = { uid: 'test-uid' };
    next();
  },
}));
jest.mock('../../src/services/device.service', () => ({ listDevices: (...a) => mockListDevices(...a) }));
jest.mock('../../src/services/mobile.service', () => ({}));
jest.mock('../../src/services/agent.service', () => ({}));
jest.mock('../../src/services/deviceSettings.service', () => ({}));
jest.mock('../../src/services/deviceAnalytics.service', () => ({}));
jest.mock('../../src/services/upload.service', () => ({}));
jest.mock('../../src/services/customCard.service', () => ({}));
jest.mock('../../src/config/database', () => ({
  prisma: { device_warranty: { findMany: (...a) => mockFindMany(...a) } },
}));
jest.mock('../../src/utils/logger', () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }));

const request = require('supertest');
const express = require('express');
const { errorHandler } = require('../../src/middleware/errorHandler');

const buildApp = () => {
  const app = express();
  app.use(express.json());
  app.use('/', require('../../src/routes/mobile.routes'));
  app.use(errorHandler);
  return app;
};

const MAC_A = 'AA:BB:CC:DD:EE:01';
const MAC_B = 'AA:BB:CC:DD:EE:02';
const NOW = new Date('2026-09-10T12:00:00Z');

const device = (mac, extra = {}) => ({ id: 1, mac_address: mac, alias: null, device_name: null, user_id: 6, ...extra });
const listOf = (...devices) => ({ list: devices, total: devices.length, page: 1, limit: 100 });

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(Date, 'now').mockReturnValue(NOW.getTime());
  mockFindMany.mockResolvedValue([]);
});
afterEach(() => jest.restoreAllMocks());

describe('GET /devices/warranty', () => {
  it('lists only the calling parent\'s toys', async () => {
    mockListDevices.mockResolvedValue(listOf());

    await request(buildApp()).get('/devices/warranty').expect(200);

    expect(mockListDevices).toHaveBeenCalledWith(6, { page: 1, limit: 100 });
  });

  it('answers an empty list, and asks the database nothing, for an account with no toys', async () => {
    mockListDevices.mockResolvedValue(listOf());

    const res = await request(buildApp()).get('/devices/warranty').expect(200);

    expect(res.body.data).toEqual([]);
    expect(mockFindMany).not.toHaveBeenCalled();
  });

  it('reports an active warranty with its dates and days left', async () => {
    mockListDevices.mockResolvedValue(listOf(device(MAC_A, { alias: "Rohan's Cheeko" })));
    mockFindMany.mockResolvedValue([{
      mac_address: MAC_A,
      activated_at: new Date('2026-03-20T12:00:00Z'),
      warranty_start: new Date('2026-03-20T12:00:00Z'),
      warranty_end: new Date('2026-09-20T12:00:00Z'),
    }]);

    const res = await request(buildApp()).get('/devices/warranty').expect(200);

    expect(res.body.data).toEqual([{
      macAddress: MAC_A,
      deviceName: "Rohan's Cheeko",
      warranty: {
        registered: true,
        warrantyMonths: 6,
        warrantyStart: '2026-03-20T12:00:00.000Z',
        warrantyEnd: '2026-09-20T12:00:00.000Z',
        status: 'active',
        daysRemaining: 10,
      },
    }]);
  });

  it('reports an expired warranty with zero days left', async () => {
    mockListDevices.mockResolvedValue(listOf(device(MAC_A)));
    mockFindMany.mockResolvedValue([{
      mac_address: MAC_A,
      activated_at: null,
      warranty_start: new Date('2026-01-01T00:00:00Z'),
      warranty_end: new Date('2026-07-01T00:00:00Z'),
    }]);

    const res = await request(buildApp()).get('/devices/warranty').expect(200);

    expect(res.body.data[0].warranty).toMatchObject({ registered: true, status: 'expired', daysRemaining: 0 });
  });

  it('reports a toy with no record as not registered', async () => {
    mockListDevices.mockResolvedValue(listOf(device(MAC_A)));

    const res = await request(buildApp()).get('/devices/warranty').expect(200);

    expect(res.body.data[0].warranty).toEqual({
      registered: false,
      status: 'not_registered',
      warrantyStart: null,
      warrantyEnd: null,
      daysRemaining: null,
      warrantyMonths: 6,
    });
  });

  it('never shows the current owner who activated it before them, or the admin fields', async () => {
    mockListDevices.mockResolvedValue(listOf(device(MAC_A)));
    mockFindMany.mockResolvedValue([{
      mac_address: MAC_A,
      activated_at: new Date('2026-03-20T12:00:00Z'),
      warranty_start: new Date('2026-03-20T12:00:00Z'),
      warranty_end: new Date('2026-09-20T12:00:00Z'),
      first_user_id: 99, // the previous owner
      note: 'replacement unit — customer Priya, order #4471',
      updated_by: 1,
      update_date: new Date('2026-04-01T00:00:00Z'),
    }]);

    const res = await request(buildApp()).get('/devices/warranty').expect(200);

    const { warranty } = res.body.data[0];
    ['firstUser', 'first_user_id', 'note', 'updatedBy', 'updated_by', 'updateDate', 'update_date']
      .forEach(key => expect(warranty).not.toHaveProperty(key));
    expect(JSON.stringify(res.body)).not.toMatch(/Priya|4471|replacement/);
  });

  it('reads every toy\'s warranty in one query, and matches MACs however they are cased', async () => {
    mockListDevices.mockResolvedValue(listOf(device('aa:bb:cc:dd:ee:01'), device(MAC_B)));
    mockFindMany.mockResolvedValue([{
      mac_address: MAC_A,
      activated_at: null,
      warranty_start: new Date('2026-03-20T12:00:00Z'),
      warranty_end: new Date('2026-09-20T12:00:00Z'),
    }]);

    const res = await request(buildApp()).get('/devices/warranty').expect(200);

    expect(mockFindMany).toHaveBeenCalledTimes(1);
    expect(mockFindMany).toHaveBeenCalledWith({ where: { mac_address: { in: [MAC_A, MAC_B] } } });
    expect(res.body.data.map(d => d.warranty.status)).toEqual(['active', 'not_registered']);
  });

  it('names a toy with no alias the way the app does, never blank', async () => {
    mockListDevices.mockResolvedValue(listOf(device(MAC_A, { alias: '   ' })));

    const res = await request(buildApp()).get('/devices/warranty').expect(200);

    expect(typeof res.body.data[0].deviceName).toBe('string');
    expect(res.body.data[0].deviceName.trim()).not.toBe('');
  });
});
