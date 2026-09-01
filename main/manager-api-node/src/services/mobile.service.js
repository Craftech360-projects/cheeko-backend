const { prisma } = require('../config/database');
const logger = require('../utils/logger');
const { ApiError } = require('../middleware/errorHandler');
const { normalizeMacAddress, packCodeForKid } = require('../utils/helpers');
const { normalizeCharacterName } = require('./character-resolver');
const {
    isValidTimezone,
    resolveTimezone,
    formatDateInTimezone,
    dateOnlyKey,
    shiftDateKey,
    startOfDayInstant,
    endOfDayInstantExclusive,
} = require('../utils/timezone');

const CARD_TAP_DEBOUNCE_MS = 60 * 1000;

// ─── Parent Profile ─────────────────────────────────────────────────────────

function dateOrNull(value) {
    return value ? new Date(value) : null;
}

function ageFromBirthDate(value) {
    if (!value) return null;
    const birthDate = new Date(value);
    if (Number.isNaN(birthDate.getTime())) return null;
    const today = new Date();
    let age = today.getFullYear() - birthDate.getFullYear();
    const monthDelta = today.getMonth() - birthDate.getMonth();
    if (monthDelta < 0 || (monthDelta === 0 && today.getDate() < birthDate.getDate())) age--;
    return age;
}

function positiveDurationMs(value) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric) || numeric <= 0) return 0;
    return Math.trunc(numeric);
}

function completedMinuteSeconds(value) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric) || numeric <= 0) return 0;
    return Math.floor(numeric / 60) * 60;
}

function positiveSeconds(value) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric) || numeric <= 0) return 0;
    return Math.trunc(numeric);
}

const USAGE_CATEGORY_KEYS = [
    'game_usage_seconds',
    'card_usage_seconds',
    'ai_talk_usage_seconds',
    'radio_usage_seconds',
];

/**
 * The seconds a rollup row holds, unrounded.
 *
 * Rounding belongs to the total about to be shown, not to the row. Flooring
 * each category of each row threw away up to 59 seconds four times per device
 * per day, so a day of card taps and quick games could report zero while the
 * same row held real usage. Callers sum these and floor once, with
 * completedMinuteSeconds, at whatever granularity they display.
 */
function rawUsageSecondsFromRow(row) {
    const hasCategoryUsage = USAGE_CATEGORY_KEYS.some(key => row[key] != null);
    if (hasCategoryUsage) {
        return USAGE_CATEGORY_KEYS.reduce((sum, key) => sum + positiveSeconds(row[key]), 0);
    }
    return positiveSeconds(row.usage_time_seconds);
}

function completedUsageSecondsForRows(rows) {
    return completedMinuteSeconds(
        (rows || []).reduce((sum, row) => sum + rawUsageSecondsFromRow(row), 0)
    );
}

/**
 * Round each trend bar once, after every device's row for that day is in.
 *
 * A family with two toys would otherwise lose up to a minute per toy per day.
 */
function finalizeTrendPoints(trendMap) {
    return Array.from(trendMap.values()).map(point => {
        const usageTimeSeconds = completedMinuteSeconds(point.usage_time_seconds);
        point.usage_time_seconds = usageTimeSeconds;
        point.usageTimeSeconds = usageTimeSeconds;
        return point;
    });
}

function safeObject(value) {
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function cleanKnownValue(value) {
    if (value == null) return null;
    const text = String(value).trim();
    if (!text) return null;
    const normalized = text.toLowerCase();
    if (['unknown', 'null', 'undefined', 'n/a', 'na'].includes(normalized)) return null;
    return text;
}

function firstKnownValue(...values) {
    for (const value of values) {
        const known = cleanKnownValue(value);
        if (known) return known;
    }
    return null;
}

function humanizeKey(value) {
    const raw = value == null ? '' : String(value).trim();
    if (!raw) return 'Unknown';
    const normalized = /^[A-Z0-9_:-]+$/.test(raw) ? raw.toLowerCase() : raw;
    return normalized
        .replace(/^game:/, '')
        .replace(/^card:/, '')
        .replace(/^content:/, '')
        .replace(/^radio:/, '')
        .replace(/[_-]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .replace(/\b\w/g, char => char.toUpperCase());
}

function getMonthKeyFromReference(value, timezone) {
    if (typeof value === 'string' && /^\d{4}-\d{2}$/.test(value)) return value;
    if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}/.test(value)) return value.slice(0, 7);
    return getEventMonthKey({ server_received_at: value || new Date() }, timezone);
}

function monthStartDateKey(monthKey) {
    const [year, month] = String(monthKey).split('-').map(Number);
    if (!year || !month || month < 1 || month > 12) return null;
    return `${monthKey}-01`;
}

function monthEndDateKey(monthKey) {
    const [year, month] = String(monthKey).split('-').map(Number);
    if (!year || !month || month < 1 || month > 12) return null;
    // Day 0 of the next month is the last day of this one.
    return new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);
}

function shiftMonthKey(monthKey, deltaMonths) {
    const [year, month] = String(monthKey).split('-').map(Number);
    if (!year || !month) return null;
    const index = (year * 12 + (month - 1)) + deltaMonths;
    return `${String(Math.floor(index / 12)).padStart(4, '0')}-${String((index % 12) + 1).padStart(2, '0')}`;
}

/**
 * The window /homepage-activity/details reports on, as date keys in the
 * parent's zone.
 *
 * Date keys rather than instants, because the rows are then re-bucketed per
 * row by the same zone — the widened instant window below only has to cover
 * the range, not define it. That is the shape the /progress/* family already
 * uses, so the summary and the detail behind it now cut the day in the same
 * place.
 */
function getActivityDetailsRange(period, timezone, now = new Date(), selectedMonth = null) {
    const today = formatDateInTimezone(now, timezone);
    const currentMonthKey = today.slice(0, 7);

    if (period === 'month') {
        // Twelve calendar months back to the 1st, ending today.
        const startMonthKey = shiftMonthKey(currentMonthKey, -11);
        return {
            startDate: monthStartDateKey(startMonthKey),
            endDate: today,
            monthKey: currentMonthKey,
        };
    }

    // 'week' reports one calendar month, split into weeks.
    const monthKey = getMonthKeyFromReference(selectedMonth || today, timezone);
    return {
        startDate: monthStartDateKey(monthKey),
        endDate: monthKey === currentMonthKey ? today : monthEndDateKey(monthKey),
        monthKey,
    };
}

const PROGRESS_PERIODS = ['today', 'week', 'month'];
const PROGRESS_DETAIL_METRICS = ['usage', 'cards', 'games', 'ai', 'radio'];

function dateOnlyFromKey(dateKey) {
    return new Date(`${dateKey}T00:00:00.000Z`);
}

function rangeContainsDateKey(range, dateKey) {
    return Boolean(dateKey) && dateKey >= range.startDate && dateKey <= range.endDate;
}

/**
 * The UTC window that is certain to contain every instant belonging to the
 * range's local days, for any zone.
 *
 * A local day D in a zone offset O spans UTC [D 00:00 - O, D 24:00 - O). Zone
 * offsets run from -12 to +14, so one day of slack at the start and two at the
 * end cover every zone. The rows are re-filtered per row afterwards, so being
 * wide costs a few extra rows and nothing else — being narrow would drop a
 * whole local evening for any zone behind UTC.
 */
function rangeInstantWindow(range) {
    return {
        gte: dateOnlyFromKey(shiftDateKey(range.startDate, -1)),
        lte: dateOnlyFromKey(shiftDateKey(range.endDate, 2)),
    };
}

async function countRawGameStartsForRange(scope, range) {
    if (!range.startDate || !scope.macAddresses || scope.macAddresses.length === 0) return 0;

    const rows = await prisma.device_analytics_event.findMany({
        where: {
            ...progressOwnerFilter(scope),
            event_name: 'game_start',
            server_received_at: rangeInstantWindow(range),
        },
        select: { server_received_at: true },
    });

    return (rows || []).filter(row => rangeContainsDateKey(
        range,
        formatDateInTimezone(row.server_received_at, scope.timezone)
    )).length;
}

async function getProgressEventsForRange(scope, range, eventName) {
    if (!range.startDate || !scope.macAddresses || scope.macAddresses.length === 0) return [];
    const eventNameWhere = Array.isArray(eventName) ? { in: eventName } : eventName;

    const rows = await prisma.device_analytics_event.findMany({
        where: {
            ...progressOwnerFilter(scope),
            event_name: eventNameWhere,
            server_received_at: rangeInstantWindow(range),
        },
        select: {
            mac_address: true,
            event_name: true,
            server_received_at: true,
            event_timestamp: true,
            rfid_uid: true,
            content_id: true,
            content_type: true,
            data: true,
        },
        orderBy: { server_received_at: 'desc' },
        take: 5000,
    });

    return (rows || []).filter(row => rangeContainsDateKey(
        range,
        formatDateInTimezone(row.server_received_at, scope.timezone)
    ));
}

function buildProgressDateRange(period, timezone, now = new Date()) {
    const today = formatDateInTimezone(now, timezone);
    if (period === 'month') {
        const monthKey = getMonthKeyFromReference(today, timezone);
        const startDate = `${monthKey}-01`;
        const dates = [];
        for (let dateKey = startDate; dateKey <= today; dateKey = shiftDateKey(dateKey, 1)) {
            dates.push(dateKey);
        }
        return {
            startDate,
            endDate: today,
            dates,
            monthKey,
        };
    }

    const totalDays = period === 'today' ? 1 : 7;
    const dates = [];
    for (let i = totalDays - 1; i >= 0; i -= 1) {
        dates.push(shiftDateKey(today, -i));
    }
    return {
        startDate: dates[0],
        endDate: dates[dates.length - 1],
        dates,
    };
}

function buildProgressCalendarMonthRange(timezone, now = new Date(), selectedMonth = null) {
    const today = formatDateInTimezone(now, timezone);
    const currentMonthKey = today.slice(0, 7);
    const monthKey = getMonthKeyFromReference(selectedMonth || today, timezone);
    const startDate = monthStartDateKey(monthKey);
    const endDate = monthKey === currentMonthKey
        ? today
        : monthEndDateKey(monthKey);
    const dates = [];
    for (let dateKey = startDate; dateKey <= endDate; dateKey = shiftDateKey(dateKey, 1)) {
        dates.push(dateKey);
    }
    return {
        startDate,
        endDate,
        dates,
        monthKey,
    };
}

function parsePagination(options = {}) {
    const page = Math.max(1, parseInt(options.page, 10) || 1);
    const rawLimit = parseInt(options.limit, 10);
    const limit = Math.min(200, Math.max(1, Number.isFinite(rawLimit) ? rawLimit : 20));
    return { page, limit, offset: (page - 1) * limit };
}

function sumBy(rows, field) {
    return (rows || []).reduce((total, row) => total + (Number(row[field]) || 0), 0);
}

function getEventTimeMs(event) {
    const value = event?.event_timestamp || event?.server_received_at;
    const time = value ? new Date(value).getTime() : 0;
    return Number.isFinite(time) ? time : 0;
}

function debounceCardTapEvents(events, debounceMs = CARD_TAP_DEBOUNCE_MS) {
    const accepted = [];
    const lastSeenByCard = new Map();
    const sorted = [...(events || [])].sort((a, b) => getEventTimeMs(a) - getEventTimeMs(b));
    for (const event of sorted) {
        if (event.event_name !== 'card_session_start') continue;
        const { key } = resolveCardKeyAndName(event);
        const eventTime = getEventTimeMs(event);
        const lastTime = lastSeenByCard.get(key);
        lastSeenByCard.set(key, eventTime);
        if (lastTime == null || eventTime - lastTime > debounceMs) {
            accepted.push(event);
        }
    }
    return accepted;
}

function usageCategoryItemsFromDailyRows(rows) {
    const totals = {
        game: completedMinuteSeconds(sumBy(rows, 'game_usage_seconds')),
        card: completedMinuteSeconds(sumBy(rows, 'card_usage_seconds')),
        ai_talk: completedMinuteSeconds(sumBy(rows, 'ai_talk_usage_seconds')),
        radio: completedMinuteSeconds(sumBy(rows, 'radio_usage_seconds')),
    };
    const items = [
        { key: 'game', name: 'Game', duration_seconds: totals.game, durationSeconds: totals.game },
        { key: 'card', name: 'Card', duration_seconds: totals.card, durationSeconds: totals.card },
        { key: 'ai_talk', name: 'AI Talk', duration_seconds: totals.ai_talk, durationSeconds: totals.ai_talk },
        { key: 'radio', name: 'Radio', duration_seconds: totals.radio, durationSeconds: totals.radio },
    ];
    return {
        // Floored once over the unrounded total so this agrees with the
        // progress summary for the same window. Each item rounds on its own,
        // so the items can add up to slightly less than the total.
        totalSeconds: completedUsageSecondsForRows(rows),
        items,
    };
}

function getDailyUsageRowDateKey(row) {
    return dateOnlyKey(row && row.date);
}

function getWeekInMonthFromDateKey(dateKey) {
    const day = Number(String(dateKey).slice(8, 10));
    if (!day) return null;
    const monthStart = new Date(`${String(dateKey).slice(0, 7)}-01T00:00:00.000Z`);
    if (Number.isNaN(monthStart.getTime())) return null;
    const leadingDaysBeforeFirstMonday = (monthStart.getUTCDay() + 6) % 7;
    return Math.floor((day + leadingDaysBeforeFirstMonday - 1) / 7) + 1;
}

function buildUsageWeekSectionsFromDailyRows(rows, monthReference, timezone) {
    const monthKey = getMonthKeyFromReference(monthReference, timezone);
    const grouped = new Map();
    for (const row of rows || []) {
        const dateKey = getDailyUsageRowDateKey(row);
        if (!dateKey || dateKey.slice(0, 7) !== monthKey) continue;
        const week = getWeekInMonthFromDateKey(dateKey);
        if (!week) continue;
        if (!grouped.has(week)) grouped.set(week, []);
        grouped.get(week).push(row);
    }
    return Array.from(grouped.entries())
        .sort(([left], [right]) => left - right)
        .map(([week, weekRows]) => {
            const { items, totalSeconds } = usageCategoryItemsFromDailyRows(weekRows);
            return {
                label: `Week ${week}`,
                week,
                total_seconds: totalSeconds,
                totalSeconds,
                items,
            };
        });
}

function incrementCount(grouped, key, name, amount = 1) {
    const resolvedKey = key || 'unknown';
    const current = grouped.get(resolvedKey) || { key: resolvedKey, name: name || humanizeKey(resolvedKey), count: 0 };
    current.count += amount;
    if ((!current.name || current.name === humanizeKey(resolvedKey)) && name) current.name = name;
    grouped.set(resolvedKey, current);
}

function incrementDuration(grouped, key, name, durationMs) {
    const resolvedKey = key || 'unknown';
    const current = grouped.get(resolvedKey) || { key: resolvedKey, name: name || humanizeKey(resolvedKey), durationMs: 0 };
    current.durationMs += durationMs;
    if ((!current.name || current.name === humanizeKey(resolvedKey)) && name) current.name = name;
    grouped.set(resolvedKey, current);
}

function sortCountItems(items) {
    return items.sort((a, b) => b.count - a.count);
}

function sortDurationItems(items) {
    return items.sort((a, b) => (b.durationMs - a.durationMs) || a.name.localeCompare(b.name));
}

function resolveGameKeyAndName(row) {
    const data = safeObject(row.data);
    const key = row.game_id || data.game_id || data.mode || data.game_mode || data.activity || data.activity_type || 'unknown_game';
    const name = data.game_name || data.mode_name || data.activity_name || humanizeKey(key);
    return { key: String(key), name };
}

function resolveCardKeyAndName(row) {
    const data = safeObject(row.data);
    const key = row.rfid_uid || data.rfid_uid || data.card_uid || data.card_id || row.content_id || data.content_id || 'unknown_card';
    const name = data.card_name || data.content_name || data.title || data.pack_name || humanizeKey(key);
    return { key: String(key), name };
}

function resolveAiInteractionKeyAndName(row) {
    const data = safeObject(row.data);
    const key = row.rfid_uid || data.rfid_uid || data.card_uid || data.card_id || data.ai_card_id || data.agent_id || 'unknown_ai_card';
    const name = data.ai_card_name || data.card_name || data.agent_name || data.title || data.content_name || humanizeKey(key);
    return { key: String(key), name };
}

function resolveUsageKeyAndName(row) {
    const data = safeObject(row.data);
    if (row.game_id || data.game_id) return resolveGameKeyAndName(row);
    if (row.rfid_uid || data.rfid_uid || data.card_uid || data.card_id) return resolveCardKeyAndName(row);
    if (row.content_id || data.content_id) {
        const key = row.content_id || data.content_id;
        return { key: String(key), name: data.content_name || data.title || humanizeKey(key) };
    }
    if (row.station || data.station) {
        const station = row.station || data.station;
        return { key: `radio:${station}`, name: String(station) };
    }
    if (row.event_name === 'ai_talk_end') return { key: 'ai_talk', name: 'AI Talk' };
    return { key: row.event_name || 'other', name: humanizeKey(row.event_name || 'other') };
}

function toCountResponse(metric, period, grouped) {
    const items = sortCountItems(Array.from(grouped.values()));
    const total = items.reduce((sum, item) => sum + item.count, 0);
    return {
        metric,
        period,
        total,
        items,
    };
}

function toDurationResponse(period, grouped) {
    const sorted = sortDurationItems(Array.from(grouped.values()));
    const items = sorted.map(item => {
        const seconds = Math.floor(item.durationMs / 1000);
        return {
            name: item.name,
            key: item.key,
            duration_seconds: seconds,
            durationSeconds: seconds,
        };
    });
    const totalSeconds = items.reduce((sum, item) => sum + item.duration_seconds, 0);
    return {
        metric: 'usage',
        period,
        total_seconds: totalSeconds,
        totalSeconds,
        items,
    };
}

const MONTH_NAMES = [
    'January',
    'February',
    'March',
    'April',
    'May',
    'June',
    'July',
    'August',
    'September',
    'October',
    'November',
    'December'
];

function getEventMonthKey(event, timezone) {
    const value = event.server_received_at || event.created_at || event.timestamp || event.event_time;
    return getDateKeyFromValue(value, timezone)?.slice(0, 7) || null;
}

function getDateKeyFromValue(value, timezone) {
    return formatDateInTimezone(value || new Date(), timezone);
}

