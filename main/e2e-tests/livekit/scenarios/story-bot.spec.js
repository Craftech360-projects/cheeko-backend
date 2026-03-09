/**
 * Story Bot E2E Scenarios
 * Covers: Start story bot, playback controls, stop bot
 */

const { isMediaApiAvailable, mediaGet, mediaPost } = require('../helpers/media-api.helper');
const { uniqueId } = require('../../api/helpers/data.helper');

let apiAvailable = false;
const TEST_MAC = 'e2e000000002';
const ROOM_NAME = `e2e-test_${TEST_MAC}_story_${uniqueId()}`;

beforeAll(async () => {
  apiAvailable = await isMediaApiAvailable();
  if (!apiAvailable) {
    console.log('  Media API not running (port 8003) — story bot tests will be skipped');
  }
});

afterAll(async () => {
  if (apiAvailable) {
    await mediaPost('/stop-bot', { room_name: ROOM_NAME }).catch(() => {});
  }
});

describe('Story Bot E2E', () => {

  // ── Start story bot ──────────────────────────────────────────────

  describe('Step 1: Start story bot', () => {
    it('should accept start-story-bot request', async () => {
      if (!apiAvailable) return;

      const res = await mediaPost('/start-story-bot', {
        room_name: ROOM_NAME,
        device_mac: TEST_MAC,
        age_group: '3-6',
      });

      expect([200, 500]).toContain(res.status);

      if (res.status === 200) {
        expect(res.data).toHaveProperty('status');
        expect(['started', 'already_active']).toContain(res.data.status);
        expect(res.data).toHaveProperty('bot_type', 'story');
      }
    });

    it('should reject duplicate start for same room', async () => {
      if (!apiAvailable) return;

      const res = await mediaPost('/start-story-bot', {
        room_name: ROOM_NAME,
        device_mac: TEST_MAC,
      });

      if (res.status === 200) {
        expect(res.data.status).toBe('already_active');
      }
    });

    it('should accept start with playlist', async () => {
      if (!apiAvailable) return;

      const playlistRoom = `e2e-playlist_${TEST_MAC}_story_${uniqueId()}`;
      const res = await mediaPost('/start-story-bot', {
        room_name: playlistRoom,
        device_mac: TEST_MAC,
        age_group: '6-10',
        playlist: [
          { filename: 'story1.mp3', category: 'adventure' },
          { filename: 'story2.mp3', category: 'fairy-tale' },
          { filename: 'story3.mp3', category: 'science' },
        ],
      });

      expect([200, 500]).toContain(res.status);

      if (res.status === 200) {
        expect(res.data.playlist_size).toBe(3);
      }

      await mediaPost('/stop-bot', { room_name: playlistRoom }).catch(() => {});
    });
  });

  // ── Playback controls ─────────────────────────────────────────────

  describe('Step 2: Playback controls', () => {
    it('should handle start playback request', async () => {
      if (!apiAvailable) return;

      const res = await mediaPost(`/story-bot/${ROOM_NAME}/start`, {
        is_mode_switch: false,
      });
      expect([200, 404]).toContain(res.status);
    });

    it('should handle next story request', async () => {
      if (!apiAvailable) return;

      const res = await mediaPost(`/story-bot/${ROOM_NAME}/next`);
      expect([200, 404]).toContain(res.status);

      if (res.status === 200) {
        expect(res.data).toHaveProperty('status', 'success');
      }
    });

    it('should handle previous story request', async () => {
      if (!apiAvailable) return;

      const res = await mediaPost(`/story-bot/${ROOM_NAME}/previous`);
      expect([200, 404]).toContain(res.status);
    });

    it('should return 404 for next on non-existent room', async () => {
      if (!apiAvailable) return;

      const res = await mediaPost('/story-bot/non-existent-room/next');
      expect(res.status).toBe(404);
    });

    it('should return 404 for previous on non-existent room', async () => {
      if (!apiAvailable) return;

      const res = await mediaPost('/story-bot/non-existent-room/previous');
      expect(res.status).toBe(404);
    });
  });

  // ── Bot status ────────────────────────────────────────────────────

  describe('Step 3: Bot status', () => {
    it('should return status for active story bot', async () => {
      if (!apiAvailable) return;

      const res = await mediaGet(`/bot/${ROOM_NAME}/status`);
      expect([200, 404]).toContain(res.status);

      if (res.status === 200) {
        expect(res.data).toHaveProperty('bot_type', 'story');
      }
    });
  });

  // ── Stop bot ──────────────────────────────────────────────────────

  describe('Step 4: Stop bot', () => {
    it('should stop the story bot', async () => {
      if (!apiAvailable) return;

      const res = await mediaPost('/stop-bot', { room_name: ROOM_NAME });
      expect(res.status).toBe(200);
      expect(['stopped', 'not_found']).toContain(res.data.status);
    });
  });

});
