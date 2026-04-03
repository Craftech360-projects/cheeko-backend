/**
 * Device Service
 *
 * Handles ESP32 device management, registration, binding, and mode control.
 */

const { prisma } = require('../config/database');
const logger = require('../utils/logger');
const { generateDeviceCode, normalizeMacAddress } = require('../utils/helpers');

/**
 * In-memory activation code cache
 * In production, this should be replaced with Redis or database storage
 * Map structure: activationCode -> { macAddress, board, appVersion, createdAt }
 */
const activationCodeCache = new Map();
const activationMacCache = new Map(); // macAddress -> activationCode (reverse lookup)

// Clean up expired activation codes (older than 24 hours)
const ACTIVATION_CODE_TTL = 24 * 60 * 60 * 1000; // 24 hours in ms
setInterval(() => {
  const now = Date.now();
  for (const [code, data] of activationCodeCache.entries()) {
    if (now - data.createdAt > ACTIVATION_CODE_TTL) {
      activationCodeCache.delete(code);
      activationMacCache.delete(data.macAddress);
    }
  }
}, 60 * 60 * 1000); // Clean up every hour

/**
 * Normalize OTA base URL so firmware download links are always valid.
 * Supports:
 * - Host only: http://host -> http://host/<contextPath>
 * - Legacy Java style: http://host/<contextPath>/ota/ -> http://host/<contextPath>
 * - Current style: http://host/<contextPath>
 * @param {string|null} rawOtaUrl
 * @returns {string|null}
 */
const normalizeOtaBaseUrl = (rawOtaUrl) => {
  if (!rawOtaUrl || rawOtaUrl === 'null') return null;

  const contextPath = (process.env.CONTEXT_PATH || '/toy').replace(/\/+$/, '') || '/toy';
  let otaUrl = String(rawOtaUrl).trim().replace(/\/+$/, '');

  // Backward compatibility with Java config style ending in /ota or /ota/
  if (otaUrl.endsWith('/ota')) {
    otaUrl = otaUrl.slice(0, -4);
  }

  try {
    const parsed = new URL(otaUrl);
    const path = parsed.pathname.replace(/\/+$/, '');

    // If only host/root is configured, append API context path.
    if (!path || path === '/') {
      parsed.pathname = contextPath;
    }

    return parsed.toString().replace(/\/+$/, '');
  } catch (_) {
    // Non-URL input fallback: keep behavior safe and deterministic.
    if (!otaUrl.endsWith(contextPath)) {
      otaUrl = `${otaUrl}${contextPath}`;
    }
    return otaUrl.replace(/\/+$/, '');
  }
};

/**
 * Register a new device
 * @param {Object} data - Device data
 * @returns {Promise<Object>} Created device
 */
const registerDevice = async ({ mac, board, appVersion }) => {
  const normalizedMac = normalizeMacAddress(mac);
  if (!normalizedMac) throw new Error('Invalid MAC address format');

  const now = new Date();
  const existing = await prisma.ai_device.findUnique({ where: { mac_address: normalizedMac }, select: { id: true } });

  if (existing) {
    return prisma.ai_device.update({
      where: { id: existing.id },
      data: { board: board || null, app_version: appVersion || null, last_connected_at: now, update_date: now },
    });
  }

  return prisma.ai_device.create({
    data: {
      mac_address: normalizedMac,
      board: board || null,
      app_version: appVersion || null,
      mode: 'conversation',
      device_mode: 'manual',
      last_connected_at: now,
    },
  });
};

/**
 * Bind device to user and agent
 * @param {number} userId - User ID
 * @param {string} agentId - Agent ID
 * @param {string} deviceCode - 6-digit device code or MAC address
 * @returns {Promise<Object>} Bound device
 */
const bindDevice = async (userId, agentId, deviceCode) => {
  let device = null;
  let macAddress = null;
  let activationData = null;

  if (deviceCode.includes(':') || deviceCode.length === 12) {
    macAddress = normalizeMacAddress(deviceCode);
    device = await prisma.ai_device.findUnique({ where: { mac_address: macAddress } });
    if (!device) throw new Error('Device not found. Please use the 6-digit activation code.');
  } else if (/^\d{6}$/.test(deviceCode)) {
    activationData = activationCodeCache.get(deviceCode);
    if (!activationData) throw new Error('Invalid or expired activation code');
    macAddress = activationData.macAddress;
    const existing = await prisma.ai_device.findUnique({ where: { mac_address: macAddress } });
    if (existing) {
      if (existing.user_id && existing.user_id !== BigInt(userId)) throw new Error('Device is already bound to another user');
      device = existing;
    }
  } else {
    throw new Error('Invalid device code format. Use 6-digit activation code or MAC address.');
  }

  const agent = await prisma.ai_agent.findFirst({
    where: { id: agentId, user_id: BigInt(userId) },
    select: { id: true },
  });
  if (!agent) throw new Error('Agent not found or does not belong to user');

  if (device) {
    if (device.user_id && device.user_id !== BigInt(userId)) throw new Error('Device is already bound to another user');
    const updated = await prisma.ai_device.update({
      where: { id: device.id },
      data: { user_id: BigInt(userId), agent_id: agentId, update_date: new Date() },
    });
    if (activationData) {
      activationCodeCache.delete(deviceCode);
      activationMacCache.delete(macAddress);
      logger.info(`Device ${macAddress} activated and bound to agent ${agentId}`);
    }
    return updated;
  } else {
    const now = new Date();
    const newDevice = await prisma.ai_device.create({
      data: {
        mac_address: macAddress,
        user_id: BigInt(userId),
        agent_id: agentId,
        board: activationData.board || null,
        app_version: activationData.appVersion || null,
        auto_update: 1,
        mode: 'conversation',
        device_mode: 'manual',
        create_date: now,
        update_date: now,
        last_connected_at: now,
        creator: BigInt(userId),
        updater: BigInt(userId),
      },
    });
    activationCodeCache.delete(deviceCode);
    activationMacCache.delete(macAddress);
    logger.info(`New device ${macAddress} created and bound to agent ${agentId}`);
    return newDevice;
  }
};

