/** SUB-11: the RC webhook route fires ops alerts on auth failures. */
const mockOpsAlert = jest.fn().mockResolvedValue(true);
jest.mock('../../src/services/opsAlert.service', () => ({
  sendOpsAlert: (...a) => mockOpsAlert(...a),
}));
const mockProcess = jest.fn();
jest.mock('../../src/services/revenuecat.service', () => ({
  verifyWebhookAuth: (auth) => auth === 'Bearer good',
  processWebhookEvent: (...a) => mockProcess(...a),
}));

const express = require('express');
const request = require('supertest');
const router = require('../../src/routes/revenuecatWebhook.routes');

const app = express();
app.use(express.json());
app.use('/webhooks/revenuecat', router);
// mirror the app's error handler enough to turn throws into 500s
app.use((err, req, res, next) => res.status(500).json({ code: 500 }));

beforeEach(() => {
  jest.clearAllMocks();
  process.env.REVENUECAT_WEBHOOK_AUTH = 'good';
});

test('bad Authorization → 401 and an rc_webhook alert', async () => {
  const res = await request(app)
    .post('/webhooks/revenuecat')
    .set('Authorization', 'Bearer wrong')
    .send({ event: { id: 'e1', type: 'RENEWAL' } });
  expect(res.status).toBe(401);
  expect(mockOpsAlert).toHaveBeenCalledWith(
    'rc_webhook',
    expect.stringContaining('Authorization mismatch'),
    expect.any(Object)
  );
});

test('processing failure → 500 and an rc_webhook alert', async () => {
  mockProcess.mockRejectedValue(new Error('db down'));
  const res = await request(app)
    .post('/webhooks/revenuecat')
    .set('Authorization', 'Bearer good')
    .send({ event: { id: 'e2', type: 'RENEWAL' } });
  expect(res.status).toBe(500);
  expect(mockOpsAlert).toHaveBeenCalledWith(
    'rc_webhook',
    expect.stringContaining('processing failed'),
    expect.any(Object)
  );
});

test('good auth + processing → 200, no alert', async () => {
  mockProcess.mockResolvedValue({ outcome: 'processed' });
  const res = await request(app)
    .post('/webhooks/revenuecat')
    .set('Authorization', 'Bearer good')
    .send({ event: { id: 'e3', type: 'RENEWAL' } });
  expect(res.status).toBe(200);
  expect(mockOpsAlert).not.toHaveBeenCalled();
});
