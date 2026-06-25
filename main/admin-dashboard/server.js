/**
 * Standalone admin dashboard server.
 *
 * Independent app: own express, own port. Serves the static UI and proxies
 * /api/* to the Manager API's /admin-dashboard JSON routes — so the shared
 * Prisma client + validateAgentMd stay on the manager side (no second DB).
 *
 * The browser only talks to THIS origin -> no CORS. ADMIN_PASSWORD is checked
 * by the manager; we just forward the Authorization header.
 *
 * Env:
 *   PORT         dashboard port (default 4000)
 *   MANAGER_URL  base URL of the Manager API (default http://localhost:8002)
 */

const express = require('express');
const path = require('path');

const PORT = process.env.PORT || 4000;
const MANAGER_URL = (process.env.MANAGER_URL || 'http://localhost:8002').replace(/\/+$/, '');

const app = express();
app.use(express.json());

// Proxy: /api/<x>  ->  <MANAGER_URL>/admin-dashboard/<x>
// req.url here is the remainder after the /api mount (e.g. /login, /templates/123).
app.use('/api', async (req, res) => {
  const target = MANAGER_URL + '/admin-dashboard' + req.url;
  try {
    const r = await fetch(target, {
      method: req.method,
      headers: {
        'Content-Type': 'application/json',
        ...(req.headers.authorization ? { Authorization: req.headers.authorization } : {}),
      },
      body: req.method === 'GET' || req.method === 'HEAD' ? undefined : JSON.stringify(req.body),
    });
    const text = await r.text();
    res.status(r.status).type('application/json').send(text || '{}');
  } catch (e) {
    res.status(502).json({ msg: 'Manager API unreachable: ' + e.message });
  }
});

app.use('/', express.static(path.join(__dirname, 'public')));

app.listen(PORT, () => {
  console.log(`Admin dashboard: http://localhost:${PORT}  ->  Manager ${MANAGER_URL}`);
});
