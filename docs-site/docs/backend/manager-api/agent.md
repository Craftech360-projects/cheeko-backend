---
id: agent
sidebar_position: 4
---

# Agent Config Endpoints

AI agent configuration, character management, and chat history. Base path: `/toy/agent`.

An **agent** is a named AI persona (e.g. "Cheeko", "Dino") with its own system prompt, model configuration, and language settings. Each device is linked to one agent; the MQTT gateway and LiveKit server read agent config at session start.

## Endpoint Summary

### Agent CRUD

| Method | Path | Auth | Description |
|---|---|---|---|
| `GET` | `/toy/agent/list` | User | List agents (own agents; admin sees all) |
| `GET` | `/toy/agent/all` | Admin | All agents, paginated |
| `POST` | `/toy/agent` | User | Create agent |
| `GET` | `/toy/agent/:id` | User | Get agent by ID |
| `PUT` | `/toy/agent/:id` | User | Update agent |
| `DELETE` | `/toy/agent/:id` | User | Delete agent and unlink devices |

### Agent Templates

| Method | Path | Auth | Description |
|---|---|---|---|
| `GET` | `/toy/agent/template` | User | List visible templates |
| `POST` | `/toy/agent/template` | User | Create template |
| `GET` | `/toy/agent/template/:id` | User | Get template by ID |
| `PUT` | `/toy/agent/template/:id` | User | Update template |
| `DELETE` | `/toy/agent/template/:id` | User | Delete template |
| `POST` | `/toy/agent/template/:id/apply-to-agents` | User | Push template changes to all matching agents |

### Device-facing config (no auth required)

| Method | Path | Auth | Description |
|---|---|---|---|
| `GET` | `/toy/agent/config/:mac` | None | **Key endpoint** — full agent config by device MAC |
| `GET` | `/toy/agent/prompt/:mac` | None | Alias for `/config/:mac` |
| `GET` | `/toy/agent/agent-id/:mac` | None | Get agent ID for device |
| `GET` | `/toy/agent/device/:mac/agent-id` | None | Gateway alias for agent ID |
| `GET` | `/toy/agent/current-character/:mac` | None | Current character name |
| `GET` | `/toy/agent/device/:mac/current-character` | None | Gateway alias for current character |
| `POST` | `/toy/agent/device/:mac/set-character` | None | Switch character by name |
| `POST` | `/toy/agent/device/:mac/cycle-character` | None | Cycle to next character |

### Chat history

| Method | Path | Auth | Description |
|---|---|---|---|
| `POST` | `/toy/agent/chat-message` | None | Save single chat message (LiveKit agent) |
| `POST` | `/toy/agent/chat-history/report` | None | Report single message in real-time |
| `POST` | `/toy/agent/chat-history/session` | None | Batch upload all messages for a session |
| `GET` | `/toy/agent/:id/sessions` | User | List sessions for an agent |
| `GET` | `/toy/agent/:id/history/:sessionId` | User | Get messages for a session |

---

## GET `/toy/agent/config/:mac`

The most important endpoint in the system. Called by the MQTT gateway and LiveKit server at the start of every voice session to get the full agent configuration for the connected device.

### Path Parameters

| Param | Description |
|---|---|
| `mac` | Device MAC address (any format; normalized internally) |

### Response

```json
{
  "code": 0,
  "msg": "success",
  "data": {
    "agentId": "550e8400-e29b-41d4-a716-446655440000",
    "agentName": "Cheeko",
    "systemPrompt": "You are Cheeko, a friendly AI companion for children...",
    "asrModelId": "deepgram",
    "vadModelId": "silero",
    "llmModelId": "llama-3.3-70b-versatile",
    "ttsModelId": "elevenlabs",
    "ttsVoiceId": "cheeko_voice_id",
    "memModelId": "mem0",
    "langCode": "en",
    "language": "English",
    "chatHistoryConf": 10
  }
}
```

