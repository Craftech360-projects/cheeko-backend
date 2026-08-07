# Device Unbind API

Two endpoints unbind a device. They do the same thing to the database; they differ in who is allowed to call them.

| Endpoint | Auth | Ownership check | `hardDelete` |
|---|---|---|---|
| `POST /toy/device/unbind` | Bearer token required | Yes, unless caller is super admin | Supported |
| `POST /toy/device/unbind-open` | **None** | Always skipped | Not supported |

Source: [`src/routes/device.routes.js`](../src/routes/device.routes.js), logic in [`src/services/device.service.js`](../src/services/device.service.js) (`unbindDevice`).

---

## What unbinding does

A soft unbind sets three columns on `ai_device` to `null` and bumps `update_date`:

- `user_id` — the owning account
- `agent_id` — the AI agent configuration
- `kid_id` — the child profile

The row itself survives, so the device keeps its MAC, firmware version, board type and `last_connected_at`. It returns to the unclaimed state and can be paired again.

### Why this matters for activation

`POST /toy/ota/` only returns an `activation` block for an **unbound** device. A bound device gets an OTA response with no activation code at all, which looks like "the server isn't sending the code" from the device side. Unbinding is what makes the code appear:

```json
"activation": { "code": "827438", "challenge": "00:16:3E:AC:B5:38" }
```

If a device is stuck and won't re-pair, unbind it first, then re-request OTA config.

---

## `POST /toy/device/unbind-open`

No authentication. No headers beyond `Content-Type`.

### Request

```json
{ "deviceId": "00:16:3e:ac:b5:38" }
```

`deviceId` accepts either form:

- **MAC address** — separators and case are normalised (`normalizeMacAddress` strips `:`/`-` and uppercases), so `00:16:3e:ac:b5:38`, `00-16-3E-AC-B5-38` and `00163EACB538` all resolve to the same device.
- **Device UUID** — the `ai_device.id` value, e.g. `f5ba7fa0-4cdc-40cf-a5aa-d26383d3551f`.

### Response

Every response is **HTTP 200**. Success and failure are distinguished by the `code` field in the body, matching the Spring Boot envelope used across this API.

| `code` | `msg` | When |
|---|---|---|
| `0` | `success` | Device found and unbound |
| `500` | `Device ID cannot be empty` | `deviceId` missing or empty |
| `500` | `Device not found` | No row matches the MAC or UUID |

Do not branch on the HTTP status. Branch on `code`.

### Example

```bash
curl -X POST https://ota.cheekoai.in/toy/device/unbind-open \
  -H "Content-Type: application/json" \
  -d '{"deviceId":"00:16:3e:ac:b5:38"}'
```

```json
{"code":0,"msg":"success","data":null}
```

Calling it twice is harmless — unbinding an already-unbound device just rewrites the same nulls.

Each call logs a warning line, so unexpected use is visible in the PM2 logs:

```
Unauthenticated unbind for device: 00:16:3e:ac:b5:38
```

---

## `POST /toy/device/unbind` (authenticated)

Same body, plus a bearer token. Accepts an extra field:

```json
{ "deviceId": "00:16:3e:ac:b5:38", "hardDelete": true }
```

`hardDelete: true` deletes the `ai_device` row outright instead of clearing its bindings. The device can still re-register later (rows are keyed by MAC), but its prior record — firmware version, board, last-connected timestamp — is gone. Use it for cleaning up test rows, not for customer devices.

Without a token the request returns HTTP **401**. The token is an opaque 32-character session string from `sys_user_token`, valid 7 days, obtained from `POST /toy/user/login`:

```bash
curl -X POST https://ota.cheekoai.in/toy/user/login \
  -H "Content-Type: application/json" \
  -d '{"username":"you@example.com","password":"secret"}'
# → {"code":0,"data":{"token":"a1b2c3...","expire":604800}}
```

Non-super-admin callers may only unbind devices where `ai_device.user_id` matches their own id; otherwise the response is `code: 500`, `msg: "You don't have permission to unbind this device"`.

`X-Service-Key` does **not** work on this route — it uses `requireAuth`, which reads only the `Authorization` header.

---

## Related behaviour

Deleting an agent unbinds every device attached to it, clearing the same three columns in one `updateMany` — see `deleteAgent` in [`src/services/agent.service.js`](../src/services/agent.service.js).

---

## Security note

`/toy/device/unbind-open` is deliberately unauthenticated. Anyone who can reach the API can unbind any device given only its MAC address, and MAC addresses are not secret — they appear in OTA requests and MQTT client IDs. The practical impact is a denial-of-service: a device loses its pairing and a parent has to re-pair it.

The endpoint is public on both `https://ota.cheekoai.in` and `http://139.59.7.72:8002`.

If that exposure needs closing, the cheapest options, in increasing order of effort:

1. **Shared header** — require a fixed `X-Unbind-Key` value, roughly three lines in the route.
2. **IP allowlist** — restrict the path at the reverse proxy to whatever internal tool calls it.
3. **Delete the route** — go back to the authenticated `/toy/device/unbind` with a login round-trip.

---

## Verification status

Tested against `https://ota.cheekoai.in` (resolves to 139.59.7.72) on 2026-08-07:

- Unbind by MAC, no auth header — `code: 0`, and the `ai_device` row for `00:16:3E:AC:B5:38` confirmed in the database as `user_id`, `agent_id`, `kid_id` all `null` (previously `24`, `cd8c74a6-049b-4da6-acc3-2711461f305d`, `74`).
- Repeat call — `code: 0`, idempotent.
- Missing `deviceId` — `code: 500`, `Device ID cannot be empty`.
- Unknown MAC and malformed `deviceId` — `code: 500`, `Device not found`.
- Activation code returned by `/toy/ota/` after unbinding — confirmed.

Not exercised live: unbind by device UUID. That path is in the code (`isUuid` branch of `unbindDevice`) but was not called against production.

Deployment note: the route is running on the server as an in-place edit to `src/routes/device.routes.js`, with a `.bak` alongside it. It is committed on branch `feat/riddle-bank` (`95b8b4ee`) but not merged, so a `git pull` based deploy will remove it until that branch lands.
