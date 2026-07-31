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
// updateTemplate re-reads after writing and throws unless the row comes back
// with the new values, so the stub has to actually retain what it was given.
let stored = { id: 'demo-id' };
const fakePrisma = {
  ai_agent_template: {
    findUnique: async () => stored,                    // "template exists"
    update: async ({ data }) => { updated = data; stored = { ...stored, ...data }; return stored; },
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

  // 3. Device sim wire format. These vectors were produced by client.py's own
  //    struct/AES/HMAC math and compared byte-for-byte; if the sim ever drifts
  //    from the firmware the gateway silently drops its packets, so pin them.
  const crypto = require('crypto');
  const { DeviceSim, makeCredentials, parseExpressionTag } = require('./device-sim');

  const KEY_HEX = '00112233445566778899aabbccddeeff';
  const nonce = Buffer.alloc(16);
  nonce.writeUInt32BE(0x1a2b3c4d, 4);

  const sim = new DeviceSim({ signatureKey: 'x' });
  sim.aesKey = Buffer.from(KEY_HEX, 'hex');
  sim.connectionId = nonce.readUInt32BE(4);
  sim.txSequence = 7;

  const realNow = Date.now;
  Date.now = () => 1700000000 * 1000; // freeze: the header carries a timestamp
  const packet = sim.encryptPacket(Buffer.from('hello-cheeko-audio')).toString('hex');
  Date.now = realNow;
  ok('UDP packet matches client.py byte-for-byte',
    packet === '010000121a2b3c4d6553f10000000007303cbdc928fe04e6df1d8306c76f845f09f9');

  const realUUID = crypto.randomUUID;
  crypto.randomUUID = () => 'fixed-uuid';
  const creds = makeCredentials('00:16:3e:ac:b5:38', 'test-signature-key-12345');
  crypto.randomUUID = realUUID;
  ok('MQTT password HMAC matches client.py',
    creds.password === 'S4rBZDqj7jGyopfFPvgCOEgYt2ZosqKWud5ZFnDW9eg=');

  // 4. Receive path, loopback: a packet built by the send path must come back
  //    out as PCM. Same header/AES the gateway proved it can decrypt, so this
  //    closes the loop without needing a live TTS stream.
  const rx = new DeviceSim({ signatureKey: 'x' });
  rx.aesKey = Buffer.from(KEY_HEX, 'hex');
  rx.connectionId = 0x1a2b3c4d;
  rx.decoder = new (require('@discordjs/opus').OpusEncoder)(16000, 1);

  const tone = Buffer.alloc(640);
  for (let i = 0; i < 320; i++) tone.writeInt16LE(Math.round(6000 * Math.sin(i / 4)), i * 2);

  let gotPcm = null;
  rx.on('pcm', (p) => { gotPcm = p; });
  rx.txSequence = 41;
  rx._onAudioPacket(rx.encryptPacket(rx.encoder.encode(tone)));

  ok('inbound packet decrypts + decodes to a full PCM frame',
    gotPcm !== null && gotPcm.length === 640);
  ok('inbound sequence tracked from the packet header',
    rx.stats.received === 1 && rx.stats.first === 41 && rx.stats.missing === 0);

  // A dropped packet must be counted, not silently swallowed.
  rx.txSequence = 45; // 42..44 never arrive
  rx._onAudioPacket(rx.encryptPacket(rx.encoder.encode(tone)));
  ok('gap in sequence counted as missing packets', rx.stats.missing === 3);

  ok('face tag: known tag drives expression',
    parseExpressionTag('[happy] Yay!').face === 'happy');
  ok('face tag: unknown tag falls back to neutral',
    parseExpressionTag('[zzzz] hi').face === 'neutral');
  ok('face tag: non-tag brackets left untouched',
    parseExpressionTag('[OK!] hi').text === '[OK!] hi');

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
