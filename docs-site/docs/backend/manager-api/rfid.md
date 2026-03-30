---
id: rfid
sidebar_position: 6
---

# RFID Endpoints

RFID card-to-content mapping management. Base path: `/toy/admin/rfid`.

When an ESP32 device scans an RFID card, it calls the public lookup endpoint to find what content to play. Admin endpoints manage the mappings between RFID UIDs and content packs/questions. A RAG (Retrieval-Augmented Generation) search layer powered by Qdrant enables semantic content matching.

## Endpoint Summary

### Card Mappings

| Method | Path | Auth | Description |
|---|---|---|---|
| `GET` | `/toy/admin/rfid/card/page` | Admin | Paginated card mapping list |
| `GET` | `/toy/admin/rfid/card/list` | Admin | All card mappings (no pagination) |
| `GET` | `/toy/admin/rfid/card/lookup/:rfidUid` | None | **Device lookup** — find content for scanned UID |
| `POST` | `/toy/admin/rfid/card/rag-lookup/:rfidUid` | None | RAG-enhanced card lookup |
| `GET` | `/toy/admin/rfid/card/uid/:rfidUid` | Admin | Get mapping by RFID UID (admin) |
| `GET` | `/toy/admin/rfid/card/pack/:packCode` | Admin | All cards in a pack |
| `GET` | `/toy/admin/rfid/card/question/:questionId` | Admin | All cards for a question |
| `GET` | `/toy/admin/rfid/card/:id` | Admin | Get mapping by numeric ID |
| `POST` | `/toy/admin/rfid/card` | Admin | Create card mapping |
| `PUT` | `/toy/admin/rfid/card` | Admin | Update card mapping |
| `DELETE` | `/toy/admin/rfid/card` | Admin | Delete card mappings (array in body) |
| `POST` | `/toy/admin/rfid/card/delete` | Admin | Delete card mappings (POST alternative) |
| `GET` | `/toy/admin/rfid/mapping/options` | Admin | Get all questions/packs for mapping UI |

### Series Lookup

| Method | Path | Auth | Description |
|---|---|---|---|
| `GET` | `/toy/admin/rfid/series/lookup/:uid` | None | Check if UID falls in a series range |

### Packs

| Method | Path | Auth | Description |
|---|---|---|---|
| `GET` | `/toy/admin/rfid/pack/page` | Admin | Paginated pack list |
| `GET` | `/toy/admin/rfid/pack/list` | Admin | All packs |
| `GET` | `/toy/admin/rfid/pack/active` | None | All active packs (public) |
| `GET` | `/toy/admin/rfid/pack/code/:packCode` | None | Get pack by code |
| `POST` | `/toy/admin/rfid/pack` | Admin | Create pack |
| `PUT` | `/toy/admin/rfid/pack` | Admin | Update pack |
| `DELETE` | `/toy/admin/rfid/pack` | Admin | Delete pack |

### RAG / Semantic Search

| Method | Path | Auth | Description |
|---|---|---|---|
| `POST` | `/toy/admin/rfid/rag/search` | User | Semantic search in RFID content vector DB |

---

## GET `/toy/admin/rfid/card/lookup/:rfidUid`

Primary device-facing endpoint. Called by the ESP32 (via the MQTT gateway or LiveKit agent) after scanning an RFID card to determine what content to play.

If the `sequence` query parameter is provided, uses the content pack / RAG system to return a sequentially-indexed item. Otherwise performs a direct UID lookup.

### Path Parameters

| Param | Example | Description |
|---|---|---|
| `rfidUid` | `04:A3:B2:C1:D0:00:00` | RFID UID (colons/dashes optional) |

### Query Parameters

| Param | Type | Description |
|---|---|---|
| `sequence` | integer | Optional. If provided, returns the Nth item from the card's content pack. |

### Response

```json
{
  "code": 0,
  "msg": "success",
  "data": {
    "rfidUid": "04A3B2C1D00000",
    "contentType": "music",
    "title": "Twinkle Twinkle",
    "packName": "Nursery Rhymes Pack",
    "items": [
      {
        "id": "uuid",
        "title": "Twinkle Twinkle",
        "awsS3Url": "https://cdn.example.com/music/twinkle.mp3",
        "durationSeconds": 120
      }
    ]
  }
}
```

Returns `404` if no mapping is found for the UID.

---

## POST `/toy/admin/rfid/card/rag-lookup/:rfidUid`

Enhanced lookup that performs semantic search via Qdrant when the card has a `content_pack_id` and a pre-computed embedding vector is provided. Also returns emotion tags extracted from the content pack.

### Request

```json
{
  "embedding": [0.123, -0.456, ...],
  "queryText": "nursery rhyme about stars",
  "includeRag": true
}
```

| Field | Type | Description |
|---|---|---|
| `embedding` | number[] | Pre-computed query embedding vector (1536 dimensions for `text-embedding-ada-002`) |
| `queryText` | string | Original query text (for logging) |
| `includeRag` | boolean | Whether to include RAG results (default `true`) |

### Response

