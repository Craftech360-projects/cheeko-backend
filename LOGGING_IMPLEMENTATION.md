# Production Logging Implementation Guide

This guide documents the production logging architecture for the MQTT Gateway, using **Winston** as the log manager, **Grafana Loki** for cloud aggregation, and **Daily Rotate File** for local storage.

## 1. Architecture Overview

We use a multi-transport logging strategy:

*   **Log Manager:** `winston` (The core library handling log logic).
*   **Destinations (Transports):**
    1.  **Console:** For real-time viewing in `pm2 logs` or terminal.
    2.  **Local Files:** `winston-daily-rotate-file` stores logs in `logs/` directory, rotating daily to prevent disk overflow.
    3.  **Cloud:** `winston-loki` sends logs to Grafana Cloud for centralized search, dashboards, and alerts.

## 2. Prerequisites

You need a Grafana Cloud account (Free Tier is sufficient).
1.  Sign up at [grafana.com](https://grafana.com/).
2.  Create a "Loki" stack.
3.  Get your **URL**, **User ID**, and **API Key**.

## 3. Installation

Run the following command in `main/mqtt-gateway`:

```bash
npm install winston winston-daily-rotate-file winston-loki
```

## 4. Configuration

### Environment Variables (.env)
Add these to your `.env` file:

```ini
# Logging Configuration
LOG_LEVEL=info                  # debug, info, warn, error
LOKI_HOST=https://logs-prod-xxx.grafana.net  # Your Grafana Loki URL
LOKI_USER=123456                # Your Grafana User ID
LOKI_PASSWORD=glc_eyJ...        # Your Grafana API Key
```

### Logger Setup (utils/logger.js)
Create a centralized logger configuration:

```javascript
const winston = require('winston');
const DailyRotateFile = require('winston-daily-rotate-file');
const LokiTransport = require('winston-loki');

const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  transports: [
    // 1. Console Transport (for PM2/Dev)
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.simple()
      )
    }),
    // 2. File Transport (Rotates daily, keeps 14 days)
    new DailyRotateFile({
      filename: 'logs/application-%DATE%.log',
      datePattern: 'YYYY-MM-DD',
      maxSize: '20m',
      maxFiles: '14d'
    }),
  ]
});

// 3. Loki Transport (Only if configured)
if (process.env.LOKI_HOST) {
  logger.add(new LokiTransport({
    host: process.env.LOKI_HOST,
    basicAuth: `${process.env.LOKI_USER}:${process.env.LOKI_PASSWORD}`,
    labels: { app: 'mqtt-gateway' },
    json: true,
    batching: true,
    interval: 5000
  }));
}

module.exports = logger;
```

## 5. Usage in Code

Replace `console.log` with `logger`:

```javascript
const logger = require('./utils/logger');

// Info
logger.info('Server started on port 3000');

// Error (pass the error object)
try {
  // ...
} catch (err) {
  logger.error('Failed to connect', { error: err.message, stack: err.stack });
}

// Debug (only shows if LOG_LEVEL=debug)
logger.debug('Processing audio frame', { size: 1024 });
```

## 6. Maintenance

*   **Local Logs:** Check `main/mqtt-gateway/logs/` folder. Old logs are auto-deleted after 14 days.
*   **Cloud Logs:** Visit your Grafana Dashboard -> Explore -> Select "Loki" datasource -> Query `{app="mqtt-gateway"}`.
