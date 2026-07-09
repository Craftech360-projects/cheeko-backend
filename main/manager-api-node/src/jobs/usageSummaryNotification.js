/**
 * Daily/Weekly Usage Summary Notification Cron Jobs
 *
 * Daily: every day at 10pm IST — notifies each parent of that day's usage.
 * Weekly: every Sunday at 10pm IST — notifies each parent of that week's
 * (Monday-Sunday) usage.
 *
 * Devices with zero usage in the period are skipped silently (no "0 minutes"
 * notification). Asia/Kolkata has a fixed UTC+5:30 offset (no DST), so date
 * boundaries are computed with a simple fixed-offset shift rather than a
 * timezone library.
 *
 * Usage:
 * - Import and call startUsageSummaryCrons() when the server starts
 */

const logger = require('../utils/logger');
const { prisma } = require('../config/database');
const { sendPushNotification } = require('../services/pushNotification.service');

const TIMEZONE = 'Asia/Kolkata';
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

let dailyCronJob = null;
let weeklyCronJob = null;
let dailyRunning = false;
let weeklyRunning = false;

function startOfDayIST(referenceDate = new Date()) {
  const shifted = new Date(referenceDate.getTime() + IST_OFFSET_MS);
  const y = shifted.getUTCFullYear();
  const m = shifted.getUTCMonth();
  const d = shifted.getUTCDate();
  return new Date(Date.UTC(y, m, d) - IST_OFFSET_MS);
}

function startOfWeekIST(referenceDate = new Date()) {
  const startToday = startOfDayIST(referenceDate);
  const istCalendarDate = new Date(startToday.getTime() + IST_OFFSET_MS);
  const dayOfWeek = istCalendarDate.getUTCDay(); // 0=Sun..6=Sat
  const diffToMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
  return new Date(startToday.getTime() - diffToMonday * 24 * 60 * 60 * 1000);
}

function formatDuration(totalSeconds) {
  const minutes = Math.round(totalSeconds / 60);
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'}`;
  const hours = Math.floor(minutes / 60);
  const remMinutes = minutes % 60;
  return remMinutes > 0 ? `${hours}h ${remMinutes}m` : `${hours}h`;
}

async function getNotifiableDevices() {
  return prisma.ai_device.findMany({
    where: {
      user_id: { not: null },
      sys_user: {
        parent_profile: {
          fcm_token: { not: null },
          push_notifications: true,
        },
      },
    },
    select: {
      mac_address: true,
      alias: true,
      sys_user: {
        select: {
          parent_profile: { select: { fcm_token: true } },
        },
      },
    },
  });
}

async function getUsageByMac(macAddresses, startDate, now) {
  if (macAddresses.length === 0) return new Map();

  const aggregates = await prisma.analytics_game_sessions.groupBy({
    by: ['mac_address'],
    where: {
      mac_address: { in: macAddresses },
      started_at: { gte: startDate, lte: now },
    },
    _sum: { duration_seconds: true },
    _count: { id: true },
  });

  const usageByMac = new Map();
  for (const row of aggregates) {
    usageByMac.set(row.mac_address, {
      sessionCount: row._count.id,
      totalSeconds: row._sum.duration_seconds || 0,
    });
  }
  return usageByMac;
}

async function runSummary({ startDate, buildTitle, buildBody }) {
  const now = new Date();
  const devices = await getNotifiableDevices();
  if (devices.length === 0) return { sent: 0, skipped: 0 };

  const macAddresses = devices.map((d) => d.mac_address);
  const usageByMac = await getUsageByMac(macAddresses, startDate, now);

  let sent = 0;
  let skipped = 0;

  for (const device of devices) {
    const usage = usageByMac.get(device.mac_address);
    if (!usage || usage.sessionCount === 0) {
      skipped += 1;
      continue;
    }

    const fcmToken = device.sys_user?.parent_profile?.fcm_token;
    if (!fcmToken) {
      skipped += 1;
      continue;
    }

    const durationText = formatDuration(usage.totalSeconds);
    const deviceName = device.alias || 'Cheeko';
    const ok = await sendPushNotification(
      fcmToken,
      buildTitle(),
      buildBody(deviceName, durationText, usage.sessionCount),
    );
    if (ok) sent += 1;
    else skipped += 1;
  }

  return { sent, skipped };
}

async function runDailySummary() {
  if (dailyRunning) {
    logger.warn('Daily usage summary already running, skipping this execution');
    return;
  }
  dailyRunning = true;
  try {
    const result = await runSummary({
      startDate: startOfDayIST(),
      buildTitle: () => "Today's Cheeko recap \u{1F4CA}",
      buildBody: (deviceName, durationText, sessionCount) =>
        `${deviceName} played for ${durationText} across ${sessionCount} session${sessionCount === 1 ? '' : 's'} today.`,
    });
    logger.info(`Daily usage summary: sent=${result.sent} skipped=${result.skipped}`);
  } catch (error) {
    logger.error('Failed to run daily usage summary:', error);
  } finally {
    dailyRunning = false;
  }
}

async function runWeeklySummary() {
  if (weeklyRunning) {
    logger.warn('Weekly usage summary already running, skipping this execution');
    return;
  }
  weeklyRunning = true;
  try {
    const result = await runSummary({
      startDate: startOfWeekIST(),
      buildTitle: () => 'This week with Cheeko \u{1F4CA}',
      buildBody: (deviceName, durationText, sessionCount) =>
        `${deviceName} played for ${durationText} across ${sessionCount} session${sessionCount === 1 ? '' : 's'} this week.`,
    });
    logger.info(`Weekly usage summary: sent=${result.sent} skipped=${result.skipped}`);
  } catch (error) {
    logger.error('Failed to run weekly usage summary:', error);
  } finally {
    weeklyRunning = false;
  }
}

/**
 * Start both cron jobs.
 * @param {Object} options
 * @param {string} options.timezone - Timezone for scheduling, default 'Asia/Kolkata'
 */
const startUsageSummaryCrons = async (options = {}) => {
  let cron;
  try {
    cron = require('node-cron');
  } catch (error) {
    logger.warn('node-cron not installed. Usage summary notifications will not be scheduled.');
    return;
  }

  const { timezone = TIMEZONE } = options;

  if (dailyCronJob) dailyCronJob.stop();
  if (weeklyCronJob) weeklyCronJob.stop();

  // Every day at 10pm
  dailyCronJob = cron.schedule('0 22 * * *', runDailySummary, {
    scheduled: true,
    timezone,
  });

  // Every Sunday at 10pm
  weeklyCronJob = cron.schedule('0 22 * * 0', runWeeklySummary, {
    scheduled: true,
    timezone,
  });

  logger.info(`Usage summary notification cron jobs started (daily 22:00, weekly Sun 22:00 ${timezone})`);
};

const stopUsageSummaryCrons = () => {
  if (dailyCronJob) {
    dailyCronJob.stop();
    dailyCronJob = null;
  }
  if (weeklyCronJob) {
    weeklyCronJob.stop();
    weeklyCronJob = null;
  }
  logger.info('Usage summary notification cron jobs stopped');
};

module.exports = {
  startUsageSummaryCrons,
  stopUsageSummaryCrons,
  runDailySummary,
  runWeeklySummary,
};
