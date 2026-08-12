/**
 * Admin Dashboard routes — persona (AGENT.md / SOUL.md) editor.
 *
 * Mounted by the Manager API. Reuses the existing agent.service template
 * funcs (getTemplates / getTemplateById / updateTemplate) so the same
 * Prisma client + validateAgentMd run. No second DB connection.
 *
 * AUTH = single ADMIN_PASSWORD env var. The browser sends it as a Bearer
 * token; we string-compare. ponytail: no user table, no bcrypt, no JWT.
 * Fine for one trusted admin behind the editor; swap for real auth if this
 * ever faces the public internet.
 */

// ponytail: this folder is outside manager-api-node, so `require('express')`
// here can't find the manager's node_modules. Take express from app.js instead.
const path = require('path');

const agentService = require('../manager-api-node/src/services/agent.service');
const quizService = require('../manager-api-node/src/services/quiz.service');
const { bankForCharacterRef, BANKS } = require('../manager-api-node/src/services/banks');
const { ageBandFromBirthDate } = require('../manager-api-node/src/services/quiz.logic');
const { prisma } = require('../manager-api-node/src/config/database');
const { success, badRequest, unauthorized, notFound } = require('../manager-api-node/src/utils/response');
const { asyncHandler } = require('../manager-api-node/src/middleware/errorHandler');

