const http = require('http');

const logger = require('../utils/logger');

function sendJson(res, statusCode, body) {
  const payload = JSON.stringify(body);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(payload),
  });
  res.end(payload);
}

function parseJsonBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (chunk) => {
      raw += chunk;
      if (raw.length > 1024 * 1024) {
        reject(new Error('Payload too large'));
      }
    });
    req.on('end', () => {
      if (!raw) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(raw));
      } catch (error) {
        reject(new Error('Invalid JSON body'));
      }
    });
    req.on('error', reject);
  });
}

function startInternalCommandServer(gateway) {
  const port = Number(process.env.MQTT_GATEWAY_INTERNAL_PORT || 8091);
  const host = process.env.MQTT_GATEWAY_INTERNAL_HOST || '127.0.0.1';
  const expectedKey = process.env.MANAGER_API_SECRET || process.env.SERVICE_SECRET_KEY;

  const server = http.createServer(async (req, res) => {
    try {
      if (req.method === 'GET' && (req.url || '').split('?')[0] === '/health') {
        sendJson(res, 200, { status: 'healthy' });
        return;
      }

      if (req.method !== 'POST') {
        sendJson(res, 405, { code: 405, msg: 'Method not allowed', data: null });
        return;
      }
      const route = (req.url || '').split('?')[0];
      const isPublishUpdate = route === '/internal/settings/publish-update';
      const isPing = route === '/internal/settings/ping';
      if (!isPublishUpdate && !isPing) {
        sendJson(res, 404, { code: 404, msg: 'Not found', data: null });
        return;
      }

      const serviceKey = req.headers['x-service-key'];
      if (!expectedKey || serviceKey !== expectedKey) {
        logger.warn(`[SETTINGS-SYNC][INTERNAL-CMD] Unauthorized request route=${route}`);
        sendJson(res, 401, { code: 401, msg: 'Unauthorized', data: null });
        return;
      }

      const body = await parseJsonBody(req);
      const { mac_address, sender_client_id, message } = body || {};
      logger.info(`[SETTINGS-SYNC][INTERNAL-CMD] route=${route} mac=${mac_address || 'na'} sender=${sender_client_id || 'na'}`);

      let resolvedMessage = message;
      if (isPing) {
        resolvedMessage = { type: 'settings_ping' };
      } else if (!resolvedMessage || typeof resolvedMessage !== 'object' || Array.isArray(resolvedMessage)) {
        sendJson(res, 400, { code: 400, msg: 'message object is required', data: null });
        return;
      }

      const resolvedMac = typeof mac_address === 'string' ? mac_address.trim().toUpperCase() : '';
      const targetClientId = sender_client_id || gateway.resolveSenderClientIdByMac(resolvedMac);
      if (!targetClientId) {
        logger.warn(`[SETTINGS-SYNC][INTERNAL-CMD] No active sender_client_id for mac=${resolvedMac || 'na'}`);
        sendJson(res, 404, {
          code: 404,
          msg: 'No active sender_client_id for device',
          data: { mac_address: resolvedMac || null },
        });
        return;
      }

      const outTopic = `devices/p2p/${targetClientId}`;
      gateway.mqttPublish(outTopic, resolvedMessage);
      logger.info(
        `[SETTINGS-SYNC][INTERNAL-CMD] Published ${resolvedMessage.type || 'unknown'} to sender=${targetClientId} topic=${outTopic} payload=${JSON.stringify(resolvedMessage)}`
      );
      sendJson(res, 200, {
        code: 0,
        msg: 'success',
        data: {
          target_client_id: targetClientId,
          topic: outTopic,
          message_type: resolvedMessage.type || 'unknown',
        },
      });
    } catch (error) {
      logger.error(`[INTERNAL-CMD] Request failed: ${error.message}`);
      sendJson(res, 500, { code: 500, msg: error.message, data: null });
    }
  });

  server.listen(port, host, () => {
    logger.info(`[INTERNAL-CMD] Listening on http://${host}:${port}`);
  });

  return server;
}

module.exports = {
  startInternalCommandServer,
};
