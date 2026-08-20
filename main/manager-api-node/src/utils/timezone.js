'use strict';

/**
 * One definition of "a day" for the whole API.
 *
 * Every analytics boundary — the daily rollups, the progress windows, the
 * week/month sections — is keyed on the parent's calendar day, never on the
 * container's. The container sets no TZ (Dockerfile) so it runs UTC, and
 * reading an instant with local getters would start an Indian parent's day at
 * 05:30 instead of midnight.
 *
 * parent_profile.timezone is nullable and no client writes it yet, so a NULL
 * falls back to DEFAULT_TIMEZONE rather than to UTC. Asia/Kolkata is the
 * shipped default because it is already what the parent-facing notification
 * jobs assume (jobs/usageSummaryNotification.js hardcodes it). Other markets
 * override it with DEFAULT_PARENT_TIMEZONE, or by storing a real zone on the
 * profile — a stored zone always wins over the default.
 */

// parent_profile.timezone is VARCHAR(50); a longer value would be truncated by
// the database into something Intl can no longer resolve.
const MAX_TIMEZONE_LENGTH = 50;

/**
 * Whether this runtime can actually bucket dates in `value`.
 *
 * Deliberately an Intl probe rather than an Intl.supportedValuesOf allowlist:
 * supportedValuesOf returns only canonical primary names, so it omits both
 * 'Asia/Kolkata' (it lists 'Asia/Calcutta') and 'UTC' — an allowlist would
 * reject the two zones this service uses most.
 */
function isValidTimezone(value) {
    if (typeof value !== 'string') return false;
    const name = value.trim();
    if (!name || name.length > MAX_TIMEZONE_LENGTH) return false;
    try {
        new Intl.DateTimeFormat('en-US', { timeZone: name });
        return true;
    } catch (error) {
        return false; // RangeError: not a zone this runtime knows
    }
}

const DEFAULT_TIMEZONE = isValidTimezone(process.env.DEFAULT_PARENT_TIMEZONE)
    ? process.env.DEFAULT_PARENT_TIMEZONE.trim()
    : 'Asia/Kolkata';

/** The zone to bucket by: the parent's when it is usable, the default otherwise. */
function resolveTimezone(value) {
    return isValidTimezone(value) ? value.trim() : DEFAULT_TIMEZONE;
}

/**
 * The YYYY-MM-DD that `value` falls on, in `timezone`.
 *
 * Never throws. A row that somehow holds an unusable zone falls back to the
 * default rather than turning every progress read for that account into a 500.
 */
function formatDateInTimezone(value, timezone = DEFAULT_TIMEZONE) {
    // Guarded explicitly: `new Date(null)` is the epoch, not an invalid date,
    // so an undated row would otherwise bucket silently into 1970.
    if (value == null) return null;
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return null;
    const parts = new Intl.DateTimeFormat('en-US', {
        timeZone: resolveTimezone(timezone),
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
    }).formatToParts(date);
    const year = parts.find(part => part.type === 'year')?.value;
    const month = parts.find(part => part.type === 'month')?.value;
    const day = parts.find(part => part.type === 'day')?.value;
    if (!year || !month || !day) return null;
    return `${year}-${month}-${day}`;
}

/**
 * The date a date-only (`@db.Date`) column holds.
 *
 * Prisma hands such a column back as midnight UTC, so it must be read with UTC
 * getters. Local getters agree only while the container runs UTC and silently
 * shift every row back a day the moment it does not.
 */
function dateOnlyKey(value) {
    if (!value) return null;
    if (value instanceof Date) {
        return Number.isNaN(value.getTime()) ? null : value.toISOString().slice(0, 10);
    }
    const text = String(value).slice(0, 10);
    return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : null;
}

function shiftDateKey(dateKey, deltaDays) {
    const date = new Date(`${dateKey}T00:00:00.000Z`);
    if (Number.isNaN(date.getTime())) return null;
    date.setUTCDate(date.getUTCDate() + deltaDays);
    return date.toISOString().slice(0, 10);
}

/** How far ahead of UTC `timezone` is at `instant`, in milliseconds. */
function zoneOffsetMs(instant, timezone) {
    const parts = new Intl.DateTimeFormat('en-US', {
        timeZone: resolveTimezone(timezone),
        hourCycle: 'h23',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
    }).formatToParts(instant);
    const at = type => Number(parts.find(part => part.type === type)?.value);
    const wallAsUtc = Date.UTC(at('year'), at('month') - 1, at('day'), at('hour'), at('minute'), at('second'));
    return wallAsUtc - instant.getTime();
}

/**
 * The instant at which the local day `dateKey` begins in `timezone`.
 *
 * Needed wherever a local day has to be pushed down into SQL against an
 * instant column — filtering in JS instead would make a paginated count wrong.
 * Where the day is bucketed in JS, prefer formatDateInTimezone on each row.
 *
 * The offset is read twice: once at the wall time and once at the resulting
 * instant. A DST jump moves it between the two, and one correction settles
 * every real zone. On a spring-forward day whose midnight does not exist this
 * lands on the first instant that does, which is the day's true start.
 */
function startOfDayInstant(dateKey, timezone) {
    const wallAsUtc = new Date(`${dateKey}T00:00:00.000Z`);
    if (Number.isNaN(wallAsUtc.getTime())) return null;
    const firstGuess = new Date(wallAsUtc.getTime() - zoneOffsetMs(wallAsUtc, timezone));
    return new Date(wallAsUtc.getTime() - zoneOffsetMs(firstGuess, timezone));
}

/** The instant the local day `dateKey` ends, exclusive. */
function endOfDayInstantExclusive(dateKey, timezone) {
    const next = shiftDateKey(dateKey, 1);
    return next ? startOfDayInstant(next, timezone) : null;
}

module.exports = {
    DEFAULT_TIMEZONE,
    MAX_TIMEZONE_LENGTH,
    isValidTimezone,
    resolveTimezone,
    formatDateInTimezone,
    dateOnlyKey,
    shiftDateKey,
    startOfDayInstant,
    endOfDayInstantExclusive,
};
