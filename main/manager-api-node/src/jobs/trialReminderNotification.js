/**
 * Trial Reminder Cron (SUB-2 criterion 5)
 *
 * Sends the parent a push on day 23, 27 and 30 of a device's 30-day trial —
 * exactly once each, per device, ever.
 *
 * This job is NOT the enforcer. Trial expiry is computed lazily by the verdict
 * (subscription.service.js), so a cron that never runs costs reminders, never
 * correctness. That separation is the point: see the ticket.
 *
 * Exactly-once comes from the database, not from this job remembering anything.
 * Each day is "claimed" with a conditional UPDATE on last_reminder_day; only the
 * caller whose UPDATE matched a row sends. A restart, an overlapping run, or a
 * second instance therefore cannot double-push a parent.
 *
 * Usage: startTrialReminderCron() at server start.
 */

const logger = require('../utils/logger');
const { prisma } = require('../config/database');
const { sendPushNotification, findParentFcmToken } = require('../services/pushNotification.service');

const TIMEZONE = 'Asia/Kolkata';
const TRIAL_DAYS = 30;
const REMINDER_DAYS = [23, 27, 30];
const MS_PER_DAY = 24 * 60 * 60 * 1000;

let reminderCronJob = null;
let running = false;

/** Whole days since the trial started. Day 0 is the bind day. */
function daysElapsed(trialStartedAt, now) {
  return Math.floor((now.getTime() - trialStartedAt.getTime()) / MS_PER_DAY);
}

/**
 * The reminder this device is owed, or null. If a device was offline past
 * several milestones we send only the most recent one — three notifications in
 * one evening reads as a bug to a parent, and the older copy is stale anyway.
 */
function dueReminderDay(elapsed, lastSent) {
  const floor = lastSent ?? -1;
  const due = REMINDER_DAYS.filter((d) => d <= elapsed && d > floor);
  return due.length ? due[due.length - 1] : null;
}

function buildCopy(day) {
  const daysLeft = TRIAL_DAYS - day;
  if (daysLeft <= 0) {
    return {
      title: 'Cheeko’s free trial ends today',
      body: 'Choose a plan in the Cheeko app to keep the conversations going.',
    };
  }
  return {
    title: `Cheeko’s free trial ends in ${daysLeft} day${daysLeft === 1 ? '' : 's'}`,
    body: 'Pick a plan in the Cheeko app so playtime carries on uninterrupted.',
  };
}

/**
 * Claim `day` for this device. Returns true only for the caller that won.
 * The WHERE doubles as the guard: concurrent callers cannot both match.
 */
async function claimReminderDay(macAddress, day) {
  const claimed = await prisma.device_subscriptions.updateMany({
    where: {
      mac_address: macAddress,
      status: 'trial',
      OR: [{ last_reminder_day: null }, { last_reminder_day: { lt: day } }],
    },
    data: { last_reminder_day: day, updated_at: new Date() },
  });
  return claimed.count > 0;
}

async function runTrialReminders() {
  if (running) {
    logger.warn('[TRIAL-REMINDER] Previous run still in progress, skipping');
    return { sent: 0, skipped: 0 };
  }
  running = true;
  const now = new Date();
  let sent = 0;
  let skipped = 0;

  try {
    const candidates = await prisma.device_subscriptions.findMany({
      where: { status: 'trial', trial_started_at: { not: null } },
      select: { mac_address: true, trial_started_at: true, last_reminder_day: true },
    });

    for (const row of candidates) {
      const day = dueReminderDay(daysElapsed(row.trial_started_at, now), row.last_reminder_day);
      if (day === null) continue;

      // Look the token up *before* claiming: claiming for a parent we cannot
      // reach would burn the milestone and they would never hear about it.
      const fcmToken = await findParentFcmToken(row.mac_address);
      if (!fcmToken) {
        skipped++;
        continue;
      }

      // ponytail: claim-then-send is at-most-once — a send that fails after the
      // claim loses that reminder rather than risking a double-push. Day 27/30
      // still follow. Swap to an outbox only if lost reminders show up as a
      // real complaint.
      if (!(await claimReminderDay(row.mac_address, day))) {
        skipped++;
        continue;
      }

      const { title, body } = buildCopy(day);
      // sendPushNotification reports failure by returning false, it does not
      // throw — counting an unsent push as sent would make this job lie.
      const delivered = await sendPushNotification(fcmToken, title, body);
      if (delivered) {
        sent++;
        logger.info(`[TRIAL-REMINDER] Day ${day} push sent for ${row.mac_address}`);
      } else {
        // The day stays claimed on purpose — see above.
        logger.error(`[TRIAL-REMINDER] Day ${day} push FAILED for ${row.mac_address}`);
      }
    }

    logger.info(
      `[TRIAL-REMINDER] Run complete: ${candidates.length} trials checked, ${sent} sent, ${skipped} skipped`
    );
  } catch (error) {
    logger.error(`[TRIAL-REMINDER] Run failed: ${error.message}`);
  } finally {
    running = false;
  }

  return { sent, skipped };
}

const startTrialReminderCron = async (options = {}) => {
  let cron;
  try {
    cron = require('node-cron');
  } catch (error) {
    logger.warn('node-cron not installed. Trial reminders will not be scheduled.');
    return;
  }

  const { timezone = TIMEZONE } = options;
  if (reminderCronJob) reminderCronJob.stop();

  // 10am IST daily — a trial milestone is a "sort this out today" nudge, so it
  // wants the morning, not the 10pm slot the usage summaries use.
  reminderCronJob = cron.schedule('0 10 * * *', runTrialReminders, {
    scheduled: true,
    timezone,
  });

  logger.info(`Trial reminder cron started (daily 10:00 ${timezone})`);
};

const stopTrialReminderCron = () => {
  if (reminderCronJob) {
    reminderCronJob.stop();
    reminderCronJob = null;
  }
  logger.info('Trial reminder cron stopped');
};

module.exports = {
  startTrialReminderCron,
  stopTrialReminderCron,
  runTrialReminders,
  // exported for tests
  dueReminderDay,
  daysElapsed,
  buildCopy,
};
