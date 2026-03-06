/**
 * Media API Error Handling E2E Scenarios
 * Covers: Missing fields, invalid payloads, wrong bot types, concurrent requests
 */

const { isMediaApiAvailable, mediaGet, mediaPost } = require('../helpers/media-api.helper');
const { uniqueId } = require('../../api/helpers/data.helper');

let apiAvailable = false;

beforeAll(async () => {
  apiAvailable = await isMediaApiAvailable();
  if (!apiAvailable) {
    console.log('  Media API not running (port 8003) — error handling tests will be skipped');
  }
});

describe('Media API Error Handling E2E', () => {

  // ── Missing required fields ────────────────────────────────────────

  describe('Missing required fields', () => {
    it('should reject start-music-bot without room_name', async () => {
      if (!apiAvailable) return;

      const res = await mediaPost('/start-music-bot', {
        device_mac: 'e2e000000099',
      });

      // FastAPI validation returns 422 for missing required fields
      expect(res.status).toBe(422);
    });

    it('should reject start-music-bot without device_mac', async () => {
      if (!apiAvailable) return;

      const res = await mediaPost('/start-music-bot', {
        room_name: 'test-room',
      });

      expect(res.status).toBe(422);
    });

    it('should reject start-story-bot without room_name', async () => {
      if (!apiAvailable) return;

      const res = await mediaPost('/start-story-bot', {
        device_mac: 'e2e000000099',
      });

      expect(res.status).toBe(422);
    });

    it('should reject stop-bot without room_name', async () => {
      if (!apiAvailable) return;

      const res = await mediaPost('/stop-bot', {});
      expect(res.status).toBe(422);
    });
  });

  // ── Empty body ─────────────────────────────────────────────────────

  describe('Empty request body', () => {
    it('should reject start-music-bot with empty body', async () => {
      if (!apiAvailable) return;

      const res = await mediaPost('/start-music-bot', {});
      expect(res.status).toBe(422);
    });

    it('should reject start-story-bot with empty body', async () => {
      if (!apiAvailable) return;

      const res = await mediaPost('/start-story-bot', {});
      expect(res.status).toBe(422);
    });
  });

  // ── Wrong bot type for control endpoints ───────────────────────────

  describe('Wrong bot type on control endpoints', () => {
    const STORY_ROOM = `e2e-wrongtype_e2e000000003_story_${uniqueId()}`;
    let storyStarted = false;

    beforeAll(async () => {
      if (!apiAvailable) return;

      const res = await mediaPost('/start-story-bot', {
        room_name: STORY_ROOM,
        device_mac: 'e2e000000003',
      });
      storyStarted = res.status === 200 && res.data?.status === 'started';
    });

    afterAll(async () => {
      if (apiAvailable) {
        await mediaPost('/stop-bot', { room_name: STORY_ROOM }).catch(() => {});
      }
    });

    it('should reject music-bot controls on a story bot room', async () => {
      if (!apiAvailable || !storyStarted) return;

      const res = await mediaPost(`/music-bot/${STORY_ROOM}/next`);
      // Should be 400 (not a music bot)
      expect(res.status).toBe(400);
    });
  });

  // ── Non-existent endpoints ─────────────────────────────────────────

  describe('Non-existent endpoints', () => {
    it('should return 404 or 405 for unknown routes', async () => {
      if (!apiAvailable) return;

      const res = await mediaGet('/unknown-endpoint');
      expect([404, 405]).toContain(res.status);
    });
  });

  // ── Concurrent requests ────────────────────────────────────────────

  describe('Concurrent requests', () => {
    it('should handle multiple simultaneous health checks', async () => {
      if (!apiAvailable) return;

      const promises = Array(5).fill(null).map(() => mediaGet('/health'));
      const results = await Promise.allSettled(promises);
      const fulfilled = results.filter(r => r.status === 'fulfilled');
      expect(fulfilled.length).toBe(5);

      for (const r of fulfilled) {
        expect(r.value.status).toBe(200);
      }
    });

    it('should handle concurrent stop requests for same non-existent room', async () => {
      if (!apiAvailable) return;

      const room = 'concurrent-test-room';
      const promises = Array(3).fill(null).map(() =>
        mediaPost('/stop-bot', { room_name: room })
      );
      const results = await Promise.allSettled(promises);
      const fulfilled = results.filter(r => r.status === 'fulfilled');

      // All should return 200 with not_found
      for (const r of fulfilled) {
        expect(r.value.status).toBe(200);
        expect(r.value.data.status).toBe('not_found');
      }
    });
  });

  // ── Bot status edge cases ──────────────────────────────────────────

  describe('Bot status edge cases', () => {
    it('should return 404 for status of non-existent room', async () => {
      if (!apiAvailable) return;

      const res = await mediaGet('/bot/does-not-exist/status');
      expect(res.status).toBe(404);
    });

    it('should return 404 for status with empty room name', async () => {
      if (!apiAvailable) return;

      const res = await mediaGet('/bot//status');
      // FastAPI may return 404 or 307 for double slash
      expect([307, 404]).toContain(res.status);
    });
  });

});
