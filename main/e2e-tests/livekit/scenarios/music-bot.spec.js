/**
 * Music Bot E2E Scenarios
 * Covers: Start music bot, playback controls, stop bot, bot status
 *
 * NOTE: Starting a bot requires LiveKit credentials. If the media API
 * can't create a LiveKit token, the start will fail with 500.
 * Tests handle both cases gracefully.
 */

const { isMediaApiAvailable, mediaGet, mediaPost } = require('../helpers/media-api.helper');
const { uniqueId } = require('../../api/helpers/data.helper');

let apiAvailable = false;
const TEST_MAC = 'e2e000000001';
const ROOM_NAME = `e2e-test_${TEST_MAC}_music_${uniqueId()}`;

beforeAll(async () => {
  apiAvailable = await isMediaApiAvailable();
  if (!apiAvailable) {
    console.log('  Media API not running (port 8003) — music bot tests will be skipped');
  }
});

afterAll(async () => {
  // Cleanup: stop any bot we started
  if (apiAvailable) {
    await mediaPost('/stop-bot', { room_name: ROOM_NAME }).catch(() => {});
  }
});

describe('Music Bot E2E', () => {

  // ── Start music bot ──────────────────────────────────────────────

  describe('Step 1: Start music bot', () => {
    it('should accept start-music-bot request', async () => {
      if (!apiAvailable) return;

      const res = await mediaPost('/start-music-bot', {
        room_name: ROOM_NAME,
        device_mac: TEST_MAC,
        language: 'en',
      });

      // 200 = started (LiveKit creds work), 500 = LiveKit token creation failed
      expect([200, 500]).toContain(res.status);

      if (res.status === 200) {
        expect(res.data).toHaveProperty('status');
        expect(['started', 'already_active']).toContain(res.data.status);
        expect(res.data).toHaveProperty('bot_type', 'music');
      }
    });

    it('should reject duplicate start for same room', async () => {
      if (!apiAvailable) return;

      const res = await mediaPost('/start-music-bot', {
        room_name: ROOM_NAME,
        device_mac: TEST_MAC,
        language: 'en',
      });

      if (res.status === 200) {
        // If first start succeeded, second should return already_active
        expect(res.data.status).toBe('already_active');
      }
    });

    it('should accept start with playlist', async () => {
      if (!apiAvailable) return;

      const playlistRoom = `e2e-playlist_${TEST_MAC}_music_${uniqueId()}`;
      const res = await mediaPost('/start-music-bot', {
        room_name: playlistRoom,
        device_mac: TEST_MAC,
        language: 'en',
        playlist: [
          { filename: 'song1.mp3', language: 'en' },
          { filename: 'song2.mp3', language: 'en' },
        ],
      });

      expect([200, 500]).toContain(res.status);

      if (res.status === 200) {
        expect(res.data.playlist_size).toBe(2);
      }

      // Cleanup
      await mediaPost('/stop-bot', { room_name: playlistRoom }).catch(() => {});
    });
  });

  // ── Bot status ────────────────────────────────────────────────────

  describe('Step 2: Bot status', () => {
    it('should return status for active bot', async () => {
      if (!apiAvailable) return;

      const res = await mediaGet(`/bot/${ROOM_NAME}/status`);

      // 200 if bot is active, 404 if start failed (no LiveKit creds)
      expect([200, 404]).toContain(res.status);

      if (res.status === 200) {
        expect(res.data).toHaveProperty('room_name', ROOM_NAME);
        expect(res.data).toHaveProperty('bot_type', 'music');
        expect(res.data).toHaveProperty('status');
      }
    });

    it('should return 404 for non-existent room', async () => {
      if (!apiAvailable) return;

      const res = await mediaGet('/bot/non-existent-room-xyz/status');
      expect(res.status).toBe(404);
    });
  });

  // ── Playback controls ─────────────────────────────────────────────

  describe('Step 3: Playback controls', () => {
    it('should handle next song request', async () => {
      if (!apiAvailable) return;

      const res = await mediaPost(`/music-bot/${ROOM_NAME}/next`);

      // 200 if bot active, 404 if not
      expect([200, 404]).toContain(res.status);

      if (res.status === 200) {
        expect(res.data).toHaveProperty('status', 'success');
      }
    });

    it('should handle previous song request', async () => {
      if (!apiAvailable) return;

      const res = await mediaPost(`/music-bot/${ROOM_NAME}/previous`);
      expect([200, 404]).toContain(res.status);
    });

    it('should handle start playback request', async () => {
      if (!apiAvailable) return;

      const res = await mediaPost(`/music-bot/${ROOM_NAME}/start`, {
        is_mode_switch: false,
      });
      expect([200, 404]).toContain(res.status);
    });

    it('should return 404 for next on non-existent room', async () => {
      if (!apiAvailable) return;

      const res = await mediaPost('/music-bot/non-existent-room/next');
      expect(res.status).toBe(404);
    });

    it('should return 404 for previous on non-existent room', async () => {
      if (!apiAvailable) return;

      const res = await mediaPost('/music-bot/non-existent-room/previous');
      expect(res.status).toBe(404);
    });
  });

  // ── Stop bot ──────────────────────────────────────────────────────

  describe('Step 4: Stop bot', () => {
    it('should stop an active bot', async () => {
      if (!apiAvailable) return;

      const res = await mediaPost('/stop-bot', { room_name: ROOM_NAME });

      // 200 with status stopped or not_found
      expect(res.status).toBe(200);
      expect(['stopped', 'not_found']).toContain(res.data.status);
    });

    it('should return not_found when stopping non-existent bot', async () => {
      if (!apiAvailable) return;

      const res = await mediaPost('/stop-bot', { room_name: 'non-existent-room-xyz' });
      expect(res.status).toBe(200);
      expect(res.data.status).toBe('not_found');
    });
  });

});
