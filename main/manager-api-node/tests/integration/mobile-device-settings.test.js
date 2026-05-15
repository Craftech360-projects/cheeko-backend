const request = require('supertest');
const app = require('../../src/app');

const BASE = '/toy/api/mobile';

describe('Mobile Device Settings Routes', () => {
  it('requires Firebase auth for GET settings', async () => {
    const res = await request(app).get(`${BASE}/devices/AA:BB:CC:DD:EE:FF/settings`);
    expect(res.statusCode).toBe(401);
  });

  it('requires Firebase auth for PATCH settings', async () => {
    const res = await request(app)
      .patch(`${BASE}/devices/AA:BB:CC:DD:EE:FF/settings`)
      .send({ settings: { volume: 30 } });
    expect(res.statusCode).toBe(401);
  });

  it('requires Firebase auth for GET state', async () => {
    const res = await request(app).get(`${BASE}/devices/AA:BB:CC:DD:EE:FF/state`);
    expect(res.statusCode).toBe(401);
  });

  it('requires Firebase auth for GET sync-events', async () => {
    const res = await request(app).get(`${BASE}/devices/AA:BB:CC:DD:EE:FF/sync-events`);
    expect(res.statusCode).toBe(401);
  });
});
