'use strict';

/**
 * Where the analytics day is cut.
 *
 * The reported bug: a parent's "today" ran 05:30 → 05:30 IST, because
 * parent_profile.timezone is NULL on every account and the fallback was UTC.
 * These fix that boundary in place and hold every reader to the same one.
 */

jest.mock('../../src/config/database', () => ({
    prisma: {
        sys_user: { findUnique: jest.fn() },
        parent_profile: { upsert: jest.fn(), findUnique: jest.fn() },
        ai_device: { findMany: jest.fn(), findUnique: jest.fn() },
        kid_profile: { findFirst: jest.fn() },
        device_analytics_event: { findMany: jest.fn(), findFirst: jest.fn() },
        device_usage_daily: { findMany: jest.fn() },
        device_card_taps_daily: { findMany: jest.fn() },
        device_ai_interactions_daily: { findMany: jest.fn() },
        device_games_played: { findMany: jest.fn(), count: jest.fn() },
        device_radio_played: { findMany: jest.fn(), count: jest.fn() },
        voice_sessions: { findMany: jest.fn(), count: jest.fn(), groupBy: jest.fn() },
        ai_agent: { findMany: jest.fn(), findUnique: jest.fn() },
        rfid_card_mapping: { findMany: jest.fn() },
        rfid_content_pack: { findMany: jest.fn() },
    },
}));

const { prisma } = require('../../src/config/database');
const mobileService = require('../../src/services/mobile.service');

const MAC = 'AA:BB:CC:DD:EE:FF';

function accountWithTimezone(timezone) {
    prisma.sys_user.findUnique.mockResolvedValue({
        id: 1n,
        firebase_uid: 'firebase-user-1',
        parent_profile: timezone === undefined ? null : { timezone },
    });
    prisma.ai_device.findMany.mockResolvedValue([{ id: 'device-1', mac_address: MAC }]);
}

beforeEach(() => {
    jest.clearAllMocks();
    prisma.kid_profile.findFirst.mockResolvedValue(null);
    prisma.ai_device.findUnique.mockResolvedValue(null);
    prisma.parent_profile.findUnique.mockResolvedValue(null);
    prisma.device_analytics_event.findMany.mockResolvedValue([]);
    prisma.device_analytics_event.findFirst.mockResolvedValue(null);
    prisma.device_usage_daily.findMany.mockResolvedValue([]);
    prisma.device_card_taps_daily.findMany.mockResolvedValue([]);
    prisma.device_ai_interactions_daily.findMany.mockResolvedValue([]);
    prisma.device_games_played.findMany.mockResolvedValue([]);
    prisma.device_games_played.count.mockResolvedValue(0);
    prisma.device_radio_played.findMany.mockResolvedValue([]);
    prisma.device_radio_played.count.mockResolvedValue(0);
    prisma.voice_sessions.findMany.mockResolvedValue([]);
    prisma.voice_sessions.count.mockResolvedValue(0);
    prisma.voice_sessions.groupBy.mockResolvedValue([]);
    prisma.ai_agent.findMany.mockResolvedValue([]);
    prisma.rfid_card_mapping.findMany.mockResolvedValue([]);
    prisma.rfid_content_pack.findMany.mockResolvedValue([]);
});

describe('the parent day, with no timezone stored on the account', () => {
    // 19:00 UTC on the 19th is 00:30 IST on the 20th — half an hour into the
    // new day for the parent, and the hour that used to report as yesterday.
    const justAfterMidnightIst = new Date('2026-08-19T19:00:00.000Z');
    // 23:45 UTC is 05:15 IST, the last stretch of the old UTC-shifted day.
    const beforeTheOldUtcRollover = new Date('2026-08-19T23:45:00.000Z');

    it('starts the new day at midnight IST, not at 05:30', async () => {
        accountWithTimezone(undefined);

        const summary = await mobileService.getProgressSummary('firebase-user-1', {
            period: 'today',
            now: justAfterMidnightIst,
        });

        expect(summary.timezone).toBe('Asia/Kolkata');
        expect(summary.start_date).toBe('2026-08-20');
        expect(summary.end_date).toBe('2026-08-20');
    });

    it('still calls 05:15 IST the same day, so the day does not roll at 05:30', async () => {
        accountWithTimezone(undefined);

        const summary = await mobileService.getProgressSummary('firebase-user-1', {
            period: 'today',
            now: beforeTheOldUtcRollover,
        });

        expect(summary.start_date).toBe('2026-08-20');
    });

    it('asks the daily rollups for the parent day, keyed as UTC midnight', async () => {
        accountWithTimezone(undefined);

        await mobileService.getProgressSummary('firebase-user-1', {
            period: 'today',
            now: justAfterMidnightIst,
        });

        expect(prisma.device_usage_daily.findMany.mock.calls[0][0].where.date).toEqual({
            gte: new Date('2026-08-20T00:00:00.000Z'),
            lte: new Date('2026-08-20T00:00:00.000Z'),
        });
    });
});