function getMonthLabel(monthKey) {
    const [year, month] = String(monthKey).split('-');
    const monthIndex = Number(month) - 1;
    return `${MONTH_NAMES[monthIndex] || month}, ${year}`;
}

function groupEventsByMonth(events, timezone) {
    const grouped = new Map();
    for (const event of events || []) {
        const monthKey = getEventMonthKey(event, timezone);
        if (!monthKey) continue;
        if (!grouped.has(monthKey)) grouped.set(monthKey, []);
        grouped.get(monthKey).push(event);
    }
    return Array.from(grouped.entries()).sort(([left], [right]) => right.localeCompare(left));
}

function withMonthSections(response, sections, monthsMetadata = null) {
    if (!sections && !monthsMetadata) return response;
    return {
        ...response,
        ...(monthsMetadata || {}),
        month_sections: sections,
        monthSections: sections
    };
}

function withWeekSections(response, monthReference, sections, timezone) {
    if (!sections) return response;
    const monthKey = getMonthKeyFromReference(monthReference, timezone);
    const periodLabel = getMonthLabel(monthKey);
    return {
        ...response,
        period_label: periodLabel,
        periodLabel,
        week_sections: sections,
        weekSections: sections
    };
}

function toCountSection(month, grouped) {
    const response = toCountResponse('', '', grouped);
    return {
        label: getMonthLabel(month),
        month,
        total: response.total,
        items: response.items
    };
}

function toDurationSection(month, grouped) {
    const response = toDurationResponse('', grouped);
    return {
        label: getMonthLabel(month),
        month,
        total_seconds: response.total_seconds,
        totalSeconds: response.totalSeconds,
        items: response.items
    };
}

function getEventWeekInMonth(event, timezone) {
    const value = event.server_received_at || event.created_at || event.timestamp || event.event_time;
    const dateKey = getDateKeyFromValue(value, timezone);
    return dateKey ? getWeekInMonthFromDateKey(dateKey) : null;
}

function groupEventsByWeekInMonth(events, now = new Date(), timezone) {
    const currentMonthKey = getMonthKeyFromReference(now, timezone);
    const grouped = new Map();
    for (const event of events || []) {
        if (getEventMonthKey(event, timezone) !== currentMonthKey) continue;
        const week = getEventWeekInMonth(event, timezone);
        if (!week) continue;
        if (!grouped.has(week)) grouped.set(week, []);
        grouped.get(week).push(event);
    }
    return Array.from(grouped.entries()).sort(([left], [right]) => left - right);
}

function buildMonthPicker(events, now = new Date(), timezone) {
    const currentMonth = getMonthKeyFromReference(now, timezone);
    const currentYear = Number(currentMonth.slice(0, 4));
    const monthKeys = (events || [])
        .map(event => getEventMonthKey(event, timezone))
        .filter(Boolean)
        .sort();
    const firstActivityMonth = monthKeys[0] || currentMonth;
    const months = MONTH_NAMES.map((label, index) => {
        const month = `${currentYear}-${String(index + 1).padStart(2, '0')}`;
        const enabled = month >= firstActivityMonth && month <= currentMonth;
        const isCurrent = month === currentMonth;
        return {
            label,
            month,
            enabled,
            is_current: isCurrent,
            isCurrent
        };
    });

    return {
        year: currentYear,
        first_activity_month: firstActivityMonth,
        firstActivityMonth,
        current_month: currentMonth,
        currentMonth,
        months
    };
}

function toCountWeekSection(week, grouped) {
    const response = toCountResponse('', '', grouped);
    return {
        label: `Week ${week}`,
        week,
        total: response.total,
        items: response.items
    };
}

function getGamePlayedWeekInMonth(row, timezone) {
    const dateKey = getDateKeyFromValue(row && row.played_at, timezone);
    return dateKey ? getWeekInMonthFromDateKey(dateKey) : null;
}

function formatGamePlayedDetail(row) {
    return {
        id: row.id,
        mac_address: row.mac_address,
        macAddress: row.mac_address,
        game_id: row.game_id,
        gameId: row.game_id,
        game_name: row.game_name,
        gameName: row.game_name,
        level: row.level,
        difficulty_level: row.difficulty_level,
        difficultyLevel: row.difficulty_level,
        score: row.score,
        duration_ms: row.duration_ms,
        durationMs: row.duration_ms,
        played_at: row.played_at,
        playedAt: row.played_at,
        source_event_id: row.source_event_id,
        sourceEventId: row.source_event_id,
    };
}

function buildGamePlayedWeekSections(rows, monthReference, timezone) {
    const monthKey = getMonthKeyFromReference(monthReference, timezone);
    const grouped = new Map();
    for (const row of rows || []) {
        if (getMonthKeyFromReference(row.played_at, timezone) !== monthKey) continue;
        const week = getGamePlayedWeekInMonth(row, timezone);
        if (!week) continue;
        if (!grouped.has(week)) grouped.set(week, []);
        grouped.get(week).push(formatGamePlayedDetail(row));
    }
    return Array.from(grouped.entries())
        .sort(([left], [right]) => left - right)
        .map(([week, items]) => ({
            label: `Week ${week}`,
            week,
            total: items.length,
            items
        }));
}

function toDurationWeekSection(week, grouped) {
    const response = toDurationResponse('', grouped);
    return {
        label: `Week ${week}`,
        week,
        total_seconds: response.total_seconds,
        totalSeconds: response.totalSeconds,
        items: response.items
    };
}

function buildGamesGrouped(events) {
    const grouped = new Map();
    for (const event of events || []) {
        if (event.event_name !== 'game_start') continue;
        const { key, name } = resolveGameKeyAndName(event);
        incrementCount(grouped, key, name);
    }
    return grouped;
}

async function buildCardsGrouped(events) {
    const grouped = new Map();
    const rawCardNames = new Map();
    for (const event of debounceCardTapEvents(events)) {
        const { key, name } = resolveCardKeyAndName(event);
        rawCardNames.set(key, name);
        incrementCount(grouped, key, name);
    }
    const cardNameMap = await getCardNameMap(Array.from(grouped.keys()));
    for (const [key, item] of grouped.entries()) {
        item.name = cardNameMap.get(key) || rawCardNames.get(key) || item.name;
    }
    return grouped;
}

function getCompletedAiInteractionStartEvents(events) {
    const completedStarts = [];
    const openStartByMac = new Map();
    const chronologicalEvents = [...(events || [])].sort((a, b) => {
        return new Date(a.server_received_at || a.event_timestamp || 0) - new Date(b.server_received_at || b.event_timestamp || 0);
    });

    for (const event of chronologicalEvents) {
        const macKey = event.mac_address || 'unknown_mac';
        if (event.event_name === 'ai_talk_start') {
            if (!openStartByMac.has(macKey)) {
                openStartByMac.set(macKey, event);
            }
            continue;
        }
        if (event.event_name === 'ai_talk_end') {
            const openStart = openStartByMac.get(macKey);
            if (openStart) {
                completedStarts.push(openStart);
                openStartByMac.delete(macKey);
            }
        }
    }

    return completedStarts;
}

function extractAiQuestionText(data = {}) {
    return firstKnownValue(
        data.child_text,
        data.childText,
        data.question_text,
        data.questionText,
        data.question,
        data.prompt_text,
        data.promptText,
        data.prompt,
        data.summary
    );
}

function extractAiReplyText(data = {}) {
    return firstKnownValue(
        data.device_reply,
        data.deviceReply,
        data.response_text,
        data.responseText,
        data.answer,
        data.reply
    );
}

function compareHomepageAiMomentCandidates(left, right) {
    const leftHasReply = left.replyText ? 1 : 0;
    const rightHasReply = right.replyText ? 1 : 0;
    if (leftHasReply !== rightHasReply) return rightHasReply - leftHasReply;

    const questionLengthDiff = (right.questionText || '').length - (left.questionText || '').length;
    if (questionLengthDiff !== 0) return questionLengthDiff;

    const replyLengthDiff = (right.replyText || '').length - (left.replyText || '').length;
    if (replyLengthDiff !== 0) return replyLengthDiff;

    return new Date(right.timestamp || 0) - new Date(left.timestamp || 0);
}

async function getHomepageAiMoment(scope, now = new Date()) {
    const range = buildProgressDateRange('today', scope.timezone, now);
    const events = await getProgressEventsForRange(scope, range, ['ai_talk_start', 'ai_talk_end']);
    const completedStarts = getCompletedAiInteractionStartEvents(events);
    if (!completedStarts.length) return null;

    const candidates = [];
    const cardKeys = new Set();
    for (const event of completedStarts) {
        const data = safeObject(event.data);
        const questionText = extractAiQuestionText(data);
        if (!questionText) continue;
        const replyText = extractAiReplyText(data);
        const resolved = resolveAiInteractionKeyAndName(event);
        if (resolved.key) cardKeys.add(resolved.key);
        candidates.push({
            key: resolved.key,
            questionText,
            replyText,
            timestamp: event.server_received_at || event.event_timestamp || null,
        });
    }

    if (!candidates.length) return null;

    candidates.sort(compareHomepageAiMomentCandidates);
    const selected = candidates[0];
    const metadataMap = await getRecentCardActivityMetadataMap(Array.from(cardKeys));
    const metadata = selected.key
        ? metadataMap.get(String(selected.key))
            || metadataMap.get(String(selected.key).toLowerCase())
            || metadataMap.get(String(selected.key).toUpperCase())
        : null;
    const imageUrl = normalizeSupabaseAssetUrl(metadata?.thumbnailUrl || '');

    return {
        question_text: selected.questionText,
        questionText: selected.questionText,
        reply_text: selected.replyText || null,
        replyText: selected.replyText || null,
        image_url: imageUrl,
        imageUrl,
        rfid_uid: selected.key || null,
        rfidUid: selected.key || null,
        created_at: selected.timestamp,
        createdAt: selected.timestamp,
    };
}

async function buildCardProgressDetailItems(events) {
    const grouped = new Map();
    const rawCardNames = new Map();
    for (const event of debounceCardTapEvents(events)) {
        const { key, name } = resolveCardKeyAndName(event);
        const current = grouped.get(key) || {
            key,
            name,
            count: 0,
            timestamp: event.server_received_at || event.event_timestamp || null,
        };
        current.count += 1;
        const eventTime = event.server_received_at || event.event_timestamp || null;
        if (eventTime && (!current.timestamp || new Date(eventTime) > new Date(current.timestamp))) {
            current.timestamp = eventTime;
        }
        rawCardNames.set(key, name);
        grouped.set(key, current);
    }

    const cardNameMap = await getCardNameMap(Array.from(grouped.keys()));
    for (const [key, item] of grouped.entries()) {
        item.name = cardNameMap.get(key) || rawCardNames.get(key) || item.name;
        item.card_title = item.name;
        item.cardTitle = item.name;
        item.rfid_uid = key;
        item.rfidUid = key;
    }

    return Array.from(grouped.values()).sort((a, b) => {
        const timeCompare = new Date(b.timestamp || 0) - new Date(a.timestamp || 0);
        if (timeCompare !== 0) return timeCompare;
        return (b.count - a.count) || String(a.name).localeCompare(String(b.name));
    });
}

async function buildAiInteractionGrouped(events) {
    const grouped = new Map();
    const rawCardNames = new Map();
    const cardKeys = new Set();
    for (const event of getCompletedAiInteractionStartEvents(events)) {
        const { key, name } = resolveAiInteractionKeyAndName(event);
        const data = safeObject(event.data);
        if (event.rfid_uid || data.rfid_uid || data.card_uid || data.card_id) {
            cardKeys.add(key);
            rawCardNames.set(key, name);
        }
        incrementCount(grouped, key, name);
    }
    const cardNameMap = await getCardNameMap(Array.from(cardKeys));
    for (const [key, item] of grouped.entries()) {
        item.name = cardNameMap.get(key) || rawCardNames.get(key) || item.name;
    }
    return grouped;
}

async function buildAiProgressDetailItems(events) {
    const grouped = new Map();
    const rawCardNames = new Map();
    const cardKeys = new Set();
    const latestCardByMac = new Map();
    const contextCardKeys = new Set();
    const chronologicalEvents = [...(events || [])].sort((a, b) => {
        return new Date(a.server_received_at || a.event_timestamp || 0) - new Date(b.server_received_at || b.event_timestamp || 0);
    });
    const completedStarts = new Set(getCompletedAiInteractionStartEvents(events));
    for (const event of chronologicalEvents) {
        if (event.event_name === 'card_session_start') {
            const card = resolveCardKeyAndName(event);
            contextCardKeys.add(card.key);
        }
    }

    const contextCardMetadata = await getCardMetadataMap(Array.from(contextCardKeys));
    let defaultAiCard = null;
    for (const [key, metadata] of contextCardMetadata.entries()) {
        if (!metadata?.isAiCard) continue;
        defaultAiCard = {
            key,
            name: metadata.name || 'Cheeko',
        };
        if (normalizeText(metadata.name || '').includes('cheeko')) break;
    }
    for (const event of chronologicalEvents) {
        const data = safeObject(event.data);
        if (event.event_name === 'card_session_start') {
            const card = resolveCardKeyAndName(event);
            latestCardByMac.set(event.mac_address || 'unknown_mac', card);
            continue;
        }
        if (event.event_name !== 'ai_talk_start' || !completedStarts.has(event)) continue;
        const resolved = resolveAiInteractionKeyAndName(event);
        const hasDirectCard = Boolean(event.rfid_uid || data.rfid_uid || data.card_uid || data.card_id);
        const possibleFallbackCard = latestCardByMac.get(event.mac_address || 'unknown_mac');
        const fallbackMetadata = possibleFallbackCard ? contextCardMetadata.get(possibleFallbackCard.key) : null;
        const fallbackCard = fallbackMetadata?.isAiCard
            ? {
                key: possibleFallbackCard.key,
                name: fallbackMetadata.name || possibleFallbackCard.name,
            }
            : null;
        const isMenuAiChat = normalizeText(data.source || data.entry_point || data.entryPoint) === 'menu';
        const menuFallbackCard = !hasDirectCard && !fallbackCard && isMenuAiChat
            ? (defaultAiCard || { key: 'cheeko_ai_card', name: 'Cheeko' })
            : null;
        const { key, name } = !hasDirectCard && (fallbackCard || menuFallbackCard)
            ? (fallbackCard || menuFallbackCard)
            : resolved;
        const current = grouped.get(key) || {
            key,
            name,
            count: 0,
            timestamp: event.server_received_at || event.event_timestamp || null,
        };
        current.count += 1;
        const eventTime = event.server_received_at || event.event_timestamp || null;
        if (eventTime && (!current.timestamp || new Date(eventTime) > new Date(current.timestamp))) {
            current.timestamp = eventTime;
        }
        if (hasDirectCard || fallbackCard || menuFallbackCard) {
            cardKeys.add(key);
            rawCardNames.set(key, name);
        }
        grouped.set(key, current);
    }

    const cardNameMap = await getCardNameMap(Array.from(cardKeys));
    for (const [key, item] of grouped.entries()) {
        item.name = cardNameMap.get(key) || rawCardNames.get(key) || item.name;
        item.card_title = item.name;
        item.cardTitle = item.name;
        item.rfid_uid = key;
        item.rfidUid = key;
    }

    return Array.from(grouped.values()).sort((a, b) => {
        const timeCompare = new Date(b.timestamp || 0) - new Date(a.timestamp || 0);
        if (timeCompare !== 0) return timeCompare;
        return (b.count - a.count) || String(a.name).localeCompare(String(b.name));
    });
}

async function buildUsageGrouped(events) {
    const grouped = new Map();
    const rawCardNames = new Map();
    const cardKeys = new Set();
    for (const event of events || []) {
        const durationMs = positiveDurationMs(event.duration_ms);
        if (durationMs <= 0) continue;
        const { key, name } = resolveUsageKeyAndName(event);
        const data = safeObject(event.data);
        if (event.rfid_uid || data.rfid_uid || data.card_uid || data.card_id) {
            cardKeys.add(key);
            rawCardNames.set(key, name);
        }
        incrementDuration(grouped, key, name, durationMs);
    }
    const cardNameMap = await getCardNameMap(Array.from(cardKeys));
    for (const [key, item] of grouped.entries()) {
        if (cardNameMap.has(key)) {
            item.name = cardNameMap.get(key);
        } else if (rawCardNames.has(key)) {
            item.name = rawCardNames.get(key);
        }
    }
    return grouped;
}

async function buildMonthSections(events, buildGrouped, sectionBuilder, timezone) {
    const sections = [];
    for (const [month, monthEvents] of groupEventsByMonth(events, timezone)) {
        const grouped = await buildGrouped(monthEvents);
        const section = sectionBuilder(month, grouped);
        if (section.items.length > 0) sections.push(section);
    }
    return sections;
}

async function buildWeekSections(events, now, buildGrouped, sectionBuilder, timezone) {
    const sections = [];
    for (const [week, weekEvents] of groupEventsByWeekInMonth(events, now, timezone)) {
        const grouped = await buildGrouped(weekEvents);
        const section = sectionBuilder(week, grouped);
        if (section.items.length > 0) sections.push(section);
    }
    return sections;
}

async function getCardNameMap(keys) {
    const rfidKeys = Array.from(new Set((keys || []).filter(Boolean).flatMap(key => {
        const value = String(key);
        return [value, value.toLowerCase(), value.toUpperCase()];
    })));
    if (rfidKeys.length === 0) return new Map();

    const mappings = await prisma.rfid_card_mapping.findMany({
        where: { rfid_uid: { in: rfidKeys } },
        select: {
            rfid_uid: true,
            card_type: true,
            action_data: true,
            rfid_content_pack: { select: { name: true } },
            rfid_question: { select: { title: true } },
            rfid_pack: { select: { pack_name: true } }
        }
    });

    const nameMap = new Map();
    for (const mapping of mappings || []) {
        const actionData = safeObject(mapping.action_data);
        const name = mapping.rfid_content_pack?.name
            || mapping.rfid_question?.title
            || mapping.rfid_pack?.pack_name
            || actionData.agent_name
            || actionData.character_name
            || actionData.ai_card_name
            || actionData.card_name
            || actionData.display_name
            || actionData.displayName
            || actionData.title
            || actionData.name
            || (mapping.card_type === 'ai' ? 'AI Card' : null);
        if (!name || !mapping.rfid_uid) continue;
        const key = String(mapping.rfid_uid);
        nameMap.set(key, name);
        nameMap.set(key.toLowerCase(), name);
        nameMap.set(key.toUpperCase(), name);
    }
    return nameMap;
}

