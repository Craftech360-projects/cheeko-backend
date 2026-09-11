# Sound-Pack Game Card Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A tapped RFID card mapped to a `sound_quiz` content pack makes the gateway publish a `card_game` message carrying the pack's asset URLs, a generated `manifest.jsn`, and a flat Sound | Prompt | File list; admins author the pack and map the card from the dashboard.

**Architecture:** Rounds are `content_item` rows on a `sound_quiz` pack (no migration). A pure builder derives the device manifest, 8.3 asset names and the prompt list from those rows; the manifest is written to a fixed S3 key on every save. The card lookup returns the pack in a `sound_quiz` shape, and a shared gateway helper turns it into `card_game` in both senders. Card mappings get `card_type = 'game'`.

**Tech Stack:** Node 20, Express, Prisma (PostgreSQL), AWS S3 via `@aws-sdk/client-s3`, jest + supertest (manager-api-node), `node --test` (mqtt-gateway, MCP), Vue 2 + Element UI (manager-web).

**Spec:** `docs/superpowers/specs/2026-09-11-sound-pack-game-card-design.md`

## Global Constraints

- App id (= `pack_code`) must match `/^[a-z0-9_-]{1,8}$/` — it becomes the SD folder and must be 8.3.
- Every asset name in `assets[]` must be an 8.3 short name; the device writes by `name`, never by URL.
- `manifest.jsn` lives at S3 key `rfidcontent/apps/<pack_code>/manifest.jsn` with `Cache-Control: no-cache`.
- Game assets are stored as-is: **no LVGL .bin conversion, no content-encryption seal** (`apps/` stays plaintext, plan §9).
- The `card_game` message shape in spec §3 is the firmware contract. Do not add or rename fields.
- Both gateway senders (`gateway/mqtt-gateway.js` no-session path and `mqtt/virtual-connection.js` in-session path) must emit identical messages via the shared helper.
- Never run `prisma migrate deploy` against the local `.env` database (shared test Supabase). No migration is needed for this feature.
- Use Prisma for all DB access in new code; never the Supabase SDK.
- manager-api-node tests: `cd main/manager-api-node && npx jest tests/unit/<file>`. Gateway tests: `cd main/mqtt-gateway && npm test`. MCP: `cd main/manager-api-node && npm run test:mcp`.
- Branch: `feat/sound-pack-game` off `main`.

---

## File Structure

**manager-api-node**
- Create `src/services/soundQuiz.js` — pure: app-id validation, asset stems, manifest/assets/prompts builder, S3 key/URL for the manifest.
- Modify `src/services/upload.service.js` — `uploadGamePackManifest(packCode, manifest)`.
- Modify `src/services/rfid.service.js` — `sound_quiz` branch in `buildContentPackResponse`; `publishSoundQuizManifest`; `game` in `determineTapCardType` and the extracted `classifyLookupCardType`; `description` in `getContentPackByCode` items; exports.
- Modify `src/routes/rfid.routes.js` — `purpose=game_asset` on the upload route.
- Modify `mcp/cheeko-mcp.mjs` — `purpose` passthrough on `upload_pack_file`.
- Create `scripts/install-sound-pack.js` — folder → API installer.
- Create `tests/unit/soundQuiz.builder.test.js`, `tests/unit/rfid.sound-quiz-lookup.test.js`, `tests/unit/rfid.card-type-game.test.js`, `tests/unit/rfid.upload-game-asset.test.js`, `tests/unit/rfid.publish-manifest.test.js`.

**mqtt-gateway**
- Create `gateway/card-game.js` — `isCardGame`, `buildCardGameMessage`.
- Modify `gateway/mqtt-gateway.js` — whitelist + branch.
- Modify `mqtt/virtual-connection.js` — branch.
- Create `tests/card-game.test.js`.

**manager-web**
- Modify `src/utils/contentTypes.js`, `src/components/RfidContentPackDialog.vue`, `src/components/RfidCardDialog.vue`, `src/views/RfidManagement.vue`.

**docs**
- Create `main/manager-api-node/docs/sound-quiz-game-card.md` — contract handoff for firmware.

---

### Task 0: Branch

**Files:** none

- [ ] **Step 1: Create the branch**

```bash
cd D:/cheeko-backend
git checkout main
git checkout -b feat/sound-pack-game
```

Expected: `Switched to a new branch 'feat/sound-pack-game'`.

---

### Task 1: Manifest builder (pure module)

**Files:**
- Create: `main/manager-api-node/src/services/soundQuiz.js`
- Test: `main/manager-api-node/tests/unit/soundQuiz.builder.test.js`

**Interfaces:**
- Produces:
  - `isValidAppId(code: string): boolean`
  - `assetStem(title: string): string`
  - `manifestKeyFor(packCode: string): string` → `rfidcontent/apps/<code>/manifest.jsn`
  - `manifestUrlFor(packCode: string): string` → `https://<CLOUDFRONT_DOMAIN>/<key>`
  - `buildSoundQuizPack(pack, items, manifestUrl): { manifest, assets, prompts, warnings }`
    - `pack`: `{ pack_code, name, version }` (a `rfid_content_pack` row)
    - `items`: `content_item` rows (`item_number, title, lyrics_text, audio_url, image_url, description`)
    - `manifest`: `{ type:'miniapp', template:'sound_quiz', app_id, name, color:'#4EA8DE', version:number, rounds:[{ prompt, sound, options:[{label,icon}], correct }] }`
    - `assets`: `[{ name, url }]`, manifest first
    - `prompts`: `[{ sound, prompt, file }]`
    - `warnings`: `string[]` of dropped rounds

- [ ] **Step 1: Write the failing test**

```js
// main/manager-api-node/tests/unit/soundQuiz.builder.test.js
'use strict';

/**
 * The manifest the toy parses and the 8.3 names it writes are derived from
 * content_item rows. These pin the derivation: names stay 8.3 and unique,
 * distractors resolve to other rounds' icons, the correct answer moves around,
 * and an incomplete round is dropped rather than shipped half-built.
 */

const {
  isValidAppId, assetStem, manifestKeyFor, manifestUrlFor, buildSoundQuizPack
} = require('../../src/services/soundQuiz');

const row = (n, title, prompt, distractors, extra = {}) => ({
  item_number: n,
  title,
  lyrics_text: prompt,
  audio_url: `https://cdn.test/apps/hometown/${title.toLowerCase()}-aa11.mp3`,
  image_url: `https://cdn.test/apps/hometown/${title.toLowerCase()}-bb22.png`,
  description: distractors,
  ...extra
});

const PACK = { pack_code: 'hometown', name: 'Around the House', version: '3' };
const ITEMS = [
  row(1, 'Doorbell', 'DING-DONG?', 'Phone,Clock'),
  row(2, 'Phone', 'RING?', 'Doorbell,Clock'),
  row(3, 'Clock', 'TICK-TOCK?', 'Phone,Doorbell'),
];
const MANIFEST_URL = 'https://cdn.test/rfidcontent/apps/hometown/manifest.jsn';

describe('isValidAppId', () => {
  it('accepts 1-8 lowercase alphanumerics, dash and underscore', () => {
    expect(isValidAppId('hometown')).toBe(true);
    expect(isValidAppId('a_b-1')).toBe(true);
  });
  it('rejects uppercase, 9+ chars, dots and empty', () => {
    expect(isValidAppId('Hometown')).toBe(false);
    expect(isValidAppId('hometown1')).toBe(false);
    expect(isValidAppId('home.town')).toBe(false);
    expect(isValidAppId('')).toBe(false);
    expect(isValidAppId(null)).toBe(false);
  });
});

describe('assetStem', () => {
  it('lowercases, strips non-alphanumerics, cuts to 8', () => {
    expect(assetStem('Microwave')).toBe('microwav');
    expect(assetStem('Pressure cooker')).toBe('pressure');
    expect(assetStem('Door-bell!')).toBe('doorbell');
  });
  it('falls back to "snd" for an empty title', () => {
    expect(assetStem('')).toBe('snd');
  });
});

describe('manifest key and url', () => {
  it('uses the fixed apps/<code> key under rfidcontent', () => {
    expect(manifestKeyFor('hometown')).toBe('rfidcontent/apps/hometown/manifest.jsn');
    expect(manifestUrlFor('hometown')).toMatch(/^https:\/\/.+\/rfidcontent\/apps\/hometown\/manifest\.jsn$/);
  });
});

