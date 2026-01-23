/**
 * Cheeko Manager API - Server Entry Point
 *
 * This is the main entry point for the Express.js server.
 * It loads environment variables, runs migrations, and starts the application.
 */

require('dotenv').config();

const app = require('./src/app');
const logger = require('./src/utils/logger');
const { runMigrations } = require('./src/config/migrations');

const PORT = process.env.PORT || 8002;
const NODE_ENV = process.env.NODE_ENV || 'development';

/**
 * Initialize and start the server
 */
const startServer = async () => {
  try {
    // Run database migrations
    logger.info('Initializing database...');
    const migrationSuccess = await runMigrations();

    if (!migrationSuccess) {
      logger.warn('Database migrations incomplete. Some features may not work.');
    }

    // Start Express server
    const server = app.listen(PORT, () => {
      logger.info(`
╔═══════════════════════════════════════════════════════════╗
║           Cheeko Manager API (Node.js)                    ║
╠═══════════════════════════════════════════════════════════╣
║  Status:      Running                                     ║
║  Environment: ${NODE_ENV.padEnd(43)}║
║  Port:        ${String(PORT).padEnd(43)}║
║  API Base:    http://localhost:${PORT}/toy${' '.repeat(23)}║
║  Swagger:     http://localhost:${PORT}/toy/doc.html${' '.repeat(14)}║
║  Database:    ${migrationSuccess ? 'Connected & Migrated'.padEnd(43) : 'Check Configuration'.padEnd(43)}║
╚═══════════════════════════════════════════════════════════╝
      `);
    });

    // Graceful shutdown
    const gracefulShutdown = (signal) => {
      logger.info(`${signal} received. Shutting down gracefully...`);
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