// Keep the old implementation structure for the rest
/**
 * Get devices bound to an agent
 * @param {number} userId - User ID
 * @param {string} agentId - Agent ID
 * @returns {Promise<Array>} List of devices
 */
const getDevicesByAgent = async (userId, agentId, isSuperAdmin = false) => {
  const where = { agent_id: agentId, ...(!isSuperAdmin ? { user_id: BigInt(userId) } : {}) };
  const devices = await prisma.ai_device.findMany({
    where,
    orderBy: { create_date: 'desc' },
  });
  return devices;
};

/**
 * Unbind device from user
 * @param {number} userId - User ID
 * @param {string} deviceId - Device ID
 */
const unbindDevice = async (userId, deviceId, isSuperAdmin = false) => {
  const device = await prisma.ai_device.findUnique({
    where: { id: deviceId },
    select: { id: true, user_id: true },
  });

  if (!device) throw new Error('Device not found');

  if (!isSuperAdmin && device.user_id !== BigInt(userId)) {
    throw new Error("You don't have permission to unbind this device");
  }

  await prisma.ai_device.update({
    where: { id: deviceId },
    data: { user_id: null, agent_id: null, kid_id: null, update_date: new Date() },
  });
};

/**
 * Update device
 * @param {number} userId - User ID
 * @param {string} deviceId - Device ID
 * @param {Object} data - Update data
 * @param {boolean} isSuperAdmin - Whether user is super admin
 * @returns {Promise<Object>} Updated device
 */
const updateDevice = async (userId, deviceId, data, isSuperAdmin = false) => {
  const device = await prisma.ai_device.findUnique({
    where: { id: deviceId },
    select: { id: true, user_id: true },
  });

  if (!device) throw new Error('Device not found');
  if (!isSuperAdmin && device.user_id && device.user_id !== BigInt(userId)) {
    throw new Error('Device does not belong to user');
  }

  const updateData = { update_date: new Date() };
  if (data.alias !== undefined) updateData.alias = data.alias;
  if (data.autoUpdate !== undefined) updateData.auto_update = data.autoUpdate ? 1 : 0;
  if (data.agentId !== undefined) updateData.agent_id = data.agentId;
  if (data.deviceMode !== undefined) updateData.device_mode = data.deviceMode;
  if (data.mode !== undefined) updateData.mode = data.mode;

  return prisma.ai_device.update({ where: { id: deviceId }, data: updateData });
};

/**
 * Assign kid profile to device
 * @param {number} userId - User ID
 * @param {string} deviceId - Device ID
 * @param {number} kidId - Kid profile ID
 * @returns {Promise<Object>} Updated device
 */
const assignKidToDevice = async (userId, deviceId, kidId) => {
  const device = await prisma.ai_device.findUnique({
    where: { id: deviceId },
    select: { id: true, user_id: true },
  });

  if (!device) throw new Error('Device not found');
  if (device.user_id !== BigInt(userId)) throw new Error('Device does not belong to user');

  if (kidId) {
    const kid = await prisma.kid_profile.findFirst({
      where: { id: BigInt(kidId), user_id: BigInt(userId) },
      select: { id: true },
    });
    if (!kid) throw new Error('Kid profile not found');
  }

  return prisma.ai_device.update({
    where: { id: deviceId },
    data: { kid_id: kidId ? BigInt(kidId) : null, update_date: new Date() },
  });
};

/**
 * Assign kid to device by MAC address
 * @param {string} mac - Device MAC address
 * @param {number} kidId - Kid profile ID
 * @returns {Promise<Object>} Updated device
 */
const assignKidByMac = async (mac, kidId) => {
  const normalizedMac = normalizeMacAddress(mac);
  const updated = await prisma.ai_device.update({
    where: { mac_address: normalizedMac },
    data: { kid_id: BigInt(kidId), update_date: new Date() },
  });
  return updated;
};

/**
 * Cycle device mode (conversation -> music -> story -> conversation)
 * @param {string} mac - Device MAC address
 * @returns {Promise<Object>} New mode
 */
const cycleMode = async (mac) => {
  const normalizedMac = normalizeMacAddress(mac);
  const device = await prisma.ai_device.findUnique({
    where: { mac_address: normalizedMac },
    select: { id: true, mode: true },
  });

  if (!device) throw new Error('Device not found');

  const modes = ['conversation', 'music', 'story'];
  const currentIndex = modes.indexOf(device.mode || 'conversation');
  const nextMode = modes[(currentIndex + 1) % modes.length];

  const updated = await prisma.ai_device.update({
    where: { id: device.id },
    data: { mode: nextMode, update_date: new Date() },
    select: { mode: true },
  });

  return { mode: updated.mode, previousMode: device.mode };
};

/**
 * Get device mode
 * @param {string} mac - Device MAC address
 * @returns {Promise<Object>} Device mode
 */
const getMode = async (mac) => {
  const normalizedMac = normalizeMacAddress(mac);
  const device = await prisma.ai_device.findUnique({
    where: { mac_address: normalizedMac },
    select: { mode: true, device_mode: true },
  });

  if (!device) throw new Error('Device not found');

  return {
    mode: device.mode || 'conversation',
    deviceMode: device.device_mode || 'auto',
  };
};

/**
 * Get device by MAC address
 * @param {string} mac - Device MAC address
 * @returns {Promise<Object>} Device
 */
const getDeviceByMac = async (mac) => {
  const normalizedMac = normalizeMacAddress(mac);
  return prisma.ai_device.findUnique({ where: { mac_address: normalizedMac } });
};

/**
 * Get device by ID
 * @param {string} deviceId - Device ID
 * @returns {Promise<Object>} Device
 */
