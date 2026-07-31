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
 * The Test tab creates a LiveKit room, dispatches the agent into it and hands
 * the browser a join token — the same sequence mqtt-gateway performs for a real
 * device. See livekit-session.js.
 *
 * Env (all optional; see README for the fallback chain):
 *   PORT             dashboard port (default 4000)
 *   MANAGER_URL      base URL of the Manager API (default http://localhost:8002)
 *   LIVEKIT_URL      must be reachable BY THE BROWSER, not just by this server
 *   LIVEKIT_API_KEY / LIVEKIT_API_SECRET
 *   MANAGER_API_URL / MANAGER_API_SECRET   agent-facing API, for character + child profile
 */

const express = require('express');
const path = require('path');
const http = require('http');
const fs = require('fs');

// Load .env explicitly. It was previously only picked up as a side effect of
// requiring the gateway's logger, which is not something to depend on.
require('dotenv').config({ path: path.join(__dirname, '.env') });

const livekitSession = require('./livekit-session');

// The Test tab has to reach the same LiveKit and the same Manager API as the
// gateway, so read the gateway's own config rather than making everyone
// re-declare it. Explicit env vars win, for deployments where the gateway
// isn't a sibling checkout.
let gatewayEnvCache = null;
function gatewayEnv(key) {
  if (process.env[key]) return process.env[key];
  if (gatewayEnvCache === null) {
    try {
      gatewayEnvCache = fs.readFileSync(path.join(__dirname, '../mqtt-gateway/.env'), 'utf8');
    } catch {
      gatewayEnvCache = '';
    }
  }
  const m = gatewayEnvCache.match(new RegExp(`^\\s*${key}\\s*=\\s*(.*)$`, 'm'));
  return m ? m[1].trim().replace(/^["']|["']$/g, '') : '';
}

// LiveKit creds: gateway env first, then its config/mqtt.json (same precedence
// the gateway itself applies, just in the opposite read order).
function livekitConfig() {
  let file = {};
  try {
    file = JSON.parse(fs.readFileSync(path.join(__dirname, '../mqtt-gateway/config/mqtt.json'), 'utf8')).livekit || {};
  } catch { /* no sibling gateway checkout */ }
  const url = gatewayEnv('LIVEKIT_URL') || file.url;
  return {
    url,
    // Where the BROWSER should connect. Often not the same address this server
    // uses: localhost is reachable here but meaningless in a remote browser,
    // and the LAN IP can be firewalled for this process even though LiveKit
    // binds 0.0.0.0. Defaults to the server URL when they are the same.
    publicUrl: gatewayEnv('LIVEKIT_PUBLIC_URL') || url,
    apiKey: gatewayEnv('LIVEKIT_API_KEY') || file.api_key,
    apiSecret: gatewayEnv('LIVEKIT_API_SECRET') || file.api_secret,
  };
}

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

// Generated AI Imagine images live on another origin -> fetch them server-side
// so the <img> isn't at the mercy of that host's CORS headers.
app.get('/img', async (req, res) => {
  const url = req.query.url;
  if (!/^https?:\/\//.test(url || '')) return res.status(400).send('bad url');
  try {
    const r = await fetch(url);
    res.type(r.headers.get('content-type') || 'image/jpeg');
    res.send(Buffer.from(await r.arrayBuffer()));
  } catch (e) {
    res.status(502).send(e.message);
  }
});

const LIVEKIT = livekitConfig();
// The manager URL the *gateway* uses — the agent-facing API, which is not
// necessarily the same host as the admin MANAGER_URL we proxy to.
const MANAGER_API_URL = (gatewayEnv('MANAGER_API_URL') || MANAGER_URL + '/toy').replace(/\/+$/, '');

// Same password gate as the proxied routes: replay the token against the
// manager so the password still lives only there.
async function requireAdmin(req, res, next) {
  const auth = req.headers.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  try {
    const r = await fetch(MANAGER_URL + '/admin-dashboard/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: token }),
    });
    if (!r.ok) return res.status(401).json({ msg: 'Unauthorized' });
    next();
  } catch (e) {
    res.status(502).json({ msg: 'Manager API unreachable: ' + e.message });
  }
}

// Create a room, dispatch the agent, hand the browser a join token.
app.post('/lk/start', requireAdmin, async (req, res) => {
  if (!LIVEKIT.url || !LIVEKIT.apiKey || !LIVEKIT.apiSecret) {
    return res.status(500).json({ msg: 'LiveKit credentials not configured' });
  }
  try {
    const out = await livekitSession.startSession({
      livekit: LIVEKIT,
      managerApiUrl: MANAGER_API_URL,
      managerSecret: gatewayEnv('MANAGER_API_SECRET'),
      mac: (req.body?.mac || '00:16:3e:ac:b5:38').trim(),
      characterName: req.body?.characterName || null,
    });
    res.json(out);
  } catch (e) {
    res.status(500).json({ msg: e.message });
  }
});

app.post('/lk/stop', requireAdmin, async (req, res) => {
  if (req.body?.roomName) await livekitSession.deleteRoom(LIVEKIT, req.body.roomName);
  res.json({ ok: true });
});

// livekit-client ships ESM only; serve it so the page can import() it without
// adding a bundler to an app that has deliberately never had one.
app.use('/vendor/livekit', express.static(path.join(__dirname, 'node_modules/livekit-client/dist')));

app.use('/', express.static(path.join(__dirname, 'public')));

const server = http.createServer(app);
server.listen(PORT, () => {
  console.log(`Admin dashboard: http://localhost:${PORT}  ->  Manager ${MANAGER_URL}`);
  console.log(
    LIVEKIT.url && LIVEKIT.apiKey
      ? `Test tab: LiveKit ${LIVEKIT.url}` +
        (LIVEKIT.publicUrl !== LIVEKIT.url ? ` (browser -> ${LIVEKIT.publicUrl})` : '') +
        `  |  agent API ${MANAGER_API_URL}`
      : 'Test tab: DISABLED — no LiveKit credentials (set LIVEKIT_URL/API_KEY/API_SECRET)'
  );
});
