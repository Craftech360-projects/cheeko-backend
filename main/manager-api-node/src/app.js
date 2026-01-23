/**
 * Cheeko Manager API - Express Application Setup
 *
 * Configures Express with middleware, routes, and error handling.
 * Context path: /toy (matches Spring Boot API)
 */

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');

const logger = require('./utils/logger');
const { errorHandler, notFoundHandler } = require('./middleware/errorHandler');
const routes = require('./routes');
const swaggerSetup = require('./config/swagger');

const app = express();

// ===========================================
// Security Middleware
// ===========================================

// Helmet for security headers
app.use(helmet({
  crossOriginResourcePolicy: { policy: 'cross-origin' }
}));

// CORS configuration
const corsOptions = {
  origin: process.env.CORS_ORIGINS
    ? process.env.CORS_ORIGINS.split(',')
    : ['http://localhost:8080', 'http://localhost:3000'],
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Service-Key', 'X-Requested-With']
};
app.use(cors(corsOptions));

// Rate limiting
const limiter = rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000, // 15 minutes
  max: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS) || 100,
  message: {
    code: 429,
    msg: 'Too many requests, please try again later.',
    data: null
  },
  standardHeaders: true,
  legacyHeaders: false
});
app.use(limiter);

// ===========================================
// Body Parsing Middleware
// ===========================================

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// ===========================================
// Logging Middleware
// ===========================================

// HTTP request logging
const morganFormat = process.env.NODE_ENV === 'production' ? 'combined' : 'dev';
app.use(morgan(morganFormat, {
  stream: {
    write: (message) => logger.http(message.trim())
  }
}));

// ===========================================
// Health Check (outside context path)
// ===========================================

app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    uptime: process.uptime()
  });
});

// ===========================================
// API Routes (under /toy context path)
// ===========================================

const CONTEXT_PATH = process.env.CONTEXT_PATH || '/toy';

// Swagger documentation
swaggerSetup(app, CONTEXT_PATH);

// API routes
app.use(CONTEXT_PATH, routes);

// ===========================================
// Error Handling
// ===========================================

// 404 handler
app.use(notFoundHandler);

// Global error handler
app.use(errorHandler);

module.exports = app;