describe('the parent day, with a timezone stored on the account', () => {
    it('uses the stored zone over the default', async () => {
        accountWithTimezone('America/New_York');

        const summary = await mobileService.getProgressSummary('firebase-user-1', {
            period: 'today',
            now: new Date('2026-08-19T19:00:00.000Z'), // 15:00 in New York, still the 19th
        });

        expect(summary.timezone).toBe('America/New_York');
        expect(summary.start_date).toBe('2026-08-19');
    });

    it('does not 500 the account when the stored zone is unusable', async () => {
        accountWithTimezone('Not/AZone');

        const summary = await mobileService.getProgressSummary('firebase-user-1', {
            period: 'today',
            now: new Date('2026-08-19T19:00:00.000Z'),
        });

        expect(summary.timezone).toBe('Asia/Kolkata');
        expect(summary.start_date).toBe('2026-08-20');
    });
});

describe('the trend, read from date-only rollup columns', () => {
    // A @db.Date column comes back as midnight UTC. Reading it with local
    // getters put every point on the wrong day for any container west of UTC.
    it('keys each point off the stored date whatever the container clock is', async () => {
        accountWithTimezone('America/New_York');
        prisma.device_card_taps_daily.findMany.mockResolvedValue([
            { date: new Date('2026-08-18T00:00:00.000Z'), card_tap_count: 4 },
        ]);

        const trend = await mobileService.getProgressTrend('firebase-user-1', {
            period: 'month',
            now: new Date('2026-08-19T19:00:00.000Z'),
        });

        const point = trend.points.find(entry => entry.date === '2026-08-18');
        expect(point.card_tap_count).toBe(4);
        expect(trend.points.filter(entry => entry.card_tap_count > 0)).toHaveLength(1);
    });
});

describe('the detail screens agree with the summary above them', () => {
    // A card tapped at 01:00 IST on the 4th: the 3rd in UTC, the 4th for the
    // parent. Both detail endpoints must place it in the parent's week.
    const tapJustAfterMidnightIst = new Date('2026-08-03T19:30:00.000Z');
    const now = new Date('2026-08-19T10:00:00.000Z');

    const cardEvent = {
        event_name: 'card_session_start',
        rfid_uid: 'CARD123',
        content_id: null,
        content_type: null,
        game_id: null,
        station: null,
        duration_ms: null,
        data: {},
        server_received_at: tapJustAfterMidnightIst,
    };

    it('puts the tap in the same week on /homepage-activity/details and /progress/details', async () => {
        accountWithTimezone(undefined);
        prisma.device_analytics_event.findMany.mockResolvedValue([cardEvent]);

        const homepage = await mobileService.getHomepageActivityDetails('firebase-user-1', {
            metric: 'cards',
            period: 'week',
            now,
        });
        const progress = await mobileService.getProgressDetails('firebase-user-1', {
            metric: 'cards',
            period: 'week',
            now,
        });

        expect(homepage.week_sections.map(section => section.week))
            .toEqual(progress.week_sections.map(section => section.week));
        // Weeks are Monday-anchored and 1 August 2026 is a Saturday, so the
        // 4th falls in week 2. Read as the container's UTC day the tap would be
        // the 3rd, which is week 1 — this is the shift the fix makes.
        expect(homepage.week_sections).toEqual([
            expect.objectContaining({ week: 2, label: 'Week 2', total: 1 }),
        ]);
    });

    it('fetches a window wide enough to contain the parent day it reports on', async () => {
        accountWithTimezone(undefined);

        await mobileService.getHomepageActivityDetails('firebase-user-1', {
            metric: 'cards',
            period: 'week',
            now,
        });

        // August in the parent's zone, one day of slack before and two after.
        expect(prisma.device_analytics_event.findMany.mock.calls[0][0].where.server_received_at)
            .toEqual({
                gte: new Date('2026-07-31T00:00:00.000Z'),
                lte: new Date('2026-08-21T00:00:00.000Z'),
            });
    });
});

describe('the month rolls over on the parent clock too', () => {
    // 19:00 UTC on 31 July is 00:30 IST on 1 August. The month the detail
    // screen reports on is the parent's, so it is August.
    const justAfterMonthEndIst = new Date('2026-07-31T19:00:00.000Z');

    it('reports the new month, not the one the container is still in', async () => {
        accountWithTimezone(undefined);

        await mobileService.getHomepageActivityDetails('firebase-user-1', {
            metric: 'cards',
            period: 'week',
            now: justAfterMonthEndIst,
        });

        expect(prisma.device_analytics_event.findMany.mock.calls[0][0].where.server_received_at)
            .toEqual({
                gte: new Date('2026-07-31T00:00:00.000Z'), // 1 Aug, one day of slack
                lte: new Date('2026-08-03T00:00:00.000Z'), // 1 Aug, two days of slack
            });
    });

    it('labels the period with the parent month', async () => {
        accountWithTimezone(undefined);

        const result = await mobileService.getHomepageActivityDetails('firebase-user-1', {
            metric: 'cards',
            period: 'week',
            now: justAfterMonthEndIst,
        });

        expect(result.period_label).toBe('August, 2026');
    });
});