const getDeviceById = async (deviceId) => {
  return prisma.ai_device.findUnique({ where: { id: deviceId } });
};

/**
 * List all devices for a user
 * @param {number} userId - User ID
 * @param {Object} options - Pagination options
 * @returns {Promise<Object>} Paginated devices
 */
const listDevices = async (userId, { page = 1, limit = 10 } = {}) => {
  const where = { user_id: BigInt(userId) };
  const [count, devices] = await Promise.all([
    prisma.ai_device.count({ where }),
    prisma.ai_device.findMany({
      where,
      orderBy: { create_date: 'desc' },
      skip: (page - 1) * limit,
      take: limit,
    }),
  ]);
  return { list: devices, total: count, page, limit };
};

/**
 * Manually add device (admin)
 * @param {number} userId - User ID
 * @param {Object} data - Device data
 * @returns {Promise<Object>} Created device
 */
const manualAddDevice = async (userId, { macAddress, mac, alias, agentId, board, appVersion }) => {
  const deviceMac = macAddress || mac;
  const normalizedMac = normalizeMacAddress(deviceMac);
  if (!normalizedMac) throw new Error('Invalid MAC address format');

  const existing = await prisma.ai_device.findUnique({
    where: { mac_address: normalizedMac },
    select: { id: true },
  });
  if (existing) throw new Error('Device already exists');

  return prisma.ai_device.create({
    data: {
      mac_address: normalizedMac,
      user_id: BigInt(userId),
      alias,
      agent_id: agentId ? BigInt(agentId) : null,
      board,
      app_version: appVersion,
      mode: 'conversation',
      device_mode: 'manual',
      auto_update: 1,
      creator: BigInt(userId),
      updater: BigInt(userId),
    },
  });
};

// =============================================
// OTA (Over-The-Air) Firmware Update Methods
// =============================================

/**
 * Get the latest firmware by type
 * @param {string} type - Firmware type (e.g., 'esp32', 'esp32s3')
 * @returns {Promise<Object|null>} Latest firmware or null
 */
const getLatestFirmware = async (type) => {
  return prisma.ai_ota.findFirst({
    where: { type },
    orderBy: { create_date: 'desc' },
  });
};

/**
 * Get firmware that requires force update
 * @param {string} type - Firmware type
 * @returns {Promise<Object|null>} Force update firmware or null
 */
const getForceUpdateFirmware = async (type) => {
  return prisma.ai_ota.findFirst({
    where: { type, force_update: 1 },
    orderBy: { create_date: 'desc' },
  });
};

/**
 * Check OTA version for a device
 * @param {string} mac - Device MAC address
 * @param {string} currentVersion - Device's current firmware version
 * @param {string} board - Device board type
 * @returns {Promise<Object>} OTA check response
 */
const checkOtaVersion = async (mac, clientId, deviceReport) => {

  const normalizedMac = normalizeMacAddress(mac);
  if (!normalizedMac) throw new Error('Invalid MAC address format');

  // Extract device info from report (Spring Boot DeviceReportReqDTO format)
  const currentVersion = deviceReport?.application?.version || deviceReport?.version;
  const board = deviceReport?.board?.type || deviceReport?.chipModelName;

  // Build server_time (matches Spring Boot ServerTime)
  const now = new Date();
  const timezoneOffset = -now.getTimezoneOffset(); // In minutes, positive for east of UTC
  const response = {
    server_time: {
      timestamp: Date.now(),
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
      timezone_offset: timezoneOffset
    }
  };

  // Get device record
  const device = await getDeviceByMac(normalizedMac);

  // Only include firmware section if there's an actual update available
  if (device && device.auto_update !== 0) {
    const firmwareType = board || 'esp32';
    const forceUpdateFirmware = await getForceUpdateFirmware(firmwareType);
    const latestFirmware = await getLatestFirmware(firmwareType);
    const otaBaseUrl = normalizeOtaBaseUrl(await getSystemParam('server.ota'));

    // Include firmware if:
    // 1. Force update is enabled (regardless of version), OR
    // 2. There's a newer version available
    if (forceUpdateFirmware) {
      // Force update - always include, version doesn't matter
      if (otaBaseUrl) {
        response.firmware = {
          version: forceUpdateFirmware.version,
          url: `${otaBaseUrl}/otaMag/download/${forceUpdateFirmware.id}`,
          force: 1
        };
      } else {
        logger.warn('Missing or invalid server.ota system param; skipping firmware URL in OTA response');
      }
    } else if (latestFirmware && latestFirmware.version !== currentVersion) {
      // New version available (no force)
      if (otaBaseUrl) {
        response.firmware = {
          version: latestFirmware.version,
          url: `${otaBaseUrl}/otaMag/download/${latestFirmware.id}`,
          force: 0
        };
      } else {
        logger.warn('Missing or invalid server.ota system param; skipping firmware URL in OTA response');
      }
    }
  }

  // Update device last connection time if device exists
  if (device) {
    await prisma.ai_device.update({
      where: { id: device.id },
      data: {
        last_connected_at: new Date(),
        app_version: currentVersion || device.app_version,
        board: board || device.board,
      },
    });
  }

  // Build WebSocket configuration
  let wsUrl = await getSystemParam('server.websocket');
  if (!wsUrl || wsUrl === 'null') {
    wsUrl = 'ws://192.168.1.99:8000/cheeko/v1/';
  } else {
    // If multiple URLs (semicolon separated), pick random one
    const wsUrls = wsUrl.split(';');
    wsUrl = wsUrls[Math.floor(Math.random() * wsUrls.length)];
  }
  response.websocket = { url: wsUrl };

  // Build MQTT credentials (always included)
  response.mqtt = await buildMqttCredentials(normalizedMac);

  // Build activation code for unregistered OR unbound devices
  // Unbound devices (user_id=null) need activation code so another user can bind them
  if (!device || !device.user_id) {
    const frontendUrl = await getSystemParam('server.frontend_url') || 'http://localhost:8001';

    // Check if we already have an activation code for this MAC
    let activationCode = activationMacCache.get(normalizedMac);

    if (!activationCode) {
      // Generate new 6-digit activation code
      activationCode = Math.floor(100000 + Math.random() * 900000).toString();

      // Store in cache
      const activationData = {
        macAddress: normalizedMac,
        board: board || 'unknown',
        appVersion: currentVersion,
        createdAt: Date.now()
      };

      activationCodeCache.set(activationCode, activationData);
      activationMacCache.set(normalizedMac, activationCode);

      logger.info(`Generated activation code ${activationCode} for device ${normalizedMac}`);
    }

    response.activation = {
      code: activationCode,
      message: `${frontendUrl}\n${activationCode}`,
      challenge: normalizedMac
    };
  }

  return response;
};

