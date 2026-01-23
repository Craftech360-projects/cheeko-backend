/**
 * Logging and Request Tracking Integration Tests
 *
 * Tests for request ID middleware and logging functionality.
 */

const request = require('supertest');
const app = require('../../src/app');

describe('Logging and Request Tracking', () => {
  describe('Request ID Middleware', () => {
    describe('GET /health', () => {
      it('should return X-Request-ID header in response', async () => {
        const response = await request(app)
          .get('/health')
          .expect(200);

        expect(response.headers['x-request-id']).toBeDefined();
        // UUID v4 format check
        expect(response.headers['x-request-id']).toMatch(
          /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
        );
      });

      it('should generate unique request IDs for each request', async () => {
        const response1 = await request(app).get('/health');
        const response2 = await request(app).get('/health');

        expect(response1.headers['x-request-id']).not.toBe(response2.headers['x-request-id']);
      });

      it('should use provided X-Request-ID header if present', async () => {
        const customRequestId = '12345678-1234-4123-8123-123456789abc';

        const response = await request(app)
          .get('/health')
          .set('X-Request-ID', customRequestId)
          .expect(200);

        expect(response.headers['x-request-id']).toBe(customRequestId);
      });
    });

    describe('GET /toy/health', () => {
      it('should include X-Request-ID in API health response', async () => {
        const response = await request(app)
          .get('/toy/health')
          .expect(200);

        expect(response.headers['x-request-id']).toBeDefined();
      });
    });

    describe('POST /user/login', () => {
      it('should include X-Request-ID in error responses', async () => {
        const response = await request(app)
          .post('/toy/user/login')
          .send({ username: 'test', password: 'test' });

        // Response may be 400 (validation) or 401 (auth failed)
        expect([400, 401]).toContain(response.status);
        expect(response.headers['x-request-id']).toBeDefined();
      });
    });

    describe('GET /toy/device/:mac/mode', () => {
      it('should include X-Request-ID in public endpoint responses', async () => {
        const response = await request(app)
          .get('/toy/device/AA:BB:CC:DD:EE:FF/mode');

        expect(response.headers['x-request-id']).toBeDefined();
      });
    });

    describe('GET /toy/nonexistent', () => {
      it('should include X-Request-ID in 404 responses', async () => {
        const response = await request(app)
          .get('/toy/nonexistent')
          .expect(404);

        expect(response.headers['x-request-id']).toBeDefined();
      });
    });
  });

  describe('Logger Functionality', () => {
    it('should export all expected log methods', () => {
      const logger = require('../../src/utils/logger');

      expect(typeof logger.error).toBe('function');
      expect(typeof logger.warn).toBe('function');
      expect(typeof logger.info).toBe('function');
      expect(typeof logger.http).toBe('function');
      expect(typeof logger.verbose).toBe('function');
      expect(typeof logger.debug).toBe('function');
      expect(typeof logger.silly).toBe('function');
      expect(typeof logger.createRequestLogger).toBe('function');
      expect(logger.logger).toBeDefined();
    });

    it('should create request logger with requestId', () => {
      const logger = require('../../src/utils/logger');
      const req = { requestId: 'test-request-123' };
      const reqLogger = logger.createRequestLogger(req);

      expect(typeof reqLogger.error).toBe('function');
      expect(typeof reqLogger.warn).toBe('function');
      expect(typeof reqLogger.info).toBe('function');
      expect(typeof reqLogger.http).toBe('function');
      expect(typeof reqLogger.verbose).toBe('function');
      expect(typeof reqLogger.debug).toBe('function');
      expect(typeof reqLogger.silly).toBe('function');
    });

    it('should handle null request in createRequestLogger', () => {
      const logger = require('../../src/utils/logger');
      const reqLogger = logger.createRequestLogger(null);

      expect(typeof reqLogger.error).toBe('function');
      // Should not throw when called
      expect(() => reqLogger.info('test message')).not.toThrow();
    });

    it('should handle request without requestId', () => {
      const logger = require('../../src/utils/logger');
      const reqLogger = logger.createRequestLogger({});

      expect(typeof reqLogger.info).toBe('function');
      // Should not throw when called
      expect(() => reqLogger.info('test message')).not.toThrow();
    });
  });

  describe('Request ID Middleware Unit Tests', () => {
    const { requestIdMiddleware } = require('../../src/middleware/requestId');

    it('should be a function', () => {
      expect(typeof requestIdMiddleware).toBe('function');
    });

    it('should return middleware function', () => {
      const middleware = requestIdMiddleware();
      expect(typeof middleware).toBe('function');
    });

    it('should call next function', () => {
      const middleware = requestIdMiddleware();
      const req = { get: jest.fn().mockReturnValue(null) };
      const res = { setHeader: jest.fn() };
      const next = jest.fn();

      middleware(req, res, next);

      expect(next).toHaveBeenCalled();
    });

    it('should set requestId on request object', () => {
      const middleware = requestIdMiddleware();
      const req = { get: jest.fn().mockReturnValue(null) };
      const res = { setHeader: jest.fn() };
      const next = jest.fn();

      middleware(req, res, next);

      expect(req.requestId).toBeDefined();
      expect(typeof req.requestId).toBe('string');
    });

    it('should set X-Request-ID response header', () => {
      const middleware = requestIdMiddleware();
      const req = { get: jest.fn().mockReturnValue(null) };
      const res = { setHeader: jest.fn() };
      const next = jest.fn();

      middleware(req, res, next);

      expect(res.setHeader).toHaveBeenCalledWith('X-Request-ID', expect.any(String));
    });

    it('should use existing request ID from header', () => {
      const existingId = 'existing-request-id-123';
      const middleware = requestIdMiddleware();
      const req = { get: jest.fn().mockReturnValue(existingId) };
      const res = { setHeader: jest.fn() };
      const next = jest.fn();

      middleware(req, res, next);

      expect(req.requestId).toBe(existingId);
      expect(res.setHeader).toHaveBeenCalledWith('X-Request-ID', existingId);
    });

    it('should support custom header name', () => {
      const middleware = requestIdMiddleware({ headerName: 'X-Correlation-ID' });
      const req = { get: jest.fn().mockReturnValue('custom-id') };
      const res = { setHeader: jest.fn() };
      const next = jest.fn();

      middleware(req, res, next);

      expect(req.get).toHaveBeenCalledWith('X-Correlation-ID');
      expect(res.setHeader).toHaveBeenCalledWith('X-Correlation-ID', 'custom-id');
    });

    it('should support custom ID generator', () => {
      const customId = 'custom-generated-id';
      const middleware = requestIdMiddleware({ generateId: () => customId });
      const req = { get: jest.fn().mockReturnValue(null) };
      const res = { setHeader: jest.fn() };
      const next = jest.fn();

      middleware(req, res, next);

      expect(req.requestId).toBe(customId);
    });

    it('should support disabling response header', () => {
      const middleware = requestIdMiddleware({ setHeader: false });
      const req = { get: jest.fn().mockReturnValue(null) };
      const res = { setHeader: jest.fn() };
      const next = jest.fn();

      middleware(req, res, next);

      expect(res.setHeader).not.toHaveBeenCalled();
      expect(req.requestId).toBeDefined();
    });
  });
});