async function getRecentCardActivityMetadataMap(keys) {
    const rfidKeys = Array.from(new Set((keys || []).filter(Boolean).flatMap(key => {
        const value = String(key);
        return [value, value.toLowerCase(), value.toUpperCase()];
    })));
    if (rfidKeys.length === 0) return new Map();

    const mappings = await prisma.rfid_card_mapping.findMany({
        where: { rfid_uid: { in: rfidKeys } },
        select: {
            rfid_uid: true,
            card_type: true,
            thumbnail_url: true,
            action_data: true,
            rfid_content_pack: { select: { name: true, thumbnail_url: true } },
            rfid_question: { select: { title: true } },
            rfid_pack: { select: { pack_name: true } }
        }
    });

    const metadataMap = new Map();
    for (const mapping of mappings || []) {
        if (!mapping.rfid_uid) continue;
        const actionData = safeObject(mapping.action_data);
        const name = mapping.rfid_content_pack?.name
            || mapping.rfid_question?.title
            || mapping.rfid_pack?.pack_name
            || actionData.agent_name
            || actionData.character_name
            || actionData.ai_card_name
            || actionData.card_name
            || actionData.display_name
            || actionData.displayName
            || actionData.title
            || actionData.name
            || (mapping.card_type === 'ai' ? 'AI Card' : null);
        const thumbnailUrl = firstKnownValue(
            mapping.thumbnail_url,
            actionData.imageUrl,
            actionData.image_url,
            actionData.thumbnailUrl,
            actionData.thumbnail_url,
            actionData.cardImageUrl,
            actionData.card_image_url,
            actionData.cardThumbnailUrl,
            actionData.card_thumbnail_url,
            actionData.coverUrl,
            actionData.cover_url,
            mapping.rfid_content_pack?.thumbnail_url
        );
        const metadata = { name, thumbnailUrl };
        const key = String(mapping.rfid_uid);
        metadataMap.set(key, metadata);
        metadataMap.set(key.toLowerCase(), metadata);
        metadataMap.set(key.toUpperCase(), metadata);
    }
    return metadataMap;
}

async function getCardMetadataMap(keys) {
    const rfidKeys = Array.from(new Set((keys || []).filter(Boolean).flatMap(key => {
        const value = String(key);
        return [value, value.toLowerCase(), value.toUpperCase()];
    })));
    if (rfidKeys.length === 0) return new Map();

    const mappings = await prisma.rfid_card_mapping.findMany({
        where: { rfid_uid: { in: rfidKeys } },
        select: {
            rfid_uid: true,
            card_type: true,
            action_data: true,
            rfid_content_pack: { select: { name: true } },
            rfid_question: { select: { title: true } },
            rfid_pack: { select: { pack_name: true } }
        }
    });

    const metadataMap = new Map();
    for (const mapping of mappings || []) {
        const actionData = safeObject(mapping.action_data);
        const name = mapping.rfid_content_pack?.name
            || mapping.rfid_question?.title
            || mapping.rfid_pack?.pack_name
            || actionData.agent_name
            || actionData.character_name
            || actionData.ai_card_name
            || actionData.card_name
            || actionData.display_name
            || actionData.displayName
            || actionData.title
            || actionData.name
            || (mapping.card_type === 'ai' ? 'AI Card' : null);
        if (!mapping.rfid_uid) continue;
        const key = String(mapping.rfid_uid);
        const searchableText = normalizeText([
            mapping.card_type,
            name,
            actionData.agent_name,
            actionData.character_name,
            actionData.ai_card_name,
            actionData.card_name,
            actionData.title,
            actionData.name,
        ].filter(Boolean).join(' '));
        const isAiCard = String(mapping.card_type || '').toLowerCase() === 'ai'
            || searchableText.includes('cheeko')
            || searchableText.includes('ai');
        const metadata = {
            name,
            cardType: mapping.card_type || null,
            isAiCard,
        };
        metadataMap.set(key, metadata);
        metadataMap.set(key.toLowerCase(), metadata);
        metadataMap.set(key.toUpperCase(), metadata);
    }
    return metadataMap;
}

function formatRecentCardActivity(row, mapping = null) {
    if (!row) return null;
    const actionData = safeObject(mapping?.action_data);
    const contentPack = row.rfid_content_pack || mapping?.rfid_content_pack || null;
    const question = mapping?.rfid_question || null;
    const pack = mapping?.rfid_pack || null;
    const contentName = firstKnownValue(
        row.content_pack_name,
        contentPack?.name,
        actionData.contentPackName,
        actionData.content_pack_name,
        actionData.packName,
        actionData.pack_name
    );
    const contentCode = firstKnownValue(
        row.content_pack_code,
        contentPack?.pack_code,
        mapping?.pack_code,
        pack?.pack_code,
        actionData.contentPackCode,
        actionData.content_pack_code,
        actionData.packCode,
        actionData.pack_code
    );
    const title = firstKnownValue(
        actionData.cardName,
        actionData.card_name,
        actionData.title,
        actionData.name,
        actionData.displayName,
        actionData.display_name,
        question?.title,
        contentName,
        pack?.pack_name
    );
    const description = firstKnownValue(
        actionData.description,
        actionData.prompt,
        question?.prompt_text,
        contentPack?.description,
        pack?.description
    );
    const cardType = firstKnownValue(row.card_type, mapping?.card_type, actionData.cardType, actionData.card_type) || 'card';
    const imageUrl = firstKnownValue(
        actionData.imageUrl,
        actionData.image_url,
        actionData.thumbnailUrl,
        actionData.thumbnail_url,
        actionData.coverUrl,
        actionData.cover_url,
        contentPack?.thumbnail_url
    );
    const details = [
        title ? `Card: ${title}` : null,
        contentName ? `Content pack: ${contentName}` : null,
        contentCode ? `Code: ${contentCode}` : null,
        cardType ? `Type: ${cardType}` : null,
        row.rfid_uid ? `RFID: ${row.rfid_uid}` : null,
    ].filter(Boolean);
    const usageSeconds = row.usage_seconds ?? row.usageSeconds ?? null;

    return {
        id: row.id != null ? row.id.toString() : null,
        mac_address: row.mac_address,
        macAddress: row.mac_address,
        rfid_uid: row.rfid_uid,
        rfidUid: row.rfid_uid,
        title,
        card_type: cardType,
        cardType,
        content_pack_id: row.content_pack_id != null ? row.content_pack_id.toString() : null,
        contentPackId: row.content_pack_id != null ? row.content_pack_id.toString() : null,
        content_pack_code: contentCode,
        contentPackCode: contentCode,
        content_pack_name: contentName,
        contentPackName: contentName,
        description: description || (details.length > 0 ? details.join('\n') : null),
        image_url: imageUrl,
        imageUrl,
        thumbnail_url: imageUrl,
        thumbnailUrl: imageUrl,
        usage_seconds: usageSeconds,
        usageSeconds,
        created_at: row.created_at,
        createdAt: row.created_at,
    };
}

function dateTimeOrNull(value) {
    if (!value) return null;
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
}

function getAnalyticsEventTime(event) {
    return dateTimeOrNull(event?.event_timestamp) || dateTimeOrNull(event?.server_received_at);
}

function attachRecentCardDurations(taps, durationEvents) {
    return (taps || []).map(tap => {
        const tapTime = dateTimeOrNull(tap.created_at);
        if (!tapTime || !tap.rfid_uid) return tap;

        const matchingEvent = (durationEvents || [])
            .filter(event => {
                if (event.event_name !== 'card_session_end') return false;
                if (event.rfid_uid !== tap.rfid_uid) return false;
                if (positiveDurationMs(event.duration_ms) <= 0) return false;
                const eventTime = getAnalyticsEventTime(event);
                return eventTime && eventTime.getTime() >= tapTime.getTime();
            })
            .sort((left, right) => getAnalyticsEventTime(left).getTime() - getAnalyticsEventTime(right).getTime())[0];

        if (!matchingEvent) return tap;
        return {
            ...tap,
            usage_seconds: Math.floor(positiveDurationMs(matchingEvent.duration_ms) / 1000),
        };
    });
}

function uniqueRecentCardTaps(taps, limit = 3) {
    const seen = new Set();
    const unique = [];
    for (const tap of taps || []) {
        const key = cleanKnownValue(tap?.rfid_uid) || (tap?.id != null ? `tap:${tap.id}` : null);
        if (!key || seen.has(key)) continue;
        seen.add(key);
        unique.push(tap);
        if (unique.length >= limit) break;
    }
    return unique;
}

function clampRecommendationLimit(value) {
    const parsed = parseInt(value, 10);
    if (!Number.isFinite(parsed) || parsed <= 0) return 8;
    return Math.min(parsed, 20);
}

function parseBigIntId(value, fieldName) {
    try {
        return BigInt(value);
    } catch (err) {
        throw new ApiError(`${fieldName} must be a valid id`, 400, 400);
    }
}

function normalizeText(value) {
    return String(value || '').trim().toLowerCase();
}

function toArray(value) {
    if (Array.isArray(value)) return value.filter(Boolean);
    if (typeof value === 'string' && value.trim()) return [value.trim()];
    return [];
}

function addTerms(target, values) {
    toArray(values).forEach(value => {
        const normalized = normalizeText(value);
        if (normalized) target.add(normalized);
    });
}

function addKeywordTokens(target, value) {
    const normalized = normalizeText(value);
    if (!normalized) return;
    target.add(normalized);
    normalized.split(/[^a-z0-9]+/).filter(token => token.length > 1).forEach(token => target.add(token));
}

function metadataTokens(metadata) {
    if (!metadata || typeof metadata !== 'object') return [];
    const values = [];
    const collect = (value) => {
        if (value == null) return;
        if (Array.isArray(value)) {
            value.forEach(collect);
            return;
        }
        if (typeof value === 'object') {
            Object.values(value).forEach(collect);
            return;
        }
        values.push(value);
    };
    collect(metadata);
    return values;
}

function collectPreferenceSignals(kid) {
    const preferences = kid.preferences || {};
    const categories = new Set();
    const contentTypes = new Set();
    const aiModes = new Set();

    addTerms(categories, kid.interests);
    addTerms(categories, preferences.interests);
    addTerms(categories, preferences.categories);
    addTerms(categories, preferences.preferredCategories);
    addTerms(categories, preferences.selectedInterests);
    addTerms(categories, preferences.topics);

    addTerms(contentTypes, preferences.contentTypes);
    addTerms(contentTypes, preferences.preferredContentTypes);
    addTerms(contentTypes, preferences.mediaTypes);

    addTerms(aiModes, preferences.aiModes);
    addTerms(aiModes, preferences.preferredAiModes);
    addTerms(aiModes, preferences.aiExperiences);
    addTerms(aiModes, preferences.preferredAiExperiences);

    return { categories, contentTypes, aiModes };
}

function contentTokens(content) {
    return [
        content.title,
        content.name,
        content.category,
        content.content_type,
        content.content_pack_code,
        content.contentPackCode,
        content.pack_code,
        content.packCode,
        ...(Array.isArray(content.tags) ? content.tags : []),
        ...metadataTokens(content.metadata),
    ].map(normalizeText).filter(Boolean);
}

