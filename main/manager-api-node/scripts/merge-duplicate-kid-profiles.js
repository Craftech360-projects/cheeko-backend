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

// Every table with a kid_id column pointing at kid_profile.
const REFERENCING = [
  'ai_device',
  'voice_sessions',
  'kid_activity_log',
  'kid_learning_progress',
  'device_memory_documents',
  'device_memory_chunks',
  'device_kid_assignment',
  'quiz_question_answer',
  'riddle_question_answer',
];

/**
 * Tables where the child's identity is the owner_key, not kid_id.
 *
 * Moving kid_id alone would leave these rows keyed to 'kid:<deleted-id>' — the
 * merged child's workspace and memory would still exist and be unreachable,
 * which is the exact failure the owner key was introduced to prevent. The
 * unique column is how a collision is detected when both profiles hold the same
 * file or document.
 */
const OWNER_KEYED = [
  { table: 'device_workspace_artifacts', unique: 'relative_path', newest: 'updated_at' },
  { table: 'device_memory_documents', unique: 'document_key', newest: 'updated_at' },
  { table: 'device_memory_chunks', unique: 'content_hash', newest: 'created_at' },
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

    // Rows dropped when both profiles hold the same file or document. Backed up
    // alongside the kid_profile rows, since nothing else records them.
    const discarded = [];

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

      // Owner-keyed tables carry the child's identity in owner_key; kid_id there
      // is a denormalised audit column nobody reads. Both profiles may hold the
      // same path or document, so drop the older side first — the unique index
      // on (owner_key, <unique>) would otherwise reject the move.
      const dupKey = `kid:${dupId}`;
      const keepKey = `kid:${keepId}`;
      for (const { table, unique, newest } of OWNER_KEYED) {
        // Newest wins each collision, matching the owner_key migration's rule.
        // Everything dropped is captured first: this is the only place in the
        // script that destroys rows the kid_profile backup does not cover.
        const losers = await c.query(
          `SELECT loser.* FROM ${table} loser
             JOIN ${table} winner
               ON winner.${unique} = loser.${unique}
              AND winner.owner_key IN ($1, $2)
              AND winner.owner_key <> loser.owner_key
            WHERE loser.owner_key IN ($1, $2)
              AND (loser.${newest}, loser.id) < (winner.${newest}, winner.id)`,
          [dupKey, keepKey]
        );
        if (losers.rowCount) {
          discarded.push(...losers.rows.map((row) => ({ table, row })));
          await c.query(
            `DELETE FROM ${table} WHERE id::text = ANY($1::text[])`,
            [losers.rows.map((r) => String(r.id))]
          );
        }

        const res = await c.query(
          `UPDATE ${table} SET owner_key = $1 WHERE owner_key = $2`, [keepKey, dupKey]
        );
        if (res.rowCount) moved.push(`${table}.owner_key=${res.rowCount}`);
      }
      await c.query('DELETE FROM kid_profile WHERE id = $1', [dupId]);
      console.log(
        `user ${userId} "${name}": ${dupId} -> ${keepId}` +
        (moved.length ? ` (${moved.join(', ')})` : ' (no references)')
      );
    }

    if (discarded.length) {
      const discardPath = path.join(__dirname, 'merge-duplicate-kid-profiles.discarded.json');
      fs.writeFileSync(discardPath, JSON.stringify(discarded, null, 2));
      console.log(`Discarded ${discarded.length} colliding owner-keyed rows -> ${discardPath}`);
    }

    const remaining = (await c.query(DUPS_SQL)).rows.length;
    if (remaining) throw new Error(`${remaining} duplicates still present after merge`);

    // Nothing may be left pointing at a profile that is about to disappear.
    for (const { table } of OWNER_KEYED) {
      const orphans = await c.query(
        `SELECT count(*)::int AS n FROM ${table}
          WHERE owner_key LIKE 'kid:%'
            AND NOT EXISTS (
              SELECT 1 FROM kid_profile k
               WHERE 'kid:' || k.id::text = ${table}.owner_key)`
      );
      if (orphans.rows[0].n) {
        throw new Error(`${table}: ${orphans.rows[0].n} rows key a kid_profile that no longer exists`);
      }
    }

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
