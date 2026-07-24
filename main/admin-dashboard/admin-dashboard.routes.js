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
  success(res, { id: t.id, agentName: t.agentName, systemPrompt: t.systemPrompt, soul: t.soul });
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
      systemPrompt: b.systemPrompt,
      soul: b.soul,
      language: b.language,
      langCode: b.langCode,
    });
    success(res, { id }, 'Created');
  } catch (err) {
    return badRequest(res, err.message); // dup name/code + validator 400s go to UI
  }
}));

// Save AGENT.md (systemPrompt) + SOUL.md (soul). updateTemplate runs
// validateAgentMd → throws statusCode 400 on malformed AGENT.md; we surface it.
router.put('/templates/:id', gate, asyncHandler(async (req, res) => {
  try {
    await agentService.updateTemplate(req.params.id, {
      systemPrompt: req.body.systemPrompt,
      soul: req.body.soul,
    });
    success(res, null, 'Saved');
  } catch (err) {
    return badRequest(res, err.message); // validator 400 message goes to UI
  }
}));

// Static dashboard files (this same folder).
router.use('/', express.static(path.join(__dirname, 'public')));

return router;
};