/**
 * Build MQTT credentials for device
 * @param {string} macAddress - Device MAC address
 * @returns {Object} MQTT configuration
 */
const buildMqttCredentials = async (macAddress) => {
  // Get MQTT configuration from system parameters
  let mqttBroker = await getSystemParam('mqtt.broker') || '192.168.1.236';
  let mqttPort = await getSystemParam('mqtt.port') || '1883';
  let mqttSignatureKey = await getSystemParam('mqtt.signature_key') || 'test-signature-key-12345';

  // Convert MAC address format (replace colons with underscores)
  const macFormatted = macAddress.replace(/:/g, '_');

  // Generate UUID for this session
  const { v4: uuidv4 } = require('uuid');
  const clientUuid = uuidv4();

  // Create client ID in format: GID_test@@@mac_address@@@uuid
  const groupId = 'GID_test';
  const clientId = `${groupId}@@@${macFormatted}@@@${clientUuid}`;

  // Generate username (base64 encoded JSON with IP)
  const clientIp = '127.0.0.1'; // In real scenario, get from request
  const username = Buffer.from(JSON.stringify({ ip: clientIp })).toString('base64');

  // Generate password (HMAC signature)
  const crypto = require('crypto');
  const content = `${clientId}${username}`;
  const password = crypto.createHmac('sha256', mqttSignatureKey).update(content).digest('base64');

  return {
    broker: mqttBroker,
    port: parseInt(mqttPort, 10),
    endpoint: `${mqttBroker}:${mqttPort}`,
    client_id: clientId,
    username: username,
    password: password,
    publish_topic: 'device-server',
    subscribe_topic: 'null'
  };
};

/**
 * Get system parameter value
 * @param {string} paramCode - Parameter code
 * @returns {Promise<string|null>} Parameter value or null
 */
const getSystemParam = async (paramCode) => {
  const row = await prisma.sys_params.findUnique({
    where: { param_code: paramCode },
    select: { param_value: true },
  });
  return row?.param_value ?? null;
};

/**
 * Get paginated list of firmware
 * @param {Object} options - Pagination and filter options
 * @returns {Promise<Object>} Paginated firmware list
 */
const listFirmware = async ({ page = 1, limit = 10, type } = {}) => {
  const where = type ? { type } : {};
  const [count, firmware] = await Promise.all([
    prisma.ai_ota.count({ where }),
    prisma.ai_ota.findMany({
      where,
      orderBy: { create_date: 'desc' },
      skip: (page - 1) * limit,
      take: limit,
    }),
  ]);
  return { list: firmware || [], total: count || 0, page, limit };
};

/**
 * Get firmware by ID
 * @param {string} id - Firmware ID
 * @returns {Promise<Object|null>} Firmware or null
 */
const getFirmwareById = async (id) => {
  return prisma.ai_ota.findUnique({ where: { id } });
};

/**
 * Create new firmware record
 * @param {Object} data - Firmware data
 * @returns {Promise<Object>} Created firmware
 */
const createFirmware = async ({ firmwareName, type, version, size, remark, firmwarePath, forceUpdate = 0 }) => {
  const existing = await prisma.ai_ota.findFirst({ where: { type, version }, select: { id: true } });
  if (existing) throw new Error('Firmware with this type and version already exists');

  if (forceUpdate === 1) {
    await prisma.ai_ota.updateMany({
      where: { type, force_update: 1 },
      data: { force_update: 0, update_date: new Date() },
    });
  }

  return prisma.ai_ota.create({
    data: { firmware_name: firmwareName, type, version, size, remark, firmware_path: firmwarePath, force_update: forceUpdate },
  });
};

/**
 * Update firmware record
 * @param {string} id - Firmware ID
 * @param {Object} data - Update data
 * @returns {Promise<Object>} Updated firmware
 */
const updateFirmware = async (id, { firmwareName, type, version, size, remark, firmwarePath, forceUpdate }) => {
  const current = await getFirmwareById(id);
  if (!current) throw new Error('Firmware not found');

  if (type && version && (type !== current.type || version !== current.version)) {
    const existing = await prisma.ai_ota.findFirst({
      where: { type, version, NOT: { id } },
      select: { id: true },
    });
    if (existing) throw new Error('Firmware with this type and version already exists');
  }

  if (forceUpdate === 1 && current.force_update !== 1) {
    const targetType = type || current.type;
    await prisma.ai_ota.updateMany({
      where: { type: targetType, force_update: 1, NOT: { id } },
      data: { force_update: 0, update_date: new Date() },
    });
  }

  const updateData = { update_date: new Date() };
  if (firmwareName !== undefined) updateData.firmware_name = firmwareName;
  if (type !== undefined) updateData.type = type;
  if (version !== undefined) updateData.version = version;
  if (size !== undefined) updateData.size = size;
  if (remark !== undefined) updateData.remark = remark;
  if (firmwarePath !== undefined) updateData.firmware_path = firmwarePath;
  if (forceUpdate !== undefined) updateData.force_update = forceUpdate;

  return prisma.ai_ota.update({ where: { id }, data: updateData });
};

/**
 * Delete firmware record(s)
 * @param {string|string[]} ids - Firmware ID(s) to delete
 */
