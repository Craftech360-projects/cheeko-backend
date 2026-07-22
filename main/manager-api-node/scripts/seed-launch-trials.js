/**
 * SUB-13 launch seed: grant the launch-day Family trial to every bound device
 * that has no device_subscriptions row yet.
 *
 *   node scripts/seed-launch-trials.js           # dry run (default): report only
 *   node scripts/seed-launch-trials.js --apply   # write
 *
 * Idempotent: rows are created via subscription.service ensureTrialForMac — an
 * atomic create-if-absent upsert — so re-runs create no duplicates and devices
 * that already have a row (active subs, earlier trials) are never touched.
 *
 * Launch-window rule (SUB-13): run AFTER schema deploy and BEFORE flipping
 * ENFORCEMENT_ENABLED — once enforcement is on, a bound device with no row is
 * treated as lapsed. The coverage check at the end exits non-zero if any bound
 * MAC is still uncovered, so the flip has a hard gate.
 */

require('dotenv').config();
const { prisma } = require('../src/config/database');
const { ensureTrialForMac } = require('../src/services/subscription.service');
const { normalizeMacAddress } = require('../src/utils/helpers');

const subscribedMacs = async () => {
  const rows = await prisma.device_subscriptions.findMany({ select: { mac_address: true } });
  return new Set(rows.map((r) => r.mac_address));
};

const main = async () => {
  const apply = process.argv.includes('--apply');

  const bound = await prisma.ai_device.findMany({
    where: { user_id: { not: null } },
    select: { mac_address: true, user_id: true },
  });
  const existing = await subscribedMacs();
  const missing = bound.filter((d) => !existing.has(normalizeMacAddress(d.mac_address)));

  console.log(
    `${bound.length} bound devices; ${bound.length - missing.length} already have a subscription row; ${missing.length} to seed.`
  );
  if (!apply) {
    console.log('Dry run — nothing written. Re-run with --apply to seed.');
    return;
  }

  let seeded = 0;
  let invalid = 0;
  for (const d of missing) {
    const row = await ensureTrialForMac(d.mac_address, d.user_id);
    if (row) seeded += 1;
    else {
      invalid += 1; // null = MAC failed normalization
      console.error(`Invalid MAC on bound device, not seeded: "${d.mac_address}"`);
    }
  }
  console.log(`Seeded ${seeded} trial rows; ${invalid} invalid MACs skipped.`);

  // Acceptance gate: every bound MAC must now have a row before the flag flips.
  const after = await subscribedMacs();
  const uncovered = bound.filter((d) => {
    const mac = normalizeMacAddress(d.mac_address);
    return mac && !after.has(mac);
  });
  if (uncovered.length || invalid) {
    console.error(
      `COVERAGE FAIL: ${uncovered.length} bound MACs still uncovered, ${invalid} invalid — do NOT flip ENFORCEMENT_ENABLED.`
    );
    uncovered.forEach((d) => console.error(`  missing: ${d.mac_address}`));
    process.exitCode = 1;
  } else {
    console.log('Coverage OK: every bound MAC has a subscription row. Safe to flip enforcement.');
  }
};

if (require.main === module) {
  main()
    .catch((e) => {
      console.error(e);
      process.exitCode = 1;
    })
    .finally(() => prisma.$disconnect());
}

module.exports = { main };
