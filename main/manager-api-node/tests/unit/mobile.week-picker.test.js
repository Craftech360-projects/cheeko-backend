'use strict';

/**
 * `week_start`: the parent app's week picker.
 *
 * The Week tab used to answer for one window only — whatever "this week" was
 * when the screen opened — while every rollup row is kept per day, forever.
 * These hold the /progress/* family to reporting any single Monday-to-Sunday
 * week the app names, and to leaving the existing windows exactly as they were
 * when it names none.
 */

jest.mock('../../src/config/database', () => ({
    prisma: {
        sys_user: { findUnique: jest.fn() },
        ai_device: { findMany: jest.fn() },
        kid_profile: { findFirst: jest.fn() },
        device_analytics_event: { findMany: jest.fn() },
        device_usage_daily: { findMany: jest.fn(), aggregate: jest.fn() },
        device_card_taps_daily: { findMany: jest.fn() },
        device_ai_interactions_daily: { findMany: jest.fn() },
        device_games_played: { findMany: jest.fn(), count: jest.fn() },
        device_radio_played: { findMany: jest.fn(), count: jest.fn() },
        rfid_card_mapping: { findMany: jest.fn() },
        rfid_content_pack: { findMany: jest.fn() },
    },
}));

const { prisma } = require('../../src/config/database');
const mobileService = require('../../src/services/mobile.service');

const UID = 'firebase-user-1';
const MAC = 'AA:BB:CC:DD:EE:FF';
// Friday 11 September 2026, noon IST. This week is Mon 7 – Sun 13 September;
// last week is Mon 31 August – Sun 6 September.
const NOW = new Date('2026-09-11T06:30:00.000Z');
const LAST_WEEK = {
    gte: new Date('2026-08-31T00:00:00.000Z'),
    lte: new Date('2026-09-06T00:00:00.000Z'),
};

beforeEach(() => {
    jest.clearAllMocks();
    // No stored zone: the account reads in the Asia/Kolkata default.
    prisma.sys_user.findUnique.mockResolvedValue({ id: 1n, parent_profile: null });
    prisma.ai_device.findMany.mockResolvedValue([{ mac_address: MAC, kid_id: null }]);
    prisma.kid_profile.findFirst.mockResolvedValue(null);
    prisma.device_analytics_event.findMany.mockResolvedValue([]);
    prisma.device_usage_daily.findMany.mockResolvedValue([]);
    prisma.device_usage_daily.aggregate.mockResolvedValue({ _min: { date: null } });
    prisma.device_card_taps_daily.findMany.mockResolvedValue([]);
    prisma.device_ai_interactions_daily.findMany.mockResolvedValue([]);
    prisma.device_games_played.findMany.mockResolvedValue([]);
    prisma.device_games_played.count.mockResolvedValue(0);
    prisma.device_radio_played.findMany.mockResolvedValue([]);
    prisma.device_radio_played.count.mockResolvedValue(0);
    prisma.rfid_card_mapping.findMany.mockResolvedValue([]);
    prisma.rfid_content_pack.findMany.mockResolvedValue([]);
});

