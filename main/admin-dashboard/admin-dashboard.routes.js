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
const { bankForCharacterRef, resolveBank, BANKS } = require('../manager-api-node/src/services/banks');
const { success, badRequest, unauthorized, notFound } = require('../manager-api-node/src/utils/response');
const { prisma } = require('../manager-api-node/src/config/database');
const { planImport, readCsv } = require('../manager-api-node/scripts/lib/quiz-import');
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

// --- Question bank browser + editor ------------------------------------------
//
// The curated bank the worker pulls from (ADR-0005): quiz_question /
// riddle_question. Read the whole table (inactive rows included) so an operator
// sees exactly what a level holds, and edit rows in place.
//
// ponytail: no paging — the banks are in the hundreds of rows and the browser
// filters client-side.
//
// There is no delete. quiz_question_answer references question_id with
// onDelete: Restrict, so any question a child has answered cannot be deleted at
// all; `active: false` retires it from next-questions while the answer log
// stays truthful.

const pickBank = (value) => {
  const bank = String(value || 'quiz').trim();
  if (!BANKS[bank]) throw new Error(`bank must be one of: ${Object.keys(BANKS).join(', ')}`);
  return bank;
};

// Accepted answers and distractors are Json arrays; the form sends either an
// array or one comma-separated line.
const toList = (value) => {
  const raw = Array.isArray(value) ? value : String(value ?? '').split(',');
  return raw.map((v) => String(v).trim()).filter(Boolean);
};

// Shared by create and update. Throws the message the UI shows.
const questionFields = (b) => {
  const questionText = String(b.question_text || '').trim();
  const answerText = String(b.answer_text || '').trim();
  const level = Number(b.level);
  if (!questionText) throw new Error('Question text is required');
  if (!answerText) throw new Error('Answer text is required');
  if (!Number.isInteger(level) || level < 1) throw new Error('Level must be a positive integer');

  const accepted = toList(b.accepted_answers);
  const distractors = toList(b.distractors);
  // The importer rejects this too: a distractor that is also correct turns the
  // narrowing hint into a question with two right answers.
  const clash = distractors.find((d) =>
    [answerText, ...accepted].some((a) => a.toLowerCase() === d.toLowerCase()));
  if (clash) throw new Error(`Distractor "${clash}" is also a correct answer`);

  return {
    question_text: questionText,
    answer_text: answerText,
    accepted_answers: accepted,
    distractors,
    teach_text: String(b.teach_text || '').trim() || null,
    category: String(b.category || '').trim() || null,
    level,
    language: String(b.language || 'en').trim().slice(0, 10),
    active: b.active !== false,
  };
};

// A Level is FULL at bank.levelSize active questions (10 for quiz, 80 for
// riddle). The importer already rejects a sheet whose level is not exactly that
// size, so an eleventh added here would only be rejected on the next import —
// better to refuse it now and say which level is full.
//
// Only ACTIVE rows count, matching the importer: a retired question is not part
// of the level. Scoped by language too, because a level is per-language.
const assertRoomInLevel = async (bankName, data, exceptId = null) => {
  const bank = resolveBank(bankName);
  const where = { level: data.level, language: data.language, active: true };
  if (exceptId !== null) where.id = { not: exceptId };
  const held = await bank.questions.count({ where });
  if (held >= bank.levelSize) {
    throw new Error(
      `Level ${data.level} (${data.language}) already holds ${held} active questions, ` +
      `the maximum for the ${bankName} bank. Delete or retire one first.`
    );
  }
};

// List. Levels are returned alongside so the UI can offer the level filter and
// show how far each level is from the per-level size the importer enforces.
router.get('/questions', gate, asyncHandler(async (req, res) => {
  let bank;
  try { bank = pickBank(req.query.bank); } catch (err) { return badRequest(res, err.message); }
  const { questions: table, levelSize } = resolveBank(bank);
  const questions = await table.findMany({ orderBy: [{ level: 'asc' }, { id: 'asc' }] });
  success(res, { bank, levelSize, questions });
}));

