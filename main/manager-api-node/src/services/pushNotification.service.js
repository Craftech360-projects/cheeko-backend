/**
 * Push Notification Service
 *
 * Sends push notifications via the Firebase Admin SDK. Reuses the same
 * Firebase Admin app already initialised for verifying Flutter ID tokens
 * (see middleware/firebaseAuth.js) — same project, credentials already
 * proven working on every authenticated mobile request.
 */

const admin = require('firebase-admin');
const { ensureFirebaseInit } = require('../middleware/firebaseAuth');
const { prisma } = require('../config/database');
const logger = require('../utils/logger');

/**
 * The bound parent's FCM token for a device, or null if there is nobody to
 * notify — unbound, no token registered, or push notifications turned off.
 *
 * Lives here so the trial reminder cron and the plan gate cannot drift apart on
 * what "a notifiable parent" means.
 *
 * @param {string} macAddress - normalised, colon-separated uppercase
 * @returns {Promise<string|null>}
 */
const findParentFcmToken = async (macAddress) => {
  const device = await prisma.ai_device.findFirst({
    where: {
      mac_address: macAddress,
      user_id: { not: null },
      sys_user: {
        parent_profile: { fcm_token: { not: null }, push_notifications: true },
      },
    },
    select: {
      sys_user: { select: { parent_profile: { select: { fcm_token: true } } } },
    },
  });
  return device?.sys_user?.parent_profile?.fcm_token || null;
};

/**
 * Send a push notification to a single FCM token.
 * @param {string} fcmToken
 * @param {string} title
 * @param {string} body
 * @param {Object<string,string>} [data] - optional FCM data payload for app-side
 *   deep-linking (e.g. { type: 'plan_gate', reason: 'trial_ended' }). FCM
 *   requires all data values to be strings.
 * @returns {Promise<boolean>} true if the send succeeded
 */
const sendPushNotification = async (fcmToken, title, body, data) => {
  if (!fcmToken) return false;
  if (!ensureFirebaseInit()) {
    logger.warn('Firebase Admin SDK not initialised — skipping push notification');
    return false;
  }

  try {
    await admin.messaging().send({
      token: fcmToken,
      notification: { title, body },
      ...(data ? { data } : {}),
    });
    return true;
  } catch (error) {
    logger.warn(`Failed to send push notification to token ${fcmToken.slice(0, 12)}...: ${error.message}`);
    return false;
  }
};

module.exports = { sendPushNotification, findParentFcmToken };
