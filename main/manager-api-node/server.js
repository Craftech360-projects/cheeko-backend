/**
 * Cheeko Manager API - Server Entry Point
 *
 * This is the main entry point for the Express.js server.
 * It loads environment variables, runs Prisma migrations, and starts the application.
 */

require('dotenv').config();

// BigInt serialization: Prisma returns BigInt for @id @default(autoincrement()) columns.
// JSON.stringify doesn't handle BigInt natively — serialize as string to avoid crashes.
// eslint-disable-next-line no-extend-native
BigInt.prototype.toJSON = function () { return this.toString(); };

const logger = require('./src/utils/logger');
const { runPrismaGenerate, runPrismaMigrations } = require('./src/config/prisma-migrations');

const PORT = process.env.PORT || 8002;
const NODE_ENV = process.env.NODE_ENV || 'development';

/**
 * Initialize and start the server
 */
const startServer = async () => {
  try {
    await runPrismaGenerate();

    // Server will exit with code 1 if migrations or schema guards fail.
    logger.info('Running Prisma migrations...');
    await runPrismaMigrations();

    const app = require('./src/app');
    const { prisma } = require('./src/config/database');
    const { assertRequiredPrismaModels, assertRequiredDatabaseTables } = require('./src/config/prisma-client-guard');
    const { startEmailReportCron, stopEmailReportCron } = require('./src/jobs/dailyEmailReport');
    const { startUsageSummaryCrons, stopUsageSummaryCrons } = require('./src/jobs/usageSummaryNotification');
    const { startTrialReminderCron, stopTrialReminderCron } = require('./src/jobs/trialReminderNotification');
    const { startRcReconciliationCron, stopRcReconciliationCron } = require('./src/jobs/rcReconciliation');
    const shouldSkipRequiredTableGuard = process.env.SKIP_DB_SYNC === '1';

    assertRequiredPrismaModels(prisma);
    if (shouldSkipRequiredTableGuard) {
      logger.warn(
        'Skipping required Prisma table guard (SKIP_DB_SYNC=1). ' +
        'Run `npx prisma migrate deploy` before enabling routes that need recent schema tables.'
      );
    } else {
      await assertRequiredDatabaseTables(prisma);
    }
    logger.info('Database schema ready.');

    // Start Express server
    // Bind to 127.0.0.1 to avoid Windows EACCES permission issues
    const HOST = process.env.HOST || '127.0.0.1';
    const server = app.listen(PORT, HOST, () => {
      logger.info(`
╔═══════════════════════════════════════════════════════════╗
║           Cheeko Manager API (Node.js)                    ║
╠═══════════════════════════════════════════════════════════╣
║  Status:      Running                                     ║
║  Environment: ${NODE_ENV.padEnd(43)}║
║  Port:        ${String(PORT).padEnd(43)}║
║  API Base:    http://localhost:${PORT}/toy${' '.repeat(23)}║
║  Swagger:     http://localhost:${PORT}/toy/doc.html${' '.repeat(14)}║
║  Database:    Schema Ready                                ║
╚═══════════════════════════════════════════════════════════╝
      `);

      // Start background jobs
      startEmailReportCron().catch(err => {
        logger.warn('Failed to start email report cron:', err.message);
      });
      startUsageSummaryCrons().catch(err => {
        logger.warn('Failed to start usage summary crons:', err.message);
      });
      startTrialReminderCron().catch(err => {
        logger.warn('Failed to start trial reminder cron:', err.message);
      });
      startRcReconciliationCron().catch(err => {
        logger.warn('Failed to start RC reconciliation cron:', err.message);
      });
    });

    // Graceful shutdown
    const gracefulShutdown = (signal) => {
      logger.info(`${signal} received. Shutting down gracefully...`);

      // Stop background jobs
      stopEmailReportCron();
      stopUsageSummaryCrons();
      stopTrialReminderCron();
      stopRcReconciliationCron();

      server.close(() => {
        logger.info('Server closed.');
        process.exit(0);
      });

      // Force close after 10 seconds
      setTimeout(() => {
        logger.error('Forced shutdown after timeout.');
        process.exit(1);
      }, 10000);
    };

    process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
    process.on('SIGINT', () => gracefulShutdown('SIGINT'));

    return server;

  } catch (error) {
    logger.error('Failed to start server:', error);
    process.exit(1);
  }
};

// Handle uncaught exceptions
process.on('uncaughtException', (err) => {
  logger.error('Uncaught Exception:', err);
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  logger.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

// Start the server
startServer();