// Create. `code` is NOT NULL UNIQUE and exists for the spreadsheet importer, not
// for anything at runtime — so it is minted here rather than asked for. The
// admin- prefix marks a row that did not come from a sheet, which matters when
// the next import decides what to retire.
router.post('/questions', gate, asyncHandler(async (req, res) => {
  let bank, data;
  try {
    bank = pickBank((req.body || {}).bank);
    data = questionFields(req.body || {});
  } catch (err) {
    return badRequest(res, err.message);
  }
  // Retired rows are exempt: parking a question at active:false is how you make
  // room, so the cap must not block creating one.
  if (data.active) {
    try { await assertRoomInLevel(bank, data); } catch (err) { return badRequest(res, err.message); }
  }

  const code = `admin-L${data.level}-${Date.now().toString(36)}`;
  const row = await resolveBank(bank).questions.create({ data: { ...data, code } });
  success(res, row, 'Created');
}));

// Update. Editing a live question rewrites what every child is asked next
// session; the answer log keeps pointing at this id, so past rows now credit
// the NEW text. Fine for fixing a typo, wrong for replacing the question —
// retire it and add a new one instead.
router.put('/questions/:id', gate, asyncHandler(async (req, res) => {
  let bank, data;
  try {
    bank = pickBank((req.body || {}).bank);
    data = questionFields(req.body || {});
  } catch (err) {
    return badRequest(res, err.message);
  }
  // Excluding itself, so re-saving a question that is already one of the ten
  // does not count it twice and reject its own edit.
  const id = BigInt(req.params.id);
  if (data.active) {
    try { await assertRoomInLevel(bank, data, id); } catch (err) { return badRequest(res, err.message); }
  }

  try {
    const row = await resolveBank(bank).questions.update({
      where: { id },
      data: { ...data, update_date: new Date() },
    });
    success(res, row, 'Saved');
  } catch (err) {
    return badRequest(res, err.message); // unknown id -> Prisma P2025 message
  }
}));

// Delete. Only possible while no child has answered the question:
// quiz_question_answer references it with onDelete: Restrict, so Postgres
// refuses rather than orphaning the answer log. That refusal is surfaced as a
// plain sentence — retiring (active: false) is the answer in that case.
router.delete('/questions/:id', gate, asyncHandler(async (req, res) => {
  let bank;
  try { bank = pickBank(req.query.bank); } catch (err) { return badRequest(res, err.message); }
  try {
    await resolveBank(bank).questions.delete({ where: { id: BigInt(req.params.id) } });
    success(res, null, 'Deleted');
  } catch (err) {
    const blocked = err.code === 'P2003' || /foreign key/i.test(err.message);
    return badRequest(res, blocked
      ? 'This question has been answered by a child, so it cannot be deleted. Set Active to "no" to retire it instead.'
      : err.message);
  }
}));

// --- CSV import ---------------------------------------------------------------
//
// The same sheet the CLI importer takes (scripts/import-quiz-questions.js),
// uploaded from the browser instead of a shell. planImport is reused verbatim
// rather than reimplemented: two sets of validation rules that drift apart is
// how a sheet passes here and fails there.
//
// The CSV arrives as a STRING in the JSON body, not multipart — express.json
// already accepts 10mb and a few hundred rows is tens of kilobytes, so a file
// upload middleware would be a dependency bought for nothing.
const REQUIRED_HEADERS = ['code', 'level', 'question_text', 'answer_text'];

