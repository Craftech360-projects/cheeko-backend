'use strict';

/**
 * Crash a real child process and check the reason survives.
 *
 * Before: logger.error('Uncaught Exception:', err) then process.exit(1). In
 * development the console format spreads the Error into {} (no stack), and the
 * exit raced winston's async write — so the terminal showed nodemon's
 * "app crashed" with nothing above it.
 */

const { spawnSync } = require('child_process');
const path = require('path');

const ROOT = path.resolve(__dirname, '../..');

// Runs in a fresh node with the real logger in development mode, installs the
// handlers, then does what a stray callback would do.
const crashScript = (body) => `
  const logger = require('./src/utils/logger');
  require('./src/utils/crashHandlers').install(logger, { drainMs: 500 });
  ${body}
`;

const run = (body) => {
  const r = spawnSync(process.execPath, ['-e', crashScript(body)], {
    cwd: ROOT,
    env: { ...process.env, NODE_ENV: 'development', LOG_IN_TEST: '1' },
    encoding: 'utf8',
    timeout: 10000
  });
  return { status: r.status, out: `${r.stdout}\n${r.stderr}` };
};

describe('uncaught exception', () => {
  it('exits 1 and the stack reaches the terminal', () => {
    const { status, out } = run(`setTimeout(() => { throw new Error('boom-7f3a'); }, 10);`);

    expect(status).toBe(1);
    expect(out).toMatch(/Uncaught Exception: Error: boom-7f3a/);
    // A stack frame, not just the message — this is what was missing.
    expect(out).toMatch(/\n\s+at /);
  });

  it('keeps a non-Error throw readable', () => {
    const { status, out } = run(`setTimeout(() => { throw 'just a string'; }, 10);`);

    expect(status).toBe(1);
    expect(out).toMatch(/Uncaught Exception: just a string/);
  });
});

describe('unhandled rejection', () => {
  it('logs the reason with its stack and does not exit', () => {
    const { status, out } = run(`
      Promise.reject(new Error('rej-9c1d'));
      setTimeout(() => process.exit(0), 300);
    `);

    expect(status).toBe(0);
    expect(out).toMatch(/Unhandled Rejection: Error: rej-9c1d/);
    expect(out).toMatch(/\n\s+at /);
    expect(out).not.toMatch(/Promise \{/);
  });
});
