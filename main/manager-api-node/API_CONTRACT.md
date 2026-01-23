# API Contract Documentation

This document describes the API contract for the Cheeko Manager API (Node.js) and its compatibility with the original Java Spring Boot API.

## Response Format

### Success Response

Both APIs return responses in the following format:

```json
{
  "code": 0,
  "msg": "success",
  "data": { ... }
}
```

| Field | Type | Description |
|-------|------|-------------|
| code | number | 0 for success, non-zero for errors |
| msg | string | Status message or error description |
| data | any | Response payload (can be null) |

### Error Response

```json
{
  "code": 401,
  "msg": "Unauthorized",
  "data": null
}
```

## Pagination Format

### Java Spring Boot API (PageData)

```json
{
  "code": 0,
  "msg": "success",
  "data": {
    "total": 150,
    "list": [...]
  }
}
```

### Node.js Express API

```json
{
  "code": 0,
  "msg": "success",
  "data": {
    "list": [...],
    "total": 150,
    "page": 1,
    "limit": 10
  }
}
```

**Compatibility Note:** The Node.js API includes additional fields (`page`, `limit`) in paginated responses. These are additive and do not break existing clients expecting the Java format. The `total` and `list` fields are present in both.

### Pagination Request Parameters

Both APIs accept the same query parameters:

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| page | number | 1 | Current page (1-indexed) |
| limit | number | 10 | Records per page |
| orderField | string | - | Field to sort by |
| order | string | - | Sort direction (asc/desc) |

## Error Codes

### HTTP Status Codes

Both APIs use standard HTTP status codes:

| Code | Description |
|------|-------------|
| 200 | Success |
| 201 | Created |
| 400 | Bad Request |
| 401 | Unauthorized |
| 403 | Forbidden |
| 404 | Not Found |
| 409 | Conflict |
| 500 | Internal Server Error |

### Application Error Codes (5-digit)

The Java API defines specific error codes in `ErrorCode.java`. These are documented in the Node.js API in `src/config/constants.js`:

| Code | Name | Description |
|------|------|-------------|
| 10001 | NOT_NULL | Required field is null |
| 10002 | DB_RECORD_EXISTS | Database record already exists |
| 10003 | PARAMS_GET_ERROR | Parameter retrieval error |
| 10004 | ACCOUNT_PASSWORD_ERROR | Invalid username or password |
| 10005 | ACCOUNT_DISABLE | Account is disabled |
| 10006 | IDENTIFIER_NOT_NULL | Identifier cannot be null |
| 10007 | CAPTCHA_ERROR | CAPTCHA validation failed |
| 10020 | TOKEN_NOT_EMPTY | Token is required |
| 10021 | TOKEN_INVALID | Token is invalid or expired |
| 10022 | ACCOUNT_LOCK | Account is locked |
| 10034 | PARAM_VALUE_NULL | Required parameter is null |
| 10041 | OTA_DEVICE_NOT_FOUND | OTA device not found |
| 10042 | OTA_DEVICE_NEED_BIND | Device needs to be bound |
| 10043 | ACCOUNT_NOT_EXIST | Account does not exist |

**Note:** The Node.js API primarily uses HTTP status codes (400, 401, etc.) as the `code` field. The 5-digit codes are available for use in specific error scenarios.

## Field Naming Conventions

### Documented Difference

| Aspect | Java Spring Boot | Node.js Express |
|--------|------------------|-----------------|
| JSON Fields | camelCase | snake_case |
| Database | snake_case | snake_case |
| Example | `agentName` | `agent_name` |
| Example | `macAddress` | `mac_address` |
| Example | `createDate` | `created_at` |

**Reason:** The Java API transforms snake_case database columns to camelCase via DTOs. The Node.js API returns data directly from Supabase without transformation.

**Client Recommendation:** Handle both naming conventions in client code, or implement a transformation layer.

## Date/Time Format

| API | Format | Example |
|-----|--------|---------|
| Java | `yyyy-MM-dd HH:mm:ss` | `2024-01-15 14:30:00` |
| Node.js | ISO 8601 | `2024-01-15T14:30:00.000Z` |

Both formats are widely supported by date parsing libraries.

## Authentication

### Token Authentication

Both APIs use JWT Bearer tokens:

```
Authorization: Bearer <jwt-token>
```

### Service Key Authentication

For backend-to-backend communication:

```
X-Service-Key: <service-secret-key>
```

## Public Endpoints (No Auth Required)

These endpoints are accessible without authentication:

### Device Endpoints
- `POST /device/register` - Register a new device
- `GET /device/:mac/mode` - Get device mode
- `GET /device/:mac/device-mode` - Get PTT mode
- `POST /device/:mac/cycle-mode` - Cycle device mode

### Agent Endpoints
- `GET /agent/prompt/:mac` - Get agent prompt for device
- `GET /agent/agent-id/:mac` - Get agent ID for device
- `POST /agent/cycle-character/:mac` - Cycle character
- `POST /agent/set-character/:mac/:agentId` - Set character
- `GET /agent/current-character/:mac` - Get current character
- `POST /agent/chat-message` - Log chat message (for LiveKit)

### RFID Endpoints
- `GET /admin/rfid/card/lookup/:rfidUid` - Lookup RFID card
- `GET /admin/rfid/series/lookup/:uid` - Lookup RFID series

### System Endpoints
- `GET /user/pub-config` - Get public configuration
- `GET /user/captcha` - Get CAPTCHA
- `GET /system/dict/data/type/:dictType` - Get dictionary data by type

## Protected Endpoints

### OAuth Required (User Token)
- `GET /agent/list` - List user's agents
- `GET /device/list` - List user's devices
- `GET /content/library` - List content
- `GET /api/mobile/kids/list` - List kid profiles

### Admin Required (Super Admin Token)
- `POST /content/library` - Create content
- `PUT /content/library/:id` - Update content
- `DELETE /content/library/:id` - Delete content
- `POST /admin/rfid/card` - Create RFID card mapping
- `GET /admin/users/page` - List users
- `GET /admin/stats/overview` - System statistics

### Service Key Required
- `POST /analytics/session/start` - Start game session
- `POST /analytics/session/end` - End game session
- `POST /analytics/game-attempt` - Log game attempt
- `POST /analytics/media-event` - Log media event

## API Versioning

Both APIs serve endpoints under the `/toy` context path:

- Base URL: `http://localhost:8002/toy`
- Health Check: `GET /toy/health`
- API Docs: `GET /toy/doc.html`
- OpenAPI JSON: `GET /toy/swagger.json`

## Breaking Changes

There are no breaking changes. The Node.js API is designed as a drop-in replacement for the Java API with the following compatibility notes:

1. **Pagination:** Extra fields added but core fields (`total`, `list`) preserved
2. **Field Names:** snake_case vs camelCase - document for client teams
3. **Date Format:** Different string format but both are ISO parseable
4. **Error Codes:** HTTP codes used consistently, 5-digit codes available

## Verification

Run the contract validation tests:

```bash
cd main/manager-api-node
npm test -- --grep "API Contract"
```