// Would this sheet leave a Level holding more than the bank allows?
//
// planImport polices the SHEET (ten rows per level); this polices the RESULT,
// which is what actually matters — a sheet of ten perfectly good rows aimed at
// a level that already holds ten would take it to twenty.
const overfullLevels = (existing, incoming, levelSize) => {
  const bySheet = new Map(incoming.map((d) => [d.code, d]));
  const final = existing
    .filter((row) => !bySheet.has(row.code)) // an upsert replaces, not adds
    .concat(incoming);

  const counts = new Map();
  for (const row of final.filter((r) => r.active)) {
    const key = `${row.language} L${row.level}`;
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return [...counts.entries()].filter(([, n]) => n > levelSize);
};

router.post('/questions/import', gate, asyncHandler(async (req, res) => {
  const body = req.body || {};
  let bank;
  try { bank = pickBank(body.bank); } catch (err) { return badRequest(res, err.message); }
  const csv = String(body.csv || '');
  if (!csv.trim()) return badRequest(res, 'No CSV content received');

  let rows;
  try {
    rows = readCsv(csv);
  } catch (err) {
    return badRequest(res, 'Could not read the CSV: ' + err.message);
  }
  if (!rows.length) return badRequest(res, 'The CSV has a header but no rows');

  const missing = REQUIRED_HEADERS.filter((h) => !(h in rows[0]));
  if (missing.length) return badRequest(res, `CSV is missing required column(s): ${missing.join(', ')}`);

  const { ready, skipped, badLevels } = planImport(rows);
  const incoming = ready.map((r) => r.data);

  const { questions: table, levelSize } = resolveBank(bank);
  const existing = await table.findMany({
    select: { code: true, level: true, language: true, active: true },
  });
  const overfull = overfullLevels(existing, incoming, levelSize);

  const report = {
    bank,
    rows: rows.length,
    valid: incoming.length,
    skipped,
    // Sheet-side: a level that does not hold exactly ten. Reported, not fatal —
    // a sheet may legitimately carry a partial level being corrected.
    levelsNotTen: badLevels.map(([k, n]) => `${k}: ${n} rows`),
    // Result-side: this IS fatal. Importing would break the invariant the
    // worker and the editor both rely on.
    wouldOverfill: overfull.map(([k, n]) => `${k}: would hold ${n}, max ${levelSize}`),
  };

  if (overfull.length) {
    return badRequest(res, `Import refused — it would overfill: ${report.wouldOverfill.join('; ')}`);
  }
  if (!incoming.length) {
    return badRequest(res, `No valid rows. ${skipped.slice(0, 5).join(' | ')}`);
  }
  if (body.dryRun) {
    return success(res, { ...report, applied: false }, 'Dry run — nothing written');
  }

  // Upsert by code, same as the CLI, so re-running a sheet is idempotent.
  // One transaction: a half-imported level is worse than no import.
  const model = bank === 'riddle' ? 'riddle_question' : 'quiz_question';
  const codes = incoming.map((d) => d.code);
  const already = new Set(
    (await table.findMany({ where: { code: { in: codes } }, select: { code: true } }))
      .map((r) => r.code)
  );
  await prisma.$transaction(
    incoming.map((data) =>
      prisma[model].upsert({ where: { code: data.code }, create: data, update: data })
    )
  );
  const updated = incoming.filter((d) => already.has(d.code)).length;
  const created = incoming.length - updated;

  success(res, { ...report, applied: true, created, updated }, `Imported ${created + updated} question(s)`);
}));

// --- Character progress (all characters, MEMO-backed) ------------------------
//
// Reads the Wave-3 tables: kid_character_state (current, upserted) and
// kid_session_progress (append-only per session). Attribution follows the
// child; a MAC with no kid falls back to its device rows, mirroring the
// progress service. BigInt ids are dropped rather than serialized — the UI
// has no use for them and JSON.stringify throws on BigInt.
router.get('/character-progress', gate, asyncHandler(async (req, res) => {
  const mac = String(req.query.mac || '').trim();
  if (!mac) return badRequest(res, 'mac is required');

  const device = await prisma.ai_device.findFirst({
    where: { mac_address: { equals: mac, mode: 'insensitive' } },
    select: { kid_id: true },
  });
  const kidId = device?.kid_id ?? null;
  const scope = kidId
    ? { kid_id: kidId }
    : { device_mac: { equals: mac, mode: 'insensitive' }, kid_id: null };

  const [states, sessions] = await Promise.all([
    prisma.kid_character_state.findMany({ where: scope, orderBy: { updated_at: 'desc' } }),
    prisma.kid_session_progress.findMany({ where: scope, orderBy: { created_at: 'desc' }, take: 50 }),
  ]);

  success(res, {
    kidId: kidId === null ? null : String(kidId),
    states: states.map((s) => ({
      state_type: s.state_type, character: s.character, memo: s.memo,
      data: s.data, updated_at: s.updated_at,
    })),
    sessions: sessions.map((s) => ({
      state_type: s.state_type, character: s.character, memo: s.memo,
      data: s.data, session_date: s.session_date, created_at: s.created_at,
    })),
  });
}));

// Static dashboard files (this same folder).
router.use('/', express.static(path.join(__dirname, 'public')));

return router;
};