module.exports = (express) => {
const router = express.Router();

// ponytail: password IS the token. Constant-ish compare; timing leak irrelevant here.
const gate = (req, res, next) => {
  const expected = process.env.ADMIN_PASSWORD;
  if (!expected) return unauthorized(res, 'ADMIN_PASSWORD not set on server');
  const auth = req.headers.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (token !== expected) return unauthorized(res, 'Bad password');
  next();
};

// Login: trade password for the same password (browser keeps it). Lets the
// UI verify creds before showing the editor.
router.post('/login', (req, res) => {
  const expected = process.env.ADMIN_PASSWORD;
  if (!expected) return unauthorized(res, 'ADMIN_PASSWORD not set on server');
  if ((req.body && req.body.password) !== expected) return unauthorized(res, 'Bad password');
  success(res, { token: expected });
});

// List characters (templates). Minimal fields.
router.get('/templates', gate, asyncHandler(async (req, res) => {
  const templates = await agentService.getTemplates(true); // include hidden
  success(res, templates.map((t) => ({ id: t.id, agentName: t.agentName })));
}));

// Get one: id + persona fields.
router.get('/templates/:id', gate, asyncHandler(async (req, res) => {
  const t = await agentService.getTemplateById(req.params.id);
  if (!t) return notFound(res, 'Template not found');
  success(res, {
    id: t.id,
    agentName: t.agentName,
    greetingPrompt: t.greetingPrompt,
    systemPrompt: t.systemPrompt,
    soul: t.soul,
    sarvamVoiceId: t.sarvamVoiceId,
    elevenlabsVoiceId: t.elevenlabsVoiceId,
  });
}));

// Create a character template. AGENT.md + SOUL.md are mandatory; name/code
// must contain no digits and be unique (service enforces uniqueness).
router.post('/templates', gate, asyncHandler(async (req, res) => {
  const b = req.body || {};
  const agentName = String(b.agentName || '').trim();
  const agentCode = String(b.agentCode || '').trim();
  if (!agentName) return badRequest(res, 'Agent name is required');
  if (/[0-9]/.test(agentName)) return badRequest(res, 'Agent name must not contain numbers');
  if (agentCode && /[0-9]/.test(agentCode)) return badRequest(res, 'Agent code must not contain numbers');
  if (!b.systemPrompt || !String(b.systemPrompt).trim()) return badRequest(res, 'AGENT.md (system_prompt) is required');
  if (!b.soul || !String(b.soul).trim()) return badRequest(res, 'SOUL.md (soul) is required');
  try {
    const id = await agentService.createTemplate({
      agentName,
      agentCode: agentCode || undefined,
      // Optional: empty -> NULL -> worker falls back to the generic greeting.
      greetingPrompt: b.greetingPrompt,
      systemPrompt: b.systemPrompt,
      soul: b.soul,
      language: b.language,
      langCode: b.langCode,
      sarvamVoiceId: b.sarvamVoiceId,
      elevenlabsVoiceId: b.elevenlabsVoiceId,
    });
    success(res, { id }, 'Created');
  } catch (err) {
    return badRequest(res, err.message); // dup name/code + validator 400s go to UI
  }
}));

// Save greeting_prompt + AGENT.md (systemPrompt) + SOUL.md (soul). updateTemplate runs
// validateAgentMd → throws statusCode 400 on malformed AGENT.md; we surface it.
router.put('/templates/:id', gate, asyncHandler(async (req, res) => {
  try {
    await agentService.updateTemplate(req.params.id, {
      greetingPrompt: req.body.greetingPrompt,
      systemPrompt: req.body.systemPrompt,
      soul: req.body.soul,
      sarvamVoiceId: req.body.sarvamVoiceId,
      elevenlabsVoiceId: req.body.elevenlabsVoiceId,
    });
    success(res, null, 'Saved');
  } catch (err) {
    return badRequest(res, err.message); // validator 400 message goes to UI
  }
}));

// Delete a character template.
router.delete('/templates/:id', gate, asyncHandler(async (req, res) => {
  try {
    await agentService.deleteTemplate(req.params.id);
    success(res, null, 'Deleted');
  } catch (err) {
    return badRequest(res, err.message);
  }
}));

// --- Quiz/riddle progress for the device under test ---------------------------
//
// The Test device tab drives a real toy MAC through a real session, so the only
// way to see level 3 behave is to put a device on level 3 first. These expose the
// same quiz.service functions manager-web's /quiz-progress page uses, behind this
// dashboard's own password rather than an admin login.
//
// The bank follows the character selected in the tab, so choosing Riddler shows
// riddle progress. `character` here is the DISPLAY name (that is what the
// template list gives the <select>); bankForCharacterRef resolves a display name
// via ai_agent_template and falls back to the quiz bank, so an unknown one is
// never an error.

const bankFromQuery = (value) => bankForCharacterRef({ character: value });

// Derived state for one MAC. allDeviceProgress rather than progress(): only it
// carries max_level, answered_today, day_complete and replay, which are exactly
// what decides whether the next session will do what you want. It reads the whole
// bank and answer log, which is free at this size and is what the existing admin
// page already does per load.
router.get('/quiz-progress', gate, asyncHandler(async (req, res) => {
  const mac = String(req.query.mac || '').trim();
  if (!mac) return badRequest(res, 'mac is required');

  const bank = await bankFromQuery(req.query.character);
  const rows = await quizService.allDeviceProgress(bank);
  const row = rows.find((r) => r.device_mac.toLowerCase() === mac.toLowerCase());
  // A MAC with no ai_device row is a normal thing to type into the tab, so this
  // is data rather than a 404: the UI says "unknown device" and stays usable.
  success(res, { bank, device: row || null });
}));

// Force the device onto a level. Destructive by design — it rewrites the answer
// log for the device's band — which is the point on a test toy.
router.post('/quiz-set-level', gate, asyncHandler(async (req, res) => {
  const b = req.body || {};
  const mac = String(b.mac || '').trim();
  const level = Number(b.level);
  if (!mac) return badRequest(res, 'mac is required');
  if (!Number.isInteger(level) || level < 1) return badRequest(res, 'level must be a positive integer');

  const bank = await bankFromQuery(b.character);
  try {
    success(res, { bank, ...(await quizService.setLevel(mac, level, bank)) }, 'Level set');
  } catch (err) {
    return badRequest(res, err.message); // "level N does not exist in band X" goes to the UI
  }
}));

// Re-open today's Daily Ten. Needed constantly while testing: ten answers in one
// day closes the scored game, and this backdates them rather than deleting them,
// so the device keeps the levels it cleared.
router.post('/quiz-reset-day', gate, asyncHandler(async (req, res) => {
  const mac = String((req.body || {}).mac || '').trim();
  if (!mac) return badRequest(res, 'mac is required');

  const bank = await bankFromQuery((req.body || {}).character);
  success(res, { bank, ...(await quizService.clearDayGate(mac, bank)) }, 'Day re-opened');
}));

// Set the child's age, and wipe what they had played.
//
// A band is derived from kid_profile.birth_date, so this is the only way to hear
// the age-3 content on a toy whose child is 8. The reset is not a convenience:
// changing age changes bank, which would leave the old band's answers dormant
// while still counting towards today's Daily Ten, so the next session would open
// on a fresh band already believing part of the day was spent.
//
// Scoped to the CHILD, not the device: two toys can share one kid_id, and
// progress left on the sibling toy would reappear the moment it was used.
router.post('/kid-age', gate, asyncHandler(async (req, res) => {
  const b = req.body || {};
  const mac = String(b.mac || '').trim();
  const age = Number(b.age);
  if (!mac) return badRequest(res, 'mac is required');
  // The authored banks stop at both ends; asking for 2 or 11 would silently clamp
  // and look like the control was ignored.
  if (!Number.isInteger(age) || age < 3 || age > 10) {
    return badRequest(res, 'age must be a whole number from 3 to 10');
  }

  const device = await prisma.ai_device.findFirst({
    where: { mac_address: { equals: mac, mode: 'insensitive' } },
    select: { kid_id: true },
  });
  if (!device) return badRequest(res, `no device row for ${mac}`);
  if (!device.kid_id) return badRequest(res, 'no child profile is attached to this device');

  // Today's date N years back: the birthday is today, so the derived age is
  // exactly N rather than N-1, and stays N for the next year.
  const now = new Date();
  const birthDate = new Date(Date.UTC(now.getUTCFullYear() - age, now.getUTCMonth(), now.getUTCDate()));
  await prisma.kid_profile.update({ where: { id: device.kid_id }, data: { birth_date: birthDate } });

  const macs = (await prisma.ai_device.findMany({
    where: { kid_id: device.kid_id },
    select: { mac_address: true },
  })).map((d) => d.mac_address);
  // OR of case-insensitive equals rather than `in`: the answer log stores the MAC
  // as the worker sent it, and one device already appears in two casings.
  const macFilter = { OR: macs.map((m) => ({ device_mac: { equals: m, mode: 'insensitive' } })) };

  let removed = 0;
  for (const bank of Object.values(BANKS)) {
    removed += (await bank.answers.deleteMany({ where: macFilter })).count;
  }
  // Only the two bank subjects — this table also holds unrelated learning rows.
  const milestones = await prisma.kid_learning_progress.deleteMany({
    where: { kid_id: device.kid_id, subject: { in: Object.values(BANKS).map((x) => x.subject) } },
  });

  success(res, {
    age,
    band: ageBandFromBirthDate(birthDate, now),
    birth_date: birthDate.toISOString().slice(0, 10),
    devices: macs.length,
    answers_removed: removed,
    milestones_removed: milestones.count,
  }, 'Age set and progress reset');
}));

// Static dashboard files (this same folder).
router.use('/', express.static(path.join(__dirname, 'public')));

return router;
};
