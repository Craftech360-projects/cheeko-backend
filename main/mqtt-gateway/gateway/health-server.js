const http = require('http');

const logger = require('../utils/logger');

function buildHealthPayload(gateway) {
  return {
    status: 'healthy',
    service: 'mqtt-gateway',
    timestamp: new Date().toISOString(),
    uptime_seconds: Math.floor(process.uptime()),
    checks: {
      mqtt_connected: !!gateway?.mqttClient?.connected,
      active_device_connections: gateway?.deviceConnections?.size || 0,
      active_virtual_connections: gateway?.connections?.size || 0,
    },
  };
}

function startHealthServer(gateway) {
  const port = Number(process.env.HEALTH_PORT || 8004);
  const host = process.env.HEALTH_HOST || '0.0.0.0';

  const server = http.createServer((req, res) => {
    const route = (req.url || '').split('?')[0];

    if (req.method === 'GET' && route === '/health') {
      const body = JSON.stringify(buildHealthPayload(gateway));
      res.writeHead(200, {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
      });
      res.end(body);
      return;
    }

    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ code: 404, msg: 'Not found' }));
  });

  server.listen(port, host, () => {
    logger.info(`[HEALTH] Listening on http://${host}:${port}/health`);
  });

  return server;
}

module.exports = {
  startHealthServer,
};
