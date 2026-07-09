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
const logger = require('../utils/logger');

/**
 * Send a push notification to a single FCM token.
 * @param {string} fcmToken
 * @param {string} title
 * @param {string} body
 * @returns {Promise<boolean>} true if the send succeeded
 */
const sendPushNotification = async (fcmToken, title, body) => {
  if (!fcmToken) return false;
  if (!ensureFirebaseInit()) {
    logger.warn('Firebase Admin SDK not initialised — skipping push notification');
    return false;
  }

  try {
    await admin.messaging().send({
      token: fcmToken,
      notification: { title, body },
    });
    return true;
  } catch (error) {
    logger.warn(`Failed to send push notification to token ${fcmToken.slice(0, 12)}...: ${error.message}`);
    return false;
  }
};

module.exports = { sendPushNotification };
