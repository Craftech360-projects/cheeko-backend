# Sound-quiz game card — backend contract for firmware

Backend side of `sound-pack-game-plan.md` §10, shipped on branch `feat/sound-pack-game`.
Design: `docs/superpowers/specs/2026-09-11-sound-pack-game-card-design.md`.

## What the toy receives on a tap

Both gateway senders publish this to `devices/p2p/<clientId>`; the in-session
one adds `session_id`:

```json
{ "type": "card_game", "rfid_uid": "04A1B2C3",
  "app_id": "hometown", "name": "Around the House", "version": 3, "content_hash": "sha256...",
  "prompts": [ { "sound": "Doorbell", "prompt": "DING-DONG?", "file": "doorbell.mp3" } ],
  "assets": [ { "name": "manifest.jsn", "url": "https://.../rfidcontent/apps/hometown/manifest.jsn" },
              { "name": "doorbell.mp3", "url": "https://..." },
              { "name": "doorbell.png", "url": "https://..." } ] }
```

- `app_id` is 1–8 chars of `[a-z0-9_-]`: use it as the folder under `apps/`.
- Every `assets[].name` is 8.3. Write each URL to `apps/<app_id>/<name>`.
- `manifest.jsn` is already in the `sound_quiz` shape the integration-branch
  parser accepts (`rounds[].sound`, `options[].{label,icon}`, `correct`). Its
  `version` equals the message `version`. Download it last as the completion marker.
  `assets[]` order is not a download order: `manifest.jsn` is listed first but must be written last.
- `prompts` is informational (Sound | Prompt | File); the manifest is authoritative.
- The message is sent on **every** tap. The toy sends no local version for app
  cards, so gate re-downloads locally: skip when `apps/<app_id>/manifest.jsn`
  exists and its `version >= message.version`.
- Nothing under `apps/` is encrypted.

## Firmware work this enables (plan §10.2)

F1 route `card_game` through the `application.cc` whitelist and handle it in
`ContentManager::HandleServerResponse`; F2 `EnsureGamePack(app_id, version, assets)`
modelled on `EnsureCharacterArt`; F3 download before launch with the progress
UI; F4 refresh the app catalogue before `LaunchInstalledAppById`; F5 report a
half-downloaded pack.

## Authoring

Dashboard: Content Packs → type "Sound Quiz (Game)" → one row per round
(Sound, Prompt, sound file, icon, two wrong answers) → Cards → "Game Card".
Or `node scripts/install-sound-pack.js <folder> --uid <UID> --apply`.
