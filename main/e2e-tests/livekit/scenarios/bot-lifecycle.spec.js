/**
 * Bot Lifecycle E2E Scenarios
 * Covers: Full lifecycle — start bot -> check status -> controls -> stop -> verify stopped
 *
 * This is the cross-cutting scenario that tests music and story bots
 * through their complete lifecycle in sequence.
 */

const { isMediaApiAvailable, mediaGet, mediaPost } = require('../helpers/media-api.helper');
const { uniqueId } = require('../../api/helpers/data.helper');

let apiAvailable = false;
let livekitWorking = false;

const TEST_MAC = 'e2e000000005';
const MUSIC_ROOM = `e2e-lifecycle_${TEST_MAC}_music_${uniqueId()}`;
const STORY_ROOM = `e2e-lifecycle_${TEST_MAC}_story_${uniqueId()}`;

beforeAll(async () => {
  apiAvailable = await isMediaApiAvailable();
  if (!apiAvailable) {
    console.log('  Media API not running (port 8003) — lifecycle tests will be skipped');
    return;
  }

  // Probe if LiveKit token creation works by attempting a start
  const probeRoom = `e2e-probe_${TEST_MAC}_music_${uniqueId()}`;
  const res = await mediaPost('/start-music-bot', {
    room_name: probeRoom,
    device_mac: TEST_MAC,
  });
  livekitWorking = res.status === 200;
  await mediaPost('/stop-bot', { room_name: probeRoom }).catch(() => {});

  if (!livekitWorking) {
    console.log('  LiveKit credentials not configured — lifecycle tests will be skipped');
  }
});

afterAll(async () => {
  if (apiAvailable) {
    await mediaPost('/stop-bot', { room_name: MUSIC_ROOM }).catch(() => {});
    await mediaPost('/stop-bot', { room_name: STORY_ROOM }).catch(() => {});
  }
});

describe('Bot Lifecycle E2E', () => {

  // ── Full music bot lifecycle ───────────────────────────────────────

  describe('Music bot full lifecycle', () => {
    it('Step 1: Start music bot', async () => {
      if (!apiAvailable || !livekitWorking) return;

      const res = await mediaPost('/start-music-bot', {
        room_name: MUSIC_ROOM,
        device_mac: TEST_MAC,
        language: 'en',
        playlist: [
          { filename: 'test1.mp3', language: 'en' },
          { filename: 'test2.mp3', language: 'en' },
        ],
      });

      expect(res.status).toBe(200);
      expect(res.data.status).toBe('started');
      expect(res.data.bot_type).toBe('music');
      expect(res.data.playlist_size).toBe(2);
    });

    it('Step 2: Verify bot is active', async () => {
      if (!apiAvailable || !livekitWorking) return;

      const res = await mediaGet(`/bot/${MUSIC_ROOM}/status`);
      expect(res.status).toBe(200);
      expect(res.data.bot_type).toBe('music');
    });

    it('Step 3: Trigger start playback', async () => {
      if (!apiAvailable || !livekitWorking) return;

      const res = await mediaPost(`/music-bot/${MUSIC_ROOM}/start`, {
        is_mode_switch: false,
      });
      expect(res.status).toBe(200);
    });

    it('Step 4: Skip to next song', async () => {
      if (!apiAvailable || !livekitWorking) return;

      const res = await mediaPost(`/music-bot/${MUSIC_ROOM}/next`);
      expect(res.status).toBe(200);
      expect(res.data.status).toBe('success');
    });

    it('Step 5: Skip to previous song', async () => {
      if (!apiAvailable || !livekitWorking) return;

      const res = await mediaPost(`/music-bot/${MUSIC_ROOM}/previous`);
      expect(res.status).toBe(200);
      expect(res.data.status).toBe('success');
    });

    it('Step 6: Stop music bot', async () => {
      if (!apiAvailable || !livekitWorking) return;

      const res = await mediaPost('/stop-bot', { room_name: MUSIC_ROOM });
      expect(res.status).toBe(200);
      expect(res.data.status).toBe('stopped');
    });

    it('Step 7: Verify bot is stopped', async () => {
      if (!apiAvailable || !livekitWorking) return;

      const res = await mediaGet(`/bot/${MUSIC_ROOM}/status`);
      expect(res.status).toBe(404);
    });
  });

  // ── Full story bot lifecycle ───────────────────────────────────────

  describe('Story bot full lifecycle', () => {
    it('Step 1: Start story bot', async () => {
      if (!apiAvailable || !livekitWorking) return;

      const res = await mediaPost('/start-story-bot', {
        room_name: STORY_ROOM,
        device_mac: TEST_MAC,
        age_group: '3-6',
        playlist: [
          { filename: 'story1.mp3', category: 'adventure' },
        ],
      });

      expect(res.status).toBe(200);
      expect(res.data.status).toBe('started');
      expect(res.data.bot_type).toBe('story');
    });

    it('Step 2: Verify story bot is active', async () => {
      if (!apiAvailable || !livekitWorking) return;

      const res = await mediaGet(`/bot/${STORY_ROOM}/status`);
      expect(res.status).toBe(200);
      expect(res.data.bot_type).toBe('story');
    });

    it('Step 3: Trigger start playback', async () => {
      if (!apiAvailable || !livekitWorking) return;

      const res = await mediaPost(`/story-bot/${STORY_ROOM}/start`, {
        is_mode_switch: false,
      });
      expect(res.status).toBe(200);
    });

    it('Step 4: Stop story bot', async () => {
      if (!apiAvailable || !livekitWorking) return;

      const res = await mediaPost('/stop-bot', { room_name: STORY_ROOM });
      expect(res.status).toBe(200);
      expect(res.data.status).toBe('stopped');
    });

    it('Step 5: Verify story bot is stopped', async () => {
      if (!apiAvailable || !livekitWorking) return;

      const res = await mediaGet(`/bot/${STORY_ROOM}/status`);
      expect(res.status).toBe(404);
    });
  });

  // ── Health after lifecycle ─────────────────────────────────────────

  describe('Post-lifecycle health', () => {
    it('should report healthy after all lifecycle operations', async () => {
      if (!apiAvailable) return;

      const res = await mediaGet('/health');
      expect(res.status).toBe(200);
      expect(res.data.status).toBe('healthy');
    });
  });

});
