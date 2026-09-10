# SD content encryption, in simple words

A plain-language walkthrough of how pack content is protected, from admin upload to playback on the toy. For the full design see [sd-content-encryption.md](sd-content-encryption.md), for the firmware tasks see [sd-content-encryption-firmware.md](sd-content-encryption-firmware.md), and for a picture see [sd-content-encryption.svg](sd-content-encryption.svg).

## The three keys

The system uses three keys. Each one locks something, and each lives in exactly one place.

| Key | What it is | Where it lives | What it locks |
|---|---|---|---|
| **Master key** | One secret for the whole server | Server `.env` (`CONTENT_MASTER_KEY`) | The other keys, when they're stored in the database |
| **Pack key** | 16 random bytes, one per pack | Database (`rfid_content_pack.content_key`), locked by the master key | The pack's audio and image files |
| **Device secret** | 32 random bytes, one per toy | The toy's NVS memory, plus a locked copy in the database (`ai_device.content_secret`) | The pack key, on its way to that one toy |

## Step by step

**1. The admin uploads content.**
- The admin uploads MP3s and images for a pack in the dashboard.
- The first time a pack gets a file, the server makes a random **pack key** for it and saves it in the database, locked with the **master key**.
- The server encrypts each file with the pack key (AES-128) *before* uploading it to S3.
- So S3 and the CDN only ever hold scrambled files. Anyone who grabs a CDN link just gets garbage.

**2. The toy starts up.**
- The toy connects to Wi-Fi and makes its usual OTA check.
- On its very first check it generates its own random **device secret** and saves it in NVS memory.
- It sends that secret in the OTA request, and it does so on every boot.
- The server saves it against the toy's MAC address, locked with the master key.
- The server never sends the secret back.

**3. A child taps a card.**
- The toy sends the card's UID to the gateway over MQTT, and the gateway asks the API.
- The API finds the pack and unlocks two things with the master key: the pack key and this toy's device secret.
- It **wraps** (encrypts) the pack key using that toy's device secret.
- It replies with the file links and the wrapped key: `encryption: { key, nonce }`.
- The gateway passes this straight on to the toy. The gateway never sees an unwrapped key.

**4. The toy downloads the pack.**
- It downloads the files exactly as they are, still scrambled, onto the SD card.
- It writes the wrapped key into `manifest.jsn` next to them.
- The plain pack key is **never** written to the SD card.

**5. The toy plays the pack.**
- It reads its device secret from NVS and uses it to unwrap the pack key, in RAM only.
- It decrypts each file in small pieces as it plays.
- When playback ends, it throws the key away.
- If a file decrypts to garbage, the key was wrong. The toy refuses to play it and re-registers its secret before the next tap.

## Why this is safe

- **Someone copies the SD card:** they get scrambled files and a wrapped key, which is useless without that toy's device secret.
- **Someone leaks a CDN link:** they get a scrambled file.
- **Someone steals a database dump:** every key in it is locked with the master key, which isn't in the database.
- **Two toys tap the same card:** each gets the same pack key, wrapped differently for its own secret.

## Things to know

- **Resetting a toy's memory (NVS erase)** creates a new device secret, so the wrapped keys on its SD card stop working. The toy notices this through a fingerprint file, `secret.fp`, and wipes its downloaded content. It registers the new secret, and the next tap downloads everything again.
- **Toys on old firmware can't play encrypted packs.** They never send a secret and don't know how to decrypt. That's why the firmware has to ship before encryption is switched on for real devices.
- **The master key is the one thing you must never lose.** Without it, every encrypted pack is unreadable for good. Removing it from `.env` also doesn't un-encrypt anything already encrypted.
- **Character art is never encrypted.** That was a decision (2026-09-10): character pictures go to S3 as-is, and the dashboard shows them without any key.
- **Not encrypted yet:** recordings parents make in the app (custom cards), because the app can't decrypt them yet.
