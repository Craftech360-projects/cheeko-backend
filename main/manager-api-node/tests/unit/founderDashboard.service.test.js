'use strict';

jest.mock('../../src/config/database', () => {
  const model = () => ({
    count: jest.fn(),
    findMany: jest.fn(),
    findFirst: jest.fn(),
    aggregate: jest.fn(),
    groupBy: jest.fn(),
  });

  return {
    prisma: {
      ai_device: model(),
      device_runtime_state: model(),
      device_usage_daily: model(),
      analytics_game_sessions: model(),
      sys_user: model(),
      device_token_usage_session: model(),
      device_token_usage: model(),
      rfid_card_tap_log: model(),
      device_games_played: model(),
      device_radio_played: model(),
      voice_session_summaries: model(),
      voice_session_messages: model(),
      analytics_media_playback: model(),
      parent_profile: model(),
      kid_profile: model(),
      user_question_quota: model(),
      analytics_user_progress: model(),
      rfid_content_pack: model(),
      ai_ota: model(),
      device_sync_event: model(),
      device_analytics_event: model(),
      analytics_game_attempts: model(),
      sys_params: model(),
    },
  };
});

const { prisma } = require('../../src/config/database');
const founderDashboardService = require('../../src/services/founderDashboard.service');

/* Ranges resolve against the IST calendar, so fixtures must be relative to
   "today" rather than pinned to a historical date. */
