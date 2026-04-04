# MQTT Messages to Device for Card Handling

Topic pattern:

- `devices/p2p/<device_id_or_mac>`

## 1) `card_unknown`

```json
{
  "type": "card_unknown",
  "session_id": "sess_123",
  "rfid_uid": "04A1B2C3D4",
  "message": "Card not recognized"
}
```

## 2) `card_ai`

```json
{
  "type": "card_ai",
  "session_id": "sess_123",
  "rfid_uid": "04A1B2C3D4",
  "card_type": "ai",
  "agent_name": "Cheeko",
  "language_code": "en",
  "language_name": "English",
  "voice_id": "voice_01"
}
```

## 3) `card_content` (new/updated manifest)

```json
{
  "type": "card_content",
  "session_id": "sess_123",
  "rfid_uid": "04A1B2C3D4",
  "card_type": "content",
  "skill_id": "skill_abc123",
  "skill_name": "The Hungry Fox Story",
  "latest_version": "2",
  "latest_content_hash": "hash_v2_abc",
  "update_required": true,
  "download_manifest_path": "/admin/rfid/card/content/download/04A1B2C3D4",
  "manifest": {
    "version": "2",
    "audio": [
      {
        "index": 1,
        "url": "https://cdn.cheeko.ai/skills/abc123/audio/track1.mp3"
      }
    ],
    "images": [
      {
        "index": 1,
        "url": "https://cdn.cheeko.ai/skills/abc123/images/page1.jpg"
      }
    ]
  }
}
```

## 4) `card_up_to_date`

```json
{
  "type": "card_up_to_date",
  "session_id": "sess_123",
  "rfid_uid": "04A1B2C3D4",
  "card_type": "content",
  "skill_id": "skill_abc123",
  "client_version": "2",
  "latest_version": "2",
  "latest_content_hash": "hash_v2_abc",
  "update_required": false
}
```