| Field | Type | Description |
|---|---|---|
| `agentId` | string (UUID) | Agent identifier |
| `agentName` | string | Display name / character name |
| `systemPrompt` | string | Full system prompt for the LLM |
| `asrModelId` | string | Speech-to-text model identifier |
| `vadModelId` | string | Voice activity detection model |
| `llmModelId` | string | Language model identifier |
| `ttsModelId` | string | Text-to-speech model identifier |
| `ttsVoiceId` | string | TTS voice ID (e.g. ElevenLabs voice) |
| `memModelId` | string | Memory/personalization model |
| `langCode` | string | ISO language code (e.g. `"en"`) |
| `language` | string | Full language name (e.g. `"English"`) |
| `chatHistoryConf` | integer | Number of recent messages to include in LLM context |

Returns `404` if the device or its linked agent is not found.

---

## GET `/toy/agent/device/:mac/agent-id`

Used by the LiveKit server to resolve the agent ID for a device MAC before starting a session.

### Response

```json
{
  "code": 0,
  "msg": "success",
  "data": "550e8400-e29b-41d4-a716-446655440000"
}
```

`data` is the agent ID string directly.

---

## GET `/toy/agent/device/:mac/current-character`

Returns the character name currently assigned to the device. Used by the MQTT gateway for display purposes.

### Response

```json
{
  "code": 0,
  "msg": "success",
  "data": { "characterName": "Cheeko" }
}
```

---

## POST `/toy/agent/device/:mac/set-character`

Switches the device's active character/agent by name. The server finds the agent with matching `agent_name` under the device owner's account.

### Request

```json
{ "characterName": "Dino" }
```

### Response

```json
{
  "code": 0,
  "msg": "success",
  "data": { "success": true, "newModeName": "Dino" }
}
```

---

## POST `/toy/agent/device/:mac/cycle-character`

Advances the device to the next character in the owner's agent list (ordered by `sort` field). Wraps around at the end.

### Response

```json
{
  "code": 0,
  "msg": "success",
  "data": { "success": true, "newModeName": "Robo" }
}
```

---

## Agent CRUD Endpoints

### POST `/toy/agent` — Create agent

### Request

```json
{
  "agentCode": "CHEEKO",
  "agentName": "Cheeko",
  "asrModelId": "deepgram",
  "vadModelId": "silero",
  "llmModelId": "llama-3.3-70b-versatile",
  "vllmModelId": null,
  "ttsModelId": "elevenlabs",
  "ttsVoiceId": "cheeko_voice_id",
  "memModelId": "mem0",
  "intentModelId": null,
  "chatHistoryConf": 10,
  "systemPrompt": "You are Cheeko...",
  "summaryMemory": "",
  "langCode": "en",
  "language": "English",
  "sort": 0
}
```

| Field | Type | Description |
|---|---|---|
| `agentCode` | string | Optional code linking agent to a template |
| `agentName` | string | Required. Display name |
| `asrModelId` | string | ASR model identifier |
| `vadModelId` | string | VAD model identifier |
| `llmModelId` | string | LLM model identifier |
| `ttsModelId` | string | TTS model identifier |
| `ttsVoiceId` | string | Voice ID within TTS provider |
| `memModelId` | string | Memory model identifier |
| `chatHistoryConf` | integer | Context window message count |
| `systemPrompt` | string | LLM system prompt |
| `summaryMemory` | string | Persistent memory summary |
| `langCode` | string | Language code (`en`, `hi`, etc.) |
| `language` | string | Language display name |
| `sort` | integer | Sort order in character list |

### GET `/toy/agent/list`

Returns agents owned by the authenticated user. Super admins see all agents with `ownerUsername` included.

#### Query Parameters

| Param | Default | Description |
|---|---|---|
| `page` | `1` | Page number |
| `limit` | `20` | Items per page |

#### Response

