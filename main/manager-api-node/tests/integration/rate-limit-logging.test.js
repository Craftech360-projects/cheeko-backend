const request = require('supertest');

describe('rate limit logging', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
    jest.resetModules();
    jest.clearAllMocks();
  });

  it('logs details when a request is rate limited', async () => {
    process.env.RATE_LIMIT_WINDOW_MS = '60000';
    process.env.RATE_LIMIT_MAX_REQUESTS = '1';

    jest.doMock('../../src/utils/logger', () => ({
      error: jest.fn(),
      warn: jest.fn(),
      info: jest.fn(),
      http: jest.fn(),
      verbose: jest.fn(),
      debug: jest.fn(),
      silly: jest.fn(),
      createRequestLogger: jest.fn()
    }));

    const logger = require('../../src/utils/logger');
    const app = require('../../src/app');

    await request(app).get('/health').expect(200);
    await request(app).get('/health').expect(429);

    expect(logger.warn).toHaveBeenCalledWith(
      '[RATE-LIMIT] Request blocked',
      expect.objectContaining({
        method: 'GET',
        path: '/health',
        limit: 1,
        remaining: 0
      })
    );
  });
});
