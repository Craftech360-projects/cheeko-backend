const request = require('supertest');
const app = require('../../src/app');

const BASE = '/toy/device-sync';
const SERVICE_KEY = process.env.SERVICE_SECRET_KEY || 'test-service-key';
const HAS_REAL_SERVICE_KEY = Boolean(process.env.SERVICE_SECRET_KEY);

describe('Device Sync Routes', () => {
  it('rejects settings-get without service key', async () => {
    const res = await request(app)
      .post(`${BASE}/settings-get`)
      .send({ mac_address: 'AA:BB:CC:DD:EE:FF', current_version: 1 });

    expect(res.statusCode).toBe(401);
    expect(res.body).toHaveProperty('code', 401);
  });

  it('rejects settings-get with missing mac_address', async () => {
    const res = await request(app)
      .post(`${BASE}/settings-get`)
      .set('X-Service-Key', SERVICE_KEY)
      .send({ current_version: 1 });

    const expectedCode = HAS_REAL_SERVICE_KEY ? 400 : 401;
    expect(res.statusCode).toBe(expectedCode);
    expect(res.body).toHaveProperty('code', expectedCode);
  });

  it('rejects settings-ack with missing mac_address', async () => {
    const res = await request(app)
      .post(`${BASE}/settings-ack`)
      .set('X-Service-Key', SERVICE_KEY)
      .send({ status: 'applied', version: 2 });

    const expectedCode = HAS_REAL_SERVICE_KEY ? 400 : 401;
    expect(res.statusCode).toBe(expectedCode);
    expect(res.body).toHaveProperty('code', expectedCode);
  });

  it('rejects device-state with missing mac_address', async () => {
    const res = await request(app)
      .post(`${BASE}/device-state`)
      .set('X-Service-Key', SERVICE_KEY)
      .send({ payload: { type: 'device_state' } });

    const expectedCode = HAS_REAL_SERVICE_KEY ? 400 : 401;
    expect(res.statusCode).toBe(expectedCode);
    expect(res.body).toHaveProperty('code', expectedCode);
  });
});
