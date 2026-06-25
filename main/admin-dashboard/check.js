/**
 * Self-check (no test framework). Run: node check.js
 *
 * Asserts the dashboard SAVE path rejects a malformed AGENT.md and accepts a
 * good one — via the SAME agent.service.updateTemplate the PUT route calls.
 * Prisma is stubbed in the require cache, so no real DB connection is opened.
 */

const path = require('path');
const Module = require('module');

const SVC = path.join(__dirname, '../manager-api-node/src/services/agent.service.js');
const DB = path.join(__dirname, '../manager-api-node/src/config/database.js');

// Stub the DB module so requiring the service never touches Postgres.
let updated = null;
const fakePrisma = {
  ai_agent_template: {
    findUnique: async () => ({ id: 'demo-id' }),       // "template exists"
    update: async ({ data }) => { updated = data; return { id: 'demo-id' }; },
  },
};
require.cache[require.resolve(DB)] = new Module(DB);
require.cache[require.resolve(DB)].exports = { prisma: fakePrisma };
require.cache[require.resolve(DB)].loaded = true;

const agentService = require(SVC);

// Minimal valid full AGENT.md (per agent-md-validator rules).
const GOOD_AGENT_MD = [
  '# Persona', '',
  '## Child-Safety Rules', '- be kind', '',
  '## Runtime Guardrails', '- stay in character', '',
  'Speak in <!-- LANGUAGE -->.',
].join('\n');

// Bad: has the LANGUAGE slot (so it IS treated as full AGENT.md) but is missing headings.
const BAD_AGENT_MD = 'Just chat in <!-- LANGUAGE -->.';

let pass = 0, fail = 0;
const ok = (name, cond) => { (cond ? pass++ : fail++); console.log(`${cond ? 'PASS' : 'FAIL'} — ${name}`); };

(async () => {
  // 1. Bad AGENT.md must be rejected with a 400.
  try {
    await agentService.updateTemplate('demo-id', { systemPrompt: BAD_AGENT_MD, soul: 'x' });
    ok('rejects malformed AGENT.md', false);
  } catch (e) {
    ok('rejects malformed AGENT.md (400)', e.statusCode === 400);
    console.log('   msg:', e.message);
  }

  // 2. Good AGENT.md + soul must save (soul reaches the update payload).
  updated = null;
  try {
    await agentService.updateTemplate('demo-id', { systemPrompt: GOOD_AGENT_MD, soul: 'SOUL body' });
    ok('saves valid AGENT.md', updated && updated.system_prompt === GOOD_AGENT_MD);
    ok('persists SOUL.md (soul column)', updated && updated.soul === 'SOUL body');
  } catch (e) {
    ok('saves valid AGENT.md', false);
    console.log('   unexpected error:', e.message);
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
