'use strict';

const { prisma } = require('../config/database');
const { normalizeMacAddress } = require('../utils/helpers');
const systemService = require('./system.service');

const IST_TIMEZONE = 'Asia/Kolkata';
const IST_OFFSET = '+05:30';

/**
 * Token pricing. Defaults mirror the documented Gemini 2.5 Flash Native Audio
 * rates (USD/1M x INR FX) that were previously hard-coded here; every value can
 * be overridden through sys_params so finance can retune without a deploy.
 *
 * NOTE: `inputCached` defaults to 0 because no verified cached-token rate has
 * been supplied for this model. While it is 0, cost figures understate spend by
 * whatever cached input is consumed. Set `gemini_price_input_cached_inr_per_million`
 * once the real rate is known rather than guessing one here.
 */
const DEFAULT_RATES_INR_PER_MILLION = {
  inputText: 46,
  inputAudio: 276,
  inputCached: 0,
  outputText: 184,
  outputAudio: 1104,
};

const RATE_PARAM_CODES = {
  inputText: 'gemini_price_input_text_inr_per_million',
  inputAudio: 'gemini_price_input_audio_inr_per_million',
  inputCached: 'gemini_price_input_cached_inr_per_million',
  outputText: 'gemini_price_output_text_inr_per_million',
  outputAudio: 'gemini_price_output_audio_inr_per_million',
};

const BUDGET_PARAM_CODE = 'founder_monthly_budget_inr';

/**
 * Monthly question allowance. `user_question_quota` stores only what has been
 * used, so the denominator for "412 / 500 questions" has to come from config.
 * Unset means we render the used count alone rather than inventing a ceiling.
 */
const QUESTION_ALLOWANCE_PARAM_CODE = 'monthly_question_allowance';

async function loadQuestionAllowance() {
  const raw = await systemService.getParamValue(QUESTION_ALLOWANCE_PARAM_CODE, null);
  if (raw === null || raw === undefined || raw === '') return null;
  const numeric = Number(raw);
  return Number.isFinite(numeric) && numeric > 0 ? numeric : null;
}

async function loadCostRates() {
  const entries = await Promise.all(
    Object.entries(RATE_PARAM_CODES).map(async ([key, code]) => {
      const value = await systemService.getParamValue(code, DEFAULT_RATES_INR_PER_MILLION[key]);
      const numeric = Number(value);
      return [key, (Number.isFinite(numeric) ? numeric : DEFAULT_RATES_INR_PER_MILLION[key]) / 1000000];
    }),
  );
  return Object.fromEntries(entries);
}

async function loadMonthlyBudget() {
  const raw = await systemService.getParamValue(BUDGET_PARAM_CODE, null);
  if (raw === null || raw === undefined || raw === '') return null;
  const numeric = Number(raw);
  return Number.isFinite(numeric) ? numeric : null;
}

/* ------------------------------------------------------------------ *
 * Date helpers — every calendar bucket is an IST day.
 * ------------------------------------------------------------------ */