function formatDuration(seconds) {
    if (!seconds || seconds < 0) return null;
    const minutes = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

function buildRecentSignals({ kid, cardTaps, sessions, mediaPlayback }) {
    const preferenceSignals = collectPreferenceSignals(kid);
    const keywords = new Set();
    const recentCategories = new Set();
    const recentContentTypes = new Set();
    const recentModes = new Set();
    const recentContentIds = new Set();
    const recentPackCodes = new Set();
    const recentPackNames = new Set();
    const recentPackCodeLabels = new Map();
    const recentPackNameLabels = new Map();
    let aiCardUsed = false;

    for (const category of preferenceSignals.categories) addKeywordTokens(keywords, category);

    for (const tap of cardTaps || []) {
        [tap.content_pack_name, tap.content_pack_code, tap.card_type, tap.rfid_uid].forEach(value => addKeywordTokens(keywords, value));
        addTerms(recentCategories, tap.content_pack_name);
        addTerms(recentContentTypes, tap.card_type);
        addTerms(recentPackCodes, tap.content_pack_code);
        addTerms(recentPackNames, tap.content_pack_name);
        if (tap.content_pack_code) recentPackCodeLabels.set(normalizeText(tap.content_pack_code), tap.content_pack_code);
        if (tap.content_pack_name) recentPackNameLabels.set(normalizeText(tap.content_pack_name), tap.content_pack_name);
        const tapText = normalizeText(`${tap.content_pack_name || ''} ${tap.content_pack_code || ''} ${tap.card_type || ''}`);
        if (tapText.includes('ai')) {
            aiCardUsed = true;
            if (tapText.includes('story')) recentModes.add('story');
            if (tapText.includes('music')) recentModes.add('music');
            if (tapText.includes('game')) recentModes.add('game');
            if (tapText.includes('learn')) recentModes.add('learning');
            recentModes.add('conversation');
        }
    }

    for (const session of sessions || []) {
        addTerms(recentModes, session.mode_type);
        addTerms(recentContentTypes, session.mode_type);
    }

    for (const playback of mediaPlayback || []) {
        if (playback.content_id != null) recentContentIds.add(playback.content_id.toString());
        addTerms(recentContentTypes, playback.content_type);
    }

    return {
        preferredCategories: preferenceSignals.categories,
        preferredContentTypes: preferenceSignals.contentTypes,
        preferredAiModes: preferenceSignals.aiModes,
        recentKeywords: keywords,
        recentCategories,
        recentContentTypes,
        recentModes,
        recentContentIds,
        recentPackCodes,
        recentPackNames,
        recentPackCodeLabels,
        recentPackNameLabels,
        aiCardUsed,
        language: normalizeText(kid.language || 'en'),
        age: ageFromBirthDate(kid.birth_date),
    };
}

function keywordMatchesContent(keywords, content) {
    const haystack = contentTokens(content).join(' ');
    for (const keyword of keywords) {
        if (keyword && haystack.includes(keyword)) return true;
    }
    return false;
}

function categoryMatches(set, category) {
    const normalized = normalizeText(category);
    return normalized && set.has(normalized);
}

function scoreContent(content, profile) {
    let score = 0;
    const reasons = [];
    const category = normalizeText(content.category);
    const contentType = normalizeText(content.content_type);
    const language = normalizeText(content.language);
    const tokens = contentTokens(content);
    const tokenText = tokens.join(' ');

    for (const code of profile.recentPackCodes) {
        if (code && tokenText.includes(code)) {
            score += 80;
            reasons.push(`Because child used ${profile.recentPackCodeLabels.get(code) || code}`);
            break;
        }
    }

    for (const packName of profile.recentPackNames) {
        if (packName && tokenText.includes(packName)) {
            score += 60;
            reasons.push(`Because child used ${profile.recentPackNameLabels.get(packName) || packName}`);
            break;
        }
    }

    if (categoryMatches(profile.recentCategories, category) || categoryMatches(profile.preferredCategories, category)) {
        score += 50;
        reasons.push(`Because ${content.category} matches your child's recent activity or preferences`);
    }
    if (profile.recentContentTypes.has(contentType) || profile.preferredContentTypes.has(contentType)) {
        score += 40;
        reasons.push(`Because child used ${content.content_type} cards`);
    }
    if (keywordMatchesContent(profile.recentKeywords, content)) {
        score += 30;
        reasons.push(`Because your child recently used ${content.category || content.title}`);
    }
    if (profile.preferredCategories.has(category) || profile.preferredContentTypes.has(contentType)) {
        score += 20;
    }
    if (profile.language && language && profile.language === language) {
        score += 10;
    }
    if (profile.age != null) {
        const min = content.age_min == null ? null : Number(content.age_min);
        const max = content.age_max == null ? null : Number(content.age_max);
        if ((min == null || profile.age >= min) && (max == null || profile.age <= max)) {
            score += 10;
        }
    }
    if (profile.recentContentIds.has(content.id?.toString())) {
        score -= 100;
        reasons.push('Similar alternatives are ranked higher because this was played recently');
    }

    return {
        score,
        reason: reasons[0] || 'Popular content card',
    };
}

function formatRecommendationContent(content, reason) {
    const contentId = content.id != null ? content.id.toString() : null;
    const title = content.title || content.name;
    const category = content.category || 'RFID Content Card';
    const createdAt = content.created_at || content.create_date;
    return {
        itemType: 'content',
        id: contentId,
        contentId,
        title,
        subtitle: reason,
        contentType: content.content_type,
        category,
        packCode: content.pack_code || null,
        contentPackCode: content.pack_code || null,
        thumbnailUrl: normalizeSupabaseAssetUrl(content.thumbnail_url),
        durationSeconds: content.duration_seconds || null,
        formattedDuration: formatDuration(content.duration_seconds),
        totalItems: content.total_items || null,
        createdAt,
        reason,
    };
}

function normalizeSupabaseAssetUrl(url) {
    if (!url || typeof url !== 'string') return null;
    const configuredSupabaseUrl = process.env.SUPABASE_URL;
    if (!configuredSupabaseUrl) return url;

    try {
        const assetUrl = new URL(url);
        const configuredUrl = new URL(configuredSupabaseUrl);
        if (
            assetUrl.hostname.endsWith('.supabase.co') &&
            configuredUrl.hostname.endsWith('.supabase.co') &&
            assetUrl.hostname !== configuredUrl.hostname
        ) {
            assetUrl.hostname = configuredUrl.hostname;
            return assetUrl.toString();
        }
    } catch (error) {
        return url;
    }

    return url;
}

function hasSignals(...sets) {
    return sets.some(set => set && set.size > 0);
}

function sortRecommendations(a, b) {
    if (b._score !== a._score) return b._score - a._score;
    return (b._createdAt || 0) - (a._createdAt || 0);
}

function dedupeRecommendations(items) {
    const seenIds = new Set();
    const seenTitles = new Set();
    const deduped = [];

    for (const item of items) {
        const idKey = `${item.itemType}:${item.id}`;
        const titleKey = `${item.itemType}:${normalizeText(item.title)}`;
        if (seenIds.has(idKey) || seenTitles.has(titleKey)) continue;
        seenIds.add(idKey);
        seenTitles.add(titleKey);
        deduped.push(item);
    }

    return deduped;
}

function collectParentProfileUpdates(data) {
    const updates = {};

    if (data.parent_name || data.fullName || data.displayName) {
        updates.display_name = data.parent_name || data.fullName || data.displayName;
    }
    if (data.phone_number || data.phoneNumber) updates.phone_number = data.phone_number || data.phoneNumber;
    if (data.country_region || data.countryRegion) updates.country_region = data.country_region || data.countryRegion;
    if (data.preferred_language || data.preferredLanguage || data.language) {
        updates.language = data.preferred_language || data.preferredLanguage || data.language;
    }
    // A stored zone Intl cannot resolve would turn every /progress/* read for
    // this account into a 500, so it is refused at the door. A null or blank
    // value is ignored rather than clearing a zone that already works.
    if (data.timezone != null && String(data.timezone).trim() !== '') {
        const timezone = String(data.timezone).trim();
        if (!isValidTimezone(timezone)) {
            throw new ApiError('timezone must be an IANA zone name, for example Asia/Kolkata', 400, 400);
        }
        updates.timezone = timezone;
    }
    if (data.email_notifications !== undefined) updates.email_notifications = data.email_notifications;
    if (data.emailNotifications !== undefined) updates.email_notifications = data.emailNotifications;
    if (data.push_notifications !== undefined) updates.push_notifications = data.push_notifications;
    if (data.pushNotifications !== undefined) updates.push_notifications = data.pushNotifications;
    if (data.weekly_report !== undefined) updates.weekly_report = data.weekly_report;
    if (data.weeklyReport !== undefined) updates.weekly_report = data.weeklyReport;
    if (data.fcm_token !== undefined) updates.fcm_token = data.fcm_token;
    if (data.fcmToken !== undefined) updates.fcm_token = data.fcmToken;
    if (data.terms_version !== undefined) updates.terms_version = data.terms_version;
    if (data.termsVersion !== undefined) updates.terms_version = data.termsVersion;
    if (data.terms_accepted_at !== undefined) updates.terms_accepted_at = dateOrNull(data.terms_accepted_at);
    if (data.termsAcceptedAt !== undefined) updates.terms_accepted_at = dateOrNull(data.termsAcceptedAt);
    if (data.privacy_policy_accepted_at !== undefined) {
        updates.privacy_policy_accepted_at = dateOrNull(data.privacy_policy_accepted_at);
    }
    if (data.privacyPolicyAcceptedAt !== undefined) {
        updates.privacy_policy_accepted_at = dateOrNull(data.privacyPolicyAcceptedAt);
    }
    if (data.consent_accepted_at !== undefined) updates.consent_accepted_at = dateOrNull(data.consent_accepted_at);
    if (data.consentAcceptedAt !== undefined) updates.consent_accepted_at = dateOrNull(data.consentAcceptedAt);
    if (data.onboarding_completed !== undefined) updates.onboarding_completed = data.onboarding_completed;
    if (data.onboardingCompleted !== undefined) updates.onboarding_completed = data.onboardingCompleted;

    return updates;
}

function formatParentProfile(profile) {
    if (!profile) return null;

    return {
        ...profile,
        parent_name: profile.display_name,
        fullName: profile.display_name,
        country_region: profile.country_region || null,
        phoneNumber: profile.phone_number,
        fcmToken: profile.fcm_token,
        preferred_language: profile.language,
        preferredLanguage: profile.language,
        notification_preferences: {
            email_notifications: profile.email_notifications,
            push_notifications: profile.push_notifications,
            weekly_report: profile.weekly_report,
        },
        emailNotifications: profile.email_notifications,
        pushNotifications: profile.push_notifications,
        weeklyReport: profile.weekly_report,
        termsVersion: profile.terms_version,
        termsAcceptedAt: profile.terms_accepted_at,
        privacyPolicyAcceptedAt: profile.privacy_policy_accepted_at,
        consentAcceptedAt: profile.consent_accepted_at,
        onboardingCompleted: profile.onboarding_completed,
    };
}

async function getParentProfile(firebaseUid) {
    const user = await prisma.sys_user.findUnique({
        where: { firebase_uid: firebaseUid },
        include: { parent_profile: true },
    });
    return formatParentProfile(user?.parent_profile || null);
}

async function createParentProfile(firebaseUid, data) {
    const user = await prisma.sys_user.findUnique({
        where: { firebase_uid: firebaseUid },
    });
    if (!user) throw new Error('User not found');
    const updates = collectParentProfileUpdates(data);

    return prisma.parent_profile.upsert({
        where: { user_id: user.id },
        create: {
            user_id: user.id,
            email: user.email,
            ...updates,
            onboarding_completed: false,
        },
        update: updates,
    }).then(formatParentProfile);
}

async function updateParentProfile(firebaseUid, data) {
    const user = await prisma.sys_user.findUnique({
        where: { firebase_uid: firebaseUid },
    });
    if (!user) throw new Error('User not found');

    const updates = collectParentProfileUpdates(data);

    return prisma.parent_profile.upsert({
        where: { user_id: user.id },
        create: {
            user_id: user.id,
            email: user.email,
            ...updates,
        },
        update: updates,
    }).then(formatParentProfile);
}

async function updateFcmToken(firebaseUid, fcmToken) {
    const user = await prisma.sys_user.findUnique({
        where: { firebase_uid: firebaseUid },
    });
    if (!user) throw new Error('User not found');

    return prisma.parent_profile.upsert({
        where: { user_id: user.id },
        create: {
            user_id: user.id,
            email: user.email,
            fcm_token: fcmToken,
        },
        update: {
            fcm_token: fcmToken,
        },
    }).then(formatParentProfile);
}

async function clearFcmToken(firebaseUid) {
    const user = await prisma.sys_user.findUnique({
        where: { firebase_uid: firebaseUid },
    });
    if (!user) throw new Error('User not found');

    return prisma.parent_profile.upsert({
        where: { user_id: user.id },
        create: {
            user_id: user.id,
            email: user.email,
            fcm_token: null,
        },
        update: {
            fcm_token: null,
        },
    }).then(formatParentProfile);
}

// ─── User State ─────────────────────────────────────────────────────────────

async function getUserState(firebaseUid) {
    // Mobile app requested user_states, which in Node.js maps to sys_user / parent_profile combinations
    const user = await prisma.sys_user.findUnique({
        where: { firebase_uid: firebaseUid },
        include: { parent_profile: true },
    });
    if (!user) return null;

    return {
        user_id: user.firebase_uid,
        email: user.email,
        email_verified: true, // Firebase validates emails for OAuth
        onboarding_completed: user.parent_profile?.onboarding_completed || false,
        current_stage: user.parent_profile?.onboarding_completed ? 'completed' : 'profile_setup',
    };
}

async function markOnboardingCompleted(firebaseUid) {
    const user = await prisma.sys_user.findUnique({
        where: { firebase_uid: firebaseUid },
    });
    if (!user) throw new Error('User not found');

    await prisma.parent_profile.update({
        where: { user_id: user.id },
        data: { onboarding_completed: true },
    });

    return { success: true };
}

// ─── Kids ───────────────────────────────────────────────────────────────────

async function getKids(firebaseUid, options = {}) {
    const user = await prisma.sys_user.findUnique({
        where: { firebase_uid: firebaseUid },
        include: { kid_profile: { orderBy: [{ created_at: 'asc' }, { id: 'asc' }] } },
    });
    if (!user) return [];

    // ?mac= answers "who is this toy's child", which is the question a screen
    // opened from a device is actually asking. Without it the caller gets every
    // child and has to pick, and picking is where the app went wrong.
    const requestedMac = normalizeMacAddress(options.mac || options.mac_address || options.macAddress);
    if ((options.mac || options.mac_address || options.macAddress) && !requestedMac) {
        throw new ApiError('Device not found', 404, 404);
    }

    // Which toy each child is on. The app picks its active child from this list
    // and had no way to tell which one the toy in front of the parent belongs
    // to, so it took the first -- and the order was whatever Postgres returned.
    const devices = await prisma.ai_device.findMany({
        where: { user_id: user.id, kid_id: { not: null } },
        select: { mac_address: true, kid_id: true, last_connected_at: true },
    });
    const deviceByKid = new Map(devices.map(d => [String(d.kid_id), d]));
    const macByKid = new Map(devices.map(d => [String(d.kid_id), d.mac_address]));

    // The child whose toy was used most recently comes first, then the rest by
    // age of profile. A client that picks the head of this list -- which the app
    // does -- lands on the family's active child instead of on whichever row
    // Postgres happened to return first.
    //
    // This is a better default, not a substitute for choosing properly. A parent
    // with two paired toys has two right answers and only the client knows which
    // screen it is on, which is what device_mac below is for.
    const lastUsed = (kid) => {
        const at = deviceByKid.get(String(kid.id))?.last_connected_at;
        return at ? new Date(at).getTime() : null;
    };
    const ordered = [...user.kid_profile].sort((a, b) => {
        const [ua, ub] = [lastUsed(a), lastUsed(b)];
        if (ua !== ub) {
            if (ua === null) return 1;
            if (ub === null) return -1;
            return ub - ua;
        }
        return new Date(a.created_at || 0) - new Date(b.created_at || 0);
    });

    // A MAC this parent does not own is a 404, not an empty list: "you have no
    // children on that toy" and "that toy is not yours" are different answers and
    // the caller should not have to guess which it got.
    let scoped = ordered;
    if (requestedMac) {
        const owned = await prisma.ai_device.findFirst({
            where: { user_id: user.id, mac_address: { equals: requestedMac, mode: 'insensitive' } },
            select: { kid_id: true },
        });
        if (!owned) throw new ApiError('Device not found', 404, 404);
        // An unpaired toy legitimately has no child yet, so [] rather than 404.
        scoped = owned.kid_id
            ? ordered.filter(k => String(k.id) === String(owned.kid_id))
            : [];
    }

    // Map to the format the mobile app expects
    return scoped.map(k => ({
        device_mac: macByKid.get(String(k.id)) || null,
        deviceMac: macByKid.get(String(k.id)) || null,
        is_paired: macByKid.has(String(k.id)),
        isPaired: macByKid.has(String(k.id)),
        id: k.id.toString(),
        parent_id: user.firebase_uid,
        name: k.name,
        nickname: k.nickname,
        avatar_url: k.avatar_url,
        date_of_birth: k.birth_date,
        birth_date: k.birth_date,
        age: ageFromBirthDate(k.birth_date),
        is_active: true,
        isActive: true,
        gender: k.gender,
        interests: k.interests || [],
        language: k.language,
        parent_rule: k.parent_rule || null,
        created_at: k.created_at,
        updated_at: k.updated_at,
    }));
}

async function createKid(firebaseUid, data) {
    const user = await prisma.sys_user.findUnique({
        where: { firebase_uid: firebaseUid },
    });
    if (!user) throw new Error('User not found');

    const birthDate = (data.date_of_birth || data.birth_date)
        ? new Date(data.date_of_birth || data.birth_date)
        : null;

    // Re-activating a toy walks the parent through the same "who is this for"
    // screen, and every pass minted another profile: DB1 held two Kishores and
    // two Rahuls, each pair identical on name and birth date. That was harmless
    // while state lived on the MAC. Now that it follows the child, the new
    // profile is an empty history and the toy gets paired to it -- one parent
    // lost 67 memory documents and 71 sessions that way.
    //
    // Same duplicate key as scripts/merge-duplicate-kid-profiles.js:
    // (user_id, lower(name), birth_date). Two siblings sharing both a name and a
    // birth date is not a case worth splitting them for.
    const existing = birthDate && data.name
        ? await prisma.kid_profile.findFirst({
            where: {
                user_id: user.id,
                name: { equals: String(data.name).trim(), mode: 'insensitive' },
                birth_date: birthDate,
            },
            orderBy: { id: 'asc' },
        })
        : null;

    const kid = existing || await prisma.kid_profile.create({
        data: {
            user_id: user.id,
            name: data.name,
            nickname: data.nickname,
            birth_date: birthDate,
            gender: data.gender,
            interests: data.interests || [],
            language: data.language || 'en',
        },
    });

    if (existing) {
        logger.info(`[mobile] createKid reused existing profile ${existing.id} for "${data.name}" rather than duplicating it`);
    }

    return {
        id: kid.id.toString(),
        parent_id: user.firebase_uid,
        name: kid.name,
        nickname: kid.nickname,
        date_of_birth: kid.birth_date,
        birth_date: kid.birth_date,
        age: ageFromBirthDate(kid.birth_date),
        is_active: true,
        isActive: true,
        gender: kid.gender,
        interests: kid.interests || [],
    };
}

/**
 * Edit a child's profile.
 *
 * Scoped by owner. It used to take only the id and update straight through, so
 * any signed-in parent could edit any child in the database by putting a
 * different number in the URL. One caller already knew — the avatar upload
 * verifies ownership itself and says so in a comment — but PUT /kids/:id did
 * not, and a mis-selected child in the app is exactly how you find out.
 */
async function updateKid(firebaseUid, kidId, data) {
    const user = await prisma.sys_user.findUnique({
        where: { firebase_uid: firebaseUid },
        select: { id: true },
    });
    if (!user) throw new ApiError('User not found', 404, 404);

    const updates = {};
    if (data.name) updates.name = data.name;
    if (data.nickname) updates.nickname = data.nickname;
    if (data.date_of_birth || data.birth_date) updates.birth_date = new Date(data.date_of_birth || data.birth_date);
    if (data.gender) updates.gender = data.gender;
    if (data.interests) updates.interests = data.interests;
    if (data.language) updates.language = data.language;
    if (data.avatar_url) updates.avatar_url = data.avatar_url;
    if (data.parent_rule !== undefined) updates.parent_rule = data.parent_rule || null;

    // updateMany so a row belonging to someone else simply matches nothing,
    // rather than being fetched, compared and then hopefully rejected.
    const result = await prisma.kid_profile.updateMany({
        where: { id: BigInt(kidId), user_id: user.id },
        data: updates,
    });
    if (result.count === 0) throw new ApiError('Kid profile not found', 404, 404);

    const kid = await prisma.kid_profile.findUnique({ where: { id: BigInt(kidId) } });

    return {
        id: kid.id.toString(),
        name: kid.name,
        date_of_birth: kid.birth_date,
        birth_date: kid.birth_date,
        age: ageFromBirthDate(kid.birth_date),
        is_active: true,
        isActive: true,
        gender: kid.gender,
        interests: kid.interests || [],
        parent_rule: kid.parent_rule || null,
    };
}

/**
 * Delete a child's custom-card pack and its items, returning the storage URLs
 * the caller must sweep once the transaction has committed.
 *
 * The pack is keyed by pack_code rather than an FK, so nothing cascades: without
 * this the pack, its items and every S3 object behind them outlive the child
 * forever. An FK would not have helped either — it cannot reach S3, so this
 * function has to exist regardless.
 *
 * The sweep is deliberately the caller's job and deliberately after the commit:
 * deleting objects first and then failing the write would leave rows pointing at
 * files that are gone. An orphaned object is the cheaper failure.
 *
 * @returns {Promise<string[]>} audio and image URLs to delete from storage
 */
async function deleteCustomPackForKid(tx, kidId) {
    const pack = await tx.rfid_content_pack.findFirst({
        where: { pack_code: packCodeForKid(kidId) },
        select: { id: true },
    });
    if (!pack) return [];

    const items = await tx.content_item.findMany({
        where: { content_pack_id: pack.id },
        select: { audio_url: true, image_url: true },
    });
    await tx.content_item.deleteMany({ where: { content_pack_id: pack.id } });
    await tx.rfid_content_pack.delete({ where: { id: pack.id } });

    return items.flatMap((item) => [item.audio_url, item.image_url]).filter(Boolean);
}

async function deleteKid(firebaseUid, kidId) {
    const user = await prisma.sys_user.findUnique({
        where: { firebase_uid: firebaseUid },
    });
    if (!user) throw new Error('User not found');

    // Verify kid belongs to this user
    const kid = await prisma.kid_profile.findFirst({
        where: { id: BigInt(kidId), user_id: user.id },
    });
    if (!kid) throw new Error('Kid profile not found');

    let retired = [];
    await prisma.$transaction(async (tx) => {
        await tx.ai_device.updateMany({
            where: { kid_id: BigInt(kidId) },
            data: { kid_id: null, update_date: new Date() },
        });
        retired = await deleteCustomPackForKid(tx, kidId);
        await tx.kid_profile.delete({ where: { id: BigInt(kidId) } });
    });
    // Returned so the caller can clean up the publicly-served objects: the
    // avatar, and every custom-card recording and picture the child owned.
    return { success: true, avatar_url: kid.avatar_url, retired };
}

// ─── RPC Replacements ───────────────────────────────────────────────────────

async function checkEmailExists(email) {
    const user = await prisma.sys_user.findUnique({
        where: { email },
    });
    return { exists: !!user };
}

async function deleteUserAccount(firebaseUid) {
    const user = await prisma.sys_user.findUnique({
        where: { firebase_uid: firebaseUid },
    });
    if (!user) throw new Error('User not found');

    const kids = await prisma.kid_profile.findMany({
        where: { user_id: user.id },
        select: { id: true, avatar_url: true },
    });

    // Delete all user references (Cascade should handle most if set up, but doing it explicitly for safety)
    const retired = [];
    await prisma.$transaction(async (tx) => {
        // Custom packs hang off pack_code, not an FK, so deleting the children
        // does not reach them. Same reasoning as deleteKid — see there.
        for (const kid of kids) {
            retired.push(...await deleteCustomPackForKid(tx, kid.id));
        }
        await tx.kid_profile.deleteMany({ where: { user_id: user.id } });
        await tx.parent_profile.deleteMany({ where: { user_id: user.id } });
        await tx.ai_device.deleteMany({ where: { user_id: user.id } });
        await tx.sys_user.delete({ where: { id: user.id } });
    });

    // Swept by the route after the commit, alongside the avatars.
    return {
        success: true,
        user_id: firebaseUid,
        deleted_at: new Date().toISOString(),
        retired,
        avatar_urls: kids.map((kid) => kid.avatar_url).filter(Boolean),
    };
}

async function getHomepageActivity(firebaseUid, options = {}) {
    const summary = await getProgressSummary(firebaseUid, {
        ...options,
        period: 'today',
    });
    const scope = await resolveProgressScope(firebaseUid, options);
    const [recentCardActivities, momentOfTheDay] = await Promise.all([
        getRecentAnalyticsCardActivities(scope.macAddresses, 3),
        getHomepageAiMoment(scope, options.now || new Date()),
    ]);
    const recentCardActivity = recentCardActivities[0] || null;

    return {
        today_progress: {
            date: summary.endDate,
            card_tap_count: summary.card_tap_count,
            cardTapCount: summary.cardTapCount,
            ai_interaction_count: summary.ai_interaction_count,
            aiInteractionCount: summary.aiInteractionCount,
            usage_time_seconds: summary.usage_time_seconds,
            usageTimeSeconds: summary.usageTimeSeconds,
            games_played: summary.games_played,
            gamesPlayed: summary.gamesPlayed,
        },
        todayProgress: {
            date: summary.endDate,
            cardTapCount: summary.cardTapCount,
            aiInteractionCount: summary.aiInteractionCount,
            usageTimeSeconds: summary.usageTimeSeconds,
            gamesPlayed: summary.gamesPlayed,
        },
        recent_activity: recentCardActivity,
        recentActivity: recentCardActivity,
        recent_activities: recentCardActivities,
        recentActivities: recentCardActivities,
        moment_of_the_day: momentOfTheDay,
        momentOfTheDay: momentOfTheDay,
    };
}

async function getHomepageActivityDetails(firebaseUid, options = {}) {
    const metric = String(options.metric || '').trim().toLowerCase();
    const period = String(options.period || '').trim().toLowerCase();
    if (!['games', 'usage', 'cards', 'ai_interaction'].includes(metric)) {
        throw new ApiError('metric must be one of: games, usage, cards, ai_interaction', 400, 400);
    }
    if (!['week', 'month'].includes(period)) {
        throw new ApiError('period must be one of: week, month', 400, 400);
    }

    const user = await prisma.sys_user.findUnique({
        where: { firebase_uid: firebaseUid },
        select: {
            id: true,
            parent_profile: { select: { timezone: true } },
        },
    });
    if (!user) throw new ApiError('Access denied', 403, 403);
    const timezone = resolveTimezone(user.parent_profile?.timezone);

    const devices = await prisma.ai_device.findMany({
        where: { user_id: user.id },
        select: { id: true, mac_address: true },
    });
    const ownedMacAddresses = (devices || [])
        .map(device => normalizeMacAddress(device.mac_address) || device.mac_address)
        .filter(Boolean);
    const requestedDeviceId = options.deviceId || options.device_id;
    const hasRequestedMac = Boolean(options.mac || options.mac_address || options.macAddress);
    const requestedMac = normalizeMacAddress(options.mac || options.mac_address || options.macAddress);
    let macAddresses = ownedMacAddresses;
    if (requestedDeviceId) {
        const selectedDevice = (devices || []).find(device => String(device.id) === String(requestedDeviceId));
        if (!selectedDevice) throw new ApiError('Device not found', 404, 404);
        const selectedMac = normalizeMacAddress(selectedDevice.mac_address) || selectedDevice.mac_address;
        macAddresses = selectedMac ? [selectedMac] : [];
    } else if (hasRequestedMac) {
        if (!requestedMac || !ownedMacAddresses.includes(requestedMac)) {
            throw new ApiError('Device not found', 404, 404);
        }
        macAddresses = [requestedMac];
    }

    const now = options.now || new Date();
    const selectedMonth = options.month || options.selected_month || options.selectedMonth;

    if (macAddresses.length === 0) {
        const emptyResponse = metric === 'usage'
            ? toDurationResponse(period, new Map())
            : toCountResponse(metric, period, new Map());
        return period === 'month'
            ? withMonthSections(emptyResponse, [], buildMonthPicker([], now, timezone))
            : withWeekSections(emptyResponse, selectedMonth || now, [], timezone);
    }

    const range = getActivityDetailsRange(period, timezone, now, selectedMonth);
    const monthKey = range.monthKey;
    const ownerFilter = await ownerFilterForMacs(macAddresses);
    const fetched = await prisma.device_analytics_event.findMany({
        where: {
            ...ownerFilter,
            server_received_at: rangeInstantWindow(range),
        },
        select: {
            event_name: true,
            duration_ms: true,
            rfid_uid: true,
            content_id: true,
            content_type: true,
            game_id: true,
            station: true,
            data: true,
            server_received_at: true,
        },
        orderBy: { server_received_at: 'asc' },
        take: 5000,
    });
    // The window above is deliberately wide; the parent's calendar day is what
    // decides membership.
    const events = (fetched || []).filter(row => rangeContainsDateKey(
        range,
        formatDateInTimezone(row.server_received_at, timezone)
    ));
    const monthPicker = period === 'month' ? buildMonthPicker(events, now, timezone) : null;
    const weekMonth = period === 'week' ? (monthKey || selectedMonth || now) : now;

    if (metric === 'games') {
        const grouped = buildGamesGrouped(events);
        const sections = period === 'month'
            ? await buildMonthSections(events, buildGamesGrouped, toCountSection, timezone)
            : null;
        let weekSections = null;
        if (period === 'week') {
            const fetchedGameRows = await prisma.device_games_played.findMany({
                where: {
                    ...ownerFilter,
                    played_at: rangeInstantWindow(range),
                },
                orderBy: { played_at: 'desc' },
                take: 5000,
            });
            const gameRows = (fetchedGameRows || []).filter(row => rangeContainsDateKey(
                range,
                formatDateInTimezone(row.played_at, timezone)
            ));
            weekSections = gameRows.length > 0
                ? buildGamePlayedWeekSections(gameRows, weekMonth, timezone)
                : await buildWeekSections(events, weekMonth, buildGamesGrouped, toCountWeekSection, timezone);
        }
        return withWeekSections(withMonthSections(toCountResponse('games', period, grouped), sections, monthPicker), weekMonth, weekSections, timezone);
    }

    if (metric === 'cards') {
        const grouped = await buildCardsGrouped(events);
        const sections = period === 'month'
            ? await buildMonthSections(events, buildCardsGrouped, toCountSection, timezone)
            : null;
        const weekSections = period === 'week'
            ? await buildWeekSections(events, weekMonth, buildCardsGrouped, toCountWeekSection, timezone)
            : null;
        return withWeekSections(withMonthSections(toCountResponse('cards', period, grouped), sections, monthPicker), weekMonth, weekSections, timezone);
    }

    if (metric === 'ai_interaction') {
        const grouped = await buildAiInteractionGrouped(events);
        const sections = period === 'month'
            ? await buildMonthSections(events, buildAiInteractionGrouped, toCountSection, timezone)
            : null;
        const weekSections = period === 'week'
            ? await buildWeekSections(events, weekMonth, buildAiInteractionGrouped, toCountWeekSection, timezone)
            : null;
        return withWeekSections(withMonthSections(toCountResponse('ai_interaction', period, grouped), sections, monthPicker), weekMonth, weekSections, timezone);
    }

    const grouped = await buildUsageGrouped(events);
    const sections = period === 'month'
        ? await buildMonthSections(events, buildUsageGrouped, toDurationSection, timezone)
        : null;
    const weekSections = period === 'week'
        ? await buildWeekSections(events, weekMonth, buildUsageGrouped, toDurationWeekSection, timezone)
        : null;
    return withWeekSections(withMonthSections(toDurationResponse(period, grouped), sections, monthPicker), weekMonth, weekSections, timezone);
}

function formatRecentAnalyticsCardActivity(row) {
    if (!row) return null;
    const data = safeObject(row.data);
    const cardType = data.card_type || row.content_type || 'unknown';
    const contentPackCode = data.content_pack_code || null;
    const contentPackName = data.content_pack_name || data.content_name || null;
    const contentPackId = row.content_id ? String(row.content_id) : null;
    const imageUrl = firstKnownValue(
        data.imageUrl,
        data.image_url,
        data.thumbnailUrl,
        data.thumbnail_url,
        data.cardImageUrl,
        data.card_image_url,
        data.cardThumbnailUrl,
        data.card_thumbnail_url,
        data.coverUrl,
        data.cover_url
    );

    return {
        id: row.id != null ? row.id.toString() : null,
        mac_address: row.mac_address,
        macAddress: row.mac_address,
        rfid_uid: row.rfid_uid || data.rfid_uid || null,
        rfidUid: row.rfid_uid || data.rfid_uid || null,
        card_type: cardType,
        cardType,
        content_pack_id: contentPackId,
        contentPackId: contentPackId,
        content_pack_code: contentPackCode,
        contentPackCode,
        content_pack_name: contentPackName,
        contentPackName,
        image_url: imageUrl,
        imageUrl,
        thumbnail_url: imageUrl,
        thumbnailUrl: imageUrl,
        created_at: row.server_received_at || row.event_timestamp || null,
        createdAt: row.server_received_at || row.event_timestamp || null,
    };
}

function recentAnalyticsCardKey(row) {
    if (!row) return null;
    const data = safeObject(row.data);
    const key = row.rfid_uid || data.rfid_uid || data.card_uid || data.card_id || row.content_id || data.content_id;
    return key == null ? null : String(key).toLowerCase();
}

function recentActivityPackTitleKey(activity) {
    if (!activity) return null;
    const title = cleanKnownValue(
        activity.content_pack_name
        || activity.contentPackName
        || activity.title
        || activity.name
        || activity.rfid_uid
        || activity.rfidUid
    );
    return title ? title.toLowerCase() : null;
}

/**
 * The same owner filter as progressOwnerFilter, for the read paths that resolve
 * their own device list instead of going through resolveProgressScope.
 */
async function ownerFilterForMacs(macAddresses) {
    if (!macAddresses || !macAddresses.length) return { mac_address: { in: [] } };
    const devices = await prisma.ai_device.findMany({
        where: { mac_address: { in: macAddresses } },
        select: { mac_address: true, kid_id: true },
    });
    return progressOwnerFilter({
        kidIds: devices.filter((d) => d.kid_id).map((d) => d.kid_id),
        unpairedMacAddresses: macAddresses.filter((mac) => {
            const row = devices.find((d) => (normalizeMacAddress(d.mac_address) || d.mac_address) === mac);
            return !row || !row.kid_id;
        }),
    });
}

async function getRecentAnalyticsCardActivities(macAddresses, limit = 3) {
    if (!macAddresses || macAddresses.length === 0) return [];
    const rows = await prisma.device_analytics_event.findMany({
        where: {
            ...(await ownerFilterForMacs(macAddresses)),
            event_name: 'card_session_start',
        },
        select: {
            id: true,
            mac_address: true,
            event_timestamp: true,
            server_received_at: true,
            rfid_uid: true,
            content_id: true,
            content_type: true,
            data: true,
        },
        orderBy: { server_received_at: 'desc' },
        take: Math.max(limit * 50, 150),
    });

    const candidateRows = [];
    const seen = new Set();
    for (const row of rows || []) {
        const key = recentAnalyticsCardKey(row);
        if (!key || seen.has(key)) continue;
        seen.add(key);
        candidateRows.push(row);
    }

    const cardKeys = candidateRows
        .map(row => row.rfid_uid || safeObject(row.data).rfid_uid || safeObject(row.data).card_uid || safeObject(row.data).card_id)
        .filter(Boolean);
    const cardMetadataMap = await getRecentCardActivityMetadataMap(cardKeys);

    const activities = candidateRows.map(row => {
        const activity = formatRecentAnalyticsCardActivity(row);
        const data = safeObject(row.data);
        const key = row.rfid_uid || data.rfid_uid || data.card_uid || data.card_id;
        const metadata = key
            ? cardMetadataMap.get(String(key)) || cardMetadataMap.get(String(key).toLowerCase()) || cardMetadataMap.get(String(key).toUpperCase())
            : null;
        if (metadata?.name) {
            activity.content_pack_name = metadata.name;
            activity.contentPackName = metadata.name;
        }
        if (!activity.image_url && metadata?.thumbnailUrl) {
            activity.image_url = metadata.thumbnailUrl;
            activity.imageUrl = metadata.thumbnailUrl;
            activity.thumbnail_url = metadata.thumbnailUrl;
            activity.thumbnailUrl = metadata.thumbnailUrl;
        }
        return activity;
    });

    const uniqueActivities = [];
    const seenPackTitles = new Set();
    for (const activity of activities) {
        const key = recentActivityPackTitleKey(activity);
        if (key && seenPackTitles.has(key)) continue;
        if (key) seenPackTitles.add(key);
        uniqueActivities.push(activity);
        if (uniqueActivities.length >= limit) break;
    }

    logger.info('[HomeRecent] Recent card activity selected', {
        macAddresses,
        rawRows: rows?.length || 0,
        candidateCards: candidateRows.length,
        limit,
        candidateTitles: activities.slice(0, 10).map(activity => ({
            title: activity.content_pack_name || activity.contentPackName || activity.title || activity.rfid_uid,
            rfid_uid: activity.rfid_uid,
            created_at: activity.created_at,
        })),
        selectedTitles: uniqueActivities.map(activity => ({
            title: activity.content_pack_name || activity.contentPackName || activity.title || activity.rfid_uid,
            rfid_uid: activity.rfid_uid,
            created_at: activity.created_at,
        })),
    });

    return uniqueActivities;
}

async function resolveProgressScope(firebaseUid, options = {}) {
    const user = await prisma.sys_user.findUnique({
        where: { firebase_uid: firebaseUid },
        select: {
            id: true,
            parent_profile: { select: { timezone: true } },
        },
    });
    if (!user) throw new ApiError('Access denied', 403, 403);

    const devices = await prisma.ai_device.findMany({
        where: { user_id: user.id },
        select: { mac_address: true, kid_id: true },
    });

    // A named child is checked against the account that asked for it, the same way
    // a named toy is just below — so one guard answers both "is this my toy" and
    // "is this my child", and neither reaches another family's.
    const requestedKidId = options.kidId ? parseBigIntId(options.kidId, 'kidId') : null;
    if (requestedKidId != null) {
        const kid = await prisma.kid_profile.findFirst({
            where: { id: requestedKidId, user_id: user.id },
            select: { id: true },
        });
        if (!kid) throw new ApiError('Kid not found', 404, 404);
    }

    const ownedMacAddresses = (devices || [])
        .map(device => normalizeMacAddress(device.mac_address) || device.mac_address)
        .filter(Boolean);
    const requestedMac = normalizeMacAddress(options.mac || options.mac_address || options.macAddress);

    if ((options.mac || options.mac_address || options.macAddress) && (!requestedMac || !ownedMacAddresses.includes(requestedMac))) {
        throw new ApiError('Device not found', 404, 404);
    }

    const macAddresses = requestedMac ? [requestedMac] : ownedMacAddresses;
    const inScope = (devices || []).filter((d) => {
        const mac = normalizeMacAddress(d.mac_address) || d.mac_address;
        return macAddresses.includes(mac);
    });

    return {
        userId: user.id,
        timezone: resolveTimezone(user.parent_profile?.timezone),
        macAddresses,
        kidIds: requestedKidId != null
            ? [requestedKidId]
            : inScope.filter((d) => d.kid_id).map((d) => d.kid_id),
        unpairedMacAddresses: inScope
            .filter((d) => !d.kid_id)
            .map((d) => normalizeMacAddress(d.mac_address) || d.mac_address),
    };
}

/**
 * Which rollup rows belong to the children in scope.
 *
 * A paired device's history is read by child, so it follows them to a new toy
 * and does not follow the toy to a sibling. An unpaired device falls back to its
 * own MAC AND to rows with no child — without that second half, a toy handed on
 * before the parent picks a child would report the previous child's totals.
 *
 * A parent can own both kinds at once, so this is an OR rather than a branch.
 */
function progressOwnerFilter(scope) {
    const branches = [];
    if (scope.kidIds && scope.kidIds.length) {
        branches.push({ kid_id: { in: scope.kidIds } });
    }
    if (scope.unpairedMacAddresses && scope.unpairedMacAddresses.length) {
        branches.push({ mac_address: { in: scope.unpairedMacAddresses }, kid_id: null });
    }
    // Nothing in scope: match nothing rather than everything.
    if (!branches.length) return { mac_address: { in: [] } };
    return branches.length === 1 ? branches[0] : { OR: branches };
}

async function resolveAdminProgressScopeByMac(mac) {
    const normalizedMac = normalizeMacAddress(mac);
    if (!normalizedMac) throw new ApiError('Invalid mac address', 400, 400);

    const device = await prisma.ai_device.findUnique({
        where: { mac_address: normalizedMac },
        select: { user_id: true, kid_id: true },
    });
    if (!device) throw new ApiError('Device not found', 404, 404);

    let timezone = resolveTimezone(null);
    if (device.user_id != null) {
        const profile = await prisma.parent_profile.findUnique({
            where: { user_id: device.user_id },
            select: { timezone: true },
        });
        timezone = resolveTimezone(profile?.timezone);
    }

    return {
        userId: device.user_id || null,
        timezone,
        macAddresses: [normalizedMac],
        kidIds: device.kid_id ? [device.kid_id] : [],
        unpairedMacAddresses: device.kid_id ? [] : [normalizedMac],
    };
}

async function getProgressSummary(firebaseUid, options = {}) {
    const period = String(options.period || 'today').trim().toLowerCase();
    if (!PROGRESS_PERIODS.includes(period)) {
        throw new ApiError('period must be one of: today, week, month', 400, 400);
    }

    const scope = await resolveProgressScope(firebaseUid, options);
    const range = buildProgressDateRange(period, scope.timezone, options.now || new Date());
    if (scope.macAddresses.length === 0) {
        return {
            period,
            timezone: scope.timezone,
            start_date: range.startDate,
            startDate: range.startDate,
            end_date: range.endDate,
            endDate: range.endDate,
            usage_time_seconds: 0,
            usageTimeSeconds: 0,
            card_tap_count: 0,
            cardTapCount: 0,
            games_played: 0,
            gamesPlayed: 0,
            ai_interaction_count: 0,
            aiInteractionCount: 0,
        };
    }

    const dateWhere = {
        gte: dateOnlyFromKey(range.startDate),
        lte: dateOnlyFromKey(range.endDate),
    };

    const [
        usageRows,
        cardRows,
        aiRows,
        projectedGamesCount,
    ] = await Promise.all([
        prisma.device_usage_daily.findMany({
            where: {
                ...progressOwnerFilter(scope),
                date: dateWhere,
            },
            select: {
                usage_time_seconds: true,
                game_usage_seconds: true,
                card_usage_seconds: true,
                ai_talk_usage_seconds: true,
                radio_usage_seconds: true,
            },
        }),
        prisma.device_card_taps_daily.findMany({
            where: {
                ...progressOwnerFilter(scope),
                date: dateWhere,
            },
            select: { card_tap_count: true },
        }),
        prisma.device_ai_interactions_daily.findMany({
            where: {
                ...progressOwnerFilter(scope),
                date: dateWhere,
            },
            select: { ai_interaction_count: true },
        }),
        prisma.device_games_played.count({
            where: {
                ...progressOwnerFilter(scope),
                activity_date: dateWhere,
            },
        }),
    ]);
    const gamesCount = projectedGamesCount > 0
        ? projectedGamesCount
        : await countRawGameStartsForRange(scope, range);

    const usageTimeSeconds = completedUsageSecondsForRows(usageRows);
    const cardTapCount = sumBy(cardRows, 'card_tap_count');
    const aiInteractionCount = sumBy(aiRows, 'ai_interaction_count');

    return {
        period,
        timezone: scope.timezone,
        start_date: range.startDate,
        startDate: range.startDate,
        end_date: range.endDate,
        endDate: range.endDate,
        usage_time_seconds: usageTimeSeconds,
        usageTimeSeconds,
        card_tap_count: cardTapCount,
        cardTapCount,
        games_played: gamesCount,
        gamesPlayed: gamesCount,
        ai_interaction_count: aiInteractionCount,
        aiInteractionCount,
    };
}

async function getProgressTrend(firebaseUid, options = {}) {
    const period = String(options.period || '').trim().toLowerCase();
    if (!['week', 'month'].includes(period)) {
        throw new ApiError('period must be one of: week, month', 400, 400);
    }

    const scope = await resolveProgressScope(firebaseUid, options);
    const range = period === 'week'
        ? buildProgressCalendarMonthRange(
            scope.timezone,
            options.now || new Date(),
            options.month || options.selected_month || options.selectedMonth
        )
        : buildProgressDateRange(period, scope.timezone, options.now || new Date());
    const trendMap = new Map(
        range.dates.map(date => [date, {
            date,
            usage_time_seconds: 0,
            usageTimeSeconds: 0,
            card_tap_count: 0,
            cardTapCount: 0,
            games_played: 0,
            gamesPlayed: 0,
            ai_interaction_count: 0,
            aiInteractionCount: 0,
        }])
    );

    if (scope.macAddresses.length === 0) {
        return { period, timezone: scope.timezone, points: Array.from(trendMap.values()) };
    }

    const dateWhere = {
        gte: dateOnlyFromKey(range.startDate),
        lte: dateOnlyFromKey(range.endDate),
    };

    const [usageRows, cardRows, aiRows, gameRows] = await Promise.all([
        prisma.device_usage_daily.findMany({
            where: { ...progressOwnerFilter(scope), date: dateWhere },
            select: {
                date: true,
                usage_time_seconds: true,
                game_usage_seconds: true,
                card_usage_seconds: true,
                ai_talk_usage_seconds: true,
                radio_usage_seconds: true,
            },
        }),
        prisma.device_card_taps_daily.findMany({
            where: { ...progressOwnerFilter(scope), date: dateWhere },
            select: { date: true, card_tap_count: true },
        }),
        prisma.device_ai_interactions_daily.findMany({
            where: { ...progressOwnerFilter(scope), date: dateWhere },
            select: { date: true, ai_interaction_count: true },
        }),
        prisma.device_games_played.findMany({
            where: { ...progressOwnerFilter(scope), activity_date: dateWhere },
            select: { activity_date: true },
        }),
    ]);

    for (const row of usageRows || []) {
        const key = dateOnlyKey(row.date);
        const point = trendMap.get(key);
        if (!point) continue;
        // Unrounded here; every device for the day is added first and the
        // bar is floored once, in finalizeTrendPoints below.
        point.usage_time_seconds += rawUsageSecondsFromRow(row);
    }
    for (const row of cardRows || []) {
        const key = dateOnlyKey(row.date);
        const point = trendMap.get(key);
        if (!point) continue;
        const value = Number(row.card_tap_count) || 0;
        point.card_tap_count += value;
        point.cardTapCount += value;
    }
    for (const row of aiRows || []) {
        const key = dateOnlyKey(row.date);
        const point = trendMap.get(key);
        if (!point) continue;
        const value = Number(row.ai_interaction_count) || 0;
        point.ai_interaction_count += value;
        point.aiInteractionCount += value;
    }
    for (const row of gameRows || []) {
        const key = dateOnlyKey(row.activity_date);
        const point = trendMap.get(key);
        if (!point) continue;
        point.games_played += 1;
        point.gamesPlayed += 1;
    }

    return {
        period,
        timezone: scope.timezone,
        points: finalizeTrendPoints(trendMap),
    };
}

async function getProgressDetails(firebaseUid, options = {}) {
    const metric = String(options.metric || '').trim().toLowerCase();
    const period = String(options.period || 'today').trim().toLowerCase();
    if (!PROGRESS_DETAIL_METRICS.includes(metric)) {
        throw new ApiError('metric must be one of: usage, cards, games, ai, radio', 400, 400);
    }
    if (!PROGRESS_PERIODS.includes(period)) {
        throw new ApiError('period must be one of: today, week, month', 400, 400);
    }

    const scope = await resolveProgressScope(firebaseUid, options);
    const range = period === 'week'
        ? buildProgressCalendarMonthRange(
            scope.timezone,
            options.now || new Date(),
            options.month || options.selected_month || options.selectedMonth
        )
        : buildProgressDateRange(period, scope.timezone, options.now || new Date());
    const { page, limit, offset } = parsePagination(options);
    const detailNow = options.now || new Date();
    const weekMonth = period === 'week'
        ? (options.month || options.selected_month || options.selectedMonth || detailNow)
        : detailNow;

    if (scope.macAddresses.length === 0) {
        return { metric, period, page, limit, total_items: 0, totalItems: 0, items: [] };
    }

    const dateWhere = {
        gte: dateOnlyFromKey(range.startDate),
        lte: dateOnlyFromKey(range.endDate),
    };

    if (metric === 'usage') {
        const rows = await prisma.device_usage_daily.findMany({
            where: {
                ...progressOwnerFilter(scope),
                date: dateWhere,
            },
            select: {
                date: true,
                game_usage_seconds: true,
                card_usage_seconds: true,
                ai_talk_usage_seconds: true,
                radio_usage_seconds: true,
            },
        });
        const { items, totalSeconds } = usageCategoryItemsFromDailyRows(rows);
        let weekSections = null;
        if (period === 'week') {
            const monthKey = getMonthKeyFromReference(options.month || options.selected_month || options.selectedMonth || options.now || new Date(), scope.timezone);
            const monthStart = dateOnlyFromKey(monthStartDateKey(monthKey));
            const monthEnd = dateOnlyFromKey(range.endDate);
            const sectionRows = await prisma.device_usage_daily.findMany({
                where: {
                    ...progressOwnerFilter(scope),
                    date: {
                        gte: monthStart || dateWhere.gte,
                        lte: monthEnd,
                    },
                },
                select: {
                    date: true,
                    game_usage_seconds: true,
                    card_usage_seconds: true,
                    ai_talk_usage_seconds: true,
                    radio_usage_seconds: true,
                },
            });
            weekSections = buildUsageWeekSectionsFromDailyRows(sectionRows, monthKey, scope.timezone);
        }
        const paged = items.slice(offset, offset + limit);
        return {
            metric,
            period,
            page,
            limit,
            total_items: items.length,
            totalItems: items.length,
            total_seconds: totalSeconds,
            totalSeconds,
            items: paged,
            ...(weekSections ? {
                period_label: getMonthLabel(getMonthKeyFromReference(options.month || options.selected_month || options.selectedMonth || options.now || new Date(), scope.timezone)),
                periodLabel: getMonthLabel(getMonthKeyFromReference(options.month || options.selected_month || options.selectedMonth || options.now || new Date(), scope.timezone)),
                week_sections: weekSections,
                weekSections,
            } : {}),
        };
    }

    if (metric === 'cards') {
        const events = await getProgressEventsForRange(scope, range, 'card_session_start');
        const items = await buildCardProgressDetailItems(events);
        const total = items.reduce((sum, item) => sum + item.count, 0);
        const paged = items.slice(offset, offset + limit);
        const monthPicker = period === 'month' ? buildMonthPicker(events, detailNow, scope.timezone) : null;
        const sections = period === 'month'
            ? await buildMonthSections(events, buildCardsGrouped, toCountSection, scope.timezone)
            : null;
        const weekSections = period === 'week'
            ? await buildWeekSections(events, weekMonth, buildCardsGrouped, toCountWeekSection, scope.timezone)
            : null;
        return withWeekSections(withMonthSections({
            metric,
            period,
            page,
            limit,
            total,
            total_items: items.length,
            totalItems: items.length,
            items: paged,
        }, sections, monthPicker), weekMonth, weekSections, scope.timezone);
    }

    if (metric === 'ai') {
        const events = await getProgressEventsForRange(scope, range, ['card_session_start', 'ai_talk_start', 'ai_talk_end']);
        const items = await buildAiProgressDetailItems(events);
        const total = items.reduce((sum, item) => sum + item.count, 0);
        const paged = items.slice(offset, offset + limit);
        const monthPicker = period === 'month' ? buildMonthPicker(events, detailNow, scope.timezone) : null;
        const sections = period === 'month'
            ? await buildMonthSections(events, buildAiInteractionGrouped, toCountSection, scope.timezone)
            : null;
        const weekSections = period === 'week'
            ? await buildWeekSections(events, weekMonth, buildAiInteractionGrouped, toCountWeekSection, scope.timezone)
            : null;
        return withWeekSections(withMonthSections({
            metric,
            period,
            page,
            limit,
            total,
            total_items: items.length,
            totalItems: items.length,
            items: paged,
        }, sections, monthPicker), weekMonth, weekSections, scope.timezone);
    }

    if (metric === 'games') {
        const where = {
            ...progressOwnerFilter(scope),
            activity_date: dateWhere,
        };
        const [totalItems, rows] = await Promise.all([
            prisma.device_games_played.count({ where }),
            prisma.device_games_played.findMany({
                where,
                orderBy: { played_at: 'desc' },
                skip: offset,
                take: limit,
            }),
        ]);
        const items = (rows || []).map(row => ({
            id: row.id,
            mac_address: row.mac_address,
            macAddress: row.mac_address,
            game_id: row.game_id,
            gameId: row.game_id,
            game_name: row.game_name,
            gameName: row.game_name,
            level: row.level,
            difficulty_level: row.difficulty_level,
            difficultyLevel: row.difficulty_level,
            score: row.score,
            duration_ms: row.duration_ms,
            durationMs: row.duration_ms,
            played_at: row.played_at,
            playedAt: row.played_at,
            source_event_id: row.source_event_id,
            sourceEventId: row.source_event_id,
        }));
        return {
            metric,
            period,
            page,
            limit,
            total_items: totalItems,
            totalItems,
            items,
        };
    }

    const where = {
        ...progressOwnerFilter(scope),
        activity_date: dateWhere,
    };
    const [totalItems, rows] = await Promise.all([
        prisma.device_radio_played.count({ where }),
        prisma.device_radio_played.findMany({
            where,
            orderBy: { played_at: 'desc' },
            skip: offset,
            take: limit,
        }),
    ]);
    const items = (rows || []).map(row => ({
        id: row.id,
        mac_address: row.mac_address,
        macAddress: row.mac_address,
        station: row.station,
        duration_ms: row.duration_ms,
        durationMs: row.duration_ms,
        played_at: row.played_at,
        playedAt: row.played_at,
        source_event_id: row.source_event_id,
        sourceEventId: row.source_event_id,
    }));
    return {
        metric,
        period,
        page,
        limit,
        total_items: totalItems,
        totalItems,
        items,
    };
}

async function getDeviceGamesPlayed(firebaseUid, mac, options = {}) {
    const normalizedMac = normalizeMacAddress(mac);
    if (!normalizedMac) throw new ApiError('Invalid mac address', 400, 400);
    return getProgressDetails(firebaseUid, {
        ...options,
        mac: normalizedMac,
        metric: 'games',
    });
}

async function getDeviceRadioPlayed(firebaseUid, mac, options = {}) {
    const normalizedMac = normalizeMacAddress(mac);
    if (!normalizedMac) throw new ApiError('Invalid mac address', 400, 400);
    return getProgressDetails(firebaseUid, {
        ...options,
        mac: normalizedMac,
        metric: 'radio',
    });
}

async function getProgressSummaryByMacAdmin(mac, options = {}) {
    const period = String(options.period || 'today').trim().toLowerCase();
    if (!PROGRESS_PERIODS.includes(period)) {
        throw new ApiError('period must be one of: today, week, month', 400, 400);
    }

    const scope = await resolveAdminProgressScopeByMac(mac);
    const range = buildProgressDateRange(period, scope.timezone, options.now || new Date());
    const dateWhere = {
        gte: dateOnlyFromKey(range.startDate),
        lte: dateOnlyFromKey(range.endDate),
    };

    const [usageRows, cardRows, aiRows, gamesCount] = await Promise.all([
        prisma.device_usage_daily.findMany({
            where: { ...progressOwnerFilter(scope), date: dateWhere },
            select: {
                usage_time_seconds: true,
                game_usage_seconds: true,
                card_usage_seconds: true,
                ai_talk_usage_seconds: true,
                radio_usage_seconds: true,
            },
        }),
        prisma.device_card_taps_daily.findMany({
            where: { ...progressOwnerFilter(scope), date: dateWhere },
            select: { card_tap_count: true },
        }),
        prisma.device_ai_interactions_daily.findMany({
            where: { ...progressOwnerFilter(scope), date: dateWhere },
            select: { ai_interaction_count: true },
        }),
        prisma.device_games_played.count({
            where: { ...progressOwnerFilter(scope), activity_date: dateWhere },
        }),
    ]);

    const usageTimeSeconds = completedUsageSecondsForRows(usageRows);
    const cardTapCount = sumBy(cardRows, 'card_tap_count');
    const aiInteractionCount = sumBy(aiRows, 'ai_interaction_count');

    return {
        period,
        timezone: scope.timezone,
        start_date: range.startDate,
        startDate: range.startDate,
        end_date: range.endDate,
        endDate: range.endDate,
        usage_time_seconds: usageTimeSeconds,
        usageTimeSeconds,
        card_tap_count: cardTapCount,
        cardTapCount,
        games_played: gamesCount,
        gamesPlayed: gamesCount,
        ai_interaction_count: aiInteractionCount,
        aiInteractionCount,
    };
}

async function getProgressTrendByMacAdmin(mac, options = {}) {
    const period = String(options.period || '').trim().toLowerCase();
    if (!['week', 'month'].includes(period)) {
        throw new ApiError('period must be one of: week, month', 400, 400);
    }

    const scope = await resolveAdminProgressScopeByMac(mac);
    const range = period === 'week'
        ? buildProgressCalendarMonthRange(
            scope.timezone,
            options.now || new Date(),
            options.month || options.selected_month || options.selectedMonth
        )
        : buildProgressDateRange(period, scope.timezone, options.now || new Date());
    const trendMap = new Map(
        range.dates.map(date => [date, {
            date,
            usage_time_seconds: 0,
            usageTimeSeconds: 0,
            card_tap_count: 0,
            cardTapCount: 0,
            games_played: 0,
            gamesPlayed: 0,
            ai_interaction_count: 0,
            aiInteractionCount: 0,
        }])
    );

    const dateWhere = {
        gte: dateOnlyFromKey(range.startDate),
        lte: dateOnlyFromKey(range.endDate),
    };

    const [usageRows, cardRows, aiRows, gameRows] = await Promise.all([
        prisma.device_usage_daily.findMany({
            where: { ...progressOwnerFilter(scope), date: dateWhere },
            select: {
                date: true,
                usage_time_seconds: true,
                game_usage_seconds: true,
                card_usage_seconds: true,
                ai_talk_usage_seconds: true,
                radio_usage_seconds: true,
            },
        }),
        prisma.device_card_taps_daily.findMany({
            where: { ...progressOwnerFilter(scope), date: dateWhere },
            select: { date: true, card_tap_count: true },
        }),
        prisma.device_ai_interactions_daily.findMany({
            where: { ...progressOwnerFilter(scope), date: dateWhere },
            select: { date: true, ai_interaction_count: true },
        }),
        prisma.device_games_played.findMany({
            where: { ...progressOwnerFilter(scope), activity_date: dateWhere },
            select: { activity_date: true },
        }),
    ]);

    for (const row of usageRows || []) {
        const key = dateOnlyKey(row.date);
        const point = trendMap.get(key);
        if (!point) continue;
        // Unrounded here; every device for the day is added first and the
        // bar is floored once, in finalizeTrendPoints below.
        point.usage_time_seconds += rawUsageSecondsFromRow(row);
    }
    for (const row of cardRows || []) {
        const key = dateOnlyKey(row.date);
        const point = trendMap.get(key);
        if (!point) continue;
        const value = Number(row.card_tap_count) || 0;
        point.card_tap_count += value;
        point.cardTapCount += value;
    }
    for (const row of aiRows || []) {
        const key = dateOnlyKey(row.date);
        const point = trendMap.get(key);
        if (!point) continue;
        const value = Number(row.ai_interaction_count) || 0;
        point.ai_interaction_count += value;
        point.aiInteractionCount += value;
    }
    for (const row of gameRows || []) {
        const key = dateOnlyKey(row.activity_date);
        const point = trendMap.get(key);
        if (!point) continue;
        point.games_played += 1;
        point.gamesPlayed += 1;
    }

    return {
        period,
        timezone: scope.timezone,
        points: finalizeTrendPoints(trendMap),
    };
}

async function getProgressDetailsByMacAdmin(mac, options = {}) {
    const metric = String(options.metric || '').trim().toLowerCase();
    const period = String(options.period || 'today').trim().toLowerCase();
    if (!PROGRESS_DETAIL_METRICS.includes(metric)) {
        throw new ApiError('metric must be one of: usage, cards, games, ai, radio', 400, 400);
    }
    if (!PROGRESS_PERIODS.includes(period)) {
        throw new ApiError('period must be one of: today, week, month', 400, 400);
    }

    const scope = await resolveAdminProgressScopeByMac(mac);
    const range = period === 'week'
        ? buildProgressCalendarMonthRange(
            scope.timezone,
            options.now || new Date(),
            options.month || options.selected_month || options.selectedMonth
        )
        : buildProgressDateRange(period, scope.timezone, options.now || new Date());
    const { page, limit, offset } = parsePagination(options);
    const detailNow = options.now || new Date();
    const weekMonth = period === 'week'
        ? (options.month || options.selected_month || options.selectedMonth || detailNow)
        : detailNow;
    const dateWhere = {
        gte: dateOnlyFromKey(range.startDate),
        lte: dateOnlyFromKey(range.endDate),
    };

    if (metric === 'usage') {
        const rows = await prisma.device_usage_daily.findMany({
            where: { ...progressOwnerFilter(scope), date: dateWhere },
            select: {
                date: true,
                game_usage_seconds: true,
                card_usage_seconds: true,
                ai_talk_usage_seconds: true,
                radio_usage_seconds: true,
            },
        });
        const { items, totalSeconds } = usageCategoryItemsFromDailyRows(rows);
        let weekSections = null;
        if (period === 'week') {
            const monthKey = getMonthKeyFromReference(options.month || options.selected_month || options.selectedMonth || options.now || new Date(), scope.timezone);
            const monthStart = dateOnlyFromKey(monthStartDateKey(monthKey));
            const monthEnd = dateOnlyFromKey(range.endDate);
            const sectionRows = await prisma.device_usage_daily.findMany({
                where: {
                    ...progressOwnerFilter(scope),
                    date: {
                        gte: monthStart || dateWhere.gte,
                        lte: monthEnd,
                    },
                },
                select: {
                    date: true,
                    game_usage_seconds: true,
                    card_usage_seconds: true,
                    ai_talk_usage_seconds: true,
                    radio_usage_seconds: true,
                },
            });
            weekSections = buildUsageWeekSectionsFromDailyRows(sectionRows, monthKey, scope.timezone);
        }
        return {
            metric,
            period,
            page,
            limit,
            total_items: items.length,
            totalItems: items.length,
            total_seconds: totalSeconds,
            totalSeconds,
            items: items.slice(offset, offset + limit),
            ...(weekSections ? {
                period_label: getMonthLabel(getMonthKeyFromReference(options.month || options.selected_month || options.selectedMonth || options.now || new Date(), scope.timezone)),
                periodLabel: getMonthLabel(getMonthKeyFromReference(options.month || options.selected_month || options.selectedMonth || options.now || new Date(), scope.timezone)),
                week_sections: weekSections,
                weekSections,
            } : {}),
        };
    }

    if (metric === 'cards') {
        const events = await getProgressEventsForRange(scope, range, 'card_session_start');
        const items = await buildCardProgressDetailItems(events);
        const monthPicker = period === 'month' ? buildMonthPicker(events, detailNow, scope.timezone) : null;
        const sections = period === 'month'
            ? await buildMonthSections(events, buildCardsGrouped, toCountSection, scope.timezone)
            : null;
        const weekSections = period === 'week'
            ? await buildWeekSections(events, weekMonth, buildCardsGrouped, toCountWeekSection, scope.timezone)
            : null;
        return withWeekSections(withMonthSections({
            metric,
            period,
            page,
            limit,
            total: items.reduce((sum, item) => sum + item.count, 0),
            total_items: items.length,
            totalItems: items.length,
            items: items.slice(offset, offset + limit),
        }, sections, monthPicker), weekMonth, weekSections, scope.timezone);
    }

    if (metric === 'ai') {
        const events = await getProgressEventsForRange(scope, range, ['card_session_start', 'ai_talk_start', 'ai_talk_end']);
        const items = await buildAiProgressDetailItems(events);
        const monthPicker = period === 'month' ? buildMonthPicker(events, detailNow, scope.timezone) : null;
        const sections = period === 'month'
            ? await buildMonthSections(events, buildAiInteractionGrouped, toCountSection, scope.timezone)
            : null;
        const weekSections = period === 'week'
            ? await buildWeekSections(events, weekMonth, buildAiInteractionGrouped, toCountWeekSection, scope.timezone)
            : null;
        return withWeekSections(withMonthSections({
            metric,
            period,
            page,
            limit,
            total: items.reduce((sum, item) => sum + item.count, 0),
            total_items: items.length,
            totalItems: items.length,
            items: items.slice(offset, offset + limit),
        }, sections, monthPicker), weekMonth, weekSections, scope.timezone);
    }

    if (metric === 'games') {
        const where = { ...progressOwnerFilter(scope), activity_date: dateWhere };
        const [totalItems, rows] = await Promise.all([
            prisma.device_games_played.count({ where }),
            prisma.device_games_played.findMany({
                where,
                orderBy: { played_at: 'desc' },
                skip: offset,
                take: limit,
            }),
        ]);
        return {
            metric,
            period,
            page,
            limit,
            total_items: totalItems,
            totalItems,
            items: (rows || []).map(row => ({
                id: row.id,
                mac_address: row.mac_address,
                macAddress: row.mac_address,
                game_id: row.game_id,
                gameId: row.game_id,
                game_name: row.game_name,
                gameName: row.game_name,
                level: row.level,
                difficulty_level: row.difficulty_level,
                difficultyLevel: row.difficulty_level,
                score: row.score,
                duration_ms: row.duration_ms,
                durationMs: row.duration_ms,
                played_at: row.played_at,
                playedAt: row.played_at,
                source_event_id: row.source_event_id,
                sourceEventId: row.source_event_id,
            })),
        };
    }

    const where = { ...progressOwnerFilter(scope), activity_date: dateWhere };
    const [totalItems, rows] = await Promise.all([
        prisma.device_radio_played.count({ where }),
        prisma.device_radio_played.findMany({
            where,
            orderBy: { played_at: 'desc' },
            skip: offset,
            take: limit,
        }),
    ]);
    return {
        metric,
        period,
        page,
        limit,
        total_items: totalItems,
        totalItems,
        items: (rows || []).map(row => ({
            id: row.id,
            mac_address: row.mac_address,
            macAddress: row.mac_address,
            station: row.station,
            duration_ms: row.duration_ms,
            durationMs: row.duration_ms,
            played_at: row.played_at,
            playedAt: row.played_at,
            source_event_id: row.source_event_id,
            sourceEventId: row.source_event_id,
        })),
    };
}

async function getHomepageRecommendations(firebaseUid, options = {}) {
    const limit = clampRecommendationLimit(options.limit);
    const kidId = options.kidId || options.kid_id;
    if (!kidId) throw new ApiError('kidId is required', 400, 400);
    const kidBigIntId = parseBigIntId(kidId, 'kidId');

    const user = await prisma.sys_user.findUnique({
        where: { firebase_uid: firebaseUid },
        select: { id: true },
    });
    if (!user) throw new ApiError('Access denied', 403, 403);

    const kid = await prisma.kid_profile.findFirst({
        where: {
            id: kidBigIntId,
            user_id: user.id,
        },
    });
    if (!kid) throw new ApiError('Access denied', 403, 403);

    logger.info('recommendations_requested', { userId: user.id?.toString(), kidId: kid.id?.toString(), limit });

    const devices = await prisma.ai_device.findMany({
        where: {
            user_id: user.id,
            OR: [
                { kid_id: kid.id },
                { kid_id: null },
            ],
        },
        select: { mac_address: true, agent_id: true, kid_id: true },
    });
    const macAddresses = (devices || []).map(device => device.mac_address).filter(Boolean);
    const agentIds = (devices || []).map(device => device.agent_id).filter(Boolean);
    const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const activityOwnership = [
        { kid_id: kid.id },
        { user_id: user.id },
    ];
    if (macAddresses.length > 0) {
        activityOwnership.push({ mac_address: { in: macAddresses } });
    }

    const [cardTaps, sessions, mediaPlayback, chatHistory, contentCandidates] = await Promise.all([
        prisma.rfid_card_tap_log.findMany({
            where: {
                OR: activityOwnership,
                created_at: { gte: since },
            },
            orderBy: { created_at: 'desc' },
            take: 20,
        }),
        macAddresses.length > 0
            ? prisma.analytics_game_sessions.findMany({
                where: {
                    mac_address: { in: macAddresses },
                    started_at: { gte: since },
                },
                orderBy: { started_at: 'desc' },
                take: 20,
            })
            : Promise.resolve([]),
        macAddresses.length > 0
            ? prisma.analytics_media_playback.findMany({
                where: {
                    mac_address: { in: macAddresses },
                    created_at: { gte: since },
                },
                orderBy: { created_at: 'desc' },
                take: 20,
            })
            : Promise.resolve([]),
        // Was ai_agent_chat_history, the legacy xiaozhi table, which has had no
        // new rows since 2026-06-06 — so this "has the child talked recently"
        // signal had been permanently off. voice_session_messages is where
        // transcripts actually live; role 'user' is the equivalent of chat_type 1.
        (macAddresses.length > 0 || agentIds.length > 0)
            ? prisma.voice_session_messages.findMany({
                where: {
                    role: 'user',
                    OR: [
                        ...(macAddresses.length > 0 ? [{ mac_address: { in: macAddresses } }] : []),
                        ...(agentIds.length > 0 ? [{ agent_id: { in: agentIds } }] : []),
                    ],
                    created_at: { gte: since },
                },
                orderBy: { created_at: 'desc' },
                take: 20,
            })
            : Promise.resolve([]),
        prisma.rfid_content_pack.findMany({
            where: { active: true },
            orderBy: { create_date: 'desc' },
            take: Math.max(limit * 8, 50),
        }),
    ]);

    const profile = buildRecentSignals({ kid, cardTaps, sessions, mediaPlayback });
    if ((chatHistory || []).length > 0) {
        profile.recentModes.add('conversation');
    }

    const hasRecentActivity = Boolean(
        (cardTaps || []).length ||
        (sessions || []).length ||
        (mediaPlayback || []).length ||
        (chatHistory || []).length
    );
    const hasProfilePreferences = hasSignals(
        profile.preferredCategories,
        profile.preferredContentTypes,
        profile.preferredAiModes
    );
    const recommendationSource = hasRecentActivity
        ? 'personalized'
        : (hasProfilePreferences ? 'profile' : 'default');

    const scoredContent = (contentCandidates || [])
        .filter(content => content && content.active !== false && content.status !== 'inactive')
        .map(content => {
            const scored = scoreContent(content, profile);
            return {
                ...formatRecommendationContent(content, scored.reason),
                _score: scored.score,
                _createdAt: (content.created_at || content.create_date) ? new Date(content.created_at || content.create_date).getTime() : 0,
                _recentlyConsumed: profile.recentContentIds.has(content.id?.toString()),
            };
        });

    const nonConsumedContent = scoredContent.filter(item => !item._recentlyConsumed);
    const contentPool = nonConsumedContent.length >= limit ? nonConsumedContent : scoredContent;
    const rankedPool = contentPool.sort(sortRecommendations);

    const ranked = dedupeRecommendations(rankedPool)
        .slice(0, limit)
        .map(({ _score, _createdAt, _recentlyConsumed, ...item }) => item);

    logger.info('recommendations_returned_count', {
        userId: user.id?.toString(),
        kidId: kid.id?.toString(),
        count: ranked.length,
        recommendation_source: ranked.length === 0 ? 'empty' : recommendationSource,
    });

    return {
        items: ranked,
        recommendationSource: ranked.length === 0 ? 'empty' : recommendationSource,
        source: ranked.length === 0 ? 'empty' : recommendationSource,
        generatedAt: new Date().toISOString(),
    };
}

// ─── Quiz / riddle analytics ────────────────────────────────────────────────

const QUIZ_POINTS_PER_CORRECT = 10;

// What clears is per bank (banks.js clearOnReveal), asked through
// clearedResultsFor rather than duplicated here. This file used to hold its own
// copy of the list, so flipping quiz.service.js alone would have left the parent
// dashboard reporting a question as done while the toy reopened it.

/**
 * The wire value for a stored verdict.
 *
 * `GET /toy/api/mobile/progress/quiz` is a published contract: the parent app
 * types `result` as "correct" | "wrong" | "revealed" and renders each one
 * differently. When the internal vocabulary becomes solo/helped/missed
 * (ADR-0009), those map back here and the app sees no change:
 *
 *   solo -> correct, helped -> correct, missed -> revealed
 *
 * Note this is the REVERSE of what the design document first proposed. The live
 * prompt only ever emits correct|revealed, `revealed` already means the answer
 * was told to the child after two failed tries, and Quizzy never emits `wrong`
 * at all — so `helped -> revealed` would have inverted the meaning of the tile
 * a parent already reads.
 *
 * Identity today, on purpose: the seam exists so the change lands in one place
 * rather than across every caller that touches a result string.
 */
const QUIZ_WIRE_RESULTS = { solo: 'correct', helped: 'correct', missed: 'revealed' };
const toWireResult = stored => QUIZ_WIRE_RESULTS[stored] || stored;

/**
 * solo | helped | practised for one answered question, or null when unknowable.
 *
 * Null is the common case for anything answered before the attempt log existed:
 * a stored `correct` conflates FIRST_TRY and WITH_HINT, so history genuinely
 * cannot say which. Guessing "solo" there would overstate a child's mastery to
 * their parent, so the field is absent instead.
 */
const quizMastery = (storedResult, attemptCount) => {
    if (toWireResult(storedResult) === 'revealed') return 'practised';
    if (!attemptCount) return null;
    return attemptCount > 1 ? 'helped' : 'solo';
};

/**
 * Answer rows store the MAC in whatever case the caller sent — the dev database
 * holds both 00:16:3E:AC:B5:38 and 00:16:3e:ac:b5:38 for one device, 10 rows
 * against 16. A case-sensitive `in` silently reports the smaller half, so match
 * insensitively per MAC the way quiz.service.js does.
 */
const quizMacFilter = macAddresses =>
    macAddresses.map(mac => ({ device_mac: { equals: mac, mode: 'insensitive' } }));

/**
 * Per-level quiz and riddle performance for the parent app.
 *
 * Counts ATTEMPTS, not distinct questions: a question answered wrong on Monday
 * and right on Wednesday appears twice, because the screen reports what the week
 * contained rather than what the child currently knows. Level progress still
 * comes from the cleared set, which dedupes — so `attempted` can exceed the
 * level's question count while `cleared` stays truthful.
 */
async function getQuizAnalytics(firebaseUid, options = {}) {
    const scope = await resolveProgressScope(firebaseUid, options);
    return buildQuizAnalyticsForScope(scope, options);
}

/**
 * The two characters a child plays, as the home-screen quiz card reads them.
 *
 * Display names are fixed here rather than read from ai_agent_template: the card
 * ships artwork keyed on these ids, so a rename in the template table must not
 * blank the avatar. Ids are lowercase because the app lowercases before matching.
 */
const QUIZ_CHARACTERS = [
    { bank: 'quiz', character_id: 'quizy', character_name: 'Quizy' },
    { bank: 'riddle', character_id: 'riddler', character_name: 'Riddler' },
];

/**
 * Today's per-character quiz standing for the parent app's home card.
 *
 * Distinct from getQuizAnalytics, which answers "what did this week contain"
 * over both banks. This one answers "where does each character stand right now"
 * — one row per character, the Current Level and how much of it is cleared.
 *
 * Level state is a position, not a range: it is the same at any hour of the day,
 * so `period` is accepted for the app's sake and only decides which date the
 * response is stamped with.
 *
 * Scoping is quiz.service's own — by child when the toy is paired, by MAC with
 * `kid_id IS NULL` when it is not — so a hand-me-down toy never shows the
 * previous child's level.
 */
async function getQuizCharacterProgress(firebaseUid, options = {}) {
    const scope = await resolveProgressScope(firebaseUid, options);
    // Required here rather than at the top of the file, as ./banks already is:
    // quiz.service reaches back into this module's neighbours at load time.
    const quizService = require('./quiz.service');

    // The app sends the home screen's active toy. Without one, the first device
    // this parent owns stands in, which is the only toy when they own one.
    const mac = scope.macAddresses[0] || null;
    const date = formatDateInTimezone(options.now || new Date(), scope.timezone);

    if (!mac) {
        return { date, characters: [], total_questions_answered: 0, total_questions: 0 };
    }

    const characters = [];
    for (const character of QUIZ_CHARACTERS) {
        let standing;
        try {
            standing = await quizService.progress(mac, character.bank);
        } catch (error) {
            // A bank whose tables are not deployed yet must read as "not started"
            // rather than take the whole card down.
            logger.warn(`[mobile] ${character.bank} progress unavailable: ${error.message}`);
            continue;
        }

        characters.push({
            character_id: character.character_id,
            character_name: character.character_name,
            // A finished band keeps showing the last level it cleared; dropping to
            // null would render the card as level 0.
            level: standing.current_level ?? standing.levels_completed,
            // Both are 0 for a finished band — there is no level left to fill a
            // bar with. `status` is what tells the card to say "Level complete".
            questions_answered: standing.level_cleared,
            total_questions: standing.level_total,
            status: quizCharacterStatus(standing),
        });
    }

    return {
        date,
        characters,
        total_questions_answered: characters.reduce((sum, c) => sum + c.questions_answered, 0),
        total_questions: characters.reduce((sum, c) => sum + c.total_questions, 0),
    };
}

/**
 * A non-null Current Level is by definition one with questions still open, so
 * "completed" can only come from the null case — and only when levels were
 * actually cleared, since an empty bank reads null too and is not an
 * achievement.
 */
function quizCharacterStatus(standing) {
    if (standing.current_level === null) {
        return standing.levels_completed > 0 ? 'completed' : 'not_started';
    }
    return standing.level_cleared > 0 ? 'in_progress' : 'not_started';
}

/**
 * Same analytics by MAC for the manager web admin views, so an operator sees
 * exactly what the parent sees. Deliberately the same builder — two
 * implementations of "attempts, not questions" would drift apart within a month.
 */
async function getQuizAnalyticsByMacAdmin(mac, options = {}) {
    const trimmed = String(mac || '').trim();
    if (!trimmed) {
        throw new ApiError('mac is required', 400, 400);
    }
    const scope = await resolveAdminProgressScopeByMac(trimmed);
    return buildQuizAnalyticsForScope(scope, options);
}

async function buildQuizAnalyticsForScope(scope, options = {}) {
    const period = String(options.period || 'week').trim().toLowerCase();
    if (!PROGRESS_PERIODS.includes(period)) {
        throw new ApiError('period must be one of: today, week, month', 400, 400);
    }

    const now = options.now || new Date();
    const range = buildProgressDateRange(period, scope.timezone, now);
    const inRange = new Set(range.dates);

    if (!scope.macAddresses.length) {
        return { period, start_date: range.startDate, end_date: range.endDate, banks: [] };
    }

    // The equal-length period immediately before this one, so the banner can say
    // "better than last week" from data rather than as decoration.
    const previousDates = range.dates.map(dateKey => shiftDateKey(dateKey, -range.dates.length));
    const inPrevious = new Set(previousDates);

    // Bucketing happens in the parent's timezone, so the window is widened a day
    // at each edge and filtered per row. Note the quiz day-gate itself uses
    // SERVER-local midnight (quiz.service.js), so a late-evening answer can sit
    // in a different day here than the gate counted it in.
    const fetchFrom = new Date(`${shiftDateKey(previousDates[0], -1)}T00:00:00Z`);
    const fetchTo = new Date(`${shiftDateKey(range.endDate, 1)}T00:00:00Z`);
    // Replay is judged against the window opening, not the widened fetch edge.
    const windowOpened = new Date(`${range.startDate}T00:00:00Z`);
    const totals = { correct: 0, attempted: 0, previousCorrect: 0, previousAttempted: 0 };

    const { resolveBank, clearedResultsFor } = require('./banks');
    const banks = [];

    for (const bankName of ['quiz', 'riddle']) {
        let tables;
        try {
            tables = resolveBank(bankName);
        } catch (err) {
            continue;
        }

        // Riddle tables do not exist on every deployment yet; an absent table
        // must read as "nothing played", not a 500 for the whole screen.
        let rows;
        try {
            rows = await tables.answers.findMany({
                where: {
                    OR: quizMacFilter(scope.macAddresses),
                    answered_at: { gte: fetchFrom, lt: fetchTo },
                },
                select: { question_id: true, result: true, answered_at: true },
                orderBy: { answered_at: 'asc' },
            });
        } catch (err) {
            logger.warn(`[mobile] ${bankName} analytics unavailable: ${err.message}`);
            banks.push(emptyQuizBank(bankName, false));
            continue;
        }

        const scoped = [];
        for (const row of rows) {
            const dateKey = formatDateInTimezone(row.answered_at, scope.timezone);
            if (inRange.has(dateKey)) {
                scoped.push(row);
            } else if (inPrevious.has(dateKey)) {
                totals.previousAttempted += 1;
                if (row.result === 'correct') totals.previousCorrect += 1;
            }
        }
        if (!scoped.length) {
            banks.push(emptyQuizBank(bankName, true));
            continue;
        }

        const questions = await tables.questions.findMany({
            where: { id: { in: [...new Set(scoped.map(r => r.question_id))] } },
            select: { id: true, level: true, question_text: true, answer_text: true, language: true },
        });
        const questionById = new Map(questions.map(q => [String(q.id), q]));

        // Cleared before the window opened tells a replay pass from a first
        // pass: a level whose questions were all already cleared is practice.
        const clearedBefore = new Set(
            (await tables.answers.findMany({
                where: {
                    OR: quizMacFilter(scope.macAddresses),
                    result: { in: clearedResultsFor(tables) },
                    answered_at: { lt: windowOpened },
                },
                select: { question_id: true },
            })).map(r => String(r.question_id))
        );

        // One shared bank since ticket 013, so the active set is scoped by
        // language alone.
        const langs = [...new Set(questions.map(q => q.language))];
        const activeBank = await tables.questions.findMany({
            where: { active: true, language: { in: langs } },
            select: { id: true, level: true },
        });
        const clearedIds = await loadQuizClearedIds(tables, scope.macAddresses, activeBank);

        // Tries recorded against each question (ticket 004). Absent for anything
        // answered before that log existed, which is why the fields below are
        // omitted rather than defaulted when there is no row.
        const attemptCounts = new Map();
        try {
            const grouped = await prisma.question_attempt.groupBy({
                by: ['question_id'],
                where: { bank: bankName, OR: quizMacFilter(scope.macAddresses) },
                _count: { _all: true },
            });
            grouped.forEach(g => attemptCounts.set(String(g.question_id), g._count._all));
        } catch (error) {
            // Diagnostic enrichment only: a parent's progress screen must still
            // render if the attempt log is unavailable.
            logger.warn(`[QUIZ] attempt counts unavailable for ${bankName}: ${error.message}`);
        }

        const byLevel = new Map();
        for (const row of scoped) {
            const question = questionById.get(String(row.question_id));
            if (!question) continue;
            if (!byLevel.has(question.level)) {
                byLevel.set(question.level, { correct: 0, wrong: 0, revealed: 0, questions: [], replay: true });
            }
            const bucket = byLevel.get(question.level);
            // Bucketed by the WIRE value so the three tiles keep their meaning
            // once the stored vocabulary changes underneath them.
            const wire = toWireResult(row.result);
            if (wire === 'correct') bucket.correct += 1;
            else if (wire === 'revealed') bucket.revealed += 1;
            else bucket.wrong += 1;
            if (!clearedBefore.has(String(row.question_id))) bucket.replay = false;
            // Additive only. `result` and `points` keep the meaning the app was
            // written against; anything new is a separate field the app may
            // ignore entirely.
            const attemptCount = attemptCounts.get(String(row.question_id)) || 0;
            const mastery = quizMastery(row.result, attemptCount);
            bucket.questions.push({
                question_text: question.question_text,
                correct_answer: question.answer_text,
                result: toWireResult(row.result),
                // `helped` maps to correct and so keeps full points. Docking it
                // would drop a child's score overnight for no visible reason —
                // the exact surprise this ticket exists to prevent.
                points: wire === 'correct' ? QUIZ_POINTS_PER_CORRECT : 0,
                answered_on: formatDateInTimezone(row.answered_at, scope.timezone),
                // Omitted rather than sent as 0/null: absent means "not recorded",
                // which is different from "answered first time".
                ...(attemptCount ? { attempts_within_question: attemptCount } : {}),
                ...(mastery ? { mastery } : {}),
            });
        }

        const levels = [...byLevel.entries()]
            .sort((a, b) => a[0] - b[0])
            .map(([level, bucket]) => {
                const attempted = bucket.correct + bucket.wrong + bucket.revealed;
                const levelQuestions = activeBank.filter(q => q.level === level);
                return {
                    level,
                    attempted,
                    correct: bucket.correct,
                    wrong: bucket.wrong,
                    revealed: bucket.revealed,
                    accuracy: attempted ? Math.round((bucket.correct / attempted) * 100) : 0,
                    points: bucket.correct * QUIZ_POINTS_PER_CORRECT,
                    replay: bucket.replay,
                    cleared: levelQuestions.length > 0
                        && levelQuestions.every(q => clearedIds.has(String(q.id))),
                    questions: bucket.questions,
                };
            });

        const bankAttempted = levels.reduce((sum, l) => sum + l.attempted, 0);
        const bankCorrect = levels.reduce((sum, l) => sum + l.correct, 0);
        totals.attempted += bankAttempted;
        totals.correct += bankCorrect;

        banks.push({
            bank: bankName,
            available: true,
            current_level: deriveCurrentLevel(activeBank, clearedIds),
            attempted: bankAttempted,
            correct: bankCorrect,
            points: levels.reduce((sum, l) => sum + l.points, 0),
            levels,
        });
    }

    return {
        period,
        start_date: range.startDate,
        end_date: range.endDate,
        banks,
        trend: buildQuizTrend(totals),
    };
}

/**
 * Accuracy this period against the one before it, across both banks.
 *
 * `direction: 'new'` means there is nothing to compare against — no attempts in
 * the previous period — so the app must not render "improving" over an absent
 * baseline. Direction is decided on a 5-point band because week-to-week accuracy
 * on ten questions swings by a whole question at a time; a 1-point move is noise,
 * not progress worth telling a parent about.
 */
function buildQuizTrend(totals) {
    if (!totals.attempted) {
        return { direction: 'none', accuracy: null, previous_accuracy: null, delta: null };
    }
    const accuracy = Math.round((totals.correct / totals.attempted) * 100);
    if (!totals.previousAttempted) {
        return { direction: 'new', accuracy, previous_accuracy: null, delta: null };
    }
    const previousAccuracy = Math.round((totals.previousCorrect / totals.previousAttempted) * 100);
    const delta = accuracy - previousAccuracy;
    let direction = 'flat';
    if (delta >= 5) direction = 'up';
    else if (delta <= -5) direction = 'down';
    return { direction, accuracy, previous_accuracy: previousAccuracy, delta };
}

/**
 * Every bank entry carries the same keys, whether or not anything was played.
 * A client that has to distinguish "absent key" from "zero" ends up encoding the
 * difference between an empty period and an unavailable bank as a typeof check.
 * `available: false` is the only signal for that; the numbers stay zero.
 */
function emptyQuizBank(bankName, available) {
    return {
        bank: bankName,
        available,
        current_level: null,
        attempted: 0,
        correct: 0,
        points: 0,
        levels: [],
    };
}

/** Cleared ids across every device in scope, chunked to keep the IN list sane. */
async function loadQuizClearedIds(tables, macAddresses, activeBank) {
    // Required here rather than at module scope, matching how the caller above
    // pulls in resolveBank.
    const { clearedResultsFor } = require('./banks');
    if (!activeBank.length) return new Set();
    const rows = await tables.answers.findMany({
        where: {
            OR: quizMacFilter(macAddresses),
            question_id: { in: activeBank.map(q => q.id) },
            result: { in: clearedResultsFor(tables) },
        },
        select: { question_id: true },
    });
    return new Set(rows.map(r => String(r.question_id)));
}

/** Mirrors quiz.logic.deriveLevelState: lowest level with an uncleared question. */
function deriveCurrentLevel(activeBank, clearedIds) {
    const levels = [...new Set(activeBank.map(q => q.level))].sort((a, b) => a - b);
    for (const level of levels) {
        if (activeBank.some(q => q.level === level && !clearedIds.has(String(q.id)))) return level;
    }
    return null;
}

// ─── Chat history, by child ─────────────────────────────────────────────────

const isoOrNull = (value) => (value ? new Date(value).toISOString() : null);

/**
 * The characters in this child's history, each with every agent row that carries
 * it.
 *
 * An account can hold several rows for one character — the app created one per
 * toy activation and the server normalised their names together, so Kishore's
 * Cheeko is spread over three rows holding 71, 1 and 1 sessions. Reading them as
 * three characters shows the same face three times, each with part of the story.
 *
 * Keyed on the normalised name, case-folded: the same character is spelled
 * "NANI", "Nani" and "cheeko 2" across live rows.
 */
async function kidCharacterIndex(kidId) {
    const groups = await prisma.voice_sessions.groupBy({
        by: ['agent_id'],
        where: { kid_id: kidId, agent_id: { not: null } },
        _count: { _all: true },
        _max: { started_at: true },
    });
    if (groups.length === 0) return [];

    const agents = await prisma.ai_agent.findMany({
        where: { id: { in: groups.map(group => group.agent_id) } },
        select: { id: true, agent_name: true },
    });
    const nameById = new Map(agents.map(agent => [agent.id, agent.agent_name]));

    const byCharacter = new Map();
    for (const group of groups) {
        const rawName = nameById.get(group.agent_id) || null;
        // An agent row that has vanished cannot be merged with anything, so it
        // keys on its own id rather than joining every other nameless row.
        const key = rawName ? normalizeCharacterName(rawName).toLowerCase() : `id:${group.agent_id}`;
        const lastSessionAt = group._max.started_at ? new Date(group._max.started_at) : null;

        const entry = byCharacter.get(key);
        if (!entry) {
            byCharacter.set(key, {
                agentId: group.agent_id,
                agentName: rawName,
                agentIds: [group.agent_id],
                sessionCount: group._count._all,
                lastSessionAt,
            });
            continue;
        }
        entry.agentIds.push(group.agent_id);
        entry.sessionCount += group._count._all;
        if (lastSessionAt && (!entry.lastSessionAt || lastSessionAt > entry.lastSessionAt)) {
            // Represent the character by its most recently used row, so the id the
            // app calls back with is the one still in service.
            entry.lastSessionAt = lastSessionAt;
            entry.agentId = group.agent_id;
            entry.agentName = rawName;
        }
    }
    return [...byCharacter.values()];
}

/**
 * Every agent row that is the same character as the one asked for, for this
 * child. One id in, all its duplicates out, so a session list is whole no matter
 * which row the caller happens to name.
 */
async function siblingAgentIds(kidId, agentId) {
    const index = await kidCharacterIndex(kidId);
    const entry = index.find(character => character.agentIds.includes(agentId));
    return entry ? entry.agentIds : [agentId];
}

/**
 * Which characters has this child talked to?
 *
 * Grouped on voice_sessions, so the answer follows the child to a new toy: the
 * MAC is a column on those rows, never the key they are read by.
 */
async function getKidCharacters(firebaseUid, kidId, options = {}) {
    const scope = await resolveProgressScope(firebaseUid, { ...options, kidId });
    const characters = await kidCharacterIndex(scope.kidIds[0]);

    return characters
        .sort((a, b) => (b.lastSessionAt?.getTime() || 0) - (a.lastSessionAt?.getTime() || 0))
        .map(character => ({
            agentId: character.agentId,
            agentName: character.agentName,
            sessionCount: character.sessionCount,
            lastSessionAt: isoOrNull(character.lastSessionAt),
        }));
}

/**
 * One child's sessions with one character.
 *
 * Both halves are required: ai_agent is per account, so two siblings share one
 * Quizzy row and the character on its own never tells them apart.
 */
/**
 * The day window a session list was asked for, in the parent's zone.
 *
 * `date` for a single day, or `from`/`to` for a span; either bound may stand
 * alone. Absent altogether means every session, which is what every caller
 * before this asked for.
 */
function parseSessionDateWindow(options, timezone) {
    const dateKey = value => {
        if (value == null || value === '') return null;
        const text = String(value).slice(0, 10);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) {
            throw new ApiError('date, from and to must be YYYY-MM-DD', 400, 400);
        }
        return text;
    };

    const single = dateKey(options.date);
    const startDate = single || dateKey(options.from);
    const endDate = single || dateKey(options.to);
    if (!startDate && !endDate) return null;
    if (startDate && endDate && endDate < startDate) {
        throw new ApiError('to must not be earlier than from', 400, 400);
    }

    // Half-open on purpose: the last local instant of a day is not a round
    // number in any zone, and `lt` next-midnight never drops or double-counts.
    const filter = {};
    if (startDate) filter.gte = startOfDayInstant(startDate, timezone);
    if (endDate) filter.lt = endOfDayInstantExclusive(endDate, timezone);
    return { startDate, endDate, filter };
}

