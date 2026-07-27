'use strict';

const { prisma } = require('../config/database');
const { normalizeMacAddress } = require('../utils/helpers');

const IST_TIMEZONE = 'Asia/Kolkata';
const COST_RATES = {
  inputText: 46 / 1000000,
  inputAudio: 276 / 1000000,
  outputText: 184 / 1000000,
  outputAudio: 1104 / 1000000,
};

function toIsoDate(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: IST_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

function formatDateLabel(value) {
  return toIsoDate(value);
}

function getRangeDays(range) {
  if (range === 'today') return 1;
  if (range === '90d') return 90;
  if (range === 'month') return 30;
  if (range === '30d') return 30;
  return 7;
}

function buildDateRange(range) {
  const days = getRangeDays(range);
  const end = new Date();
  end.setHours(23, 59, 59, 999);
  const start = new Date(end);
  start.setDate(end.getDate() - (days - 1));
  start.setHours(0, 0, 0, 0);
  return { start, end, days };
}

function buildDateKeys(start, end) {
  const keys = [];
  const cursor = new Date(start);
  cursor.setHours(0, 0, 0, 0);
  const endDate = new Date(end);
  endDate.setHours(0, 0, 0, 0);

  while (cursor <= endDate) {
    keys.push(toIsoDate(cursor));
    cursor.setDate(cursor.getDate() + 1);
  }

  return keys;
}

function round(value, digits = 2) {
  const factor = 10 ** digits;
  return Math.round((Number(value) || 0) * factor) / factor;
}

function buildEmptySeries(rows, mapper) {
  return rows.map((row) => mapper(row));
}

function calculateCost(record) {
  return round(
    (Number(record.input_text_tokens || 0) * COST_RATES.inputText) +
      (Number(record.input_audio_tokens || 0) * COST_RATES.inputAudio) +
      (Number(record.output_text_tokens || 0) * COST_RATES.outputText) +
      (Number(record.output_audio_tokens || 0) * COST_RATES.outputAudio),
    2,
  );
}

function calculateInputCost(record) {
  return round(
    (Number(record.input_text_tokens || 0) * COST_RATES.inputText) +
      (Number(record.input_audio_tokens || 0) * COST_RATES.inputAudio),
    2,
  );
}

function calculateOutputCost(record) {
  return round(
    (Number(record.output_text_tokens || 0) * COST_RATES.outputText) +
      (Number(record.output_audio_tokens || 0) * COST_RATES.outputAudio),
    2,
  );
}

function extractTopics(summaries) {
  const stopWords = new Set([
    'about', 'asked', 'before', 'talked', 'their', 'there', 'would', 'could', 'while', 'morning',
    'night', 'bedtime', 'today', 'with', 'from', 'into', 'that', 'have', 'were', 'this', 'they',
  ]);
  const counts = new Map();

  summaries.forEach((entry) => {
    String(entry.summary || '')
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter((word) => word.length > 3 && !stopWords.has(word))
      .forEach((word) => {
        counts.set(word, (counts.get(word) || 0) + 1);
      });
  });

  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
    .map(([topic, mentions]) => ({ topic, mentions }));
}

function aggregateUsageByDate(usageRows) {
  const byDate = new Map();

  usageRows.forEach((row) => {
    const date = toIsoDate(row.date);
    if (!byDate.has(date)) {
      byDate.set(date, {
        date,
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
    if (row.mac_address) {
      target.macs.add(row.mac_address);
    }
  });

  return Array.from(byDate.values())
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((entry) => ({
      ...entry,
      activeDevices: entry.macs.size,
    }));
}

function aggregateSessionsByDate(sessionRows) {
  const byDate = new Map();

  sessionRows.forEach((row) => {
    const date = toIsoDate(row.started_at);
    if (!byDate.has(date)) {
      byDate.set(date, {
        date,
        total: 0,
        durationSeconds: 0,
        macs: new Set(),
      });
    }

    const target = byDate.get(date);
    target.total += 1;
    target.durationSeconds += Number(row.duration_seconds || 0);
    if (row.mac_address) {
      target.macs.add(row.mac_address);
    }
  });

  return Array.from(byDate.values())
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((entry) => ({
      date: entry.date,
      total: entry.total,
      durationSeconds: entry.durationSeconds,
      uniqueDevices: entry.macs.size,
    }));
}

function aggregateRegistrationsByDate(userRows) {
  const byDate = new Map();

  userRows.forEach((row) => {
    const date = toIsoDate(row.created_at);
    byDate.set(date, (byDate.get(date) || 0) + 1);
  });

  return Array.from(byDate.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([date, count]) => ({ date, count }));
}

function aggregateCostByDate(costRows) {
  const byDate = new Map();

  costRows.forEach((row) => {
    const date = toIsoDate(row.usage_date);
    const current = byDate.get(date) || { date, cost: 0, inputCost: 0, outputCost: 0 };
    current.inputCost = round(current.inputCost + calculateInputCost(row), 2);
    current.outputCost = round(current.outputCost + calculateOutputCost(row), 2);
    current.cost = round(current.inputCost + current.outputCost, 2);
    byDate.set(date, current);
  });

  return Array.from(byDate.values()).sort((a, b) => a.date.localeCompare(b.date));
}

function fillUsageSeries(dateKeys, usageByDate) {
  const usageMap = new Map(usageByDate.map((row) => [row.date, row]));
  return dateKeys.map((date) => ({
    date,
    usageSeconds: usageMap.get(date)?.usageSeconds || 0,
    aiTalkSeconds: usageMap.get(date)?.aiTalkSeconds || 0,
    cardSeconds: usageMap.get(date)?.cardSeconds || 0,
    gameSeconds: usageMap.get(date)?.gameSeconds || 0,
    radioSeconds: usageMap.get(date)?.radioSeconds || 0,
    activeDevices: usageMap.get(date)?.activeDevices || 0,
  }));
}

function summarizeCardLeaderboard(rows) {
  const packs = new Map();

  rows.forEach((row) => {
    const name = row.content_pack_name || 'Unresolved';
    if (!packs.has(name)) {
      packs.set(name, {
        name,
        taps: 0,
        devices: new Set(),
        cards: new Set(),
      });
    }

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
    .slice(0, 5);
}

function summarizeGames(rows) {
  const games = new Map();

  rows.forEach((row) => {
    const name = row.game_name || row.game_id || 'Unknown game';
    if (!games.has(name)) {
      games.set(name, {
        name,
        plays: 0,
        totalScore: 0,
        scoredPlays: 0,
        totalDurationMs: 0,
      });
    }

    const target = games.get(name);
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
      completionRate: null,
    }))
    .sort((a, b) => b.plays - a.plays)
    .slice(0, 5);
}

function buildSeriesFromMap(keys, map, valueKey = 'value') {
  return keys.map((key) => ({
    date: key,
    [valueKey]: map.get(key) || 0,
  }));
}

function movingAverage(values, windowSize = 7) {
  return values.map((_, index) => {
    const start = Math.max(0, index - (windowSize - 1));
    const slice = values.slice(start, index + 1);
    return round(slice.reduce((sum, item) => sum + item, 0) / Math.max(slice.length, 1), 1);
  });
}

function summarizeQuietDevices({ devices, usageRows, runtimeStates }) {
  const lastUsageByMac = new Map();
  usageRows.forEach((row) => {
    const current = lastUsageByMac.get(row.mac_address);
    const rowDate = new Date(row.date);
    if (!current || rowDate > current) {
      lastUsageByMac.set(row.mac_address, rowDate);
    }
  });

  return devices
    .map((device) => {
      const runtime = runtimeStates.get(device.mac_address);
      const lastUsage = lastUsageByMac.get(device.mac_address);
      const referenceDate = runtime?.last_seen_at || device.last_connected_at || null;
      const daysQuiet = lastUsage
        ? Math.max(0, Math.floor((Date.now() - new Date(lastUsage).getTime()) / 86400000))
        : (referenceDate ? Math.max(0, Math.floor((Date.now() - new Date(referenceDate).getTime()) / 86400000)) : null);

      return {
        macAddress: device.mac_address,
        alias: device.alias || device.mac_address,
        kidName: null,
        parentName: device.sys_user?.parent_profile?.display_name || null,
        quietDays: daysQuiet,
        lastSeenAt: runtime?.last_seen_at || device.last_connected_at || null,
      };
    })
    .filter((item) => item.quietDays !== null && item.quietDays >= 7)
    .sort((a, b) => b.quietDays - a.quietDays)
    .slice(0, 8);
}

function summarizeHourlySessions(sessionRows) {
  const buckets = Array.from({ length: 24 }, (_, hour) => ({
    hour,
    sessions: 0,
  }));

  sessionRows.forEach((row) => {
    const date = new Date(row.started_at);
    const hour = Number(new Intl.DateTimeFormat('en-US', {
      timeZone: IST_TIMEZONE,
      hour: 'numeric',
      hour12: false,
    }).format(date));
    buckets[hour].sessions += 1;
  });

  return buckets;
}

function summarizeSessionsHeatmap(sessionRows) {
  const dayLabels = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  const dayBuckets = dayLabels.map((day) => ({
    day,
    hours: Array.from({ length: 24 }, (_, hour) => ({
      hour,
      sessions: 0,
    })),
  }));

  sessionRows.forEach((row) => {
    const date = new Date(row.started_at);
    const weekdayLabel = new Intl.DateTimeFormat('en-US', {
      timeZone: IST_TIMEZONE,
      weekday: 'short',
    }).format(date);
    const hour = Number(new Intl.DateTimeFormat('en-US', {
      timeZone: IST_TIMEZONE,
      hour: 'numeric',
      hour12: false,
    }).format(date));

    const bucket = dayBuckets.find((item) => item.day === weekdayLabel);
    if (bucket && bucket.hours[hour]) {
      bucket.hours[hour].sessions += 1;
    }
  });

  return dayBuckets;
}

function summarizeRecentConversation(summary) {
  const text = String(summary || '').trim();
  if (!text) {
    return { headline: 'Conversation summary unavailable', tags: [] };
  }

  const headline = text.length > 88 ? `${text.slice(0, 85).trim()}...` : text;
  const tags = extractTopics([{ summary: text }]).slice(0, 3).map((item) => item.topic);
  return { headline, tags };
}

function getStatusFromCompletionRate(rate) {
  if (rate === null || rate === undefined) return 'No completion data';
  if (rate >= 85) return 'Loved';
  if (rate >= 70) return 'Healthy';
  if (rate >= 55) return 'Watch';
  return 'Needs attention';
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

function summarizeWatchlist(devices, runtimeStates, syncEvents, analyticsEvents) {
  const issues = [];
  const latestSyncFailureByMac = new Map();

  syncEvents.forEach((event) => {
    if ((event.status && /fail/i.test(event.status)) || (event.reason && /fail|timeout/i.test(event.reason))) {
      if (!latestSyncFailureByMac.has(event.mac_address)) {
        latestSyncFailureByMac.set(event.mac_address, event);
      }
    }
  });

  devices.forEach((device) => {
    const runtime = runtimeStates.get(device.mac_address);
    const failure = latestSyncFailureByMac.get(device.mac_address);
    const lowBatteryHits = analyticsEvents.filter(
      (event) => event.mac_address === device.mac_address && Number(event.battery_percentage ?? event.battery ?? 100) < 20,
    ).length;

    if (runtime?.battery !== null && runtime?.battery !== undefined && runtime.battery < 20) {
      issues.push({
        macAddress: device.mac_address,
        alias: device.alias || device.mac_address,
        issue: `battery ${runtime.battery}%`,
        severity: 'critical',
        since: runtime.last_seen_at || device.last_connected_at || null,
      });
    }

    if (lowBatteryHits >= 2) {
      issues.push({
        macAddress: device.mac_address,
        alias: device.alias || device.mac_address,
        issue: `${lowBatteryHits} low-battery events`,
        severity: 'warning',
        since: runtime?.last_seen_at || device.last_connected_at || null,
      });
    }

    if (failure) {
      issues.push({
        macAddress: device.mac_address,
        alias: device.alias || device.mac_address,
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

async function getFounderOverview({ range = '7d' } = {}) {
  const { start, end } = buildDateRange(range);

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
      where: { date: { gte: start, lte: end } },
      orderBy: { date: 'asc' },
    }),
    prisma.analytics_game_sessions.findMany({
      where: { started_at: { gte: start, lte: end } },
      orderBy: { started_at: 'asc' },
    }),
    prisma.sys_user.findMany({
      where: { created_at: { gte: start, lte: end } },
      select: { created_at: true },
      orderBy: { created_at: 'asc' },
    }),
    prisma.device_token_usage_session.findMany({
      where: { usage_date: { gte: start, lte: end } },
      orderBy: { usage_date: 'asc' },
    }),
    prisma.rfid_card_tap_log.findMany({
      where: { created_at: { gte: start, lte: end } },
      orderBy: { created_at: 'desc' },
    }),
    prisma.device_games_played.findMany({
      where: { activity_date: { gte: start, lte: end } },
      orderBy: { played_at: 'desc' },
    }),
    prisma.voice_session_summaries.findMany({
      where: { updated_at: { gte: start, lte: end } },
      orderBy: { updated_at: 'desc' },
      take: 8,
    }),
  ]);

  const usageByDate = aggregateUsageByDate(usageRows);
  const sessionByDate = aggregateSessionsByDate(sessionRows);
  const registrationsByDate = aggregateRegistrationsByDate(users);
  const costByDate = aggregateCostByDate(costRows);
  const totalUsageSeconds = usageRows.reduce((sum, row) => sum + Number(row.usage_time_seconds || 0), 0);
  const latestUsage = usageByDate[usageByDate.length - 1] || {
    aiTalkSeconds: 0,
    cardSeconds: 0,
    gameSeconds: 0,
    radioSeconds: 0,
  };

  return {
    range,
    generatedAt: new Date().toISOString(),
    kpis: {
      activeToysToday: {
        total: onlineDevices,
        fleetTotal: totalDevices,
        sparkline: buildEmptySeries(usageByDate, (row) => row.activeDevices),
      },
      playTimeHours: {
        total: round(totalUsageSeconds / 3600, 1),
        sparkline: buildEmptySeries(usageByDate, (row) => round(row.usageSeconds / 3600, 1)),
      },
      sessions: {
        total: sessionRows.length,
        sparkline: buildEmptySeries(sessionByDate, (row) => row.total),
      },
      newFamilies: {
        total: users.length,
        sparkline: buildEmptySeries(registrationsByDate, (row) => row.count),
      },
      aiCostInr: {
        total: round(costByDate.reduce((sum, row) => sum + row.cost, 0), 2),
        sparkline: buildEmptySeries(costByDate, (row) => row.cost),
      },
    },
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
        totalMinutes: round(
          (latestUsage.aiTalkSeconds + latestUsage.cardSeconds + latestUsage.gameSeconds + latestUsage.radioSeconds) / 60,
          1,
        ),
        items: [
          { key: 'aiTalk', label: 'AI Talk', minutes: round(latestUsage.aiTalkSeconds / 60, 1) },
          { key: 'card', label: 'Cards', minutes: round(latestUsage.cardSeconds / 60, 1) },
          { key: 'game', label: 'Games', minutes: round(latestUsage.gameSeconds / 60, 1) },
          { key: 'radio', label: 'Radio', minutes: round(latestUsage.radioSeconds / 60, 1) },
        ],
      },
      cardsKidsLove: {
        items: summarizeCardLeaderboard(cardTaps),
      },
      gamesPlayedVsFinished: {
        items: summarizeGames(games),
      },
      talkingAbout: {
        items: extractTopics(summaries),
        samples: summaries.slice(0, 3).map((entry) => ({
          summary: entry.summary,
          macAddress: entry.mac_address,
          updatedAt: entry.updated_at,
        })),
      },
    },
  };
}

async function searchFamilies(query) {
  const q = String(query || '').trim();
  if (!q) {
    return { kids: [], parents: [], devices: [] };
  }

  const [kids, parents, devices] = await Promise.all([
    prisma.kid_profile.findMany({
      where: {
        OR: [
          { name: { contains: q, mode: 'insensitive' } },
          { nickname: { contains: q, mode: 'insensitive' } },
        ],
      },
      include: {
        sys_user: {
          include: {
            parent_profile: true,
          },
        },
      },
      take: 5,
    }),
    prisma.parent_profile.findMany({
      where: {
        display_name: { contains: q, mode: 'insensitive' },
      },
      include: {
        sys_user: {
          include: {
            ai_device: true,
          },
        },
      },
      take: 5,
    }),
    prisma.ai_device.findMany({
      where: {
        OR: [
          { mac_address: { contains: q, mode: 'insensitive' } },
          { alias: { contains: q, mode: 'insensitive' } },
        ],
      },
      include: {
        sys_user: {
          include: {
            parent_profile: true,
          },
        },
      },
      take: 5,
    }),
  ]);

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
      parentName: device.sys_user?.parent_profile?.display_name || null,
    })),
  };
}

async function listAllFamilies() {
  const kids = await prisma.kid_profile.findMany({
    include: {
      sys_user: {
        include: {
          parent_profile: true,
          ai_device: true,
        },
      },
    },
    orderBy: { id: 'asc' },
  });

  return kids.map((kid) => ({
    kidId: String(kid.id),
    kidName: kid.name,
    grade: kid.grade || null,
    birthDate: kid.birth_date,
    parentName: kid.sys_user?.parent_profile?.display_name || null,
    parentEmail: kid.sys_user?.parent_profile?.email || null,
    deviceCount: kid.sys_user?.ai_device?.length || 0,
  }));
}

async function resolveKidId(macOrKidId) {
  if (/^\d+$/.test(String(macOrKidId || ''))) {
    const numericId = BigInt(macOrKidId);
    const kid = await prisma.kid_profile.findFirst({
      where: { id: numericId },
      select: { id: true },
    });

    if (kid) {
      return kid.id;
    }

    const fallbackKid = await prisma.kid_profile.findFirst({
      where: { user_id: numericId },
      select: { id: true },
    });

    return fallbackKid?.id || null;
  }

  const normalizedMac = normalizeMacAddress(macOrKidId);
  if (!normalizedMac) {
    return null;
  }

  const device = await prisma.ai_device.findFirst({
    where: { mac_address: normalizedMac },
    select: { kid_id: true },
  });

  return device?.kid_id || null;
}

async function getFamilyProfile(macOrKidId) {
  const kidId = await resolveKidId(macOrKidId);
  if (!kidId) {
    return null;
  }

  const kid = await prisma.kid_profile.findFirst({
    where: { id: kidId },
    include: {
      sys_user: {
        include: {
          parent_profile: true,
          ai_device: true,
        },
      },
    },
  });

  if (!kid) {
    return null;
  }

  const devices = kid.sys_user?.ai_device || [];
  const macAddresses = devices.map((device) => device.mac_address);

  const [runtimeStates, quota, progress, summaries, cardTaps, games] = await Promise.all([
    prisma.device_runtime_state.findMany({
      where: { mac_address: { in: macAddresses } },
    }),
    prisma.user_question_quota.findFirst({
      where: {
        user_id: kid.user_id,
      },
      orderBy: { month_key: 'desc' },
    }),
    prisma.analytics_user_progress.findMany({
      where: { kid_id: kid.id },
    }),
    prisma.voice_session_summaries.findMany({
      where: { mac_address: { in: macAddresses } },
      orderBy: { updated_at: 'desc' },
      take: 3,
    }),
    prisma.rfid_card_tap_log.findMany({
      where: { mac_address: { in: macAddresses } },
      orderBy: { created_at: 'desc' },
      take: 20,
    }),
    prisma.device_games_played.findMany({
      where: { mac_address: { in: macAddresses } },
      orderBy: { played_at: 'desc' },
      take: 20,
    }),
  ]);

  const runtimeByMac = new Map(runtimeStates.map((state) => [state.mac_address, state]));

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
    parent: {
      displayName: kid.sys_user?.parent_profile?.display_name || null,
      email: kid.sys_user?.parent_profile?.email || null,
      phoneNumber: kid.sys_user?.parent_profile?.phone_number || null,
      avatarUrl: kid.sys_user?.parent_profile?.avatar_url || null,
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
    quota: {
      monthKey: quota?.month_key || null,
      questionsUsed: quota?.questions_used || 0,
      extraPurchased: quota?.extra_purchased || 0,
    },
    progress: progress.map((entry) => ({
      modeType: entry.mode_type,
      totalSessions: entry.total_sessions,
      totalTimeSeconds: entry.total_time_seconds,
      longestStreak: entry.longest_streak,
    })),
    recentSummaries: summaries.map((entry) => ({
      summary: entry.summary,
      macAddress: entry.mac_address,
      updatedAt: entry.updated_at,
    })),
    contentLove: {
      cards: summarizeCardLeaderboard(cardTaps),
      games: summarizeGames(games),
    },
  };
}

async function getFounderEngagement({ range = '30d' } = {}) {
  const { start, end } = buildDateRange(range);
  const dateKeys = buildDateKeys(start, end);
  const previousStart = new Date(start);
  previousStart.setDate(previousStart.getDate() - 7);
  const previousEnd = new Date(start);
  previousEnd.setDate(previousEnd.getDate() - 1);
  previousEnd.setHours(23, 59, 59, 999);

  const [usageRows, currentWeekUsageRows, previousWeekUsageRows, sessionRows, devices, runtimeRows] = await Promise.all([
    prisma.device_usage_daily.findMany({
      where: { date: { gte: start, lte: end } },
      orderBy: { date: 'asc' },
    }),
    prisma.device_usage_daily.findMany({
      where: { date: { gte: new Date(end.getTime() - 6 * 86400000), lte: end } },
    }),
    prisma.device_usage_daily.findMany({
      where: { date: { gte: previousStart, lte: previousEnd } },
    }),
    prisma.analytics_game_sessions.findMany({
      where: { started_at: { gte: start, lte: end } },
      orderBy: { started_at: 'asc' },
    }),
    prisma.ai_device.findMany({
      include: {
        sys_user: {
          include: {
            parent_profile: true,
          },
        },
      },
    }),
    prisma.device_runtime_state.findMany(),
  ]);

  const usageByDate = fillUsageSeries(dateKeys, aggregateUsageByDate(usageRows));
  const dailyActives = usageByDate.map((row) => row.activeDevices);
  const averageSeries = movingAverage(dailyActives);
  const runtimeByMac = new Map(runtimeRows.map((row) => [row.mac_address, row]));

  const currentWeekSet = new Set(currentWeekUsageRows.map((row) => row.mac_address));
  const previousWeekSet = new Set(previousWeekUsageRows.map((row) => row.mac_address));
  const returnedCount = Array.from(previousWeekSet).filter((mac) => currentWeekSet.has(mac)).length;
  const newCount = Array.from(currentWeekSet).filter((mac) => !previousWeekSet.has(mac)).length;
  const currentWeekCount = currentWeekSet.size;
  const previousWeekCount = previousWeekSet.size;
  const activeYesterday = usageByDate[usageByDate.length - 1]?.activeDevices || 0;
  const monthlyActives = new Set(usageRows.map((row) => row.mac_address)).size;
  const avgSessionMinutes = round(
    sessionRows.reduce((sum, row) => sum + Number(row.duration_seconds || 0), 0) / 60 / Math.max(sessionRows.length, 1),
    1,
  );

  return {
    range,
    generatedAt: new Date().toISOString(),
    kpis: {
      activeYesterday,
      weeklyActives: currentWeekCount,
      monthlyActives,
      fleetTotal: devices.length,
      dauMauRatio: monthlyActives ? round((activeYesterday / monthlyActives) * 100, 0) : 0,
      avgSessionMinutes,
    },
    sections: {
      dailyActives: usageByDate.map((row, index) => ({
        date: row.date,
        activeDevices: row.activeDevices,
        average: averageSeries[index],
      })),
      returningSplit: {
        currentWeekActives: currentWeekCount,
        previousWeekActives: previousWeekCount,
        returnedCount,
        returnedRate: previousWeekCount ? round((returnedCount / previousWeekCount) * 100, 0) : 0,
        newCount,
      },
      sessionsByHour: summarizeHourlySessions(sessionRows),
      sessionsHeatmap: summarizeSessionsHeatmap(sessionRows),
      quietDevices: summarizeQuietDevices({
        devices,
        usageRows,
        runtimeStates: runtimeByMac,
      }),
    },
  };
}

async function getFounderContent({ range = '7d' } = {}) {
  const { start, end } = buildDateRange(range);

  const [cardTaps, gameRows, mediaRows, radioRows, contentPackCount] = await Promise.all([
    prisma.rfid_card_tap_log.findMany({
      where: { created_at: { gte: start, lte: end } },
      orderBy: { created_at: 'desc' },
    }),
    prisma.device_games_played.findMany({
      where: { activity_date: { gte: start, lte: end } },
      orderBy: { played_at: 'desc' },
    }),
    prisma.analytics_media_playback.findMany({
      where: { created_at: { gte: start, lte: end } },
      orderBy: { created_at: 'desc' },
    }),
    prisma.device_radio_played.findMany({
      where: { activity_date: { gte: start, lte: end } },
      orderBy: { played_at: 'desc' },
    }),
    prisma.rfid_content_pack.count(),
  ]);

  const packs = summarizeCardLeaderboard(cardTaps).map((item) => ({
    ...item,
    repeatRate: item.uniqueDevices ? round(item.taps / item.uniqueDevices, 1) : 0,
  }));

  const gamesByName = new Map();
  gameRows.forEach((row) => {
    const key = row.game_name || row.game_id || 'Unknown game';
    if (!gamesByName.has(key)) {
      gamesByName.set(key, {
        name: key,
        plays: 0,
        completed: 0,
        totalScore: 0,
        scoredPlays: 0,
      });
    }
    const item = gamesByName.get(key);
    item.plays += 1;
    if (row.score !== null && row.score !== undefined) {
      item.totalScore += Number(row.score);
      item.scoredPlays += 1;
    }
  });

  const gameSessions = await prisma.analytics_game_sessions.findMany({
    where: { started_at: { gte: start, lte: end } },
  });
  gameSessions.forEach((row) => {
    const key = row.mode_type || 'Unknown game';
    if (!gamesByName.has(key)) {
      gamesByName.set(key, {
        name: key,
        plays: 0,
        completed: 0,
        totalScore: 0,
        scoredPlays: 0,
      });
    }
    const item = gamesByName.get(key);
    if ((row.completion_status || '').toLowerCase() === 'completed') {
      item.completed += 1;
    }
    if (item.plays === 0) {
      item.plays += 1;
    }
  });

  const mediaByTitle = new Map();
  mediaRows.forEach((row) => {
    const title = row.metadata?.title || row.metadata?.name || `Content ${row.content_id || row.id}`;
    if (!mediaByTitle.has(title)) {
      mediaByTitle.set(title, {
        title,
        type: row.content_type,
        plays: 0,
      });
    }
    mediaByTitle.get(title).plays += 1;
  });

  const radioByStation = new Map();
  radioRows.forEach((row) => {
    const station = row.station || 'Radio';
    radioByStation.set(station, round((radioByStation.get(station) || 0) + Number(row.duration_ms || 0) / 60000, 1));
  });

  return {
    range,
    generatedAt: new Date().toISOString(),
    kpis: {
      cardTaps: cardTaps.length,
      cardsInUse: new Set(cardTaps.map((row) => row.content_pack_name || row.rfid_uid)).size,
      catalogTotal: contentPackCount,
      gamePlays: gameRows.length,
      avgCompletionRate: (() => {
        const rows = Array.from(gamesByName.values());
        const rates = rows
          .map((item) => item.plays ? (item.completed / item.plays) * 100 : null)
          .filter((value) => value !== null);
        return rates.length ? round(rates.reduce((sum, value) => sum + value, 0) / rates.length, 0) : 0;
      })(),
      mediaPlays: mediaRows.length + radioRows.length,
    },
    sections: {
      packLeaderboard: packs,
      games: Array.from(gamesByName.values())
        .map((item) => {
          const completionRate = item.plays ? round((item.completed / item.plays) * 100, 0) : null;
          return {
            name: item.name,
            plays: item.plays,
            completionRate,
            avgScore: item.scoredPlays ? round(item.totalScore / item.scoredPlays, 1) : null,
            status: getStatusFromCompletionRate(completionRate),
          };
        })
        .sort((a, b) => b.plays - a.plays)
        .slice(0, 8),
      media: Array.from(mediaByTitle.values()).sort((a, b) => b.plays - a.plays).slice(0, 5),
      radio: Array.from(radioByStation.entries())
        .map(([station, minutes]) => ({ station, minutes }))
        .sort((a, b) => b.minutes - a.minutes)
        .slice(0, 5),
      unresolvedTapCount: cardTaps.filter((row) => !row.content_pack_name).length,
    },
  };
}

async function getFounderConversations({ range = '7d' } = {}) {
  const { start, end } = buildDateRange(range);

  const [usageRows, summaries, tokenRows] = await Promise.all([
    prisma.device_usage_daily.findMany({
      where: { date: { gte: start, lte: end } },
      orderBy: { date: 'asc' },
    }),
    prisma.voice_session_summaries.findMany({
      where: { updated_at: { gte: start, lte: end } },
      orderBy: { updated_at: 'desc' },
      take: 50,
    }),
    prisma.device_token_usage_session.findMany({
      where: { usage_date: { gte: start, lte: end } },
      orderBy: { usage_date: 'desc' },
    }),
  ]);

  const talkHours = round(
    usageRows.reduce((sum, row) => sum + Number(row.ai_talk_usage_seconds || 0), 0) / 3600,
    1,
  );
  const totalTurns = summaries.reduce((sum, row) => sum + Number(row.source_message_count || 0), 0);

  return {
    range,
    generatedAt: new Date().toISOString(),
    kpis: {
      talkHours,
      talkSessions: summaries.length,
      avgTurnsPerSession: summaries.length ? round(totalTurns / summaries.length, 1) : 0,
      topicsDetected: extractTopics(summaries).length,
      moderationFlags: 0,
      screenedMessages: tokenRows.reduce((sum, row) => sum + Number(row.message_count || 0), 0),
    },
    sections: {
      topics: extractTopics(summaries),
      summaries: summaries.slice(0, 10).map((row) => {
        const { headline, tags } = summarizeRecentConversation(row.summary);
        return {
          id: row.id,
          macAddress: row.mac_address,
          headline,
          summary: row.summary,
          tags,
          turns: row.source_message_count || 0,
          updatedAt: row.updated_at,
        };
      }),
      transcriptPreview: summaries[0]
        ? {
            macAddress: summaries[0].mac_address,
            title: summarizeRecentConversation(summaries[0].summary).headline,
            lines: [
              { speaker: 'Kid', text: 'Conversation transcript is still sourced from the existing chat drawer.' },
              { speaker: 'Cheeko', text: 'This preview keeps founder context on the page while the deep transcript stays one click away.' },
            ],
          }
        : null,
    },
  };
}

async function getFounderCosts({ range = 'month' } = {}) {
  const { start, end, days } = buildDateRange(range);
  const monthlyBudget = 15500;

  const [costRows, usageRows, sessionRows, devices] = await Promise.all([
    prisma.device_token_usage_session.findMany({
      where: { usage_date: { gte: start, lte: end } },
      orderBy: { usage_date: 'asc' },
    }),
    prisma.device_usage_daily.findMany({
      where: { date: { gte: start, lte: end } },
      orderBy: { date: 'asc' },
    }),
    prisma.analytics_game_sessions.findMany({
      where: { started_at: { gte: start, lte: end } },
      orderBy: { started_at: 'asc' },
    }),
    prisma.ai_device.findMany({
      include: {
        sys_user: {
          include: {
            parent_profile: true,
          },
        },
      },
    }),
  ]);

  const totalCost = round(costRows.reduce((sum, row) => sum + calculateCost(row), 0), 2);
  const activeSet = new Set(usageRows.map((row) => row.mac_address));
  const costByDate = aggregateCostByDate(costRows);
  const projectedMonth = round((totalCost / Math.max(days, 1)) * 30, 1);
  const totalSessions = sessionRows.length;
  const avgResponseTimeSeconds = round(
    costRows.reduce((sum, row) => sum + Number(row.avg_ttft_seconds || 0), 0) / Math.max(costRows.length, 1),
    2,
  );
  const deviceInfoByMac = new Map(devices.map((device) => [device.mac_address, device]));

  const spendByDevice = new Map();
  costRows.forEach((row) => {
    if (!spendByDevice.has(row.mac_address)) {
      spendByDevice.set(row.mac_address, {
        macAddress: row.mac_address,
        sessions: 0,
        talkTimeSeconds: 0,
        totalTokens: 0,
        cost: 0,
      });
    }
    const item = spendByDevice.get(row.mac_address);
    item.sessions += 1;
    item.talkTimeSeconds += Number(row.session_duration_seconds || 0);
    item.totalTokens += Number(row.total_tokens || 0);
    item.cost = round(item.cost + calculateCost(row), 2);
  });

  return {
    range,
    generatedAt: new Date().toISOString(),
    kpis: {
      totalCost,
      projectedMonth,
      monthlyBudget,
      budgetUsedPercent: monthlyBudget ? round((totalCost / monthlyBudget) * 100, 0) : 0,
      perActiveToyPerDay: activeSet.size ? round(totalCost / activeSet.size / Math.max(days, 1), 2) : 0,
      perSession: totalSessions ? round(totalCost / totalSessions, 2) : 0,
      avgResponseTimeSeconds,
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
        text:
          costRows.reduce((sum, row) => sum + Number(row.output_text_tokens || 0), 0) +
          costRows.reduce((sum, row) => sum + Number(row.input_text_tokens || 0), 0),
      },
      topDevices: Array.from(spendByDevice.values())
        .map((item) => {
          const info = deviceInfoByMac.get(item.macAddress);
          return {
            ...item,
            kidName: null,
            parentName: info?.sys_user?.parent_profile?.display_name || null,
            talkHours: round(item.talkTimeSeconds / 3600, 1),
            fleetSharePercent: totalCost ? round((item.cost / totalCost) * 100, 1) : 0,
          };
        })
        .sort((a, b) => b.cost - a.cost)
        .slice(0, 10),
    },
  };
}

async function getFounderOperate() {
  const { start, end } = buildDateRange('7d');
  const [devices, runtimeRows, otaRows, syncEvents, analyticsEvents] = await Promise.all([
    prisma.ai_device.findMany({
      orderBy: { create_date: 'desc' },
    }),
    prisma.device_runtime_state.findMany(),
    prisma.ai_ota.findMany({
      orderBy: { create_date: 'desc' },
    }),
    prisma.device_sync_event.findMany({
      where: { created_at: { gte: start, lte: end } },
      orderBy: { created_at: 'desc' },
      take: 20,
    }),
    prisma.device_analytics_event.findMany({
      where: {
        OR: [
          { server_received_at: { gte: start, lte: end } },
          { event_timestamp: { gte: start, lte: end } },
        ],
      },
      orderBy: { server_received_at: 'desc' },
      take: 20,
    }),
  ]);

  const runtimeByMac = new Map(runtimeRows.map((row) => [row.mac_address, row]));
  const latestOta = otaRows[0] || null;
  const firmwareCounts = new Map();
  runtimeRows.forEach((row) => {
    const version = row.firmware || 'unknown';
    firmwareCounts.set(version, (firmwareCounts.get(version) || 0) + 1);
  });

  const onlineCount = runtimeRows.filter((row) => row.online).length;
  const latestCount = latestOta
    ? runtimeRows.filter((row) => row.firmware === latestOta.version).length
    : 0;
  const avgBattery = runtimeRows.length
    ? round(
        runtimeRows.reduce((sum, row) => sum + Number(row.battery || 0), 0) / runtimeRows.length,
        0,
      )
    : 0;
  const errorCount = analyticsEvents.filter((row) => /error|fail|shutdown/i.test(row.event_name || row.reason || '')).length;

  return {
    generatedAt: new Date().toISOString(),
    kpis: {
      fleetSize: devices.length,
      onlineNow: onlineCount,
      latestFirmwarePercent: devices.length ? round((latestCount / devices.length) * 100, 0) : 0,
      avgBattery,
      deviceErrors7d: errorCount,
    },
    sections: {
      firmwareCoverage: Array.from(firmwareCounts.entries())
        .map(([version, count]) => ({
          version,
          count,
          percent: devices.length ? round((count / devices.length) * 100, 0) : 0,
          isLatest: latestOta ? version === latestOta.version : false,
        }))
        .sort((a, b) => b.count - a.count),
      otaRollout: latestOta
        ? {
            version: latestOta.version,
            forceUpdate: Boolean(latestOta.force_update),
            updatedCount: latestCount,
            fleetSize: devices.length,
            percent: devices.length ? round((latestCount / devices.length) * 100, 0) : 0,
          }
        : null,
      watchlist: summarizeWatchlist(devices, runtimeByMac, syncEvents, analyticsEvents),
      recentEvents: summarizeFleetEvents(syncEvents, analyticsEvents),
    },
  };
}

module.exports = {
  getFounderOverview,
  getFounderEngagement,
  getFounderContent,
  getFounderConversations,
  getFounderCosts,
  getFounderOperate,
  searchFamilies,
  listAllFamilies,
  getFamilyProfile,
};
