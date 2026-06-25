# Cheeko Admin Dashboard (standalone)

Independent app to view/edit each character's **AGENT.md** (`system_prompt`) and
**SOUL.md** (`soul`) and save them to the DB.

It does **not** touch the DB directly. It proxies to the Manager API's
`/admin-dashboard` routes, so the shared Prisma client + `validateAgentMd`
(safety validator) stay on the manager side.

```
browser ──> dashboard server (this app) ──/api proxy──> Manager API ──> DB
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
   $env:MANAGER_URL='http://localhost:8002'   # optional, this is the default
   npm start          # default port 4000
   ```
3. Open http://localhost:4000 — log in with the `ADMIN_PASSWORD` you set on the manager.

## Env

| Var | Where | Default | Purpose |
|-----|-------|---------|---------|
| `ADMIN_PASSWORD` | **manager** | — | login password (checked by manager) |
| `MANAGER_URL` | dashboard | `http://localhost:8002` | Manager API base URL |
| `PORT` | dashboard | `4000` | dashboard port |

The password lives only on the manager; the dashboard just forwards the
`Authorization` header.

## Self-check

```
npm run check
```

Stubs Prisma (no DB) and asserts the save path rejects a malformed AGENT.md
(400) and persists a valid AGENT.md + SOUL.md through `agent.service`.

## Notes

- Needs Node 18+ (uses global `fetch` in `server.js`).
- The manager still mounts `/admin-dashboard` JSON routes (the proxy target).
  Those are API-only; the canonical UI is served by this app.
