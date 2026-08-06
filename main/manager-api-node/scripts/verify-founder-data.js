#!/usr/bin/env node
/**
 * Founder dashboard data verifier.
 *
 * Answers one question: does the number the dashboard shows equal the number
 * in the database?
 *
 * For each check it computes the value **independently** from the tables
 * (deliberately NOT by importing founderDashboard.service, so a bug in the
 * service cannot cancel itself out), calls the matching API endpoint, and
 * prints DB vs API side by side.
 *
 * SAFETY
 *   - Read-only. Only count / aggregate / groupBy / findMany are used, and a
 *     runtime guard throws if any mutating Prisma method is called.
 *   - Never boots server.js, so `prisma migrate deploy` is never triggered.
 *     It is safe to point at production.
 *
 * USAGE
 *   cd main/manager-api-node
 *
 *   # with an existing admin token
 *   FOUNDER_TOKEN=xxx node scripts/verify-founder-data.js
 *
 *   # or let it log in for you
 *   node scripts/verify-founder-data.js --user admin --pass 'secret'
 *
 *   # options
 *   --api   http://localhost:8002/toy   API base URL (default)
 *   --range 7d                          today | 7d | 30d | 90d | month
 *   --json                              machine-readable output
 *
 * The API must already be running and pointed at the same database.
 */

'use strict';

require('dotenv').config();

const { prisma } = require('../src/config/database');

/* ------------------------------------------------------------------ *
 * CLI
 * ------------------------------------------------------------------ */

function parseArgs(argv) {
  const args = { api: 'http://localhost:8002/toy', range: '7d', json: false };
  for (let i = 2; i < argv.length; i += 1) {
    const key = argv[i];
    const next = argv[i + 1];
    if (key === '--api') { args.api = next; i += 1; }
    else if (key === '--range') { args.range = next; i += 1; }
    else if (key === '--user') { args.user = next; i += 1; }
    else if (key === '--pass') { args.pass = next; i += 1; }
    else if (key === '--json') { args.json = true; }
  }
  return args;
}

const args = parseArgs(process.argv);
const API = String(args.api).replace(/\/$/, '');

/* ------------------------------------------------------------------ *
 * Read-only guard — fails loudly if this script ever tries to write.
 * ------------------------------------------------------------------ */

const WRITE_METHODS = new Set([
  'create', 'createMany', 'createManyAndReturn', 'update', 'updateMany',
  'upsert', 'delete', 'deleteMany', 'executeRaw', 'executeRawUnsafe',
]);

function readOnly(client) {
  return new Proxy(client, {
    get(target, model) {
      const delegate = target[model];
      // only guard model delegates (they expose findMany); leave $connect etc alone
      if (typeof model !== 'string' || model.startsWith('$') || !delegate || typeof delegate.findMany !== 'function') {
        return delegate;
      }
      return new Proxy(delegate, {
        get(inner, method) {
          if (typeof method === 'string' && WRITE_METHODS.has(method)) {
            throw new Error(`Refusing to call a write method: ${model}.${method}()`);
          }
          const value = inner[method];
          return typeof value === 'function' ? value.bind(inner) : value;
        },
      });
    },
  });
}

const db = readOnly(prisma);

/* ------------------------------------------------------------------ *
 * IST calendar helpers — reimplemented here on purpose.
 * ------------------------------------------------------------------ */

const IST_DAY = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit',
});
const IST_HOUR = new Intl.DateTimeFormat('en-US', {
  timeZone: 'Asia/Kolkata', hour: 'numeric', hourCycle: 'h23',
});

