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
    for (const a of assets) expect(a.name).toMatch(/^[a-z0-9]{1,8}\.[a-z0-9]{3}$/);

    // Prompts: Sound | Prompt | File
    expect(prompts).toEqual([
      { sound: 'Doorbell', prompt: 'DING-DONG?', file: 'doorbell.mp3' },
      { sound: 'Phone', prompt: 'RING?', file: 'phone.mp3' },
      { sound: 'Clock', prompt: 'TICK-TOCK?', file: 'clock.mp3' }
    ]);

    const assetNames = new Set(assets.map((a) => a.name));
    for (const r of manifest.rounds) for (const o of r.options) expect(assetNames.has(o.icon)).toBe(true);
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

    // Fan's wrong answers are Phone and Clock, both dropped rounds — their
    // icons must still ship, or the tile has nothing to draw.
    const { assets } = buildSoundQuizPack(PACK, items, MANIFEST_URL);
    const names = assets.map((a) => a.name);
    expect(names).toEqual(expect.arrayContaining(['fan.mp3', 'fan.png', 'phone.png', 'clock.png']));
    expect(names).not.toContain('phone.mp3');
    expect(names).not.toContain('clock.mp3');
    expect(names).not.toContain('doorbell.png');
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