const deleteFirmware = async (ids) => {
  const idArray = Array.isArray(ids) ? ids : [ids];
  await prisma.ai_ota.deleteMany({ where: { id: { in: idArray } } });
};

/**
 * Set force update flag on firmware
 * @param {string} id - Firmware ID
 * @param {number} forceUpdate - 0 or 1
 * @returns {Promise<Object>} Updated firmware
 */
const setForceUpdate = async (id, forceUpdate) => {
  const firmware = await getFirmwareById(id);
  if (!firmware) throw new Error('Firmware not found');

  if (forceUpdate === 1) {
    await prisma.ai_ota.updateMany({
      where: { type: firmware.type, force_update: 1, NOT: { id } },
      data: { force_update: 0, update_date: new Date() },
    });
  }

  return prisma.ai_ota.update({
    where: { id },
    data: { force_update: forceUpdate, update_date: new Date() },
  });
};

/**
 * Get all firmware without pagination
 * @param {string} type - Optional firmware type filter
 * @returns {Promise<Array>} List of all firmware
 */
const getAllFirmware = async (type) => {
  return prisma.ai_ota.findMany({
    where: type ? { type } : {},
    orderBy: { create_date: 'desc' },
  });
};

// =============================================
// Token Usage Tracking Methods
// =============================================

/**
 * Record token usage for a device
 * @param {Object} data - Token usage data
 * @returns {Promise<Object>} Created or updated usage record
 */
const recordTokenUsage = async ({
  mac, sessionId, inputTokens = 0, outputTokens = 0, inputAudioTokens = 0,
  inputTextTokens = 0, inputCachedTokens = 0, outputAudioTokens = 0,
  outputTextTokens = 0, sessionDurationSeconds = 0, avgTtftSeconds = 0,
  messageCount = 0, totalResponseDurationSeconds = 0
}) => {
  const normalizedMac = normalizeMacAddress(mac);
  if (!normalizedMac) throw new Error('Invalid MAC address format');

  const todayDate = new Date(new Date().toISOString().split('T')[0]);

  const existing = await prisma.device_token_usage.findFirst({
    where: { mac_address: normalizedMac, usage_date: todayDate },
  });

  if (existing) {
    const prevCount = Number(existing.message_count || 0);
    const newCount = prevCount + messageCount;
    const prevTtft = Number(existing.avg_ttft_seconds || 0);
    const newAvgTtft = newCount > 0
      ? ((prevTtft * prevCount) + (avgTtftSeconds * messageCount)) / newCount
      : avgTtftSeconds;

    return prisma.device_token_usage.update({
      where: { id: existing.id },
      data: {
        input_tokens: (existing.input_tokens || 0) + inputTokens,
        output_tokens: (existing.output_tokens || 0) + outputTokens,
        input_audio_tokens: (existing.input_audio_tokens || 0) + inputAudioTokens,
        input_text_tokens: (existing.input_text_tokens || 0) + inputTextTokens,
        input_cached_tokens: (existing.input_cached_tokens || 0) + inputCachedTokens,
        output_audio_tokens: (existing.output_audio_tokens || 0) + outputAudioTokens,
        output_text_tokens: (existing.output_text_tokens || 0) + outputTextTokens,
        session_duration_seconds: Number(existing.session_duration_seconds || 0) + sessionDurationSeconds,
        avg_ttft_seconds: newAvgTtft,
        message_count: newCount,
        total_response_duration_seconds: Number(existing.total_response_duration_seconds || 0) + totalResponseDurationSeconds,
        session_count: sessionId ? (existing.session_count || 0) + 1 : existing.session_count,
        update_date: new Date(),
      },
    });
  }

  return prisma.device_token_usage.create({
    data: {
      mac_address: normalizedMac,
      session_id: sessionId,
      usage_date: todayDate,
      input_tokens: inputTokens,
      output_tokens: outputTokens,
      input_audio_tokens: inputAudioTokens,
      input_text_tokens: inputTextTokens,
      input_cached_tokens: inputCachedTokens,
      output_audio_tokens: outputAudioTokens,
      output_text_tokens: outputTextTokens,
      session_duration_seconds: sessionDurationSeconds,
      avg_ttft_seconds: avgTtftSeconds,
      message_count: messageCount,
      total_response_duration_seconds: totalResponseDurationSeconds,
      session_count: 1,
    },
  });
};

/**
 * Get token usage statistics for a device
 * @param {string} mac - Device MAC address
 * @param {Object} options - Query options
 * @returns {Promise<Object>} Token usage statistics
 */
const getTokenUsageStats = async (mac, { startDate, endDate, period = 'daily' } = {}) => {
  const normalizedMac = normalizeMacAddress(mac);
  if (!normalizedMac) throw new Error('Invalid MAC address format');

  const where = { mac_address: normalizedMac };
  if (startDate || endDate) {
    where.usage_date = {};
    if (startDate) where.usage_date.gte = new Date(startDate);
    if (endDate) where.usage_date.lte = new Date(endDate);
  }

  const records = await prisma.device_token_usage.findMany({
    where,
    orderBy: { usage_date: 'desc' },
  });

  // Aggregate statistics
  const totals = {
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
    inputAudioTokens: 0,
    inputTextTokens: 0,
    inputCachedTokens: 0,
    outputAudioTokens: 0,
    outputTextTokens: 0,
    sessionDurationSeconds: 0,
    avgTtftSeconds: 0,
    messageCount: 0,
    totalResponseDurationSeconds: 0,
    sessionCount: 0,
    dayCount: records?.length || 0
  };

  if (records && records.length > 0) {
    let weightedTtftSum = 0;

    for (const record of records) {
      totals.inputTokens += record.input_tokens || 0;
      totals.outputTokens += record.output_tokens || 0;
      totals.totalTokens += record.total_tokens || 0;
      totals.inputAudioTokens += record.input_audio_tokens || 0;
      totals.inputTextTokens += record.input_text_tokens || 0;
      totals.inputCachedTokens += record.input_cached_tokens || 0;
      totals.outputAudioTokens += record.output_audio_tokens || 0;
      totals.outputTextTokens += record.output_text_tokens || 0;
      totals.sessionDurationSeconds += record.session_duration_seconds || 0;
      totals.messageCount += record.message_count || 0;
      totals.totalResponseDurationSeconds += record.total_response_duration_seconds || 0;
      totals.sessionCount += record.session_count || 0;
      weightedTtftSum += (record.avg_ttft_seconds || 0) * (record.message_count || 0);
    }

    // Calculate weighted average TTFT
    if (totals.messageCount > 0) {
      totals.avgTtftSeconds = weightedTtftSum / totals.messageCount;
    }
  }

  return {
    mac: normalizedMac,
    period,
    startDate: startDate || null,
    endDate: endDate || null,
    totals,
    daily: records || []
  };
};