describe('/progress/summary with week_start', () => {
    it('reports exactly the Monday-to-Sunday week asked for', async () => {
        prisma.device_usage_daily.findMany.mockResolvedValue([
            { usage_time_seconds: 900, game_usage_seconds: 600, card_usage_seconds: 300, ai_talk_usage_seconds: 0, radio_usage_seconds: 0 },
        ]);
        prisma.device_card_taps_daily.findMany.mockResolvedValue([{ card_tap_count: 4 }, { card_tap_count: 1 }]);
        prisma.device_ai_interactions_daily.findMany.mockResolvedValue([{ ai_interaction_count: 3 }]);
        prisma.device_games_played.count.mockResolvedValue(2);

        const summary = await mobileService.getProgressSummary(UID, {
            period: 'week',
            week_start: '2026-08-31',
            now: NOW,
        });

        expect(summary).toMatchObject({
            period: 'week',
            start_date: '2026-08-31',
            end_date: '2026-09-06',
            usage_time_seconds: 900,
            card_tap_count: 5,
            games_played: 2,
            ai_interaction_count: 3,
        });
        expect(prisma.device_usage_daily.findMany.mock.calls[0][0].where.date).toEqual(LAST_WEEK);
        expect(prisma.device_card_taps_daily.findMany.mock.calls[0][0].where.date).toEqual(LAST_WEEK);
        expect(prisma.device_ai_interactions_daily.findMany.mock.calls[0][0].where.date).toEqual(LAST_WEEK);
        expect(prisma.device_games_played.count.mock.calls[0][0].where.activity_date).toEqual(LAST_WEEK);
    });

    it('snaps any day of the week back to its Monday', async () => {
        const summary = await mobileService.getProgressSummary(UID, {
            period: 'week',
            weekStart: '2026-09-03', // a Thursday, camelCase as well
            now: NOW,
        });

        expect(summary.start_date).toBe('2026-08-31');
        expect(summary.end_date).toBe('2026-09-06');
    });

    it('ends the current week today, as the calendar month does', async () => {
        const summary = await mobileService.getProgressSummary(UID, {
            period: 'week',
            week_start: '2026-09-07',
            now: NOW,
        });

        expect(summary.start_date).toBe('2026-09-07');
        expect(summary.end_date).toBe('2026-09-11');
    });

    it('reads a week that has not started in the parent zone as empty, not as an error', async () => {
        // A phone a timezone ahead of the account can ask for next Monday; a
        // 400 here would fail the app's whole analytics fan-out.
        const summary = await mobileService.getProgressSummary(UID, {
            period: 'week',
            week_start: '2026-09-14',
            now: NOW,
        });

        expect(summary).toMatchObject({
            start_date: '2026-09-14',
            usage_time_seconds: 0,
            card_tap_count: 0,
            games_played: 0,
            ai_interaction_count: 0,
        });
    });

    it('leaves period=week as the trailing seven days when no week is named', async () => {
        const summary = await mobileService.getProgressSummary(UID, { period: 'week', now: NOW });

        expect(summary.start_date).toBe('2026-09-05');
        expect(summary.end_date).toBe('2026-09-11');
    });

    it.each(['31-08-2026', '2026-02-30', 'last-week', '2026-8-31'])('rejects %p', async value => {
        await expect(mobileService.getProgressSummary(UID, { period: 'week', week_start: value, now: NOW }))
            .rejects.toMatchObject({ statusCode: 400 });
    });

    it.each(['today', 'month'])('refuses week_start on period=%s rather than ignoring it', async period => {
        await expect(mobileService.getProgressSummary(UID, { period, week_start: '2026-08-31', now: NOW }))
            .rejects.toMatchObject({ statusCode: 400, message: 'week_start requires period=week' });
    });
});

describe('/progress/trend with week_start', () => {
    it('returns one zero-filled point per day of a past week, and nothing outside it', async () => {
        prisma.device_card_taps_daily.findMany.mockResolvedValue([
            { date: new Date('2026-09-02T00:00:00.000Z'), card_tap_count: 4 },
            // Outside the week: must not surface as a point.
            { date: new Date('2026-09-08T00:00:00.000Z'), card_tap_count: 9 },
        ]);

        const trend = await mobileService.getProgressTrend(UID, {
            period: 'week',
            week_start: '2026-08-31',
            now: NOW,
        });

        expect(trend.points.map(point => point.date)).toEqual([
            '2026-08-31', '2026-09-01', '2026-09-02', '2026-09-03',
            '2026-09-04', '2026-09-05', '2026-09-06',
        ]);
        expect(trend.points.find(point => point.date === '2026-09-02').card_tap_count).toBe(4);
        expect(trend.points.reduce((sum, point) => sum + point.card_tap_count, 0)).toBe(4);
        expect(prisma.device_usage_daily.findMany.mock.calls[0][0].where.date).toEqual(LAST_WEEK);
    });

    it('stops the current week at today', async () => {
        const trend = await mobileService.getProgressTrend(UID, {
            period: 'week',
            week_start: '2026-09-07',
            now: NOW,
        });

        expect(trend.points.map(point => point.date)).toEqual([
            '2026-09-07', '2026-09-08', '2026-09-09', '2026-09-10', '2026-09-11',
        ]);
    });

    it('keeps period=week as the calendar month when no week is named', async () => {
        const trend = await mobileService.getProgressTrend(UID, { period: 'week', now: NOW });

        expect(trend.points[0].date).toBe('2026-09-01');
        expect(trend.points).toHaveLength(11);
    });

    it('rejects a malformed week', async () => {
        await expect(mobileService.getProgressTrend(UID, { period: 'week', week_start: 'soon', now: NOW }))
            .rejects.toMatchObject({ statusCode: 400 });
    });
});

