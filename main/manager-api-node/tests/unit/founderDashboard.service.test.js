'use strict';

jest.mock('../../src/config/database', () => ({
  prisma: {
    ai_device: {
      count: jest.fn(),
      findMany: jest.fn(),
      findFirst: jest.fn(),
    },
    device_runtime_state: {
      count: jest.fn(),
      findMany: jest.fn(),
      findFirst: jest.fn(),
    },
    device_usage_daily: {
      findMany: jest.fn(),
    },
    analytics_game_sessions: {
      findMany: jest.fn(),
    },
    sys_user: {
      findMany: jest.fn(),
    },
    device_token_usage_session: {
      findMany: jest.fn(),
    },
    rfid_card_tap_log: {
      findMany: jest.fn(),
    },
    device_games_played: {
      findMany: jest.fn(),
    },
    device_radio_played: {
      findMany: jest.fn(),
    },
    voice_session_summaries: {
      findMany: jest.fn(),
    },
    analytics_media_playback: {
      findMany: jest.fn(),
    },
    parent_profile: {
      findMany: jest.fn(),
      findFirst: jest.fn(),
    },
    kid_profile: {
      findMany: jest.fn(),
      findFirst: jest.fn(),
    },
    user_question_quota: {
      findFirst: jest.fn(),
    },
    analytics_user_progress: {
      findMany: jest.fn(),
    },
    rfid_content_pack: {
      count: jest.fn(),
    },
    ai_ota: {
      findMany: jest.fn(),
    },
    device_sync_event: {
      findMany: jest.fn(),
    },
    device_analytics_event: {
      findMany: jest.fn(),
    },
  },
}));

const { prisma } = require('../../src/config/database');
const founderDashboardService = require('../../src/services/founderDashboard.service');