const IST_DAY = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Kolkata',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});
const todayKey = IST_DAY.format(new Date());
const dayKey = (offset) => {
  const date = new Date(`${todayKey}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() - offset);
  return date.toISOString().slice(0, 10);
};
/** midnight-UTC Date, matching how Postgres returns a @db.Date column */
const dateOnly = (offset) => new Date(`${dayKey(offset)}T00:00:00Z`);
/** an instant inside the given IST day */
const instant = (offset, istHour = 10) => {
  const utcHour = String(istHour).padStart(2, '0');
  return new Date(`${dayKey(offset)}T${utcHour}:00:00+05:30`);
};

describe('founderDashboard.service', () => {
  beforeEach(() => {
    jest.clearAllMocks();

    // Safe defaults for every delegate so a newly-added query in the service
    // fails loudly on its assertion rather than on an undefined mock.
    Object.values(prisma).forEach((delegate) => {
      if (!delegate || typeof delegate.findMany !== 'function') return;
      delegate.count.mockResolvedValue(0);
      delegate.findMany.mockResolvedValue([]);
      delegate.findFirst.mockResolvedValue(null);
      delegate.groupBy.mockResolvedValue([]);
      delegate.aggregate.mockResolvedValue({ _sum: {}, _avg: {}, _count: {} });
    });

    prisma.sys_params.findFirst.mockResolvedValue(null);

    prisma.ai_device.count.mockResolvedValue(12);
    prisma.ai_device.findMany.mockResolvedValue([
      {
        id: 'device-1',
        mac_address: 'AA:AA:AA:AA:AA:01',
        alias: 'Maya Toy',
        kid_id: 21n,
        last_connected_at: instant(1),
        sys_user: { parent_profile: { display_name: 'Anita' } },
      },
    ]);
    prisma.ai_device.findFirst.mockResolvedValue({ kid_id: 21n });

    prisma.device_runtime_state.count.mockResolvedValue(8);
    prisma.device_runtime_state.findMany.mockResolvedValue([
      {
        mac_address: 'AA:AA:AA:AA:AA:01',
        online: true,
        battery: 82,
        firmware: '1.2.3',
        last_seen_at: instant(0),
      },
    ]);

    prisma.device_usage_daily.findMany.mockResolvedValue([
      {
        date: dateOnly(1),
        mac_address: 'AA:AA:AA:AA:AA:01',
        usage_time_seconds: 3600,
        ai_talk_usage_seconds: 1200,
        card_usage_seconds: 900,
        game_usage_seconds: 1200,
        radio_usage_seconds: 300,
      },
      {
        date: dateOnly(0),
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
        started_at: instant(1, 10),
        duration_seconds: 600,
        mac_address: 'AA:AA:AA:AA:AA:01',
        completion_status: 'completed',
        mode_type: 'animal_match',
      },
    ]);

    prisma.sys_user.findMany.mockResolvedValue([{ created_at: instant(1) }, { created_at: instant(0) }]);

    prisma.device_token_usage_session.findMany.mockResolvedValue([
      {
        mac_address: 'AA:AA:AA:AA:AA:01',
        usage_date: dateOnly(1),
        input_text_tokens: 1000,
        input_audio_tokens: 200,
        input_cached_tokens: 0,
        output_text_tokens: 500,
        output_audio_tokens: 100,
        total_tokens: 1800,
        avg_ttft_seconds: 1.4,
        session_duration_seconds: 300,
        message_count: 12,
      },
    ]);
    // Serves both the previous-window token sums and the lifetime aggregate,
    // which also reads _count/_min/_max.
    prisma.device_token_usage_session.aggregate.mockResolvedValue({
      _sum: { message_count: 12 },
      _count: { _all: 1 },
      _min: { usage_date: dateOnly(1) },
      _max: { usage_date: dateOnly(0) },
    });

    prisma.device_token_usage.aggregate.mockResolvedValue({
      _sum: {
        input_text_tokens: 2000,
        input_audio_tokens: 400,
        input_cached_tokens: 0,
        output_text_tokens: 1000,
        output_audio_tokens: 200,
      },
      _count: { _all: 4 },
      _min: { usage_date: dateOnly(3) },
      _max: { usage_date: dateOnly(0) },
    });

    prisma.rfid_card_tap_log.findMany.mockResolvedValue([
      { created_at: instant(0), mac_address: 'AA:AA:AA:AA:AA:01', rfid_uid: 'CARD-1', content_pack_id: 1n, content_pack_name: 'Space Pack' },
      { created_at: instant(0), mac_address: 'AA:AA:AA:AA:AA:02', rfid_uid: 'CARD-2', content_pack_id: 1n, content_pack_name: 'Space Pack' },
    ]);

    prisma.device_games_played.findMany.mockResolvedValue([
      { game_name: 'Animal Match', mac_address: 'AA:AA:AA:AA:AA:01', score: 90, duration_ms: 45000, activity_date: dateOnly(1), played_at: instant(1) },
      { game_name: 'Animal Match', mac_address: 'AA:AA:AA:AA:AA:02', score: 70, duration_ms: 30000, activity_date: dateOnly(1), played_at: instant(1) },
    ]);

    prisma.device_radio_played.findMany.mockResolvedValue([
      { station: 'Kids FM', duration_ms: 180000, activity_date: dateOnly(0), played_at: instant(0) },
    ]);

    const summaries = [
      { id: 'summary-1', session_id: 'sess-1', summary: 'Talked about dinosaurs and planets before bedtime.', mac_address: 'AA:AA:AA:AA:AA:01', source_message_count: 12, updated_at: instant(0) },
      { id: 'summary-2', session_id: 'sess-2', summary: 'Asked about rockets and the moon all morning.', mac_address: 'AA:AA:AA:AA:AA:02', source_message_count: 10, updated_at: instant(0) },
    ];
    prisma.voice_session_summaries.findMany.mockResolvedValue(summaries);
    prisma.voice_session_summaries.findFirst.mockResolvedValue(summaries[0]);
    prisma.voice_session_summaries.count.mockResolvedValue(2);
    prisma.voice_session_summaries.aggregate.mockResolvedValue({ _avg: { source_message_count: 11 } });

    prisma.voice_session_messages.findMany.mockResolvedValue([
      { session_id: 'sess-1', mac_address: 'AA:AA:AA:AA:AA:01', sequence: 1, role: 'user', content: 'What is inside a volcano?', created_at: instant(0) },
      { session_id: 'sess-1', mac_address: 'AA:AA:AA:AA:AA:01', sequence: 2, role: 'assistant', content: 'Melted rock called magma!', created_at: instant(0) },
    ]);

    prisma.analytics_media_playback.findMany.mockResolvedValue([
      { id: 1n, content_id: 10n, content_type: 'story', event_type: 'start', metadata: { media_title: 'The Clever Crow' }, created_at: instant(0) },
    ]);

    prisma.parent_profile.findMany.mockResolvedValue([
      { user_id: 11n, display_name: 'Anita', sys_user: { ai_device: [{ mac_address: 'AA:AA:AA:AA:AA:01' }] } },
    ]);

    prisma.kid_profile.count.mockResolvedValue(1);
    prisma.kid_profile.findMany.mockResolvedValue([
      { id: 21n, user_id: 11n, name: 'Maya', nickname: 'May', grade: '2', birth_date: new Date('2019-04-14'), sys_user: { parent_profile: { display_name: 'Anita', email: 'anita@example.com' }, ai_device: [{ mac_address: 'AA:AA:AA:AA:AA:01' }] } },
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
      created_at: instant(30),
      sys_user: {
        id: 11n,
        parent_profile: { display_name: 'Anita', email: 'anita@example.com', phone_number: '+910000000000', created_at: instant(30) },
        ai_device: [
          { id: 'device-1', mac_address: 'AA:AA:AA:AA:AA:01', alias: 'Maya Toy', app_version: '1.2.3', kid_id: 21n, last_connected_at: instant(0) },
        ],
      },
    });

    prisma.user_question_quota.findFirst.mockResolvedValue({ questions_used: 123, extra_purchased: 25, month_key: todayKey.slice(0, 7) });

    // Real columns only: analytics_user_progress has no mode_type / total_time_seconds.
    prisma.analytics_user_progress.findMany.mockResolvedValue([
      {
        mac_address: 'AA:AA:AA:AA:AA:01',
        total_sessions: 14,
        total_duration_seconds: 7200,
        total_games_played: 6,
        current_streak: 3,
        longest_streak: 5,
        last_activity_at: instant(0),
      },
    ]);

    prisma.rfid_content_pack.count.mockResolvedValue(6);
    prisma.ai_ota.findMany.mockResolvedValue([{ version: '1.2.3', force_update: 0, create_date: instant(1) }]);
    prisma.device_sync_event.findMany.mockResolvedValue([
      { mac_address: 'AA:AA:AA:AA:AA:01', event_type: 'ota', status: 'failed', reason: 'timeout', created_at: instant(0) },
    ]);
    prisma.device_analytics_event.findMany.mockResolvedValue([
      { mac_address: 'AA:AA:AA:AA:AA:01', event_name: 'low_battery_shutdown', battery_percentage: 18, server_received_at: instant(0) },
    ]);
    prisma.device_analytics_event.count.mockResolvedValue(3);

    prisma.analytics_game_attempts.findMany.mockResolvedValue([
      { is_correct: true },
      { is_correct: true },
      { is_correct: false },
      { is_correct: null },
    ]);
  });

  it('builds the founder overview payload from aggregate sources', async () => {
    const result = await founderDashboardService.getFounderOverview({ range: '7d' });

    expect(result.kpis.activeToys.fleetTotal).toBe(12);
    expect(result.kpis.activeToys.onlineNow).toBe(8);
    expect(result.kpis.playTimeHours.total).toBeCloseTo(2.5, 1);
    expect(result.kpis.sessions.total).toBe(1);
    expect(result.sections.cardsKidsLove.items[0]).toMatchObject({ name: 'Space Pack', taps: 2, uniqueDevices: 2 });
    expect(result.sections.gamesPlayedVsFinished.items[0]).toMatchObject({ name: 'Animal Match', plays: 2 });
    expect(result.sections.talkingAbout.items.map((item) => item.topic)).toContain('dinosaurs');
  });

  it('gap-fills every overview series to the full range', async () => {
    const result = await founderDashboardService.getFounderOverview({ range: '7d' });

    expect(result.sections.timeByFeature.series).toHaveLength(7);
    const lengths = [
      result.kpis.activeToys.sparkline.length,
      result.kpis.playTimeHours.sparkline.length,
      result.kpis.sessions.sparkline.length,
      result.kpis.newFamilies.sparkline.length,
      result.kpis.aiCostInr.sparkline.length,
    ];
    expect(new Set(lengths).size).toBe(1);
    expect(lengths[0]).toBe(7);
  });

  it('keeps unresolved taps out of the card leaderboard and reports them separately', async () => {
    prisma.rfid_card_tap_log.findMany.mockResolvedValue([
      { created_at: instant(0), mac_address: 'AA:AA:AA:AA:AA:01', rfid_uid: 'CARD-1', content_pack_id: 1n, content_pack_name: 'Space Pack' },
      ...Array.from({ length: 40 }, () => ({ created_at: instant(0), mac_address: 'AA:AA:AA:AA:AA:09', rfid_uid: 'UNKNOWN', content_pack_id: null, content_pack_name: null })),
    ]);

    const result = await founderDashboardService.getFounderOverview({ range: '7d' });

    expect(result.sections.cardsKidsLove.items.map((item) => item.name)).not.toContain('Unresolved');
    expect(result.sections.cardsKidsLove.unresolvedTapCount).toBe(40);
  });

  it('returns grouped search results across families, kids, and devices', async () => {
    const result = await founderDashboardService.searchFamilies('maya');

    expect(result.kids[0]).toMatchObject({ type: 'kid', label: 'Maya', parentName: 'Anita' });
    expect(result.parents[0]).toMatchObject({ type: 'parent', label: 'Anita' });
    expect(result.devices[0]).toMatchObject({ type: 'device', label: 'Maya Toy', macAddress: 'AA:AA:AA:AA:AA:01' });
  });

  it('builds a family profile keyed by kid id or device mac', async () => {
    const result = await founderDashboardService.getFamilyProfile('AA:AA:AA:AA:AA:01');

    expect(result.kid.name).toBe('Maya');
    expect(result.parent.displayName).toBe('Anita');
    expect(result.devices[0]).toMatchObject({ macAddress: 'AA:AA:AA:AA:AA:01', alias: 'Maya Toy', online: true, battery: 82 });
    expect(result.quota.questionsUsed).toBe(123);
    expect(result.recentSummaries[0].summary).toContain('dinosaurs');
    expect(result.contentLove.cards[0].name).toBe('Space Pack');
  });

  it('reads progress from columns that exist on analytics_user_progress', async () => {
    const result = await founderDashboardService.getFamilyProfile('AA:AA:AA:AA:AA:01');

    expect(result.progress[0]).toMatchObject({
      macAddress: 'AA:AA:AA:AA:AA:01',
      totalSessions: 14,
      totalDurationSeconds: 7200,
      currentStreak: 3,
      longestStreak: 5,
    });
    expect(Number.isFinite(result.progress[0].totalDurationSeconds)).toBe(true);
    expect(result.thisWeek).toHaveProperty('playSeconds');
  });

  it('never exposes parent email or phone', async () => {
    const profile = await founderDashboardService.getFamilyProfile('AA:AA:AA:AA:AA:01');
    expect(profile.parent).not.toHaveProperty('email');
    expect(profile.parent).not.toHaveProperty('phoneNumber');
    expect(JSON.stringify(profile)).not.toContain('anita@example.com');

    const list = await founderDashboardService.listAllFamilies({ page: 1, limit: 50 });
    expect(list.items[0]).not.toHaveProperty('parentEmail');
    expect(JSON.stringify(list)).not.toContain('anita@example.com');
    expect(list).toMatchObject({ total: 1, page: 1, limit: 50 });
  });

  it('builds engagement aggregates for the founder engagement page', async () => {
    const result = await founderDashboardService.getFounderEngagement({ range: '30d' });

    expect(result.sections.dailyActives).toHaveLength(30);
    expect(result.sections.sessionsHeatmap).toHaveLength(7);
    expect(result.sections.sessionsHeatmap[0].hours).toHaveLength(24);
    expect(Array.isArray(result.sections.quietDevices)).toBe(true);
    // 7-day average is undefined until a full window exists
    expect(result.sections.dailyActives[0].average).toBeNull();
    expect(result.sections.dailyActives[29].average).not.toBeNull();
  });

  it('buckets a midnight-hour IST session into hour 0 instead of throwing', async () => {
    // 18:35Z is 00:05 IST the following day — this previously produced
    // hour index 24 and crashed the endpoint.
    prisma.analytics_game_sessions.findMany.mockResolvedValue([
      {
        started_at: new Date(`${dayKey(1)}T18:35:00.000Z`),
        duration_seconds: 300,
        mac_address: 'AA:AA:AA:AA:AA:01',
        completion_status: 'completed',
        mode_type: 'animal_match',
      },
    ]);

    const result = await founderDashboardService.getFounderEngagement({ range: '7d' });

    expect(result.sections.sessionsByHour.find((bucket) => bucket.hour === 0).sessions).toBe(1);
    const heatmapTotal = result.sections.sessionsHeatmap
      .flatMap((day) => day.hours)
      .reduce((sum, hour) => sum + hour.sessions, 0);
    expect(heatmapTotal).toBe(1);
  });

  it('builds content and games aggregates for the founder content page', async () => {
    const result = await founderDashboardService.getFounderContent({ range: '7d' });

    expect(result.kpis.cardTaps).toBe(2);
    expect(result.kpis.catalogTotal).toBe(6);
    expect(result.kpis.packsInUse).toBe(1);
    expect(result.sections.packLeaderboard[0]).toMatchObject({ name: 'Space Pack', taps: 2 });
    expect(result.sections.media[0].title).toBe('The Clever Crow');
    expect(result.sections.radio[0].station).toBe('Kids FM');
  });

  it('merges game plays and sessions onto one key with a bounded completion rate', async () => {
    prisma.device_games_played.findMany.mockResolvedValue(
      Array.from({ length: 3 }, () => ({ game_name: 'Word Ladder', mac_address: 'AA:AA:AA:AA:AA:01', score: 7, duration_ms: 60000, activity_date: dateOnly(1), played_at: instant(1) })),
    );
    prisma.analytics_game_sessions.findMany.mockResolvedValue(
      Array.from({ length: 50 }, () => ({ started_at: instant(1), duration_seconds: 120, mac_address: 'AA:AA:AA:AA:AA:01', completion_status: 'completed', mode_type: 'word_ladder' })),
    );

    const result = await founderDashboardService.getFounderContent({ range: '7d' });

    expect(result.sections.games).toHaveLength(1);
    expect(result.sections.games[0].name).toBe('Word Ladder');
    expect(result.sections.games[0].completionRate).toBeLessThanOrEqual(100);
    expect(result.kpis.avgCompletionRate).toBeLessThanOrEqual(100);
  });

  it('builds conversations aggregates without inventing a moderation figure', async () => {
    const result = await founderDashboardService.getFounderConversations({ range: '7d' });

    expect(result.kpis.talkSessions).toBe(2);
    expect(result.kpis.avgTurnsPerSession).toBe(11);
    expect(result.kpis.moderationFlags).toBeNull();
    expect(result.sections).not.toHaveProperty('transcriptPreview');
    expect(result.sections.topics[0]).toHaveProperty('topic');
    expect(result.sections.summaries[0]).toHaveProperty('headline');
    expect(result.sections.summaries[0]).toHaveProperty('sessionId');
  });

  it('returns a real transcript built from stored messages', async () => {
    const result = await founderDashboardService.getConversationTranscript('sess-1');

    expect(result.lines).toHaveLength(2);
    expect(result.lines[0]).toMatchObject({ speaker: 'Kid', text: 'What is inside a volcano?' });
    expect(result.lines[1].speaker).toBe('Cheeko');
  });

  it('builds cost aggregates for the founder costs page', async () => {
    const result = await founderDashboardService.getFounderCosts({ range: 'month' });

    expect(result.kpis.totalCost).toBeGreaterThan(0);
    expect(result.sections.dailySpend[0]).toHaveProperty('inputCost');
    expect(result.sections.dailySpend[0]).toHaveProperty('outputCost');
    expect(result.sections.topDevices[0]).toHaveProperty('fleetSharePercent');
    expect(result.sections.topDevices[0].kidName).toBe('Maya');
  });

  it('reports lifetime spend from both token ledgers, each with its own coverage', async () => {
    const result = await founderDashboardService.getFounderCosts({ range: 'month' });
    const { sessionLedger, deviceLedger } = result.sections.lifetime;

    // 2000 text-in + 400 audio-in + 1000 text-out + 200 audio-out, at the
    // default INR-per-million rates.
    expect(deviceLedger.totalInr).toBeCloseTo(
      (2000 * 46 + 400 * 276 + 1000 * 184 + 200 * 1104) / 1000000,
      2,
    );
    expect(deviceLedger.rows).toBe(4);
    expect(deviceLedger.firstDay).toMatch(/^\d{4}-\d{2}-\d{2}$/);

    // The two ledgers are independent: neither range nor row count is shared.
    expect(sessionLedger.rows).toBe(1);
    expect(sessionLedger.totalInr).not.toBe(deviceLedger.totalInr);
  });

  it('leaves lifetime spend at zero rather than null when a ledger is empty', async () => {
    prisma.device_token_usage.aggregate.mockResolvedValue({
      _sum: {
        input_text_tokens: null, input_audio_tokens: null, input_cached_tokens: null,
        output_text_tokens: null, output_audio_tokens: null,
      },
      _count: { _all: 0 },
      _min: { usage_date: null },
      _max: { usage_date: null },
    });

    const result = await founderDashboardService.getFounderCosts({ range: 'month' });

    expect(result.sections.lifetime.deviceLedger).toMatchObject({
      totalInr: 0,
      rows: 0,
      firstDay: null,
      lastDay: null,
    });
  });

  it('reports no budget until one is configured, and reads it from sys_params', async () => {
    const withoutBudget = await founderDashboardService.getFounderCosts({ range: 'month' });
    expect(withoutBudget.kpis.monthlyBudget).toBeNull();
    expect(withoutBudget.kpis.budgetUsedPercent).toBeNull();

    prisma.sys_params.findFirst.mockImplementation(async ({ where }) =>
      where.param_code === 'founder_monthly_budget_inr'
        ? { param_code: where.param_code, param_value: '15500', value_type: 'number' }
        : null,
    );

    const withBudget = await founderDashboardService.getFounderCosts({ range: 'month' });
    expect(withBudget.kpis.monthlyBudget).toBe(15500);
    expect(withBudget.kpis.budgetUsedPercent).not.toBeNull();
  });

  it('sums many sub-paisa sessions instead of rounding each to zero', async () => {
    prisma.device_token_usage_session.findMany.mockResolvedValue(
      Array.from({ length: 500 }, () => ({
        mac_address: 'AA:AA:AA:AA:AA:01',
        usage_date: dateOnly(1),
        input_text_tokens: 100,
        input_audio_tokens: 0,
        input_cached_tokens: 0,
        output_text_tokens: 0,
        output_audio_tokens: 0,
        total_tokens: 100,
        avg_ttft_seconds: 0,
        session_duration_seconds: 10,
        message_count: 4,
      })),
    );

    const result = await founderDashboardService.getFounderCosts({ range: '7d' });

    // 500 x 100 tokens x ₹46/1M = ₹2.30
    expect(result.kpis.totalCost).toBeCloseTo(2.3, 2);
    expect(result.kpis.perSession).toBeGreaterThan(0);
    // avg_ttft_seconds defaults to 0 meaning "never measured", not "instant"
    expect(result.kpis.avgResponseTimeSeconds).toBeNull();
  });

  it('builds fleet and operate aggregates for the founder operate page', async () => {
    const result = await founderDashboardService.getFounderOperate();

    expect(result.kpis.fleetSize).toBe(1);
    expect(result.kpis.onlineNow).toBe(1);
    expect(result.kpis.deviceErrors7d).toBe(3);
    expect(result.sections.firmwareCoverage[0]).toMatchObject({ version: '1.2.3' });
    expect(result.sections.watchlist[0]).toHaveProperty('issue');
    expect(result.sections.recentEvents[0]).toHaveProperty('title');
  });

  describe('deltas, trends and losing steam', () => {
    it('returns a week-over-week change and a 14-point trend per pack', async () => {
      // current window taps
      prisma.rfid_card_tap_log.findMany.mockResolvedValue([
        { created_at: instant(1), mac_address: 'AA:AA:AA:AA:AA:01', rfid_uid: 'C1', content_pack_id: 1n, content_pack_name: 'Space Pack' },
        { created_at: instant(1), mac_address: 'AA:AA:AA:AA:AA:02', rfid_uid: 'C2', content_pack_id: 1n, content_pack_name: 'Space Pack' },
      ]);
      // previous window had 1 tap for the same pack -> +100%
      prisma.rfid_card_tap_log.groupBy.mockImplementation(async ({ by }) =>
        by.includes('content_pack_name')
          ? [{ content_pack_name: 'Space Pack', _count: { _all: 1 } }]
          : [{ content_pack_id: 1n }],
      );

      const result = await founderDashboardService.getFounderContent({ range: '7d' });
      const pack = result.sections.packLeaderboard[0];

      expect(pack.previousTaps).toBe(1);
      expect(pack.changePercent).toBe(100);
      expect(pack.trend).toHaveLength(14);
      expect(pack.trend.reduce((a, b) => a + b, 0)).toBeGreaterThan(0);
    });

    it('drops the unique-cards figure in favour of a comparable delta', async () => {
      const result = await founderDashboardService.getFounderContent({ range: '7d' });
      result.sections.packLeaderboard.forEach((pack) => {
        expect(pack).toHaveProperty('changePercent');
        expect(pack).toHaveProperty('trend');
      });
    });

    it('flags a pack that fell two consecutive weeks as losing steam', async () => {
      // 1 tap this week, 4 last week, 9 the week before -> falling 2 weeks
      const taps = [
        ...Array.from({ length: 1 }, () => ({ content_pack_name: 'Phonics', created_at: instant(1) })),
        ...Array.from({ length: 4 }, () => ({ content_pack_name: 'Phonics', created_at: instant(9) })),
        ...Array.from({ length: 9 }, () => ({ content_pack_name: 'Phonics', created_at: instant(16) })),
      ];
      let call = 0;
      prisma.rfid_card_tap_log.findMany.mockImplementation(async () => {
        call += 1;
        return call === 1 ? taps.slice(0, 1) : taps; // first call = current window, later = 21d trend
      });
      prisma.rfid_card_tap_log.groupBy.mockImplementation(async ({ by }) =>
        by.includes('content_pack_name') ? [{ content_pack_name: 'Phonics', _count: { _all: 4 } }] : [],
      );

      const result = await founderDashboardService.getFounderContent({ range: '7d' });
      const entry = result.sections.losingSteam.find((x) => x.name === 'Phonics');

      expect(entry).toBeDefined();
      expect(entry.metric).toBe('taps');
      expect(entry.changePercent).toBeLessThan(0);
      expect(entry.consecutiveWeeks).toBe(2);
    });

    it('reports no losing-steam entries when nothing declined', async () => {
      const result = await founderDashboardService.getFounderContent({ range: '7d' });
      expect(Array.isArray(result.sections.losingSteam)).toBe(true);
      result.sections.losingSteam.forEach((entry) => {
        const magnitude = entry.changePercent ?? entry.changePoints;
        expect(magnitude).toBeLessThan(0);
      });
    });

    it('exposes KPI deltas on overview, conversations and costs', async () => {
      const [overview, conversations, costs] = await Promise.all([
        founderDashboardService.getFounderOverview({ range: '7d' }),
        founderDashboardService.getFounderConversations({ range: '7d' }),
        founderDashboardService.getFounderCosts({ range: '7d' }),
      ]);

      ['activeToys', 'playTimeHours', 'sessions', 'newFamilies', 'aiCostInr'].forEach((key) => {
        expect(overview.deltas).toHaveProperty(key);
      });
      expect(overview.comparedTo).toHaveProperty('startKey');
      expect(conversations.deltas).toHaveProperty('talkSessions');
      expect(costs.deltas).toHaveProperty('totalCost');

      // no baseline in these fixtures -> null, never Infinity or a fake 100%
      Object.values(overview.deltas).forEach((v) => {
        expect(v === null || Number.isFinite(v)).toBe(true);
      });
    });
  });

  describe('family quota allowance', () => {
    it('leaves the allowance null until it is configured', async () => {
      const profile = await founderDashboardService.getFamilyProfile('AA:AA:AA:AA:AA:01');
      expect(profile.quota.allowance).toBeNull();
      expect(profile.quota.remaining).toBeNull();
      expect(profile.quota.questionsUsed).toBe(123);
    });

    it('derives allowance and remaining once monthly_question_allowance is set', async () => {
      prisma.sys_params.findFirst.mockImplementation(async ({ where }) =>
        where.param_code === 'monthly_question_allowance'
          ? { param_code: where.param_code, param_value: '500', value_type: 'number' }
          : null,
      );

      const profile = await founderDashboardService.getFamilyProfile('AA:AA:AA:AA:AA:01');
      // 500 allowance + 25 purchased, 123 used
      expect(profile.quota.allowance).toBe(525);
      expect(profile.quota.remaining).toBe(402);
    });
  });

  describe('mission control (live)', () => {
    it('builds the live wall from real runtime, usage and event rows', async () => {
      const result = await founderDashboardService.getFounderLive();

      expect(result.kpis.onlineNow).toBe(1);
      expect(result.kpis.fleetSize).toBe(1);
      expect(result.sections.liveToys[0]).toMatchObject({
        macAddress: 'AA:AA:AA:AA:AA:01',
        kidName: 'Maya',
        battery: 82,
      });
      expect(result.sections.hourlySessions).toHaveLength(24);
      expect(result.sections.ttftTrend).toHaveLength(14);
      expect(result.sections.spend).toHaveProperty('monthToDate');
    });

    it('computes answer accuracy from real attempts, ignoring unscored ones', async () => {
      const result = await founderDashboardService.getFounderLive();
      // 2 correct of 3 scored attempts (the null is excluded)
      expect(result.sections.sessionQuality.answerAccuracy).toBe(67);
      expect(result.sections.sessionQuality.attemptsCounted).toBe(3);
    });

    it('returns null quality metrics rather than zeros when nothing was measured', async () => {
      prisma.analytics_game_attempts.findMany.mockResolvedValue([]);
      prisma.analytics_game_sessions.findMany.mockResolvedValue([]);

      const result = await founderDashboardService.getFounderLive();

      expect(result.sections.sessionQuality.answerAccuracy).toBeNull();
      expect(result.sections.sessionQuality.avgSessionMinutes).toBeNull();
      expect(result.sections.sessionQuality.completedSessionsPercent).toBeNull();
      expect(result.kpis.peakSessionsHour).toBeNull();
    });

    it('merges talk, card, game and alert activity into one time-ordered feed', async () => {
      const result = await founderDashboardService.getFounderLive();

      const kinds = new Set(result.feed ? [] : result.sections.feed.map((item) => item.kind));
      expect(kinds.has('talk')).toBe(true);
      expect(kinds.has('card')).toBe(true);
      expect(kinds.has('game')).toBe(true);

      const times = result.sections.feed.map((item) => new Date(item.at).getTime());
      expect(times).toEqual([...times].sort((a, b) => b - a));
      // feed rows carry a human label, never a bare MAC when a kid is linked
      expect(result.sections.feed.every((item) => Boolean(item.label))).toBe(true);
    });
  });

  describe('daily brief', () => {
    it('covers yesterday and reports measured headline numbers', async () => {
      const result = await founderDashboardService.getFounderBrief();

      expect(result.coverDate).toBe(dayKey(1));
      expect(result.headline).toHaveProperty('activeToys');
      expect(result.headline).toHaveProperty('playHours');
      expect(result.headline).toHaveProperty('costInr');
      expect(result.playHoursSeries).toHaveLength(30);
      expect(result.quotes[0].summary).toContain('dinosaurs');
    });

    it('derives "three things" only from measured movement', async () => {
      const result = await founderDashboardService.getFounderBrief();

      expect(Array.isArray(result.threeThings)).toBe(true);
      expect(result.threeThings.length).toBeLessThanOrEqual(3);
      result.threeThings.forEach((item) => {
        expect(typeof item.title).toBe('string');
        expect(item.title.length).toBeGreaterThan(0);
        expect(typeof item.detail).toBe('string');
      });
    });

    it('returns no insights and no movers when there is nothing to compare', async () => {
      prisma.device_usage_daily.findMany.mockResolvedValue([]);
      prisma.rfid_card_tap_log.findMany.mockResolvedValue([]);
      prisma.analytics_game_sessions.findMany.mockResolvedValue([]);
      prisma.device_token_usage_session.findMany.mockResolvedValue([]);
      prisma.voice_session_summaries.findMany.mockResolvedValue([]);

      const result = await founderDashboardService.getFounderBrief();

      expect(result.threeThings).toEqual([]);
      expect(result.movers).toEqual([]);
      expect(result.headline.activeToys).toBe(0);
      expect(result.quotes).toEqual([]);
    });

    it('never emits a percentage change against a zero baseline', async () => {
      const result = await founderDashboardService.getFounderBrief();

      Object.values(result.deltas).forEach((value) => {
        expect(value === null || Number.isFinite(value)).toBe(true);
      });
      result.movers.forEach((mover) => {
        expect(Number.isFinite(mover.changePercent)).toBe(true);
      });
    });
  });

  it('excludes devices that never reported a battery from the fleet average', async () => {
    prisma.device_runtime_state.findMany.mockResolvedValue([
      { mac_address: 'AA:AA:AA:AA:AA:01', online: true, battery: 80, firmware: '1.2.3', last_seen_at: instant(0) },
      { mac_address: 'AA:AA:AA:AA:AA:02', online: false, battery: null, firmware: '1.2.3', last_seen_at: instant(0) },
    ]);

    const result = await founderDashboardService.getFounderOperate();

    expect(result.kpis.avgBattery).toBe(80);
    expect(result.kpis.batteryReportingDevices).toBe(1);
  });
});