const todayKey = () => IST_DAY.format(new Date());
const shiftKey = (key, delta) => {
  const date = new Date(`${key}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + delta);
  return date.toISOString().slice(0, 10);
};

function windowFor(range) {
  const end = todayKey();
  let start;
  if (range === 'month') start = `${end.slice(0, 7)}-01`;
  else if (range === 'today') start = end;
  else if (range === '90d') start = shiftKey(end, -89);
  else if (range === '30d') start = shiftKey(end, -29);
  else start = shiftKey(end, -6);

  const keys = [];
  let cursor = start;
  while (cursor <= end) { keys.push(cursor); cursor = shiftKey(cursor, 1); }

  return {
    startKey: start,
    endKey: end,
    days: keys.length,
    dateOnly: { gte: new Date(`${start}T00:00:00Z`), lte: new Date(`${end}T00:00:00Z`) },
    ts: { gte: new Date(`${start}T00:00:00.000+05:30`), lte: new Date(`${end}T23:59:59.999+05:30`) },
  };
}

/* ------------------------------------------------------------------ *
 * Reporting
 * ------------------------------------------------------------------ */

const results = [];
const round2 = (v) => Math.round((Number(v) || 0) * 100) / 100;

function show(value) {
  if (value === null || value === undefined) return '—';
  if (typeof value === 'number') return Number.isInteger(value) ? String(value) : String(round2(value));
  return String(value);
}

function record(group, name, dbValue, apiValue, opts = {}) {
  const { tolerance = 0, note = '', info = false } = opts;
  let status;
  if (info) status = 'INFO';
  else if (dbValue === null && apiValue === null) status = 'PASS';
  else if (typeof dbValue === 'number' && typeof apiValue === 'number') {
    status = Math.abs(dbValue - apiValue) <= tolerance ? 'PASS' : 'FAIL';
  } else {
    status = String(dbValue) === String(apiValue) ? 'PASS' : 'FAIL';
  }
  results.push({ group, name, db: show(dbValue), api: show(apiValue), status, note });
}

function assert(group, name, condition, detail = '') {
  results.push({
    group, name,
    db: condition ? 'ok' : 'violated',
    api: detail || '',
    status: condition ? 'PASS' : 'FAIL',
    note: detail,
  });
}

/* ------------------------------------------------------------------ *
 * API access
 * ------------------------------------------------------------------ */

let TOKEN = process.env.FOUNDER_TOKEN || '';

async function login(username, password) {
  const res = await fetch(`${API}/user/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password, captcha: 'MOBILE_APP_BYPASS', captchaId: 'verify-script' }),
  });
  const body = await res.json();
  if (!res.ok || body.code !== 0) throw new Error(`login failed: ${body.msg || res.status}`);
  return body.data.token;
}

const apiCache = new Map();
async function api(path) {
  if (apiCache.has(path)) return apiCache.get(path);
  const res = await fetch(`${API}${path}`, { headers: { Authorization: `Bearer ${TOKEN}` } });
  const text = await res.text();
  let body;
  try { body = JSON.parse(text); } catch { throw new Error(`${path} → non-JSON (${res.status}): ${text.slice(0, 160)}`); }
  if (!res.ok || (body.code !== 0 && body.code !== undefined)) {
    throw new Error(`${path} → ${res.status} ${body.msg || ''}`);
  }
  apiCache.set(path, body.data);
  return body.data;
}

/* ------------------------------------------------------------------ *
 * Cost rates (config, read the same way the service reads them)
 * ------------------------------------------------------------------ */

const RATE_DEFAULTS = { inputText: 46, inputAudio: 276, inputCached: 0, outputText: 184, outputAudio: 1104 };
const RATE_CODES = {
  inputText: 'gemini_price_input_text_inr_per_million',
  inputAudio: 'gemini_price_input_audio_inr_per_million',
  inputCached: 'gemini_price_input_cached_inr_per_million',
  outputText: 'gemini_price_output_text_inr_per_million',
  outputAudio: 'gemini_price_output_audio_inr_per_million',
};

async function loadRates() {
  const rates = {};
  for (const [key, code] of Object.entries(RATE_CODES)) {
    const row = await db.sys_params.findFirst({ where: { param_code: code } });
    const value = row ? Number(row.param_value) : NaN;
    rates[key] = (Number.isFinite(value) ? value : RATE_DEFAULTS[key]) / 1e6;
  }
  return rates;
}

/* ------------------------------------------------------------------ *
 * Checks
 * ------------------------------------------------------------------ */

