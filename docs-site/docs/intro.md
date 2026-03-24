---
id: intro
slug: /
sidebar_position: 1
---

# Cheeko Backend Overview

![Cheeko Hero](/img/cheeko-hero.png.jpeg)

Cheeko is an AI companion for children (ages 3–16) running on ESP32 devices. This documentation covers all five backend and firmware components and their integration.

![Boot-to-Conversation Flow](/img/Boot-to-Conversation%20flow.jpeg)

## System Components

| Component | Language | Role |
|-----------|----------|------|
| **livekit-server** | Python | AI voice agent — conversation, games, music/story playback |
| **manager-api-node** | Node.js / Express | REST API — device registry, OTA, config, content, analytics |
| **manager-web** | Vue.js | Admin dashboard for managing devices, users, models, and content |
| **mqtt-gateway** | Node.js | Protocol bridge: MQTT/UDP (ESP32) to LiveKit WebRTC |
| **ESP32 Firmware** | C++ / ESP-IDF | On-device client — state machine, audio pipeline, MQTT, RFID |
| **Parent App** | Flutter | iOS/Android app for parents — device setup, kid profiles, content |

## High-Level Data Flow

```
ESP32 Device ──MQTT/UDP──> mqtt-gateway ──WebSocket──> LiveKit Cloud
                               │                           │
                               │                           ▼
                               │                     livekit-server
                               │                      (AI Agent)
                               ▼                           │
                     manager-api-node (JS) <───────────────┘
                               │              (config, prompts, analytics)
                               ▼
                          manager-web
                         (Admin Dashboard)
```

All device-to-server communication starts with the Manager API (OTA check and activation), then shifts to the MQTT Gateway for real-time voice protocol. The livekit-server AI agent reads configuration and prompts from the Manager API during session setup.

## Service Ports

| Service | Port | Base Path |
|---------|------|-----------|
| manager-api-node | 8002 | `/toy` |
| MQTT broker (EMQX) | 1883 | — |
| UDP audio channel | dynamic | — |

## Quick Start

- For a full picture of how all services connect, see the [Architecture Overview](./architecture/overview.md).
- For MQTT and UDP message contracts, see the [Protocol Reference](./architecture/protocols.md).

:::note
`manager-api-node` (Node.js/Express) is the backend API implementation, exposing all endpoints under `/toy`.
:::
