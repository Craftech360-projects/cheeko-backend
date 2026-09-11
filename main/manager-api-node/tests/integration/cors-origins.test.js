'use strict';

/**
 * CORS_ORIGINS is typed by hand on each host. A space after a comma must not
 * quietly drop an origin: a refused preflight reaches the browser as a bare
 * "Failed to fetch", indistinguishable from a dead server.
 *
 * The allowlist is read once when app.js loads, so this suite loads its own copy
 * with the variable set rather than sharing tests/setup's app.
 */

const request = require('supertest');

const ORIGINS = ['https://www.cheekoai.in', 'https://cheekoai.in', 'http://localhost:3000'];

let app;
let previous;

beforeAll(() => {
  previous = process.env.CORS_ORIGINS;
  process.env.CORS_ORIGINS = ORIGINS.join(', ');
  jest.isolateModules(() => {
    app = require('../../src/app');
  });
});

afterAll(() => {
  if (previous === undefined) delete process.env.CORS_ORIGINS;
  else process.env.CORS_ORIGINS = previous;
});

const preflight = origin => request(app)
  .options('/toy/api/mobile/devices')
  .set('Origin', origin)
  .set('Access-Control-Request-Method', 'GET')
  .set('Access-Control-Request-Headers', 'authorization');

describe('CORS_ORIGINS', () => {
  it.each(ORIGINS)('allows %s even when the list has spaces after its commas', async (origin) => {
    const res = await preflight(origin);

    expect(res.headers['access-control-allow-origin']).toBe(origin);
  });

  it('still refuses an origin that is not listed', async () => {
    const res = await preflight('https://evil.example');

    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });
});