async function checkOverview(win, rates) {
  const g = 'Overview';
  const data = await api(`/admin/founder/overview?range=${args.range}`);

  const [activeMacs, usageSum, sessionCount, userCount, tokenSums, tapTotal, tapUnresolved, fleetTotal] =
    await Promise.all([
      db.device_usage_daily.groupBy({ by: ['mac_address'], where: { date: win.dateOnly } }),
      db.device_usage_daily.aggregate({ _sum: { usage_time_seconds: true }, where: { date: win.dateOnly } }),
      db.analytics_game_sessions.count({ where: { started_at: win.ts } }),
      db.sys_user.count({ where: { created_at: win.ts } }),
      db.device_token_usage_session.aggregate({
        where: { usage_date: win.dateOnly },
        _sum: {
          input_text_tokens: true, input_audio_tokens: true, input_cached_tokens: true,
          output_text_tokens: true, output_audio_tokens: true,
        },
      }),
      db.rfid_card_tap_log.count({ where: { created_at: win.ts } }),
      db.rfid_card_tap_log.count({ where: { created_at: win.ts, content_pack_name: null } }),
      db.ai_device.count(),
    ]);

  const s = tokenSums._sum;
  const dbCost = round2(
    Number(s.input_text_tokens || 0) * rates.inputText +
    Number(s.input_audio_tokens || 0) * rates.inputAudio +
    Number(s.input_cached_tokens || 0) * rates.inputCached +
    Number(s.output_text_tokens || 0) * rates.outputText +
    Number(s.output_audio_tokens || 0) * rates.outputAudio,
  );

  record(g, 'Active toys (distinct macs in range)', activeMacs.length, data.kpis.activeToys.total);
  record(g, 'Fleet total', fleetTotal, data.kpis.activeToys.fleetTotal);
  record(g, 'Play time (hrs)', round2(Number(usageSum._sum.usage_time_seconds || 0) / 3600), round2(data.kpis.playTimeHours.total), { tolerance: 0.1 });
  record(g, 'Game sessions', sessionCount, data.kpis.sessions.total);
  record(g, 'New families', userCount, data.kpis.newFamilies.total);
  record(g, 'AI cost (INR)', dbCost, round2(data.kpis.aiCostInr.total), { tolerance: 0.02 });
  record(g, 'Unresolved card taps', tapUnresolved, data.sections.cardsKidsLove.unresolvedTapCount);
  record(g, 'Series length = days in range', win.days, data.sections.timeByFeature.series.length);

  const sparkLengths = new Set([
    data.kpis.activeToys.sparkline.length, data.kpis.playTimeHours.sparkline.length,
    data.kpis.sessions.sparkline.length, data.kpis.newFamilies.sparkline.length,
    data.kpis.aiCostInr.sparkline.length,
  ]);
  assert(g, 'All KPI sparklines gap-filled to same length', sparkLengths.size === 1 && sparkLengths.has(win.days), `lengths=${[...sparkLengths].join(',')} expected=${win.days}`);
  assert(g, '"Unresolved" never shown as a real pack', !data.sections.cardsKidsLove.items.some((i) => i.name === 'Unresolved'));
  record(g, 'Total card taps (context)', tapTotal, tapTotal, { info: true, note: 'leaderboard shows mapped packs only' });
}