/**
 * Get token usage for a specific date range (paginated)
 * @param {string} mac - Device MAC address
 * @param {Object} options - Pagination and filter options
 * @returns {Promise<Object>} Paginated token usage list
 */
const listTokenUsage = async (mac, { page = 1, limit = 30, startDate, endDate } = {}) => {
  const normalizedMac = normalizeMacAddress(mac);
  if (!normalizedMac) throw new Error('Invalid MAC address format');

  const where = { mac_address: normalizedMac };
  if (startDate || endDate) {
    where.usage_date = {};
    if (startDate) where.usage_date.gte = new Date(startDate);
    if (endDate) where.usage_date.lte = new Date(endDate);
  }

  const [count, records] = await Promise.all([
    prisma.device_token_usage.count({ where }),
    prisma.device_token_usage.findMany({
      where,
      orderBy: { usage_date: 'desc' },
      skip: (page - 1) * limit,
      take: limit,
    }),
  ]);

  return { list: records, total: count, page, limit };
};

/**
 * Get token usage summary for all devices (admin)
 * @param {Object} options - Query options
 * @returns {Promise<Object>} Summary by device
 */
const getTokenUsageSummary = async ({ startDate, endDate, page = 1, limit = 20 } = {}) => {
  const where = {};
  if (startDate || endDate) {
    where.usage_date = {};
    if (startDate) where.usage_date.gte = new Date(startDate);
    if (endDate) where.usage_date.lte = new Date(endDate);
  }

  const records = await prisma.device_token_usage.findMany({ where });

  const byDevice = {};
  for (const record of records) {
    const mac = record.mac_address;
    if (!byDevice[mac]) {
      byDevice[mac] = { mac, inputTokens: 0, outputTokens: 0, totalTokens: 0, sessionCount: 0, messageCount: 0, sessionDurationSeconds: 0, dayCount: 0 };
    }
    byDevice[mac].inputTokens += record.input_tokens || 0;
    byDevice[mac].outputTokens += record.output_tokens || 0;
    byDevice[mac].totalTokens += record.total_tokens || 0;
    byDevice[mac].sessionCount += record.session_count || 0;
    byDevice[mac].messageCount += record.message_count || 0;
    byDevice[mac].sessionDurationSeconds += Number(record.session_duration_seconds || 0);
    byDevice[mac].dayCount += 1;
  }

  const devices = Object.values(byDevice).sort((a, b) => b.totalTokens - a.totalTokens);
  const total = devices.length;
  const offset = (page - 1) * limit;

  return { list: devices.slice(offset, offset + limit), total, page, limit, startDate: startDate || null, endDate: endDate || null };
};

/**
 * Get token usage for a specific session
 * @param {string} mac - Device MAC address
 * @param {string} sessionId - Session identifier
 * @returns {Promise<Object|null>} Session usage data or null
 */
const getSessionTokenUsage = async (mac, sessionId) => {
  const normalizedMac = normalizeMacAddress(mac);
  if (!normalizedMac) throw new Error('Invalid MAC address format');

  const record = await prisma.device_token_usage.findFirst({
    where: { mac_address: normalizedMac, session_id: sessionId },
  });

  if (!record) return null;

  return {
    macAddress: record.mac_address,
    sessionId: record.session_id,
    usageDate: record.usage_date,
    inputTokens: record.input_tokens,
    outputTokens: record.output_tokens,
    totalTokens: record.total_tokens,
    inputAudioTokens: record.input_audio_tokens,
    inputTextTokens: record.input_text_tokens,
    inputCachedTokens: record.input_cached_tokens,
    outputAudioTokens: record.output_audio_tokens,
    outputTextTokens: record.output_text_tokens,
    sessionDurationSeconds: record.session_duration_seconds,
    avgTtftSeconds: record.avg_ttft_seconds,
    messageCount: record.message_count,
    totalResponseDurationSeconds: record.total_response_duration_seconds,
    createdAt: record.created_at,
    updatedAt: record.updated_at
  };
};

// Gemini 2.5 Flash Native Audio pricing in INR per token (USD × ₹91.99)
// USD rates: Text In=$0.50, Audio In=$3.00, Text Out=$2.00, Audio Out=$12.00
const TEXT_INPUT_RATE_INR = 46.00 / 1000000;     // ₹46.00/1M ($0.50 × 91.99)
const AUDIO_INPUT_RATE_INR = 276.00 / 1000000;   // ₹276.00/1M ($3.00 × 91.99)
const TEXT_OUTPUT_RATE_INR = 184.00 / 1000000;   // ₹184.00/1M ($2.00 × 91.99)
const AUDIO_OUTPUT_RATE_INR = 1104.00 / 1000000; // ₹1104.00/1M ($12.00 × 91.99)

/**
 * Calculate cost in INR based on token usage
 * @param {number} inputTextTokens
 * @param {number} inputAudioTokens
 * @param {number} outputTextTokens
 * @param {number} outputAudioTokens
 * @returns {number} Cost in INR rounded to 2 decimals
 */
