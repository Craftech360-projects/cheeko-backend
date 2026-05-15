const { prisma } = require('../config/database');
const { normalizeMacAddress } = require('../utils/helpers');
const logger = require('../utils/logger');

const DEFAULT_RANGE_DAYS = 30;
const MAX_QUERY_LIMIT = 5000;

function normalizeRequiredMac(macAddress) {
  const normalized = normalizeMacAddress(macAddress);
  if (!normalized) {
    throw new Error('Invalid mac_address format');
  }
  return normalized;
}

function parseDateOrNull(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function parseFirmwareTimestampOrNull(value) {
  if (value == null) return null;
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return null;
  const millis = numeric > 1_000_000_000_000 ? numeric : numeric * 1000;
  const parsed = new Date(millis);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function parseIntOrNull(value) {
  if (value == null) return null;
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return null;
  return Math.trunc(numeric);
}

function safeObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function resolveTimeRange({ from = null, to = null, days = DEFAULT_RANGE_DAYS } = {}) {
  const now = new Date();
  const end = parseDateOrNull(to) || now;
  const start = parseDateOrNull(from) || new Date(end.getTime() - (days * 24 * 60 * 60 * 1000));
  return { start, end };
}

function eventTime(row) {
  return row.event_timestamp || row.server_received_at || null;
}

function dateKeyUtc(dateValue) {
  if (!dateValue) return null;
  return new Date(dateValue).toISOString().slice(0, 10);
}

function classifyDurationType(row) {
  if (row.event_name === 'ai_talk_end') return 'ai_talk';
  if (row.event_name === 'radio_end') return 'radio';
  if (row.event_name === 'game_end') return 'game';
  if (row.event_name === 'card_session_end') {
    const source = `${row.content_type || ''} ${row.reason || ''}`.toLowerCase();
    if (source.includes('story')) return 'story';
    if (source.includes('rhyme') || source.includes('music')) return 'rhyme';
    return 'other';
  }
  return 'other';
}

function selectEventFields() {
  return {
    id: true,
    device_id: true,
    event_id: true,
    mac_address: true,
    sender_client_id: true,
    board: true,
    firmware: true,
    build_label: true,
    seq: true,
    uptime_ms: true,
    event_name: true,
    event_timestamp: true,
    server_received_at: true,
    battery: true,
    battery_percentage: true,
    charging: true,
    discharging: true,
    duration_ms: true,
    rfid_uid: true,
    content_id: true,
    content_type: true,
    game_id: true,
    score: true,
    reason: true,
    station: true,
    station_index: true,
    data: true,
    raw_payload: true,
  };
}

async function fetchEventsByMac(mac, { from = null, to = null, limit = MAX_QUERY_LIMIT } = {}) {
  const { start, end } = resolveTimeRange({ from, to });
  const safeLimit = Math.max(1, Math.min(MAX_QUERY_LIMIT, Number(limit) || MAX_QUERY_LIMIT));
  return prisma.device_analytics_event.findMany({
    where: {
      mac_address: mac,
      server_received_at: {
        gte: start,
        lte: end,
      },
    },
    select: selectEventFields(),
    orderBy: { server_received_at: 'asc' },
    take: safeLimit,
  });
}

async function ingestFirmwareAnalyticsEvent({ mac_address, sender_client_id = null, device_id = null, payload = {} }) {
  const mac = normalizeRequiredMac(mac_address);
  const incoming = safeObject(payload);
  if (incoming.type !== 'analytics_event') {
    throw new Error('payload.type must be analytics_event');
  }
  if (!incoming.event_id) {
    throw new Error('payload.event_id is required');
  }
  if (!incoming.event) {
    throw new Error('payload.event is required');
  }

  const stableDeviceId = (incoming.device_id || device_id || '').toString().trim();
  if (!stableDeviceId) {
    throw new Error('device_id is required');
  }

  const data = safeObject(incoming.data);
  const timestamp = parseFirmwareTimestampOrNull(incoming.timestamp);
  const battery = parseIntOrNull(incoming.battery);
  const batteryPercentage = parseIntOrNull(incoming.battery_percentage);

  const row = {
    device_id: stableDeviceId,
    event_id: String(incoming.event_id),
    mac_address: mac,
    sender_client_id: sender_client_id || null,
    board: incoming.board || null,
    firmware: incoming.firmware || null,
    build_label: incoming.build_label || null,
    seq: parseIntOrNull(incoming.seq),
    uptime_ms: parseIntOrNull(incoming.uptime_ms),
    event_name: String(incoming.event),
    event_timestamp: timestamp,
    battery,
    battery_percentage: batteryPercentage,
    charging: typeof incoming.charging === 'boolean' ? incoming.charging : null,
    discharging: typeof incoming.discharging === 'boolean' ? incoming.discharging : null,
    duration_ms: parseIntOrNull(data.duration_ms),
    rfid_uid: data.rfid_uid ? String(data.rfid_uid) : null,
    content_id: data.content_id ? String(data.content_id) : null,
    content_type: data.content_type ? String(data.content_type) : null,
    game_id: data.game_id ? String(data.game_id) : null,
    score: parseIntOrNull(data.score),
    reason: data.reason ? String(data.reason) : null,
    station: data.station ? String(data.station) : null,
    station_index: parseIntOrNull(data.station_index),
    data,
    raw_payload: incoming,
  };

  try {
    const created = await prisma.device_analytics_event.create({ data: row });
    logger.info(`[ANALYTICS][INGEST] stored mac=${mac} device_id=${stableDeviceId} event_id=${row.event_id} event=${row.event_name}`);
    return {
      accepted: true,
      deduplicated: false,
      stored_event_id: created.id,
    };
  } catch (error) {
    if (error?.code === 'P2002') {
      logger.info(`[ANALYTICS][INGEST] duplicate mac=${mac} device_id=${stableDeviceId} event_id=${row.event_id}`);
      return {
        accepted: true,
        deduplicated: true,
        stored_event_id: null,
      };
    }
    throw error;
  }
}

async function getAnalyticsOverviewByMac(macAddress, opts = {}) {
  const mac = normalizeRequiredMac(macAddress);
  const events = await fetchEventsByMac(mac, opts);

  let totalUsageMs = 0;
  let cardTapCount = 0;
  let aiTalkSessionCount = 0;
  let aiTalkDurationMs = 0;
  let gameLaunchCount = 0;
  let gameDurationMs = 0;
  const scores = [];
  const minutesByTypeMs = {
    rhyme: 0,
    story: 0,
    ai_talk: 0,
    radio: 0,
    game: 0,
    other: 0,
  };

  for (const row of events) {
    if (row.event_name === 'card_session_start') {
      cardTapCount += 1;
    }
    if (row.event_name === 'ai_talk_start') {
      aiTalkSessionCount += 1;
    }
    if (row.event_name === 'game_start') {
      gameLaunchCount += 1;
    }
    if (row.event_name === 'game_end' && Number.isFinite(Number(row.score))) {
      scores.push({
        value: Number(row.score),
        at: eventTime(row),
        gameId: row.game_id,
      });
    }

    const durationMs = parseIntOrNull(row.duration_ms);
    if (durationMs == null || durationMs <= 0) {
      continue;
    }

    totalUsageMs += durationMs;
    const bucket = classifyDurationType(row);
    minutesByTypeMs[bucket] = (minutesByTypeMs[bucket] || 0) + durationMs;

    if (row.event_name === 'ai_talk_end') {
      aiTalkDurationMs += durationMs;
    }
    if (row.event_name === 'game_end') {
      gameDurationMs += durationMs;
    }
  }

  scores.sort((a, b) => new Date(b.at || 0).getTime() - new Date(a.at || 0).getTime());
  const latestScores = scores.slice(0, 20);
  const scoreValues = latestScores.map((item) => item.value);
  const averageScore = scoreValues.length > 0
    ? Math.round(scoreValues.reduce((sum, value) => sum + value, 0) / scoreValues.length)
    : 0;

  return {
    macAddress: mac,
    totalUsageMs,
    totalUsageMinutes: Math.round(totalUsageMs / 60000),
    cardTapCount,
    minutesByType: {
      rhyme: Math.round(minutesByTypeMs.rhyme / 60000),
      story: Math.round(minutesByTypeMs.story / 60000),
      ai_talk: Math.round(minutesByTypeMs.ai_talk / 60000),
      radio: Math.round(minutesByTypeMs.radio / 60000),
      game: Math.round(minutesByTypeMs.game / 60000),
      other: Math.round(minutesByTypeMs.other / 60000),
    },
    aiTalk: {
      sessionCount: aiTalkSessionCount,
      totalDurationMs: aiTalkDurationMs,
    },
    games: {
      launchCount: gameLaunchCount,
      totalDurationMs: gameDurationMs,
      averageScore,
      latestScores,
    },
  };
}

async function getAnalyticsTimeSeriesByMac(macAddress, opts = {}) {
  const mac = normalizeRequiredMac(macAddress);
  const events = await fetchEventsByMac(mac, opts);
  const byDate = new Map();

  for (const row of events) {
    const key = dateKeyUtc(eventTime(row) || row.server_received_at);
    if (!key) continue;

    if (!byDate.has(key)) {
      byDate.set(key, {
        date: key,
        totalUsageMs: 0,
        cardTapCount: 0,
        aiTalkDurationMs: 0,
        radioDurationMs: 0,
        gameDurationMs: 0,
        storyRhymeDurationMs: 0,
      });
    }

    const daily = byDate.get(key);
    if (row.event_name === 'card_session_start') {
      daily.cardTapCount += 1;
    }

    const durationMs = parseIntOrNull(row.duration_ms);
    if (durationMs == null || durationMs <= 0) continue;

    daily.totalUsageMs += durationMs;
    if (row.event_name === 'ai_talk_end') daily.aiTalkDurationMs += durationMs;
    if (row.event_name === 'radio_end') daily.radioDurationMs += durationMs;
    if (row.event_name === 'game_end') daily.gameDurationMs += durationMs;

    const bucket = classifyDurationType(row);
    if (bucket === 'story' || bucket === 'rhyme') {
      daily.storyRhymeDurationMs += durationMs;
    }
  }

  return Array.from(byDate.values()).sort((a, b) => a.date.localeCompare(b.date));
}

async function getRecentAnalyticsEventsByMac(macAddress, { limit = 100 } = {}) {
  const mac = normalizeRequiredMac(macAddress);
  const safeLimit = Math.max(1, Math.min(500, Number(limit) || 100));
  const rows = await prisma.device_analytics_event.findMany({
    where: { mac_address: mac },
    select: selectEventFields(),
    orderBy: { server_received_at: 'desc' },
    take: safeLimit,
  });

  return rows.map((row) => ({
    id: row.id,
    macAddress: row.mac_address,
    deviceId: row.device_id,
    eventId: row.event_id,
    event: row.event_name,
    timestamp: eventTime(row),
    seq: row.seq,
    firmware: row.firmware,
    buildLabel: row.build_label,
    battery: row.battery_percentage ?? row.battery ?? null,
    charging: row.charging,
    discharging: row.discharging,
    durationMs: row.duration_ms,
    contentType: row.content_type,
    contentId: row.content_id,
    rfidUid: row.rfid_uid,
    gameId: row.game_id,
    score: row.score,
    reason: row.reason,
    station: row.station,
    stationIndex: row.station_index,
    data: row.data,
  }));
}

async function getBatteryTrendByMac(macAddress, opts = {}) {
  const mac = normalizeRequiredMac(macAddress);
  const events = await fetchEventsByMac(mac, opts);
  const trend = events
    .filter((row) => row.battery_percentage != null || row.battery != null)
    .map((row) => ({
      at: eventTime(row),
      battery: row.battery_percentage ?? row.battery,
      charging: row.charging,
      discharging: row.discharging,
      firmware: row.firmware,
      buildLabel: row.build_label,
      event: row.event_name,
      reason: row.reason,
    }));

  const latest = trend.length > 0 ? trend[trend.length - 1] : null;
  const lowBatteryEvents = trend.filter((point) => Number(point.battery) <= 20);
  return {
    macAddress: mac,
    latest,
    trend,
    lowBatteryEvents,
  };
}

module.exports = {
  ingestFirmwareAnalyticsEvent,
  getAnalyticsOverviewByMac,
  getAnalyticsTimeSeriesByMac,
  getRecentAnalyticsEventsByMac,
  getBatteryTrendByMac,
};