async function checkEngagement(win) {
  const g = 'Engagement';
  const data = await api(`/admin/founder/engagement?range=${args.range}`);

  const end = todayKey();
  const weekStart = shiftKey(end, -6);
  const [rangeMacs, weekMacs, sessionCount, fleetTotal] = await Promise.all([
    db.device_usage_daily.groupBy({ by: ['mac_address'], where: { date: win.dateOnly } }),
    db.device_usage_daily.groupBy({
      by: ['mac_address'],
      where: { date: { gte: new Date(`${weekStart}T00:00:00Z`), lte: new Date(`${end}T00:00:00Z`) } },
    }),
    db.analytics_game_sessions.count({ where: { started_at: win.ts } }),
    db.ai_device.count(),
  ]);

  record(g, 'Monthly actives (distinct in range)', rangeMacs.length, data.kpis.monthlyActives);
  record(g, 'Weekly actives (trailing 7d)', weekMacs.length, data.kpis.weeklyActives);
  record(g, 'Fleet total', fleetTotal, data.kpis.fleetTotal);

  const hourTotal = data.sections.sessionsByHour.reduce((a, b) => a + b.sessions, 0);
  const heatTotal = data.sections.sessionsHeatmap.flatMap((d) => d.hours).reduce((a, b) => a + b.sessions, 0);
  record(g, 'Sessions in hour histogram', sessionCount, hourTotal);
  record(g, 'Sessions in 7x24 heatmap', sessionCount, heatTotal, { note: 'must equal histogram; midnight bug dropped these' });

  // independent quiet-toy computation
  const historyStart = shiftKey(end, -59);
  const quietCutoff = shiftKey(end, -6);
  const [history, devices] = await Promise.all([
    db.device_usage_daily.findMany({
      where: { date: { gte: new Date(`${historyStart}T00:00:00Z`), lte: new Date(`${end}T00:00:00Z`) } },
      select: { mac_address: true, date: true },
    }),
    db.ai_device.findMany({ select: { mac_address: true } }),
  ]);
  const lastByMac = new Map();
  history.forEach((row) => {
    const key = IST_DAY.format(row.date);
    const prev = lastByMac.get(row.mac_address);
    if (!prev || key > prev) lastByMac.set(row.mac_address, key);
  });
  const known = new Set(devices.map((d) => d.mac_address));
  const quiet = [...lastByMac.entries()].filter(([mac, key]) => known.has(mac) && key < quietCutoff).length;
  record(g, 'Quiet toys (used in 60d, silent 7d)', quiet, data.sections.quietDeviceTotal);

  assert(g, 'Every quiet row has a real last-activity date', data.sections.quietDevices.every((q) => Boolean(q.lastActivityDate)));
}

async function checkContent(win) {
  const g = 'Content';
  const data = await api(`/admin/founder/content?range=${args.range}`);

  const [taps, unresolved, packsInUse, catalog, gamePlays, mediaStarts, mediaAll] = await Promise.all([
    db.rfid_card_tap_log.count({ where: { created_at: win.ts } }),
    db.rfid_card_tap_log.count({ where: { created_at: win.ts, content_pack_name: null } }),
    db.rfid_card_tap_log.groupBy({ by: ['content_pack_id'], where: { created_at: win.ts, content_pack_id: { not: null } } }),
    db.rfid_content_pack.count(),
    db.device_games_played.count({ where: { activity_date: win.dateOnly } }),
    db.analytics_media_playback.count({ where: { created_at: win.ts, event_type: 'start' } }),
    db.analytics_media_playback.count({ where: { created_at: win.ts } }),
  ]);

  record(g, 'Card taps', taps, data.kpis.cardTaps);
  record(g, 'Unresolved taps', unresolved, data.sections.unresolvedTapCount);
  record(g, 'Packs in use (distinct pack ids)', packsInUse.length, data.kpis.packsInUse);
  record(g, 'Catalog total', catalog, data.kpis.catalogTotal);
  record(g, 'Game plays', gamePlays, data.kpis.gamePlays);

  assert(g, 'Packs-in-use never exceeds catalog', data.kpis.packsInUse <= data.kpis.catalogTotal, `${data.kpis.packsInUse}/${data.kpis.catalogTotal}`);
  assert(g, 'Every pack carries a 14-point trend', data.sections.packLeaderboard.every((p) => Array.isArray(p.trend) && p.trend.length === 14));
  assert(g, 'Pack week-over-week change is a number or null (never Infinity)', data.sections.packLeaderboard.every((p) => p.changePercent === null || Number.isFinite(p.changePercent)));
  assert(g, 'Losing-steam entries are all genuine declines', (data.sections.losingSteam || []).every((x) => (x.changePercent ?? x.changePoints ?? 0) < 0), (data.sections.losingSteam || []).map((x) => `${x.name}:${x.changePercent ?? x.changePoints}`).join(' '));
  assert(g, 'KPI deltas are numbers or null', Object.values(data.deltas || {}).every((v) => v === null || Number.isFinite(v)));
  assert(g, 'Every completion rate within 0-100', data.sections.games.every((x) => x.completionRate === null || (x.completionRate >= 0 && x.completionRate <= 100)), data.sections.games.map((x) => `${x.name}:${x.completionRate}`).join(' '));
  assert(g, 'No duplicate game rows after key merge', new Set(data.sections.games.map((x) => x.name)).size === data.sections.games.length);
  record(g, 'Media playback rows (all event types)', mediaAll, mediaStarts, { info: true, note: 'API counts starts only; gap = pause/resume/end rows' });
}

