/**
 * Cheeko Manager API - Express Application Setup
 *
 * Configures Express with middleware, routes, and error handling.
 * Context path: /toy (matches Spring Boot API)
 */

// BigInt JSON serialization — Prisma returns BigInt for id columns.
// Without this, JSON.stringify() throws "Do not know how to serialize a BigInt".
BigInt.prototype.toJSON = function () {
  const int = Number(this);
  return int <= Number.MAX_SAFE_INTEGER ? int : this.toString();
};

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');

const logger = require('./utils/logger');
const { errorHandler, notFoundHandler } = require('./middleware/errorHandler');
const { xssFilter } = require('./middleware/xssFilter');
const { requestIdMiddleware } = require('./middleware/requestId');
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
    : [
      'http://localhost:8080',
      'http://localhost:3000',
      'http://localhost:5173',
      'http://localhost:4173',
      'http://127.0.0.1:5173',
      'http://127.0.0.1:4173',
      'http://127.0.0.1:5500',
      'http://localhost:5500'
    ],
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Service-Key', 'X-Requested-With', 'X-Request-ID']
};
app.use(cors(corsOptions));

// Add unique request ID to each request before any middleware can short-circuit.
app.use(requestIdMiddleware());

// Trust proxy - required when behind reverse proxy (nginx, load balancer, etc.)
// This enables express-rate-limit to correctly identify clients via X-Forwarded-For
app.set('trust proxy', 1);

// Our own workers, exempted from a limit meant for untrusted callers.
//
// The limiter is global and counts every request. Workers authenticate with
// SERVICE_SECRET_KEY and all egress through the same NAT, so the entire EKS
// fleet is charged to one client. The workspace-lock heartbeat fires every 1.5s
// per session — 40 requests a minute each — so ten children talking for fifteen
// minutes spend 6,000 of the 5,000 budget on heartbeats alone, before a single
// quiz question.
//
// Measured on prod 2026-08-17 with ten devices: 1,902 heartbeats in eleven
// minutes, 31% of all traffic, and 242 rejections. The casualty is the lock that
// stops two sessions interleaving writes to one child's memory (ADR-0007), so
// the limiter was quietly disabling the only guard there is.
//
// The key is COMPARED, never merely present. A skip that trusts the header's
// existence lets anyone send `X-Service-Key: anything` and bypass the limiter
// entirely — rate limiting left on for real users and off for everyone else,
// which is worse than not having it.
//
// Off by default and enabled per environment, so this reaches production
// without changing dev behaviour.
const skipServiceKeyRateLimit = process.env.RATE_LIMIT_SKIP_SERVICE_KEY === '1';

// Rate limiting
const limiter = rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000, // 15 minutes
  max: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS) || 5000, // Increased for frontend dev
  skip: (req) => {
    if (!skipServiceKeyRateLimit) return false;
    const expected = process.env.SERVICE_SECRET_KEY;
    return Boolean(expected) && req.get('X-Service-Key') === expected;
  },
  message: {
    code: 429,
    msg: 'Too many requests, please try again later.',
    data: null
  },
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res, next, options) => {
    const retryAfter = res.getHeader('Retry-After');
    logger.warn('[RATE-LIMIT] Request blocked', {
      requestId: req.requestId,
      method: req.method,
      path: req.originalUrl || req.url,
      ip: req.ip,
      forwardedFor: req.get('x-forwarded-for') || null,
      userAgent: req.get('user-agent') || null,
      limit: req.rateLimit?.limit,
      used: req.rateLimit?.used,
      remaining: req.rateLimit?.remaining,
      resetTime: req.rateLimit?.resetTime?.toISOString?.() || req.rateLimit?.resetTime || null,
      retryAfter: retryAfter || null
    });
    res.status(options.statusCode).send(options.message);
  }
});
app.use(limiter);

// ===========================================
// Body Parsing Middleware
// ===========================================

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// XSS protection
app.use(xssFilter({
  // Workspace markdown files are trusted service-to-service payloads and
  // must be stored verbatim (without HTML entity escaping).
  shouldSkip: (req) => /^\/toy\/agent\/device\/[^/]+\/workspace-files$/.test(req.path)
}));

// ===========================================
// Logging Middleware
// ===========================================

// HTTP request logging with request ID
const morganFormat = process.env.NODE_ENV === 'production'
  ? ':method :url :status :response-time ms - :res[content-length] [:req[X-Request-ID]]'
  : 'dev';
app.use(morgan(morganFormat, {
  stream: {
    write: (message) => logger.http(message.trim())
  },
  // Skip logging for health checks in production
  skip: (req) => process.env.NODE_ENV === 'production' && req.url === '/health'
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

app.get('/', (req, res) => {
  res.status(200).json({
    status: 'healthy',
    service: 'manager-api',
    apiBase: CONTEXT_PATH
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

// Admin dashboard (persona editor) — static UI + its own ADMIN_PASSWORD-gated
// API. Lives at /admin-dashboard. Reuses the agent.service template layer.
app.use('/admin-dashboard', require('../../admin-dashboard/admin-dashboard.routes')(express));

// ===========================================
// Error Handling
// ===========================================

// 404 handler
app.use(notFoundHandler);

// Global error handler
app.use(errorHandler);

module.exports = app;
