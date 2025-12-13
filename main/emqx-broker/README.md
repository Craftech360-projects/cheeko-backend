# EMQX Broker Service

This directory contains the EMQX MQTT broker configuration for Railway deployment.

## Rule Configuration

The broker is configured with the following rule:

**Rule ID:** `device_server_republish`

**SQL:** `SELECT payload, clientid FROM "device-server"`

**Action:** Republish to `internal/server-ingest` with the following payload structure:

```json
{
  "orginal_payload": <original_payload>,
  "sender_client_id": "<client_id>"
}
```

This rule captures all messages published to the `device-server` topic and republishes them to `internal/server-ingest` with additional client metadata, allowing the MQTT Gateway to process them with full context.

## Deployment

Deploy this service to Railway:

```bash
railway up --service emqx-broker
```

## Environment Variables

- `EMQX_ALLOW_ANONYMOUS=true` - Allows anonymous connections
- `EMQX_LISTENERS__TCP__DEFAULT__BIND=0.0.0.0:1883` - MQTT TCP listener
- `EMQX_LISTENERS__WS__DEFAULT__BIND=0.0.0.0:8083` - MQTT WebSocket listener
- `EMQX_DASHBOARD__LISTENERS__HTTP__BIND=0.0.0.0:18083` - Dashboard

## Ports

- **1883**: MQTT TCP
- **8083**: MQTT WebSocket
- **18083**: EMQX Dashboard (admin:public)
