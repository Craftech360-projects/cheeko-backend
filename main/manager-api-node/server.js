/**
 * Cheeko Manager API - Server Entry Point
 *
 * This is the main entry point for the Express.js server.
 * It loads environment variables and starts the application.
 */

require('dotenv').config();

const app = require('./src/app');
const logger = require('./src/utils/logger');

const PORT = process.env.PORT || 8002;
const NODE_ENV = process.env.NODE_ENV || 'development';

// Start server
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
╚═══════════════════════════════════════════════════════════╝
  `);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  logger.info('SIGTERM received. Shutting down gracefully...');
  server.close(() => {
    logger.info('Server closed.');
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  logger.info('SIGINT received. Shutting down gracefully...');
  server.close(() => {
    logger.info('Server closed.');
    process.exit(0);
  });
});

// Handle uncaught exceptions
process.on('uncaughtException', (err) => {
  logger.error('Uncaught Exception:', err);
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  logger.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

module.exports = server;