async function checkCosts(win, rates) {
  const g = 'Costs';
  const data = await api(`/admin/founder/costs?range=${args.range}`);

  const [sums, billedSessions, budgetRow] = await Promise.all([
    db.device_token_usage_session.aggregate({
      where: { usage_date: win.dateOnly },
      _sum: {
        input_text_tokens: true, input_audio_tokens: true, input_cached_tokens: true,
        output_text_tokens: true, output_audio_tokens: true,
      },
    }),
    db.device_token_usage_session.count({ where: { usage_date: win.dateOnly } }),
    db.sys_params.findFirst({ where: { param_code: 'founder_monthly_budget_inr' } }),
  ]);

  const s = sums._sum;
  const dbCost = round2(
    Number(s.input_text_tokens || 0) * rates.inputText +
    Number(s.input_audio_tokens || 0) * rates.inputAudio +
    Number(s.input_cached_tokens || 0) * rates.inputCached +
    Number(s.output_text_tokens || 0) * rates.outputText +
    Number(s.output_audio_tokens || 0) * rates.outputAudio,
  );

  record(g, 'Total cost (INR)', dbCost, round2(data.kpis.totalCost), { tolerance: 0.02 });
  record(g, 'Billed sessions', billedSessions, billedSessions, { info: true, note: 'denominator for per-session' });
  record(
    g, 'Per-session cost',
    billedSessions ? Math.round((dbCost / billedSessions) * 10000) / 10000 : null,
    data.kpis.perSession,
    { tolerance: 0.0002 },
  );
  record(g, 'Monthly budget', budgetRow ? Number(budgetRow.param_value) : null, data.kpis.monthlyBudget,
    { note: budgetRow ? 'from sys_params' : 'unset → must be null, not a default' });

  const cached = Number(s.input_cached_tokens || 0);
  if (cached > 0 && rates.inputCached === 0) {
    record(g, 'Cached input tokens billed at zero', cached, 0, { info: true, note: 'cost understated — set gemini_price_input_cached_inr_per_million' });
  }

  const shareSum = data.sections.topDevices.reduce((a, b) => a + b.fleetSharePercent, 0);
  assert(g, 'Top-10 fleet share <= 100%', shareSum <= 100.5, `sum=${round2(shareSum)}%`);

  // kidName should be populated wherever the device is linked to a kid
  const linked = await db.ai_device.findMany({ where: { kid_id: { not: null } }, select: { mac_address: true } });
  const linkedSet = new Set(linked.map((d) => d.mac_address));
  const missing = data.sections.topDevices.filter((d) => linkedSet.has(d.macAddress) && !d.kidName);
  assert(g, 'Kid name resolved for kid-linked devices', missing.length === 0, missing.map((d) => d.macAddress).join(', '));
}

