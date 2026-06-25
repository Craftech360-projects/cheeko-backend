// Cheeko persona admin — vanilla JS, no build step.
// Token = the admin password (ponytail auth). Kept in sessionStorage.

const API = '/api'; // proxied by server.js to the Manager's /admin-dashboard routes
const $ = (id) => document.getElementById(id);

let token = sessionStorage.getItem('adminToken') || '';

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
    if (list.length) await loadChar();
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

function setStatus(msg, ok) {
  const el = $('status');
  el.textContent = msg;
  el.className = 'status' + (msg ? (ok ? ' ok' : ' err') : '');
}

// ---- wire up ----
$('loginBtn').addEventListener('click', login);
$('password').addEventListener('keydown', (e) => { if (e.key === 'Enter') login(); });
$('logout').addEventListener('click', logout);
$('charSelect').addEventListener('change', loadChar);
$('saveBtn').addEventListener('click', save);

// auto-resume if token already stored
if (token) showEditor();
