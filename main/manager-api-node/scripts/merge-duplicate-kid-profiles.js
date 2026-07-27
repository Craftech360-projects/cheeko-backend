/**
 * One-time cleanup: merge duplicate kid_profile rows.
 *
 * Re-running device setup used to insert a fresh kid_profile every time
 * (config.service.js createAndAssignChildProfile), so some parents accumulated
 * several identical children. Duplicates are grouped by
 * (user_id, lower(name), birth_date) and merged into the newest row.
 *
 * Some duplicates carry real history (voice_sessions, memory docs/chunks), and
 * kid_activity_log / kid_learning_progress are ON DELETE NO ACTION, so every
 * reference is repointed to the surviving row BEFORE the delete. Runs in one
 * transaction; writes a JSON backup of the deleted rows first.
 *
 * Usage: DATABASE_URL=... node scripts/merge-duplicate-kid-profiles.js [--apply]
 * Without --apply it prints the plan and rolls back.
 */
const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

const APPLY = process.argv.includes('--apply');

const DUPS_SQL = `
  WITH grp AS (
    SELECT user_id, lower(name) AS lname, birth_date, max(id) AS keep_id
    FROM kid_profile
    WHERE user_id IS NOT NULL
    GROUP BY 1,2,3 HAVING count(*) > 1
  )
  SELECT g.keep_id, k.id AS dup_id, k.user_id, k.name
  FROM grp g
  JOIN kid_profile k
    ON k.user_id = g.user_id
   AND lower(k.name) = g.lname
   AND k.birth_date IS NOT DISTINCT FROM g.birth_date
  WHERE k.id <> g.keep_id
  ORDER BY k.id`;

// Every table with a kid_id FK to kid_profile.
const REFERENCING = [
  'ai_device',
  'voice_sessions',
  'kid_activity_log',
  'kid_learning_progress',
  'device_memory_documents',
  'device_memory_chunks',
];

(async () => {
  const c = new Client({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });
  await c.connect();

  try {
    await c.query('BEGIN');

    const dups = (await c.query(DUPS_SQL)).rows;
    if (!dups.length) {
      console.log('No duplicate kid profiles found.');
      await c.query('ROLLBACK');
      return;
    }

    const dupIds = dups.map(d => d.dup_id);
    const backup = (await c.query(
      'SELECT * FROM kid_profile WHERE id = ANY($1::bigint[])', [dupIds]
    )).rows;
    const backupPath = path.join(__dirname, 'merge-duplicate-kid-profiles.backup.json');
    fs.writeFileSync(backupPath, JSON.stringify(backup, null, 2));
    console.log(`Backed up ${backup.length} rows to ${backupPath}`);

    for (const { dup_id: dupId, keep_id: keepId, user_id: userId, name } of dups) {
      const moved = [];
      for (const table of REFERENCING) {
        const res = await c.query(
          `UPDATE ${table} SET kid_id = $1 WHERE kid_id = $2`, [keepId, dupId]
        );
        if (res.rowCount) moved.push(`${table}=${res.rowCount}`);
      }
      await c.query('DELETE FROM kid_profile WHERE id = $1', [dupId]);
      console.log(
        `user ${userId} "${name}": ${dupId} -> ${keepId}` +
        (moved.length ? ` (${moved.join(', ')})` : ' (no references)')
      );
    }

    const remaining = (await c.query(DUPS_SQL)).rows.length;
    if (remaining) throw new Error(`${remaining} duplicates still present after merge`);

    if (APPLY) {
      await c.query('COMMIT');
      console.log(`\nCommitted. Merged ${dups.length} duplicate profiles.`);
    } else {
      await c.query('ROLLBACK');
      console.log(`\nDry run — rolled back. Re-run with --apply to commit.`);
    }
  } catch (err) {
    await c.query('ROLLBACK');
    console.error('Rolled back:', err.message);
    process.exitCode = 1;
  } finally {
    await c.end();
  }
})();
