# Uptime Kuma Monitoring Configuration

Last updated: 2026-05-18

## Scope

This file documents the monitoring setup for:

- `D:\cheeko-backend\main\manager-api-node`
- `D:\cheeko-backend\main\manager-web`
- `D:\cheeko-backend\main\mqtt-gateway`
- `D:\cheeko-backend\main\livekit-server\workers\cheeko_worker.py` (dependency context)

## Network Choice

Kuma monitors are configured to use system IP:

- `139.59.7.72`

Not using `host.docker.internal`.

## Uptime Kuma Runtime

Kuma moved off this box to a dedicated EC2 instance in May 2026. The details below are current as
of 2026-08-31.

- Host: EC2 `16.112.52.71` (SSH alias `aws-kuma-production`), ap-south-2, instance
  `i-0c1d60b5df6d3220d`, user `ec2-user`, key `~/.ssh/kuma-ap-south-2.pem`
- Elastic IP: `eipalloc-0f0a1b78be1cf3404` — the address is permanent, do not expect it to change
- Container name: `uptime-kuma`
- UI: `http://16.112.52.71:3001` — reachable **only from the admin CIDR**, see below
- DB path in container: `/app/data/kuma.db`; on host `/opt/uptime-kuma/data`
- Backups: `/opt/uptime-kuma/backups`, nightly 02:30 UTC via the `kuma-backup.timer` systemd unit,
  7-day retention. `cronie` is not installed on this host — use systemd timers, not `/etc/cron.d`.

### Network access

Security group `sg-0ca72b10de2f2e764` allows ports 22 and 3001 from the admin CIDR only. If SSH
starts hanging, your public IP has changed. Re-open it from anywhere (the AWS API is not
IP-restricted):

```bash
IP=$(curl -s https://checkip.amazonaws.com)
aws ec2 authorize-security-group-ingress --region ap-south-2 --group-id sg-0ca72b10de2f2e764 \
  --ip-permissions "IpProtocol=tcp,FromPort=22,ToPort=22,IpRanges=[{CidrIp=$IP/32,Description=admin-ssh}]" \
                   "IpProtocol=tcp,FromPort=3001,ToPort=3001,IpRanges=[{CidrIp=$IP/32,Description=admin-kuma-ui}]"
```

### Monitor inventory

The table further down this file is **stale** and is being replaced. The current design and rollout
plan live in the picoclaw repo:

- `docs/monitoring/monitoring-redesign-design.md`
- `docs/monitoring/monitoring-redesign-plan.md`

## Manager API Health Endpoints

Defined in:

- [index.js](D:/cheeko-backend/main/manager-api-node/src/routes/index.js)

Endpoints:

- `GET /toy/health`
- `GET /toy/health/db`
- `GET /toy/health/deps/gemini`
- `GET /toy/health/deps/elevenlabs`

Behavior notes:

- `/toy/health/db` returns JSON database state but keeps HTTP `200` (current behavior).
- `/toy/health/deps/gemini` requires `GEMINI_API_KEY` or `GOOGLE_API_KEY`.
- `/toy/health/deps/elevenlabs` requires:
  - `ELEVENLABS_API_KEY` or `ELEVEN_API_KEY`
  - `ELEVENLABS_VOICE_ID`
- ElevenLabs dependency check uses a tiny TTS probe (real synth path), which supports keys that do not have `voices_read/models_read` permission.

## MQTT Gateway Health Endpoint

Files:

- [app.js](D:/cheeko-backend/main/mqtt-gateway/app.js)
- [health-server.js](D:/cheeko-backend/main/mqtt-gateway/gateway/health-server.js)

Endpoint:

- `GET http://139.59.7.72:8004/health`

Port:

- `8004` (`HEALTH_PORT` optional env, defaults to `8004`)

## Live Monitor Inventory (Current)

Source: live Kuma DB (`monitor` table) on 2026-05-18.

| ID | Name | Type | Target | Interval (sec) | Retry Interval | Max Retries | Timeout (sec) |
|---|---|---|---|---:|---:|---:|---:|
| 1 | Manager API Health | http | `http://139.59.7.72:8002/toy/health` | 30 | 30 | 2 | 10 |
| 2 | Manager API DB Health | http | `http://139.59.7.72:8002/toy/health/db` | 60 | 30 | 2 | 15 |
| 3 | Manager Web Health | http | `http://139.59.7.72:8001/health` | 60 | 30 | 2 | 10 |
| 4 | MQTT Gateway Health | http | `http://139.59.7.72:8004/health` | 30 | 30 | 2 | 10 |
| 6 | EMQX MQTT Port 1883 | port | `139.59.7.72:1883` | 30 | 30 | 2 | 5 |
| 7 | LiveKit Local Port 7880 | port | `139.59.7.72:7880` | 30 | 30 | 2 | 5 |
| 8 | Manager API Remote Health | http | `http://64.227.170.31:8002/toy/health` | 60 | 30 | 2 | 10 |
| 9 | LiveKit Cloud Port 443 | port | `cheeko-prod-68ib8ma4.livekit.cloud:443` | 60 | 30 | 2 | 8 |
| 11 | Qdrant Cloud Port 443 | port | `a2482b9f-2c29-476e-9ff0-741aaaaf632e.eu-west-1-0.aws.cloud.qdrant.io:443` | 120 | 30 | 2 | 8 |
| 12 | Mem0 API Port 443 | port | `api.mem0.ai:443` | 120 | 30 | 2 | 8 |
| 13 | Grafana Loki Port 443 | port | `logs-prod-028.grafana.net:443` | 120 | 30 | 2 | 8 |
| 14 | CloudFront CDN Port 443 | port | `dsmzc13oafp54.cloudfront.net:443` | 180 | 30 | 2 | 8 |
| 15 | Uptime Kuma Self Check | http | `http://127.0.0.1:3001` | 60 | 30 | 2 | 8 |
| 16 | Gemini API Health (Manager API) | http | `http://139.59.7.72:8002/toy/health/deps/gemini` | 3600 | 30 | 2 | 10 |
| 17 | Gemini API Port 443 | port | `generativelanguage.googleapis.com:443` | 3600 | 30 | 2 | 8 |
| 18 | ElevenLabs API Health (Manager API) | http | `http://139.59.7.72:8002/toy/health/deps/elevenlabs` | 3600 | 30 | 2 | 10 |
| 19 | ElevenLabs API Port 443 | port | `api.elevenlabs.io:443` | 120 | 30 | 2 | 8 |

## Env Vars Reference

Manager API:

- [`.env.example`](D:/cheeko-backend/main/manager-api-node/.env.example)

Relevant keys:

- `GEMINI_API_KEY` or `GOOGLE_API_KEY`
- `ELEVENLABS_API_KEY` or `ELEVEN_API_KEY`
- `ELEVENLABS_VOICE_ID`
- `ELEVENLABS_MODEL_ID` (optional, default set in code if missing)

MQTT Gateway:

- `HEALTH_PORT` (optional; default `8004`)

## Operational Notes

- If a dependency key is missing or invalid, dependency monitor endpoints return `503`.
- If ElevenLabs key is TTS-only (no `voices_read` permission), this setup still works because health check uses TTS probe.
- If you update `.env` values, restart `manager-api-node` so new values are loaded.

## Quick Verify Commands

```powershell
curl.exe -i http://139.59.7.72:8002/toy/health
curl.exe -i http://139.59.7.72:8002/toy/health/db
curl.exe -i http://139.59.7.72:8002/toy/health/deps/gemini
curl.exe -i http://139.59.7.72:8002/toy/health/deps/elevenlabs
curl.exe -i http://139.59.7.72:8004/health
```

