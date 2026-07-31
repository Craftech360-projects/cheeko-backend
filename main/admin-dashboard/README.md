# Cheeko Admin Dashboard (standalone)

Two tabs:

- **Personas** — view/edit each character's **AGENT.md** (`system_prompt`) and
  **SOUL.md** (`soul`) and save them to the DB.
- **Test device** — talk to any character from the browser, over LiveKit.

It does **not** touch the DB directly. It proxies to the Manager API's
`/admin-dashboard` routes, so the shared Prisma client + `validateAgentMd`
(safety validator) stay on the manager side.

```
browser ──> dashboard server (this app) ──/api proxy──> Manager API ──> DB
        └── /lk/start ──> livekit-session.js ──> create room + dispatch agent
        └── WebRTC ─────────────────────────────> LiveKit room <── agent
```

## Run

1. Manager API must be running, with `ADMIN_PASSWORD` set on **its** env:
   ```powershell
   cd ..\manager-api-node
   $env:ADMIN_PASSWORD='letmein'; npm start    # default port 8002
   ```
2. Start the dashboard (separate terminal):
   ```powershell
   cd admin-dashboard
   npm install        # first time only
   npm start          # default port 4000
   ```
3. Open http://localhost:4000 — log in with the `ADMIN_PASSWORD` you set on the manager.

## Env

| Var | Where | Default | Purpose |
|-----|-------|---------|---------|
| `ADMIN_PASSWORD` | **manager** | — | login password (checked by manager) |
| `MANAGER_URL` | dashboard | `http://localhost:8002` | Manager API base URL |
| `PORT` | dashboard | `4000` | dashboard port |
| `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET` | dashboard | read from `../mqtt-gateway/` | **Test tab only.** Falls back to the gateway's `.env`, then its `config/mqtt.json`. |
| `MANAGER_API_URL`, `MANAGER_API_SECRET` | dashboard | read from `../mqtt-gateway/.env` | **Test tab only.** Resolves the character and fetches the child profile. |

The password lives only on the manager; the dashboard just forwards the
`Authorization` header. The `/lk/*` routes verify the same token by replaying
it against the manager's `/login`, so no second copy of the password exists.

## Test device tab

Talk to any character from the browser. Needs a **LiveKit server** and a
**LiveKit agent worker** running, plus the manager. It does **not** need the
mqtt-gateway or an MQTT broker.

Run `npm start` and check the second startup line:

```
Test tab: LiveKit ws://localhost:7880  |  agent API http://127.0.0.1:8002/toy
```

Pick a character, press **Start**, and talk. The agent's VAD handles
turn-taking, so you can speak and interrupt normally.

### Gotchas

- **The mic needs a secure context.** `localhost` is fine; a deployed
  `http://<ip>:4000` is not — browsers block `getUserMedia` outside HTTPS.
- **`LIVEKIT_URL` must be reachable from the browser**, not just from the
  server — the browser connects to LiveKit directly. `ws://localhost:7880`
  only works when the browser is on the same machine.
- **Use headphones**, or the agent hears itself.
- The **MAC** selects which child profile the agent loads. Keep it stable when
  testing personalization, vary it otherwise. Unlike the device path, two
  sessions on the same MAC don't collide — each gets its own room.
- The agent can take **10–40s to join on a cold worker**. Nothing kills the
  session while you wait (the gateway's 25s `AGENT-TIMEOUT` doesn't exist on
  this path), so it will connect eventually. A warm worker joins in ~2s.

## How the Test tab works

`livekit-session.js` does what mqtt-gateway does for a real device, minus the
device: resolve the character via the manager's `set-character`, fetch the
child profile, create the LiveKit room, attach dispatch metadata, dispatch the
agent — then mint a browser join token. The browser joins that room with
`livekit-client` as an ordinary WebRTC participant.

The metadata contract is **imported** from the gateway
(`core/mem0-integration.js`) rather than re-typed, so the worker only ever sees
one shape. Verified end-to-end: the worker logs `Using child profile from
dispatch metadata` and skips its own API call, exactly as it does for a real
device.

There is no MQTT, UDP, Opus or AES here — those exist to get an ESP32 into a
LiveKit room, and a browser is already a WebRTC client. This tests **the
agent**, not the device transport.

`livekit-client` is ESM-only and this app has no bundler, so the package's
`dist/` is served at `/vendor/livekit` and the page `import()`s it at use time.

### Testing the device transport instead

`device-sim.js` is a standalone Node port of `client.py`'s protocol half: MQTT
control plane, AES-CTR-over-Opus UDP audio, with the 16-byte packet header
doubling as the cipher's counter block. It has no UI — it's a CLI for
exercising the **gateway** path:

```powershell
$env:MQTT_SIGNATURE_KEY='<same value as the gateway .env>'
node device-sim.js --character-id NANI --seconds 30
```

It negotiates audio params from the gateway's hello response rather than
assuming them (the gateway answers 24 kHz / 60 ms even when asked for
16 kHz / 20 ms), and reports packet loss, gaps and duplicates on exit.

Note the gateway keys its virtual device by **MAC**, so `device-sim.js` and
`client.py` cannot run on the same MAC at the same time — the second connection
takes the device over and the first is starved with no error.

## Self-check

```
npm run check
```

Stubs Prisma (no DB) and asserts the save path rejects a malformed AGENT.md
(400) and persists a valid AGENT.md + SOUL.md through `agent.service`. Also
pins `device-sim.js`'s wire format against vectors generated by `client.py`'s
own `struct`/AES/HMAC code — if the sim drifts from the firmware the gateway
silently drops its packets, so those assertions are the early warning.

## Notes

- Needs Node 18+ (uses global `fetch` in `server.js`).
- The manager still mounts `/admin-dashboard` JSON routes (the proxy target).
  Those are API-only; the canonical UI is served by this app.
