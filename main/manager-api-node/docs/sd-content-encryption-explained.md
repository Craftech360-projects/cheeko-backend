# SD content encryption, in simple words

A plain-language walkthrough of how pack content is protected, from admin upload to playback on the toy. For the full design see [sd-content-encryption.md](sd-content-encryption.md), for the firmware tasks see [sd-content-encryption-firmware.md](sd-content-encryption-firmware.md), and for a picture see [sd-content-encryption.svg](sd-content-encryption.svg).

This describes **version 1**, which is what ships. Version 2 gives every toy its own
secret; it is designed but deferred, and section 6 of the design doc explains why.

## The three keys

The system uses three keys. Each one locks something, and each lives in exactly one place.

| Key | What it is | Where it lives | What it locks |
|---|---|---|---|
| **Master key** | One secret for the whole server | Server `.env` (`CONTENT_MASTER_KEY`) | The pack keys, while they sit in the database |
| **Pack key** | 16 random bytes, one per pack | Database (`rfid_content_pack.content_key`), locked by the master key | The pack's audio and image files |
| **Wrap secret** | 32 random bytes, one for the whole fleet | Server `.env` (`CONTENT_WRAP_SECRET`) and, as the same 32 bytes, built into the firmware | The pack key, on its way to any toy |

The master key never leaves the server. The wrap secret is the only one that exists in
two places, and the two copies must be byte-for-byte identical.

## Step by step

**1. The admin uploads content.**
- The admin uploads MP3s and images for a pack in the dashboard.
- The first time a pack gets a file, the server makes a random **pack key** for it and saves it in the database, locked with the **master key**.
- The server encrypts each file with the pack key (AES-128) *before* uploading it to S3.
- So S3 and the CDN only ever hold scrambled files. Anyone who grabs a CDN link just gets garbage.

**2. The toy starts up.**
- Nothing to do. The toy already has the wrap secret — it was compiled into its firmware — so there is no registration step and no first-contact requirement.

**3. A child taps a card.**
- The toy sends the card's UID to the gateway over MQTT, and the gateway asks the API.
- The API finds the pack and unlocks its pack key with the master key.
- It **wraps** (encrypts) that pack key using the fleet wrap secret, with a fresh random nonce each time.
- It replies with the file links and the wrapped key: `encryption: { v: 1, key, nonce }`.
- The gateway passes this straight on to the toy. The gateway never sees an unwrapped key.
- The server does not look at the toy's MAC address for any of this. A brand-new toy, one that has never talked to the server, and one with a replacement mainboard all get a working key.

**4. The toy downloads the pack.**
- It downloads the files exactly as they are, still scrambled, onto the SD card.
- It writes the wrapped key into `manifest.jsn` next to them.
- The plain pack key is **never** written to the SD card.

**5. The toy plays the pack.**
- It uses the wrap secret from its firmware to unwrap the pack key, in RAM only.
- It decrypts each file in small pieces as it plays.
- When playback ends, it throws the key away.
- If a file decrypts to garbage, the wrap secret on the toy and the one on the server do not match. That is a build or deployment mistake, not something the toy can recover from on its own.

## Why this is safe

- **Someone copies the SD card:** they get scrambled files and a wrapped key. Useless on a laptop. It *will* play in another Cheeko — that is the known, accepted limit of version 1, and it is what version 2 would close.
- **Someone leaks a CDN link:** they get a scrambled file.
- **Someone steals a database dump:** every pack key in it is locked with the master key, which isn't in the database.
- **Someone dumps a toy's firmware:** they get the wrap secret, and with it every pack. This is the trade version 1 makes, and it is why the trigger to move to version 2 is "the secret leaks, or content turns up posted publicly".

## Things to know

- **The wrap secret must match the firmware exactly.** If the server's `CONTENT_WRAP_SECRET` and the firmware's build constant differ by one byte, every file plays as noise and *nothing reports an error* — this style of encryption has no built-in way to notice. Both sides check the same known test vectors in their test suites to catch it before hardware does.
- **Changing the wrap secret is a breaking change.** It means re-encrypting all content *and* an OTA to every toy. Generate it once and keep it wherever the master key lives.
- **Toys on old firmware can't play encrypted packs.** They don't know how to decrypt. That's why the firmware has to ship before encryption is switched on for real devices.
- **The master key is the one thing you must never lose.** Without it, every encrypted pack is unreadable for good. Removing it from `.env` also doesn't un-encrypt anything already encrypted.
- **Character art is never encrypted.** That was a decision (2026-09-10): character pictures go to S3 as-is, and the dashboard shows them without any key.
- **Not encrypted yet:** recordings parents make in the app (custom cards), because the parent app can't decrypt them and the toy has no firmware for that path yet.
- **`ai_device.content_secret` is a leftover column** from the version 2 design. Nothing writes it any more. It stays because dropping it buys nothing.
