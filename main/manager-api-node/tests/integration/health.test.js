'use strict';

/**
 * Health & Public Endpoint Integration Tests
 *
 * Covers:
 *  - GET /health          — bare Express health check (no /toy prefix, no DB)
 *  - GET /toy/health      — API health endpoint (static, no DB required)
 *  - GET /toy/health/db   — DB connectivity probe (may fail in CI)
 *  - GET /toy/pub-config  — static public configuration (no auth, no DB)
 *  - 404 for unknown routes
 */

const { request, app, BASE } = require('../setup');

// ===========================================================================
// Bare health check — mounted directly on Express, outside /toy
// ===========================================================================

describe('GET /health', () => {
  it('should return HTTP 200', async () => {
    const res = await request(app).get('/health');

    expect(res.status).toBe(200);
  });

  it('should return status "healthy"', async () => {
    const res = await request(app).get('/health');

    expect(res.body).toHaveProperty('status', 'healthy');
  });

  it('should include a timestamp', async () => {
    const res = await request(app).get('/health');

    expect(res.body).toHaveProperty('timestamp');
    // Verify the timestamp is a parseable ISO-8601 string.
    const ts = new Date(res.body.timestamp);
    expect(ts.toString()).not.toBe('Invalid Date');
  });

  it('should include server uptime', async () => {
    const res = await request(app).get('/health');

    expect(res.body).toHaveProperty('uptime');
    expect(typeof res.body.uptime).toBe('number');
    expect(res.body.uptime).toBeGreaterThanOrEqual(0);
  });

  it('should not require an Authorization header', async () => {
    // No headers set — should still succeed.
    const res = await request(app).get('/health');

    expect(res.status).toBe(200);
  });
});

// ===========================================================================
// API health check — under /toy context path, returns standard envelope
// ===========================================================================

describe('GET /toy/health', () => {
  it('should return HTTP 200', async () => {
    const res = await request(app).get(`${BASE}/health`);

    expect(res.status).toBe(200);
  });

  it('should return the standard success envelope { code: 0, msg: "success" }', async () => {
    const res = await request(app).get(`${BASE}/health`);

    expect(res.body).toHaveProperty('code', 0);
    expect(res.body).toHaveProperty('msg', 'success');
    expect(res.body).toHaveProperty('data');
  });

  it('should report status "healthy" inside data', async () => {
    const res = await request(app).get(`${BASE}/health`);

    expect(res.body.data).toHaveProperty('status', 'healthy');
  });

  it('should report API version "1.0.0" inside data', async () => {
    const res = await request(app).get(`${BASE}/health`);

    expect(res.body.data).toHaveProperty('version', '1.0.0');
  });

  it('should include a timestamp inside data', async () => {
    const res = await request(app).get(`${BASE}/health`);

    expect(res.body.data).toHaveProperty('timestamp');
    const ts = new Date(res.body.data.timestamp);
    expect(ts.toString()).not.toBe('Invalid Date');
  });

  it('should include an environment field inside data', async () => {
    const res = await request(app).get(`${BASE}/health`);

    expect(res.body.data).toHaveProperty('environment');
    expect(typeof res.body.data.environment).toBe('string');
  });

  it('should not require authentication', async () => {
    const res = await request(app).get(`${BASE}/health`);

    // Must not return 401.
    expect(res.status).not.toBe(401);
  });

  it('should allow the Vite dev origin on 127.0.0.1 for standalone dashboard requests', async () => {
    const res = await request(app)
      .get(`${BASE}/health`)
      .set('Origin', 'http://127.0.0.1:5173');

    expect(res.status).toBe(200);
    expect(res.headers['access-control-allow-origin']).toBe('http://127.0.0.1:5173');
  });
});

// ===========================================================================
// Database connectivity probe — may return 200 or 500 depending on DB state
// ===========================================================================

