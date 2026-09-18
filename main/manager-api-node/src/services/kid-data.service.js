/**
 * Kid Data Service
 *
 * Two jobs: delete everything stored about a child when the child is deleted,
 * and expire a child's raw conversation data after a retention window. Both
 * exist for COPPA-style obligations (a parent's delete request must actually
 * delete; nothing is kept indefinitely) — see docs/child-memory-storage-review.md
 * section 5.
 *
 * What counts as the child's data is decided HERE, in one list, so a new
 * per-child table has one place to be added. Rows with kid_id NULL (the device
 * before a child was paired) are the device's, and device unbind purges those
 * (device.service clearUnattributedDeviceRows).
 */

const { prisma } = require('../config/database');
const logger = require('../utils/logger');

// Everything the child said, produced or progressed through: deleted.
// voice_sessions is NOT here: deleting a session cascades its
// device_token_usage_session row, which usage accounting reads. The session's
// messages and summary (what the child said) are deleted and the session row is
// detached instead — see purgeKidData.
const KID_OWNED_TABLES = [
  'voice_session_summaries',
  'child_facts',
  'quiz_question_answer',
  'riddle_question_answer',
  'math_question_answer',
  'question_attempt',
  'kid_content_seen',
  'kid_character_state',
  'kid_session_progress',
  'kid_wonder_question',
  'kid_activity_log',
  'kid_learning_progress',
  'device_kid_assignment',
  'device_memory_documents',
  'device_memory_chunks',
];

// Tables keyed by owner key instead of kid_id.
const KID_OWNER_KEY_TABLES = ['device_workspace_artifacts', 'device_memory_documents', 'device_memory_chunks'];

// Device usage counters that merely carry the kid for reporting: the kid link is
// removed, the device-level count is kept.
// ponytail: detached, not deleted, to keep founder metrics. If counsel rules
// usage counts are the child's personal data, move these to KID_OWNED_TABLES.
const KID_TAGGED_COUNTERS = [
  'rfid_card_tap_log',
  'device_analytics_event',
  'device_usage_daily',
  'device_card_taps_daily',
  'device_ai_interactions_daily',
  'device_games_played',
  'device_radio_played',
  'analytics_user_progress',
];

const ownerKeyForKid = (kidId) => `kid:${BigInt(kidId)}`;

/**
 * Delete or detach every row belonging to one child. Call inside the same
 * transaction that deletes the kid_profile, BEFORE that delete: kid_activity_log
 * and kid_learning_progress reference the profile with ON DELETE NO ACTION.
 *
 * S3 objects cannot be deleted inside a transaction, so the imagine picture keys
 * are returned for the caller to sweep after the commit (sweepKidObjects).
 *
 * @returns {Promise<{imagineKeys: string[]}>}
 */
const purgeKidData = async (tx, kidId) => {
  const kid = BigInt(kidId);
  const ownerKey = ownerKeyForKid(kid);

  const kidSession = { voice_sessions: { kid_id: kid } };
  await tx.voice_session_messages.deleteMany({ where: kidSession });
  await tx.voice_session_summaries.deleteMany({ where: kidSession });
  await tx.voice_sessions.updateMany({ where: { kid_id: kid }, data: { kid_id: null } });

  for (const model of KID_OWNED_TABLES) {
    await tx[model].deleteMany({ where: { kid_id: kid } });
  }
  for (const model of KID_OWNER_KEY_TABLES) {
    await tx[model].deleteMany({ where: { owner_key: ownerKey } });
  }
  for (const model of KID_TAGGED_COUNTERS) {
    await tx[model].updateMany({ where: { kid_id: kid }, data: { kid_id: null } });
  }

  const images = await tx.imagine_image.findMany({ where: { owner_key: ownerKey }, select: { s3_key: true } });
  await tx.imagine_image.deleteMany({ where: { owner_key: ownerKey } });

  return { imagineKeys: images.map((row) => row.s3_key) };
};

/**
 * Delete the child's pictures from storage after the database commit. Best-effort:
 * an orphaned object is the cheaper failure than rows pointing at missing files.
 */
const sweepKidObjects = async ({ imagineKeys = [] } = {}) => {
  if (!imagineKeys.length) return;
  // Required lazily: loading the S3 client is not needed to purge rows.
  const { deleteImagineObject } = require('./upload.service');
  for (const key of imagineKeys) {
    await deleteImagineObject(key);
  }
};

