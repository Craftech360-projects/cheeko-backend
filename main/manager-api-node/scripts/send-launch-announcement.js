/**
 * SUB-13 pre-launch comms: one announcement push to every notifiable parent
 * with at least one bound device.
 *
 *   node scripts/send-launch-announcement.js           # dry run: counts only
 *   node scripts/send-launch-announcement.js --apply   # send
 *
 * Notifiable = parent_profile with an FCM token and push_notifications on —
 * the same definition pushNotification.service uses everywhere else. Tokens
 * are deduped, so a parent with several devices gets ONE push. Sends are
 * at-most-once per run; re-running --apply re-sends, so run it once on comms
 * day (stale-token failures are logged and skipped, never retried).
 */

require('dotenv').config();
const { prisma } = require('../src/config/database');
const { sendPushNotification } = require('../src/services/pushNotification.service');

const PUSH = {
  title: 'Cheeko plans are coming 🎉',
  body:
    'Your first month is on us — every Cheeko gets a free month of the Family plan at launch. ' +
    'Nothing to do today; pick a plan in the app when your free month ends.',
};

const main = async () => {
  const apply = process.argv.includes('--apply');

  const parents = await prisma.parent_profile.findMany({
    where: {
      fcm_token: { not: null },
      push_notifications: true,
      sys_user: { ai_device: { some: {} } },
    },
    select: { fcm_token: true },
  });
  const tokens = [...new Set(parents.map((p) => p.fcm_token))];
  console.log(`${parents.length} notifiable parents; ${tokens.length} unique FCM tokens.`);

  if (!apply) {
    console.log('Dry run — nothing sent. Re-run with --apply to send.');
    return;
  }

  let sent = 0;
  let failed = 0;
  for (const token of tokens) {
    const ok = await sendPushNotification(token, PUSH.title, PUSH.body, {
      type: 'launch_announcement',
    });
    if (ok) sent += 1;
    else failed += 1;
  }
  console.log(`Sent ${sent}; failed ${failed} (stale/expired tokens — expected, not retried).`);
};

if (require.main === module) {
  main()
    .catch((e) => {
      console.error(e);
      process.exitCode = 1;
    })
    .finally(() => prisma.$disconnect());
}

module.exports = { main, PUSH };