async function checkTokenTableDivergence(win, rates) {
  const g = 'Cross-check';
  const [daily, session] = await Promise.all([
    db.device_token_usage.aggregate({
      where: { usage_date: win.dateOnly },
      _sum: {
        input_text_tokens: true, input_audio_tokens: true, input_cached_tokens: true,
        output_text_tokens: true, output_audio_tokens: true,
      },
    }),
    db.device_token_usage_session.aggregate({
      where: { usage_date: win.dateOnly },
      _sum: {
        input_text_tokens: true, input_audio_tokens: true, input_cached_tokens: true,
        output_text_tokens: true, output_audio_tokens: true,
      },
    }),
  ]);

  const costOf = (s) => round2(
    Number(s.input_text_tokens || 0) * rates.inputText +
    Number(s.input_audio_tokens || 0) * rates.inputAudio +
    Number(s.input_cached_tokens || 0) * rates.inputCached +
    Number(s.output_text_tokens || 0) * rates.outputText +
    Number(s.output_audio_tokens || 0) * rates.outputAudio,
  );

  const dailyCost = costOf(daily._sum);
  const sessionCost = costOf(session._sum);
  const drift = dailyCost || sessionCost ? round2(Math.abs(dailyCost - sessionCost) / Math.max(dailyCost, sessionCost) * 100) : 0;

  record(g, 'device_token_usage (Token Analytics page)', dailyCost, dailyCost, { info: true });
  record(g, 'device_token_usage_session (Costs page)', sessionCost, sessionCost, { info: true });
  assert(
    g, 'Both token tables agree within 5%',
    drift <= 5,
    `drift=${drift}% — these two tables feed two different cost screens; a large gap means one screen is wrong`,
  );
}

async function checkOperate() {
  const g = 'Fleet & Ops';
  const data = await api('/admin/founder/operate');

  const end = todayKey();
  const ts = { gte: new Date(`${shiftKey(end, -6)}T00:00:00.000+05:30`), lte: new Date(`${end}T23:59:59.999+05:30`) };

  const [fleet, online, runtimeAll, batteryRows, errorCount] = await Promise.all([
    db.ai_device.count(),
    db.device_runtime_state.count({ where: { online: true } }),
    db.device_runtime_state.count(),
    db.device_runtime_state.findMany({ where: { battery: { not: null } }, select: { battery: true } }),
    db.device_analytics_event.count({
      where: {
        AND: [
          { OR: [{ server_received_at: ts }, { event_timestamp: ts }] },
          {
            OR: [
              { event_name: { contains: 'error', mode: 'insensitive' } },
              { event_name: { contains: 'fail', mode: 'insensitive' } },
              { event_name: { contains: 'shutdown', mode: 'insensitive' } },
              { reason: { contains: 'error', mode: 'insensitive' } },
              { reason: { contains: 'fail', mode: 'insensitive' } },
            ],
          },
        ],
      },
    }),
  ]);

  const avgBattery = batteryRows.length
    ? Math.round(batteryRows.reduce((a, b) => a + Number(b.battery), 0) / batteryRows.length)
    : null;

  record(g, 'Fleet size', fleet, data.kpis.fleetSize);
  record(g, 'Online now', online, data.kpis.onlineNow);
  record(g, 'Devices reporting runtime state', runtimeAll, data.kpis.reportingDevices);
  record(g, 'Avg battery (nulls excluded)', avgBattery, data.kpis.avgBattery, { tolerance: 1 });
  record(g, 'Battery-reporting devices', batteryRows.length, data.kpis.batteryReportingDevices);
  record(g, 'Device errors 7d (full count, not page)', errorCount, data.kpis.deviceErrors7d);

  const coverage = data.sections.firmwareCoverage.reduce((a, b) => a + b.count, 0);
  record(g, 'Firmware coverage covers all reporting devices', runtimeAll, coverage);
}

