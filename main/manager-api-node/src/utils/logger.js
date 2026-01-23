/**
 * Logger Configuration
 *
 * Winston logger with console and file transports.
 * Matches log format expected by Grafana Loki.
 *
 * Environment Variables:
 * - LOG_LEVEL: Logging level (error, warn, info, http, verbose, debug, silly)
 * - NODE_ENV: Environment (development, production, test)
 * - LOGS_DIR: Directory for log files (default: logs)
 * - LOG_MAX_SIZE: Max size per log file in bytes (default: 5MB)
 * - LOG_MAX_FILES: Number of rotated log files to keep (default: 5)
 */

const winston = require('winston');
const path = require('path');
const fs = require('fs');

// Configuration from environment
const LOG_LEVEL = process.env.LOG_LEVEL || (process.env.NODE_ENV === 'production' ? 'info' : 'debug');
const NODE_ENV = process.env.NODE_ENV || 'development';
const LOGS_DIR = process.env.LOGS_DIR || 'logs';
const LOG_MAX_SIZE = parseInt(process.env.LOG_MAX_SIZE) || 5242880; // 5MB
const LOG_MAX_FILES = parseInt(process.env.LOG_MAX_FILES) || 5;

// Custom format for console output (includes request ID when available)
const consoleFormat = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  winston.format.colorize(),
  winston.format.printf(({ timestamp, level, message, requestId, ...meta }) => {
    const reqIdStr = requestId ? `[${requestId.slice(0, 8)}]` : '';
    const metaStr = Object.keys(meta).length && meta.service === undefined
      ? ' ' + JSON.stringify(meta)
      : '';
    return `${timestamp} ${reqIdStr}[${level}]: ${message}${metaStr}`;
  })
);

// JSON format for production/file logging (structured for log aggregation)
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
      format: NODE_ENV === 'production' ? jsonFormat : consoleFormat,
      // Disable logging in test environment to reduce noise
      silent: NODE_ENV === 'test' && !process.env.LOG_IN_TEST
    })
  ]
});

// Add file transports in production
if (NODE_ENV === 'production') {
  // Ensure logs directory exists
  if (!fs.existsSync(LOGS_DIR)) {
    fs.mkdirSync(LOGS_DIR, { recursive: true });
  }

  logger.add(new winston.transports.File({
    filename: path.join(LOGS_DIR, 'error.log'),
    level: 'error',
    maxsize: LOG_MAX_SIZE,
    maxFiles: LOG_MAX_FILES
  }));

  logger.add(new winston.transports.File({
    filename: path.join(LOGS_DIR, 'combined.log'),
    maxsize: LOG_MAX_SIZE,
    maxFiles: LOG_MAX_FILES
  }));
}

/**
 * Create a child logger with request context
 * @param {Object} req - Express request object with requestId
 * @returns {Object} Logger methods bound with request context
 */
const createRequestLogger = (req) => {
  const requestId = req?.requestId;
  const childMeta = requestId ? { requestId } : {};

  return {
    error: (message, meta = {}) => logger.error(message, { ...childMeta, ...meta }),
    warn: (message, meta = {}) => logger.warn(message, { ...childMeta, ...meta }),
    info: (message, meta = {}) => logger.info(message, { ...childMeta, ...meta }),
    http: (message, meta = {}) => logger.http(message, { ...childMeta, ...meta }),
    verbose: (message, meta = {}) => logger.verbose(message, { ...childMeta, ...meta }),
    debug: (message, meta = {}) => logger.debug(message, { ...childMeta, ...meta }),
    silly: (message, meta = {}) => logger.silly(message, { ...childMeta, ...meta })
  };
};

// Export logger methods
module.exports = {
  error: (message, meta = {}) => logger.error(message, meta),
  warn: (message, meta = {}) => logger.warn(message, meta),
  info: (message, meta = {}) => logger.info(message, meta),
  http: (message, meta = {}) => logger.http(message, meta),
  verbose: (message, meta = {}) => logger.verbose(message, meta),
  debug: (message, meta = {}) => logger.debug(message, meta),
  silly: (message, meta = {}) => logger.silly(message, meta),
  createRequestLogger,
  logger // Export raw winston logger if needed
};
