'use strict';

const {
    DEFAULT_TIMEZONE,
    isValidTimezone,
    resolveTimezone,
    formatDateInTimezone,
    dateOnlyKey,
    startOfDayInstant,
    endOfDayInstantExclusive,
} = require('../../src/utils/timezone');

describe('timezone: what may be stored', () => {
    it('accepts IANA zone names', () => {
        expect(isValidTimezone('Asia/Kolkata')).toBe(true);
        expect(isValidTimezone('America/New_York')).toBe(true);
        expect(isValidTimezone('UTC')).toBe(true);
    });

    it('rejects the things a client is most likely to send instead', () => {
        expect(isValidTimezone('+05:30')).toBe(false);   // an offset, not a zone
        expect(isValidTimezone('GMT+5')).toBe(false);
        expect(isValidTimezone('Not/AZone')).toBe(false);
        expect(isValidTimezone('')).toBe(false);
        expect(isValidTimezone('   ')).toBe(false);
        expect(isValidTimezone(null)).toBe(false);
        expect(isValidTimezone(undefined)).toBe(false);
        expect(isValidTimezone(5.5)).toBe(false);
    });

    it('rejects anything the VARCHAR(50) column would truncate', () => {
        expect(isValidTimezone('A'.repeat(51))).toBe(false);
    });

    // Documenting rather than asserting a preference: ICU resolves the legacy
    // abbreviation, so it is storable and reads back as the right day. The
    // validator's job is only that nothing unresolvable gets in.
    it('accepts the abbreviation ICU still resolves', () => {
        expect(isValidTimezone('IST')).toBe(true);
        expect(formatDateInTimezone('2026-08-20T20:00:00.000Z', 'IST')).toBe('2026-08-21');
    });
});

describe('timezone: which zone a read buckets by', () => {
    it('uses the stored zone when there is one', () => {
        expect(resolveTimezone('America/New_York')).toBe('America/New_York');
    });

    it('falls back to the default for a NULL, which is every account today', () => {
        expect(resolveTimezone(null)).toBe(DEFAULT_TIMEZONE);
        expect(resolveTimezone(undefined)).toBe(DEFAULT_TIMEZONE);
        expect(resolveTimezone('')).toBe(DEFAULT_TIMEZONE);
    });

    it('falls back rather than throwing on a zone already in the database', () => {
        expect(resolveTimezone('Not/AZone')).toBe(DEFAULT_TIMEZONE);
    });

    it('ships Asia/Kolkata, matching what the notification jobs assume', () => {
        expect(DEFAULT_TIMEZONE).toBe('Asia/Kolkata');
    });
});

describe('timezone: the day an instant falls on', () => {
    it('cuts the day at local midnight, not at UTC midnight', () => {
        // 20:00 UTC is already the 21st in India.
        expect(formatDateInTimezone('2026-08-20T20:00:00.000Z', 'Asia/Kolkata')).toBe('2026-08-21');
        expect(formatDateInTimezone('2026-08-20T20:00:00.000Z', 'UTC')).toBe('2026-08-20');
        // ...and still the 20th in New York.
        expect(formatDateInTimezone('2026-08-20T20:00:00.000Z', 'America/New_York')).toBe('2026-08-20');
    });

    it('is the fix for the reported symptom: 01:00 IST is already the new day', () => {
        const oneAmIst = '2026-08-19T19:30:00.000Z';
        expect(formatDateInTimezone(oneAmIst, 'Asia/Kolkata')).toBe('2026-08-20');
        expect(formatDateInTimezone(oneAmIst, 'UTC')).toBe('2026-08-19'); // what parents saw
    });

    it('never throws on a bad zone — a read must not 500 an account', () => {
        expect(() => formatDateInTimezone('2026-08-20T20:00:00.000Z', 'Not/AZone')).not.toThrow();
        expect(formatDateInTimezone('2026-08-20T20:00:00.000Z', 'Not/AZone')).toBe('2026-08-21');
    });

    it('returns null for an instant that is not one', () => {
        expect(formatDateInTimezone('not a date', 'UTC')).toBeNull();
        expect(formatDateInTimezone(null, 'UTC')).toBeNull();
    });
});

describe('timezone: reading a date-only column', () => {
    // Prisma hands a @db.Date column back as midnight UTC. Local getters agree
    // only while the container runs UTC.
    it('keys a date-only column the same whatever the container clock is', () => {
        expect(dateOnlyKey(new Date('2026-08-20T00:00:00.000Z'))).toBe('2026-08-20');
        expect(dateOnlyKey('2026-08-20')).toBe('2026-08-20');
        expect(dateOnlyKey('2026-08-20T00:00:00.000Z')).toBe('2026-08-20');
    });

    it('returns null rather than a wrong day for junk', () => {
        expect(dateOnlyKey(null)).toBeNull();
        expect(dateOnlyKey('')).toBeNull();
        expect(dateOnlyKey('not-a-date')).toBeNull();
        expect(dateOnlyKey(new Date('nope'))).toBeNull();
    });
});

describe('timezone: where a local day starts and ends', () => {
    const iso = value => value.toISOString();

    it('handles a whole-hour zone ahead of UTC', () => {
        expect(iso(startOfDayInstant('2026-08-20', 'Asia/Kolkata'))).toBe('2026-08-19T18:30:00.000Z');
        expect(iso(endOfDayInstantExclusive('2026-08-20', 'Asia/Kolkata'))).toBe('2026-08-20T18:30:00.000Z');
    });

    it('handles a three-quarter-hour zone, which whole-hour maths would miss', () => {
        expect(iso(startOfDayInstant('2026-08-20', 'Asia/Kathmandu'))).toBe('2026-08-19T18:15:00.000Z');
    });

    it('handles a zone behind UTC, where the local day ends after UTC midnight', () => {
        expect(iso(startOfDayInstant('2026-08-20', 'Pacific/Honolulu'))).toBe('2026-08-20T10:00:00.000Z');
        expect(iso(endOfDayInstantExclusive('2026-08-20', 'Pacific/Honolulu'))).toBe('2026-08-21T10:00:00.000Z');
    });

    it('follows the offset across both DST transitions', () => {
        // Spring forward: the 8th starts on EST, the 9th on EDT.
        expect(iso(startOfDayInstant('2026-03-08', 'America/New_York'))).toBe('2026-03-08T05:00:00.000Z');
        expect(iso(startOfDayInstant('2026-03-09', 'America/New_York'))).toBe('2026-03-09T04:00:00.000Z');
        // Fall back: the 1st starts on EDT, the 2nd on EST.
        expect(iso(startOfDayInstant('2026-11-01', 'America/New_York'))).toBe('2026-11-01T04:00:00.000Z');
        expect(iso(startOfDayInstant('2026-11-02', 'America/New_York'))).toBe('2026-11-02T05:00:00.000Z');
    });

    it('spans exactly one day, so a half-open window neither drops nor repeats', () => {
        const start = startOfDayInstant('2026-08-20', 'Asia/Kolkata');
        const end = endOfDayInstantExclusive('2026-08-20', 'Asia/Kolkata');
        expect(end - start).toBe(24 * 60 * 60 * 1000);
        expect(formatDateInTimezone(start, 'Asia/Kolkata')).toBe('2026-08-20');
        expect(formatDateInTimezone(new Date(end - 1), 'Asia/Kolkata')).toBe('2026-08-20');
        expect(formatDateInTimezone(end, 'Asia/Kolkata')).toBe('2026-08-21');
    });
});