async function getKidCharacterSessions(firebaseUid, kidId, agentId, options = {}) {
    const scope = await resolveProgressScope(firebaseUid, { ...options, kidId });
    const page = parseInt(options.page) || 1;
    const limit = Math.min(parseInt(options.limit) || 20, 100);
    const window = parseSessionDateWindow(options, scope.timezone);
    // Duplicate rows for one character are read as one character, so the list is
    // whole whichever of them the app names.
    const where = {
        kid_id: scope.kidIds[0],
        agent_id: { in: await siblingAgentIds(scope.kidIds[0], agentId) },
        ...(window ? { started_at: window.filter } : {}),
    };

    const [total, rows] = await Promise.all([
        prisma.voice_sessions.count({ where }),
        prisma.voice_sessions.findMany({
            where,
            select: {
                session_id: true,
                started_at: true,
                ended_at: true,
                _count: { select: { voice_session_messages: true } },
                voice_session_summaries: { select: { summary: true } },
            },
            orderBy: { started_at: 'desc' },
            skip: (page - 1) * limit,
            take: limit,
        }),
    ]);

    return {
        total,
        timezone: scope.timezone,
        start_date: window?.startDate || null,
        startDate: window?.startDate || null,
        end_date: window?.endDate || null,
        endDate: window?.endDate || null,
        list: rows.map(row => ({
            sessionId: row.session_id,
            startedAt: isoOrNull(row.started_at),
            endedAt: isoOrNull(row.ended_at),
            messageCount: row._count?.voice_session_messages || 0,
            summary: row.voice_session_summaries?.summary || null,
        })),
    };
}