describe('what may be written to parent_profile.timezone', () => {
    beforeEach(() => {
        prisma.sys_user.findUnique.mockResolvedValue({ id: 1n, email: 'parent@example.com' });
        prisma.parent_profile.upsert.mockImplementation(({ update }) => Promise.resolve(update));
    });

    it('stores an IANA zone', async () => {
        const saved = await mobileService.updateParentProfile('firebase-user-1', {
            timezone: 'America/New_York',
        });
        expect(saved.timezone).toBe('America/New_York');
    });

    it('trims before storing, so the column holds something Intl can resolve', async () => {
        const saved = await mobileService.updateParentProfile('firebase-user-1', {
            timezone: '  Asia/Kolkata  ',
        });
        expect(saved.timezone).toBe('Asia/Kolkata');
    });

    it.each(['+05:30', 'GMT+5', 'Not/AZone', 'A'.repeat(60)])(
        'refuses %p rather than letting it 500 every later read',
        async value => {
            await expect(mobileService.updateParentProfile('firebase-user-1', { timezone: value }))
                .rejects.toMatchObject({ statusCode: 400 });
            expect(prisma.parent_profile.upsert).not.toHaveBeenCalled();
        }
    );

    it.each([null, ''])('ignores %p rather than clearing a zone that works', async value => {
        await mobileService.updateParentProfile('firebase-user-1', {
            timezone: value,
            phone_number: '555',
        });
        expect(prisma.parent_profile.upsert.mock.calls[0][0].update).not.toHaveProperty('timezone');
    });
});

describe('a day of chat, asked for by date', () => {
    beforeEach(() => {
        prisma.ai_agent.findMany.mockResolvedValue([{ id: 'quizzy-id' }]);
    });

    it('bounds the query on the parent local day, half-open', async () => {
        accountWithTimezone(undefined);
        prisma.kid_profile.findFirst.mockResolvedValue({ id: 15n });
        prisma.ai_device.findMany.mockResolvedValue([{ id: 'device-1', mac_address: MAC, kid_id: 15n }]);

        const page = await mobileService.getKidCharacterSessions('firebase-user-1', '15', 'quizzy-id', {
            date: '2026-08-20',
        });

        expect(prisma.voice_sessions.findMany.mock.calls[0][0].where.started_at).toEqual({
            gte: new Date('2026-08-19T18:30:00.000Z'),
            lt: new Date('2026-08-20T18:30:00.000Z'),
        });
        // The count is bounded the same way, or the total would not match the list.
        expect(prisma.voice_sessions.count.mock.calls[0][0].where.started_at).toEqual({
            gte: new Date('2026-08-19T18:30:00.000Z'),
            lt: new Date('2026-08-20T18:30:00.000Z'),
        });
        expect(page).toMatchObject({ timezone: 'Asia/Kolkata', start_date: '2026-08-20', end_date: '2026-08-20' });
    });

    it('accepts an open-ended span', async () => {
        accountWithTimezone(undefined);
        prisma.kid_profile.findFirst.mockResolvedValue({ id: 15n });
        prisma.ai_device.findMany.mockResolvedValue([{ id: 'device-1', mac_address: MAC, kid_id: 15n }]);

        await mobileService.getKidCharacterSessions('firebase-user-1', '15', 'quizzy-id', {
            from: '2026-08-18',
        });

        expect(prisma.voice_sessions.findMany.mock.calls[0][0].where.started_at).toEqual({
            gte: new Date('2026-08-17T18:30:00.000Z'),
        });
    });

    it('leaves the query unbounded when no date is asked for', async () => {
        accountWithTimezone(undefined);
        prisma.kid_profile.findFirst.mockResolvedValue({ id: 15n });
        prisma.ai_device.findMany.mockResolvedValue([{ id: 'device-1', mac_address: MAC, kid_id: 15n }]);

        await mobileService.getKidCharacterSessions('firebase-user-1', '15', 'quizzy-id', {});

        expect(prisma.voice_sessions.findMany.mock.calls[0][0].where).not.toHaveProperty('started_at');
    });

    it.each(['20-08-2026', 'yesterday', '2026-8-20'])('rejects %p', async value => {
        accountWithTimezone(undefined);
        prisma.kid_profile.findFirst.mockResolvedValue({ id: 15n });
        prisma.ai_device.findMany.mockResolvedValue([{ id: 'device-1', mac_address: MAC, kid_id: 15n }]);

        await expect(mobileService.getKidCharacterSessions('firebase-user-1', '15', 'quizzy-id', { date: value }))
            .rejects.toMatchObject({ statusCode: 400 });
    });
});
