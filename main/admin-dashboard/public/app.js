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
  $('logout').hidden = true;
  $('loginView').hidden = false;
}

// ---- editor ----
async function showEditor() {
  $('loginView').hidden = true;
  $('editorView').hidden = false;
  $('logout').hidden = false;
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
  $('agentMd').value = t.systemPrompt || '';
  $('soulMd').value = t.soul || '';
}

async function save() {
  if (creating) return createChar();
  setStatus('Saving…');
  const id = $('charSelect').value;
  try {
    await api('PUT', '/templates/' + id, {
      systemPrompt: $('agentMd').value,
      soul: $('soulMd').value,
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
  $('agentMd').value = '';
  $('soulMd').value = '';
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
      systemPrompt: agentMd,
      soul: soulMd,
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

// auto-resume if token already stored
if (token) showEditor();
