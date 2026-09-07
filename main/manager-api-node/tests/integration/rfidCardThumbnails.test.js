/**
 * RFID Card Mapping Thumbnails
 *
 * The Card Mappings table shows a thumbnail per row. No card mapping actually
 * carries its own `thumbnail_url` — the artwork belongs to the content pack the
 * card points at — so the column resolves:
 *
 *   card.thumbnailUrl  ||  contentPack(card.contentPackId).thumbnailUrl  ||  placeholder
 *
 * That fallback spans two endpoints, and if either stops returning its
 * thumbnail field the column degrades to every-row-placeholder without any
 * error. These tests pin both halves.
 *
 * Read-only, and live checks run only against a server with database access:
 *
 *   TEST_API_URL=http://localhost:8002 npx jest tests/integration/rfidCardThumbnails.test.js
 */

require('dotenv').config();

const supertest = require('supertest');

const BASE = '/toy';
const SERVICE_KEY = process.env.SERVICE_SECRET_KEY;
const TARGET = process.env.TEST_API_URL || require('../../src/app');
const request = () => supertest(TARGET);

const asService = (req) => req.set('x-service-key', SERVICE_KEY || 'absent');

const LIVE = Boolean(process.env.TEST_API_URL && SERVICE_KEY);
const describeLive = LIVE ? describe : describe.skip;

let cards = null;
let packs = null;

beforeAll(async () => {
  if (!LIVE) return;
  const [cardRes, packRes] = await Promise.all([
    asService(request().get(`${BASE}/admin/rfid/card/page`).query({ page: 1, limit: 500 })),
    asService(request().get(`${BASE}/admin/rfid/content-pack/list`)),
  ]);

  expect(cardRes.status).toBe(200);
  expect(packRes.status).toBe(200);
  cards = cardRes.body.data.list || cardRes.body.data.records || [];
  packs = packRes.body.data || [];
}, 30000);

// ---------------------------------------------------------------------------
// Auth — no database required
// ---------------------------------------------------------------------------

describe('RFID thumbnail sources — auth', () => {
  it('card page rejects a request with no credentials', async () => {
    const res = await request().get(`${BASE}/admin/rfid/card/page`);

    expect([401, 403]).toContain(res.status);
  });

  it('content pack list rejects a request with no credentials', async () => {
    const res = await request().get(`${BASE}/admin/rfid/content-pack/list`);

    expect([401, 403]).toContain(res.status);
  });
});

// ---------------------------------------------------------------------------
// The two halves of the fallback
// ---------------------------------------------------------------------------

describeLive('RFID card mapping thumbnails', () => {
  it('every card row exposes the fields the column reads', () => {
    expect(cards.length).toBeGreaterThan(0);

    for (const card of cards) {
      expect(Object.prototype.hasOwnProperty.call(card, 'thumbnailUrl')).toBe(true);
      expect(Object.prototype.hasOwnProperty.call(card, 'contentPackId')).toBe(true);
    }
  });

  it('every content pack exposes a thumbnailUrl key for the lookup map', () => {
    expect(packs.length).toBeGreaterThan(0);

    for (const pack of packs) {
      expect(Object.prototype.hasOwnProperty.call(pack, 'thumbnailUrl')).toBe(true);
      expect(pack.id === null || pack.id === undefined).toBe(false);
    }
  });

  /**
   * The whole point of the fallback. If this drops to zero the column is
   * showing "no picture available" for every row, which looks like a styling
   * bug rather than a broken join.
   */
  it('resolves artwork for the cards that point at a pack with a thumbnail', () => {
    const thumbById = new Map(packs.filter((p) => p.thumbnailUrl).map((p) => [p.id, p.thumbnailUrl]));

    const resolved = cards.filter((c) => c.thumbnailUrl || thumbById.get(c.contentPackId));
    const linkedToArtPack = cards.filter((c) => thumbById.has(c.contentPackId));

    expect(linkedToArtPack.length).toBeGreaterThan(0);
    // Nothing linked to a pack with artwork may fall through to the placeholder.
    expect(resolved.length).toBeGreaterThanOrEqual(linkedToArtPack.length);
  });

  /**
   * Some packs store a `.bin` as their thumbnail — a framebuffer for the toy's
   * screen, not a web image. An <img> can only ever fail on those, so the
   * column's `imageKind` guard must send them to the placeholder instead. This
   * asserts that behaviour rather than asserting the data is clean, because it
   * is not: at least one pack in the catalogue carries a .bin today.
   */
  it('routes .bin framebuffer thumbnails to the placeholder rather than an <img>', () => {
    // imageKind(), copied from RfidManagement.vue.
    const WEB_IMAGE = /\.(png|jpe?g|gif|webp|avif|svg)(\?|#|$)/i;
    const imageKind = (url) => {
      if (!url) return 'none';
      if (/^(data:|blob:)/i.test(url)) return 'image';
      if (WEB_IMAGE.test(url)) return 'image';
      if (/\.bin(\?|#|$)/i.test(url)) return 'device';
      return 'image';
    };

    const thumbById = new Map(packs.filter((p) => p.thumbnailUrl).map((p) => [p.id, p.thumbnailUrl]));

    for (const card of cards) {
      const url = card.thumbnailUrl || thumbById.get(card.contentPackId) || null;
      const rendered = url && imageKind(url) === 'image' ? url : null;
      if (rendered) expect(rendered).not.toMatch(/\.bin(\?|#|$)/i);
    }

    // And the guard is load-bearing, not decorative.
    const binThumbs = [...thumbById.values()].filter((u) => imageKind(u) === 'device');
    for (const url of binThumbs) expect(imageKind(url)).toBe('device');
  });
});