const IST_DAY_FORMATTER = new Intl.DateTimeFormat('en-CA', {
  timeZone: IST_TIMEZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

// hourCycle h23 is required: `hour12:false` on en-US yields "24" for midnight,
// which previously produced an out-of-range bucket index and threw.
const IST_HOUR_FORMATTER = new Intl.DateTimeFormat('en-US', {
  timeZone: IST_TIMEZONE,
  hour: 'numeric',
  hourCycle: 'h23',
});

const IST_WEEKDAY_FORMATTER = new Intl.DateTimeFormat('en-US', {
  timeZone: IST_TIMEZONE,
  weekday: 'short',
});

function toIsoDate(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return IST_DAY_FORMATTER.format(date);
}

function istHour(value) {
  const hour = Number(IST_HOUR_FORMATTER.format(value instanceof Date ? value : new Date(value)));
  return Number.isFinite(hour) ? hour % 24 : 0;
}

function istWeekday(value) {
  return IST_WEEKDAY_FORMATTER.format(value instanceof Date ? value : new Date(value));
}

function todayIstKey() {
  return IST_DAY_FORMATTER.format(new Date());
}

function shiftDayKey(dayKey, deltaDays) {
  const shifted = new Date(`${dayKey}T00:00:00Z`);
  shifted.setUTCDate(shifted.getUTCDate() + deltaDays);
  return shifted.toISOString().slice(0, 10);
}

function buildDayKeyList(firstKey, lastKey) {
  const keys = [];
  let cursor = firstKey;
  let guard = 0;
  while (cursor <= lastKey && guard < 400) {
    keys.push(cursor);
    cursor = shiftDayKey(cursor, 1);
    guard += 1;
  }
  return keys;
}

/**
 * Query bounds for an inclusive IST day span.
 *  - `dateOnly` bounds target @db.Date columns (stored at UTC midnight).
 *  - `ts` bounds target @db.Timestamptz columns and carry the IST offset, so a
 *    23:30 IST event lands on the right day instead of bleeding into the next.
 */
function boundsFromKeys(startKey, endKey) {
  const dayKeys = buildDayKeyList(startKey, endKey);
  return {
    startKey,
    endKey,
    dayKeys,
    days: dayKeys.length,
    dateOnlyStart: new Date(`${startKey}T00:00:00Z`),
    dateOnlyEnd: new Date(`${endKey}T00:00:00Z`),
    tsStart: new Date(`${startKey}T00:00:00.000${IST_OFFSET}`),
    tsEnd: new Date(`${endKey}T23:59:59.999${IST_OFFSET}`),
  };
}

/**
 * Ranges are resolved on the IST calendar.
 */
function buildDateRange(range) {
  const endKey = todayIstKey();
  let startKey;
  let daysInMonth = null;

  if (range === 'month') {
    startKey = `${endKey.slice(0, 7)}-01`;
    const [year, month] = endKey.split('-').map(Number);
    daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  } else {
    const span = range === 'today' ? 1 : range === '90d' ? 90 : range === '30d' ? 30 : 7;
    startKey = shiftDayKey(endKey, -(span - 1));
  }

  return { ...boundsFromKeys(startKey, endKey), daysInMonth };
}

function round(value, digits = 2) {
  const factor = 10 ** digits;
  return Math.round((Number(value) || 0) * factor) / factor;
}

/** The equal-length window immediately preceding `win`. */
function previousWindowOf(win) {
  const prevEnd = shiftDayKey(win.startKey, -1);
  const prevStart = shiftDayKey(prevEnd, -(win.days - 1));
  return boundsFromKeys(prevStart, prevEnd);
}

/**
 * Percentage change, or null when there is no baseline to compare against.
 * Never returns Infinity — "up from zero" is not a percentage.
 */
function pctChange(current, previous) {
  const now = Number(current) || 0;
  const before = Number(previous) || 0;
  if (before <= 0) return null;
  return round(((now - before) / before) * 100, 0);
}

function clampPercent(value) {
  if (value === null || value === undefined || !Number.isFinite(value)) return null;
  return Math.max(0, Math.min(100, value));
}

/* ------------------------------------------------------------------ *
 * Cost helpers — accumulate raw, round once at the response boundary.
 * Rounding per row previously collapsed sub-paisa sessions to zero.
 * ------------------------------------------------------------------ */

function rawInputCost(record, rates) {
  return (
    Number(record.input_text_tokens || 0) * rates.inputText +
    Number(record.input_audio_tokens || 0) * rates.inputAudio +
    Number(record.input_cached_tokens || 0) * rates.inputCached
  );
}

function rawOutputCost(record, rates) {
  return (
    Number(record.output_text_tokens || 0) * rates.outputText +
    Number(record.output_audio_tokens || 0) * rates.outputAudio
  );
}

function rawTotalCost(record, rates) {
  return rawInputCost(record, rates) + rawOutputCost(record, rates);
}

/* ------------------------------------------------------------------ *
 * Topic extraction (keyword frequency — labelled as such in the UI).
 * ------------------------------------------------------------------ */

const TOPIC_STOP_WORDS = new Set([
  'about', 'asked', 'before', 'talked', 'their', 'there', 'would', 'could', 'while', 'morning',
  'night', 'bedtime', 'today', 'with', 'from', 'into', 'that', 'have', 'were', 'this', 'they',
  'cheeko', 'child', 'user', 'assistant', 'conversation', 'session', 'summary', 'kid', 'said',
  'then', 'when', 'what', 'which', 'them', 'also', 'like', 'wanted', 'after', 'being',
]);

function tallyTopics(summaries) {
  const counts = new Map();
  summaries.forEach((entry) => {
    String(entry.summary || '')
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter((word) => word.length > 3 && !TOPIC_STOP_WORDS.has(word))
      .forEach((word) => counts.set(word, (counts.get(word) || 0) + 1));
  });
  return counts;
}

function topTopics(summaries, limit = 6) {
  return Array.from(tallyTopics(summaries).entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([topic, mentions]) => ({ topic, mentions }));
}

/* ------------------------------------------------------------------ *
 * Aggregation helpers — all series are gap-filled across dayKeys so a
 * chart's x-axis reflects real elapsed time.
 * ------------------------------------------------------------------ */

function aggregateUsageByDate(usageRows, dayKeys) {
  const byDate = new Map();
  usageRows.forEach((row) => {
    const date = toIsoDate(row.date);
    if (!date) return;
    if (!byDate.has(date)) {
      byDate.set(date, {
        usageSeconds: 0,
        aiTalkSeconds: 0,
        cardSeconds: 0,
        gameSeconds: 0,
        radioSeconds: 0,
        macs: new Set(),
      });
    }
    const target = byDate.get(date);
    target.usageSeconds += Number(row.usage_time_seconds || 0);
    target.aiTalkSeconds += Number(row.ai_talk_usage_seconds || 0);
    target.cardSeconds += Number(row.card_usage_seconds || 0);
    target.gameSeconds += Number(row.game_usage_seconds || 0);
    target.radioSeconds += Number(row.radio_usage_seconds || 0);
    if (row.mac_address) target.macs.add(row.mac_address);
  });

  return dayKeys.map((date) => {
    const entry = byDate.get(date);
    return {
      date,
      usageSeconds: entry?.usageSeconds || 0,
      aiTalkSeconds: entry?.aiTalkSeconds || 0,
      cardSeconds: entry?.cardSeconds || 0,
      gameSeconds: entry?.gameSeconds || 0,
      radioSeconds: entry?.radioSeconds || 0,
      activeDevices: entry?.macs.size || 0,
    };
  });
}

function aggregateSessionsByDate(sessionRows, dayKeys) {
  const byDate = new Map();
  sessionRows.forEach((row) => {
    const date = toIsoDate(row.started_at);
    if (!date) return;
    if (!byDate.has(date)) byDate.set(date, { total: 0, durationSeconds: 0 });
    const target = byDate.get(date);
    target.total += 1;
    target.durationSeconds += Number(row.duration_seconds || 0);
  });
  return dayKeys.map((date) => ({
    date,
    total: byDate.get(date)?.total || 0,
    durationSeconds: byDate.get(date)?.durationSeconds || 0,
  }));
}

function aggregateRegistrationsByDate(userRows, dayKeys) {
  const byDate = new Map();
  userRows.forEach((row) => {
    const date = toIsoDate(row.created_at);
    if (!date) return;
    byDate.set(date, (byDate.get(date) || 0) + 1);
  });
  return dayKeys.map((date) => ({ date, count: byDate.get(date) || 0 }));
}

function aggregateCostByDate(costRows, dayKeys, rates) {
  const byDate = new Map();
  costRows.forEach((row) => {
    const date = toIsoDate(row.usage_date);
    if (!date) return;
    const current = byDate.get(date) || { input: 0, output: 0 };
    current.input += rawInputCost(row, rates);
    current.output += rawOutputCost(row, rates);
    byDate.set(date, current);
  });
  return dayKeys.map((date) => {
    const entry = byDate.get(date) || { input: 0, output: 0 };
    return {
      date,
      inputCost: round(entry.input, 2),
      outputCost: round(entry.output, 2),
      cost: round(entry.input + entry.output, 2),
    };
  });
}

/**
 * 7-day moving average. Returns null until a full window exists so the chart
 * never draws a partial average as if it were a 7-day one.
 */
function movingAverage(values, windowSize = 7) {
  return values.map((_, index) => {
    if (index < windowSize - 1) return null;
    const slice = values.slice(index - windowSize + 1, index + 1);
    return round(slice.reduce((sum, item) => sum + item, 0) / windowSize, 1);
  });
}

/** Canonical game key so `device_games_played.game_name` ("Word Ladder") and
 *  `analytics_game_sessions.mode_type` ("word_ladder") collapse to one row. */
function gameKey(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '')
    .trim();
}

function prettyGameName(value) {
  const text = String(value || '').trim();
  if (!text) return 'Unknown game';
  if (text.includes(' ')) return text;
  return text
    .replace(/[_-]+/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

/** Card-pack leaderboard. Unmapped taps are reported separately as
 *  `unresolvedTapCount`, never as a synthetic "Unresolved" pack that would
 *  outrank real content. */
function summarizeCardLeaderboard(rows, limit = 5) {
  const packs = new Map();
  rows.forEach((row) => {
    if (!row.content_pack_name) return;
    const name = row.content_pack_name;
    if (!packs.has(name)) packs.set(name, { name, taps: 0, devices: new Set(), cards: new Set() });
    const target = packs.get(name);
    target.taps += 1;
    if (row.mac_address) target.devices.add(row.mac_address);
    if (row.rfid_uid) target.cards.add(row.rfid_uid);
  });

  return Array.from(packs.values())
    .map((entry) => ({
      name: entry.name,
      taps: entry.taps,
      uniqueDevices: entry.devices.size,
      uniqueCards: entry.cards.size,
    }))
    .sort((a, b) => b.taps - a.taps)
    .slice(0, limit);
}

function summarizeGames(rows, limit = 5) {
  const games = new Map();
  rows.forEach((row) => {
    const label = row.game_name || row.game_id;
    const key = gameKey(label);
    if (!key) return;
    if (!games.has(key)) {
      games.set(key, { name: prettyGameName(label), plays: 0, totalScore: 0, scoredPlays: 0, totalDurationMs: 0 });
    }
    const target = games.get(key);
    target.plays += 1;
    if (row.score !== null && row.score !== undefined) {
      target.totalScore += Number(row.score);
      target.scoredPlays += 1;
    }
    target.totalDurationMs += Number(row.duration_ms || 0);
  });

  return Array.from(games.values())
    .map((entry) => ({
      name: entry.name,
      plays: entry.plays,
      avgScore: entry.scoredPlays ? round(entry.totalScore / entry.scoredPlays, 1) : null,
      avgDurationMinutes: round(entry.totalDurationMs / 60000 / Math.max(entry.plays, 1), 1),
    }))
    .sort((a, b) => b.plays - a.plays)
    .slice(0, limit);
}

function summarizeHourlySessions(sessionRows) {
  const buckets = Array.from({ length: 24 }, (_, hour) => ({ hour, sessions: 0 }));
  sessionRows.forEach((row) => {
    buckets[istHour(row.started_at)].sessions += 1;
  });
  return buckets;
}

function summarizeSessionsHeatmap(sessionRows) {
  const dayLabels = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  const dayBuckets = dayLabels.map((day) => ({
    day,
    hours: Array.from({ length: 24 }, (_, hour) => ({ hour, sessions: 0 })),
  }));

  sessionRows.forEach((row) => {
    const bucket = dayBuckets.find((item) => item.day === istWeekday(row.started_at));
    if (bucket) bucket.hours[istHour(row.started_at)].sessions += 1;
  });

  return dayBuckets;
}

function summarizeRecentConversation(summary) {
  const text = String(summary || '').trim();
  if (!text) return { headline: 'Conversation summary unavailable', tags: [] };
  const headline = text.length > 88 ? `${text.slice(0, 85).trim()}...` : text;
  const tags = topTopics([{ summary: text }], 3).map((item) => item.topic);
  return { headline, tags };
}

function getStatusFromCompletionRate(rate) {
  if (rate === null || rate === undefined) return 'No completion data';
  if (rate >= 85) return 'Loved';
  if (rate >= 70) return 'Healthy';
  if (rate >= 55) return 'Watch';
  return 'Needs attention';
}

/** Resolve kid display names for a set of devices without an ORM relation. */
async function buildKidNameByMac(devices) {
  const kidIds = Array.from(
    new Set(devices.map((device) => device.kid_id).filter((id) => id !== null && id !== undefined)),
  );
  if (!kidIds.length) return new Map();

  const kids = await prisma.kid_profile.findMany({
    where: { id: { in: kidIds } },
    select: { id: true, name: true, nickname: true },
  });
  // Prefer the canonical name so a device row matches the profile header.
  const nameById = new Map(kids.map((kid) => [String(kid.id), kid.name || kid.nickname]));

  const byMac = new Map();
  devices.forEach((device) => {
    if (device.kid_id === null || device.kid_id === undefined) return;
    const name = nameById.get(String(device.kid_id));
    if (name) byMac.set(device.mac_address, name);
  });
  return byMac;
}

function summarizeFleetEvents(syncEvents, analyticsEvents) {
  return [
    ...syncEvents.map((event) => ({
      source: 'sync',
      macAddress: event.mac_address,
      title: event.event_type,
      detail: event.status || event.reason || 'sync event',
      severity: event.status === 'failed' ? 'critical' : 'info',
      createdAt: event.created_at,
    })),
    ...analyticsEvents.map((event) => ({
      source: 'device',
      macAddress: event.mac_address,
      title: event.event_name,
      detail: event.reason || event.firmware || 'device event',
      severity: /fail|error|shutdown/i.test(event.event_name || event.reason || '') ? 'critical' : 'info',
      createdAt: event.server_received_at || event.event_timestamp,
    })),
  ]
    .sort((a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime())
    .slice(0, 8);
}

function summarizeWatchlist(devices, runtimeStates, syncEvents, analyticsEvents, kidNameByMac) {
  const issues = [];
  const latestSyncFailureByMac = new Map();

  syncEvents.forEach((event) => {
    if ((event.status && /fail/i.test(event.status)) || (event.reason && /fail|timeout/i.test(event.reason))) {
      if (!latestSyncFailureByMac.has(event.mac_address)) latestSyncFailureByMac.set(event.mac_address, event);
    }
  });

  const lowBatteryHitsByMac = new Map();
  analyticsEvents.forEach((event) => {
    const level = event.battery_percentage ?? event.battery;
    if (level !== null && level !== undefined && Number(level) < 20) {
      lowBatteryHitsByMac.set(event.mac_address, (lowBatteryHitsByMac.get(event.mac_address) || 0) + 1);
    }
  });

  devices.forEach((device) => {
    const runtime = runtimeStates.get(device.mac_address);
    const failure = latestSyncFailureByMac.get(device.mac_address);
    const lowBatteryHits = lowBatteryHitsByMac.get(device.mac_address) || 0;
    const base = {
      macAddress: device.mac_address,
      alias: device.alias || device.mac_address,
      kidName: kidNameByMac.get(device.mac_address) || null,
    };

    if (runtime && runtime.battery !== null && runtime.battery !== undefined && runtime.battery < 20) {
      issues.push({
        ...base,
        issue: `battery ${runtime.battery}%`,
        severity: 'critical',
        since: runtime.last_seen_at || device.last_connected_at || null,
      });
    }

    if (lowBatteryHits >= 2) {
      issues.push({
        ...base,
        issue: `${lowBatteryHits} low-battery events`,
        severity: 'warning',
        since: runtime?.last_seen_at || device.last_connected_at || null,
      });
    }

    if (failure) {
      issues.push({
        ...base,
        issue: `${failure.event_type} failed`,
        severity: 'warning',
        since: failure.created_at || null,
      });
    }
  });

  return issues
    .sort((a, b) => new Date(b.since || 0).getTime() - new Date(a.since || 0).getTime())
    .slice(0, 8);
}

/* ================================================================== *
 * Overview
 * ================================================================== */

async function getFounderOverview({ range = '7d' } = {}) {
  const window = buildDateRange(range);
  const rates = await loadCostRates();

  const [
    totalDevices,
    onlineDevices,
    usageRows,
    sessionRows,
    users,
    costRows,
    cardTaps,
    games,
    summaries,
  ] = await Promise.all([
    prisma.ai_device.count(),
    prisma.device_runtime_state.count({ where: { online: true } }),
    prisma.device_usage_daily.findMany({
      where: { date: { gte: window.dateOnlyStart, lte: window.dateOnlyEnd } },
      orderBy: { date: 'asc' },
    }),
    prisma.analytics_game_sessions.findMany({
      where: { started_at: { gte: window.tsStart, lte: window.tsEnd } },
      orderBy: { started_at: 'asc' },
    }),
    prisma.sys_user.findMany({
      where: { created_at: { gte: window.tsStart, lte: window.tsEnd } },
      select: { created_at: true },
      orderBy: { created_at: 'asc' },
    }),
    prisma.device_token_usage_session.findMany({
      where: { usage_date: { gte: window.dateOnlyStart, lte: window.dateOnlyEnd } },
      orderBy: { usage_date: 'asc' },
    }),
    prisma.rfid_card_tap_log.findMany({
      where: { created_at: { gte: window.tsStart, lte: window.tsEnd } },
      orderBy: { created_at: 'desc' },
    }),
    prisma.device_games_played.findMany({
      where: { activity_date: { gte: window.dateOnlyStart, lte: window.dateOnlyEnd } },
      orderBy: { played_at: 'desc' },
    }),
    prisma.voice_session_summaries.findMany({
      where: { updated_at: { gte: window.tsStart, lte: window.tsEnd } },
      orderBy: { updated_at: 'desc' },
      take: 8,
    }),
  ]);

  // Previous equal-length window, for the up/down arrows on every KPI.
  const previous = previousWindowOf(window);
  const [prevActiveMacs, prevUsageSum, prevSessionCount, prevUserCount, prevCostSums] = await Promise.all([
    prisma.device_usage_daily.groupBy({
      by: ['mac_address'],
      where: { date: { gte: previous.dateOnlyStart, lte: previous.dateOnlyEnd } },
    }),
    prisma.device_usage_daily.aggregate({
      _sum: { usage_time_seconds: true },
      where: { date: { gte: previous.dateOnlyStart, lte: previous.dateOnlyEnd } },
    }),
    prisma.analytics_game_sessions.count({ where: { started_at: { gte: previous.tsStart, lte: previous.tsEnd } } }),
    prisma.sys_user.count({ where: { created_at: { gte: previous.tsStart, lte: previous.tsEnd } } }),
    prisma.device_token_usage_session.aggregate({
      where: { usage_date: { gte: previous.dateOnlyStart, lte: previous.dateOnlyEnd } },
      _sum: {
        input_text_tokens: true, input_audio_tokens: true, input_cached_tokens: true,
        output_text_tokens: true, output_audio_tokens: true,
      },
    }),
  ]);

  const prevCost = rawTotalCost(
    {
      input_text_tokens: prevCostSums._sum.input_text_tokens,
      input_audio_tokens: prevCostSums._sum.input_audio_tokens,
      input_cached_tokens: prevCostSums._sum.input_cached_tokens,
      output_text_tokens: prevCostSums._sum.output_text_tokens,
      output_audio_tokens: prevCostSums._sum.output_audio_tokens,
    },
    rates,
  );

  const usageByDate = aggregateUsageByDate(usageRows, window.dayKeys);
  const sessionByDate = aggregateSessionsByDate(sessionRows, window.dayKeys);
  const registrationsByDate = aggregateRegistrationsByDate(users, window.dayKeys);
  const costByDate = aggregateCostByDate(costRows, window.dayKeys, rates);

  const totalUsageSeconds = usageRows.reduce((sum, row) => sum + Number(row.usage_time_seconds || 0), 0);
  const activeInRange = new Set(usageRows.map((row) => row.mac_address)).size;

  // "Today" means today on the IST calendar — not merely the most recent row.
  const todayKey = todayIstKey();
  const todayUsage = usageByDate.find((row) => row.date === todayKey) || null;
  const splitSource = todayUsage || { aiTalkSeconds: 0, cardSeconds: 0, gameSeconds: 0, radioSeconds: 0 };
  const splitTotalSeconds =
    splitSource.aiTalkSeconds + splitSource.cardSeconds + splitSource.gameSeconds + splitSource.radioSeconds;

  return {
    range,
    generatedAt: new Date().toISOString(),
    kpis: {
      // Devices seen in the selected window, plus the instantaneous online count.
      activeToys: {
        total: activeInRange,
        fleetTotal: totalDevices,
        onlineNow: onlineDevices,
        sparkline: usageByDate.map((row) => row.activeDevices),
      },
      playTimeHours: {
        total: round(totalUsageSeconds / 3600, 1),
        sparkline: usageByDate.map((row) => round(row.usageSeconds / 3600, 1)),
      },
      sessions: {
        total: sessionRows.length,
        sparkline: sessionByDate.map((row) => row.total),
      },
      newFamilies: {
        total: users.length,
        sparkline: registrationsByDate.map((row) => row.count),
      },
      aiCostInr: {
        total: round(costRows.reduce((sum, row) => sum + rawTotalCost(row, rates), 0), 2),
        sparkline: costByDate.map((row) => row.cost),
      },
    },
    // Percentage change vs the equal-length window immediately before this one.
    // null means there was no baseline to compare against.
    deltas: {
      activeToys: pctChange(activeInRange, prevActiveMacs.length),
      playTimeHours: pctChange(totalUsageSeconds, Number(prevUsageSum._sum.usage_time_seconds || 0)),
      sessions: pctChange(sessionRows.length, prevSessionCount),
      newFamilies: pctChange(users.length, prevUserCount),
      aiCostInr: pctChange(costRows.reduce((sum, row) => sum + rawTotalCost(row, rates), 0), prevCost),
    },
    comparedTo: { startKey: previous.startKey, endKey: previous.endKey },
    sections: {
      timeByFeature: {
        series: usageByDate.map((row) => ({
          date: row.date,
          aiTalkMinutes: round(row.aiTalkSeconds / 60, 1),
          cardMinutes: round(row.cardSeconds / 60, 1),
          gameMinutes: round(row.gameSeconds / 60, 1),
          radioMinutes: round(row.radioSeconds / 60, 1),
        })),
      },
      todaysSplit: {
        hasData: Boolean(todayUsage) && splitTotalSeconds > 0,
        totalMinutes: round(splitTotalSeconds / 60, 1),
        items: [
          { key: 'aiTalk', label: 'AI conversations', minutes: round(splitSource.aiTalkSeconds / 60, 1) },
          { key: 'card', label: 'Story & rhyme cards', minutes: round(splitSource.cardSeconds / 60, 1) },
          { key: 'game', label: 'Games', minutes: round(splitSource.gameSeconds / 60, 1) },
          { key: 'radio', label: 'Radio', minutes: round(splitSource.radioSeconds / 60, 1) },
        ],
      },
      cardsKidsLove: {
        items: summarizeCardLeaderboard(cardTaps),
        unresolvedTapCount: cardTaps.filter((row) => !row.content_pack_name).length,
      },
      gamesPlayedVsFinished: {
        items: summarizeGames(games),
      },
      talkingAbout: {
        items: topTopics(summaries),
        samples: summaries.slice(0, 3).map((entry) => ({
          summary: entry.summary,
          macAddress: entry.mac_address,
          updatedAt: entry.updated_at,
        })),
      },
    },
  };
}

/* ================================================================== *
 * Families
 * ================================================================== */

async function searchFamilies(query) {
  const q = String(query || '').trim();
  if (!q) return { kids: [], parents: [], devices: [] };

  const [kids, parents, devices] = await Promise.all([
    prisma.kid_profile.findMany({
      where: {
        OR: [
          { name: { contains: q, mode: 'insensitive' } },
          { nickname: { contains: q, mode: 'insensitive' } },
        ],
      },
      include: { sys_user: { include: { parent_profile: true } } },
      take: 5,
    }),
    prisma.parent_profile.findMany({
      where: { display_name: { contains: q, mode: 'insensitive' } },
      include: { sys_user: { include: { ai_device: true } } },
      take: 5,
    }),
    prisma.ai_device.findMany({
      where: {
        OR: [
          { mac_address: { contains: q, mode: 'insensitive' } },
          { alias: { contains: q, mode: 'insensitive' } },
        ],
      },
      include: { sys_user: { include: { parent_profile: true } } },
      take: 5,
    }),
  ]);

  const deviceKidNames = await buildKidNameByMac(devices);

  return {
    kids: kids.map((kid) => ({
      type: 'kid',
      id: String(kid.id),
      label: kid.name,
      subtitle: kid.nickname || null,
      parentName: kid.sys_user?.parent_profile?.display_name || null,
    })),
    parents: parents.map((parent) => ({
      type: 'parent',
      id: String(parent.user_id),
      label: parent.display_name || 'Unnamed parent',
      toyCount: parent.sys_user?.ai_device?.length || 0,
    })),
    devices: devices.map((device) => ({
      type: 'device',
      id: device.id,
      label: device.alias || device.mac_address,
      macAddress: device.mac_address,
      kidName: deviceKidNames.get(device.mac_address) || null,
      parentName: device.sys_user?.parent_profile?.display_name || null,
    })),
  };
}

/** Parent email/phone are deliberately never returned — display names only. */
async function listAllFamilies({ page = 1, limit = 50 } = {}) {
  const safeLimit = Math.min(Math.max(Number(limit) || 50, 1), 200);
  const safePage = Math.max(Number(page) || 1, 1);

  const [total, kids] = await Promise.all([
    prisma.kid_profile.count(),
    prisma.kid_profile.findMany({
      include: { sys_user: { include: { parent_profile: true, ai_device: true } } },
      orderBy: { id: 'asc' },
      skip: (safePage - 1) * safeLimit,
      take: safeLimit,
    }),
  ]);

  return {
    total,
    page: safePage,
    limit: safeLimit,
    items: kids.map((kid) => ({
      kidId: String(kid.id),
      kidName: kid.name,
      nickname: kid.nickname || null,
      grade: kid.grade || null,
      birthDate: kid.birth_date,
      parentName: kid.sys_user?.parent_profile?.display_name || null,
      deviceCount: kid.sys_user?.ai_device?.length || 0,
    })),
  };
}

async function resolveKidId(macOrKidId) {
  if (/^\d+$/.test(String(macOrKidId || ''))) {
    const numericId = BigInt(macOrKidId);
    const kid = await prisma.kid_profile.findFirst({ where: { id: numericId }, select: { id: true } });
    if (kid) return kid.id;
    const fallbackKid = await prisma.kid_profile.findFirst({
      where: { user_id: numericId },
      select: { id: true },
    });
    return fallbackKid?.id || null;
  }

  const normalizedMac = normalizeMacAddress(macOrKidId);
  if (!normalizedMac) return null;
  const device = await prisma.ai_device.findFirst({
    where: { mac_address: normalizedMac },
    select: { kid_id: true },
  });
  return device?.kid_id || null;
}

async function getFamilyProfile(macOrKidId) {
  const kidId = await resolveKidId(macOrKidId);
  if (!kidId) return null;

  const kid = await prisma.kid_profile.findFirst({
    where: { id: kidId },
    include: { sys_user: { include: { parent_profile: true, ai_device: true } } },
  });
  if (!kid) return null;

  const devices = kid.sys_user?.ai_device || [];
  const macAddresses = devices.map((device) => device.mac_address);

  const weekWindow = buildDateRange('7d');
  const monthKey = todayIstKey().slice(0, 7);
  const questionAllowance = await loadQuestionAllowance();

  const [runtimeStates, quota, progress, summaries, cardTaps, games, weekUsage] = await Promise.all([
    prisma.device_runtime_state.findMany({ where: { mac_address: { in: macAddresses } } }),
    prisma.user_question_quota.findFirst({ where: { user_id: kid.user_id, month_key: monthKey } }),
    prisma.analytics_user_progress.findMany({ where: { mac_address: { in: macAddresses } } }),
    prisma.voice_session_summaries.findMany({
      where: { mac_address: { in: macAddresses } },
      orderBy: { updated_at: 'desc' },
      take: 3,
    }),
    prisma.rfid_card_tap_log.findMany({
      where: { mac_address: { in: macAddresses } },
      orderBy: { created_at: 'desc' },
      take: 200,
    }),
    prisma.device_games_played.findMany({
      where: { mac_address: { in: macAddresses } },
      orderBy: { played_at: 'desc' },
      take: 200,
    }),
    prisma.device_usage_daily.findMany({
      where: {
        mac_address: { in: macAddresses },
        date: { gte: weekWindow.dateOnlyStart, lte: weekWindow.dateOnlyEnd },
      },
      orderBy: { date: 'asc' },
    }),
  ]);

  const runtimeByMac = new Map(runtimeStates.map((state) => [state.mac_address, state]));
  const weekByDate = aggregateUsageByDate(weekUsage, weekWindow.dayKeys);
  const weekSeconds = weekUsage.reduce((sum, row) => sum + Number(row.usage_time_seconds || 0), 0);
  const weekFeature = weekUsage.reduce(
    (acc, row) => ({
      aiTalk: acc.aiTalk + Number(row.ai_talk_usage_seconds || 0),
      card: acc.card + Number(row.card_usage_seconds || 0),
      game: acc.game + Number(row.game_usage_seconds || 0),
      radio: acc.radio + Number(row.radio_usage_seconds || 0),
    }),
    { aiTalk: 0, card: 0, game: 0, radio: 0 },
  );

  return {
    kid: {
      id: String(kid.id),
      name: kid.name,
      nickname: kid.nickname,
      avatarUrl: kid.avatar_url,
      gender: kid.gender,
      grade: kid.grade,
      school: kid.school,
      language: kid.language,
      timezone: kid.timezone,
      interests: kid.interests || [],
      birthDate: kid.birth_date,
      memberSince: kid.created_at,
    },
    // Display name only. Parent email/phone are intentionally not exposed.
    parent: {
      displayName: kid.sys_user?.parent_profile?.display_name || null,
      countryRegion: kid.sys_user?.parent_profile?.country_region || null,
      timezone: kid.sys_user?.parent_profile?.timezone || null,
      memberSince: kid.sys_user?.parent_profile?.created_at || null,
    },
    devices: devices.map((device) => {
      const runtime = runtimeByMac.get(device.mac_address);
      return {
        id: device.id,
        macAddress: device.mac_address,
        alias: device.alias || device.mac_address,
        appVersion: device.app_version,
        lastConnectedAt: device.last_connected_at,
        online: runtime?.online || false,
        battery: runtime?.battery ?? null,
        firmware: runtime?.firmware || device.app_version || null,
        lastSeenAt: runtime?.last_seen_at || null,
      };
    }),
    quota: (() => {
      const used = quota?.questions_used || 0;
      const extra = quota?.extra_purchased || 0;
      // allowance is null until `monthly_question_allowance` is configured
      const total = questionAllowance === null ? null : questionAllowance + extra;
      return {
        monthKey: quota?.month_key || monthKey,
        questionsUsed: used,
        extraPurchased: extra,
        allowance: total,
        remaining: total === null ? null : Math.max(0, total - used),
      };
    })(),
    thisWeek: {
      playSeconds: weekSeconds,
      sessions: weekUsage.length,
      sparkline: weekByDate.map((row) => round(row.usageSeconds / 60, 1)),
      split: [
        { key: 'aiTalk', label: 'AI talk', minutes: round(weekFeature.aiTalk / 60, 1) },
        { key: 'card', label: 'Cards', minutes: round(weekFeature.card / 60, 1) },
        { key: 'game', label: 'Games', minutes: round(weekFeature.game / 60, 1) },
        { key: 'radio', label: 'Radio', minutes: round(weekFeature.radio / 60, 1) },
      ],
    },
    // analytics_user_progress is keyed one row per device (mac_address is unique).
    progress: progress.map((entry) => ({
      macAddress: entry.mac_address,
      totalSessions: entry.total_sessions || 0,
      totalDurationSeconds: entry.total_duration_seconds || 0,
      totalGamesPlayed: entry.total_games_played || 0,
      currentStreak: entry.current_streak || 0,
      longestStreak: entry.longest_streak || 0,
      lastActivityAt: entry.last_activity_at || null,
    })),
    recentSummaries: summaries.map((entry) => ({
      summary: entry.summary,
      macAddress: entry.mac_address,
      updatedAt: entry.updated_at,
    })),
    contentLove: {
      cards: summarizeCardLeaderboard(cardTaps, 4),
      games: summarizeGames(games, 4),
    },
  };
}

/* ================================================================== *
 * Engagement
 * ================================================================== */

async function getFounderEngagement({ range = '30d' } = {}) {
  const window = buildDateRange(range);

  // Retention always compares the trailing 7 IST days against the 7 immediately
  // before them, independent of the chart range.
  const currentWeekStartKey = shiftDayKey(window.endKey, -6);
  const previousWeekEndKey = shiftDayKey(currentWeekStartKey, -1);
  const previousWeekStartKey = shiftDayKey(previousWeekEndKey, -6);

  // Quiet-device detection needs history older than the selected range.
  const historyStartKey = shiftDayKey(window.endKey, -59);
  const quietCutoffKey = shiftDayKey(window.endKey, -6);

  const [usageRows, currentWeekUsageRows, previousWeekUsageRows, sessionRows, devices, runtimeRows, historyRows] =
    await Promise.all([
      prisma.device_usage_daily.findMany({
        where: { date: { gte: window.dateOnlyStart, lte: window.dateOnlyEnd } },
        orderBy: { date: 'asc' },
      }),
      prisma.device_usage_daily.findMany({
        where: {
          date: { gte: new Date(`${currentWeekStartKey}T00:00:00Z`), lte: window.dateOnlyEnd },
        },
        select: { mac_address: true },
      }),
      prisma.device_usage_daily.findMany({
        where: {
          date: {
            gte: new Date(`${previousWeekStartKey}T00:00:00Z`),
            lte: new Date(`${previousWeekEndKey}T00:00:00Z`),
          },
        },
        select: { mac_address: true },
      }),
      prisma.analytics_game_sessions.findMany({
        where: { started_at: { gte: window.tsStart, lte: window.tsEnd } },
        orderBy: { started_at: 'asc' },
      }),
      prisma.ai_device.findMany({ include: { sys_user: { include: { parent_profile: true } } } }),
      prisma.device_runtime_state.findMany(),
      prisma.device_usage_daily.findMany({
        where: { date: { gte: new Date(`${historyStartKey}T00:00:00Z`), lte: window.dateOnlyEnd } },
        select: { mac_address: true, date: true },
      }),
    ]);

  const previousRange = previousWindowOf(window);
  const [previousRangeActives, previousSessions] = await Promise.all([
    prisma.device_usage_daily.groupBy({
      by: ['mac_address'],
      where: { date: { gte: previousRange.dateOnlyStart, lte: previousRange.dateOnlyEnd } },
    }),
    prisma.analytics_game_sessions.aggregate({
      where: { started_at: { gte: previousRange.tsStart, lte: previousRange.tsEnd } },
      _avg: { duration_seconds: true },
    }),
  ]);
  const previousAvgSessionMinutes = round(Number(previousSessions._avg.duration_seconds || 0) / 60, 1);

  const usageByDate = aggregateUsageByDate(usageRows, window.dayKeys);
  const dailyActives = usageByDate.map((row) => row.activeDevices);
  const averageSeries = movingAverage(dailyActives);
  const runtimeByMac = new Map(runtimeRows.map((row) => [row.mac_address, row]));
  const kidNameByMac = await buildKidNameByMac(devices);

  const currentWeekSet = new Set(currentWeekUsageRows.map((row) => row.mac_address));
  const previousWeekSet = new Set(previousWeekUsageRows.map((row) => row.mac_address));
  const returnedCount = Array.from(previousWeekSet).filter((mac) => currentWeekSet.has(mac)).length;
  const newCount = Array.from(currentWeekSet).filter((mac) => !previousWeekSet.has(mac)).length;

  const todayKey = todayIstKey();
  const yesterdayKey = shiftDayKey(todayKey, -1);
  const activeToday = usageByDate.find((row) => row.date === todayKey)?.activeDevices ?? null;
  const activeYesterday = usageByDate.find((row) => row.date === yesterdayKey)?.activeDevices ?? null;
  const monthlyActives = new Set(usageRows.map((row) => row.mac_address)).size;

  const avgSessionMinutes = sessionRows.length
    ? round(sessionRows.reduce((sum, row) => sum + Number(row.duration_seconds || 0), 0) / 60 / sessionRows.length, 1)
    : 0;

  // A device counts as "quiet" only if it has real usage history but none in
  // the last 7 days — never merely because it was registered and never used.
  const lastUsageByMac = new Map();
  historyRows.forEach((row) => {
    const key = toIsoDate(row.date);
    if (!key) return;
    const existing = lastUsageByMac.get(row.mac_address);
    if (!existing || key > existing) lastUsageByMac.set(row.mac_address, key);
  });

  const quietDevices = devices
    .filter((device) => {
      const lastKey = lastUsageByMac.get(device.mac_address);
      return Boolean(lastKey) && lastKey < quietCutoffKey;
    })
    .map((device) => {
      const lastKey = lastUsageByMac.get(device.mac_address);
      const quietDays = Math.floor(
        (new Date(`${todayKey}T00:00:00Z`).getTime() - new Date(`${lastKey}T00:00:00Z`).getTime()) / 86400000,
      );
      return {
        macAddress: device.mac_address,
        alias: device.alias || device.mac_address,
        kidName: kidNameByMac.get(device.mac_address) || null,
        parentName: device.sys_user?.parent_profile?.display_name || null,
        quietDays,
        lastActivityDate: lastKey,
        lastSeenAt: runtimeByMac.get(device.mac_address)?.last_seen_at || device.last_connected_at || null,
      };
    })
    .sort((a, b) => b.quietDays - a.quietDays);

  return {
    range,
    generatedAt: new Date().toISOString(),
    kpis: {
      activeToday,
      activeYesterday,
      weeklyActives: currentWeekSet.size,
      monthlyActives,
      fleetTotal: devices.length,
      dauMauRatio: monthlyActives && activeYesterday !== null ? round((activeYesterday / monthlyActives) * 100, 0) : null,
      avgSessionMinutes,
    },
    deltas: {
      weeklyActives: pctChange(currentWeekSet.size, previousWeekSet.size),
      monthlyActives: pctChange(monthlyActives, previousRangeActives.length),
      avgSessionMinutes: pctChange(avgSessionMinutes, previousAvgSessionMinutes),
    },
    sections: {
      dailyActives: usageByDate.map((row, index) => ({
        date: row.date,
        activeDevices: row.activeDevices,
        average: averageSeries[index],
      })),
      returningSplit: {
        currentWeekActives: currentWeekSet.size,
        previousWeekActives: previousWeekSet.size,
        returnedCount,
        returnedRate: previousWeekSet.size ? round((returnedCount / previousWeekSet.size) * 100, 0) : null,
        newCount,
        windowLabel: `${currentWeekStartKey} → ${window.endKey} vs ${previousWeekStartKey} → ${previousWeekEndKey}`,
      },
      sessionsByHour: summarizeHourlySessions(sessionRows),
      sessionsHeatmap: summarizeSessionsHeatmap(sessionRows),
      quietDevices: quietDevices.slice(0, 12),
      quietDeviceTotal: quietDevices.length,
    },
  };
}

/* ================================================================== *
 * Content & games
 * ================================================================== */

async function getFounderContent({ range = '7d' } = {}) {
  const window = buildDateRange(range);
  const previous = previousWindowOf(window);

  // Fixed 21-day lookback powers the 14-day sparklines and the three weekly
  // buckets behind "losing steam", independent of the selected range.
  const trendWindow = boundsFromKeys(shiftDayKey(window.endKey, -20), window.endKey);
  const trendDayKeys = boundsFromKeys(shiftDayKey(window.endKey, -13), window.endKey).dayKeys;
  const weekBucketOf = (dayKey) => {
    if (dayKey > shiftDayKey(window.endKey, -7)) return 0;
    if (dayKey > shiftDayKey(window.endKey, -14)) return 1;
    return 2;
  };

  const [cardTaps, gameRows, mediaRows, radioRows, contentPackCount, gameSessions] = await Promise.all([
    prisma.rfid_card_tap_log.findMany({
      where: { created_at: { gte: window.tsStart, lte: window.tsEnd } },
      orderBy: { created_at: 'desc' },
    }),
    prisma.device_games_played.findMany({
      where: { activity_date: { gte: window.dateOnlyStart, lte: window.dateOnlyEnd } },
      orderBy: { played_at: 'desc' },
    }),
    prisma.analytics_media_playback.findMany({
      where: {
        created_at: { gte: window.tsStart, lte: window.tsEnd },
        // one row per playback start, not per pause/resume/complete event
        event_type: 'start',
      },
      orderBy: { created_at: 'desc' },
    }),
    prisma.device_radio_played.findMany({
      where: { activity_date: { gte: window.dateOnlyStart, lte: window.dateOnlyEnd } },
      orderBy: { played_at: 'desc' },
    }),
    prisma.rfid_content_pack.count(),
    prisma.analytics_game_sessions.findMany({
      where: { started_at: { gte: window.tsStart, lte: window.tsEnd } },
    }),
  ]);

  const [prevTapCount, prevGamePlays, prevMediaCount, prevRadioCount, prevPackIds, trendTapRows, trendRadioRows, trendSessionRows] =
    await Promise.all([
      prisma.rfid_card_tap_log.count({ where: { created_at: { gte: previous.tsStart, lte: previous.tsEnd } } }),
      prisma.device_games_played.count({ where: { activity_date: { gte: previous.dateOnlyStart, lte: previous.dateOnlyEnd } } }),
      prisma.analytics_media_playback.count({
        where: { created_at: { gte: previous.tsStart, lte: previous.tsEnd }, event_type: 'start' },
      }),
      prisma.device_radio_played.count({
        where: { activity_date: { gte: previous.dateOnlyStart, lte: previous.dateOnlyEnd } },
      }),
      prisma.rfid_card_tap_log.groupBy({
        by: ['content_pack_id'],
        where: { created_at: { gte: previous.tsStart, lte: previous.tsEnd }, content_pack_id: { not: null } },
      }),
      prisma.rfid_card_tap_log.findMany({
        where: { created_at: { gte: trendWindow.tsStart, lte: trendWindow.tsEnd } },
        select: { content_pack_name: true, created_at: true },
      }),
      prisma.device_radio_played.findMany({
        where: { activity_date: { gte: trendWindow.dateOnlyStart, lte: trendWindow.dateOnlyEnd } },
        select: { duration_ms: true, activity_date: true },
      }),
      prisma.analytics_game_sessions.findMany({
        where: { started_at: { gte: trendWindow.tsStart, lte: trendWindow.tsEnd } },
        select: { mode_type: true, completion_status: true, started_at: true },
      }),
    ]);

  /* ---- per-pack weekly buckets + 14-day daily series ---- */
  const packWeeks = new Map();   // name -> [w0, w1, w2]
  const packDaily = new Map();   // name -> Map(dayKey -> count)
  trendTapRows.forEach((row) => {
    if (!row.content_pack_name) return;
    const key = toIsoDate(row.created_at);
    if (!key) return;
    if (!packWeeks.has(row.content_pack_name)) {
      packWeeks.set(row.content_pack_name, [0, 0, 0]);
      packDaily.set(row.content_pack_name, new Map());
    }
    packWeeks.get(row.content_pack_name)[weekBucketOf(key)] += 1;
    const daily = packDaily.get(row.content_pack_name);
    daily.set(key, (daily.get(key) || 0) + 1);
  });

  const prevTapsByPack = new Map();
  const previousPackRows = await prisma.rfid_card_tap_log.groupBy({
    by: ['content_pack_name'],
    where: { created_at: { gte: previous.tsStart, lte: previous.tsEnd }, content_pack_name: { not: null } },
    _count: { _all: true },
  });
  previousPackRows.forEach((row) => prevTapsByPack.set(row.content_pack_name, row._count._all));

  const packs = summarizeCardLeaderboard(cardTaps, 10).map((item) => {
    const previousTaps = prevTapsByPack.get(item.name) || 0;
    const daily = packDaily.get(item.name) || new Map();
    return {
      ...item,
      repeatRate: item.uniqueDevices ? round(item.taps / item.uniqueDevices, 1) : 0,
      previousTaps,
      changePercent: pctChange(item.taps, previousTaps),
      // 14 points, oldest first — drives the sparkline column
      trend: trendDayKeys.map((day) => daily.get(day) || 0),
    };
  });

  // Both play sources are folded into one canonical key so a game never appears
  // twice (once with plays, once with completions).
  const gamesByKey = new Map();
  const ensureGame = (label) => {
    const key = gameKey(label);
    if (!key) return null;
    if (!gamesByKey.has(key)) {
      gamesByKey.set(key, {
        name: prettyGameName(label),
        plays: 0,
        sessions: 0,
        completed: 0,
        totalScore: 0,
        scoredPlays: 0,
      });
    }
    return gamesByKey.get(key);
  };

  gameRows.forEach((row) => {
    const item = ensureGame(row.game_name || row.game_id);
    if (!item) return;
    item.plays += 1;
    if (row.score !== null && row.score !== undefined) {
      item.totalScore += Number(row.score);
      item.scoredPlays += 1;
    }
  });

  gameSessions.forEach((row) => {
    const item = ensureGame(row.mode_type);
    if (!item) return;
    item.sessions += 1;
    if ((row.completion_status || '').toLowerCase() === 'completed') item.completed += 1;
  });

  const games = Array.from(gamesByKey.values())
    .map((item) => {
      // Completion is only meaningful against the session population that
      // actually records a completion_status.
      const completionRate = item.sessions ? clampPercent(round((item.completed / item.sessions) * 100, 0)) : null;
      return {
        name: item.name,
        plays: Math.max(item.plays, item.sessions),
        sessions: item.sessions,
        completed: item.completed,
        completionRate,
        avgScore: item.scoredPlays ? round(item.totalScore / item.scoredPlays, 1) : null,
        status: getStatusFromCompletionRate(completionRate),
      };
    })
    .sort((a, b) => b.plays - a.plays)
    .slice(0, 8);

  const completionRates = games.map((item) => item.completionRate).filter((value) => value !== null);
  const avgCompletionRate = completionRates.length
    ? round(completionRates.reduce((sum, value) => sum + value, 0) / completionRates.length, 0)
    : null;

  const mediaByTitle = new Map();
  mediaRows.forEach((row) => {
    const title =
      row.metadata?.media_title || row.metadata?.title || row.metadata?.name || `Content ${row.content_id || row.id}`;
    if (!mediaByTitle.has(title)) mediaByTitle.set(title, { title, type: row.content_type, plays: 0 });
    mediaByTitle.get(title).plays += 1;
  });

  const radioByStation = new Map();
  radioRows.forEach((row) => {
    const station = row.station || 'Radio';
    radioByStation.set(station, (radioByStation.get(station) || 0) + Number(row.duration_ms || 0) / 60000);
  });

  // Catalog coverage counts mapped packs only; unmapped UIDs are reported
  // separately so the ratio can never exceed 100%.
  const packsInUse = new Set(
    cardTaps.map((row) => row.content_pack_id).filter((id) => id !== null && id !== undefined).map(String),
  ).size;

  /* ---- losing steam: measured decline, ideally across two weeks ---- */
  const losingSteam = [];

  Array.from(packWeeks.entries()).forEach(([name, [w0, w1, w2]]) => {
    const changePercent = pctChange(w0, w1);
    if (changePercent === null || changePercent >= 0) return;
    const twoWeeks = w1 < w2;
    losingSteam.push({
      name,
      metric: 'taps',
      changePercent,
      consecutiveWeeks: twoWeeks ? 2 : 1,
    });
  });

  const radioWeeks = [0, 0, 0];
  trendRadioRows.forEach((row) => {
    const key = toIsoDate(row.activity_date);
    if (!key) return;
    radioWeeks[weekBucketOf(key)] += Number(row.duration_ms || 0) / 60000;
  });
  const radioChange = pctChange(radioWeeks[0], radioWeeks[1]);
  if (radioChange !== null && radioChange < 0) {
    losingSteam.push({
      name: 'Radio overall',
      metric: 'minutes',
      changePercent: radioChange,
      consecutiveWeeks: radioWeeks[1] < radioWeeks[2] ? 2 : 1,
    });
  }

  const gameWeeks = new Map();
  trendSessionRows.forEach((row) => {
    const key = gameKey(row.mode_type);
    const day = toIsoDate(row.started_at);
    if (!key || !day) return;
    if (!gameWeeks.has(key)) {
      gameWeeks.set(key, { name: prettyGameName(row.mode_type), weeks: [{ t: 0, c: 0 }, { t: 0, c: 0 }, { t: 0, c: 0 }] });
    }
    const bucket = gameWeeks.get(key).weeks[weekBucketOf(day)];
    bucket.t += 1;
    if (String(row.completion_status || '').toLowerCase() === 'completed') bucket.c += 1;
  });

  Array.from(gameWeeks.values()).forEach((entry) => {
    const [w0, w1] = entry.weeks;
    if (w0.t < 3 || w1.t < 3) return;
    const rate0 = (w0.c / w0.t) * 100;
    const rate1 = (w1.c / w1.t) * 100;
    const drop = round(rate0 - rate1, 0);
    if (drop >= 0) return;
    losingSteam.push({
      name: entry.name,
      metric: 'completion',
      changePoints: drop,
      changePercent: null,
      consecutiveWeeks: 1,
    });
  });

  losingSteam.sort((a, b) => {
    const aMag = Math.abs(a.changePercent ?? a.changePoints ?? 0);
    const bMag = Math.abs(b.changePercent ?? b.changePoints ?? 0);
    return bMag - aMag;
  });

  return {
    range,
    generatedAt: new Date().toISOString(),
    kpis: {
      cardTaps: cardTaps.length,
      packsInUse,
      catalogTotal: contentPackCount,
      gamePlays: gameRows.length,
      avgCompletionRate,
      mediaPlays: mediaRows.length + radioRows.length,
    },
    deltas: {
      cardTaps: pctChange(cardTaps.length, prevTapCount),
      packsInUse: pctChange(packsInUse, prevPackIds.length),
      gamePlays: pctChange(gameRows.length, prevGamePlays),
      mediaPlays: pctChange(mediaRows.length + radioRows.length, prevMediaCount + prevRadioCount),
    },
    sections: {
      packLeaderboard: packs,
      games,
      media: Array.from(mediaByTitle.values()).sort((a, b) => b.plays - a.plays).slice(0, 5),
      radio: Array.from(radioByStation.entries())
        .map(([station, minutes]) => ({ station, minutes: round(minutes, 1) }))
        .sort((a, b) => b.minutes - a.minutes)
        .slice(0, 5),
      losingSteam: losingSteam.slice(0, 5),
      unresolvedTapCount: cardTaps.filter((row) => !row.content_pack_name).length,
    },
  };
}

/* ================================================================== *
 * Conversations
 * ================================================================== */

async function getFounderConversations({ range = '7d' } = {}) {
  const window = buildDateRange(range);

  const [usageRows, summaries, summaryCount, turnsAggregate, tokenAggregate, topicSampleRows] = await Promise.all([
    prisma.device_usage_daily.findMany({
      where: { date: { gte: window.dateOnlyStart, lte: window.dateOnlyEnd } },
      orderBy: { date: 'asc' },
    }),
    prisma.voice_session_summaries.findMany({
      where: { updated_at: { gte: window.tsStart, lte: window.tsEnd } },
      orderBy: { updated_at: 'desc' },
      take: 10,
    }),
    prisma.voice_session_summaries.count({
      where: { updated_at: { gte: window.tsStart, lte: window.tsEnd } },
    }),
    prisma.voice_session_summaries.aggregate({
      where: { updated_at: { gte: window.tsStart, lte: window.tsEnd } },
      _avg: { source_message_count: true },
    }),
    prisma.device_token_usage_session.aggregate({
      where: { usage_date: { gte: window.dateOnlyStart, lte: window.dateOnlyEnd } },
      _sum: { message_count: true },
    }),
    prisma.voice_session_summaries.findMany({
      where: { updated_at: { gte: window.tsStart, lte: window.tsEnd } },
      select: { summary: true },
      orderBy: { updated_at: 'desc' },
      take: 500,
    }),
  ]);

  const previous = previousWindowOf(window);
  const [prevSummaryCount, prevTalkSeconds, prevTurns] = await Promise.all([
    prisma.voice_session_summaries.count({ where: { updated_at: { gte: previous.tsStart, lte: previous.tsEnd } } }),
    prisma.device_usage_daily.aggregate({
      _sum: { ai_talk_usage_seconds: true },
      where: { date: { gte: previous.dateOnlyStart, lte: previous.dateOnlyEnd } },
    }),
    prisma.voice_session_summaries.aggregate({
      where: { updated_at: { gte: previous.tsStart, lte: previous.tsEnd } },
      _avg: { source_message_count: true },
    }),
  ]);

  const talkSeconds = usageRows.reduce((sum, row) => sum + Number(row.ai_talk_usage_seconds || 0), 0);
  const talkHours = round(talkSeconds / 3600, 1);
  const topicCounts = tallyTopics(topicSampleRows);

  return {
    range,
    generatedAt: new Date().toISOString(),
    kpis: {
      talkHours,
      talkSessions: summaryCount,
      avgTurnsPerSession: round(turnsAggregate._avg.source_message_count || 0, 1),
      topicsDetected: topicCounts.size,
      // No moderation pipeline persists results yet — null means "not tracked",
      // which the UI renders as such rather than as a clean-week zero.
      moderationFlags: null,
      screenedMessages: Number(tokenAggregate._sum.message_count || 0),
    },
    deltas: {
      talkHours: pctChange(talkSeconds, Number(prevTalkSeconds._sum.ai_talk_usage_seconds || 0)),
      talkSessions: pctChange(summaryCount, prevSummaryCount),
      avgTurnsPerSession: pctChange(
        Number(turnsAggregate._avg.source_message_count || 0),
        Number(prevTurns._avg.source_message_count || 0),
      ),
    },
    sections: {
      topics: Array.from(topicCounts.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 12)
        .map(([topic, mentions]) => ({ topic, mentions })),
      summaries: summaries.map((row) => {
        const { headline, tags } = summarizeRecentConversation(row.summary);
        return {
          id: row.id,
          sessionId: row.session_id,
          macAddress: row.mac_address,
          headline,
          summary: row.summary,
          tags,
          turns: row.source_message_count || 0,
          updatedAt: row.updated_at,
        };
      }),
    },
  };
}

/**
 * Real transcript for one voice session. Replaces the placeholder preview that
 * previously shipped fabricated dialogue attached to a real device.
 */
async function getConversationTranscript(sessionId) {
  const id = String(sessionId || '').trim();
  if (!id) return null;

  const [summary, messages] = await Promise.all([
    prisma.voice_session_summaries.findFirst({ where: { session_id: id } }),
    prisma.voice_session_messages.findMany({
      where: { session_id: id },
      orderBy: { sequence: 'asc' },
      take: 200,
    }),
  ]);

  if (!summary && !messages.length) return null;

  return {
    sessionId: id,
    macAddress: summary?.mac_address || messages[0]?.mac_address || null,
    headline: summary ? summarizeRecentConversation(summary.summary).headline : null,
    summary: summary?.summary || null,
    turns: messages.length,
    updatedAt: summary?.updated_at || null,
    lines: messages
      .filter((message) => message.content)
      .map((message) => ({
        speaker: String(message.role || '').toLowerCase() === 'assistant' ? 'Cheeko' : 'Kid',
        text: message.content,
        createdAt: message.created_at,
      })),
  };
}

/* ================================================================== *
 * Costs
 * ================================================================== */

async function getFounderCosts({ range = 'month' } = {}) {
  const window = buildDateRange(range);
  const [rates, monthlyBudget] = await Promise.all([loadCostRates(), loadMonthlyBudget()]);

  const [costRows, usageRows, devices] = await Promise.all([
    prisma.device_token_usage_session.findMany({
      where: { usage_date: { gte: window.dateOnlyStart, lte: window.dateOnlyEnd } },
      orderBy: { usage_date: 'asc' },
    }),
    prisma.device_usage_daily.findMany({
      where: { date: { gte: window.dateOnlyStart, lte: window.dateOnlyEnd } },
      orderBy: { date: 'asc' },
    }),
    prisma.ai_device.findMany({ include: { sys_user: { include: { parent_profile: true } } } }),
  ]);

  const previous = previousWindowOf(window);
  const prevCostSums = await prisma.device_token_usage_session.aggregate({
    where: { usage_date: { gte: previous.dateOnlyStart, lte: previous.dateOnlyEnd } },
    _sum: {
      input_text_tokens: true, input_audio_tokens: true, input_cached_tokens: true,
      output_text_tokens: true, output_audio_tokens: true,
    },
  });
  const prevTotalCost = rawTotalCost(
    {
      input_text_tokens: prevCostSums._sum.input_text_tokens,
      input_audio_tokens: prevCostSums._sum.input_audio_tokens,
      input_cached_tokens: prevCostSums._sum.input_cached_tokens,
      output_text_tokens: prevCostSums._sum.output_text_tokens,
      output_audio_tokens: prevCostSums._sum.output_audio_tokens,
    },
    rates,
  );

  const totalCostRaw = costRows.reduce((sum, row) => sum + rawTotalCost(row, rates), 0);
  const totalCost = round(totalCostRaw, 2);
  const activeSet = new Set(usageRows.map((row) => row.mac_address));
  const costByDate = aggregateCostByDate(costRows, window.dayKeys, rates);

  const dailyRate = totalCostRaw / Math.max(window.days, 1);
  const daysInMonth = window.daysInMonth || new Date(
    Date.UTC(Number(window.endKey.slice(0, 4)), Number(window.endKey.slice(5, 7)), 0),
  ).getUTCDate();

  // avg_ttft_seconds is NOT NULL DEFAULT 0, so a zero means "never measured"
  // rather than an instant response — exclude those instead of averaging them in.
  const ttftRows = costRows.filter((row) => Number(row.avg_ttft_seconds || 0) > 0);
  const avgResponseTimeSeconds = ttftRows.length
    ? round(ttftRows.reduce((sum, row) => sum + Number(row.avg_ttft_seconds || 0), 0) / ttftRows.length, 2)
    : null;

  const kidNameByMac = await buildKidNameByMac(devices);
  const deviceInfoByMac = new Map(devices.map((device) => [device.mac_address, device]));

  const spendByDevice = new Map();
  costRows.forEach((row) => {
    if (!spendByDevice.has(row.mac_address)) {
      spendByDevice.set(row.mac_address, {
        macAddress: row.mac_address,
        sessions: 0,
        talkTimeSeconds: 0,
        totalTokens: 0,
        costRaw: 0,
      });
    }
    const item = spendByDevice.get(row.mac_address);
    item.sessions += 1;
    item.talkTimeSeconds += Number(row.session_duration_seconds || 0);
    item.totalTokens += Number(row.total_tokens || 0);
    item.costRaw += rawTotalCost(row, rates);
  });

  return {
    range,
    generatedAt: new Date().toISOString(),
    kpis: {
      totalCost,
      // Run-rate projection over the current calendar month, from the observed
      // daily rate across the queried window.
      projectedMonth: round(dailyRate * daysInMonth, 0),
      daysInMonth,
      daysObserved: window.days,
      monthlyBudget,
      budgetUsedPercent: monthlyBudget ? round((totalCost / monthlyBudget) * 100, 0) : null,
      // Per-unit costs keep 4 decimals: at fleet scale these are routinely
      // sub-paisa, and rounding to 2 would report a real cost as ₹0.00.
      perActiveToyPerDay: activeSet.size
        ? round(totalCostRaw / activeSet.size / Math.max(window.days, 1), 4)
        : null,
      // Denominator is billed sessions, matching the cost source.
      perSession: costRows.length ? round(totalCostRaw / costRows.length, 4) : null,
      avgResponseTimeSeconds,
    },
    deltas: {
      totalCost: pctChange(totalCostRaw, prevTotalCost),
    },
    sections: {
      dailySpend: costByDate.map((row) => ({
        date: row.date,
        total: row.cost,
        inputCost: row.inputCost,
        outputCost: row.outputCost,
      })),
      tokenMix: {
        outputAudio: costRows.reduce((sum, row) => sum + Number(row.output_audio_tokens || 0), 0),
        inputAudio: costRows.reduce((sum, row) => sum + Number(row.input_audio_tokens || 0), 0),
        text: costRows.reduce(
          (sum, row) => sum + Number(row.output_text_tokens || 0) + Number(row.input_text_tokens || 0),
          0,
        ),
      },
      topDevices: Array.from(spendByDevice.values())
        .map((item) => {
          const info = deviceInfoByMac.get(item.macAddress);
          const cost = round(item.costRaw, 2);
          return {
            macAddress: item.macAddress,
            alias: info?.alias || item.macAddress,
            sessions: item.sessions,
            totalTokens: item.totalTokens,
            cost,
            kidName: kidNameByMac.get(item.macAddress) || null,
            parentName: info?.sys_user?.parent_profile?.display_name || null,
            talkHours: round(item.talkTimeSeconds / 3600, 1),
            fleetSharePercent: totalCostRaw ? round((item.costRaw / totalCostRaw) * 100, 1) : 0,
          };
        })
        .sort((a, b) => b.cost - a.cost)
        .slice(0, 10),
    },
  };
}

/* ================================================================== *
 * Fleet & ops
 * ================================================================== */

async function getFounderOperate() {
  const window = buildDateRange('7d');

  const errorFilter = {
    OR: [
      { event_name: { contains: 'error', mode: 'insensitive' } },
      { event_name: { contains: 'fail', mode: 'insensitive' } },
      { event_name: { contains: 'shutdown', mode: 'insensitive' } },
      { reason: { contains: 'error', mode: 'insensitive' } },
      { reason: { contains: 'fail', mode: 'insensitive' } },
    ],
  };

  const [devices, runtimeRows, otaRows, syncEvents, analyticsEvents, errorCount, lowBatteryEvents] =
    await Promise.all([
      prisma.ai_device.findMany({ orderBy: { create_date: 'desc' } }),
      prisma.device_runtime_state.findMany(),
      prisma.ai_ota.findMany({ orderBy: { create_date: 'desc' } }),
      prisma.device_sync_event.findMany({
        where: { created_at: { gte: window.tsStart, lte: window.tsEnd } },
        orderBy: { created_at: 'desc' },
        take: 50,
      }),
      prisma.device_analytics_event.findMany({
        where: {
          OR: [
            { server_received_at: { gte: window.tsStart, lte: window.tsEnd } },
            { event_timestamp: { gte: window.tsStart, lte: window.tsEnd } },
          ],
        },
        orderBy: { server_received_at: 'desc' },
        take: 50,
      }),
      // Counted across the whole window, not just the most recent page.
      prisma.device_analytics_event.count({
        where: {
          AND: [
            {
              OR: [
                { server_received_at: { gte: window.tsStart, lte: window.tsEnd } },
                { event_timestamp: { gte: window.tsStart, lte: window.tsEnd } },
              ],
            },
            errorFilter,
          ],
        },
      }),
      prisma.device_analytics_event.findMany({
        where: {
          OR: [
            { server_received_at: { gte: window.tsStart, lte: window.tsEnd } },
            { event_timestamp: { gte: window.tsStart, lte: window.tsEnd } },
          ],
          battery_percentage: { lt: 20 },
        },
        select: { mac_address: true, battery_percentage: true, battery: true },
      }),
    ]);

  const runtimeByMac = new Map(runtimeRows.map((row) => [row.mac_address, row]));
  const kidNameByMac = await buildKidNameByMac(devices);

  // Highest semantic version wins, so re-uploading an older firmware cannot
  // silently become "latest".
  const compareVersions = (a, b) =>
    String(b || '').localeCompare(String(a || ''), undefined, { numeric: true, sensitivity: 'base' });
  const latestOta = otaRows.length
    ? [...otaRows].sort((a, b) => compareVersions(a.version, b.version))[0]
    : null;

  const firmwareCounts = new Map();
  runtimeRows.forEach((row) => {
    const version = row.firmware || 'unknown';
    firmwareCounts.set(version, (firmwareCounts.get(version) || 0) + 1);
  });

  const onlineCount = runtimeRows.filter((row) => row.online).length;
  const reportingCount = runtimeRows.length;
  const latestCount = latestOta ? runtimeRows.filter((row) => row.firmware === latestOta.version).length : 0;

  const batteryRows = runtimeRows.filter((row) => row.battery !== null && row.battery !== undefined);
  const avgBattery = batteryRows.length
    ? round(batteryRows.reduce((sum, row) => sum + Number(row.battery), 0) / batteryRows.length, 0)
    : null;

  return {
    generatedAt: new Date().toISOString(),
    kpis: {
      fleetSize: devices.length,
      onlineNow: onlineCount,
      reportingDevices: reportingCount,
      // Percentages are relative to devices that actually report firmware.
      latestFirmwarePercent: reportingCount ? round((latestCount / reportingCount) * 100, 0) : null,
      latestFirmwareVersion: latestOta?.version || null,
      avgBattery,
      batteryReportingDevices: batteryRows.length,
      deviceErrors7d: errorCount,
    },
    sections: {
      firmwareCoverage: Array.from(firmwareCounts.entries())
        .map(([version, count]) => ({
          version,
          count,
          percent: reportingCount ? round((count / reportingCount) * 100, 0) : 0,
          isLatest: latestOta ? version === latestOta.version : false,
        }))
        .sort((a, b) => b.count - a.count),
      otaRollout: latestOta
        ? {
            version: latestOta.version,
            forceUpdate: Boolean(latestOta.force_update),
            updatedCount: latestCount,
            fleetSize: reportingCount,
            percent: reportingCount ? round((latestCount / reportingCount) * 100, 0) : 0,
          }
        : null,
      watchlist: summarizeWatchlist(devices, runtimeByMac, syncEvents, lowBatteryEvents, kidNameByMac),
      recentEvents: summarizeFleetEvents(syncEvents.slice(0, 20), analyticsEvents.slice(0, 20)),
    },
  };
}

/* ================================================================== *
 * Mission Control — the live ops wall.
 * Every tile is read from real rows; anything the schema cannot answer
 * is returned as null so the UI can say so rather than invent a figure.
 * ================================================================== */

async function getFounderLive() {
  const todayKey = todayIstKey();
  const today = boundsFromKeys(todayKey, todayKey);
  const week = boundsFromKeys(shiftDayKey(todayKey, -6), todayKey);
  const ttftWindow = boundsFromKeys(shiftDayKey(todayKey, -13), todayKey);
  const monthStartKey = `${todayKey.slice(0, 7)}-01`;
  const month = boundsFromKeys(monthStartKey, todayKey);
  const [year, monthNumber] = todayKey.split('-').map(Number);
  const daysInMonth = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();

  const [rates, monthlyBudget] = await Promise.all([loadCostRates(), loadMonthlyBudget()]);

  const [
    devices,
    runtimeRows,
    todaySessions,
    monthUsageRows,
    monthCostRows,
    ttftRows,
    recentSummaries,
    recentTaps,
    recentGames,
    alertEvents,
    todayAttempts,
  ] = await Promise.all([
    prisma.ai_device.findMany(),
    prisma.device_runtime_state.findMany(),
    prisma.analytics_game_sessions.findMany({
      where: { started_at: { gte: today.tsStart, lte: today.tsEnd } },
    }),
    prisma.device_usage_daily.findMany({
      where: { date: { gte: month.dateOnlyStart, lte: month.dateOnlyEnd } },
      select: { mac_address: true, date: true },
    }),
    prisma.device_token_usage_session.findMany({
      where: { usage_date: { gte: month.dateOnlyStart, lte: month.dateOnlyEnd } },
    }),
    prisma.device_token_usage_session.findMany({
      where: { usage_date: { gte: ttftWindow.dateOnlyStart, lte: ttftWindow.dateOnlyEnd } },
      select: { usage_date: true, avg_ttft_seconds: true },
    }),
    prisma.voice_session_summaries.findMany({
      where: { updated_at: { gte: today.tsStart, lte: today.tsEnd } },
      orderBy: { updated_at: 'desc' },
      take: 10,
    }),
    prisma.rfid_card_tap_log.findMany({
      where: { created_at: { gte: today.tsStart, lte: today.tsEnd } },
      orderBy: { created_at: 'desc' },
      take: 10,
    }),
    prisma.device_games_played.findMany({
      where: { activity_date: { gte: today.dateOnlyStart, lte: today.dateOnlyEnd } },
      orderBy: { played_at: 'desc' },
      take: 10,
    }),
    prisma.device_analytics_event.findMany({
      where: {
        OR: [
          { server_received_at: { gte: today.tsStart, lte: today.tsEnd } },
          { event_timestamp: { gte: today.tsStart, lte: today.tsEnd } },
        ],
        AND: [
          {
            OR: [
              { event_name: { contains: 'error', mode: 'insensitive' } },
              { event_name: { contains: 'fail', mode: 'insensitive' } },
              { event_name: { contains: 'shutdown', mode: 'insensitive' } },
              { event_name: { contains: 'battery', mode: 'insensitive' } },
            ],
          },
        ],
      },
      orderBy: { server_received_at: 'desc' },
      take: 10,
    }),
    prisma.analytics_game_attempts.findMany({
      where: { created_at: { gte: today.tsStart, lte: today.tsEnd } },
      select: { is_correct: true },
    }),
  ]);

  const kidNameByMac = await buildKidNameByMac(devices);
  const aliasByMac = new Map(devices.map((device) => [device.mac_address, device.alias || device.mac_address]));
  const labelFor = (mac) => kidNameByMac.get(mac) || aliasByMac.get(mac) || mac;

  const hourlySessions = summarizeHourlySessions(todaySessions);
  const busiest = hourlySessions.reduce((best, bucket) => (bucket.sessions > (best?.sessions || 0) ? bucket : best), null);

  const activeToday = new Set(
    monthUsageRows.filter((row) => toIsoDate(row.date) === todayKey).map((row) => row.mac_address),
  ).size;
  const activeThisWeek = new Set(
    monthUsageRows.filter((row) => {
      const key = toIsoDate(row.date);
      return key >= week.startKey && key <= week.endKey;
    }).map((row) => row.mac_address),
  ).size;
  const activeThisMonth = new Set(monthUsageRows.map((row) => row.mac_address)).size;

  const monthCostRaw = monthCostRows.reduce((sum, row) => sum + rawTotalCost(row, rates), 0);
  const dayOfMonth = Number(todayKey.slice(8, 10));

  // TTFT trend: a zero means "never measured", so it must not pull the mean down.
  const ttftByDate = new Map();
  ttftRows.forEach((row) => {
    const value = Number(row.avg_ttft_seconds || 0);
    if (value <= 0) return;
    const key = toIsoDate(row.usage_date);
    if (!key) return;
    if (!ttftByDate.has(key)) ttftByDate.set(key, { total: 0, count: 0 });
    const entry = ttftByDate.get(key);
    entry.total += value;
    entry.count += 1;
  });

  const feed = [
    ...recentSummaries.map((row) => ({
      kind: 'talk',
      macAddress: row.mac_address,
      label: labelFor(row.mac_address),
      detail: summarizeRecentConversation(row.summary).headline,
      at: row.updated_at,
    })),
    ...recentTaps.map((row) => ({
      kind: 'card',
      macAddress: row.mac_address,
      label: labelFor(row.mac_address),
      detail: row.content_pack_name ? `tapped ${row.content_pack_name}` : 'tapped an unmapped card',
      at: row.created_at,
    })),
    ...recentGames.map((row) => ({
      kind: 'game',
      macAddress: row.mac_address,
      label: labelFor(row.mac_address),
      detail: `${prettyGameName(row.game_name || row.game_id)}${row.score !== null && row.score !== undefined ? ` · scored ${row.score}` : ''}`,
      at: row.played_at,
    })),
    ...alertEvents.map((row) => ({
      kind: 'alert',
      macAddress: row.mac_address,
      label: labelFor(row.mac_address),
      detail: `${row.event_name}${row.battery_percentage !== null && row.battery_percentage !== undefined ? ` · battery ${row.battery_percentage}%` : ''}`,
      at: row.server_received_at || row.event_timestamp,
    })),
  ]
    .filter((item) => item.at)
    .sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime())
    .slice(0, 12);

  const answeredAttempts = todayAttempts.filter((row) => row.is_correct !== null && row.is_correct !== undefined);
  const sessionDurations = todaySessions.filter((row) => Number(row.duration_seconds || 0) > 0);
  const completedSessions = todaySessions.filter(
    (row) => String(row.completion_status || '').toLowerCase() === 'completed',
  ).length;
  const todayTtft = monthCostRows.filter(
    (row) => toIsoDate(row.usage_date) === todayKey && Number(row.avg_ttft_seconds || 0) > 0,
  );

  return {
    generatedAt: new Date().toISOString(),
    kpis: {
      onlineNow: runtimeRows.filter((row) => row.online).length,
      fleetSize: devices.length,
      peakSessionsHour: busiest && busiest.sessions > 0 ? busiest : null,
      activeToday,
      activeThisWeek,
      activeThisMonth,
      dauMauRatio: activeThisMonth ? round((activeToday / activeThisMonth) * 100, 0) : null,
    },
    sections: {
      liveToys: runtimeRows
        .filter((row) => row.online)
        .sort((a, b) => new Date(b.last_seen_at || 0).getTime() - new Date(a.last_seen_at || 0).getTime())
        .slice(0, 8)
        .map((row) => ({
          macAddress: row.mac_address,
          alias: aliasByMac.get(row.mac_address) || row.mac_address,
          kidName: kidNameByMac.get(row.mac_address) || null,
          battery: row.battery ?? null,
          firmware: row.firmware || null,
          mode: row.mode || null,
          lastSeenAt: row.last_seen_at || null,
        })),
      spend: {
        monthToDate: round(monthCostRaw, 2),
        monthlyBudget,
        budgetUsedPercent: monthlyBudget ? round((monthCostRaw / monthlyBudget) * 100, 0) : null,
        projectedMonth: round((monthCostRaw / Math.max(dayOfMonth, 1)) * daysInMonth, 0),
        dayOfMonth,
        daysInMonth,
      },
      hourlySessions,
      ttftTrend: ttftWindow.dayKeys.map((date) => {
        const entry = ttftByDate.get(date);
        return { date, seconds: entry ? round(entry.total / entry.count, 2) : null };
      }),
      feed,
      sessionQuality: {
        answerAccuracy: answeredAttempts.length
          ? round((answeredAttempts.filter((row) => row.is_correct).length / answeredAttempts.length) * 100, 0)
          : null,
        avgSessionMinutes: sessionDurations.length
          ? round(sessionDurations.reduce((sum, row) => sum + Number(row.duration_seconds || 0), 0) / 60 / sessionDurations.length, 1)
          : null,
        avgTtftSeconds: todayTtft.length
          ? round(todayTtft.reduce((sum, row) => sum + Number(row.avg_ttft_seconds || 0), 0) / todayTtft.length, 2)
          : null,
        completedSessionsPercent: todaySessions.length
          ? round((completedSessions / todaySessions.length) * 100, 0)
          : null,
        sessionsCounted: todaySessions.length,
        attemptsCounted: answeredAttempts.length,
      },
    },
  };
}

/* ================================================================== *
 * The Daily Brief — yesterday, written from the same aggregates.
 * "Three things to know" are derived from measured week-over-week
 * movement; when nothing clears the bar the list comes back empty
 * rather than padded with filler.
 * ================================================================== */

async function getFounderBrief() {
  const todayKey = todayIstKey();
  const coverKey = shiftDayKey(todayKey, -1);
  const cover = boundsFromKeys(coverKey, coverKey);
  const priorDayKey = shiftDayKey(coverKey, -1);
  const priorDay = boundsFromKeys(priorDayKey, priorDayKey);

  const thisWeek = boundsFromKeys(shiftDayKey(coverKey, -6), coverKey);
  const lastWeek = boundsFromKeys(shiftDayKey(coverKey, -13), shiftDayKey(coverKey, -7));
  const trend = boundsFromKeys(shiftDayKey(coverKey, -29), coverKey);

  const rates = await loadCostRates();

  const [
    coverUsage,
    priorUsage,
    coverSessions,
    priorSessions,
    coverCost,
    trendUsage,
    thisWeekTaps,
    lastWeekTaps,
    thisWeekSessions,
    thisWeekUsage,
    lastWeekUsage,
    quotes,
  ] = await Promise.all([
    prisma.device_usage_daily.findMany({ where: { date: { gte: cover.dateOnlyStart, lte: cover.dateOnlyEnd } } }),
    prisma.device_usage_daily.findMany({ where: { date: { gte: priorDay.dateOnlyStart, lte: priorDay.dateOnlyEnd } } }),
    prisma.analytics_game_sessions.findMany({ where: { started_at: { gte: cover.tsStart, lte: cover.tsEnd } } }),
    prisma.analytics_game_sessions.findMany({ where: { started_at: { gte: priorDay.tsStart, lte: priorDay.tsEnd } } }),
    prisma.device_token_usage_session.findMany({ where: { usage_date: { gte: cover.dateOnlyStart, lte: cover.dateOnlyEnd } } }),
    prisma.device_usage_daily.findMany({
      where: { date: { gte: trend.dateOnlyStart, lte: trend.dateOnlyEnd } },
      orderBy: { date: 'asc' },
    }),
    prisma.rfid_card_tap_log.findMany({ where: { created_at: { gte: thisWeek.tsStart, lte: thisWeek.tsEnd } } }),
    prisma.rfid_card_tap_log.findMany({ where: { created_at: { gte: lastWeek.tsStart, lte: lastWeek.tsEnd } } }),
    prisma.analytics_game_sessions.findMany({ where: { started_at: { gte: thisWeek.tsStart, lte: thisWeek.tsEnd } } }),
    prisma.device_usage_daily.findMany({ where: { date: { gte: thisWeek.dateOnlyStart, lte: thisWeek.dateOnlyEnd } } }),
    prisma.device_usage_daily.findMany({ where: { date: { gte: lastWeek.dateOnlyStart, lte: lastWeek.dateOnlyEnd } } }),
    prisma.voice_session_summaries.findMany({
      where: { updated_at: { gte: cover.tsStart, lte: cover.tsEnd } },
      orderBy: { updated_at: 'desc' },
      take: 2,
    }),
  ]);

  const sumUsage = (rows) => rows.reduce((sum, row) => sum + Number(row.usage_time_seconds || 0), 0);
  const activeOf = (rows) => new Set(rows.map((row) => row.mac_address)).size;

  const coverPlaySeconds = sumUsage(coverUsage);
  const priorPlaySeconds = sumUsage(priorUsage);
  const pctChange = (current, previous) =>
    previous > 0 ? round(((current - previous) / previous) * 100, 0) : null;

  // --- week-over-week pack movement -------------------------------
  const tapsByPack = (rows) => {
    const counts = new Map();
    rows.forEach((row) => {
      if (!row.content_pack_name) return;
      counts.set(row.content_pack_name, (counts.get(row.content_pack_name) || 0) + 1);
    });
    return counts;
  };
  const thisPacks = tapsByPack(thisWeekTaps);
  const lastPacks = tapsByPack(lastWeekTaps);

  const packMovers = Array.from(thisPacks.entries())
    .map(([name, taps]) => {
      const previous = lastPacks.get(name) || 0;
      return { name, taps, previous, changePercent: pctChange(taps, previous) };
    })
    .filter((item) => item.changePercent !== null)
    .sort((a, b) => Math.abs(b.changePercent) - Math.abs(a.changePercent));

  // --- completion by game this week --------------------------------
  const sessionsByGame = new Map();
  thisWeekSessions.forEach((row) => {
    const key = gameKey(row.mode_type);
    if (!key) return;
    if (!sessionsByGame.has(key)) sessionsByGame.set(key, { name: prettyGameName(row.mode_type), total: 0, completed: 0 });
    const item = sessionsByGame.get(key);
    item.total += 1;
    if (String(row.completion_status || '').toLowerCase() === 'completed') item.completed += 1;
  });
  const weakestGame = Array.from(sessionsByGame.values())
    .filter((item) => item.total >= 5)
    .map((item) => ({ ...item, completionRate: round((item.completed / item.total) * 100, 0) }))
    .sort((a, b) => a.completionRate - b.completionRate)[0] || null;

  // --- feature minutes week over week ------------------------------
  const featureMinutes = (rows) => ({
    aiTalk: rows.reduce((sum, row) => sum + Number(row.ai_talk_usage_seconds || 0), 0) / 60,
    card: rows.reduce((sum, row) => sum + Number(row.card_usage_seconds || 0), 0) / 60,
    game: rows.reduce((sum, row) => sum + Number(row.game_usage_seconds || 0), 0) / 60,
    radio: rows.reduce((sum, row) => sum + Number(row.radio_usage_seconds || 0), 0) / 60,
  });
  const thisFeatures = featureMinutes(thisWeekUsage);
  const lastFeatures = featureMinutes(lastWeekUsage);
  const featureLabels = { aiTalk: 'AI talk', card: 'Card packs', game: 'Games', radio: 'Radio' };

  const featureMovers = Object.keys(featureLabels)
    .map((key) => ({
      label: `${featureLabels[key]} minutes`,
      changePercent: pctChange(thisFeatures[key], lastFeatures[key]),
    }))
    .filter((item) => item.changePercent !== null && item.changePercent !== 0);

  // --- quiet toys (had usage in the last 60 days, none in the last 7)
  const quietSince = shiftDayKey(coverKey, -6);
  const historyStart = shiftDayKey(coverKey, -59);
  const historyRows = await prisma.device_usage_daily.findMany({
    where: {
      date: {
        gte: new Date(`${historyStart}T00:00:00Z`),
        lte: cover.dateOnlyEnd,
      },
    },
    select: { mac_address: true, date: true },
  });
  const lastUsageByMac = new Map();
  historyRows.forEach((row) => {
    const key = toIsoDate(row.date);
    if (!key) return;
    const existing = lastUsageByMac.get(row.mac_address);
    if (!existing || key > existing) lastUsageByMac.set(row.mac_address, key);
  });
  const quietCount = Array.from(lastUsageByMac.values()).filter((key) => key < quietSince).length;

  // --- three things to know (only measured movements) --------------
  const threeThings = [];
  const risingPack = packMovers.find((item) => item.changePercent > 0);
  if (risingPack) {
    threeThings.push({
      title: `${risingPack.name} is climbing`,
      detail: `${risingPack.taps} taps this week, up ${risingPack.changePercent}% on the ${risingPack.previous} it saw last week.`,
    });
  }
  if (weakestGame && weakestGame.completionRate < 70) {
    threeThings.push({
      title: `${weakestGame.name} is losing kids mid-game`,
      detail: `${weakestGame.completionRate}% of ${weakestGame.total} sessions finished this week.`,
    });
  }
  if (quietCount > 0) {
    threeThings.push({
      title: `${quietCount} ${quietCount === 1 ? 'toy has' : 'toys have'} gone quiet`,
      detail: 'Previously active in the last 60 days, but nothing in the last 7.',
    });
  }
  const fallingPack = packMovers.find((item) => item.changePercent < 0);
  if (threeThings.length < 3 && fallingPack) {
    threeThings.push({
      title: `${fallingPack.name} is cooling off`,
      detail: `${fallingPack.taps} taps this week, down ${Math.abs(fallingPack.changePercent)}% on last week.`,
    });
  }

  const usageByDate = aggregateUsageByDate(trendUsage, trend.dayKeys);

  return {
    generatedAt: new Date().toISOString(),
    coverDate: coverKey,
    headline: {
      activeToys: activeOf(coverUsage),
      playHours: round(coverPlaySeconds / 3600, 1),
      sessions: coverSessions.length,
      costInr: round(coverCost.reduce((sum, row) => sum + rawTotalCost(row, rates), 0), 2),
    },
    deltas: {
      activeToys: pctChange(activeOf(coverUsage), activeOf(priorUsage)),
      playHours: pctChange(coverPlaySeconds, priorPlaySeconds),
      sessions: pctChange(coverSessions.length, priorSessions.length),
    },
    threeThings: threeThings.slice(0, 3),
    playHoursSeries: usageByDate.map((row) => ({ date: row.date, hours: round(row.usageSeconds / 3600, 1) })),
    quotes: quotes.map((row) => ({
      summary: row.summary,
      macAddress: row.mac_address,
      updatedAt: row.updated_at,
    })),
    movers: [
      ...packMovers.slice(0, 3).map((item) => ({
        label: `${item.name} · card taps`,
        changePercent: item.changePercent,
      })),
      ...featureMovers.slice(0, 3),
    ].sort((a, b) => Math.abs(b.changePercent) - Math.abs(a.changePercent)).slice(0, 5),
  };
}

module.exports = {
  getFounderOverview,
  getFounderLive,
  getFounderBrief,
  getFounderEngagement,
  getFounderContent,
  getFounderConversations,
  getConversationTranscript,
  getFounderCosts,
  getFounderOperate,
  searchFamilies,
  listAllFamilies,
  getFamilyProfile,
};
