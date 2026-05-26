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

  it('requires Firebase auth for GET analytics overview', async () => {
    const res = await request(app).get(`${BASE}/devices/AA:BB:CC:DD:EE:FF/analytics/overview`);
    expect(res.statusCode).toBe(401);
  });

  it('requires Firebase auth for GET analytics timeseries', async () => {
    const res = await request(app).get(`${BASE}/devices/AA:BB:CC:DD:EE:FF/analytics/timeseries`);
    expect(res.statusCode).toBe(401);
  });

  it('requires Firebase auth for GET analytics events', async () => {
    const res = await request(app).get(`${BASE}/devices/AA:BB:CC:DD:EE:FF/analytics/events`);
    expect(res.statusCode).toBe(401);
  });

  it('requires Firebase auth for GET analytics battery', async () => {
    const res = await request(app).get(`${BASE}/devices/AA:BB:CC:DD:EE:FF/analytics/battery`);
    expect(res.statusCode).toBe(401);
  });

  it('requires Firebase auth for GET homepage activity details', async () => {
    const res = await request(app).get(`${BASE}/homepage-activity/details?metric=games&period=week`);
    expect(res.statusCode).toBe(401);
  });

  it('requires Firebase auth for GET progress summary', async () => {
    const res = await request(app).get(`${BASE}/progress/summary?period=today`);
    expect(res.statusCode).toBe(401);
  });

  it('requires Firebase auth for GET progress details', async () => {
    const res = await request(app).get(`${BASE}/progress/details?metric=games&period=week`);
    expect(res.statusCode).toBe(401);
  });

  it('requires Firebase auth for GET progress trend', async () => {
    const res = await request(app).get(`${BASE}/progress/trend?period=week`);
    expect(res.statusCode).toBe(401);
  });

  it('requires Firebase auth for GET device games-played', async () => {
    const res = await request(app).get(`${BASE}/devices/AA:BB:CC:DD:EE:FF/games-played`);
    expect(res.statusCode).toBe(401);
  });

  it('requires Firebase auth for GET device radio-played', async () => {
    const res = await request(app).get(`${BASE}/devices/AA:BB:CC:DD:EE:FF/radio-played`);
    expect(res.statusCode).toBe(401);
  });
});