const calculateCostInINR = (inputTextTokens, inputAudioTokens, outputTextTokens, outputAudioTokens) => {
  const cost = (inputTextTokens * TEXT_INPUT_RATE_INR) +
               (inputAudioTokens * AUDIO_INPUT_RATE_INR) +
               (outputTextTokens * TEXT_OUTPUT_RATE_INR) +
               (outputAudioTokens * AUDIO_OUTPUT_RATE_INR);
  return Math.round(cost * 100) / 100;
};

/**
 * Get daily usage summary across all devices
 * Returns snake_case format to match Spring Boot
 * @param {Object} options - Query options
 * @returns {Promise<Object>} Daily summary
 */
const getDailyUsageSummary = async ({ startDate, endDate } = {}) => {
  if (!startDate) {
    const date = new Date();
    date.setDate(date.getDate() - 30);
    startDate = date.toISOString().split('T')[0];
  }
  if (!endDate) {
    endDate = new Date().toISOString().split('T')[0];
  }

  const records = await prisma.device_token_usage.findMany({
    where: { usage_date: { gte: new Date(startDate), lte: new Date(endDate) } },
  });

  const byDate = {};
  for (const record of records) {
    const date = record.usage_date.toISOString().split('T')[0];
    if (!byDate[date]) {
      byDate[date] = {
        usage_date: date,
        input_tokens: 0,
        output_tokens: 0,
        total_tokens: 0,
        input_text_tokens: 0,
        input_audio_tokens: 0,
        output_text_tokens: 0,
        output_audio_tokens: 0,
        deviceSet: new Set(),
        session_count: 0,
        message_count: 0,
        session_duration_seconds: 0,
        weightedTtftSum: 0
      };
    }
    byDate[date].input_tokens += record.input_tokens || 0;
    byDate[date].output_tokens += record.output_tokens || 0;
    byDate[date].total_tokens += record.total_tokens || 0;
    byDate[date].input_text_tokens += record.input_text_tokens || 0;
    byDate[date].input_audio_tokens += record.input_audio_tokens || 0;
    byDate[date].output_text_tokens += record.output_text_tokens || 0;
    byDate[date].output_audio_tokens += record.output_audio_tokens || 0;
    byDate[date].deviceSet.add(record.mac_address);
    byDate[date].session_count += record.session_count || 0;
    byDate[date].message_count += record.message_count || 0;
    byDate[date].session_duration_seconds += record.session_duration_seconds || 0;
    // Track weighted TTFT sum for average calculation
    byDate[date].weightedTtftSum += (record.avg_ttft_seconds || 0) * (record.message_count || 0);
  }

  // Convert device sets to counts, add calculated fields, and sort by date descending
  const dailyData = Object.values(byDate)
    .map(day => {
      const { deviceSet, weightedTtftSum, ...rest } = day;
      const deviceCount = deviceSet.size;
      const avgDuration = day.session_count > 0
        ? day.session_duration_seconds / day.session_count
        : 0;
      const avgTtft = day.message_count > 0
        ? weightedTtftSum / day.message_count
        : 0;
      return {
        ...rest,
        device_count: deviceCount,
        // Frontend-expected aliases
        unique_devices: deviceCount,
        total_sessions: day.session_count,
        avg_duration_seconds: avgDuration,
        avg_ttft_seconds: avgTtft,
        cost_inr: calculateCostInINR(
          day.input_text_tokens,
          day.input_audio_tokens,
          day.output_text_tokens,
          day.output_audio_tokens
        )
      };
    })
    .sort((a, b) => b.usage_date.localeCompare(a.usage_date));

  return {
    list: dailyData
  };
};

/**
 * Get per-device daily usage
 * Returns snake_case format to match Spring Boot
 * @param {Object} options - Query options
 * @returns {Promise<Object>} Per-device daily usage
 */
const getPerDeviceDailyUsage = async ({ startDate, endDate } = {}) => {
  if (!startDate) {
    const date = new Date();
    date.setDate(date.getDate() - 30);
    startDate = date.toISOString().split('T')[0];
  }
  if (!endDate) {
    endDate = new Date().toISOString().split('T')[0];
  }

  const records = await prisma.device_token_usage.findMany({
    where: { usage_date: { gte: new Date(startDate), lte: new Date(endDate) } },
  });

  const macAddresses = [...new Set(records.map(r => r.mac_address))];
  let deviceMap = {};

  if (macAddresses.length > 0) {
    const devices = await prisma.ai_device.findMany({
      where: { mac_address: { in: macAddresses } },
      select: { mac_address: true, alias: true, kid_id: true, user_id: true },
    });

    const kidIds = devices.filter(d => d.kid_id).map(d => d.kid_id);
    const userIds = devices.filter(d => d.user_id).map(d => d.user_id);

    let kidMap = {};
    if (kidIds.length > 0) {
      const kids = await prisma.kid_profile.findMany({
        where: { id: { in: kidIds } },
        select: { id: true, name: true, nickname: true },
      });
      for (const kid of kids) {
        kidMap[kid.id.toString()] = kid.nickname || kid.name;
      }
    }

    let parentMap = {};
    if (userIds.length > 0) {
      const parents = await prisma.parent_profile.findMany({
        where: { user_id: { in: userIds } },
        select: { user_id: true, display_name: true },
      });
      for (const parent of parents) {
        if (parent.display_name) parentMap[parent.user_id.toString()] = parent.display_name;
      }

      const usersWithoutProfile = userIds.filter(id => !parentMap[id.toString()]);
      if (usersWithoutProfile.length > 0) {
        const users = await prisma.sys_user.findMany({
          where: { id: { in: usersWithoutProfile } },
          select: { id: true, nickname: true, username: true },
        });
        for (const user of users) {
          if (!parentMap[user.id.toString()]) {
            parentMap[user.id.toString()] = user.nickname || user.username;
          }
        }
      }
    }

    for (const device of devices) {
      const kidName = device.kid_id && kidMap[device.kid_id.toString()] ? kidMap[device.kid_id.toString()] : null;
      const parentName = device.user_id && parentMap[device.user_id.toString()] ? parentMap[device.user_id.toString()] : null;
      deviceMap[device.mac_address] = { kid_name: kidName, owner_name: parentName || device.alias || null };
    }
  }

  const usage = records.map(record => {
    const deviceInfo = deviceMap[record.mac_address] || {};
    const usageDateStr = record.usage_date instanceof Date
      ? record.usage_date.toISOString().split('T')[0]
      : record.usage_date;
    return {
      mac_address: record.mac_address,
      usage_date: usageDateStr,
      input_tokens: record.input_tokens || 0,
      output_tokens: record.output_tokens || 0,
      total_tokens: record.total_tokens || 0,
      input_text_tokens: record.input_text_tokens || 0,
      input_audio_tokens: record.input_audio_tokens || 0,
      output_text_tokens: record.output_text_tokens || 0,
      output_audio_tokens: record.output_audio_tokens || 0,
      session_count: record.session_count || 0,
      message_count: record.message_count || 0,
      session_duration_seconds: Number(record.session_duration_seconds || 0),
      total_duration_seconds: Number(record.session_duration_seconds || 0),
      avg_ttft_seconds: Number(record.avg_ttft_seconds || 0),
      kid_name: deviceInfo.kid_name || null,
      owner_name: deviceInfo.owner_name || null,
      cost_inr: calculateCostInINR(record.input_text_tokens || 0, record.input_audio_tokens || 0, record.output_text_tokens || 0, record.output_audio_tokens || 0)
    };
  });

  usage.sort((a, b) => b.usage_date.localeCompare(a.usage_date));
  return { list: usage };
};

