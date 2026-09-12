'use strict';
// Regression: POST /ota/ and POST /ota/activate must never write
// content_secret into the application log. Content encryption v1 uses one
// shared wrap secret, so the server no longer stores a per-device secret —
// but firmware in the field still posts `content_secret` on every boot, so
// the redaction has to stay. A reviewer once found the raw
// `[OTA] Incoming request` debug log printing req.body verbatim at info level.
//
// These tests mount the real ota.routes.js router (not a re-declared copy of
// the handler), drive it with supertest, and fail if the secret value ever
// appears in any argument passed to the spied logger.
jest.mock('../../src/config/database', () => ({ prisma: {
  ai_device: { findFirst: jest.fn(async () => null), findUnique: jest.fn(async () => null), update: jest.fn(), create: jest.fn() },
  sys_params: { findUnique: jest.fn(async () => null) },
  ai_ota: { findFirst: jest.fn(async () => null), findMany: jest.fn(async () => []) },
} }));
jest.mock('../../src/utils/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
}));

const logger = require('../../src/utils/logger');

beforeEach(() => {
  jest.clearAllMocks();
});

describe('POST /ota/ and /ota/activate do not leak content_secret to logs', () => {
  const request = require('supertest');
  const express = require('express');
  const { errorHandler } = require('../../src/middleware/errorHandler');

  const buildApp = () => {
    const app = express();
    app.use(express.json());
    app.use('/', require('../../src/routes/ota.routes'));
    app.use(errorHandler);
    return app;
  };

  const SECRET = 'cd'.repeat(32); // 64 hex chars
  const MAC = 'AA:BB:CC:DD:EE:FF';

  const allLoggedText = () => {
    const calls = [
      ...logger.info.mock.calls,
      ...logger.warn.mock.calls,
      ...logger.error.mock.calls,
      ...logger.debug.mock.calls,
    ];
    return calls
      .flat()
      .map((arg) => (typeof arg === 'string' ? arg : JSON.stringify(arg)))
      .join('\n');
  };

  it('redacts content_secret in the POST / incoming-request log', async () => {
    await request(buildApp())
      .post('/')
      .set('device-id', MAC)
      .send({ version: '1.0.0', board: 'cheeko-v2', content_secret: SECRET });

    expect(allLoggedText()).not.toContain(SECRET);
    // Sanity check the test would actually catch a regression: the key name
    // itself should still be visible so the field stays debuggable.
    expect(allLoggedText()).toContain('content_secret');
  });

  it('redacts content_secret in the POST /activate log path', async () => {
    await request(buildApp())
      .post('/activate')
      .set('device-id', MAC)
      .send({ version: '1.0.0', board: 'cheeko-v2', content_secret: SECRET });

    expect(allLoggedText()).not.toContain(SECRET);
  });
});