describe('founderDashboard.service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    prisma.ai_device.count.mockResolvedValue(12);
    prisma.device_runtime_state.count.mockResolvedValue(8);
    prisma.device_usage_daily.findMany.mockResolvedValue([
      {
        date: new Date('2026-07-20'),
        mac_address: 'AA:AA:AA:AA:AA:01',
        usage_time_seconds: 3600,
        ai_talk_usage_seconds: 1200,
        card_usage_seconds: 900,
        game_usage_seconds: 1200,
        radio_usage_seconds: 300,
      },
      {
        date: new Date('2026-07-21'),
        mac_address: 'AA:AA:AA:AA:AA:02',
        usage_time_seconds: 5400,
        ai_talk_usage_seconds: 1800,
        card_usage_seconds: 1200,
        game_usage_seconds: 1800,
        radio_usage_seconds: 600,
      },
    ]);
    prisma.analytics_game_sessions.findMany.mockResolvedValue([
      {
        started_at: new Date('2026-07-20T10:00:00Z'),
        duration_seconds: 600,
        mac_address: 'AA:AA:AA:AA:AA:01',
        completion_status: 'completed',
        mode_type: 'Math',
      },
      {
        started_at: new Date('2026-07-21T12:00:00Z'),
        duration_seconds: 900,
        mac_address: 'AA:AA:AA:AA:AA:02',
        completion_status: 'interrupted',
        mode_type: 'Riddle',
      },
    ]);
    prisma.sys_user.findMany.mockResolvedValue([
      { created_at: new Date('2026-07-20T01:00:00Z') },
      { created_at: new Date('2026-07-21T01:00:00Z') },
    ]);
    prisma.device_token_usage_session.findMany.mockResolvedValue([
      {
        usage_date: new Date('2026-07-20'),
        input_text_tokens: 1000,
        input_audio_tokens: 200,
        output_text_tokens: 500,
        output_audio_tokens: 100,
      },
      {
        usage_date: new Date('2026-07-21'),
        input_text_tokens: 1200,
        input_audio_tokens: 300,
        output_text_tokens: 650,
        output_audio_tokens: 200,
      },
    ]);
    prisma.rfid_card_tap_log.findMany.mockResolvedValue([
      {
        created_at: new Date('2026-07-21T07:00:00Z'),
        mac_address: 'AA:AA:AA:AA:AA:01',
        rfid_uid: 'CARD-1',
        content_pack_name: 'Space Pack',
      },
      {
        created_at: new Date('2026-07-21T08:00:00Z'),
        mac_address: 'AA:AA:AA:AA:AA:02',
        rfid_uid: 'CARD-2',
        content_pack_name: 'Space Pack',
      },
    ]);
    prisma.device_games_played.findMany.mockResolvedValue([
      {
        game_name: 'Animal Match',
        mac_address: 'AA:AA:AA:AA:AA:01',
        score: 90,
        duration_ms: 45000,
      },
      {
        game_name: 'Animal Match',
        mac_address: 'AA:AA:AA:AA:AA:02',
        score: 70,
        duration_ms: 30000,
      },
    ]);
    prisma.device_radio_played.findMany.mockResolvedValue([
      {
        station: 'Kids FM',
        duration_ms: 180000,
        activity_date: new Date('2026-07-21'),
        played_at: new Date('2026-07-21T09:00:00Z'),
      },
    ]);
    prisma.voice_session_summaries.findMany.mockResolvedValue([
      {
        id: 'summary-1',
        summary: 'Talked about dinosaurs and planets before bedtime.',
        mac_address: 'AA:AA:AA:AA:AA:01',
        source_message_count: 12,
        updated_at: new Date('2026-07-21T09:00:00Z'),
      },
      {
        id: 'summary-2',
        summary: 'Asked about rockets and the moon all morning.',
        mac_address: 'AA:AA:AA:AA:AA:02',
        source_message_count: 10,
        updated_at: new Date('2026-07-21T10:00:00Z'),
      },
    ]);
    prisma.analytics_media_playback.findMany.mockResolvedValue([
      {
        id: 1n,
        content_id: 10n,
        content_type: 'story',
        metadata: { title: 'The Clever Crow' },
        created_at: new Date('2026-07-21T07:30:00Z'),
      },
      {
        id: 2n,
        content_id: 11n,
        content_type: 'music',
        metadata: { title: 'Brush-Brush Song' },
        created_at: new Date('2026-07-21T08:00:00Z'),
      },
    ]);
    prisma.parent_profile.findMany.mockResolvedValue([
      {
        user_id: 11n,
        display_name: 'Anita',
        sys_user: { ai_device: [{ mac_address: 'AA:AA:AA:AA:AA:01' }] },
      },
    ]);
    prisma.kid_profile.findMany.mockResolvedValue([
      {
        id: 21n,
        user_id: 11n,
        name: 'Maya',
        nickname: 'May',
        sys_user: {
          parent_profile: { display_name: 'Anita' },
        },
      },
    ]);
    prisma.kid_profile.findFirst.mockResolvedValue({
      id: 21n,
      user_id: 11n,
      name: 'Maya',
      nickname: 'May',
      grade: '2',
      interests: ['Space', 'Animals'],
      language: 'en',
      birth_date: new Date('2019-04-14'),
      sys_user: {
        id: 11n,
        parent_profile: { display_name: 'Anita' },
        ai_device: [
          {
            id: 'device-1',
            mac_address: 'AA:AA:AA:AA:AA:01',
            alias: 'Maya Toy',
            app_version: '1.2.3',
            last_connected_at: new Date('2026-07-21T09:30:00Z'),
          },
        ],
      },
    });
    prisma.parent_profile.findFirst.mockResolvedValue({
      display_name: 'Anita',
    });
    prisma.device_runtime_state.findFirst.mockResolvedValue({
      online: true,
      battery: 82,
      firmware: '1.2.3',
      last_seen_at: new Date('2026-07-21T09:35:00Z'),
    });
    prisma.device_runtime_state.findMany.mockResolvedValue([
      {
        mac_address: 'AA:AA:AA:AA:AA:01',
        online: true,
        battery: 82,
        firmware: '1.2.3',
        last_seen_at: new Date('2026-07-21T09:35:00Z'),
      },
    ]);
    prisma.user_question_quota.findFirst.mockResolvedValue({
      questions_used: 123,
      extra_purchased: 25,
      month_key: '2026-07',
    });
    prisma.analytics_user_progress.findMany.mockResolvedValue([
      {
        mode_type: 'Conversation',
        total_sessions: 14,
        total_time_seconds: 7200,
        longest_streak: 5,
      },
    ]);
    prisma.rfid_content_pack.count.mockResolvedValue(6);
    prisma.ai_ota.findMany.mockResolvedValue([
      {
        version: '1.2.3',
        force_update: 0,
        create_date: new Date('2026-07-21T11:00:00Z'),
      },
    ]);
    prisma.device_sync_event.findMany.mockResolvedValue([
      {
        mac_address: 'AA:AA:AA:AA:AA:01',
        event_type: 'ota',
        status: 'failed',
        reason: 'timeout',
        created_at: new Date('2026-07-21T10:30:00Z'),
      },
    ]);
    prisma.device_analytics_event.findMany.mockResolvedValue([
      {
        mac_address: 'AA:AA:AA:AA:AA:01',
        event_name: 'low_battery_shutdown',
        battery_percentage: 18,
        server_received_at: new Date('2026-07-21T10:40:00Z'),
      },
    ]);
  });

  it('builds the founder overview payload from aggregate sources', async () => {
    const result = await founderDashboardService.getFounderOverview({ range: '7d' });

    expect(result.kpis.activeToysToday.total).toBe(8);
    expect(result.kpis.activeToysToday.fleetTotal).toBe(12);
    expect(result.kpis.playTimeHours.total).toBeCloseTo(2.5, 1);
    expect(result.kpis.sessions.total).toBe(2);
    expect(result.sections.timeByFeature.series).toHaveLength(2);
    expect(result.sections.cardsKidsLove.items[0]).toMatchObject({
      name: 'Space Pack',
      taps: 2,
      uniqueDevices: 2,
    });
    expect(result.sections.gamesPlayedVsFinished.items[0]).toMatchObject({
      name: 'Animal Match',
      plays: 2,
    });
    expect(result.sections.talkingAbout.items.map((item) => item.topic)).toContain('dinosaurs');
  });

  it('returns grouped search results across families, kids, and devices', async () => {
    prisma.ai_device.findMany.mockResolvedValue([
      {
        id: 'device-1',
        mac_address: 'AA:AA:AA:AA:AA:01',
        alias: 'Maya Toy',
        sys_user: {
          parent_profile: { display_name: 'Anita' },
        },
      },
    ]);

    const result = await founderDashboardService.searchFamilies('maya');

    expect(result.kids[0]).toMatchObject({
      type: 'kid',
      label: 'Maya',
      parentName: 'Anita',
    });
    expect(result.parents[0]).toMatchObject({
      type: 'parent',
      label: 'Anita',
    });
    expect(result.devices[0]).toMatchObject({
      type: 'device',
      label: 'Maya Toy',
      macAddress: 'AA:AA:AA:AA:AA:01',
    });
  });

  it('builds a family profile keyed by kid id or device mac', async () => {
    prisma.ai_device.findFirst.mockResolvedValue({
      kid_id: 21n,
    });

    const result = await founderDashboardService.getFamilyProfile('AA:AA:AA:AA:AA:01');

    expect(result.kid.name).toBe('Maya');
    expect(result.parent.displayName).toBe('Anita');
    expect(result.devices[0]).toMatchObject({
      macAddress: 'AA:AA:AA:AA:AA:01',
      alias: 'Maya Toy',
      online: true,
      battery: 82,
    });
    expect(result.quota.questionsUsed).toBe(123);
    expect(result.recentSummaries[0].summary).toContain('dinosaurs');
    expect(result.contentLove.cards[0].name).toBe('Space Pack');
  });

  it('builds engagement aggregates for the founder engagement page', async () => {
    prisma.ai_device.findMany.mockResolvedValue([
      {
        mac_address: 'AA:AA:AA:AA:AA:01',
        alias: 'Maya Toy',
        last_connected_at: new Date('2026-07-10T09:00:00Z'),
        kid_profile: { name: 'Maya' },
        sys_user: { parent_profile: { display_name: 'Anita' } },
      },
      {
        mac_address: 'AA:AA:AA:AA:AA:02',
        alias: 'Kabir Toy',
        last_connected_at: new Date('2026-07-21T09:00:00Z'),
        kid_profile: { name: 'Kabir' },
        sys_user: { parent_profile: { display_name: 'Farah' } },
      },
    ]);

    const result = await founderDashboardService.getFounderEngagement({ range: '30d' });

    expect(result.kpis.activeYesterday).toBeGreaterThanOrEqual(0);
    expect(result.sections.dailyActives).toHaveLength(30);
    expect(result.sections.returningSplit.currentWeekActives).toBeGreaterThanOrEqual(0);
    expect(Array.isArray(result.sections.sessionsByHour)).toBe(true);
    expect(result.sections.sessionsHeatmap).toHaveLength(7);
    expect(result.sections.sessionsHeatmap[0].hours).toHaveLength(24);
    expect(Array.isArray(result.sections.quietDevices)).toBe(true);
  });

  it('builds content and games aggregates for the founder content page', async () => {
    const result = await founderDashboardService.getFounderContent({ range: '7d' });

    expect(result.kpis.cardTaps).toBe(2);
    expect(result.kpis.catalogTotal).toBe(6);
    expect(result.sections.packLeaderboard[0]).toMatchObject({
      name: 'Space Pack',
      taps: 2,
    });
    expect(result.sections.media[0].title).toBe('The Clever Crow');
    expect(result.sections.radio[0].station).toBe('Kids FM');
  });

  it('builds conversations aggregates for the founder conversations page', async () => {
    const result = await founderDashboardService.getFounderConversations({ range: '7d' });

    expect(result.kpis.talkSessions).toBe(2);
    expect(result.kpis.avgTurnsPerSession).toBe(11);
    expect(result.sections.topics[0]).toHaveProperty('topic');
    expect(result.sections.summaries[0]).toHaveProperty('headline');
  });

  it('builds cost aggregates for the founder costs page', async () => {
    prisma.ai_device.findMany.mockResolvedValue([
      {
        mac_address: 'AA:AA:AA:AA:AA:01',
        kid_profile: { name: 'Maya' },
        sys_user: { parent_profile: { display_name: 'Anita' } },
      },
      {
        mac_address: 'AA:AA:AA:AA:AA:02',
        kid_profile: { name: 'Kabir' },
        sys_user: { parent_profile: { display_name: 'Farah' } },
      },
    ]);

    const result = await founderDashboardService.getFounderCosts({ range: 'month' });

    expect(result.kpis.totalCost).toBeGreaterThan(0);
    expect(result.kpis.monthlyBudget).toBe(15500);
    expect(result.sections.dailySpend).toHaveLength(2);
    expect(result.sections.dailySpend[0]).toHaveProperty('inputCost');
    expect(result.sections.dailySpend[0]).toHaveProperty('outputCost');
    expect(result.sections.topDevices[0]).toHaveProperty('fleetSharePercent');
  });

  it('builds fleet and operate aggregates for the founder operate page', async () => {
    prisma.ai_device.findMany.mockResolvedValue([
      {
        mac_address: 'AA:AA:AA:AA:AA:01',
        alias: 'Maya Toy',
      },
    ]);

    const result = await founderDashboardService.getFounderOperate();

    expect(result.kpis.fleetSize).toBe(1);
    expect(result.kpis.onlineNow).toBe(1);
    expect(result.sections.firmwareCoverage[0]).toMatchObject({
      version: '1.2.3',
    });
    expect(result.sections.watchlist[0]).toHaveProperty('issue');
    expect(result.sections.recentEvents[0]).toHaveProperty('title');
  });
});