describe('GET /toy/health/db', () => {
  it('should return HTTP 200 or 500 (DB may be unavailable in CI)', async () => {
    const res = await request(app).get(`${BASE}/health/db`);

    expect([200, 500]).toContain(res.status);
  });

  it('should always return the standard envelope { code, msg }', async () => {
    const res = await request(app).get(`${BASE}/health/db`);

    expect(res.body).toHaveProperty('code');
    expect(res.body).toHaveProperty('msg');
  });

  it('should include a database field in data when the call succeeds with HTTP 200', async () => {
    const res = await request(app).get(`${BASE}/health/db`);

    if (res.status === 200) {
      expect(res.body).toHaveProperty('data');
      expect(res.body.data).toHaveProperty('database');
      // The database field must be one of the documented enum values.
      expect(['connected', 'disconnected', 'error', 'not_configured'])
        .toContain(res.body.data.database);
    }
  });

  it('should report the Prisma provider when connected', async () => {
    const res = await request(app).get(`${BASE}/health/db`);

    if (res.status === 200 && res.body.data && res.body.data.database === 'connected') {
      expect(res.body.data).toHaveProperty('provider');
      expect(res.body.data.provider).toMatch(/Prisma/i);
    }
  });

  it('should not require authentication', async () => {
    const res = await request(app).get(`${BASE}/health/db`);

    expect(res.status).not.toBe(401);
  });
});

// ===========================================================================
// Top-level public config — static, no DB, no auth
// ===========================================================================

describe('GET /toy/pub-config', () => {
  it('should return HTTP 200 without authentication', async () => {
    const res = await request(app).get(`${BASE}/pub-config`);

    expect(res.status).toBe(200);
  });

  it('should return the standard envelope with code 0', async () => {
    const res = await request(app).get(`${BASE}/pub-config`);

    expect(res.body).toHaveProperty('code', 0);
    expect(res.body).toHaveProperty('msg');
  });

  it('should include apiVersion "v1" in data', async () => {
    const res = await request(app).get(`${BASE}/pub-config`);

    expect(res.body.data).toHaveProperty('apiVersion', 'v1');
  });

  it('should identify the platform as "node"', async () => {
    const res = await request(app).get(`${BASE}/pub-config`);

    expect(res.body.data).toHaveProperty('platform', 'node');
  });

  it('should include a features object with known flags', async () => {
    const res = await request(app).get(`${BASE}/pub-config`);

    const { features } = res.body.data;
    expect(features).toBeDefined();
    expect(features).toHaveProperty('rfid', true);
    expect(features).toHaveProperty('analytics', true);
  });

  it('should return the same response on repeated calls (idempotent)', async () => {
    const [res1, res2] = await Promise.all([
      request(app).get(`${BASE}/pub-config`),
      request(app).get(`${BASE}/pub-config`)
    ]);

    expect(res1.status).toBe(200);
    expect(res2.status).toBe(200);
    expect(res1.body.data.apiVersion).toBe(res2.body.data.apiVersion);
    expect(res1.body.data.platform).toBe(res2.body.data.platform);
  });
});

// ===========================================================================
// 404 / unknown routes
// ===========================================================================

describe('Unknown / 404 routes', () => {
  it('should return 404 for an unknown route under /toy', async () => {
    const res = await request(app).get(`${BASE}/nonexistent-route-xyz`);

    expect(res.status).toBe(404);
    expect(res.body).toHaveProperty('code', 404);
    expect(res.body).toHaveProperty('msg');
    expect(typeof res.body.msg).toBe('string');
  });

  it('should return 404 for a deeply nested unknown route', async () => {
    const res = await request(app).get(`${BASE}/a/b/c/d/does-not-exist`);

    expect(res.status).toBe(404);
    expect(res.body).toHaveProperty('code', 404);
  });

  it('should not return 404 for the known /health route', async () => {
    const res = await request(app).get('/health');

    expect(res.status).not.toBe(404);
  });

  it('should not return 404 for the known /toy/health route', async () => {
    const res = await request(app).get(`${BASE}/health`);

    expect(res.status).not.toBe(404);
  });
});
