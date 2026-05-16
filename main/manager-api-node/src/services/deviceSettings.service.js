/**
 * Device Settings Sync Service
 *
 * MAC-primary settings/state/sync-event management for parent app settings sync.
 */

const axios = require('axios');
const { prisma } = require('../config/database');
const { normalizeMacAddress } = require('../utils/helpers');
const logger = require('../utils/logger');

const DEFAULT_SETTINGS = {
  volume: 70,
  brightness: 80,
  auto_listen: false,
  system_sound: true,
  system_prompt: true,
  vibration: true,
  sleep_enabled: true,
  quiet_hours: {
    enabled: false,
    start: '21:00',
    end: '07:00',
  },
};

const VALID_SYNC_STATUS = new Set(['synced', 'syncing', 'pending_offline', 'rejected', 'stale']);

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HH_MM_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const SETTINGS_CHANGED_DEDUPE_WINDOW_MS = 10000;

function cloneDefaultSettings() {
  return JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
}

function normalizeRequiredMac(macAddress) {
  const normalized = normalizeMacAddress(macAddress);
  if (!normalized) {
    throw new Error('Invalid mac_address format');
  }
  return normalized;
}

function ensureBoolean(value, key) {
  if (typeof value !== 'boolean') {
    throw new Error(`${key} must be boolean`);
  }
}

function ensureIntInRange(value, key, min, max) {
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`${key} must be an integer between ${min} and ${max}`);
  }
}

function mergeAndValidateSettings(currentSettings, patch) {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) {
    throw new Error('settings patch must be an object');
  }

  const next = {
    ...cloneDefaultSettings(),
    ...(currentSettings || {}),
    quiet_hours: {
      ...DEFAULT_SETTINGS.quiet_hours,
      ...((currentSettings && currentSettings.quiet_hours) || {}),
    },
  };

  const allowedTopLevel = new Set([
    'volume',
    'brightness',
    'auto_listen',
    'system_sound',
    'system_prompt',
    'vibration',
    'sleep_enabled',
    'quiet_hours',
  ]);

  for (const key of Object.keys(patch)) {
    if (!allowedTopLevel.has(key)) {
      throw new Error(`Unsupported settings key: ${key}`);
    }
  }

  if (Object.prototype.hasOwnProperty.call(patch, 'volume')) {
    ensureIntInRange(patch.volume, 'volume', 0, 100);
    next.volume = patch.volume;
  }

  if (Object.prototype.hasOwnProperty.call(patch, 'brightness')) {
    ensureIntInRange(patch.brightness, 'brightness', 10, 100);
    next.brightness = patch.brightness;
  }

  for (const boolKey of ['auto_listen', 'system_sound', 'system_prompt', 'vibration', 'sleep_enabled']) {
    if (Object.prototype.hasOwnProperty.call(patch, boolKey)) {
      ensureBoolean(patch[boolKey], boolKey);
      next[boolKey] = patch[boolKey];
    }
  }

  if (Object.prototype.hasOwnProperty.call(patch, 'quiet_hours')) {
    const qh = patch.quiet_hours;
    if (!qh || typeof qh !== 'object' || Array.isArray(qh)) {
      throw new Error('quiet_hours must be an object');
    }

    if (Object.prototype.hasOwnProperty.call(qh, 'enabled')) {
      ensureBoolean(qh.enabled, 'quiet_hours.enabled');
      next.quiet_hours.enabled = qh.enabled;
    }

    if (Object.prototype.hasOwnProperty.call(qh, 'start')) {
      if (typeof qh.start !== 'string' || !HH_MM_RE.test(qh.start)) {
        throw new Error('quiet_hours.start must be in HH:MM format');
      }
      next.quiet_hours.start = qh.start;
    }

    if (Object.prototype.hasOwnProperty.call(qh, 'end')) {
      if (typeof qh.end !== 'string' || !HH_MM_RE.test(qh.end)) {
        throw new Error('quiet_hours.end must be in HH:MM format');
      }
      next.quiet_hours.end = qh.end;
    }
  }

  return next;
}

