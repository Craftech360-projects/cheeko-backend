// Cheeko persona admin — vanilla JS, no build step.
// Token = the admin password (ponytail auth). Kept in sessionStorage.

const API = '/api'; // proxied by server.js to the Manager's /admin-dashboard routes
const $ = (id) => document.getElementById(id);

let token = sessionStorage.getItem('adminToken') || '';
let creating = false;   // create-mode: editors hold a NEW character
let charList = [];      // cached template list for client-side dup checks

// fetch wrapper: attaches Bearer, unwraps { code, msg, data }.
async function api(method, path, body) {
  const res = await fetch(API + path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: 'Bearer ' + token } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.msg || ('HTTP ' + res.status));
  return json.data;
}

// ---- login ----
async function login() {
  $('loginErr').hidden = true;
  const password = $('password').value;
  try {
    const data = await api('POST', '/login', { password });
    token = data.token;
    sessionStorage.setItem('adminToken', token);
    showEditor();
  } catch (e) {
    $('loginErr').textContent = e.message;
    $('loginErr').hidden = false;
  }
}

function logout() {
  token = '';
  sessionStorage.removeItem('adminToken');
  $('editorView').hidden = true;
  $('testView').hidden = true;
  $('bankView').hidden = true;
  $('tabs').hidden = true;
  $('logout').hidden = true;
  $('loginView').hidden = false;
}

// ---- tabs ----
function showTab(id) {
  $('editorView').hidden = id !== 'editorView';
  $('testView').hidden = id !== 'testView';
  $('bankView').hidden = id !== 'bankView';
  document.querySelectorAll('.tab').forEach((b) =>
    b.classList.toggle('active', b.dataset.tab === id));
  if (id === 'bankView' && !bankRows.length) loadBank();
}

// ---- question bank ----
// The whole table, fetched once per bank and filtered in the browser.
let bankRows = [];
let editingId = null;   // null while the form holds a NEW question
let levelSize = 10;     // active questions a Level holds; per-bank, from the API

const cell = (v) => {
  const td = document.createElement('td');
  td.textContent = Array.isArray(v) ? v.join(', ') : (v === null || v === undefined ? '' : String(v));
  return td;
};

function renderBank() {
  const q = $('bankFilter').value.trim().toLowerCase();
  const lvl = $('bankLevel').value;
  const rows = bankRows
    .filter((r) => !lvl || String(r.level) === lvl)
    .filter((r) => !q || JSON.stringify(r).toLowerCase().includes(q));

  const body = $('bankTable').tBodies[0];
  body.innerHTML = '';
  rows.forEach((r) => {
    const tr = document.createElement('tr');
    if (!r.active) tr.className = 'inactive';
    const edit = document.createElement('td');
    const btn = document.createElement('button');
    btn.className = 'btn ghost tiny';
    btn.textContent = 'Edit';
    btn.addEventListener('click', () => editQuestion(r));
    edit.appendChild(btn);
    const del = document.createElement('button');
    del.className = 'btn ghost danger tiny';
    del.textContent = 'Delete';
    del.addEventListener('click', () => deleteQuestion(r));
    edit.appendChild(del);
    tr.appendChild(edit);
    [r.id, r.level, r.language, r.question_text, r.answer_text,
     r.accepted_answers, r.distractors, r.teach_text, r.category,
     r.active ? 'yes' : 'no'].forEach((v) => tr.appendChild(cell(v)));
    body.appendChild(tr);
  });

  // Active count, because the importer's rule is exactly ten ACTIVE per level.
  const live = rows.filter((r) => r.active).length;
  $('bankCount').textContent = lvl
    ? `level ${lvl}: ${live}/${levelSize} active${live >= levelSize ? ' — FULL' : ''}`
    : `${rows.length} of ${bankRows.length} · ${live} active`;
}

