const { prisma } = require('../config/database');
const { normalizeMacAddress } = require('../utils/helpers');
const logger = require('../utils/logger');
const crypto = require('crypto');

const DEFAULT_RANGE_DAYS = 30;
const MAX_QUERY_LIMIT = 5000;
const USAGE_DURATION_EVENTS = new Set(['game_end', 'card_session_end', 'radio_end', 'ai_talk_end']);
const EVENT_DURATION_BUCKET = {
  game_end: 'game_usage_seconds',
  card_session_end: 'card_usage_seconds',
  radio_end: 'radio_usage_seconds',
  ai_talk_end: 'ai_talk_usage_seconds',
};

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

function formatDateInTimezone(value, timezone = 'UTC') {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone || 'UTC',
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

function toDateOnlyValue(dateString) {
  if (!dateString) return null;
  return new Date(`${dateString}T00:00:00.000Z`);
}

function extractStringValue(primary, fallback) {
  if (primary == null || primary === '') return fallback == null || fallback === '' ? null : String(fallback);
  return String(primary);
}

function buildCollisionSafeEventId(baseEventId, row) {
  const digestInput = [
    baseEventId || '',
    row.device_id || '',
    row.event_name || '',
    row.seq == null ? '' : String(row.seq),
    row.event_timestamp ? String(new Date(row.event_timestamp).getTime()) : '',
    row.duration_ms == null ? '' : String(row.duration_ms),
    row.rfid_uid || '',
    row.content_id || '',
    row.content_type || '',
    row.game_id || '',
    row.station || '',
    row.reason || '',
  ].join('|');

  const hashSuffix = crypto.createHash('sha1').update(digestInput).digest('hex').slice(0, 12);
  const maxBaseLength = 120 - 2 - hashSuffix.length;
  const trimmedBase = String(baseEventId || 'evt').slice(0, Math.max(1, maxBaseLength));
  return `${trimmedBase}::${hashSuffix}`;
}

async function createAnalyticsEventRowWithCollisionHandling(row) {
  const existingBase = await prisma.device_analytics_event.findFirst({
    where: {
      device_id: row.device_id,
      event_id: row.event_id,
    },
    select: { id: true },
  });

  if (!existingBase) {
    try {
      const created = await prisma.device_analytics_event.create({ data: row });
      return {
        created,
        deduplicated: false,
        collisionHandled: false,
        originalEventId: row.event_id,
        storedEventId: row.event_id,
      };
    } catch (error) {
      if (error?.code !== 'P2002') throw error;
    }
  }

  const collisionEventId = buildCollisionSafeEventId(row.event_id, row);
  const collisionRow = {
    ...row,
    event_id: collisionEventId,
  };
  const existingCollision = await prisma.device_analytics_event.findFirst({
    where: {
      device_id: row.device_id,
      event_id: collisionEventId,
    },
    select: { id: true },
  });
  if (existingCollision) {
    return {
      created: null,
      deduplicated: true,
      collisionHandled: true,
      originalEventId: row.event_id,
      storedEventId: collisionEventId,
    };
  }

  try {
    const created = await prisma.device_analytics_event.create({ data: collisionRow });
    logger.warn(`[ANALYTICS][INGEST] event_id collision resolved device_id=${row.device_id} original_event_id=${row.event_id} stored_event_id=${collisionEventId}`);
    return {
      created,
      deduplicated: false,
      collisionHandled: true,
      originalEventId: row.event_id,
      storedEventId: collisionEventId,
    };
  } catch (error) {
    if (error?.code === 'P2002') {
      return {
        created: null,
        deduplicated: true,
        collisionHandled: true,
        originalEventId: row.event_id,
        storedEventId: collisionEventId,
      };
    }
    throw error;
  }
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

async function resolveProjectionContext(macAddress) {
  const device = await prisma.ai_device.findUnique({
    where: { mac_address: macAddress },
    select: { id: true, user_id: true },
  });

  let timezone = 'UTC';
  if (device?.user_id != null) {
    const profile = await prisma.parent_profile.findUnique({
      where: { user_id: device.user_id },
      select: { timezone: true },
    });
    timezone = profile?.timezone || 'UTC';
  }

  return {
    userId: device?.user_id || null,
    ownerDeviceId: device?.id || null,
    timezone,
  };
}

async function applyProjectionForEvent(rawEventRow) {
  const data = safeObject(rawEventRow.data);
  const eventName = rawEventRow.event_name;
  const eventInstant = eventTime(rawEventRow) || new Date();
  const { userId, ownerDeviceId, timezone } = await resolveProjectionContext(rawEventRow.mac_address);
  const activityDateKey = formatDateInTimezone(eventInstant, timezone) || dateKeyUtc(eventInstant);
  const activityDate = toDateOnlyValue(activityDateKey);
  if (!activityDate) return;

  const durationMs = parseIntOrNull(rawEventRow.duration_ms);
  const durationSeconds = durationMs != null && durationMs > 0 ? Math.floor(durationMs / 1000) : 0;
  const usageBucket = EVENT_DURATION_BUCKET[eventName] || null;

  const dailyBase = {
    user_id: userId,
    device_id: ownerDeviceId,
    mac_address: rawEventRow.mac_address,
    date: activityDate,
  };

  if (eventName === 'card_session_start') {
    await prisma.device_card_taps_daily.upsert({
      where: {
        date_mac_address: {
          date: activityDate,
          mac_address: rawEventRow.mac_address,
        },
      },
      create: {
        ...dailyBase,
        card_tap_count: 1,
      },
      update: {
        card_tap_count: { increment: 1 },
        updated_at: new Date(),
        user_id: userId,
        device_id: ownerDeviceId,
      },
    });
  }

  if (eventName === 'ai_talk_start') {
    await prisma.device_ai_interactions_daily.upsert({
      where: {
        date_mac_address: {
          date: activityDate,
          mac_address: rawEventRow.mac_address,
        },
      },
      create: {
        ...dailyBase,
        ai_interaction_count: 1,
      },
      update: {
        ai_interaction_count: { increment: 1 },
        updated_at: new Date(),
        user_id: userId,
        device_id: ownerDeviceId,
      },
    });
  }

  if (USAGE_DURATION_EVENTS.has(eventName) && durationSeconds > 0) {
    const usageUpdate = {
      usage_time_seconds: { increment: durationSeconds },
      updated_at: new Date(),
      user_id: userId,
      device_id: ownerDeviceId,
    };
    if (usageBucket) {
      usageUpdate[usageBucket] = { increment: durationSeconds };
    }

    const usageCreate = {
      ...dailyBase,
      usage_time_seconds: durationSeconds,
    };
    if (usageBucket) {
      usageCreate[usageBucket] = durationSeconds;
    }

    await prisma.device_usage_daily.upsert({
      where: {
        date_mac_address: {
          date: activityDate,
          mac_address: rawEventRow.mac_address,
        },
      },
      create: usageCreate,
      update: usageUpdate,
    });
  }

  if (eventName === 'game_end') {
    await prisma.device_games_played.upsert({
      where: { source_device_event_pk: rawEventRow.id },
      create: {
        user_id: userId,
        device_id: ownerDeviceId,
        mac_address: rawEventRow.mac_address,
        activity_date: activityDate,
        game_id: extractStringValue(rawEventRow.game_id, data.game_id),
        game_name: extractStringValue(data.game_name, data.mode_name),
        level: extractStringValue(data.level, data.stage),
        difficulty_level: extractStringValue(data.difficulty_level, data.difficulty),
        score: rawEventRow.score ?? parseIntOrNull(data.score),
        duration_ms: durationMs,
        played_at: eventInstant,
        source_device_event_pk: rawEventRow.id,
        source_event_id: rawEventRow.event_id,
      },
      update: {
        user_id: userId,
        device_id: ownerDeviceId,
      },
    });
  }

  if (eventName === 'radio_end') {
    await prisma.device_radio_played.upsert({
      where: { source_device_event_pk: rawEventRow.id },
      create: {
        user_id: userId,
        device_id: ownerDeviceId,
        mac_address: rawEventRow.mac_address,
        activity_date: activityDate,
        station: extractStringValue(rawEventRow.station, data.station),
        duration_ms: durationMs,
        played_at: eventInstant,
        source_device_event_pk: rawEventRow.id,
        source_event_id: rawEventRow.event_id,
      },
      update: {
        user_id: userId,
        device_id: ownerDeviceId,
      },
    });
  }
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
    duration_ms: parseIntOrNull(data.duration_ms ?? incoming.duration_ms),
    rfid_uid: data.rfid_uid ? String(data.rfid_uid) : null,
    content_id: data.content_id ? String(data.content_id) : null,
    content_type: data.content_type ? String(data.content_type) : null,
    game_id: extractStringValue(incoming.game_id, data.game_id),
    score: parseIntOrNull(data.score ?? incoming.score),
    reason: extractStringValue(incoming.reason, data.reason),
    station: extractStringValue(incoming.station, data.station),
    station_index: parseIntOrNull(data.station_index ?? incoming.station_index),
    data,
    raw_payload: incoming,
  };

  try {
    const writeResult = await createAnalyticsEventRowWithCollisionHandling(row);
    if (writeResult.deduplicated) {
      logger.info(`[ANALYTICS][INGEST] duplicate mac=${mac} device_id=${stableDeviceId} event_id=${row.event_id}`);
      return {
        accepted: true,
        deduplicated: true,
        stored_event_id: null,
        stored_event_key: writeResult.storedEventId || null,
        original_event_id: writeResult.originalEventId || row.event_id,
      };
    }

    const created = writeResult.created;
    let projectionFailed = false;
    try {
      await applyProjectionForEvent(created);
    } catch (projectionError) {
      projectionFailed = true;
      logger.error(`[ANALYTICS][PROJECTION] failed raw_event_id=${created.id} mac=${mac} event=${row.event_name}: ${projectionError.message}`);
    }
    logger.info(`[ANALYTICS][INGEST] stored mac=${mac} device_id=${stableDeviceId} event_id=${row.event_id} event=${row.event_name}`);
    return {
      accepted: true,
      deduplicated: false,
      stored_event_id: created.id,
      stored_event_key: writeResult.storedEventId || row.event_id,
      original_event_id: writeResult.originalEventId || row.event_id,
      event_id_collision_handled: writeResult.collisionHandled === true,
      projection_failed: projectionFailed,
    };
  } catch (error) {
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