```json
{
  "code": 0,
  "msg": "success",
  "data": {
    "rfidUid": "04A3B2C1D00000",
    "contentType": "music",
    "title": "Twinkle Twinkle",
    "rag_results": [
      {
        "id": "qdrant-point-id",
        "score": 0.92,
        "content": "Twinkle twinkle little star...",
        "title": "Twinkle Twinkle",
        "category": "English",
        "emotion": "happy",
        "language": "en"
      }
    ],
    "emotions": ["happy", "curious"],
    "emotion": "happy"
  }
}
```

---

## Card Mapping CRUD

### GET `/toy/admin/rfid/card/page`

#### Query Parameters

| Param | Type | Description |
|---|---|---|
| `page` | integer | Default `1` |
| `limit` | integer | Default `10` |
| `rfidUid` | string | Filter by UID |
| `packCode` | string | Filter by pack code |
| `questionId` | integer | Filter by question ID |
| `questionPackId` | integer | Filter by question pack ID |
| `contentPackId` | integer | Filter by content pack ID |
| `cardType` | string | Filter by card type |
| `active` | boolean | Filter by active status |

#### Response

```json
{
  "code": 0,
  "msg": "success",
  "data": {
    "list": [ ... ],
    "total": 150,
    "page": 1,
    "limit": 10,
    "pages": 15
  }
}
```

### POST `/toy/admin/rfid/card` — Create card mapping

#### Request

```json
{
  "rfidUid": "04A3B2C1D00000",
  "questionId": 42,
  "questionIds": [42, 43, 44],
  "packCode": "NURSERY_01",
  "packId": 5,
  "contentPackId": 12,
  "notes": "Twinkle Twinkle card",
  "active": true
}
```

| Field | Required | Description |
|---|---|---|
| `rfidUid` | Yes | RFID UID hex string |
| `questionId` | No | Primary question ID |
| `questionIds` | No | Multiple question IDs |
| `packCode` | No | Pack code identifier |
| `packId` | No | Pack ID |
| `contentPackId` | No | Content pack ID for RAG lookup |
| `notes` | No | Admin notes |
| `active` | No | Default `true` |

Returns `{ "code": 0, "data": null }` on success.

### PUT `/toy/admin/rfid/card` — Update card mapping

Same fields as create, but `id` (integer) is required.

```json
{
  "id": 99,
  "rfidUid": "04A3B2C1D00000",
  "packCode": "NURSERY_02",
  "active": false
}
```

Returns `{ "code": 0, "data": null }` on success.

### DELETE `/toy/admin/rfid/card` — Delete card mappings

Body is a raw JSON array of integer IDs:

```json
[1, 2, 3]
```

Returns `{ "code": 0, "data": null }` on success.

### POST `/toy/admin/rfid/card/delete`

POST alternative for the delete operation (same body format: array of integer IDs). Useful for clients that cannot send a body with `DELETE`.

---

## GET `/toy/admin/rfid/mapping/options`

Returns consolidated data for the mapping UI: all available questions, packs, question packs, and content packs.

```json
{
  "code": 0,
  "msg": "success",
  "data": {
    "questions": [ ... ],
    "packs": [ ... ],
    "questionPacks": [ ... ],
    "contentPacks": [ ... ]
  }
}
```

---

## Series Lookup

### GET `/toy/admin/rfid/series/lookup/:uid`

Checks whether the given UID falls within any configured series range mapping. Series ranges allow a single mapping to cover a contiguous block of card UIDs (e.g. a full deck of playing cards).

Returns the series mapping object if found, `404` otherwise.

---

## Pack Management

Packs group related RFID cards. A pack has a code, a name, and an active flag.

### GET `/toy/admin/rfid/pack/page`

#### Query Parameters

| Param | Description |
|---|---|
| `page` | Default `1` |
| `limit` | Default `10` |
| `packCode` | LIKE filter on pack code |
| `name` | LIKE filter on pack name |
| `active` | Boolean filter |

### GET `/toy/admin/rfid/pack/active`

Public endpoint. Returns all active packs. No authentication required.

### GET `/toy/admin/rfid/pack/code/:packCode`

Returns a single pack by its code. No authentication required.

### POST `/toy/admin/rfid/pack` — Create pack

```json
{
  "packCode": "NURSERY_01",
  "name": "Nursery Rhymes",
  "description": "Classic nursery rhymes for young children",
  "active": true
}
```

---

## POST `/toy/admin/rfid/rag/search`

Direct semantic search in the RFID content Qdrant vector database. Requires a pre-computed embedding vector.

### Request

```json
{
  "embedding": [0.123, -0.456, ...],
  "contentPackId": 12,
  "language": "en",
  "limit": 5,
  "scoreThreshold": 0.7
}
```

| Field | Type | Required | Description |
|---|---|---|---|
| `embedding` | number[] | Yes | Query embedding vector (1536 dimensions for ada-002) |
| `contentPackId` | integer | No | Filter results to a specific content pack |
| `language` | string | No | Filter by language code |
| `limit` | integer | No | Max results (default `5`) |
| `scoreThreshold` | number | No | Minimum similarity score 0–1 (default `0.7`) |

### Response

```json
{
  "code": 0,
  "msg": "success",
  "data": [
    {
      "id": "qdrant-point-id",
      "score": 0.94,
      "payload": {
        "title": "Twinkle Twinkle",
        "content": "Twinkle twinkle little star...",
        "language": "en",
        "emotion": "happy",
        "contentPackId": 12
      }
    }
  ]
}
```
