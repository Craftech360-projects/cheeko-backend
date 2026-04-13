# Image Description Pipeline (Device → Manager API → MQTT Gateway → Agent → TTS)

## Summary
Add a scalable image-description path that mirrors the existing voice flow. The device uploads a JPEG via HTTP to `manager-api`, which forwards the image to `mqtt-gateway`. The gateway calls the agent (VLLM) to describe the image, then hands the text to the existing TTS pipeline and delivers audio back to the device over the current MQTT/audio response flow.

This design prioritizes robustness and scalability while avoiding S3 storage to keep latency low.

## Goals
- Accept a JPEG image from device after OTA.
- Route the image to an agent for description.
- Return audio to the device through the existing TTS + MQTT flow.
- Keep the flow scalable and resilient under load.
- Minimize latency while keeping services decoupled.

## Non-Goals
- Long-term image storage or gallery features.
- Streaming video or multi-frame analysis.
- Client-side image preprocessing beyond basic resizing/compression.

## High-Level Architecture
1. **Device → Manager API (HTTP upload)**  
   Device sends JPEG using `multipart/form-data`.
2. **Manager API → MQTT Gateway (publish request)**  
   API publishes a `vision.describe.request` MQTT message containing base64 image + metadata.
3. **MQTT Gateway → Agent (HTTP call)**  
   Gateway calls the agent/VLLM image-to-text endpoint.
4. **Gateway → TTS → Device**  
   The returned description is sent through the existing TTS pipeline and delivered to device via the current audio flow.

## Data Flow (Detailed)
1. Device sends HTTP POST to `manager-api`:
   - `image` (jpeg), `deviceId` or `mac`, optional `sessionId`, optional `rfidUid`.
2. Manager API:
   - Validates mime (`image/jpeg`), size limit, auth.
   - Generates `requestId`.
   - Publishes MQTT message `vision.describe.request`.
3. MQTT Gateway:
   - Subscribes to `vision.describe.request`.
   - Calls agent endpoint with the image bytes (base64 → binary).
   - Receives `descriptionText`.
4. Gateway:
   - Sends `descriptionText` into existing TTS pipeline.
   - Publishes audio response to device with current `audio_response` flow.

## Interfaces

### Manager API: HTTP Upload
**Endpoint**: `POST /toy/vision/describe`  
**Content-Type**: `multipart/form-data`  
**Fields**:
- `image` (required): JPEG file
- `deviceId` (optional, preferred) or `mac` (required if no deviceId)
- `sessionId` (optional)
- `rfidUid` (optional)

**Response** (sync ack):
```json
{
  "code": 0,
  "data": { "requestId": "img_..." },
  "msg": "Image received"
}
```

### MQTT: Vision Request
**Topic**: `vision.describe.request`  
**Payload**:
```json
{
  "requestId": "img_...",
  "deviceId": "dev_...",
  "mac": "DC:B4:D9:29:9D:60",
  "sessionId": "sess_...",
  "rfidUid": "26281026",
  "mimeType": "image/jpeg",
  "imageBase64": "<base64>"
}
```

### Agent Call (Gateway → VLLM)
**Endpoint**: `POST /agent/vision/describe` (example)  
**Payload**:
```json
{
  "requestId": "img_...",
  "imageBase64": "<base64>",
  "prompt": "Describe this image for a child in simple language."
}
```

**Response**:
```json
{
  "requestId": "img_...",
  "descriptionText": "A small brown dog sitting on a red couch."
}
```

### MQTT: Vision Result (Optional)
If we want device-side text before TTS:
**Topic**: `vision.describe.result`  
**Payload**:
```json
{
  "requestId": "img_...",
  "descriptionText": "..."
}
```

## TTS Integration
No new TTS logic is required. The gateway passes `descriptionText` into the existing TTS flow and sends the resulting audio using the current MQTT/audio delivery format.

## Scaling Strategy
- **Manager API** only handles uploads and MQTT publish (stateless, easy to scale).
- **MQTT Gateway** can be scaled horizontally with shared MQTT subscriptions.
- **Agent/VLLM** can scale independently; gateway retries or falls back if needed.
- **Backpressure**: reject large images, apply per-device rate limits.

## Error Handling
- Upload validation:
  - Reject non-JPEG or oversized files with clear error.
  - Return `400` for validation errors, `401/403` for auth.
- Agent failures:
  - Gateway retries with exponential backoff (configurable).
  - If agent fails, gateway sends a fallback TTS message: "I could not see the picture clearly."

## Security
- Require a device token or service key in upload headers.
- Validate deviceId/mac mapping.
- Enforce size limits (e.g., 1–2 MB).
- Optional: rate limit per device.

## Observability
- Log `requestId`, `deviceId`, `agentLatency`, `ttsLatency`.
- Track success/failure counts for uploads, agent calls, and TTS.

## Rollout Plan
1. Add Manager API upload endpoint with validation + MQTT publish.
2. Add MQTT gateway handler + agent call.
3. Wire description into existing TTS path.
4. Test with a single device on staging.
5. Gradually enable in production.

## Testing
- Unit tests: validation errors, payload shape, MQTT publish.
- Integration: device upload → agent → TTS → audio response.
- Load test: concurrent image uploads and agent throughput.

## Open Questions
- Max acceptable image size and device-side compression?
- Agent prompt language and length (child-friendly vs neutral)?
- Should device receive text response in addition to audio?

