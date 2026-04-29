/**
 * Device Onboarding Service
 *
 * Uses a separate Supabase database for the public onboarding flow:
 * register/login, activation-code binding, and per-device WebSocket routing.
 */

const bcrypt = require('bcryptjs');
const { onboardingSupabaseAdmin, isOnboardingDbConfigured } = require('../config/onboardingDatabase');
const logger = require('../utils/logger');
const { generateRandomString, normalizeMacAddress } = require('../utils/helpers');

const TOKEN_TTL_SECONDS = 3600 * 24 * 30;
const ACTIVATION_TTL_HOURS = 24;

class OnboardingConfigError extends Error {
  constructor() {
    super('Onboarding database is not configured');
    this.statusCode = 503;
  }
}

const requireClient = () => {
  if (!isOnboardingDbConfigured() || !onboardingSupabaseAdmin) {
    throw new OnboardingConfigError();
  }
  return onboardingSupabaseAdmin;
};

const ensureNoError = (result, fallbackMessage) => {
  if (result.error) {
    const error = new Error(result.error.message || fallbackMessage);
    error.code = result.error.code;
    error.details = result.error.details;
    throw error;
  }
  return result.data;
};

const toPublicUser = (user) => ({
  id: user.id,
  username: user.username,
  email: user.email,
  createdAt: user.created_at
});

const register = async ({ username, password, email }) => {
  const client = requireClient();
  const normalizedUsername = String(username || '').trim();
  const normalizedEmail = email ? String(email).trim().toLowerCase() : null;

  const existingQuery = client
    .from('onboarding_users')
    .select('id')
    .or(normalizedEmail
      ? `username.eq.${normalizedUsername},email.eq.${normalizedEmail}`
      : `username.eq.${normalizedUsername}`)
    .maybeSingle();

  const existing = ensureNoError(await existingQuery, 'Failed to check existing onboarding user');
  if (existing) {
    throw new Error('Username or email already exists');
  }

  const salt = await bcrypt.genSalt(10);
  const passwordHash = await bcrypt.hash(password, salt);

  const user = ensureNoError(await client
    .from('onboarding_users')
    .insert({
      username: normalizedUsername,
      email: normalizedEmail,
      password_hash: passwordHash
    })
    .select('id, username, email, created_at')
    .single(), 'Failed to create onboarding user');

  return toPublicUser(user);
};

const createSession = async (userId) => {
  const client = requireClient();
  const token = generateRandomString(48);
  const expiresAt = new Date(Date.now() + TOKEN_TTL_SECONDS * 1000).toISOString();

  await client
    .from('onboarding_user_tokens')
    .delete()
    .eq('user_id', userId)
    .lt('expires_at', new Date().toISOString());

  ensureNoError(await client
    .from('onboarding_user_tokens')
    .insert({
      user_id: userId,
      token,
      expires_at: expiresAt
    }), 'Failed to create onboarding session');

  return { token, expire: TOKEN_TTL_SECONDS, expiresAt };
};

const login = async ({ username, password }) => {
  const client = requireClient();
  const identifier = String(username || '').trim();

  const user = ensureNoError(await client
    .from('onboarding_users')
    .select('id, username, email, password_hash, created_at')
    .or(`username.eq.${identifier},email.eq.${identifier.toLowerCase()}`)
    .maybeSingle(), 'Failed to load onboarding user');

  if (!user) {
    throw new Error('Invalid username or password');
  }

  const validPassword = await bcrypt.compare(password, user.password_hash);
  if (!validPassword) {
    throw new Error('Invalid username or password');
  }

  const session = await createSession(user.id);
  return {
    ...session,
    user: toPublicUser(user)
  };
};

const verifyToken = async (token) => {
  if (!token || !isOnboardingDbConfigured()) return null;

  const client = requireClient();
  const tokenRow = ensureNoError(await client
    .from('onboarding_user_tokens')
    .select('token, expires_at, user:onboarding_users(id, username, email, created_at)')
    .eq('token', token)
    .maybeSingle(), 'Failed to verify onboarding token');

  if (!tokenRow || !tokenRow.user) return null;

  if (new Date(tokenRow.expires_at) < new Date()) {
    await client.from('onboarding_user_tokens').delete().eq('token', token);
    return null;
  }

  return toPublicUser(tokenRow.user);
};