/**
 * The whole delete for callers with no storage sweep of their own (the web
 * profile and admin paths): unpair, purge, drop the custom pack and the profile
 * in one transaction, then sweep storage after the commit. The mobile paths do
 * the same steps inline and leave the sweep to their route.
 */
const deleteKidCompletely = async (kidId) => {
  const kid = BigInt(kidId);
  // Lazy: mobile.service requires this module at load.
  const { deleteCustomPackForKid } = require('./mobile.service');
  const uploadService = require('./upload.service');

  const profile = await prisma.kid_profile.findUnique({ where: { id: kid }, select: { avatar_url: true } });
  if (!profile) throw new Error('Kid profile not found');

  let purged = { imagineKeys: [] };
  let retired = [];
  await prisma.$transaction(async (tx) => {
    await tx.ai_device.updateMany({ where: { kid_id: kid }, data: { kid_id: null, update_date: new Date() } });
    purged = await purgeKidData(tx, kid);
    retired = await deleteCustomPackForKid(tx, kid);
    await tx.kid_profile.delete({ where: { id: kid } });
  }, { timeout: 30000 });

  await uploadService.deleteKidAvatarByUrl(profile.avatar_url);
  for (const url of retired) {
    // Stored as <publicBase>/<key>; deleteCustomCardObject refuses anything outside customcard.
    await uploadService.deleteCustomCardObject(String(url).split('/').slice(3).join('/'));
  }
  await sweepKidObjects(purged);
};

/**
 * Days a child's raw conversation data is kept. Unset or invalid = no expiry:
 * the window is a legal/product decision, so this deletes nothing until someone
 * sets CHILD_DATA_RETENTION_DAYS.
 */
const retentionDays = () => {
  const days = parseInt(process.env.CHILD_DATA_RETENTION_DAYS, 10);
  return Number.isFinite(days) && days > 0 ? days : null;
};

/**
 * Expire raw conversation data older than the window: session transcripts and
 * summaries, speech-recognition text on quiz attempts, legacy chat history, and
 * facts the child has not mentioned within the window. Session rows stay (usage
 * accounting hangs off them) and learning progress (quiz answers, levels) is not
 * conversation, so both are kept until the child is deleted.
 *
 * @returns {Promise<{days: number|null, deleted: Object}>}
 */
const expireOldChildData = async ({ now = new Date(), days = retentionDays() } = {}) => {
  if (!days) return { days: null, deleted: {} };
  const cutoff = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);

  const results = await prisma.$transaction([
    prisma.voice_session_messages.deleteMany({ where: { created_at: { lt: cutoff } } }),
    prisma.voice_session_summaries.deleteMany({ where: { updated_at: { lt: cutoff } } }),
    prisma.ai_agent_chat_history.deleteMany({ where: { created_at: { lt: cutoff } } }),
    prisma.question_attempt.updateMany({
      where: { answered_at: { lt: cutoff }, transcript: { not: null } },
      data: { transcript: null },
    }),
    prisma.child_facts.deleteMany({ where: { last_seen: { lt: cutoff } } }),
  ]);

  const deleted = {
    voice_session_messages: results[0].count,
    voice_session_summaries: results[1].count,
    ai_agent_chat_history: results[2].count,
    question_attempt_transcripts: results[3].count,
    child_facts: results[4].count,
  };
  logger.info(`[retention] expired child data older than ${days} days ${JSON.stringify(deleted)}`);
  return { days, deleted };
};

let retentionCronJob = null;

/** Daily at 03:30 server time. No-op (and says so) while no window is set. */
const startChildDataRetentionCron = async () => {
  if (!retentionDays()) {
    logger.info('[retention] CHILD_DATA_RETENTION_DAYS not set; child data expiry is off');
    return;
  }
  const cron = require('node-cron');
  if (retentionCronJob) retentionCronJob.stop();
  retentionCronJob = cron.schedule('30 3 * * *', () => {
    expireOldChildData().catch((error) => logger.error(`[retention] expiry failed: ${error.message}`));
  });
  logger.info(`[retention] child data expiry scheduled daily 03:30, window ${retentionDays()} days`);
};

const stopChildDataRetentionCron = () => {
  if (retentionCronJob) {
    retentionCronJob.stop();
    retentionCronJob = null;
  }
};

module.exports = {
  KID_OWNED_TABLES,
  KID_OWNER_KEY_TABLES,
  KID_TAGGED_COUNTERS,
  purgeKidData,
  sweepKidObjects,
  deleteKidCompletely,
  expireOldChildData,
  startChildDataRetentionCron,
  stopChildDataRetentionCron,
};