```json
{
  "code": 0,
  "msg": "success",
  "data": {
    "list": [
      {
        "id": "uuid",
        "agentName": "Cheeko",
        "memModelId": "mem0",
        "systemPrompt": "...",
        "summaryMemory": "",
        "lastConnectedAt": "2024-03-01T10:00:00.000Z",
        "deviceCount": 2,
        "deviceMacAddresses": "AA:BB:CC:DD:EE:FF,11:22:33:44:55:66",
        "ownerUsername": "admin@example.com",
        "createDate": "2024-01-01T00:00:00.000Z"
      }
    ],
    "total": 5
  }
}
```

### DELETE `/toy/agent/:id`

Deletes the agent and performs cascading cleanup:
1. Sets `agent_id` and `kid_id` to `null` on all linked devices (devices are not deleted)
2. Deletes all `ai_agent_chat_history` records for the agent
3. Deletes plugin mappings from `ai_agent_plugin_mapping`
4. Deletes the agent record

---

## Agent Template Endpoints

Templates are reusable agent configurations. When a template is updated and applied, all agents with a matching `agent_code` are updated.

### POST `/toy/agent/template` — Create template

Same fields as agent creation, plus:

| Field | Type | Description |
|---|---|---|
| `isVisible` | integer | `1` = visible to users, `0` = hidden |
| `sort` | integer | Display order |

### POST `/toy/agent/template/:id/apply-to-agents`

Finds all agents where `agent_code` matches the template's `agentCode` and updates them with the template's current settings.

```json
{
  "code": 0,
  "msg": "Template applied to 3 agent(s)",
  "data": {
    "updatedCount": 3,
    "agentCode": "CHEEKO"
  }
}
```

---

## Chat History Endpoints

### POST `/toy/agent/chat-message`

Used by the LiveKit agent to persist individual messages during a conversation.

### Request

```json
{
  "macAddress": "AA:BB:CC:DD:EE:FF",
  "agentId": "agent-uuid",
  "sessionId": "session-uuid",
  "chatType": 1,
  "content": "Can you tell me a story?",
  "audioId": "audio-file-id"
}
```

| Field | Type | Description |
|---|---|---|
| `macAddress` | string | Required. Device MAC |
| `agentId` | string | Required. Agent UUID |
| `sessionId` | string | Required. Session UUID |
| `chatType` | integer | Required. `1` = user message, `2` = agent message |
| `content` | string | Required. Message text |
| `audioId` | string | Optional. Audio file reference |

### POST `/toy/agent/chat-history/session`

Batch upload all messages for a session at once (used by LiveKit workers at session end).

### Request

```json
{
  "macAddress": "AA:BB:CC:DD:EE:FF",
  "agentId": "agent-uuid",
  "sessionId": "session-uuid",
  "messages": [
    {
      "chatType": 1,
      "content": "Hello!",
      "audioId": null,
      "timestamp": "2024-03-01T10:00:00.000Z"
    },
    {
      "chatType": 2,
      "content": "Hi there! How can I help?",
      "audioId": "audio-123",
      "timestamp": "2024-03-01T10:00:01.000Z"
    }
  ]
}
```

### GET `/toy/agent/:id/sessions`

Returns paginated list of unique session IDs for an agent.

#### Response

```json
{
  "code": 0,
  "msg": "success",
  "data": {
    "list": [
      {
        "sessionId": "session-uuid",
        "createdAt": "2024-03-01T10:00:00.000Z",
        "chatCount": 24
      }
    ],
    "total": 10
  }
}
```

### GET `/toy/agent/:id/history/:sessionId`

Returns all messages in a session, ordered by `created_at` ascending.

#### Response

```json
{
  "code": 0,
  "msg": "success",
  "data": [
    {
      "createdAt": "2024-03-01T10:00:00.000Z",
      "chatType": 1,
      "content": "Hello!",
      "audioId": null,
      "macAddress": "AA:BB:CC:DD:EE:FF"
    }
  ]
}
```
