const state = {
  step: 0,
  token: localStorage.getItem('cheeko_onboarding_token') || '',
  device: readJson('cheeko_onboarding_device') || null,
  websocketUrl: ''
};

const API_BASE = (window.CHEEKO_API_BASE || 'http://127.0.0.1:8002/toy').replace(/\/+$/, '');
const message = document.querySelector('#message');
const loginForm = document.querySelector('#loginForm');
const registerForm = document.querySelector('#registerForm');
const activationForm = document.querySelector('#activationForm');
const websocketForm = document.querySelector('#websocketForm');
const deviceSummary = document.querySelector('#deviceSummary');
const savedUrl = document.querySelector('#savedUrl');

function readJson(key) {
  try {
    const value = localStorage.getItem(key);
    return value ? JSON.parse(value) : null;
  } catch (_) {
    localStorage.removeItem(key);
    return null;
  }
}

function showMessage(text, type = 'error') {
  message.textContent = text;
  message.className = type === 'success' ? 'message success' : 'message';
  message.hidden = false;
}

function clearMessage() {
  message.hidden = true;
  message.textContent = '';
}

async function api(path, options = {}) {
  clearMessage();
  const headers = {
    'Content-Type': 'application/json',
    ...(options.headers || {})
  };

  if (state.token) {
    headers.Authorization = `Bearer ${state.token}`;
  }

  const response = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers
  });

  const body = await response.json().catch(() => ({}));
  if (!response.ok || (body.code && body.code !== 0)) {
    throw new Error(body.msg || `Request failed with ${response.status}`);
  }

  return body.data;
}

function setStep(step) {
  state.step = step;
  document.querySelectorAll('.screen').forEach((screen) => {
    screen.classList.toggle('is-active', Number(screen.dataset.screen) === step);
  });
  document.querySelectorAll('.step').forEach((button) => {
    button.classList.toggle('is-active', Number(button.dataset.step) === step);
  });
}

function setLoading(form, loading) {
  const button = form.querySelector('button[type="submit"], .primary');
  if (!button) return;
  button.disabled = loading;
  button.dataset.originalText = button.dataset.originalText || button.textContent;
  button.textContent = loading ? 'Working...' : button.dataset.originalText;
}

function updateDeviceSummary() {
  if (!state.device) {
    deviceSummary.hidden = true;
    return;
  }

  deviceSummary.innerHTML = `Bound device <strong>${state.device.macAddress || state.device.id}</strong>`;
  deviceSummary.hidden = false;
}

document.querySelectorAll('.tab').forEach((tab) => {
  tab.addEventListener('click', () => {
    const mode = tab.dataset.mode;
    document.querySelectorAll('.tab').forEach((item) => item.classList.toggle('is-active', item === tab));
    loginForm.classList.toggle('is-hidden', mode !== 'login');
    registerForm.classList.toggle('is-hidden', mode !== 'register');
  });
});

document.querySelectorAll('[data-back]').forEach((button) => {
  button.addEventListener('click', () => setStep(Number(button.dataset.back)));
});

loginForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  setLoading(loginForm, true);

  try {
    const form = new FormData(loginForm);
    const data = await api('/onboarding/login', {
      method: 'POST',
      body: JSON.stringify({
        username: form.get('username'),
        password: form.get('password')
      })
    });

    state.token = data.token;
    localStorage.setItem('cheeko_onboarding_token', data.token);
    localStorage.setItem('cheeko_onboarding_user', JSON.stringify(data.user));
    showMessage('Login successful', 'success');
    setStep(state.device ? 2 : 1);
  } catch (error) {
    showMessage(error.message || 'Login failed');
  } finally {
    setLoading(loginForm, false);
  }
});

registerForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  setLoading(registerForm, true);

  try {
    const form = new FormData(registerForm);
    const password = form.get('password');
    if (password !== form.get('confirmPassword')) {
      throw new Error('Passwords do not match');
    }

    await api('/onboarding/register', {
      method: 'POST',
      body: JSON.stringify({
        username: form.get('username'),
        email: form.get('email') || null,
        password
      })
    });

    loginForm.username.value = form.get('username');
    loginForm.password.value = password;
    loginForm.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
  } catch (error) {
    showMessage(error.message || 'Registration failed');
  } finally {
    setLoading(registerForm, false);
  }
});

activationForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  setLoading(activationForm, true);

  try {
    const form = new FormData(activationForm);
    const activationCode = String(form.get('activationCode') || '').trim();
    if (!/^\d{6}$/.test(activationCode)) {
      throw new Error('Enter the 6-digit activation code');
    }

    const device = await api('/onboarding/bind-device', {
      method: 'POST',
      body: JSON.stringify({ activationCode })
    });

    state.device = device;
    localStorage.setItem('cheeko_onboarding_device', JSON.stringify(device));
    updateDeviceSummary();
    showMessage('Device bound', 'success');
    setStep(2);
  } catch (error) {
    showMessage(error.message || 'Device binding failed');
  } finally {
    setLoading(activationForm, false);
  }
});

websocketForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  setLoading(websocketForm, true);

  try {
    if (!state.device?.id) {
      setStep(1);
      throw new Error('Bind a device first');
    }

    const form = new FormData(websocketForm);
    const websocketUrl = String(form.get('websocketUrl') || '').trim();
    if (!/^wss?:\/\/.+/i.test(websocketUrl)) {
      throw new Error('Enter a valid ws:// or wss:// address');
    }

    await api(`/onboarding/devices/${state.device.id}/websocket`, {
      method: 'PUT',
      body: JSON.stringify({ websocketUrl })
    });

    state.websocketUrl = websocketUrl;
    localStorage.removeItem('cheeko_onboarding_device');
    savedUrl.textContent = websocketUrl;
    showMessage('WebSocket address saved', 'success');
    setStep(3);
  } catch (error) {
    showMessage(error.message || 'Failed to save WebSocket address');
  } finally {
    setLoading(websocketForm, false);
  }
});

document.querySelector('#againButton').addEventListener('click', () => {
  state.device = null;
  state.websocketUrl = '';
  activationForm.reset();
  websocketForm.reset();
  updateDeviceSummary();
  setStep(1);
});

if (state.token) {
  setStep(state.device ? 2 : 1);
} else {
  setStep(0);
}
updateDeviceSummary();