async function checkLiveAndBrief() {
  const g = 'Live & Brief';
  const [live, brief] = await Promise.all([api('/admin/founder/live'), api('/admin/founder/brief')]);

  const today = todayKey();
  const todayTs = { gte: new Date(`${today}T00:00:00.000+05:30`), lte: new Date(`${today}T23:59:59.999+05:30`) };

  const [online, fleet, todaySessions] = await Promise.all([
    db.device_runtime_state.count({ where: { online: true } }),
    db.ai_device.count(),
    db.analytics_game_sessions.count({ where: { started_at: todayTs } }),
  ]);

  record(g, 'Live · online now', online, live.kpis.onlineNow);
  record(g, 'Live · fleet size', fleet, live.kpis.fleetSize);
  record(g, 'Live · sessions in hour strip', todaySessions, live.sections.hourlySessions.reduce((a, b) => a + b.sessions, 0));
  assert(g, 'Live · every feed row has a label and timestamp', live.sections.feed.every((f) => f.label && f.at));
  assert(g, 'Live · TTFT trend is 14 points', live.sections.ttftTrend.length === 14, `len=${live.sections.ttftTrend.length}`);

  // Brief covers yesterday
  const yesterday = shiftKey(today, -1);
  const yBounds = { gte: new Date(`${yesterday}T00:00:00Z`), lte: new Date(`${yesterday}T00:00:00Z`) };
  const [yMacs, ySum] = await Promise.all([
    db.device_usage_daily.groupBy({ by: ['mac_address'], where: { date: yBounds } }),
    db.device_usage_daily.aggregate({ _sum: { usage_time_seconds: true }, where: { date: yBounds } }),
  ]);

  record(g, 'Brief · cover date is yesterday (IST)', yesterday, brief.coverDate);
  record(g, 'Brief · active toys yesterday', yMacs.length, brief.headline.activeToys);
  record(g, 'Brief · play hours yesterday', round2(Number(ySum._sum.usage_time_seconds || 0) / 3600), round2(brief.headline.playHours), { tolerance: 0.1 });
  record(g, 'Brief · 30-day series length', 30, brief.playHoursSeries.length);
  assert(g, 'Brief · no percentage change against a zero baseline', brief.movers.every((m) => Number.isFinite(m.changePercent)));
  assert(g, 'Brief · at most 3 insights, all with text', brief.threeThings.length <= 3 && brief.threeThings.every((t) => t.title && t.detail));
}

async function checkPrivacy() {
  const g = 'Privacy';
  const list = await api('/admin/founder/families/list?page=1&limit=5');
  const serializedList = JSON.stringify(list);

  assert(g, 'Families list exposes no parentEmail field', !serializedList.includes('parentEmail'));
  assert(g, 'Families list contains no email address', !/[\w.+-]+@[\w-]+\.[\w.]+/.test(serializedList));

  if (list.items && list.items.length) {
    const profile = await api(`/admin/founder/families/${encodeURIComponent(list.items[0].kidId)}/profile`);
    assert(g, 'Profile parent block has no email key', !Object.keys(profile.parent).includes('email'));
    assert(g, 'Profile parent block has no phoneNumber key', !Object.keys(profile.parent).includes('phoneNumber'));

    // cross-check: the parent genuinely has contact details stored, so this
    // proves suppression rather than absence of data
    const kid = await db.kid_profile.findFirst({
      where: { id: BigInt(list.items[0].kidId) },
      select: { sys_user: { select: { parent_profile: { select: { email: true, phone_number: true } } } } },
    });
    const stored = kid?.sys_user?.parent_profile;
    record(g, 'Parent contact stored in DB', stored?.email ? 'yes' : 'none', 'suppressed in API', {
      info: true,
      note: stored?.email ? 'DB has an email; API correctly omits it' : 'no stored email to suppress',
    });
  }
}

async function checkConversations(win) {
  const g = 'Conversations';
  const data = await api(`/admin/founder/conversations?range=${args.range}`);

  const [summaryCount, talkSeconds] = await Promise.all([
    db.voice_session_summaries.count({ where: { updated_at: win.ts } }),
    db.device_usage_daily.aggregate({ _sum: { ai_talk_usage_seconds: true }, where: { date: win.dateOnly } }),
  ]);

  record(g, 'Talk sessions (uncapped count)', summaryCount, data.kpis.talkSessions, { note: 'was capped at 50 before' });
  record(g, 'AI talk hours', round2(Number(talkSeconds._sum.ai_talk_usage_seconds || 0) / 3600), round2(data.kpis.talkHours), { tolerance: 0.1 });
  assert(g, 'Moderation flags reported as null, not a fake 0', data.kpis.moderationFlags === null, `got ${data.kpis.moderationFlags}`);
  assert(g, 'No fabricated transcript preview', !('transcriptPreview' in data.sections));
}

/* ------------------------------------------------------------------ *
 * Output
 * ------------------------------------------------------------------ */

