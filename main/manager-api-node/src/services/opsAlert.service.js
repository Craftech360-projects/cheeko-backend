/**
 * Ops Alert Service (SUB-11)
 *
 * Fire-and-forget operational alerts to Slack (SLACK_ALERT_WEBHOOK_URL) and/or
 * email (ALERT_EMAIL_TO + the SMTP_* vars emailReport already uses). A lost
 * alert must never fail the caller — every path swallows and logs.
 *
 * Three producers (spec §7): RevenueCat webhook failures, enforcement
 * fail-open events, and a billing-issue spike. `oncePerDay` keys dedupe the
 * spiky ones so a bad hour doesn't page 500 times.
 */

const logger = require('../utils/logger');

// ponytail: in-memory day-keyed dedupe — single pm2 process; move to a DB
// claim (like bucket_alert_sent_at) if this ever runs multi-instance.
const sentToday = new Map(); // key -> 'YYYY-MM-DD'

const todayKey = (now = new Date()) => now.toISOString().slice(0, 10);

/** True the first time this key fires today, false after. */
const claimOncePerDay = (key, now = new Date()) => {
  const day = todayKey(now);
  if (sentToday.get(key) === day) return false;
  sentToday.set(key, day);
  return true;
};

const sendSlack = async (text) => {
  const url = process.env.SLACK_ALERT_WEBHOOK_URL;
  if (!url) return false;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text }),
  });
  if (!res.ok) throw new Error(`Slack webhook HTTP ${res.status}`);
  return true;
};

const sendEmail = async (subject, text) => {
  const to = process.env.ALERT_EMAIL_TO;
  if (!to || !process.env.SMTP_HOST) return false;
  const nodemailer = require('nodemailer');
  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: parseInt(process.env.SMTP_PORT || '587', 10),
    secure: process.env.SMTP_SECURE === 'true',
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
  });
  await transporter.sendMail({
    from: process.env.SMTP_FROM || process.env.SMTP_USER,
    to,
    subject,
    text,
  });
  return true;
};

/**
 * Send an ops alert. Never throws; never awaited by hot paths.
 *
 * @param {string} type - short slug ('rc_webhook' | 'fail_open' | 'billing_spike')
 * @param {string} message - human-readable body
 * @param {Object} [opts]
 * @param {string} [opts.oncePerDayKey] - if set, only the first call per UTC day
 *   with this key actually sends
 * @returns {Promise<boolean>} true if at least one channel delivered
 */
const sendOpsAlert = async (type, message, { oncePerDayKey, now = new Date() } = {}) => {
  try {
    // Claim BEFORE sending: a flapping channel must not turn into an alert
    // storm. Tradeoff: a failed send burns the day's claim (it still logs).
    if (oncePerDayKey && !claimOncePerDay(oncePerDayKey, now)) return false;
    const text = `[CHEEKO ALERT] [${type}] ${message}`;
    logger.error(text); // alerts always land in the logs even with no channel up
    const results = await Promise.allSettled([
      sendSlack(text),
      sendEmail(`[Cheeko alert] ${type}`, message),
    ]);
    const delivered = results.some((r) => r.status === 'fulfilled' && r.value === true);
    for (const r of results) {
      if (r.status === 'rejected') logger.warn(`[OPS-ALERT] channel failed: ${r.reason.message}`);
    }
    return delivered;
  } catch (err) {
    logger.warn(`[OPS-ALERT] alert "${type}" errored: ${err.message}`);
    return false;
  }
};

/** Test hook: forget dedupe claims. */
const _resetDedupe = () => sentToday.clear();

module.exports = { sendOpsAlert, _resetDedupe };
