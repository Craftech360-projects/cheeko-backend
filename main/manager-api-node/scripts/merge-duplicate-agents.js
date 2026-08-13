/**
 * Merge duplicate character rows within an account.
 *
 * The app created one agent per toy activation and the server normalised their
 * names together, so accounts hold several rows all called Cheeko — one holds
 * fourteen. See docs/issues/chat-history-attribution/005 in the picoclaw repo.
 *
 * Dry run by default. Pass --apply to write.
 *
 *   node scripts/merge-duplicate-agents.js
 *   node scripts/merge-duplicate-agents.js --apply
 *
 * Repoints every reference BEFORE deleting: the FKs are onDelete: SetNull, so
 * deleting first would silently strand history with a null agent instead of
 * moving it.
 *
 * Scope: duplicates WITHIN one account. Sessions whose agent belongs to a
 * different account than the child's owner are reported, never moved — that is a
 * device that changed hands, and choosing a new owner for its history is a
 * decision, not a cleanup.
 */
require('dotenv').config();
const { prisma } = require('../src/config/database');
const { normalizeCharacterName } = require('../src/services/character-resolver');

const APPLY = process.argv.includes('--apply');

// Every table carrying an agent_id, from the schema's FK list. ai_device is a
// pointer to the device's default character rather than history, but it must move
// too or the device keeps naming a row that is about to be deleted.
const REFERENCES = [
    'voice_sessions',
    'voice_session_messages',
    'device_token_usage_session',
    'device_workspace_artifacts',
    'device_memory_documents',
    'device_memory_chunks',
    'ai_agent_chat_history',
    'ai_device',
];

const s = (v) => (typeof v === 'bigint' ? v.toString() : v);

async function main() {
    const agents = await prisma.ai_agent.findMany({
        select: { id: true, user_id: true, agent_name: true, created_at: true },
    });

    // Group by account + case-folded canonical name: live rows spell one character
    // "NANI", "Nani" and "cheeko 2".
    const clusters = new Map();
    for (const a of agents) {
        if (a.user_id == null) continue;
        const key = `${a.user_id}::${normalizeCharacterName(a.agent_name || '').toLowerCase()}`;
        if (!clusters.has(key)) clusters.set(key, []);
        clusters.get(key).push(a);
    }

    const duplicates = [...clusters.entries()].filter(([, rows]) => rows.length > 1);
    if (duplicates.length === 0) {
        console.log('No duplicate character rows found.');
        return;
    }

    const sessionCounts = new Map();
    for (const row of await prisma.voice_sessions.groupBy({ by: ['agent_id'], _count: { _all: true } })) {
        if (row.agent_id) sessionCounts.set(row.agent_id, row._count._all);
    }
    const deviceAgentIds = new Set(
        (await prisma.ai_device.findMany({ select: { agent_id: true } }))
            .map(d => d.agent_id).filter(Boolean)
    );

    let totalLosers = 0;
    let totalMoved = 0;

    for (const [key, rows] of duplicates) {
        // Survivor: the row a toy currently points at, else the one carrying the
        // most history, else the oldest. Anything else would rename the character
        // a live device is using.
        const ranked = [...rows].sort((a, b) => {
            const dev = (deviceAgentIds.has(b.id) ? 1 : 0) - (deviceAgentIds.has(a.id) ? 1 : 0);
            if (dev !== 0) return dev;
            const sess = (sessionCounts.get(b.id) || 0) - (sessionCounts.get(a.id) || 0);
            if (sess !== 0) return sess;
            return new Date(a.created_at) - new Date(b.created_at);
        });
        const survivor = ranked[0];
        const losers = ranked.slice(1);
        totalLosers += losers.length;

        console.log(`\n${key}  (${rows.length} rows)`);
        console.log(`  keep   ${survivor.id}  "${survivor.agent_name}"  sessions=${sessionCounts.get(survivor.id) || 0}${deviceAgentIds.has(survivor.id) ? '  [device points here]' : ''}`);

        for (const loser of losers) {
            const moves = {};
            for (const table of REFERENCES) {
                const n = await prisma[table].count({ where: { agent_id: loser.id } });
                if (n > 0) moves[table] = n;
            }
            const movedRows = Object.values(moves).reduce((a, b) => a + b, 0);
            totalMoved += movedRows;
            console.log(`  merge  ${loser.id}  "${loser.agent_name}"  ${movedRows ? JSON.stringify(moves) : '(nothing to move)'}`);

            if (!APPLY) continue;

            await prisma.$transaction(async (tx) => {
                for (const table of Object.keys(moves)) {
                    await tx[table].updateMany({ where: { agent_id: loser.id }, data: { agent_id: survivor.id } });
                }
                await tx.ai_agent.delete({ where: { id: loser.id } });
            });
            console.log(`         applied`);
        }
    }

    // Cross-account strays: reported only. A merge keyed on the agent's account
    // cannot see these, and moving them decides who owns a child's past.
    const strays = await prisma.$queryRaw`
        SELECT s.agent_id::text AS agent_id, a.user_id::text AS agent_user,
               k.user_id::text AS kid_user, k.name AS kid_name, count(*)::int AS sessions
        FROM voice_sessions s
        JOIN ai_agent a ON a.id = s.agent_id
        JOIN kid_profile k ON k.id = s.kid_id
        WHERE a.user_id <> k.user_id
        GROUP BY 1,2,3,4 ORDER BY 5 DESC`;

    console.log(`\n── summary ──`);
    console.log(`duplicate clusters: ${duplicates.length}, rows to remove: ${totalLosers}, references to move: ${totalMoved}`);
    if (strays.length) {
        console.log(`\ncross-account history (reported, NOT changed):`);
        strays.forEach(r => console.log(`  ${r.sessions} sessions  agent ${r.agent_id} (user ${r.agent_user}) vs ${r.kid_name} (user ${r.kid_user})`));
    }
    console.log(APPLY ? '\nAPPLIED.' : '\nDry run. Re-run with --apply to write.');
}

main()
    .catch((e) => { console.error('FAILED', e.message); process.exitCode = 1; })
    .finally(async () => { await prisma.$disconnect(); });
