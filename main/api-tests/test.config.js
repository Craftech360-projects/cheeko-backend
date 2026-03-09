/**
 * Test Configuration
 *
 * All IPs and credentials are read from .env file.
 * Just edit .env — no need to touch this file.
 */

const path = require('path');

// Load .env file (quiet: suppress dotenv logs)
require('dotenv').config({ path: path.resolve(__dirname, '.env'), quiet: true });

const DEV_HOST = process.env.DEV_HOST || 'localhost';
const DEV_API_PORT = process.env.DEV_API_PORT || '8002';
const DEV_MQTT_PORT = process.env.DEV_MQTT_PORT || '1883';
const DEV_GATEWAY_PORT = process.env.DEV_GATEWAY_PORT || '8000';
const DEV_MEDIA_PORT = process.env.DEV_MEDIA_PORT || '8003';

const PROD_HOST = process.env.PROD_HOST || 'PROD_IP';
const PROD_API_PORT = process.env.PROD_API_PORT || '8002';
const PROD_MQTT_PORT = process.env.PROD_MQTT_PORT || '1883';
const PROD_GATEWAY_PORT = process.env.PROD_GATEWAY_PORT || '8000';
const PROD_MEDIA_PORT = process.env.PROD_MEDIA_PORT || '8003';

module.exports = {
  environments: {
    dev: {
      managerApi: { baseUrl: `http://${DEV_HOST}:${DEV_API_PORT}/toy` },
      mqttGateway: { brokerUrl: `mqtt://${DEV_HOST}:${DEV_MQTT_PORT}`, httpUrl: `http://${DEV_HOST}:${DEV_GATEWAY_PORT}` },
      mediaApi: { baseUrl: `http://${DEV_HOST}:${DEV_MEDIA_PORT}` },
      auth: {
        adminUser: process.env.ADMIN_USER || 'admin',
        adminPass: process.env.ADMIN_PASS || 'admin123',
        serviceKey: process.env.SERVICE_SECRET_KEY || 'your-service-key',
        firebaseToken: process.env.FIREBASE_TEST_TOKEN || ''
      }
    },
    prod: {
      managerApi: { baseUrl: `http://${PROD_HOST}:${PROD_API_PORT}/toy` },
      mqttGateway: { brokerUrl: `mqtt://${PROD_HOST}:${PROD_MQTT_PORT}`, httpUrl: `http://${PROD_HOST}:${PROD_GATEWAY_PORT}` },
      mediaApi: { baseUrl: `http://${PROD_HOST}:${PROD_MEDIA_PORT}` },
      auth: {
        adminUser: process.env.PROD_ADMIN_USER || 'admin',
        adminPass: process.env.PROD_ADMIN_PASS || '',
        serviceKey: process.env.PROD_SERVICE_KEY || '',
        firebaseToken: process.env.FIREBASE_TEST_TOKEN || ''
      }
    }
  },

  defaultEnv: 'dev',

  // Source code paths for scanners
  sources: {
    managerApiRoutes: path.resolve(__dirname, '../manager-api-node/src/routes'),
    managerApiApp: path.resolve(__dirname, '../manager-api-node/src/app.js'),
    mqttGateway: path.resolve(__dirname, '../mqtt-gateway/gateway'),
    mediaApi: path.resolve(__dirname, '../livekit-server/media_api.py')
  },

  // Test generation settings
  settings: {
    timeoutMs: 10000,
    responseTimeThreshold: 5000,
    retries: 0
  }
};