// Level filter options come from the data, so a bank with 40 levels needs no
// change here.
function renderLevels() {
  const sel = $('bankLevel');
  const keep = sel.value;
  sel.innerHTML = '<option value="">All levels</option>';
  [...new Set(bankRows.map((r) => r.level))].sort((a, b) => a - b).forEach((n) => {
    const o = document.createElement('option');
    o.value = String(n);
    o.textContent = 'Level ' + n;
    sel.appendChild(o);
  });
  sel.value = keep;
}

async function loadBank() {
  $('bankCount').textContent = 'loading…';
  try {
    const data = await api('GET', '/questions?bank=' + encodeURIComponent($('bankSelect').value));
    bankRows = data.questions || [];
    levelSize = data.levelSize || 10;
    renderLevels();
    renderBank();
  } catch (e) {
    bankRows = [];
    renderLevels();
    renderBank();
    $('bankCount').textContent = e.message;
  }
}

const list = (v) => (Array.isArray(v) ? v.join(', ') : (v || ''));

function fillForm(r) {
  $('qLevel').value = r.level || 1;
  $('qLanguage').value = r.language || 'en';
  $('qCategory').value = r.category || '';
  $('qActive').value = r.active === false ? 'false' : 'true';
  $('qText').value = r.question_text || '';
  $('qAnswer').value = r.answer_text || '';
  $('qAccepted').value = list(r.accepted_answers);
  $('qDistractors').value = list(r.distractors);
  $('qTeach').value = r.teach_text || '';
  setQStatus('');
  $('bankForm').hidden = false;
  $('bankForm').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function editQuestion(r) {
  editingId = r.id;
  $('bankFormTitle').textContent = `Edit question ${r.id}`;
  fillForm(r);
}

function newQuestion() {
  editingId = null;
  $('bankFormTitle').textContent = 'New question';
  fillForm({ level: Number($('bankLevel').value) || 1 });
  $('qText').focus();
}

async function deleteQuestion(r) {
  const text = String(r.question_text || '').slice(0, 60);
  if (!confirm(`Delete question ${r.id}?

${text}

This cannot be undone.`)) return;
  try {
    await api('DELETE', `/questions/${r.id}?bank=` + encodeURIComponent($('bankSelect').value));
    await loadBank();
  } catch (e) {
    alert(e.message); // FK-restrict explanation, or whatever the server said
  }
}

// ---- CSV import ----
// The file is read in the browser and posted as a string: the /api proxy speaks
// JSON, and a multipart path would mean a new dependency on both sides.
async function runCsvImport() {
  const file = $('csvFile').files[0];
  if (!file) return setCsvStatus('Choose a CSV file first', false);
  const dryRun = $('csvDryRun').value === 'true';
  setCsvStatus(dryRun ? 'Checking…' : 'Importing…');
  $('csvReport').hidden = true;
  try {
    const csv = await file.text();
    const data = await api('POST', '/questions/import', {
      bank: $('bankSelect').value, csv, dryRun,
    });
    const lines = [
      `bank        : ${data.bank}`,
      `rows in file: ${data.rows}`,
      `valid rows  : ${data.valid}`,
      data.applied ? `created     : ${data.created}` : 'MODE        : dry run, nothing written',
      data.applied ? `updated     : ${data.updated}` : '',
    ];
    const block = (title, items) => {
      if (!items.length) return;
      lines.push('', title + ' (' + items.length + '):');
      items.forEach((i) => lines.push('  ' + i));
    };
    block('skipped rows', data.skipped);
    block('levels not holding ten', data.levelsNotTen);
    if (!data.skipped.length) lines.push('', 'skipped rows: none');
    $('csvReport').textContent = lines.join('\n');
    $('csvReport').hidden = false;
    setCsvStatus(data.applied ? 'Imported ✓' : 'Dry run complete', true);
    if (data.applied) await loadBank();
  } catch (e) {
    setCsvStatus(e.message, false); // includes the overfill refusal
  }
}

function setCsvStatus(msg, ok) {
  const el = $('csvStatus');
  el.textContent = msg;
  el.className = 'status' + (msg ? (ok ? ' ok' : ' err') : '');
}

function setQStatus(msg, ok) {
  const el = $('qStatus');
  el.textContent = msg;
  el.className = 'status' + (msg ? (ok ? ' ok' : ' err') : '');
}

async function saveQuestion() {
  const body = {
    bank: $('bankSelect').value,
    level: Number($('qLevel').value),
    language: $('qLanguage').value,
    category: $('qCategory').value,
    active: $('qActive').value === 'true',
    question_text: $('qText').value,
    answer_text: $('qAnswer').value,
    accepted_answers: $('qAccepted').value,
    distractors: $('qDistractors').value,
    teach_text: $('qTeach').value,
  };
  setQStatus('Saving…');
  try {
    if (editingId === null) await api('POST', '/questions', body);
    else await api('PUT', '/questions/' + editingId, body);
    $('bankForm').hidden = true;
    await loadBank();
  } catch (e) {
    setQStatus(e.message, false); // server validation message
  }
}

// ---- editor ----
async function showEditor() {
  $('loginView').hidden = true;
  $('tabs').hidden = false;
  $('editorView').hidden = false;
  $('logout').hidden = false;
  loadTestCharacters(); // Test tab shares this character list
  try {
    const list = await api('GET', '/templates');
    // Cheeko first, then the rest alphabetically.
    list.sort((a, b) => {
      const ac = /cheeko/i.test(a.agentName), bc = /cheeko/i.test(b.agentName);
      if (ac !== bc) return ac ? -1 : 1;
      return String(a.agentName).localeCompare(String(b.agentName));
    });
    const sel = $('charSelect');
    sel.innerHTML = '';
    list.forEach((t) => {
      const opt = document.createElement('option');
      opt.value = t.id;
      // show a short id so duplicate-named rows are distinguishable
      opt.textContent = `${t.agentName}  (${String(t.id).slice(0, 8)})`;
      sel.appendChild(opt);
    });
    charList = list;
    if (list.length && !creating) await loadChar();
  } catch (e) {
    // token gone stale -> back to login
    if (/password|token|unauth/i.test(e.message)) return logout();
    setStatus(e.message, false);
  }
}

async function loadChar() {
  setStatus('');
  const id = $('charSelect').value;
  const t = await api('GET', '/templates/' + id);
  $('greetingPrompt').value = t.greetingPrompt || '';
  $('agentMd').value = t.systemPrompt || '';
  $('soulMd').value = t.soul || '';
  $('sarvamVoiceId').value = t.sarvamVoiceId || '';
  $('elevenlabsVoiceId').value = t.elevenlabsVoiceId || '';
}

async function save() {
  if (creating) return createChar();
  setStatus('Saving…');
  const id = $('charSelect').value;
  try {
    await api('PUT', '/templates/' + id, {
      greetingPrompt: $('greetingPrompt').value,
      systemPrompt: $('agentMd').value,
      soul: $('soulMd').value,
      sarvamVoiceId: $('sarvamVoiceId').value,
      elevenlabsVoiceId: $('elevenlabsVoiceId').value,
    });
    setStatus('Saved ✓', true);
  } catch (e) {
    setStatus(e.message, false); // surfaces validator 400 message
  }
}

async function deleteChar() {
  const id = $('charSelect').value;
  if (!id) return;
  const name = $('charSelect').selectedOptions[0]?.textContent || 'this character';
  if (!confirm(`Delete ${name}? This cannot be undone.`)) return;
  setStatus('Deleting…');
  try {
    await api('DELETE', '/templates/' + id);
    await showEditor();
    setStatus('Deleted ✓', true);
  } catch (e) {
    setStatus(e.message, false);
  }
}

function setStatus(msg, ok) {
  const el = $('status');
  el.textContent = msg;
  el.className = 'status' + (msg ? (ok ? ' ok' : ' err') : '');
}

// ---- create mode ----
function enterCreateMode() {
  creating = true;
  $('newCharBar').hidden = false;
  $('newName').value = '';
  $('newCode').value = '';
  $('charSelect').disabled = true;
  $('greetingPrompt').value = '';
  $('agentMd').value = '';
  $('soulMd').value = '';
  $('sarvamVoiceId').value = '';
  $('elevenlabsVoiceId').value = '';
  setStatus('Fill name, AGENT.md and SOUL.md, then Save.');
  $('newName').focus();
}

async function exitCreateMode() {
  creating = false;
  $('newCharBar').hidden = true;
  $('charSelect').disabled = false;
  setStatus('');
  if ($('charSelect').value) await loadChar();
}

async function createChar() {
  const name = $('newName').value.trim();
  const code = $('newCode').value.trim();
  const agentMd = $('agentMd').value;
  const soulMd = $('soulMd').value;
  if (!name) return setStatus('Agent name is required', false);
  if (/[0-9]/.test(name)) return setStatus('Agent name must not contain numbers', false);
  if (code && /[0-9]/.test(code)) return setStatus('Agent code must not contain numbers', false);
  if (charList.some((t) => String(t.agentName).toLowerCase() === name.toLowerCase()))
    return setStatus(`Agent name "${name}" already exists`, false);
  if (!agentMd.trim()) return setStatus('AGENT.md (system_prompt) is required', false);
  if (!soulMd.trim()) return setStatus('SOUL.md (soul) is required', false);
  setStatus('Creating…');
  try {
    const data = await api('POST', '/templates', {
      agentName: name,
      agentCode: code || undefined,
      greetingPrompt: $('greetingPrompt').value,
      systemPrompt: agentMd,
      soul: soulMd,
      sarvamVoiceId: $('sarvamVoiceId').value,
      elevenlabsVoiceId: $('elevenlabsVoiceId').value,
    });
    creating = false;
    $('newCharBar').hidden = true;
    $('charSelect').disabled = false;
    await showEditor();
    if (data && data.id) {
      $('charSelect').value = data.id;
      await loadChar();
    }
    setStatus('Created ✓', true);
  } catch (e) {
    setStatus(e.message, false); // server-side dup/validator message
  }
}

// ---- wire up ----
$('loginBtn').addEventListener('click', login);
$('password').addEventListener('keydown', (e) => { if (e.key === 'Enter') login(); });
$('logout').addEventListener('click', logout);
$('charSelect').addEventListener('change', loadChar);
$('saveBtn').addEventListener('click', save);
$('deleteBtn').addEventListener('click', deleteChar);
$('newBtn').addEventListener('click', enterCreateMode);
$('cancelNewBtn').addEventListener('click', exitCreateMode);
$('bankSelect').addEventListener('change', loadBank);
$('bankRefresh').addEventListener('click', loadBank);
$('bankFilter').addEventListener('input', renderBank);
$('bankLevel').addEventListener('change', renderBank);
$('bankNew').addEventListener('click', newQuestion);
$('qSave').addEventListener('click', saveQuestion);
$('qCancel').addEventListener('click', () => { $('bankForm').hidden = true; });
$('bankImportBtn').addEventListener('click', () => {
  $('bankImport').hidden = !$('bankImport').hidden;
});
$('csvRun').addEventListener('click', runCsvImport);
$('csvCancel').addEventListener('click', () => { $('bankImport').hidden = true; });
document.querySelectorAll('.tab').forEach((b) =>
  b.addEventListener('click', () => showTab(b.dataset.tab)));

// auto-resume if token already stored. Deferred to DOMContentLoaded so test.js
// (loaded after this file) has defined loadTestCharacters by the time we call it.
window.addEventListener('DOMContentLoaded', () => { if (token) showEditor(); });
