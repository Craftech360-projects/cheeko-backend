/**
 * Workers are exempt from the rate limit; forgers are not.
 *
 * The limiter is global and counts every request. Workers authenticate with
 * SERVICE_SECRET_KEY and all egress through one NAT, so the whole EKS fleet is
 * charged to a single client. The workspace-lock heartbeat alone is 40 requests
 * a minute per session — measured on prod 2026-08-17, ten devices produced 1,902
 * heartbeats in eleven minutes and 242 rejections.
 *
 * The property that matters most here is the negative one: a skip that trusts
 * the header's presence rather than its value turns the limiter off for anyone
 * who guesses the header name.
 */

const rateLimit = require('express-rate-limit');

const SECRET = 'service-secret-value';

/** The predicate as wired in app.js, isolated so the rule itself is testable. */
const buildSkip = (enabled, expected) => (req) => {
  if (!enabled) return false;
  return Boolean(expected) && req.get('X-Service-Key') === expected;
};

const reqWith = (key) => ({ get: (h) => (h === 'X-Service-Key' ? key : undefined) });

describe('service-key rate limit exemption', () => {
  it('skips a request carrying the correct key', () => {
    expect(buildSkip(true, SECRET)(reqWith(SECRET))).toBe(true);
  });

  it('does NOT skip a request with a wrong key', () => {
    expect(buildSkip(true, SECRET)(reqWith('guessed'))).toBe(false);
  });

  it('does NOT skip a request with no key — the parent app keeps its limit', () => {
    expect(buildSkip(true, SECRET)(reqWith(undefined))).toBe(false);
  });

  it('does NOT skip merely because the header is present', () => {
    // The failure mode worth pinning: trusting presence would let anyone send
    // any value and bypass the limiter entirely.
    expect(buildSkip(true, SECRET)(reqWith(''))).toBe(false);
    expect(buildSkip(true, SECRET)(reqWith('x'))).toBe(false);
  });

  it('is off unless explicitly enabled, so dev behaviour is unchanged', () => {
    expect(buildSkip(false, SECRET)(reqWith(SECRET))).toBe(false);
  });

  it('never skips when the server has no secret configured', () => {
    expect(buildSkip(true, undefined)(reqWith('anything'))).toBe(false);
    expect(buildSkip(true, '')(reqWith(''))).toBe(false);
  });

  it('the limiter accepts a skip predicate', () => {
    expect(() => rateLimit({ windowMs: 1000, max: 1, skip: buildSkip(true, SECRET) })).not.toThrow();
  });
});