/**
 * One session's transcript.
 *
 * The child is matched on the session, not on the message: a message has no
 * child column of its own and must not gain one — it reaches the child through
 * the session it belongs to. Another child's session therefore reads as empty.
 */
async function getKidSessionMessages(firebaseUid, kidId, sessionId, options = {}) {
    const scope = await resolveProgressScope(firebaseUid, { ...options, kidId });
    const limit = Math.min(parseInt(options.limit) || 100, 500);
    const cursor = parseInt(options.cursor) || 0;

    const rows = await prisma.voice_session_messages.findMany({
        where: {
            session_id: sessionId,
            sequence: { gt: cursor },
            voice_sessions: { kid_id: scope.kidIds[0] },
        },
        select: { sequence: true, role: true, content: true, created_at: true },
        orderBy: { sequence: 'asc' },
        take: limit + 1,
    });

    const hasMore = rows.length > limit;
    const messages = hasMore ? rows.slice(0, limit) : rows;

    return {
        sessionId,
        hasMore,
        nextCursor: hasMore ? messages[messages.length - 1].sequence : null,
        messages: messages.map(row => ({
            sequence: row.sequence,
            role: row.role,
            content: row.content || '',
            createdAt: isoOrNull(row.created_at),
        })),
    };
}

module.exports = {
    // Exported for the contract test: these two are the whole seam between the
    // internal verdict vocabulary and the published one.
    toWireResult,
    quizMastery,
    getParentProfile,
    createParentProfile,
    updateParentProfile,
    updateFcmToken,
    clearFcmToken,
    getUserState,
    markOnboardingCompleted,
    getKids,
    createKid,
    updateKid,
    deleteKid,
    checkEmailExists,
    deleteUserAccount,
    getHomepageActivity,
    getHomepageActivityDetails,
    getProgressSummary,
    getProgressDetails,
    getProgressTrend,
    getQuizAnalytics,
    getQuizCharacterProgress,
    getQuizAnalyticsByMacAdmin,
    getProgressSummaryByMacAdmin,
    getProgressDetailsByMacAdmin,
    getProgressTrendByMacAdmin,
    getDeviceGamesPlayed,
    getDeviceRadioPlayed,
    getHomepageRecommendations,
    getKidCharacters,
    getKidCharacterSessions,
    getKidSessionMessages,
};
