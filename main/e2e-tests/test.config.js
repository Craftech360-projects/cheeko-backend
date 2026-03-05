/**
 * Shared E2E Test Configuration
 *
 * Single source of truth for server URLs, auth credentials, and timeouts.
 * Used by PactumJS, Jest (MQTT), and Playwright tests.
 * All values read from .env — no need to edit this file.
 */

const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '.env'), quiet: true });

const DEV_HOST = process.env.DEV_HOST || 'localhost';
const DEV_API_PORT = process.env.DEV_API_PORT || '8002';
const DEV_MQTT_PORT = process.env.DEV_MQTT_PORT || '1883';
const DEV_GATEWAY_PORT = process.env.DEV_GATEWAY_PORT || '8000';
const DEV_MEDIA_PORT = process.env.DEV_MEDIA_PORT || '8003';

module.exports = {
  env: process.env.TEST_ENV || 'dev',

  managerApi: {
    baseUrl: `http://${DEV_HOST}:${DEV_API_PORT}/toy`,
  },

  mqttGateway: {
    brokerUrl: `mqtt://${DEV_HOST}:${DEV_MQTT_PORT}`,
    httpUrl: `http://${DEV_HOST}:${DEV_GATEWAY_PORT}`,
  },

  mediaApi: {
    baseUrl: `http://${DEV_HOST}:${DEV_MEDIA_PORT}`,
  },

  dashboard: {
    baseUrl: process.env.DASHBOARD_URL || 'http://localhost:8080',
  },

  auth: {
    adminUser: process.env.ADMIN_USER || 'admin',
    adminPass: process.env.ADMIN_PASS || 'admin123',
    serviceKey: process.env.SERVICE_SECRET_KEY || 'your-service-key',
    firebaseToken: process.env.FIREBASE_TEST_TOKEN || '',
  },

  settings: {
    timeoutMs: 15000,
    responseTimeThreshold: 5000,
    retries: 1,
  },
};
