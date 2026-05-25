'use strict';

jest.mock('../../src/config/database', () => ({
  prisma: {
    device_analytics_event: {
      findFirst: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
    },
    ai_device: {
      findUnique: jest.fn(),
    },
    parent_profile: {
      findUnique: jest.fn(),
    },
    device_card_taps_daily: {
      upsert: jest.fn(),
    },
    device_ai_interactions_daily: {
      upsert: jest.fn(),
    },
    device_usage_daily: {
      upsert: jest.fn(),
    },
    device_games_played: {
      upsert: jest.fn(),
      findFirst: jest.fn(),
      update: jest.fn(),
    },
    device_radio_played: {
      upsert: jest.fn(),
    },
  },
}));

const { prisma } = require('../../src/config/database');
const deviceAnalyticsService = require('../../src/services/deviceAnalytics.service');

function buildPayload(overrides = {}) {
  return {
    type: 'analytics_event',
    device_id: 'fc:01:2c:cf:eb:54',
    event_id: 'evt_ld_1115284639',
    event: 'content_start',
    seq: 2,
    timestamp: 1779357379,
    data: {
      rfid_uid: '29994A0E',
      content_id: 'rhymes',
      content_type: 'local_content',
    },
    ...overrides,
  };
}

describe('deviceAnalytics.service ingest collision handling', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    prisma.device_analytics_event.findFirst.mockResolvedValue(null);
    prisma.device_analytics_event.findMany.mockResolvedValue([]);
    prisma.ai_device.findUnique.mockResolvedValue(null);
    prisma.parent_profile.findUnique.mockResolvedValue(null);
    prisma.device_games_played.findFirst.mockResolvedValue(null);
  });

  it('stores raw event_id directly when unique', async () => {
    prisma.device_analytics_event.create.mockImplementation(async ({ data }) => ({
      id: 'raw-row-1',
      server_received_at: new Date('2026-05-21T09:56:19.000Z'),
      ...data,
    }));

    const result = await deviceAnalyticsService.ingestFirmwareAnalyticsEvent({
      mac_address: 'FC:01:2C:CF:EB:54',
      payload: buildPayload(),
    });

    expect(prisma.device_analytics_event.create).toHaveBeenCalledTimes(1);
    expect(prisma.device_analytics_event.create.mock.calls[0][0].data.event_id).toBe('evt_ld_1115284639');
    expect(result.accepted).toBe(true);
    expect(result.deduplicated).toBe(false);
    expect(result.event_id_collision_handled).toBe(false);
    expect(result.stored_event_key).toBe('evt_ld_1115284639');
  });

  it('stores with derived event_id when raw event_id collides', async () => {
    prisma.device_analytics_event.findFirst
      .mockResolvedValueOnce({ id: 'existing-raw' })
      .mockResolvedValueOnce(null);
    prisma.device_analytics_event.create
      .mockImplementationOnce(async ({ data }) => ({
        id: 'derived-row-1',
        server_received_at: new Date('2026-05-21T09:56:20.000Z'),
        ...data,
      }));

    const result = await deviceAnalyticsService.ingestFirmwareAnalyticsEvent({
      mac_address: 'FC:01:2C:CF:EB:54',
      payload: buildPayload(),
    });

    expect(prisma.device_analytics_event.create).toHaveBeenCalledTimes(1);
    const storedEventId = prisma.device_analytics_event.create.mock.calls[0][0].data.event_id;
    expect(storedEventId).toMatch(/^evt_ld_1115284639::[a-f0-9]{12}$/);
    expect(result.accepted).toBe(true);
    expect(result.deduplicated).toBe(false);
    expect(result.event_id_collision_handled).toBe(true);
    expect(result.original_event_id).toBe('evt_ld_1115284639');
    expect(result.stored_event_key).toBe(storedEventId);
  });

  it('marks deduplicated when raw and derived ids both already exist', async () => {
    prisma.device_analytics_event.findFirst
      .mockResolvedValueOnce({ id: 'existing-raw' })
      .mockResolvedValueOnce({ id: 'existing-derived' });

    const result = await deviceAnalyticsService.ingestFirmwareAnalyticsEvent({
      mac_address: 'FC:01:2C:CF:EB:54',
      payload: buildPayload(),
    });

    expect(prisma.device_analytics_event.create).toHaveBeenCalledTimes(0);
    expect(result.accepted).toBe(true);
    expect(result.deduplicated).toBe(true);
    expect(result.stored_event_id).toBeNull();
    expect(result.original_event_id).toBe('evt_ld_1115284639');
    expect(result.stored_event_key).toMatch(/^evt_ld_1115284639::[a-f0-9]{12}$/);
  });

  it('projects game_start into device_games_played', async () => {
    prisma.device_analytics_event.create.mockImplementation(async ({ data }) => ({
      id: 'raw-game-start-1',
      server_received_at: new Date('2026-05-21T09:56:19.000Z'),
      ...data,
    }));

    await deviceAnalyticsService.ingestFirmwareAnalyticsEvent({
      mac_address: 'FC:01:2C:CF:EB:54',
      payload: buildPayload({
        event_id: 'game-start-1',
        event: 'game_start',
        data: {
          game_id: 'animal_match',
          game_name: 'Animal Match',
          level: '1',
        },
      }),
    });

    expect(prisma.device_games_played.upsert).toHaveBeenCalledWith({
      where: { source_device_event_pk: 'raw-game-start-1' },
      create: expect.objectContaining({
        mac_address: 'FC:01:2C:CF:EB:54',
        game_id: 'animal_match',
        game_name: 'Animal Match',
        level: '1',
        duration_ms: null,
        source_device_event_pk: 'raw-game-start-1',
        source_event_id: 'game-start-1',
      }),
      update: expect.objectContaining({
        user_id: null,
        device_id: null,
      }),
    });
  });

  it('updates matching game_start projection when game_end arrives', async () => {
    prisma.device_games_played.findFirst.mockResolvedValue({
      id: 'played-row-1',
      source_device_event_pk: 'raw-game-start-1',
    });
    prisma.device_analytics_event.create.mockImplementation(async ({ data }) => ({
      id: 'raw-game-end-1',
      server_received_at: new Date('2026-05-21T10:01:19.000Z'),
      ...data,
    }));

    await deviceAnalyticsService.ingestFirmwareAnalyticsEvent({
      mac_address: 'FC:01:2C:CF:EB:54',
      payload: buildPayload({
        event_id: 'game-end-1',
        event: 'game_end',
        duration_ms: 300000,
        data: {
          game_id: 'animal_match',
          game_name: 'Animal Match',
          score: 84,
          difficulty: 'easy',
        },
      }),
    });

    expect(prisma.device_games_played.findFirst).toHaveBeenCalled();
    expect(prisma.device_games_played.update).toHaveBeenCalledWith({
      where: { id: 'played-row-1' },
      data: expect.objectContaining({
        game_name: 'Animal Match',
        difficulty_level: 'easy',
        score: 84,
        duration_ms: 300000,
        source_event_id: 'game-end-1',
      }),
    });
    expect(prisma.device_games_played.upsert).not.toHaveBeenCalled();
  });

  it('does not increment daily card taps for repeated same-card reads within debounce window', async () => {
    prisma.device_analytics_event.create.mockImplementation(async ({ data }) => ({
      id: data.event_id,
      server_received_at:
        data.event_id === 'card-start-1'
          ? new Date('2026-05-21T09:56:19.000Z')
          : new Date('2026-05-21T09:56:39.000Z'),
      ...data,
    }));
    prisma.device_analytics_event.findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id: 'card-start-1' }]);

    await deviceAnalyticsService.ingestFirmwareAnalyticsEvent({
      mac_address: 'FC:01:2C:CF:EB:54',
      payload: buildPayload({
        event_id: 'card-start-1',
        event: 'card_session_start',
        data: { rfid_uid: 'D979470E' },
      }),
    });
    await deviceAnalyticsService.ingestFirmwareAnalyticsEvent({
      mac_address: 'FC:01:2C:CF:EB:54',
      payload: buildPayload({
        event_id: 'card-start-2',
        event: 'card_session_start',
        timestamp: 1779357399,
        data: { rfid_uid: 'D979470E' },
      }),
    });

    expect(prisma.device_card_taps_daily.upsert).toHaveBeenCalledTimes(1);
    expect(prisma.device_card_taps_daily.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ card_tap_count: 1 }),
      })
    );
  });
});