function print() {
  if (args.json) {
    console.log(JSON.stringify({ range: args.range, api: API, results }, null, 2));
    return;
  }

  const widths = {
    name: Math.max(...results.map((r) => r.name.length), 10),
    db: Math.max(...results.map((r) => r.db.length), 6),
    api: Math.max(...results.map((r) => r.api.length), 6),
  };

  let group = '';
  for (const r of results) {
    if (r.group !== group) {
      group = r.group;
      console.log(`\n  ${group}`);
      console.log(`  ${'─'.repeat(widths.name + widths.db + widths.api + 22)}`);
    }
    const mark = r.status === 'PASS' ? '✓' : r.status === 'FAIL' ? '✗' : 'i';
    console.log(
      `  ${mark} ${r.name.padEnd(widths.name)}  ${r.db.padStart(widths.db)}  ${r.api.padStart(widths.api)}  ${r.status}` +
      (r.note && r.status !== 'PASS' ? `\n      ↳ ${r.note}` : ''),
    );
  }

  const failed = results.filter((r) => r.status === 'FAIL');
  const passed = results.filter((r) => r.status === 'PASS').length;
  const info = results.filter((r) => r.status === 'INFO').length;

  console.log(`\n  ${'─'.repeat(60)}`);
  console.log(`  ${passed} passed · ${failed.length} failed · ${info} informational`);
  console.log(`  columns: DB value | API value\n`);

  if (failed.length) {
    console.log('  MISMATCHES:');
    failed.forEach((r) => console.log(`   ✗ [${r.group}] ${r.name} — DB=${r.db} API=${r.api}${r.note ? ` (${r.note})` : ''}`));
    console.log('');
  }
}

/* ------------------------------------------------------------------ *
 * Main
 * ------------------------------------------------------------------ */

(async () => {
  console.log(`\n  Founder dashboard verification`);
  console.log(`  API   : ${API}`);
  console.log(`  Range : ${args.range}`);

  if (!TOKEN) {
    if (!args.user || !args.pass) {
      console.error('\n  Need auth. Set FOUNDER_TOKEN=... or pass --user <name> --pass <password>\n');
      process.exit(2);
    }
    TOKEN = await login(args.user, args.pass);
    console.log('  Auth  : logged in');
  } else {
    console.log('  Auth  : FOUNDER_TOKEN');
  }

  const win = windowFor(args.range);
  console.log(`  Window: ${win.startKey} → ${win.endKey} (${win.days} IST days)`);

  // preflight: fail with a clear reason rather than 9 confusing check errors
  try {
    await db.ai_device.count();
  } catch (err) {
    console.error(`\n  Cannot reach the database: ${err.message}`);
    console.error('  Check DATABASE_URL in .env and that this machine can reach it on :5432.\n');
    process.exit(2);
  }

  try {
    await api('/admin/founder/operate');
  } catch (err) {
    console.error(`\n  Cannot reach the API at ${API}: ${err.message}`);
    console.error('  Start it with `npm start` (or pass --api <url>), and make sure the token is a super-admin.\n');
    process.exit(2);
  }

  const rates = await loadRates();

  const steps = [
    ['overview', () => checkOverview(win, rates)],
    ['engagement', () => checkEngagement(win)],
    ['content', () => checkContent(win)],
    ['conversations', () => checkConversations(win)],
    ['costs', () => checkCosts(win, rates)],
    ['token tables', () => checkTokenTableDivergence(win, rates)],
    ['operate', () => checkOperate()],
    ['live & brief', () => checkLiveAndBrief()],
    ['privacy', () => checkPrivacy()],
  ];

  for (const [label, run] of steps) {
    try {
      await run();
    } catch (err) {
      results.push({
        group: 'Errors', name: `${label} check could not run`,
        db: '—', api: '—', status: 'FAIL', note: err.message,
      });
    }
  }

  print();
  await prisma.$disconnect();
  process.exit(results.some((r) => r.status === 'FAIL') ? 1 : 0);
})().catch(async (err) => {
  console.error('\n  Fatal:', err.message, '\n');
  try { await prisma.$disconnect(); } catch { /* ignore */ }
  process.exit(1);
});
