/**
 * Process-level crash handlers.
 *
 * Node leaves the process in an undefined state after an uncaught exception,
 * so exiting is right — PM2 / Docker restart us. What used to go wrong is that
 * the reason was lost: the dev console format drops an Error passed as log
 * meta (it spreads to {}), and process.exit() on the very next line raced
 * winston's asynchronous write. The terminal showed "[nodemon] app crashed"
 * and nothing else.
 *
 * So: write the stack synchronously to stderr first, let the logger drain,
 * then exit. Unhandled rejections keep their existing log-only behaviour but
 * now log the reason's stack instead of the Promise object.
 */

const describe = (err) => (err instanceof Error ? err.stack || err.message : String(err));

const install = (logger, { exit = (code) => process.exit(code), drainMs = 2000 } = {}) => {
  // utils/logger exports a thin wrapper; the winston instance (which can be
  // drained) sits on .logger.
  const stream = logger.logger || logger;

  process.on('uncaughtException', (err) => {
    const detail = describe(err);
    // Synchronous on a TTY and, on Windows, on pipes too — survives the exit.
    process.stderr.write(`\nUncaught Exception: ${detail}\n`);
    logger.error(`Uncaught Exception: ${detail}`);
    if (typeof stream.end === 'function') {
      stream.once('finish', () => exit(1));
      stream.end();
    }
    setTimeout(() => exit(1), drainMs).unref();
  });

  process.on('unhandledRejection', (reason) => {
    logger.error(`Unhandled Rejection: ${describe(reason)}`);
  });
};

module.exports = { install, describe };