describe('buildSoundQuizPack', () => {
  it('builds the firmware manifest with 8.3 names, uppercased labels and a moving correct index', () => {
    const { manifest, assets, prompts, warnings } = buildSoundQuizPack(PACK, ITEMS, MANIFEST_URL);

    expect(warnings).toEqual([]);
    expect(manifest).toMatchObject({
      type: 'miniapp', template: 'sound_quiz', app_id: 'hometown',
      name: 'Around the House', color: '#4EA8DE', version: 3
    });
    expect(manifest.rounds).toHaveLength(3);

    // Round 1: correct at index 0
    expect(manifest.rounds[0]).toEqual({
      prompt: 'DING-DONG?', sound: 'doorbell.mp3',
      options: [
        { label: 'DOORBELL', icon: 'doorbell.png' },
        { label: 'PHONE', icon: 'phone.png' },
        { label: 'CLOCK', icon: 'clock.png' }
      ],
      correct: 0
    });
    // Round 2: correct at index 1
    expect(manifest.rounds[1].correct).toBe(1);
    expect(manifest.rounds[1].options[1]).toEqual({ label: 'PHONE', icon: 'phone.png' });
    expect(manifest.rounds[1].options[0]).toEqual({ label: 'DOORBELL', icon: 'doorbell.png' });
    // Round 3: correct at index 2
    expect(manifest.rounds[2].correct).toBe(2);
    expect(manifest.rounds[2].options[2]).toEqual({ label: 'CLOCK', icon: 'clock.png' });

    // Assets: manifest first, then sound + icon per round, urls from the rows
    expect(assets[0]).toEqual({ name: 'manifest.jsn', url: MANIFEST_URL });
    expect(assets).toContainEqual({ name: 'doorbell.mp3', url: ITEMS[0].audio_url });
    expect(assets).toContainEqual({ name: 'doorbell.png', url: ITEMS[0].image_url });
    expect(assets).toHaveLength(1 + 3 * 2);
    for (const a of assets) expect(a.name).toMatch(/^[a-z0-9]{1,8}\.[a-z]{3}$/);

    // Prompts: Sound | Prompt | File
    expect(prompts).toEqual([
      { sound: 'Doorbell', prompt: 'DING-DONG?', file: 'doorbell.mp3' },
      { sound: 'Phone', prompt: 'RING?', file: 'phone.mp3' },
      { sound: 'Clock', prompt: 'TICK-TOCK?', file: 'clock.mp3' }
    ]);
  });

  it('orders rounds by item_number regardless of array order', () => {
    const { prompts } = buildSoundQuizPack(PACK, [ITEMS[2], ITEMS[0], ITEMS[1]], MANIFEST_URL);
    expect(prompts.map(p => p.sound)).toEqual(['Doorbell', 'Phone', 'Clock']);
  });

  it('makes colliding stems unique', () => {
    const items = [
      row(1, 'Pressure cooker', 'WHISTLE?', 'Pressure washer,Clock'),
      row(2, 'Pressure washer', 'HISS?', 'Pressure cooker,Clock'),
      row(3, 'Clock', 'TICK-TOCK?', 'Pressure cooker,Pressure washer'),
    ];
    const { assets } = buildSoundQuizPack(PACK, items, MANIFEST_URL);
    const names = assets.map(a => a.name);
    expect(new Set(names).size).toBe(names.length);
    expect(names).toContain('pressure.mp3');
    expect(names).toContain('pressur1.mp3');
  });

  it('drops a round missing prompt, file, icon or a resolvable distractor, with a warning', () => {
    const items = [
      row(1, 'Doorbell', '', 'Phone,Clock'),                       // no prompt
      row(2, 'Phone', 'RING?', 'Doorbell,Clock', { audio_url: null }), // no file
      row(3, 'Clock', 'TICK-TOCK?', 'Phone,Kettle'),                // Kettle is not a round
      row(4, 'Fan', 'WHOOSH?', 'Phone,Clock'),                      // complete
    ];
    const { manifest, prompts, warnings } = buildSoundQuizPack(PACK, items, MANIFEST_URL);
    expect(manifest.rounds).toHaveLength(1);
    expect(prompts).toEqual([{ sound: 'Fan', prompt: 'WHOOSH?', file: 'fan.mp3' }]);
    expect(warnings).toHaveLength(3);
    expect(warnings.join(' ')).toMatch(/Doorbell/);
    expect(warnings.join(' ')).toMatch(/Phone/);
    expect(warnings.join(' ')).toMatch(/Kettle/);
  });

  it('resolves distractors case-insensitively and trims', () => {
    const items = [
      row(1, 'Doorbell', 'DING-DONG?', ' phone , CLOCK '),
      row(2, 'Phone', 'RING?', 'Doorbell,Clock'),
      row(3, 'Clock', 'TICK-TOCK?', 'Phone,Doorbell'),
    ];
    const { warnings, manifest } = buildSoundQuizPack(PACK, items, MANIFEST_URL);
    expect(warnings).toEqual([]);
    expect(manifest.rounds[0].options.map(o => o.label)).toEqual(['DOORBELL', 'PHONE', 'CLOCK']);
  });

  it('defaults version to 1 when the pack has none', () => {
    const { manifest } = buildSoundQuizPack({ ...PACK, version: null }, ITEMS, MANIFEST_URL);
    expect(manifest.version).toBe(1);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd main/manager-api-node && npx jest tests/unit/soundQuiz.builder.test.js`
Expected: FAIL with `Cannot find module '../../src/services/soundQuiz'`.

- [ ] **Step 3: Write the module**

```js
// main/manager-api-node/src/services/soundQuiz.js
'use strict';

/**
 * Sound-quiz game packs: the device manifest, 8.3 asset names and the flat
 * prompt list, all derived from content_item rows. Pure — no I/O — so the
 * lookup, the save path and the installer script share one derivation.
 *
 * Row → round mapping (spec §4):
 *   title        → Sound (the correct option's label, uppercased in the manifest)
 *   lyrics_text  → Prompt
 *   audio_url    → sound file
 *   image_url    → icon PNG
 *   description  → "A,B": the Sound names of the two wrong answers
 */

const CLOUDFRONT_DOMAIN = process.env.CLOUDFRONT_DOMAIN || 'dsmzc13oafp54.cloudfront.net';
const APP_ID_RE = /^[a-z0-9_-]{1,8}$/;
const MANIFEST_NAME = 'manifest.jsn';
const COLOR = '#4EA8DE';
const OPTION_COUNT = 3;

/** The pack code doubles as the SD folder, which FATFS limits to 8.3. */
const isValidAppId = (code) => APP_ID_RE.test(String(code || ''));

/** 8-char stem for a round's files: "Microwave" -> "microwav". */
const assetStem = (title) => {
  const s = String(title || '').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 8);
  return s || 'snd';
};

const manifestKeyFor = (packCode) => `rfidcontent/apps/${packCode}/${MANIFEST_NAME}`;
const manifestUrlFor = (packCode) => `https://${CLOUDFRONT_DOMAIN}/${manifestKeyFor(packCode)}`;

const norm = (s) => String(s || '').trim().toUpperCase();

/**
 * Stems must be unique per pack: two rounds with the same first eight letters
 * would otherwise overwrite each other's files on the card. A collision keeps
 * seven chars and appends a digit.
 */
const assignStems = (rounds) => {
  const used = new Set();
  for (const r of rounds) {
    const base = assetStem(r.title);
    let stem = base;
    let n = 1;
    while (used.has(stem)) {
      stem = `${base.slice(0, 7)}${n}`;
      n += 1;
    }
    used.add(stem);
    r.stem = stem;
  }
};

/**
 * @param {{pack_code:string,name:string,version?:string|number}} pack
 * @param {Array} items content_item rows
 * @param {string} manifestUrl where manifest.jsn is (or will be) hosted
 * @returns {{manifest:Object, assets:Array, prompts:Array, warnings:string[]}}
 */
const buildSoundQuizPack = (pack, items, manifestUrl) => {
  const warnings = [];
  const rounds = [...(items || [])]
    .sort((a, b) => (a.item_number || 0) - (b.item_number || 0))
    .map((it) => ({
      title: String(it.title || '').trim(),
      prompt: String(it.lyrics_text || '').trim(),
      audioUrl: it.audio_url || null,
      imageUrl: it.image_url || null,
      distractors: String(it.description || '').split(',').map((s) => s.trim()).filter(Boolean),
    }));

  assignStems(rounds);
  // Distractors are resolved against every row that has a label and an icon,
  // not only the rounds that survive: a round dropped for a missing prompt can
  // still lend its icon as a wrong answer.
  const byLabel = new Map();
  for (const r of rounds) {
    if (r.title && r.imageUrl) byLabel.set(norm(r.title), r);
  }

  const kept = [];
  for (const r of rounds) {
    const label = r.title || '(untitled)';
    if (!r.title) { warnings.push(`round dropped: missing Sound name`); continue; }
    if (!r.prompt) { warnings.push(`${label}: missing prompt`); continue; }
    if (!r.audioUrl) { warnings.push(`${label}: missing sound file`); continue; }
    if (!r.imageUrl) { warnings.push(`${label}: missing icon`); continue; }
    if (r.distractors.length !== OPTION_COUNT - 1) {
      warnings.push(`${label}: needs exactly ${OPTION_COUNT - 1} wrong answers, got ${r.distractors.length}`);
      continue;
    }
    const resolved = r.distractors.map((d) => byLabel.get(norm(d)));
    const missing = r.distractors.filter((_, i) => !resolved[i] || resolved[i] === r);
    if (missing.length) { warnings.push(`${label}: unknown wrong answer(s) ${missing.join(', ')}`); continue; }
    kept.push({ ...r, resolved });
  }

  const manifestRounds = kept.map((r, idx) => {
    const correct = idx % OPTION_COUNT;
    const wrong = r.resolved.map((d) => ({ label: norm(d.title), icon: `${d.stem}.png` }));
    const options = [];
    for (let i = 0; i < OPTION_COUNT; i += 1) {
      options.push(i === correct ? { label: norm(r.title), icon: `${r.stem}.png` } : wrong.shift());
    }
    return { prompt: r.prompt, sound: `${r.stem}.mp3`, options, correct };
  });

  const version = parseInt(String(pack.version ?? ''), 10);
  const manifest = {
    type: 'miniapp',
    template: 'sound_quiz',
    app_id: pack.pack_code,
    name: pack.name,
    color: COLOR,
    version: Number.isFinite(version) && version > 0 ? version : 1,
    rounds: manifestRounds,
  };

  const assets = [{ name: MANIFEST_NAME, url: manifestUrl }];
  for (const r of kept) {
    assets.push({ name: `${r.stem}.mp3`, url: r.audioUrl });
    assets.push({ name: `${r.stem}.png`, url: r.imageUrl });
  }

  const prompts = kept.map((r) => ({ sound: r.title, prompt: r.prompt, file: `${r.stem}.mp3` }));

  return { manifest, assets, prompts, warnings };
};

module.exports = {
  isValidAppId,
  assetStem,
  manifestKeyFor,
  manifestUrlFor,
  buildSoundQuizPack,
  MANIFEST_NAME,
};
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd main/manager-api-node && npx jest tests/unit/soundQuiz.builder.test.js`
Expected: PASS, 10 tests.

- [ ] **Step 5: Commit**

```bash
git add main/manager-api-node/src/services/soundQuiz.js main/manager-api-node/tests/unit/soundQuiz.builder.test.js
git commit -m "feat(sound-quiz): pure builder for the device manifest, 8.3 asset names and prompt list

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 2: Lookup returns the `sound_quiz` shape

**Files:**
- Modify: `main/manager-api-node/src/services/rfid.service.js:802-889` (`buildContentPackResponse`), `:4164-4175` (`getContentPackByCode` item mapping), module.exports
- Test: `main/manager-api-node/tests/unit/rfid.sound-quiz-lookup.test.js`

**Interfaces:**
- Consumes: `buildSoundQuizPack`, `isValidAppId`, `manifestUrlFor` from Task 1.
- Produces: `lookupCardByUid(uid, mac)` returns for a `sound_quiz` pack
  `{ rfid_uid, contentType:'sound_quiz', appId, title, version, contentHash, prompts, assets }` and nothing else (no `items`, `stories`, `encryption`). Returns `null` when `pack_code` fails `isValidAppId`. `getContentPackByCode` items now include `description`.

- [ ] **Step 1: Write the failing test**

```js
// main/manager-api-node/tests/unit/rfid.sound-quiz-lookup.test.js
'use strict';

/**
 * A card mapped to a sound_quiz pack must come back in the game shape the
 * gateway turns into card_game — and never in the items/stories shape, which
 * the gateway would route as a content pack and the toy would try to play as
 * audio tracks.
 */

const mockPrisma = {
  $queryRaw: jest.fn(),
  rfid_card_mapping: { findFirst: jest.fn() },
  rfid_series: { findFirst: jest.fn() },
  custom_card: { findFirst: jest.fn() },
  ai_device: { findFirst: jest.fn() },
  rfid_content_pack: { findFirst: jest.fn() }
};

jest.mock('../../src/config/database', () => ({ prisma: mockPrisma }));
jest.mock('../../src/services/integrations/qdrant.service', () => ({}));
jest.mock('../../src/services/upload.service', () => ({}));
const mockContentKeys = { isEnabled: () => false, getPackKey: jest.fn(), getDeviceSecret: jest.fn() };
jest.mock('../../src/services/contentKeys.service', () => mockContentKeys);

const rfidService = require('../../src/services/rfid.service');

const UID = '04A1B2C3';
const MAC = 'AA:BB:CC:DD:EE:FF';
const PACK = {
  id: BigInt(9), pack_code: 'hometown', name: 'Around the House',
  content_type: 'sound_quiz', version: '3', content_hash: 'h3', thumbnail_url: null
};
const item = (n, title, prompt, distractors) => ({
  id: BigInt(n), content_pack_id: BigInt(9), item_number: n, title,
  lyrics_text: prompt, description: distractors,
  audio_url: `https://cdn.test/apps/hometown/${title.toLowerCase()}-a1.mp3`,
  image_url: `https://cdn.test/apps/hometown/${title.toLowerCase()}-b2.png`,
  story_number: null, story_title: null, active: true
});
const ITEMS = [
  item(1, 'Doorbell', 'DING-DONG?', 'Phone,Clock'),
  item(2, 'Phone', 'RING?', 'Doorbell,Clock'),
  item(3, 'Clock', 'TICK-TOCK?', 'Phone,Doorbell'),
];

beforeEach(() => {
  jest.clearAllMocks();
  mockPrisma.$queryRaw.mockImplementation((strings) => {
    const sql = Array.isArray(strings) ? strings.join(' ') : String(strings);
    return Promise.resolve(sql.includes('information_schema') ? [] : ITEMS);
  });
  mockPrisma.rfid_card_mapping.findFirst.mockResolvedValue({
    id: BigInt(1), rfid_uid: UID, content_pack_id: BigInt(9), card_type: 'game', active: true
  });
  mockPrisma.rfid_content_pack.findFirst.mockResolvedValue(PACK);
});

describe('sound_quiz lookup', () => {
  it('returns the game shape: appId, prompts, assets, no items', async () => {
    const result = await rfidService.lookupCardByUid(UID, MAC);

    expect(result).toMatchObject({
      rfid_uid: UID, contentType: 'sound_quiz', appId: 'hometown',
      title: 'Around the House', version: '3', contentHash: 'h3'
    });
    expect(result.items).toBeUndefined();
    expect(result.stories).toBeUndefined();
    expect(result.encryption).toBeUndefined();
    expect(result.prompts).toEqual([
      { sound: 'Doorbell', prompt: 'DING-DONG?', file: 'doorbell.mp3' },
      { sound: 'Phone', prompt: 'RING?', file: 'phone.mp3' },
      { sound: 'Clock', prompt: 'TICK-TOCK?', file: 'clock.mp3' }
    ]);
    expect(result.assets[0]).toEqual({
      name: 'manifest.jsn', url: expect.stringMatching(/\/rfidcontent\/apps\/hometown\/manifest\.jsn$/)
    });
    expect(result.assets).toHaveLength(7);
  });

  it('returns null (card_unknown) when the pack code is not a valid app id', async () => {
    mockPrisma.rfid_content_pack.findFirst.mockResolvedValue({ ...PACK, pack_code: 'AroundTheHouse' });
    const result = await rfidService.lookupCardByUid(UID, MAC);
    expect(result).toBeNull();
  });

  it('leaves ordinary content packs on the items shape', async () => {
    mockPrisma.rfid_content_pack.findFirst.mockResolvedValue({ ...PACK, content_type: 'story_pack' });
    const result = await rfidService.lookupCardByUid(UID, MAC);
    expect(result.items).toHaveLength(3);
    expect(result.assets).toBeUndefined();
  });
});

describe('getContentPackByCode', () => {
  it('returns description on each item so the dashboard can round-trip distractors', async () => {
    const pack = await rfidService.getContentPackByCode('hometown');
    expect(pack.items[0]).toMatchObject({ title: 'Doorbell', description: 'Phone,Clock', text: 'DING-DONG?' });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd main/manager-api-node && npx jest tests/unit/rfid.sound-quiz-lookup.test.js`
Expected: FAIL — first test gets `items` instead of `prompts`; `description` test gets `undefined`.

- [ ] **Step 3: Add the require and the branch**

At the top of `src/services/rfid.service.js`, after `const { wrapKeyForDevice } = require('../utils/contentCrypto');` add:

```js
const { buildSoundQuizPack, isValidAppId, manifestUrlFor } = require('./soundQuiz');
```

In `buildContentPackResponse`, immediately after the `items` load (after the `catch (itemsErr)` block that ends around line 808) and before the `storyNumbers` line, insert:

```js
  // Sound-quiz game pack (spec §6). Returned in its own shape: the gateway keys
  // card_game on `assets` + `appId`, and must never see `items`, which it would
  // route as an audio content pack. Nothing here is sealed — apps/ stays
  // plaintext on the SD card (plan §9).
  if (pack.content_type === 'sound_quiz') {
    if (!isValidAppId(pack.pack_code)) {
      logger.warn(`[RFID-LOOKUP] sound_quiz pack ${pack.pack_code} is not a valid app id (1-8 chars [a-z0-9_-]); answering unknown`);
      return null;
    }
    const built = buildSoundQuizPack(pack, items, manifestUrlFor(pack.pack_code));
    for (const w of built.warnings) logger.warn(`[RFID-LOOKUP] sound_quiz ${pack.pack_code}: ${w}`);
    logger.info(
      `[RFID-LOOKUP] Game pack resolved: uid=${normalizedUid}, appId=${pack.pack_code}, version=${pack.version || 'none'}, rounds=${built.prompts.length}, assets=${built.assets.length}`
    );
    return {
      rfid_uid: normalizedUid,
      contentType: 'sound_quiz',
      appId: pack.pack_code,
      title: pack.name,
      version: pack.version,
      contentHash: pack.content_hash || null,
      prompts: built.prompts,
      assets: built.assets,
    };
  }
```

- [ ] **Step 4: Return `description` from `getContentPackByCode`**

In `getContentPackByCode` (around line 4164), change the item mapping to include description:

```js
      transformedPack.items = items.map(item => ({
        id: Number(item.id),
        sequence: item.item_number,
        title: item.title,
        description: item.description || '',
        text: item.lyrics_text || '',
        audioUrl: item.audio_url,
        imageUrl: item.image_url || null,
        storyNumber: item.story_number || null,
        storyTitle: item.story_title || null,
        active: item.active
      }));
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd main/manager-api-node && npx jest tests/unit/rfid.sound-quiz-lookup.test.js`
Expected: PASS, 4 tests.

- [ ] **Step 6: Run the neighbouring lookup tests to check nothing regressed**

Run: `cd main/manager-api-node && npx jest tests/unit/customCard.lookup.test.js tests/unit/rfid`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add main/manager-api-node/src/services/rfid.service.js main/manager-api-node/tests/unit/rfid.sound-quiz-lookup.test.js
git commit -m "feat(rfid): card lookup returns sound_quiz packs as appId + prompts + assets

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 3: Card type `game`

**Files:**
- Modify: `main/manager-api-node/src/services/rfid.service.js:2799-2813` (`determineTapCardType`), `:2846-2853` (include select), `:2867-2879` (inline classifier → `classifyLookupCardType`), module.exports
- Test: `main/manager-api-node/tests/unit/rfid.card-type-game.test.js`

**Interfaces:**
- Produces: exported `determineTapCardType(mapping)` and `classifyLookupCardType(lookupResolved)`; both return `'game'` for game cards. `recordCardTap` writes `card_type = 'game'` to `rfid_card_tap_log`.

- [ ] **Step 1: Write the failing test**

```js
// main/manager-api-node/tests/unit/rfid.card-type-game.test.js
'use strict';

/**
 * A game card is logged as `game`, not `content`. Both classifiers — the
 * mapping-based one and the lookup-fallback one — must agree, or the tap
 * analytics tab shows the same card under two names depending on which path
 * the gateway happened to take.
 */

jest.mock('../../src/config/database', () => ({ prisma: { $queryRaw: jest.fn() } }));
jest.mock('../../src/services/integrations/qdrant.service', () => ({}));
jest.mock('../../src/services/upload.service', () => ({}));
jest.mock('../../src/services/contentKeys.service', () => ({ isEnabled: () => false }));

const { determineTapCardType, classifyLookupCardType } = require('../../src/services/rfid.service');

describe('determineTapCardType', () => {
  it('is game when card_type says so', () => {
    expect(determineTapCardType({ card_type: 'game', content_pack_id: BigInt(9) })).toBe('game');
  });
  it('is game when the linked pack is a sound_quiz even if card_type is null', () => {
    expect(determineTapCardType({
      card_type: null, content_pack_id: BigInt(9), rfid_content_pack: { content_type: 'sound_quiz' }
    })).toBe('game');
  });
  it('is still content for an ordinary pack', () => {
    expect(determineTapCardType({
      card_type: null, content_pack_id: BigInt(9), rfid_content_pack: { content_type: 'story_pack' }
    })).toBe('content');
  });
  it('ai still wins over everything', () => {
    expect(determineTapCardType({ card_type: 'ai', content_pack_id: BigInt(9) })).toBe('ai');
  });
});

describe('classifyLookupCardType', () => {
  it('is game for a sound_quiz lookup', () => {
    expect(classifyLookupCardType({ contentType: 'sound_quiz', appId: 'hometown' })).toBe('game');
  });
  it('keeps the existing answers', () => {
    expect(classifyLookupCardType(null)).toBe('unknown');
    expect(classifyLookupCardType({ agentName: 'Tara' })).toBe('ai');
    expect(classifyLookupCardType({ contentType: 'prompt_pack' })).toBe('qna');
    expect(classifyLookupCardType({ contentType: 'story_pack' })).toBe('content');
    expect(classifyLookupCardType({ contentType: 'prompt' })).toBe('prompt');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd main/manager-api-node && npx jest tests/unit/rfid.card-type-game.test.js`
Expected: FAIL — `determineTapCardType is not a function` (not exported).

- [ ] **Step 3: Update the classifiers**

Replace `determineTapCardType` (line 2799) with:

```js
const determineTapCardType = (mapping) => {
  if (!mapping) return 'unknown';
  const cardType = (mapping.card_type || '').toLowerCase();
  const actionType = (mapping.action_type || '').toLowerCase();

  if (cardType === 'ai' || actionType === 'ai' || actionType === 'agent') {
    return 'ai';
  }
  // A game card is a content-pack mapping whose pack is a sound quiz. The
  // explicit card_type is what the dashboard writes; the pack check catches a
  // mapping made before the type existed.
  if (cardType === 'game' || mapping.rfid_content_pack?.content_type === 'sound_quiz') {
    return 'game';
  }
  if (mapping.content_pack_id) return 'content';
  if (mapping.question_pack_id) return 'qna';
  if (mapping.question_id || (Array.isArray(mapping.question_ids) && mapping.question_ids.length > 0)) {
    return 'prompt';
  }
  return cardType || 'unknown';
};

/** Card type when there is no mapping row and only the lookup result to go on. */
const classifyLookupCardType = (lookupResolved) => {
  if (!lookupResolved) return 'unknown';
  if (lookupResolved.agentName || lookupResolved.actionType === 'agent' || lookupResolved.actionType === 'ai') {
    return 'ai';
  }
  if (lookupResolved.contentType === 'sound_quiz') return 'game';
  if (lookupResolved.contentType === 'prompt_pack') return 'qna';
  if (lookupResolved.contentType && lookupResolved.contentType !== 'prompt') return 'content';
  return 'prompt';
};
```

In `recordCardTap`, change the include select (line ~2850) so the pack's type is available:

```js
        rfid_content_pack: {
          select: { id: true, pack_code: true, name: true, version: true, content_hash: true, content_type: true }
        }
```

Replace the inline IIFE (lines ~2867-2879, `const resolvedCardTypeFromLookup = (() => { ... })();`) with:

```js
  const resolvedCardTypeFromLookup = classifyLookupCardType(lookupResolved);
```

Add to `module.exports` next to `recordCardTap`:

```js
  recordCardTap,
  determineTapCardType,
  classifyLookupCardType,
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd main/manager-api-node && npx jest tests/unit/rfid.card-type-game.test.js`
Expected: PASS, 6 tests.

- [ ] **Step 5: Run the existing tap tests**

Run: `cd main/manager-api-node && npx jest tests/unit -t "tap"`
Expected: PASS (or "no tests found" for the filter; then run `npx jest tests/unit/customCard.lookup.test.js` to confirm the service still loads).

- [ ] **Step 6: Commit**

```bash
git add main/manager-api-node/src/services/rfid.service.js main/manager-api-node/tests/unit/rfid.card-type-game.test.js
git commit -m "feat(rfid): classify sound-quiz cards as card_type game in tap logs

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 4: Manifest written to S3 on every save

**Files:**
- Modify: `main/manager-api-node/src/services/upload.service.js` (new function + export)
- Modify: `main/manager-api-node/src/services/rfid.service.js` (`publishSoundQuizManifest`, called at the end of `createContentPack` ~line 4320 and `updateContentPack` ~line 4495)
- Test: `main/manager-api-node/tests/unit/rfid.publish-manifest.test.js`

**Interfaces:**
- Produces: `uploadService.uploadGamePackManifest(packCode: string, manifest: object): Promise<{ s3Key, url }>`; `rfidService.publishSoundQuizManifest(packId: bigint|number): Promise<{ url, rounds } | null>` (null for non-game packs).

- [ ] **Step 1: Write the failing test**

```js
// main/manager-api-node/tests/unit/rfid.publish-manifest.test.js
'use strict';

/**
 * manifest.jsn is what the toy parses, and it is derived from rows — so it
 * must be rewritten every time the rows are, or the device downloads a manifest
 * that names files the pack no longer has.
 */

const mockPrisma = {
  $queryRaw: jest.fn(),
  rfid_content_pack: { findFirst: jest.fn(), create: jest.fn(), updateMany: jest.fn() },
  content_item: { createMany: jest.fn(), deleteMany: jest.fn() },
  $transaction: jest.fn(async (fn) => fn(mockPrisma))
};
const mockUpload = { uploadGamePackManifest: jest.fn(async (code) => ({ s3Key: `rfidcontent/apps/${code}/manifest.jsn`, url: `https://cdn.test/rfidcontent/apps/${code}/manifest.jsn` })) };

jest.mock('../../src/config/database', () => ({ prisma: mockPrisma }));
jest.mock('../../src/services/integrations/qdrant.service', () => ({}));
jest.mock('../../src/services/upload.service', () => mockUpload);
jest.mock('../../src/services/contentKeys.service', () => ({ isEnabled: () => false }));

const rfidService = require('../../src/services/rfid.service');

const PACK = { id: BigInt(9), pack_code: 'hometown', name: 'Around the House', content_type: 'sound_quiz', version: '2', content_hash: 'x' };
const item = (n, title, prompt, d) => ({
  id: BigInt(n), item_number: n, title, lyrics_text: prompt, description: d,
  audio_url: `https://cdn.test/${title}.mp3`, image_url: `https://cdn.test/${title}.png`, active: true
});
const ITEMS = [item(1, 'Doorbell', 'DING-DONG?', 'Phone,Clock'), item(2, 'Phone', 'RING?', 'Doorbell,Clock'), item(3, 'Clock', 'TICK?', 'Phone,Doorbell')];

beforeEach(() => {
  jest.clearAllMocks();
  mockPrisma.$queryRaw.mockImplementation((strings) => {
    const sql = Array.isArray(strings) ? strings.join(' ') : String(strings);
    return Promise.resolve(sql.includes('information_schema') ? [] : ITEMS);
  });
  mockPrisma.rfid_content_pack.findFirst.mockResolvedValue(PACK);
  mockPrisma.rfid_content_pack.updateMany.mockResolvedValue({ count: 1 });
});

describe('publishSoundQuizManifest', () => {
  it('builds from rows and uploads to the fixed key', async () => {
    const result = await rfidService.publishSoundQuizManifest(9);
    expect(mockUpload.uploadGamePackManifest).toHaveBeenCalledTimes(1);
    const [code, manifest] = mockUpload.uploadGamePackManifest.mock.calls[0];
    expect(code).toBe('hometown');
    expect(manifest).toMatchObject({ template: 'sound_quiz', app_id: 'hometown', version: 2 });
    expect(manifest.rounds).toHaveLength(3);
    expect(result).toEqual({ url: expect.stringMatching(/manifest\.jsn$/), rounds: 3 });
  });

  it('does nothing for a non-game pack', async () => {
    mockPrisma.rfid_content_pack.findFirst.mockResolvedValue({ ...PACK, content_type: 'story_pack' });
    const result = await rfidService.publishSoundQuizManifest(9);
    expect(result).toBeNull();
    expect(mockUpload.uploadGamePackManifest).not.toHaveBeenCalled();
  });

  it('is called by updateContentPack after the items are written', async () => {
    await rfidService.updateContentPack({
      id: 9,
      items: ITEMS.map((i) => ({ title: i.title, text: i.lyrics_text, description: i.description, audioUrl: i.audio_url, imageUrl: i.image_url }))
    }, 1);
    expect(mockUpload.uploadGamePackManifest).toHaveBeenCalledWith('hometown', expect.objectContaining({ template: 'sound_quiz' }));
  });

  it('surfaces an upload failure as an error after the rows are saved', async () => {
    mockUpload.uploadGamePackManifest.mockRejectedValueOnce(new Error('s3 down'));
    await expect(rfidService.updateContentPack({ id: 9, name: 'Renamed' }, 1)).rejects.toThrow(/manifest/i);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd main/manager-api-node && npx jest tests/unit/rfid.publish-manifest.test.js`
Expected: FAIL — `publishSoundQuizManifest is not a function`.

- [ ] **Step 3: Add the S3 writer**

In `src/services/upload.service.js`, after `uploadCustomCardImage` and before the character-art section, add:

```js
/**
 * The device manifest of a sound-quiz game pack, at a FIXED key so the card
 * lookup can name its URL without storing anything. Overwritten on every pack
 * save, with the same no-cache + invalidation pair the custom-card objects
 * use, so the toy's next download sees the rows as they are now. Plaintext by
 * design: apps/ is never sealed (plan §9).
 * @param {string} packCode - the pack's code, already validated as an app id
 * @param {Object} manifest - from soundQuiz.buildSoundQuizPack
 * @returns {Promise<{s3Key: string, url: string}>}
 */
async function uploadGamePackManifest(packCode, manifest) {
  const { manifestKeyFor } = require('./soundQuiz');
  const s3Key = manifestKeyFor(packCode);
  await s3Client.send(new PutObjectCommand({
    Bucket: S3_BUCKET,
    Key: s3Key,
    Body: Buffer.from(JSON.stringify(manifest), 'utf8'),
    ContentType: 'application/json',
    CacheControl: CUSTOM_CARD_CACHE_CONTROL
  }));
  await invalidateCloudFront([s3Key]);
  const url = `https://${CLOUDFRONT_DOMAIN}/${s3Key}`;
  logger.info('Game pack manifest uploaded to S3', { s3Key, packCode, rounds: (manifest.rounds || []).length });
  return { s3Key, url };
}
```

Add `uploadGamePackManifest,` to `module.exports` in the same file.

- [ ] **Step 4: Add `publishSoundQuizManifest` and call it from both save paths**

In `src/services/rfid.service.js`, directly above `const createContentPack = async (data, userId) => {` (line ~4238), add:

```js
/**
 * Regenerate and upload manifest.jsn for a sound-quiz pack. Runs at the end of
 * every pack save; a non-game pack returns null without touching S3. Throws
 * on upload failure — by then the rows are committed, so the admin must know
 * the device would download a stale manifest and save again.
 * @param {bigint|number|string} packId
 * @returns {Promise<{url: string, rounds: number}|null>}
 */
const publishSoundQuizManifest = async (packId) => {
  const pack = await prisma.rfid_content_pack.findFirst({ where: { id: BigInt(packId) } });
  if (!pack || pack.content_type !== 'sound_quiz') return null;
  if (!isValidAppId(pack.pack_code)) {
    throw new ApiError(`Pack code "${pack.pack_code}" must be 1-8 chars of a-z 0-9 _ - to be a game pack`, 400);
  }
  const items = await listContentItemsCompat(pack.id);
  const built = buildSoundQuizPack(pack, items, manifestUrlFor(pack.pack_code));
  for (const w of built.warnings) logger.warn(`[SOUND-QUIZ] ${pack.pack_code}: ${w}`);
  try {
    const { url } = await uploadService.uploadGamePackManifest(pack.pack_code, built.manifest);
    return { url, rounds: built.manifest.rounds.length };
  } catch (err) {
    logger.error(`[SOUND-QUIZ] manifest upload failed for ${pack.pack_code}: ${err.message}`);
    throw new ApiError('Pack saved, but the game manifest could not be uploaded. Save again to retry.', 500);
  }
};
```

In `createContentPack`, replace the final `return null;` (after the `else { logger.info('[createContentPack] No items to insert'); }` block) with:

```js
  await publishSoundQuizManifest(newPack.id);
  return null;
```

In `updateContentPack`, replace the final `return null;` (after the `if (data.items && Array.isArray(data.items)) { ... }` block) with:

```js
  await publishSoundQuizManifest(data.id);
  return null;
```

Add `publishSoundQuizManifest,` to `module.exports` under `// Content Pack CRUD (Task 7)`.

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd main/manager-api-node && npx jest tests/unit/rfid.publish-manifest.test.js`
Expected: PASS, 4 tests.

- [ ] **Step 6: Run the pack-editor tests that already exist to catch a broken save path**

Run: `cd main/manager-api-node && npx jest tests/unit/customCard tests/unit/rfid`
Expected: PASS. If a customCard test fails because `rfid_content_pack.findFirst` now runs one extra time at the end of `updateContentPack`, add `content_type: 'rfidcontent'` to that test's pack fixture (the guard returns null for non-game packs).

- [ ] **Step 7: Commit**

```bash
git add main/manager-api-node/src/services/upload.service.js main/manager-api-node/src/services/rfid.service.js main/manager-api-node/tests/unit/rfid.publish-manifest.test.js
git commit -m "feat(sound-quiz): regenerate manifest.jsn to a fixed S3 key on every pack save

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 5: Upload route `purpose=game_asset`

**Files:**
- Modify: `main/manager-api-node/src/routes/rfid.routes.js:3786-3850`
- Test: `main/manager-api-node/tests/unit/rfid.upload-game-asset.test.js`

**Interfaces:**
- Produces: `POST /admin/rfid/content-pack/upload` with form field `purpose=game_asset` stores the file byte-for-byte (PNG stays PNG) and passes `{ sealKey: null }` to `uploadContentFile`.

- [ ] **Step 1: Write the failing test**

```js
// main/manager-api-node/tests/unit/rfid.upload-game-asset.test.js
'use strict';

/**
 * Game-pack icons are PNGs the quiz renderer loads directly, and game packs
 * are never sealed. Without `purpose=game_asset` the route would convert the
 * icon to an LVGL .bin the game cannot show and seal the sound under a key the
 * game never receives.
 */
const express = require('express');
const request = require('supertest');

jest.mock('../../src/middleware/auth', () => ({
  requireAuth: (_q, _s, n) => n(),
  requireAdmin: (req, _s, n) => { req.user = { id: 1 }; n(); },
}));
jest.mock('../../src/config/database', () => ({ prisma: {} }));
jest.mock('../../src/services/integrations/qdrant.service', () => ({}));
const mockKeys = { isEnabled: () => true, getOrCreatePackKey: jest.fn(async () => Buffer.alloc(16, 1)), getPackKey: jest.fn() };
jest.mock('../../src/services/contentKeys.service', () => mockKeys);
jest.mock('../../src/utils/lvglImage', () => ({
  ...jest.requireActual('../../src/utils/lvglImage'),
  toLvglRgb565Bin: jest.fn(async () => Buffer.from('BIN'))
}));
const mockUpload = { uploadContentFile: jest.fn(async (_b, filename) => ({ success: true, url: `https://cdn.test/${filename}` })) };
jest.mock('../../src/services/upload.service', () => mockUpload);
// rfid.service is loaded for real, as rfid.preview-route.test.js does: the
// routes module destructures it at require time, so an empty mock breaks load.

const app = express();
app.use('/admin/rfid', require('../../src/routes/rfid.routes'));

// A PNG signature plus padding is enough for the route's byte sniff.
const PNG = Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), Buffer.alloc(64, 7)]);

beforeEach(() => jest.clearAllMocks());

test('game_asset keeps a PNG as a PNG and does not seal it', async () => {
  const res = await request(app)
    .post('/admin/rfid/content-pack/upload')
    .field('purpose', 'game_asset')
    .field('packCode', 'hometown')
    .field('category', 'apps/hometown')
    .attach('file', PNG, { filename: 'doorbell.png', contentType: 'image/png' });

  expect(res.status).toBe(200);
  expect(res.body.code).toBe(0);
  const [buffer, filename, contentType, category, mimeType, opts] = mockUpload.uploadContentFile.mock.calls[0];
  expect(buffer.equals(PNG)).toBe(true);
  expect(filename).toBe('doorbell.png');
  expect(contentType).toBe('rfidcontent');
  expect(category).toBe('apps/hometown');
  expect(mimeType).toBe('image/png');
  expect(opts).toEqual({ sealKey: null });
  expect(mockKeys.getOrCreatePackKey).not.toHaveBeenCalled();
});

test('without the purpose an item PNG is still converted and sealed', async () => {
  const res = await request(app)
    .post('/admin/rfid/content-pack/upload')
    .field('packCode', 'STORY01')
    .attach('file', PNG, { filename: 'cover.png', contentType: 'image/png' });

  expect(res.status).toBe(200);
  const [buffer, filename, , , mimeType, opts] = mockUpload.uploadContentFile.mock.calls[0];
  expect(filename).toBe('cover.bin');
  expect(mimeType).toBe('application/octet-stream');
  expect(buffer.toString()).toBe('BIN');
  expect(opts.sealKey).toBeInstanceOf(Buffer);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd main/manager-api-node && npx jest tests/unit/rfid.upload-game-asset.test.js`
Expected: FAIL — first test gets `cover.bin`-style conversion (`filename` is `doorbell.bin`) and a Buffer `sealKey`.

- [ ] **Step 3: Add the purpose to the route**

In `src/routes/rfid.routes.js`, inside the `router.post('/content-pack/upload', ...)` handler, replace the block from `const isPackThumbnail = ...` through the `sealKey` computation so it reads:

```js
    const isPackThumbnail = req.body?.purpose === 'thumbnail' || Boolean(contentPackId);
    // A sound-quiz game asset: the quiz renderer loads PNG icons straight off
    // the card and game packs are never sealed (apps/ is plaintext), so the
    // file goes up exactly as picked.
    const isGameAsset = req.body?.purpose === 'game_asset';

    let artwork;
    try {
      artwork = isGameAsset
        ? { buffer: req.file.buffer, filename: req.file.originalname, mimeType: req.file.mimetype }
        : await toDeviceArtwork(req.file, { isPackThumbnail });
    } catch (error) {
      if (error.decodeFailed) {
        logger.warn('RFID content pack image conversion failed:', { error: error.message });
        return badRequest(res, 'That image could not be read. Please try a different PNG or JPEG.');
      }
      throw error;
    }

    try {
      const packCode = req.body?.packCode || null;
      let sealKey = null;
      if (!isPackThumbnail && !isGameAsset && contentKeys.isEnabled()) {
        sealKey = packCode ? await contentKeys.getOrCreatePackKey(packCode) : null;
        if (!sealKey) logger.warn(`[RFID-UPLOAD] no pack key for packCode=${packCode || 'none'}; uploading plaintext`);
      }
```

Keep the rest of the handler (the `uploadService.uploadContentFile(...)` call and the `success(res, result)`) unchanged. Also update the swagger `purpose` enum on that route from `enum: [thumbnail]` to `enum: [thumbnail, game_asset]` and append to its description: `` `game_asset` stores the file as-is (no .bin conversion) and never seals it — for sound-quiz game packs. ``

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd main/manager-api-node && npx jest tests/unit/rfid.upload-game-asset.test.js`
Expected: PASS, 2 tests.

- [ ] **Step 5: Commit**

```bash
git add main/manager-api-node/src/routes/rfid.routes.js main/manager-api-node/tests/unit/rfid.upload-game-asset.test.js
git commit -m "feat(rfid): purpose=game_asset uploads store PNG/MP3 as-is and unsealed

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 6: Gateway — shared `card_game` builder in both senders

**Files:**
- Create: `main/mqtt-gateway/gateway/card-game.js`
- Modify: `main/mqtt-gateway/gateway/mqtt-gateway.js:184-213` (whitelist), `:1105-1116` (branch)
- Modify: `main/mqtt-gateway/mqtt/virtual-connection.js:1655-1680` (branch)
- Test: `main/mqtt-gateway/tests/card-game.test.js`

**Interfaces:**
- Consumes: the lookup shape from Task 2 (`contentType:'sound_quiz', appId, title, version, contentHash, prompts, assets`).
- Produces: `isCardGame(data): boolean`; `buildCardGameMessage(rfidUid, data, extra = {}): { type:'card_game', rfid_uid, ...extra, app_id, name, version:number, content_hash, prompts, assets }`.

- [ ] **Step 1: Write the failing test**

```js
// main/mqtt-gateway/tests/card-game.test.js
const assert = require("assert");
const test = require("node:test");
const fs = require("fs");
const path = require("path");

// The helper is unit-tested directly. The two senders are pinned against the
// module SOURCE TEXT, following card-content-encryption.test.js: the gateway
// wires MQTT/UDP/LiveKit on require, and the failure this guards against is a
// dropped field in fetchRfidContentFromManagerApi's explicit whitelist, or one
// sender growing a card_game branch while the other keeps spreading the lookup
// payload as card_content.

const { isCardGame, buildCardGameMessage } = require("../gateway/card-game");

const LOOKUP = {
  rfid_uid: "04A1B2C3",
  contentType: "sound_quiz",
  appId: "hometown",
  title: "Around the House",
  version: "3",
  contentHash: "h3",
  prompts: [{ sound: "Doorbell", prompt: "DING-DONG?", file: "doorbell.mp3" }],
  assets: [
    { name: "manifest.jsn", url: "https://cdn/rfidcontent/apps/hometown/manifest.jsn" },
    { name: "doorbell.mp3", url: "https://cdn/x.mp3" },
  ],
};

test("isCardGame keys on sound_quiz + appId + assets", () => {
  assert.strictEqual(isCardGame(LOOKUP), true);
  assert.strictEqual(isCardGame({ ...LOOKUP, contentType: "story_pack" }), false);
  assert.strictEqual(isCardGame({ ...LOOKUP, assets: null }), false);
  assert.strictEqual(isCardGame({ ...LOOKUP, appId: "" }), false);
  assert.strictEqual(isCardGame(null), false);
});

test("buildCardGameMessage emits the firmware contract in snake_case", () => {
  const msg = buildCardGameMessage("04A1B2C3", LOOKUP, { session_id: "s1" });
  assert.deepStrictEqual(msg, {
    type: "card_game",
    rfid_uid: "04A1B2C3",
    session_id: "s1",
    app_id: "hometown",
    name: "Around the House",
    version: 3,
    content_hash: "h3",
    prompts: [{ sound: "Doorbell", prompt: "DING-DONG?", file: "doorbell.mp3" }],
    assets: [
      { name: "manifest.jsn", url: "https://cdn/rfidcontent/apps/hometown/manifest.jsn" },
      { name: "doorbell.mp3", url: "https://cdn/x.mp3" },
    ],
  });
  // No camelCase leaks and nothing beyond the contract.
  assert.deepStrictEqual(Object.keys(msg).sort(), ["app_id", "assets", "content_hash", "name", "prompts", "rfid_uid", "session_id", "type", "version"]);
});

test("version defaults to 1 and content_hash to null", () => {
  const msg = buildCardGameMessage("U", { ...LOOKUP, version: undefined, contentHash: undefined });
  assert.strictEqual(msg.version, 1);
  assert.strictEqual(msg.content_hash, null);
});

const gatewaySrc = fs.readFileSync(path.join(__dirname, "..", "gateway", "mqtt-gateway.js"), "utf8");
const vcSrc = fs.readFileSync(path.join(__dirname, "..", "mqtt", "virtual-connection.js"), "utf8");

test("fetchRfidContentFromManagerApi whitelists the game fields", () => {
  const start = gatewaySrc.indexOf("async function fetchRfidContentFromManagerApi");
  const end = gatewaySrc.indexOf("async function fetchContentDownloadManifest");
  assert.ok(start !== -1 && end !== -1, "could not locate function boundaries");
  const fn = gatewaySrc.slice(start, end);
  for (const f of ["appId", "contentHash", "prompts", "assets"]) {
    assert.match(fn, new RegExp(`${f}:\\s*data\\.${f}\\s*\\|\\|\\s*null`), `whitelist must name ${f}`);
  }
});

test("no-session router sends card_game before the textToSend guard", () => {
  const start = gatewaySrc.indexOf("sent card_unknown to device");
  const end = gatewaySrc.indexOf("// Determine text for agent path");
  assert.ok(start !== -1 && end !== -1 && start < end, "could not locate the routing slice");
  const slice = gatewaySrc.slice(start, end);
  assert.match(slice, /isCardGame\(rfidContent\)/);
  assert.match(slice, /buildCardGameMessage\(rfidUid, rfidContent\)/);
});

test("in-session sender sends card_game before the isAiCard classification", () => {
  const start = vcSrc.indexOf("const cardData = response.data.data;");
  const end = vcSrc.indexOf("const isAiCard =");
  assert.ok(start !== -1 && end !== -1 && start < end, "could not locate the lookup slice");
  const slice = vcSrc.slice(start, end);
  assert.match(slice, /isCardGame\(cardData\)/);
  assert.match(slice, /buildCardGameMessage\(rfidUid, cardData, \{ session_id: json\.session_id \}\)/);
});

test("both senders require the shared helper", () => {
  assert.match(gatewaySrc, /require\("\.\/card-game"\)/);
  assert.match(vcSrc, /require\("\.\.\/gateway\/card-game"\)/);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd main/mqtt-gateway && node --test tests/card-game.test.js`
Expected: FAIL — `Cannot find module '../gateway/card-game'`.

- [ ] **Step 3: Write the helper**

```js
// main/mqtt-gateway/gateway/card-game.js
/**
 * card_game: the message a tapped sound-quiz card produces (spec §3 in
 * docs/superpowers/specs/2026-09-11-sound-pack-game-card-design.md).
 *
 * One builder for both senders — the no-session router in mqtt-gateway.js and
 * the in-session path in virtual-connection.js. They have drifted before
 * (character artwork reached one and not the other for weeks), so the shape
 * lives here and nowhere else.
 *
 * The lookup API speaks camelCase; the firmware reads snake_case. Field names
 * below are the firmware contract. Do not add or rename.
 */

function isCardGame(data) {
  return Boolean(
    data &&
    data.contentType === "sound_quiz" &&
    data.appId &&
    Array.isArray(data.assets)
  );
}

function buildCardGameMessage(rfidUid, data, extra = {}) {
  const version = parseInt(data.version, 10);
  return {
    type: "card_game",
    rfid_uid: rfidUid,
    ...extra,
    app_id: data.appId,
    name: data.title || data.packName || data.appId,
    version: Number.isFinite(version) && version > 0 ? version : 1,
    content_hash: data.contentHash || null,
    prompts: (data.prompts || []).map((p) => ({ sound: p.sound, prompt: p.prompt, file: p.file })),
    assets: data.assets.map((a) => ({ name: a.name, url: a.url })),
  };
}

module.exports = { isCardGame, buildCardGameMessage };
```

- [ ] **Step 4: Wire the no-session sender**

In `main/mqtt-gateway/gateway/mqtt-gateway.js`:

Add the require next to the other `./` requires (after `const { ownsDevice } = require("./shard");`):

```js
const { isCardGame, buildCardGameMessage } = require("./card-game");
```

In `fetchRfidContentFromManagerApi`'s return object, after the `encryption:` line, add:

```js
      // Sound-quiz game packs (card_game). Same whitelist trap as `character`
      // and `encryption`: unnamed here means the toy never gets the pack.
      appId: data.appId || null,
      contentHash: data.contentHash || null,
      prompts: data.prompts || null,
      assets: data.assets || null,
```

In the `card_lookup` router, immediately after the `card_unknown` block (after `logger.warn(`[RFID-SCAN] Unknown card ${rfidUid}, sent card_unknown to device ${deviceId}`); return; }`) and BEFORE `// Determine text for agent path`, insert:

```js
        // ====== BRANCH G: GAME PACK — send card_game directly via MQTT ======
        // Before the textToSend guard below: a game lookup carries no items and
        // no prompt text, and that guard would otherwise return early.
        if (isCardGame(rfidContent)) {
          const gameMsg = buildCardGameMessage(rfidUid, rfidContent);
          logger.info(
            `🎮 [RFID-ROUTING] Sending card_game: app=${gameMsg.app_id}, v=${gameMsg.version}, ` +
            `rounds=${gameMsg.prompts.length}, assets=${gameMsg.assets.length} to device ${deviceId}`
          );
          this.mqttPublish(`devices/p2p/${clientId}`, gameMsg);
          return;
        }
```

- [ ] **Step 5: Wire the in-session sender**

In `main/mqtt-gateway/mqtt/virtual-connection.js`:

Add the require after `const logger = require("../utils/logger");`:

```js
const { isCardGame, buildCardGameMessage } = require("../gateway/card-game");
```

In the `card_lookup` handler, right after
```js
          const cardData = response.data.data;
          console.log(
            `✅ [RFID] Card found: contentType=${cardData.contentType}, title="${cardData.title || cardData.packName || ""}"`
          );
```
and before `// Treat AI session-config cards as card_ai`, insert:

```js
          // Game pack: explicit branch instead of the wholesale spread below,
          // which would label it card_content and leak camelCase fields.
          if (isCardGame(cardData)) {
            const gameMsg = buildCardGameMessage(rfidUid, cardData, { session_id: json.session_id });
            this.sendMqttMessage(JSON.stringify(gameMsg));
            console.log(
              `📤 [RFID] Sent card_game (app=${gameMsg.app_id}, v=${gameMsg.version}, assets=${gameMsg.assets.length}) to device ${this.deviceId}`
            );
            return;
          }
```

- [ ] **Step 6: Run the gateway tests**

Run: `cd main/mqtt-gateway && npm test`
Expected: PASS including the 7 new tests; `card-content-encryption.test.js` still passes (the new branch sits outside its slices).

- [ ] **Step 7: Commit**

```bash
git add main/mqtt-gateway/gateway/card-game.js main/mqtt-gateway/gateway/mqtt-gateway.js main/mqtt-gateway/mqtt/virtual-connection.js main/mqtt-gateway/tests/card-game.test.js
git commit -m "feat(gateway): publish card_game for sound-quiz packs from both senders via one builder

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 7: MCP `purpose` passthrough

**Files:**
- Modify: `main/manager-api-node/mcp/cheeko-mcp.mjs:258-290` (`upload_pack_file`), `:91-102` (`uploadPlan`)
- Test: `main/manager-api-node/mcp/cheeko-mcp.test.mjs`

**Interfaces:**
- Produces: `uploadPlan(filePath, { convert, contentPackId, purpose })` — `purpose === 'game_asset'` never converts; tool input gains `purpose: 'thumbnail' | 'game_asset'`.

- [ ] **Step 1: Add the failing assertion**

Append to the existing `uploadPlan` test in `mcp/cheeko-mcp.test.mjs` (inside the `test('uploadPlan: ...` body, after the `frame.bin` line):

```js
  assert.deepEqual(uploadPlan('/x/doorbell.png', { purpose: 'game_asset' }), { filename: 'doorbell.png', mime: 'image/png', shouldConvert: false });
```

And add a new test after it:

```js
test('upload_pack_file forwards purpose to the API form', async () => {
  const seen = [];
  const api = async (route, opts) => { seen.push({ route, form: opts.form }); return { content: [{ text: '{}' }], isError: false }; };
  const s = buildServer({ api, canWrite: true });
  const tool = (s._registeredTools ?? s.registeredTools)['upload_pack_file'];
  const tmp = path.join(os.tmpdir(), `mcp-${randomUUID()}.png`);
  await writeFile(tmp, Buffer.from('89504e470d0a1a0a', 'hex'));
  try {
    await tool.callback({ path: tmp, purpose: 'game_asset', packCode: 'hometown', category: 'apps/hometown' });
  } finally {
    await unlink(tmp);
  }
  assert.equal(seen.length, 1);
  assert.equal(seen[0].form.get('purpose'), 'game_asset');
  assert.equal(seen[0].form.get('file').name, path.basename(tmp));
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd main/manager-api-node && npm run test:mcp`
Expected: FAIL — `uploadPlan` still converts (`doorbell.bin`), and `form.get('purpose')` is `null`.

- [ ] **Step 3: Implement**

In `uploadPlan`:

```js
export function uploadPlan(filePath, { convert, contentPackId, purpose } = {}) {
  const ext = path.extname(filePath).toLowerCase();
  const mime = MIME[ext];
  if (!mime) throw new Error(`Unsupported file type ${ext || '(none)'}; expected ${Object.keys(MIME).join(' ')}`);
  const convertible = ext === '.png' || ext === '.jpg' || ext === '.jpeg';
  // A game asset is stored as-is by the API too (purpose=game_asset), so
  // converting here would hand the quiz an icon it cannot draw.
  const shouldConvert = convertible && purpose !== 'game_asset' && (convert ?? !contentPackId);
  return {
    filename: shouldConvert ? path.basename(filePath, ext) + '.bin' : path.basename(filePath),
    mime: shouldConvert ? MIME['.bin'] : mime,
    shouldConvert
  };
}
```

In `upload_pack_file`: extend the description with `` Pass purpose "game_asset" for sound-quiz game packs: the file is stored as-is (PNG stays PNG) and never sealed. ``; add to `inputSchema`:

```js
        purpose: z.enum(['thumbnail', 'game_asset']).optional().describe('"thumbnail" for pack cover art; "game_asset" for a sound-quiz sound or icon (stored as-is, never sealed)')
```

change the handler signature to `async ({ path: filePath, category, packCode, contentPackId, convert, purpose }) =>`, pass `purpose` into `uploadPlan(filePath, { convert, contentPackId, purpose })`, and after the `contentPackId` append add:

```js
      if (purpose) form.append('purpose', purpose);
```

Also skip the plaintext warning for game assets: change `if (!contentPackId && !packCode && !result.isError)` to `if (!contentPackId && !packCode && purpose !== 'game_asset' && !result.isError)`.

- [ ] **Step 4: Run to verify it passes**

Run: `cd main/manager-api-node && npm run test:mcp`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add main/manager-api-node/mcp/cheeko-mcp.mjs main/manager-api-node/mcp/cheeko-mcp.test.mjs
git commit -m "feat(mcp): upload_pack_file passes purpose=game_asset through unconverted

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 8: Dashboard — sound-quiz pack editor

**Files:**
- Modify: `main/manager-web/src/utils/contentTypes.js:7-18`
- Modify: `main/manager-web/src/components/RfidContentPackDialog.vue` — template `:201-228` (item row), rules `:582`, computed `:604`, `addItem` `:723`, `pickMediaFile` `:1135-1148`, `submit` `:1499`

**Interfaces:**
- Consumes: `POST /admin/rfid/content-pack/upload` with `purpose=game_asset` (Task 5); `getContentPackByCode` items with `description` (Task 2).
- Produces: items saved with `title` (Sound), `text` (Prompt), `audioUrl` (File), `imageUrl` (Icon), `description` (`A,B`).

There are no automated tests for manager-web. Each step ends with a manual check in the running dashboard (`cd main/manager-web && npm run serve`).

- [ ] **Step 1: Register the content type**

In `src/utils/contentTypes.js`:

```js
export const DEFAULT_CONTENT_TYPES = ['story_pack', 'rhyme_pack', 'habit_pack', 'rfidcontent', 'sound_quiz'];

export const CONTENT_TYPE_LABELS = {
  story_pack: 'Story Pack',
  rhyme_pack: 'Rhyme Pack',
  habit_pack: 'Habit Pack',
  rfidcontent: 'RFID Content',
  sound_quiz: 'Sound Quiz (Game)',
  prompt: 'AI Prompt',
  prompt_pack: 'Q&A Pack'
};
```

Check: open Content Packs → Add, the type dropdown lists "Sound Quiz (Game)".

- [ ] **Step 2: Add the `isSoundQuiz` computed and pack-code rule**

In `RfidContentPackDialog.vue` `computed`, after `contentTypeOptions()`:

```js
    // Sound-quiz packs are game packs: rows are quiz rounds, files are stored
    // as-is, and the pack code becomes the SD folder (8.3).
    isSoundQuiz() {
      return this.normalizeContentType(this.form.contentType) === 'sound_quiz';
    },
```

In `data()` where `rules` are defined (line ~582), extend the `packCode` rule array with a validator (keep the existing required rule):

```js
        packCode: [
          { required: true, message: 'Pack code is required', trigger: 'blur' },
          {
            validator: (rule, value, callback) => {
              if (this.isSoundQuiz && !/^[a-z0-9_-]{1,8}$/.test(String(value || ''))) {
                callback(new Error('Game pack code: 1-8 chars, a-z 0-9 _ - (it becomes the SD folder)'));
              } else {
                callback();
              }
            },
            trigger: 'blur'
          }
        ],
```

Check: with type Sound Quiz and pack code `AroundTheHouse`, blur shows the error; `hometown` passes.

- [ ] **Step 3: Give new rows a `description` and add the game fields to the row template**

In `addItem(index = null)` change the item literal to:

```js
        const item = {
            _rowKey: nextRowKey(),
            sequence: 0,
            title: '',
            audioUrl: '',
            imageUrl: '',
            text: '',  // Voice script / lyrics text — the Prompt for a sound quiz
            description: ''  // Sound quiz: "A,B" wrong-answer Sound names
        };
```

In the item-row template (line ~201), replace the four inputs inside `.inputs-wrapper` with:

```html
                          <el-input v-model="item.title" :placeholder="isSoundQuiz ? 'Sound (e.g. Doorbell)' : 'Title'" size="small" class="mb-1"></el-input>
                          <el-input v-if="isSoundQuiz" v-model="item.text" placeholder="Prompt shown on the toy (e.g. DING-DONG?)" size="small" class="mb-1">
                              <template slot="prepend"><i class="el-icon-chat-dot-square"></i></template>
                          </el-input>
                          <el-input v-model="item.audioUrl" :placeholder="isSoundQuiz ? 'Sound file (MP3, 22050 Hz mono)' : 'Audio URL (https://...)'" size="small" class="mb-1">
                              <template slot="prepend"><i class="el-icon-headset"></i></template>
                              <template slot="append">
                                <el-button
                                  icon="el-icon-upload2"
                                  :loading="uploadingMedia"
                                  @click="pickAudioFile(index)"
                                ></el-button>
                                <el-button
                                  v-if="item.audioUrl"
                                  :icon="playingUrl === item.audioUrl ? 'el-icon-video-pause' : 'el-icon-video-play'"
                                  @click="toggleAudio(item.audioUrl)"
                                ></el-button>
                              </template>
                          </el-input>
                          <el-input v-model="item.imageUrl" :placeholder="isSoundQuiz ? 'Icon (48x48 PNG)' : 'Image URL (Thumbnail)'" size="small" class="mb-1">
                               <template slot="prepend"><i class="el-icon-picture"></i></template>
                               <template slot="append">
                                 <el-button
                                   icon="el-icon-upload2"
                                   :loading="uploadingMedia"
                                   @click="pickImageFile(index)"
                                 ></el-button>
                               </template>
                          </el-input>
                          <div v-if="isSoundQuiz" class="distractor-row">
                            <el-select :value="distractorAt(item, 0)" @input="setDistractor(item, 0, $event)" placeholder="Wrong answer 1" size="small" clearable filterable>
                              <el-option v-for="name in distractorOptions(index)" :key="'d0-' + name" :label="name" :value="name"/>
                            </el-select>
                            <el-select :value="distractorAt(item, 1)" @input="setDistractor(item, 1, $event)" placeholder="Wrong answer 2" size="small" clearable filterable>
                              <el-option v-for="name in distractorOptions(index)" :key="'d1-' + name" :label="name" :value="name"/>
                            </el-select>
                          </div>
                          <el-input v-else type="textarea" v-model="item.text" placeholder="Voice script / Text content" size="small" :rows="2" class="text-input">
                          </el-input>
```

Add to `methods`:

```js
    // ---- Sound quiz: wrong answers live in `description` as "A,B" ----
    distractorList(item) {
      return String(item.description || '').split(',').map(s => s.trim()).filter(Boolean);
    },
    distractorAt(item, idx) {
      return this.distractorList(item)[idx] || '';
    },
    setDistractor(item, idx, value) {
      const list = this.distractorList(item);
      list[idx] = value || '';
      // Keep both slots so slot 1 can be set before slot 0.
      while (list.length < 2) list.push('');
      this.$set(item, 'description', list.slice(0, 2).join(','));
    },
    // Every other row's Sound name. A round cannot be its own wrong answer.
    distractorOptions(index) {
      return this.form.items
        .filter((it, i) => i !== index && String(it.title || '').trim())
        .map(it => it.title.trim());
    },
```

Add to the component `<style>`:

```css
.distractor-row { display: flex; gap: 8px; margin-bottom: 4px; }
.distractor-row .el-select { flex: 1; }
```

Check: with type Sound Quiz, a row shows Sound, Prompt, Sound file, Icon, and two Wrong-answer selects listing the other rows' Sound names. Switching type back to Story Pack restores the textarea.

- [ ] **Step 4: Send `purpose=game_asset` and `category=apps/<code>` for game uploads**

In `pickMediaFile` (the method containing `targetItem[this.pendingUpload.field] = await this.uploadOne(`), replace the `uploadOne(...)` call with:

```js
        targetItem[this.pendingUpload.field] = await this.uploadOne(
          file,
          this.isSoundQuiz && !isPackThumbnail ? `apps/${this.form.packCode}` : (type === 'audio' ? 'audio' : 'images'),
          {
            contentPackId: isPackThumbnail ? this.form.id : null,
            purpose: isPackThumbnail ? 'thumbnail' : (this.isSoundQuiz ? 'game_asset' : undefined)
          }
        );
```

Check: upload a PNG icon on a sound-quiz row; the stored URL ends in `.png` (not `.bin`) and the preview `<img>` renders it directly (`previewSrc` returns non-.bin URLs as-is).

- [ ] **Step 5: Validate rounds on submit**

In `submit()`, inside the flat-mode `else` branch, before `submitForm.items = this.form.items.map(...)`, add:

```js
            if (this.isSoundQuiz) {
              const n = this.form.items.length;
              if (n < 2 || n > 16) {
                this.$message.warning('A sound quiz needs between 2 and 16 rounds.');
                return;
              }
              const bad = this.form.items.findIndex(it =>
                !String(it.title || '').trim() || !String(it.text || '').trim() ||
                !it.audioUrl || !it.imageUrl || this.distractorList(it).length !== 2
              );
              if (bad !== -1) {
                this.$message.warning(`Round ${bad + 1} needs a Sound, a Prompt, a sound file, an icon and two wrong answers.`);
                return;
              }
            }
```

Also, when `isSoundQuiz`, story mode makes no sense: in the template find the story-mode switch (`v-model="storyMode"`) and add `:disabled="isSoundQuiz"` to it.

Check: save with one incomplete round shows the warning; a complete two-round pack saves, reopens with Sound/Prompt/wrong answers intact, and `GET /admin/rfid/content-pack/code/<code>` shows `description` on each item.

- [ ] **Step 6: Commit**

```bash
git add main/manager-web/src/utils/contentTypes.js main/manager-web/src/components/RfidContentPackDialog.vue
git commit -m "feat(dashboard): author sound-quiz game packs — Sound, Prompt, File, Icon, wrong answers per round

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 9: Dashboard — Game card mapping and display

**Files:**
- Modify: `main/manager-web/src/components/RfidCardDialog.vue` — tiles `:29-44`, pack select `:100-108`, `setActionType` `:308`, watcher `:349-373`
- Modify: `main/manager-web/src/views/RfidManagement.vue` — `:269-286` (Cards tab type column), `:811-817` (tap analytics tag), `:2424-2426` (reverse map)

**Interfaces:**
- Consumes: `POST/PUT /admin/rfid/card` accepting `cardType: 'game'` + `contentPackId` (already supported by `createCardMapping`/`updateCardMapping`); `contentPacks` prop rows carrying `contentType`.
- Produces: a mapping row with `card_type = 'game'` and `content_pack_id` set.

- [ ] **Step 1: Add the Game Card tile and filtered pack select**

In `RfidCardDialog.vue`, after the AI Card tile inside `.type-selector`:

```html
                <div class="type-option" :class="{ active: form.actionType === 'game' }" @click="setActionType('game')">
                    <i class="el-icon-trophy"></i>
                    <span>Game Card</span>
                </div>
```

Replace the Content Pack selector block so it serves both types with a filtered list:

```html
        <!-- Content Pack / Game Pack Selector -->
        <el-form-item v-if="form.actionType === 'content' || form.actionType === 'game'" :label="form.actionType === 'game' ? 'Game Pack' : 'Content Pack'" prop="contentPackId" class="form-item">
          <el-select v-model="form.contentPackId" :placeholder="form.actionType === 'game' ? 'Select sound-quiz pack' : 'Select content pack'" class="custom-select" filterable clearable>
            <el-option
              v-for="cp in packOptions"
              :key="cp.id"
              :label="`${cp.packCode} - ${cp.name}`"
              :value="cp.id"/>
          </el-select>
          <div v-if="form.actionType === 'game'" class="field-hint">Only packs of type Sound Quiz (Game) are listed. The card downloads the pack onto the toy and launches it.</div>
        </el-form-item>
```

Add a `computed` block (or extend the existing one) in the component:

```js
  computed: {
    // Game cards list only sound-quiz packs; content cards list everything else.
    packOptions() {
      const isGame = this.form.actionType === 'game';
      return (this.contentPacks || []).filter(cp => (cp.contentType === 'sound_quiz') === isGame);
    }
  },
```

In the `'form.actionType'` watcher add a branch:

```js
      } else if (newVal === 'game') {
        this.form.questionPackId = null;
        this.form.cardType = 'game';
      }
```

And in the same watcher's `content` branch, keep `this.form.cardType = null;` as is (a content card stays classified by its pack).

Check: Cards → Add shows four tiles; Game Card lists only sound-quiz packs; saving produces a row with `cardType: 'game'` (visible in the network response of `GET /admin/rfid/card/page`).

- [ ] **Step 2: Reverse-map on edit and label the Cards tab**

In `RfidManagement.vue` at the reverse map (line ~2425):

```js
            if (!form.actionType) {
                form.actionType = form.cardType === 'ai' ? 'ai'
                    : form.cardType === 'game' ? 'game'
                    : (form.questionPackId ? 'qna' : 'content');
            }
```

In the Cards tab "Content Type" column (line ~271), insert a Game tag **before** the `contentPackId` branch:

```html
                                        <el-tag v-if="scope.row.cardType === 'ai'" type="danger" size="small" class="content-badge">
                                            <i class="el-icon-cpu"></i> AI Card
                                        </el-tag>
                                        <el-tag v-else-if="scope.row.cardType === 'game'" type="success" size="small" class="content-badge">
                                            <i class="el-icon-trophy"></i> Game
                                        </el-tag>
                                        <el-tag v-else-if="scope.row.contentPackId" type="warning" size="small" class="content-badge">
```

Check: a game mapping shows "Game", and Edit opens the dialog on the Game Card tile with the pack pre-selected.

- [ ] **Step 3: Colour the tap-analytics tag**

At line ~813:

```html
                                        <el-tag size="small" :type="scope.row.cardType === 'content' ? 'warning' : (scope.row.cardType === 'ai' ? 'danger' : (scope.row.cardType === 'game' ? 'success' : 'info'))">
                                            {{ scope.row.cardType || 'unknown' }}
                                        </el-tag>
```

Check: after a tap of a game card (Task 11 manual test), the Card Analytics tab shows a green `game` tag.

- [ ] **Step 4: Commit**

```bash
git add main/manager-web/src/components/RfidCardDialog.vue main/manager-web/src/views/RfidManagement.vue
git commit -m "feat(dashboard): Game Card mapping tile, sound-quiz pack filter, game tags in cards and tap analytics

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 10: Installer script

**Files:**
- Create: `main/manager-api-node/scripts/install-sound-pack.js`

**Interfaces:**
- Consumes: `isValidAppId` (Task 1); API routes `GET /admin/rfid/content-pack/code/:code`, `POST /admin/rfid/content-pack`, `PUT /admin/rfid/content-pack`, `POST /admin/rfid/content-pack/upload` (Task 5 `purpose`), `GET /admin/rfid/card/uid/:uid`, `POST/PUT /admin/rfid/card`. Auth via `X-Service-Key` like the MCP.
- Env: `CHEEKO_API` (e.g. `http://localhost:8002/toy`), `SERVICE_SECRET_KEY`.

- [ ] **Step 1: Write the script**

```js
// main/manager-api-node/scripts/install-sound-pack.js
// Install a sound-quiz game pack from a Phase 1 pack folder through the API.
//
//   node scripts/install-sound-pack.js <folder> [--uid <RFID_UID>] [--apply]
//
// The folder is the one the firmware plays from the SD card: manifest.jsn plus
// the sounds and icons it names. One content_item row is made per manifest
// round: Sound = the correct option's label, Prompt, wrong answers = the other
// two labels, File and Icon = the correct option's files. Dry-run by default.
//
// Goes through the REST API rather than SQL so the same save path that the
// dashboard uses derives content_hash, bumps version and rewrites manifest.jsn.
// Needs CHEEKO_API and SERVICE_SECRET_KEY, same as the MCP.
'use strict';
const fs = require('fs');
const path = require('path');
require('dotenv').config();
const { isValidAppId } = require('../src/services/soundQuiz');

const args = process.argv.slice(2);
const folder = args.find((a) => !a.startsWith('--'));
const APPLY = args.includes('--apply');
const uidIdx = args.indexOf('--uid');
const UID = uidIdx !== -1 ? String(args[uidIdx + 1] || '').toUpperCase().replace(/[:-]/g, '') : null;
if (!folder) { console.error('usage: node scripts/install-sound-pack.js <folder> [--uid <RFID_UID>] [--apply]'); process.exit(1); }

const BASE = (process.env.CHEEKO_API || '').replace(/\/$/, '');
const KEY = process.env.SERVICE_SECRET_KEY;
if (APPLY && (!BASE || !KEY)) { console.error('CHEEKO_API and SERVICE_SECRET_KEY are required with --apply'); process.exit(1); }

const MIME = { '.mp3': 'audio/mpeg', '.png': 'image/png' };
const titleCase = (label) => { const s = String(label || '').trim().toLowerCase(); return s.charAt(0).toUpperCase() + s.slice(1); };

async function api(route, { method = 'GET', body, form } = {}) {
  const res = await fetch(`${BASE}${route}`, {
    method,
    headers: { 'X-Service-Key': KEY, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: form || (body ? JSON.stringify(body) : undefined),
  });
  const json = await res.json().catch(() => ({ code: res.status, msg: res.statusText }));
  if (!res.ok || json.code !== 0) throw new Error(`${method} ${route} -> ${json.code}: ${json.msg}`);
  return json.data;
}

async function upload(packCode, file) {
  const ext = path.extname(file).toLowerCase();
  const form = new FormData();
  form.append('file', new Blob([fs.readFileSync(file)], { type: MIME[ext] }), path.basename(file));
  form.append('purpose', 'game_asset');
  form.append('packCode', packCode);
  form.append('category', `apps/${packCode}`);
  return (await api('/admin/rfid/content-pack/upload', { method: 'POST', form })).url;
}

(async () => {
  // ---- read + validate the folder
  const manifestPath = path.join(folder, 'manifest.jsn');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const packCode = String(manifest.app_id || path.basename(folder)).toLowerCase();
  const errors = [];
  if (manifest.template !== 'sound_quiz') errors.push(`template is "${manifest.template}", expected sound_quiz`);
  if (!isValidAppId(packCode)) errors.push(`app_id "${packCode}" must be 1-8 chars of a-z 0-9 _ -`);
  const rounds = (manifest.rounds || manifest.questions || []).map((r, i) => {
    const opts = r.options || r.answers || [];
    const correct = opts[r.correct];
    if (!r.prompt) errors.push(`round ${i + 1}: missing prompt`);
    if (!correct || typeof correct !== 'object') errors.push(`round ${i + 1}: correct index ${r.correct} out of range`);
    const others = opts.filter((_, k) => k !== r.correct).map((o) => titleCase(o.label));
    if (others.length !== 2) errors.push(`round ${i + 1}: needs 3 options, got ${opts.length}`);
    const soundFile = path.join(folder, r.sound || '');
    const iconFile = path.join(folder, (correct && correct.icon) || '');
    if (!r.sound || !fs.existsSync(soundFile)) errors.push(`round ${i + 1}: sound file "${r.sound}" missing`);
    if (!correct || !correct.icon || !fs.existsSync(iconFile)) errors.push(`round ${i + 1}: icon "${correct && correct.icon}" missing`);
    return { title: titleCase(correct && correct.label), prompt: r.prompt, distractors: others.join(','), soundFile, iconFile };
  });
  if (rounds.length < 2 || rounds.length > 16) errors.push(`pack has ${rounds.length} rounds; need 2-16`);
  // Every wrong answer must be another round's Sound, or the manifest builder drops the round.
  const titles = new Set(rounds.map((r) => r.title.toUpperCase()));
  rounds.forEach((r, i) => r.distractors.split(',').forEach((d) => {
    if (!titles.has(d.toUpperCase())) errors.push(`round ${i + 1}: wrong answer "${d}" is not a round in this pack`);
  }));

  console.log(`pack ${packCode} "${manifest.name}" — ${rounds.length} rounds, ${rounds.length * 2} files`);
  console.log('Sound | Prompt | File | Icon | Wrong answers');
  for (const r of rounds) console.log(`${r.title} | ${r.prompt} | ${path.basename(r.soundFile)} | ${path.basename(r.iconFile)} | ${r.distractors}`);
  if (errors.length) { console.error('\nERRORS:\n  ' + errors.join('\n  ')); process.exit(1); }
  if (!APPLY) { console.log('\nDRY RUN ONLY - rerun with --apply' + (UID ? ` (will map card ${UID})` : '')); return; }

  // ---- create or find the pack
  let pack = await api(`/admin/rfid/content-pack/code/${encodeURIComponent(packCode)}`).catch(() => null);
  if (!pack) {
    await api('/admin/rfid/content-pack', { method: 'POST', body: { packCode, name: manifest.name || packCode, contentType: 'sound_quiz', language: 'en', status: 'active', active: true } });
    pack = await api(`/admin/rfid/content-pack/code/${encodeURIComponent(packCode)}`);
    console.log(`created pack id=${pack.id}`);
  } else {
    console.log(`updating pack id=${pack.id} (v${pack.version})`);
  }

  // ---- upload every file, then save the rows (one PUT so version bumps once)
  const items = [];
  for (const [i, r] of rounds.entries()) {
    const audioUrl = await upload(packCode, r.soundFile);
    const imageUrl = await upload(packCode, r.iconFile);
    console.log(`  ${i + 1}/${rounds.length} ${r.title}: uploaded`);
    items.push({ itemNumber: i + 1, title: r.title, text: r.prompt, description: r.distractors, audioUrl, imageUrl });
  }
  await api('/admin/rfid/content-pack', { method: 'PUT', body: { id: pack.id, contentType: 'sound_quiz', name: manifest.name || packCode, items } });
  const saved = await api(`/admin/rfid/content-pack/code/${encodeURIComponent(packCode)}`);
  console.log(`saved pack ${packCode} v${saved.version} hash=${saved.contentHash}`);

  // ---- map the card
  if (UID) {
    const existing = await api(`/admin/rfid/card/uid/${encodeURIComponent(UID)}`).catch(() => null);
    const body = { rfidUid: UID, contentPackId: pack.id, cardType: 'game', actionType: null, questionPackId: null, notes: `Game: ${manifest.name || packCode}`, active: true };
    if (existing && existing.id) {
      await api('/admin/rfid/card', { method: 'PUT', body: { id: existing.id, ...body } });
      console.log(`card ${UID}: updated -> game pack ${packCode}`);
    } else {
      await api('/admin/rfid/card', { method: 'POST', body });
      console.log(`card ${UID}: mapped -> game pack ${packCode}`);
    }
  }
  console.log('DONE (applied)');
})().catch((e) => { console.error('ERR', e.message); process.exit(1); });
```

- [ ] **Step 2: Dry-run against the firmware repo's pack**

Run:
```bash
cd D:/cheeko-os-v2 && git show origin/integration/settings-onboarding-soundpack:sd_card_assets/cheeko/apps/hometown/manifest.jsn > /dev/null && echo ok
```
If the folder is not checked out locally, export it once:
```bash
cd D:/cheeko-os-v2 && mkdir -p /tmp/hometown && git archive origin/integration/settings-onboarding-soundpack sd_card_assets/cheeko/apps/hometown | tar -x -C /tmp/hometown --strip-components=4
```
Then:
```bash
cd D:/cheeko-backend/main/manager-api-node && node scripts/install-sound-pack.js /tmp/hometown
```
Expected: a 16-line Sound | Prompt | File table, `DRY RUN ONLY`, exit 0. If `titleCase` produces a label that is not unique (two rounds with the same correct label), the script reports it under ERRORS — fix the manifest, not the script.

- [ ] **Step 3: Apply on the dev box**

Run (with `CHEEKO_API` and `SERVICE_SECRET_KEY` pointing at dev):
```bash
node scripts/install-sound-pack.js /tmp/hometown --uid <a spare card UID> --apply
```
Expected: `created pack id=…`, 16 upload lines, `saved pack hometown v1 hash=…`, `card … mapped`, `DONE (applied)`. Then `GET /admin/rfid/content-pack/code/hometown` shows 16 items with `description`, and `https://<CLOUDFRONT>/rfidcontent/apps/hometown/manifest.jsn` returns the manifest with 16 rounds.

- [ ] **Step 4: Commit**

```bash
git add main/manager-api-node/scripts/install-sound-pack.js
git commit -m "feat(scripts): install a sound-quiz game pack from a Phase 1 folder through the API

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 11: End-to-end tap and firmware handoff doc

**Files:**
- Create: `main/manager-api-node/docs/sound-quiz-game-card.md`

- [ ] **Step 1: Tap the mapped card with the gateway running against dev**

Watch the gateway log while tapping the card from Task 10 on a toy with no session open, then again with a conversation open.
Expected, both times: a `card_game` line (`🎮 [RFID-ROUTING] Sending card_game: app=hometown, v=1, rounds=16, assets=33` or `📤 [RFID] Sent card_game (app=hometown, …)`), and `rfid_card_tap_log.card_type = 'game'` for the tap (Card Analytics tab shows a green `game` tag). The toy itself does nothing yet — it has no `card_game` handler — which is expected until the firmware work lands.

- [ ] **Step 2: Write the handoff doc**

```markdown
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
```

- [ ] **Step 3: Commit**

```bash
git add main/manager-api-node/docs/sound-quiz-game-card.md
git commit -m "docs: sound-quiz game card contract and firmware handoff

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

- [ ] **Step 4: Full test run before opening the PR**

```bash
cd D:/cheeko-backend/main/manager-api-node && npx jest tests/unit/soundQuiz.builder.test.js tests/unit/rfid.sound-quiz-lookup.test.js tests/unit/rfid.card-type-game.test.js tests/unit/rfid.publish-manifest.test.js tests/unit/rfid.upload-game-asset.test.js tests/unit/customCard.lookup.test.js tests/unit/rfid.preview-route.test.js && npm run test:mcp && cd ../mqtt-gateway && npm test
```
Expected: all green. (The full jest suite hits the shared test DB; run only the unit files above unless you have a scratch database.)

---

## Self-review

**Spec coverage.** §3 contract → Task 6 helper + Task 2 shape. §4 data model → Tasks 2, 8. §5 builder and manifest hosting → Tasks 1, 4. §6 lookup → Task 2. §7 card type → Tasks 3, 9. §8 upload route → Task 5. §9 gateway → Task 6. §10 dashboard → Tasks 8, 9. §11 script → Task 10. §12 MCP → Task 7. §14 verification → per-task tests plus Task 11.

**Placeholders.** None: every code step carries the code; the two manual dashboard checks name what to click and what to see.

**Type consistency.** `buildSoundQuizPack(pack, items, manifestUrl)` → `{ manifest, assets, prompts, warnings }` is used identically in Tasks 2, 4. The lookup shape `{ contentType:'sound_quiz', appId, title, version, contentHash, prompts, assets }` is what `isCardGame`/`buildCardGameMessage` read in Task 6 and what Task 3's `classifyLookupCardType` keys on. `uploadGamePackManifest(packCode, manifest)` matches between Task 4's service and its mock. `purpose=game_asset` is the same string in Tasks 5, 7, 8, 10. `description` = `"A,B"` is written by Task 8/10 and read by Task 1.