const saveActivationCode = async ({ macAddress, activationCode, board, appVersion }) => {
  if (!isOnboardingDbConfigured()) return null;

  const client = requireClient();
  const normalizedMac = normalizeMacAddress(macAddress);
  if (!normalizedMac || !activationCode) return null;

  try {
    const existing = ensureNoError(await client
      .from('onboarding_devices')
      .select('id, user_id')
      .eq('mac_address', normalizedMac)
      .maybeSingle(), 'Failed to load onboarding device');

    const expiresAt = new Date(Date.now() + ACTIVATION_TTL_HOURS * 60 * 60 * 1000).toISOString();
    const payload = {
      mac_address: normalizedMac,
      board: board || null,
      app_version: appVersion || null,
      updated_at: new Date().toISOString()
    };

    if (!existing?.user_id) {
      payload.activation_code = activationCode;
      payload.activation_code_expires_at = expiresAt;
    }

    const result = existing
      ? await client.from('onboarding_devices').update(payload).eq('id', existing.id)
      : await client.from('onboarding_devices').insert(payload);

    ensureNoError(result, 'Failed to save onboarding activation code');
    return true;
  } catch (error) {
    logger.warn('Failed to mirror activation code to onboarding DB:', {
      macAddress: normalizedMac,
      message: error.message
    });
    return null;
  }
};

const bindDevice = async ({ userId, activationCode }) => {
  const client = requireClient();
  const code = String(activationCode || '').trim();

  const device = ensureNoError(await client
    .from('onboarding_devices')
    .select('id, user_id, mac_address, board, app_version, activation_code_expires_at')
    .eq('activation_code', code)
    .maybeSingle(), 'Failed to load activation code');

  if (!device) {
    throw new Error('Invalid or expired activation code');
  }

  if (device.activation_code_expires_at && new Date(device.activation_code_expires_at) < new Date()) {
    throw new Error('Invalid or expired activation code');
  }

  if (device.user_id && device.user_id !== userId) {
    throw new Error('Device is already bound to another account');
  }

  const updated = ensureNoError(await client
    .from('onboarding_devices')
    .update({
      user_id: userId,
      bound_at: new Date().toISOString(),
      activation_code: null,
      activation_code_expires_at: null,
      updated_at: new Date().toISOString()
    })
    .eq('id', device.id)
    .select('id, mac_address, board, app_version, bound_at')
    .single(), 'Failed to bind onboarding device');

  return {
    id: updated.id,
    macAddress: updated.mac_address,
    board: updated.board,
    appVersion: updated.app_version,
    boundAt: updated.bound_at
  };
};

const saveDeviceWebsocket = async ({ userId, deviceId, websocketUrl }) => {
  const client = requireClient();

  const device = ensureNoError(await client
    .from('onboarding_devices')
    .select('id, user_id, mac_address')
    .eq('id', deviceId)
    .maybeSingle(), 'Failed to load onboarding device');

  if (!device || device.user_id !== userId) {
    throw new Error('Device not found');
  }

  const saved = ensureNoError(await client
    .from('onboarding_device_websocket')
    .upsert({
      device_id: device.id,
      websocket_url: websocketUrl,
      updated_at: new Date().toISOString()
    }, { onConflict: 'device_id' })
    .select('device_id, websocket_url, updated_at')
    .single(), 'Failed to save WebSocket address');

  return {
    deviceId: saved.device_id,
    macAddress: device.mac_address,
    websocketUrl: saved.websocket_url,
    updatedAt: saved.updated_at
  };
};

const getDeviceWebsocketByMac = async (macAddress) => {
  if (!isOnboardingDbConfigured()) return null;

  const client = requireClient();
  const normalizedMac = normalizeMacAddress(macAddress);
  if (!normalizedMac) return null;

  try {
    const device = ensureNoError(await client
      .from('onboarding_devices')
      .select('id, user_id')
      .eq('mac_address', normalizedMac)
      .maybeSingle(), 'Failed to load onboarding device WebSocket');

    if (!device?.user_id) return null;

    const websocket = ensureNoError(await client
      .from('onboarding_device_websocket')
      .select('websocket_url')
      .eq('device_id', device.id)
      .maybeSingle(), 'Failed to load onboarding WebSocket URL');

    return websocket?.websocket_url || null;
  } catch (error) {
    logger.warn('Failed to read onboarding WebSocket override:', {
      macAddress: normalizedMac,
      message: error.message
    });
    return null;
  }
};

module.exports = {
  OnboardingConfigError,
  register,
  login,
  verifyToken,
  saveActivationCode,
  bindDevice,
  saveDeviceWebsocket,
  getDeviceWebsocketByMac
};