describe('the first day a toy reported anything', () => {
    it('rides along on the summary, whatever window was asked for', async () => {
        prisma.device_usage_daily.aggregate.mockResolvedValue({
            _min: { date: new Date('2026-08-05T00:00:00.000Z') },
        });

        const summary = await mobileService.getProgressSummary(UID, { period: 'today', now: NOW });

        expect(summary.first_activity_date).toBe('2026-08-05');
        expect(summary.firstActivityDate).toBe('2026-08-05');
        // Asked over the child's whole history, not the reported window.
        expect(prisma.device_usage_daily.aggregate.mock.calls[0][0]).toEqual({
            where: { mac_address: { in: [MAC] }, kid_id: null },
            _min: { date: true },
        });
    });

    it('is null for a toy that has never reported a day', async () => {
        const summary = await mobileService.getProgressSummary(UID, { period: 'week', now: NOW });

        expect(summary.first_activity_date).toBeNull();
    });

    it('is null for an account with no toys', async () => {
        prisma.ai_device.findMany.mockResolvedValue([]);

        const summary = await mobileService.getProgressSummary(UID, { period: 'today', now: NOW });

        expect(summary.first_activity_date).toBeNull();
        expect(prisma.device_usage_daily.aggregate).not.toHaveBeenCalled();
    });
});

describe('/progress/details with week_start', () => {
    const usageRow = {
        date: new Date('2026-09-01T00:00:00.000Z'),
        game_usage_seconds: 600,
        card_usage_seconds: 120,
        ai_talk_usage_seconds: 0,
        radio_usage_seconds: 0,
    };

    it('splits usage over the week only, with no month week-sections', async () => {
        prisma.device_usage_daily.findMany.mockResolvedValue([usageRow]);

        const details = await mobileService.getProgressDetails(UID, {
            metric: 'usage',
            period: 'week',
            week_start: '2026-08-31',
            now: NOW,
        });

        expect(details.total_seconds).toBe(720);
        expect(details.items.find(item => item.key === 'game').duration_seconds).toBe(600);
        expect(details.items.find(item => item.key === 'card').duration_seconds).toBe(120);
        expect(details).not.toHaveProperty('week_sections');
        expect(prisma.device_usage_daily.findMany).toHaveBeenCalledTimes(1);
        expect(prisma.device_usage_daily.findMany.mock.calls[0][0].where.date).toEqual(LAST_WEEK);
    });

    it('keeps the calendar month and its week-sections when no week is named', async () => {
        prisma.device_usage_daily.findMany.mockResolvedValue([usageRow]);

        const details = await mobileService.getProgressDetails(UID, {
            metric: 'usage',
            period: 'week',
            now: NOW,
        });

        expect(details.week_sections).toEqual([
            expect.objectContaining({ week: 1, total_seconds: 720 }),
        ]);
        expect(prisma.device_usage_daily.findMany.mock.calls[0][0].where.date).toEqual({
            gte: new Date('2026-09-01T00:00:00.000Z'),
            lte: new Date('2026-09-11T00:00:00.000Z'),
        });
    });

    it('lists the games played in the week', async () => {
        await mobileService.getProgressDetails(UID, {
            metric: 'games',
            period: 'week',
            week_start: '2026-08-31',
            now: NOW,
        });

        expect(prisma.device_games_played.count.mock.calls[0][0].where.activity_date).toEqual(LAST_WEEK);
        expect(prisma.device_games_played.findMany.mock.calls[0][0].where.activity_date).toEqual(LAST_WEEK);
    });

    it('reads card taps from a window around the week, without month week-sections', async () => {
        const details = await mobileService.getProgressDetails(UID, {
            metric: 'cards',
            period: 'week',
            week_start: '2026-08-31',
            now: NOW,
        });

        expect(details).not.toHaveProperty('week_sections');
        // One day of slack before and two after, re-filtered per row by zone.
        expect(prisma.device_analytics_event.findMany.mock.calls[0][0].where.server_received_at).toEqual({
            gte: new Date('2026-08-30T00:00:00.000Z'),
            lte: new Date('2026-09-08T00:00:00.000Z'),
        });
    });

    it('refuses week_start on period=today', async () => {
        await expect(mobileService.getProgressDetails(UID, {
            metric: 'usage',
            period: 'today',
            week_start: '2026-08-31',
            now: NOW,
        })).rejects.toMatchObject({ statusCode: 400 });
    });
});