function toSyncStatusFromAck(ackStatus) {
  if (ackStatus === 'applied') return 'synced';
  if (ackStatus === 'ignored') return 'stale';
  if (ackStatus === 'rejected') return 'rejected';
  return 'syncing';
}

function stableStringify(value) {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  }

  if (value && typeof value === 'object') {
    const keys = Object.keys(value).sort();
    const parts = keys.map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`);
    return `{${parts.join(',')}}`;
  }

  return JSON.stringify(value);
}

async function createSyncEvent({ mac_address, device_id = null, sender_client_id = null, event_type, version = null, status = null, reason = null, payload = {} }) {
  logger.info(`[SETTINGS-SYNC][EVENT] mac=${mac_address} type=${event_type} version=${version ?? 'na'} status=${status || 'na'} reason=${reason || 'na'}`);
  await prisma.device_sync_event.create({
    data: {
      mac_address,
      device_id,
      sender_client_id,
      event_type,
      version,
      status,
      reason,
      payload,
    },
  });
}

async function findOrCreateSettingsByMac(macAddress, deviceId = null) {
  const mac = normalizeRequiredMac(macAddress);

  let row = await prisma.device_settings.findUnique({
    where: { mac_address: mac },
  });

  if (row) {
    logger.info(`[SETTINGS-SYNC][SETTINGS] Found settings row for mac=${mac} version=${row.settings_version}`);
    if (deviceId && !row.device_id) {
      row = await prisma.device_settings.update({
        where: { id: row.id },
        data: { device_id: deviceId, updated_at: new Date() },
      });
    }
    return row;
  }

  return prisma.device_settings.create({
    data: {
      mac_address: mac,
      device_id: deviceId || null,
      settings_version: 1,
      settings: cloneDefaultSettings(),
      sync_status: 'synced',
      last_applied_version: 1,
    },
  });
}

async function getRuntimeStateByMac(macAddress) {
  const mac = normalizeRequiredMac(macAddress);
  return prisma.device_runtime_state.findUnique({
    where: { mac_address: mac },
  });
}

async function isDeviceOnline(macAddress) {
  const runtime = await getRuntimeStateByMac(macAddress);
  if (!runtime || !runtime.online || !runtime.last_seen_at) {
    return false;
  }

  const ageMs = Date.now() - new Date(runtime.last_seen_at).getTime();
  return ageMs <= 2 * 60 * 1000;
}

async function getSettingsByMac(macAddress) {
  const settings = await findOrCreateSettingsByMac(macAddress);
  return settings;
}

async function patchSettingsByMac(macAddress, patch, deviceId = null) {
  const mac = normalizeRequiredMac(macAddress);
  const current = await findOrCreateSettingsByMac(mac, deviceId);
  const merged = mergeAndValidateSettings(current.settings, patch);

  const unchanged = JSON.stringify(current.settings) === JSON.stringify(merged);
  if (unchanged) {
    logger.info(`[SETTINGS-SYNC][PATCH] No-op patch for mac=${mac} version=${current.settings_version}`);
    return {
      changed: false,
      publishRequired: false,
      targetSyncStatus: current.sync_status,
      settings: current,
    };
  }

  const nextVersion = current.settings_version + 1;
  const online = await isDeviceOnline(mac);
  const targetSyncStatus = online ? 'syncing' : 'pending_offline';

  const updated = await prisma.device_settings.update({
    where: { id: current.id },
    data: {
      device_id: deviceId || current.device_id,
      settings: merged,
      settings_version: nextVersion,
      sync_status: targetSyncStatus,
      last_sent_version: online ? nextVersion : current.last_sent_version,
      updated_at: new Date(),
    },
  });

  await createSyncEvent({
    mac_address: mac,
    device_id: deviceId || current.device_id,
    event_type: 'settings_update',
    version: nextVersion,
    status: targetSyncStatus,
    payload: { settings: merged, source: 'mobile_patch' },
  });

  logger.info(
    `[SETTINGS-SYNC][PATCH] mac=${mac} version ${current.settings_version} -> ${nextVersion} sync_status=${targetSyncStatus} publishRequired=${online}`
  );

  return {
    changed: true,
    publishRequired: online,
    targetSyncStatus,
    settings: updated,
  };
}

async function onSettingsGet({ mac_address, sender_client_id = null, device_id = null, current_version = null, payload = {} }) {
  const mac = normalizeRequiredMac(mac_address);
  const settings = await findOrCreateSettingsByMac(mac, device_id);

  await createSyncEvent({
    mac_address: mac,
    device_id,
    sender_client_id,
    event_type: 'settings_get',
    version: current_version == null ? null : Number(current_version),
    status: 'received',
    payload,
  });

  const currentVersion = Number.isFinite(Number(current_version)) ? Number(current_version) : -1;
  const shouldPublish = settings.settings_version > currentVersion;

  logger.info(
    `[SETTINGS-SYNC][GET] mac=${mac} sender=${sender_client_id || 'na'} device_version=${currentVersion} server_version=${settings.settings_version} publish=${shouldPublish}`
  );

  if (shouldPublish) {
    await prisma.device_settings.update({
      where: { id: settings.id },
      data: {
        sync_status: 'syncing',
        last_sent_version: settings.settings_version,
        updated_at: new Date(),
      },
    });

    await createSyncEvent({
      mac_address: mac,
      device_id,
      sender_client_id,
      event_type: 'settings_update',
      version: settings.settings_version,
      status: 'queued',
      payload: { source: 'settings_get_compare' },
    });
  }

  return {
    shouldPublish,
    targetClientId: sender_client_id,
    mqttMessage: shouldPublish
      ? {
        type: 'settings_update',
        version: settings.settings_version,
        settings: settings.settings,
      }
      : null,
    settingsVersion: settings.settings_version,
  };
}

async function onSettingsAck({ mac_address, sender_client_id = null, device_id = null, version = null, status = null, applied_version = null, reason = null, payload = {} }) {
  const mac = normalizeRequiredMac(mac_address);
  const settings = await findOrCreateSettingsByMac(mac, device_id);

  const ackStatus = typeof status === 'string' ? status : 'unknown';
  const syncStatus = toSyncStatusFromAck(ackStatus);

  const updated = await prisma.device_settings.update({
    where: { id: settings.id },
    data: {
      device_id: device_id || settings.device_id,
      sync_status: VALID_SYNC_STATUS.has(syncStatus) ? syncStatus : 'syncing',
      last_ack_status: ackStatus,
      last_ack_reason: reason || null,
      last_applied_version: Number.isFinite(Number(applied_version))
        ? Number(applied_version)
        : (Number.isFinite(Number(version)) ? Number(version) : settings.last_applied_version),
      updated_at: new Date(),
    },
  });

  await createSyncEvent({
    mac_address: mac,
    device_id,
    sender_client_id,
    event_type: 'settings_ack',
    version: Number.isFinite(Number(version)) ? Number(version) : null,
    status: ackStatus,
    reason,
    payload,
  });

  logger.info(
    `[SETTINGS-SYNC][ACK] mac=${mac} sender=${sender_client_id || 'na'} status=${ackStatus} version=${version ?? 'na'} applied=${applied_version ?? 'na'} sync_status=${updated.sync_status}`
  );

  return updated;
}

async function onSettingsChanged({ mac_address, sender_client_id = null, device_id = null, payload = {} }) {
  const mac = normalizeRequiredMac(mac_address);
  const snapshot = payload?.settings;
  if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) {
    throw new Error('payload.settings object is required');
  }

  const settings = await findOrCreateSettingsByMac(mac, device_id);
  const latestEvent = await prisma.device_sync_event.findFirst({
    where: {
      mac_address: mac,
      event_type: 'settings_changed',
    },
    orderBy: { created_at: 'desc' },
    select: {
      created_at: true,
      reason: true,
      payload: true,
    },
  });

  const nowMs = Date.now();
  const previousSettings = latestEvent?.payload && typeof latestEvent.payload === 'object'
    ? latestEvent.payload.settings
    : null;
  const isRecent = latestEvent?.created_at
    ? (nowMs - new Date(latestEvent.created_at).getTime()) <= SETTINGS_CHANGED_DEDUPE_WINDOW_MS
    : false;
  const isSameReason = (latestEvent?.reason || null) === (payload.reason || null);
  const isSameSnapshot = previousSettings != null
    && stableStringify(previousSettings) === stableStringify(snapshot);

  if (isRecent && isSameReason && isSameSnapshot) {
    logger.info(`[SETTINGS-SYNC][CHANGED] deduped mac=${mac} sender=${sender_client_id || 'na'} reason=${payload.reason || 'na'}`);
    return {
      deduplicated: true,
      shouldPublish: false,
      settingsVersion: settings.settings_version,
      mqttMessage: null,
    };
  }

  const nextVersion = settings.settings_version + 1;
  const updated = await prisma.device_settings.update({
    where: { id: settings.id },
    data: {
      device_id: device_id || settings.device_id,
      settings: snapshot,
      settings_version: nextVersion,
      sync_status: 'syncing',
      last_sent_version: nextVersion,
      updated_at: new Date(),
    },
  });

  await createSyncEvent({
    mac_address: mac,
    device_id,
    sender_client_id,
    event_type: 'settings_changed',
    version: Number.isFinite(Number(payload.settings_version)) ? Number(payload.settings_version) : settings.settings_version,
    status: 'received',
    reason: payload.reason || null,
    payload,
  });

  await createSyncEvent({
    mac_address: mac,
    device_id,
    sender_client_id,
    event_type: 'settings_update',
    version: nextVersion,
    status: 'queued',
    reason: payload.reason || null,
    payload: { source: 'settings_changed_echo' },
  });

  logger.info(
    `[SETTINGS-SYNC][CHANGED] mac=${mac} sender=${sender_client_id || 'na'} reason=${payload.reason || 'na'} server_version=${nextVersion}`
  );

  return {
    deduplicated: false,
    shouldPublish: true,
    settingsVersion: updated.settings_version,
    mqttMessage: {
      type: 'settings_update',
      version: updated.settings_version,
      settings: updated.settings,
    },
  };
}

async function onDeviceState({ mac_address, sender_client_id = null, device_id = null, payload = {} }) {
  const mac = normalizeRequiredMac(mac_address);
  await findOrCreateSettingsByMac(mac, device_id);

  const now = new Date();
  const data = {
    device_id: device_id || null,
    online: true,
    last_seen_at: now,
    firmware: payload.firmware || null,
    build_label: payload.build_label || null,
    mode: payload.mode || null,
    network: payload.network || null,
    battery: Number.isFinite(Number(payload.battery)) ? Number(payload.battery) : null,
    charging: typeof payload.charging === 'boolean' ? payload.charging : null,
    discharging: typeof payload.discharging === 'boolean' ? payload.discharging : null,
    settings_version: Number.isFinite(Number(payload.settings_version)) ? Number(payload.settings_version) : null,
    reason: payload.reason || null,
    raw_state: payload,
    updated_at: now,
  };

  const updated = await prisma.device_runtime_state.upsert({
    where: { mac_address: mac },
    update: data,
    create: {
      mac_address: mac,
      ...data,
    },
  });

  await createSyncEvent({
    mac_address: mac,
    device_id,
    sender_client_id,
    event_type: 'device_state',
    version: data.settings_version,
    status: 'received',
    payload,
  });

  logger.info(
    `[SETTINGS-SYNC][STATE] mac=${mac} sender=${sender_client_id || 'na'} reason=${payload.reason || 'na'} mode=${payload.mode || 'na'} network=${payload.network || 'na'} settings_version=${data.settings_version ?? 'na'}`
  );

  return updated;
}

async function markSyncStatusByMac(macAddress, syncStatus, reason = null) {
  const mac = normalizeRequiredMac(macAddress);
  if (!VALID_SYNC_STATUS.has(syncStatus)) {
    throw new Error(`Invalid sync status: ${syncStatus}`);
  }

  const settings = await findOrCreateSettingsByMac(mac);
  const updated = await prisma.device_settings.update({
    where: { id: settings.id },
    data: {
      sync_status: syncStatus,
      last_ack_reason: reason || settings.last_ack_reason,
      updated_at: new Date(),
    },
  });

  await createSyncEvent({
    mac_address: mac,
    event_type: 'settings_update',
    version: updated.settings_version,
    status: syncStatus,
    reason: reason || null,
    payload: { source: 'mark_sync_status' },
  });

  return updated;
}

async function listSyncEventsByMac(macAddress, limit = 50) {
  const mac = normalizeRequiredMac(macAddress);
  const safeLimit = Number.isFinite(Number(limit)) ? Math.max(1, Math.min(200, Number(limit))) : 50;
  return prisma.device_sync_event.findMany({
    where: { mac_address: mac },
    orderBy: { created_at: 'desc' },
    take: safeLimit,
  });
}

async function resolveOwnedDeviceForMobile(mobileUserId, deviceIdOrMac) {
  if (!mobileUserId) {
    throw new Error('mobileUserId is required');
  }

  const idOrMac = (deviceIdOrMac || '').trim();
  if (!idOrMac) {
    throw new Error('deviceId is required');
  }

  let device = null;

  if (UUID_RE.test(idOrMac)) {
    device = await prisma.ai_device.findFirst({
      where: {
        id: idOrMac,
        user_id: BigInt(mobileUserId),
      },
      select: { id: true, mac_address: true },
    });
  }

  if (!device) {
    const normalizedMac = normalizeMacAddress(idOrMac);
    if (!normalizedMac) {
      return null;
    }

    device = await prisma.ai_device.findFirst({
      where: {
        mac_address: normalizedMac,
        user_id: BigInt(mobileUserId),
      },
      select: { id: true, mac_address: true },
    });
  }

  return device;
}

async function requestGatewaySettingsPublish({ mac_address, version, settings }) {
  const base = (process.env.MQTT_GATEWAY_INTERNAL_URL || 'http://127.0.0.1:8091').replace(/\/$/, '');
  const serviceKey = process.env.SERVICE_SECRET_KEY;
  if (!serviceKey) {
    throw new Error('SERVICE_SECRET_KEY is not configured');
  }

  logger.info(`[SETTINGS-SYNC][PUBLISH-REQ] mac=${mac_address} version=${version} gateway=${base}`);
  const response = await axios.post(
    `${base}/internal/settings/publish-update`,
    {
      mac_address,
      message: {
        type: 'settings_update',
        version,
        settings,
      },
    },
    {
      timeout: 5000,
      headers: {
        'X-Service-Key': serviceKey,
      },
    }
  );

  logger.info(`[SETTINGS-SYNC][PUBLISH-RES] mac=${mac_address} version=${version} result_code=${response?.data?.code}`);

  return response.data;
}

module.exports = {
  DEFAULT_SETTINGS,
  findOrCreateSettingsByMac,
  getSettingsByMac,
  patchSettingsByMac,
  onSettingsGet,
  onSettingsAck,
  onSettingsChanged,
  onDeviceState,
  markSyncStatusByMac,
  getRuntimeStateByMac,
  listSyncEventsByMac,
  resolveOwnedDeviceForMobile,
  requestGatewaySettingsPublish,
};