/**
 * Get overall usage totals across all devices
 * @param {Object} options - Query options
 * @returns {Promise<Object>} Usage totals
 */
const getUsageTotals = async ({ startDate, endDate } = {}) => {
  const where = {};
  if (startDate || endDate) {
    where.usage_date = {};
    if (startDate) where.usage_date.gte = new Date(startDate);
    if (endDate) where.usage_date.lte = new Date(endDate);
  }

  const records = await prisma.device_token_usage.findMany({ where });

  const totals = {
    inputTokens: 0, outputTokens: 0, totalTokens: 0, inputAudioTokens: 0,
    inputTextTokens: 0, inputCachedTokens: 0, outputAudioTokens: 0, outputTextTokens: 0,
    sessionDurationSeconds: 0, avgTtftSeconds: 0, messageCount: 0,
    totalResponseDurationSeconds: 0, sessionCount: 0, deviceCount: 0, dayCount: 0
  };

  const devicesSet = new Set();
  const daysSet = new Set();
  let weightedTtftSum = 0;

  for (const record of records) {
    totals.inputTokens += record.input_tokens || 0;
    totals.outputTokens += record.output_tokens || 0;
    totals.totalTokens += record.total_tokens || 0;
    totals.inputAudioTokens += record.input_audio_tokens || 0;
    totals.inputTextTokens += record.input_text_tokens || 0;
    totals.inputCachedTokens += record.input_cached_tokens || 0;
    totals.outputAudioTokens += record.output_audio_tokens || 0;
    totals.outputTextTokens += record.output_text_tokens || 0;
    totals.sessionDurationSeconds += Number(record.session_duration_seconds || 0);
    totals.messageCount += record.message_count || 0;
    totals.totalResponseDurationSeconds += Number(record.total_response_duration_seconds || 0);
    totals.sessionCount += record.session_count || 0;
    weightedTtftSum += Number(record.avg_ttft_seconds || 0) * (record.message_count || 0);
    devicesSet.add(record.mac_address);
    daysSet.add(record.usage_date?.toISOString?.() || record.usage_date);
  }

  if (totals.messageCount > 0) totals.avgTtftSeconds = weightedTtftSum / totals.messageCount;
  totals.deviceCount = devicesSet.size;
  totals.dayCount = daysSet.size;

  return { period: { startDate: startDate || null, endDate: endDate || null }, totals };
};

/**
 * Delete token usage records for a device
 * @param {string} mac - Device MAC address
 * @param {Object} options - Delete options
 * @returns {Promise<number>} Number of deleted records
 */
const deleteTokenUsage = async (mac, { startDate, endDate, olderThan } = {}) => {
  const normalizedMac = normalizeMacAddress(mac);
  if (!normalizedMac) throw new Error('Invalid MAC address format');

  const where = { mac_address: normalizedMac };
  if (startDate || endDate || olderThan) {
    where.usage_date = {};
    if (startDate) where.usage_date.gte = new Date(startDate);
    if (endDate) where.usage_date.lte = new Date(endDate);
    if (olderThan) where.usage_date.lt = new Date(olderThan);
  }

  const { count } = await prisma.device_token_usage.deleteMany({ where });
  return count || 0;
};

module.exports = {
  registerDevice,
  bindDevice,
  getDevicesByAgent,
  unbindDevice,
  updateDevice,
  assignKidToDevice,
  assignKidByMac,
  cycleMode,
  getMode,
  getDeviceByMac,
  getDeviceById,
  listDevices,
  manualAddDevice,
  // OTA methods
  getLatestFirmware,
  getForceUpdateFirmware,
  checkOtaVersion,
  listFirmware,
  getAllFirmware,
  getFirmwareById,
  createFirmware,
  updateFirmware,
  deleteFirmware,
  setForceUpdate,
  // Token usage methods
  recordTokenUsage,
  getTokenUsageStats,
  listTokenUsage,
  getTokenUsageSummary,
  deleteTokenUsage,
  // Token usage analytics methods
  getSessionTokenUsage,
  getDailyUsageSummary,
  getPerDeviceDailyUsage,
  getUsageTotals
};
