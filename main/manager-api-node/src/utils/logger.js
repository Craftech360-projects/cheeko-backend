/**
 * Logger Configuration
 *
 * Winston logger with console and file transports.
 * Matches log format expected by Grafana Loki.
 */

const winston = require('winston');
const path = require('path');

const LOG_LEVEL = process.env.LOG_LEVEL || 'debug';
const NODE_ENV = process.env.NODE_ENV || 'development';

// Custom format for console output
const consoleFormat = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  winston.format.colorize(),
  winston.format.printf(({ timestamp, level, message, ...meta }) => {
    const metaStr = Object.keys(meta).length ? JSON.stringify(meta) : '';
    return `${timestamp} [${level}]: ${message} ${metaStr}`;
  })
);

// JSON format for production/file logging
const jsonFormat = winston.format.combine(
  winston.format.timestamp(),
  winston.format.errors({ stack: true }),
  winston.format.json()
);

// Create logger instance
const logger = winston.createLogger({
  level: LOG_LEVEL,
  format: jsonFormat,
  defaultMeta: { service: 'manager-api-node' },
  transports: [
    // Console transport (always enabled)
    new winston.transports.Console({
      format: NODE_ENV === 'production' ? jsonFormat : consoleFormat
    })
  ]
});

// Add file transports in production
if (NODE_ENV === 'production') {
  const logsDir = process.env.LOGS_DIR || 'logs';

  logger.add(new winston.transports.File({
    filename: path.join(logsDir, 'error.log'),
    level: 'error',
    maxsize: 5242880, // 5MB
    maxFiles: 5
  }));

  logger.add(new winston.transports.File({
    filename: path.join(logsDir, 'combined.log'),
    maxsize: 5242880, // 5MB
    maxFiles: 5
  }));
}

// Export logger methods
module.exports = {
  error: (message, meta = {}) => logger.error(message, meta),
  warn: (message, meta = {}) => logger.warn(message, meta),
  info: (message, meta = {}) => logger.info(message, meta),
  http: (message, meta = {}) => logger.http(message, meta),
  verbose: (message, meta = {}) => logger.verbose(message, meta),
  debug: (message, meta = {}) => logger.debug(message, meta),
  silly: (message, meta = {}) => logger.silly(message, meta),
  logger // Export raw winston logger if needed
};
