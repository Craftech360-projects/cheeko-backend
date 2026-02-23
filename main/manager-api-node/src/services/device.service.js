/**
 * Device Service
 *
 * Handles ESP32 device management, registration, binding, and mode control.
 */

const { supabaseAdmin } = require('../config/database');
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
 * Register a new device
 * @param {Object} data - Device data
 * @returns {Promise<Object>} Created device
 */
const registerDevice = async ({ mac, board, appVersion }) => {
  if (!supabaseAdmin) throw new Error('Database not configured');

  const normalizedMac = normalizeMacAddress(mac);
  if (!normalizedMac) throw new Error('Invalid MAC address format');

  // Check if device already exists
  const { data: existing } = await supabaseAdmin
    .from('ai_device')
    .select('id, mac_address')
    .eq('mac_address', normalizedMac)
    .single();

  if (existing) {
    // Update existing device
    const { data: device, error } = await supabaseAdmin
      .from('ai_device')
      .update({
        board,
        app_version: appVersion,
        last_connected_at: new Date().toISOString(),
        update_date: new Date().toISOString()
      })
      .eq('id', existing.id)
      .select()
      .single();

    if (error) throw new Error('Failed to update device');
    return device;
  }

  // Create new device
  const { data: device, error } = await supabaseAdmin
    .from('ai_device')
    .insert({
      mac_address: normalizedMac,
      board,
      app_version: appVersion,
      mode: 'conversation',
      device_mode: 'manual',
      last_connected_at: new Date().toISOString()
    })
    .select()
    .single();

  if (error) {
    logger.error('Failed to create device:', error);
    throw new Error('Failed to register device');
  }

  return device;
};

/**
 * Bind device to user and agent
 * @param {number} userId - User ID
 * @param {string} agentId - Agent ID
 * @param {string} deviceCode - 6-digit device code or MAC address
 * @returns {Promise<Object>} Bound device
 */
const bindDevice = async (userId, agentId, deviceCode, isSuperAdmin = false) => {
  if (!supabaseAdmin) throw new Error('Database not configured');

  let device = null;
  let macAddress = null;
  let activationData = null;

  // Check if it's a MAC address or an activation code
  if (deviceCode.includes(':') || deviceCode.length === 12) {
    // It's a MAC address - find existing device
    macAddress = normalizeMacAddress(deviceCode);
    const { data: existingDevice, error: findError } = await supabaseAdmin
      .from('ai_device')
      .select('*')
      .eq('mac_address', macAddress)
      .single();

    if (findError || !existingDevice) {
      throw new Error('Device not found. Please use the 6-digit activation code.');
    }
    device = existingDevice;
  } else if (/^\d{6}$/.test(deviceCode)) {
    // It's a 6-digit activation code
    activationData = activationCodeCache.get(deviceCode);

    if (activationData) {
      macAddress = activationData.macAddress;
      logger.info(`[BIND] Activation code ${deviceCode} found in memory cache for MAC ${macAddress}`);
    } else {
      logger.warn(`[BIND] Activation code ${deviceCode} NOT in memory cache. Cache has ${activationCodeCache.size} codes: [${[...activationCodeCache.keys()].join(', ')}]`);
      // Fallback: look up activation code in DB (survives server restarts)
      let dbDevice = null;
      try {
        const { data } = await supabaseAdmin
          .from('ai_device')
          .select('*')
          .eq('activation_code', deviceCode)
          .single();
        dbDevice = data;
      } catch (dbErr) {
        logger.warn(`[BIND] DB activation code lookup failed: ${dbErr.message}`);
      }

      if (!dbDevice) {
        logger.error(`[BIND] Activation code ${deviceCode} not found in memory or DB. Bind failed.`);
        throw new Error('Invalid or expired activation code');
      }

      macAddress = dbDevice.mac_address;
      device = dbDevice;
      logger.info(`[BIND] Found activation code ${deviceCode} in DB for device ${macAddress}`);
    }

    // Check if device already exists (when found via in-memory cache)
    if (!device) {
      const { data: existingDevice } = await supabaseAdmin
        .from('ai_device')
        .select('*')
        .eq('mac_address', macAddress)
        .single();

      if (existingDevice) {
        if (existingDevice.user_id && existingDevice.user_id !== userId) {
          throw new Error('Device is already bound to another user');
        }
        device = existingDevice;
      }
    } else if (device.user_id && device.user_id !== userId) {
      throw new Error('Device is already bound to another user');
    }
  } else {
    throw new Error('Invalid device code format. Use 6-digit activation code or MAC address.');
  }

  // Verify agent exists
  const { data: agent } = await supabaseAdmin
    .from('ai_agent')
    .select('id, user_id')
    .eq('id', agentId)
    .single();

  let bindUserId = userId;

  if (!agent) {
    // Agent doesn't exist at all - create a default one for the user
    const { data: newAgent, error: createAgentErr } = await supabaseAdmin
      .from('ai_agent')
      .insert({
        id: agentId,
        user_id: userId,
        agent_code: 'Cheeko',
        agent_name: 'Cheeko',
        system_prompt: 'You are CHEEKO, a fun, witty, and slightly mischievous AI friend for kids.',
        lang_code: 'en',
        language: 'English',
        status: 1,
        creator: userId
      })
      .select('id, user_id')
      .single();

    if (createAgentErr) {
      throw new Error('Agent not found and failed to create: ' + createAgentErr.message);
    }

    logger.info(`Auto-created agent ${agentId} for user ${userId}`);
    bindUserId = userId;
  } else if (agent.user_id !== userId && !isSuperAdmin) {
    throw new Error('Agent does not belong to user');
  } else if (isSuperAdmin) {
    // Super admin binds using agent owner's ID
    bindUserId = agent.user_id;
  }

  // Fetch agent owner's OpenClaw URL from parent_profile to copy into device
  let openclawUrl = null;
  let openclawToken = null;
  const { data: parentProfile } = await supabaseAdmin
    .from('parent_profile')
    .select('openclaw_url, openclaw_token')
    .eq('user_id', bindUserId)
    .single();
  if (parentProfile) {
    openclawUrl = parentProfile.openclaw_url || null;
    openclawToken = parentProfile.openclaw_token || null;
  }

  if (device) {
    // Update existing device
    if (device.user_id && device.user_id !== bindUserId && !isSuperAdmin) {
      throw new Error('Device is already bound to another user');
    }

    const { data: updated, error: updateError } = await supabaseAdmin
      .from('ai_device')
      .update({
        user_id: bindUserId,
        agent_id: agentId,
        activation_code: null,
        openclaw_url: openclawUrl,
        openclaw_token: openclawToken,
        update_date: new Date().toISOString()
      })
      .eq('id', device.id)
      .select()
      .single();

    if (updateError) throw new Error('Failed to bind device');

    // Clean up activation code cache
    activationCodeCache.delete(deviceCode);
    activationMacCache.delete(macAddress);
    logger.info(`Device ${macAddress} activated and bound to agent ${agentId}`);

    return updated;
  } else {
    // Create new device from activation data
    const now = new Date().toISOString();
    const { data: newDevice, error: createError } = await supabaseAdmin
      .from('ai_device')
      .insert({
        mac_address: macAddress,
        user_id: bindUserId,
        agent_id: agentId,
        board: activationData.board,
        app_version: activationData.appVersion,
        auto_update: 1,
        mode: 'conversation',
        device_mode: 'manual',
        openclaw_url: openclawUrl,
        openclaw_token: openclawToken,
        create_date: now,
        update_date: now,
        last_connected_at: now,
        creator: bindUserId,
        updater: bindUserId
      })
      .select()
      .single();

    if (createError) throw new Error('Failed to create device: ' + createError.message);

    // Clean up activation code cache
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
  if (!supabaseAdmin) throw new Error('Database not configured');

  let query = supabaseAdmin
    .from('ai_device')
    .select('*')
    .eq('agent_id', agentId);

  // Super admin can see all devices for any agent
  // Regular users can only see their own devices
  if (!isSuperAdmin) {
    query = query.eq('user_id', userId);
  }

  const { data: devices, error } = await query.order('create_date', { ascending: false });

  if (error) {
    logger.error('Failed to fetch devices:', error);
    throw new Error('Failed to fetch devices: ' + error.message);
  }

  return devices || [];
};

/**
 * Unbind device from user
 * @param {number} userId - User ID
 * @param {string} deviceId - Device ID
 */
const unbindDevice = async (userId, deviceId, isSuperAdmin = false) => {
  if (!supabaseAdmin) throw new Error('Database not configured');

  const { data: device } = await supabaseAdmin
    .from('ai_device')
    .select('id, user_id')
    .eq('id', deviceId)
    .single();

  if (!device) throw new Error('Device not found');

  // Check ownership if not super admin
  if (!isSuperAdmin && device.user_id !== userId) {
    throw new Error("You don't have permission to unbind this device");
  }

  const { error } = await supabaseAdmin
    .from('ai_device')
    .update({
      user_id: null,
      agent_id: null,
      kid_id: null,
      update_date: new Date().toISOString()
    })
    .eq('id', deviceId);

  if (error) throw new Error('Failed to unbind device');
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
  if (!supabaseAdmin) throw new Error('Database not configured');

  const { data: device } = await supabaseAdmin
    .from('ai_device')
    .select('id, user_id')
    .eq('id', deviceId)
    .single();

  if (!device) throw new Error('Device not found');
  // Super admin can update any device, regular users can only update their own
  if (!isSuperAdmin && device.user_id && device.user_id !== userId) {
    throw new Error('Device does not belong to user');
  }

  const updateData = {
    update_date: new Date().toISOString()
  };

  if (data.alias !== undefined) updateData.alias = data.alias;
  if (data.autoUpdate !== undefined) updateData.auto_update = data.autoUpdate ? 1 : 0;
  if (data.agentId !== undefined) updateData.agent_id = data.agentId;
  if (data.deviceMode !== undefined) updateData.device_mode = data.deviceMode;
  if (data.mode !== undefined) updateData.mode = data.mode;
  if (data.openclaw_url !== undefined) updateData.openclaw_url = data.openclaw_url;
  if (data.openclaw_token !== undefined) updateData.openclaw_token = data.openclaw_token;

  const { data: updated, error } = await supabaseAdmin
    .from('ai_device')
    .update(updateData)
    .eq('id', deviceId)
    .select()
    .single();

  if (error) throw new Error('Failed to update device');

  return updated;
};

/**
 * Assign kid profile to device
 * @param {number} userId - User ID
 * @param {string} deviceId - Device ID
 * @param {number} kidId - Kid profile ID
 * @returns {Promise<Object>} Updated device
 */
const assignKidToDevice = async (userId, deviceId, kidId) => {
  if (!supabaseAdmin) throw new Error('Database not configured');

  // Verify device belongs to user
  const { data: device } = await supabaseAdmin
    .from('ai_device')
    .select('id, user_id')
    .eq('id', deviceId)
    .single();

  if (!device) throw new Error('Device not found');
  if (device.user_id !== userId) throw new Error('Device does not belong to user');

  // Verify kid profile belongs to user
  if (kidId) {
    const { data: kid } = await supabaseAdmin
      .from('kid_profile')
      .select('id')
      .eq('id', kidId)
      .eq('user_id', userId)
      .single();

    if (!kid) throw new Error('Kid profile not found');
  }

  const { data: updated, error } = await supabaseAdmin
    .from('ai_device')
    .update({
      kid_id: kidId,
      update_date: new Date().toISOString()
    })
    .eq('id', deviceId)
    .select()
    .single();

  if (error) throw new Error('Failed to assign kid to device');

  return updated;
};

/**
 * Assign kid to device by MAC address
 * @param {string} mac - Device MAC address
 * @param {number} kidId - Kid profile ID
 * @returns {Promise<Object>} Updated device
 */
const assignKidByMac = async (mac, kidId) => {
  if (!supabaseAdmin) throw new Error('Database not configured');

  const normalizedMac = normalizeMacAddress(mac);

  const { data: updated, error } = await supabaseAdmin
    .from('ai_device')
    .update({
      kid_id: kidId,
      update_date: new Date().toISOString()
    })
    .eq('mac_address', normalizedMac)
    .select()
    .single();

  if (error) throw new Error('Failed to assign kid to device');

  return updated;
};

/**
 * Cycle device mode (conversation -> music -> story -> conversation)
 * @param {string} mac - Device MAC address
 * @returns {Promise<Object>} New mode
 */
const cycleMode = async (mac) => {
  if (!supabaseAdmin) throw new Error('Database not configured');

  const normalizedMac = normalizeMacAddress(mac);

  const { data: device } = await supabaseAdmin
    .from('ai_device')
    .select('id, mode')
    .eq('mac_address', normalizedMac)
    .single();

  if (!device) throw new Error('Device not found');

  const modes = ['conversation', 'music', 'story'];
  const currentIndex = modes.indexOf(device.mode || 'conversation');
  const nextMode = modes[(currentIndex + 1) % modes.length];

  const { data: updated, error } = await supabaseAdmin
    .from('ai_device')
    .update({
      mode: nextMode,
      update_date: new Date().toISOString()
    })
    .eq('id', device.id)
    .select('mode')
    .single();

  if (error) throw new Error('Failed to cycle mode');

  return { mode: updated.mode, previousMode: device.mode };
};

/**
 * Get device mode
 * @param {string} mac - Device MAC address
 * @returns {Promise<Object>} Device mode
 */
const getMode = async (mac) => {
  if (!supabaseAdmin) throw new Error('Database not configured');

  const normalizedMac = normalizeMacAddress(mac);

  const { data: device, error } = await supabaseAdmin
    .from('ai_device')
    .select('mode, device_mode')
    .eq('mac_address', normalizedMac)
    .single();

  if (error || !device) throw new Error('Device not found');

  return {
    mode: device.mode || 'conversation',
    deviceMode: device.device_mode || 'auto'
  };
};

/**
 * Get device by MAC address
 * @param {string} mac - Device MAC address
 * @returns {Promise<Object>} Device
 */
const getDeviceByMac = async (mac) => {
  if (!supabaseAdmin) throw new Error('Database not configured');

  const normalizedMac = normalizeMacAddress(mac);

  const { data: device, error } = await supabaseAdmin
    .from('ai_device')
    .select('*')
    .eq('mac_address', normalizedMac)
    .single();

  if (error || !device) return null;

  return device;
};

/**
 * Get device by ID
 * @param {string} deviceId - Device ID
 * @returns {Promise<Object>} Device
 */
const getDeviceById = async (deviceId) => {
  if (!supabaseAdmin) throw new Error('Database not configured');

  const { data: device, error } = await supabaseAdmin
    .from('ai_device')
    .select('*')
    .eq('id', deviceId)
    .single();

  if (error || !device) return null;

  return device;
};

/**
 * List all devices for a user
 * @param {number} userId - User ID
 * @param {Object} options - Pagination options
 * @returns {Promise<Object>} Paginated devices
 */
const listDevices = async (userId, { page = 1, limit = 10 } = {}) => {
  if (!supabaseAdmin) throw new Error('Database not configured');

  const offset = (page - 1) * limit;

  // Get total count
  const { count } = await supabaseAdmin
    .from('ai_device')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId);

  // Get devices
  const { data: devices, error } = await supabaseAdmin
    .from('ai_device')
    .select('*')
    .eq('user_id', userId)
    .order('create_date', { ascending: false })
    .range(offset, offset + limit - 1);

  if (error) throw new Error('Failed to fetch devices');

  return {
    list: devices || [],
    total: count || 0,
    page,
    limit
  };
};

/**
 * Manually add device (admin)
 * @param {number} userId - User ID
 * @param {Object} data - Device data
 * @returns {Promise<Object>} Created device
 */
const manualAddDevice = async (userId, { macAddress, mac, alias, agentId, board, appVersion }) => {
  if (!supabaseAdmin) throw new Error('Database not configured');

  // Support both 'mac' and 'macAddress' for compatibility
  const deviceMac = macAddress || mac;
  const normalizedMac = normalizeMacAddress(deviceMac);
  if (!normalizedMac) throw new Error('Invalid MAC address format');

  // Check if device exists
  const { data: existing } = await supabaseAdmin
    .from('ai_device')
    .select('id')
    .eq('mac_address', normalizedMac)
    .single();

  if (existing) throw new Error('Device already exists');

  const now = new Date().toISOString();
  const { data: device, error } = await supabaseAdmin
    .from('ai_device')
    .insert({
      mac_address: normalizedMac,
      user_id: userId,
      alias,
      agent_id: agentId,
      board,
      app_version: appVersion,
      mode: 'conversation',
      device_mode: 'manual',
      auto_update: 1,
      create_date: now,
      update_date: now,
      creator: userId,
      updater: userId
    })
    .select()
    .single();

  if (error) throw new Error('Failed to create device');

  return device;
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
  if (!supabaseAdmin) throw new Error('Database not configured');

  const { data: firmware, error } = await supabaseAdmin
    .from('ai_ota')
    .select('*')
    .eq('type', type)
    .order('create_date', { ascending: false })
    .limit(1)
    .single();

  if (error || !firmware) return null;

  return firmware;
};

/**
 * Get firmware that requires force update
 * @param {string} type - Firmware type
 * @returns {Promise<Object|null>} Force update firmware or null
 */
const getForceUpdateFirmware = async (type) => {
  if (!supabaseAdmin) throw new Error('Database not configured');

  const { data: firmware, error } = await supabaseAdmin
    .from('ai_ota')
    .select('*')
    .eq('type', type)
    .eq('force_update', 1)
    .order('create_date', { ascending: false })
    .limit(1)
    .single();

  if (error || !firmware) return null;

  return firmware;
};

/**
 * Check OTA version for a device
 * @param {string} mac - Device MAC address
 * @param {string} currentVersion - Device's current firmware version
 * @param {string} board - Device board type
 * @returns {Promise<Object>} OTA check response
 */
const checkOtaVersion = async (mac, clientId, deviceReport) => {
  if (!supabaseAdmin) throw new Error('Database not configured');

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

    // Include firmware if:
    // 1. Force update is enabled (regardless of version), OR
    // 2. There's a newer version available
    if (forceUpdateFirmware) {
      // Force update - always include, version doesn't matter
      const otaUrl = await getSystemParam('server.ota');
      response.firmware = {
        version: forceUpdateFirmware.version,
        url: `${otaUrl}/otaMag/download/${forceUpdateFirmware.id}`,
        force: 1
      };
    } else if (latestFirmware && latestFirmware.version !== currentVersion) {
      // New version available (no force)
      const otaUrl = await getSystemParam('server.ota');
      response.firmware = {
        version: latestFirmware.version,
        url: `${otaUrl}/otaMag/download/${latestFirmware.id}`,
        force: 0
      };
    }
  }

  // Update device last connection time if device exists
  if (device) {
    await supabaseAdmin
      .from('ai_device')
      .update({
        last_connected_at: new Date().toISOString(),
        app_version: currentVersion || device.app_version,
        board: board || device.board
      })
      .eq('id', device.id);
  }

  // Build WebSocket configuration
  // If device has openclaw_url configured, use that (OpenClaw mode)
  // Otherwise fall back to system-wide LiveKit WebSocket URL
  let wsUrl = '';
  if (device && device.openclaw_url) {
    wsUrl = device.openclaw_url;
  } else {
    wsUrl = await getSystemParam('server.websocket');
    if (!wsUrl || wsUrl === 'null') {
      wsUrl = 'ws://192.168.1.99:8000/cheeko/v1/';
    } else {
      // If multiple URLs (semicolon separated), pick random one
      const wsUrls = wsUrl.split(';');
      wsUrl = wsUrls[Math.floor(Math.random() * wsUrls.length)];
    }
  }
  response.websocket = { url: wsUrl };
  if (device && device.openclaw_token) {
    response.websocket.token = device.openclaw_token;
  }

  // Build MQTT credentials only if NOT using OpenClaw
  // OpenClaw replaces MQTT entirely - devices connect directly via WebSocket
  if (!(device && device.openclaw_url)) {
    response.mqtt = await buildMqttCredentials(normalizedMac);
  }

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

      // Persist activation code to DB so it survives server restarts
      const { error: saveErr } = await supabaseAdmin
        .from('ai_device')
        .update({ activation_code: activationCode })
        .eq('mac_address', normalizedMac);
      if (saveErr) logger.warn(`Could not persist activation code to DB: ${saveErr.message}`);

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
  if (!supabaseAdmin) return null;

  const { data, error } = await supabaseAdmin
    .from('sys_params')
    .select('param_value')
    .eq('param_code', paramCode)
    .single();

  if (error || !data) return null;
  return data.param_value;
};

/**
 * Get paginated list of firmware
 * @param {Object} options - Pagination and filter options
 * @returns {Promise<Object>} Paginated firmware list
 */
const listFirmware = async ({ page = 1, limit = 10, type } = {}) => {
  if (!supabaseAdmin) throw new Error('Database not configured');

  const offset = (page - 1) * limit;

  let query = supabaseAdmin.from('ai_ota').select('*', { count: 'exact' });

  if (type) {
    query = query.eq('type', type);
  }

  const { data: firmware, count, error } = await query
    .order('create_date', { ascending: false })
    .range(offset, offset + limit - 1);

  if (error) throw new Error('Failed to fetch firmware list');

  return {
    list: firmware || [],
    total: count || 0,
    page,
    limit
  };
};

/**
 * Get firmware by ID
 * @param {string} id - Firmware ID
 * @returns {Promise<Object|null>} Firmware or null
 */
const getFirmwareById = async (id) => {
  if (!supabaseAdmin) throw new Error('Database not configured');

  const { data: firmware, error } = await supabaseAdmin
    .from('ai_ota')
    .select('*')
    .eq('id', id)
    .single();

  if (error || !firmware) return null;

  return firmware;
};

/**
 * Create new firmware record
 * @param {Object} data - Firmware data
 * @returns {Promise<Object>} Created firmware
 */
const createFirmware = async ({ firmwareName, type, version, size, remark, firmwarePath, forceUpdate = 0 }) => {
  if (!supabaseAdmin) throw new Error('Database not configured');

  // Check for duplicate type+version
  const { data: existing } = await supabaseAdmin
    .from('ai_ota')
    .select('id')
    .eq('type', type)
    .eq('version', version)
    .single();

  if (existing) {
    throw new Error('Firmware with this type and version already exists');
  }

  // If force update is enabled, disable it on other firmware of the same type
  if (forceUpdate === 1) {
    await supabaseAdmin
      .from('ai_ota')
      .update({ force_update: 0, update_date: new Date().toISOString() })
      .eq('type', type)
      .eq('force_update', 1);
  }

  const { data: firmware, error } = await supabaseAdmin
    .from('ai_ota')
    .insert({
      firmware_name: firmwareName,
      type,
      version,
      size,
      remark,
      firmware_path: firmwarePath,
      force_update: forceUpdate
    })
    .select()
    .single();

  if (error) {
    logger.error('Failed to create firmware:', error);
    throw new Error('Failed to create firmware record');
  }

  return firmware;
};

/**
 * Update firmware record
 * @param {string} id - Firmware ID
 * @param {Object} data - Update data
 * @returns {Promise<Object>} Updated firmware
 */
const updateFirmware = async (id, { firmwareName, type, version, size, remark, firmwarePath, forceUpdate }) => {
  if (!supabaseAdmin) throw new Error('Database not configured');

  // Get current firmware
  const current = await getFirmwareById(id);
  if (!current) throw new Error('Firmware not found');

  // Check for duplicate type+version (if changing)
  if (type && version && (type !== current.type || version !== current.version)) {
    const { data: existing } = await supabaseAdmin
      .from('ai_ota')
      .select('id')
      .eq('type', type)
      .eq('version', version)
      .neq('id', id)
      .single();

    if (existing) {
      throw new Error('Firmware with this type and version already exists');
    }
  }

  // If enabling force update, disable it on other firmware of the same type
  if (forceUpdate === 1 && current.force_update !== 1) {
    const targetType = type || current.type;
    await supabaseAdmin
      .from('ai_ota')
      .update({ force_update: 0, update_date: new Date().toISOString() })
      .eq('type', targetType)
      .eq('force_update', 1)
      .neq('id', id);
  }

  const updateData = { update_date: new Date().toISOString() };
  if (firmwareName !== undefined) updateData.firmware_name = firmwareName;
  if (type !== undefined) updateData.type = type;
  if (version !== undefined) updateData.version = version;
  if (size !== undefined) updateData.size = size;
  if (remark !== undefined) updateData.remark = remark;
  if (firmwarePath !== undefined) updateData.firmware_path = firmwarePath;
  if (forceUpdate !== undefined) updateData.force_update = forceUpdate;

  const { data: firmware, error } = await supabaseAdmin
    .from('ai_ota')
    .update(updateData)
    .eq('id', id)
    .select()
    .single();

  if (error) throw new Error('Failed to update firmware');

  return firmware;
};

/**
 * Delete firmware record(s)
 * @param {string|string[]} ids - Firmware ID(s) to delete
 */
const deleteFirmware = async (ids) => {
  if (!supabaseAdmin) throw new Error('Database not configured');

  const idArray = Array.isArray(ids) ? ids : [ids];

  const { error } = await supabaseAdmin
    .from('ai_ota')
    .delete()
    .in('id', idArray);

  if (error) throw new Error('Failed to delete firmware');
};

/**
 * Set force update flag on firmware
 * @param {string} id - Firmware ID
 * @param {number} forceUpdate - 0 or 1
 * @returns {Promise<Object>} Updated firmware
 */
const setForceUpdate = async (id, forceUpdate) => {
  if (!supabaseAdmin) throw new Error('Database not configured');

  const firmware = await getFirmwareById(id);
  if (!firmware) throw new Error('Firmware not found');

  // If enabling force update, disable it on other firmware of the same type
  if (forceUpdate === 1) {
    await supabaseAdmin
      .from('ai_ota')
      .update({ force_update: 0, update_date: new Date().toISOString() })
      .eq('type', firmware.type)
      .eq('force_update', 1)
      .neq('id', id);
  }

  const { data: updated, error } = await supabaseAdmin
    .from('ai_ota')
    .update({ force_update: forceUpdate, update_date: new Date().toISOString() })
    .eq('id', id)
    .select()
    .single();

  if (error) throw new Error('Failed to set force update');

  return updated;
};

/**
 * Get all firmware without pagination
 * @param {string} type - Optional firmware type filter
 * @returns {Promise<Array>} List of all firmware
 */
const getAllFirmware = async (type) => {
  if (!supabaseAdmin) throw new Error('Database not configured');

  let query = supabaseAdmin.from('ai_ota').select('*');

  if (type) {
    query = query.eq('type', type);
  }

  const { data: firmware, error } = await query
    .order('create_date', { ascending: false });

  if (error) throw new Error('Failed to fetch firmware');

  return firmware || [];
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
  mac,
  sessionId,
  inputTokens = 0,
  outputTokens = 0,
  inputAudioTokens = 0,
  inputTextTokens = 0,
  inputCachedTokens = 0,
  outputAudioTokens = 0,
  outputTextTokens = 0,
  sessionDurationSeconds = 0,
  avgTtftSeconds = 0,
  messageCount = 0,
  totalResponseDurationSeconds = 0
}) => {
  if (!supabaseAdmin) throw new Error('Database not configured');

  const normalizedMac = normalizeMacAddress(mac);
  if (!normalizedMac) throw new Error('Invalid MAC address format');

  const today = new Date().toISOString().split('T')[0];

  // Check if we have an existing record for this mac + date
  // Note: unique constraint is on (mac_address, usage_date), so we aggregate all sessions per day
  const { data: existing } = await supabaseAdmin
    .from('device_token_usage')
    .select('*')
    .eq('mac_address', normalizedMac)
    .eq('usage_date', today)
    .single();

  if (existing) {
    // Update existing record - accumulate values
    const { data: updated, error } = await supabaseAdmin
      .from('device_token_usage')
      .update({
        input_tokens: existing.input_tokens + inputTokens,
        output_tokens: existing.output_tokens + outputTokens,
        input_audio_tokens: existing.input_audio_tokens + inputAudioTokens,
        input_text_tokens: existing.input_text_tokens + inputTextTokens,
        input_cached_tokens: existing.input_cached_tokens + inputCachedTokens,
        output_audio_tokens: existing.output_audio_tokens + outputAudioTokens,
        output_text_tokens: existing.output_text_tokens + outputTextTokens,
        session_duration_seconds: existing.session_duration_seconds + sessionDurationSeconds,
        // Calculate weighted average for TTFT
        avg_ttft_seconds: existing.message_count + messageCount > 0
          ? ((existing.avg_ttft_seconds * existing.message_count) + (avgTtftSeconds * messageCount)) /
            (existing.message_count + messageCount)
          : avgTtftSeconds,
        message_count: existing.message_count + messageCount,
        total_response_duration_seconds: existing.total_response_duration_seconds + totalResponseDurationSeconds,
        session_count: sessionId ? existing.session_count + 1 : existing.session_count,
        update_date: new Date().toISOString()
      })
      .eq('id', existing.id)
      .select()
      .single();

    if (error) {
      logger.error('Failed to update token usage:', error);
      throw new Error('Failed to update token usage');
    }

    return updated;
  }

  // Create new record
  const { data: record, error } = await supabaseAdmin
    .from('device_token_usage')
    .insert({
      mac_address: normalizedMac,
      session_id: sessionId,
      usage_date: today,
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
      session_count: 1
    })
    .select()
    .single();

  if (error) {
    logger.error('Failed to record token usage:', error);
    throw new Error('Failed to record token usage');
  }

  return record;
};

/**
 * Get token usage statistics for a device
 * @param {string} mac - Device MAC address
 * @param {Object} options - Query options
 * @returns {Promise<Object>} Token usage statistics
 */
const getTokenUsageStats = async (mac, { startDate, endDate, period = 'daily' } = {}) => {
  if (!supabaseAdmin) throw new Error('Database not configured');

  const normalizedMac = normalizeMacAddress(mac);
  if (!normalizedMac) throw new Error('Invalid MAC address format');

  let query = supabaseAdmin
    .from('device_token_usage')
    .select('*')
    .eq('mac_address', normalizedMac)
    .order('usage_date', { ascending: false });

  // Apply date filters
  if (startDate) {
    query = query.gte('usage_date', startDate);
  }
  if (endDate) {
    query = query.lte('usage_date', endDate);
  }

  const { data: records, error } = await query;

  if (error) {
    logger.error('Failed to fetch token usage:', error);
    throw new Error('Failed to fetch token usage statistics');
  }

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
  if (!supabaseAdmin) throw new Error('Database not configured');

  const normalizedMac = normalizeMacAddress(mac);
  if (!normalizedMac) throw new Error('Invalid MAC address format');

  const offset = (page - 1) * limit;

  let query = supabaseAdmin
    .from('device_token_usage')
    .select('*', { count: 'exact' })
    .eq('mac_address', normalizedMac);

  if (startDate) {
    query = query.gte('usage_date', startDate);
  }
  if (endDate) {
    query = query.lte('usage_date', endDate);
  }

  const { data: records, count, error } = await query
    .order('usage_date', { ascending: false })
    .range(offset, offset + limit - 1);

  if (error) {
    logger.error('Failed to list token usage:', error);
    throw new Error('Failed to list token usage');
  }

  return {
    list: records || [],
    total: count || 0,
    page,
    limit
  };
};

/**
 * Get token usage summary for all devices (admin)
 * @param {Object} options - Query options
 * @returns {Promise<Object>} Summary by device
 */
const getTokenUsageSummary = async ({ startDate, endDate, page = 1, limit = 20 } = {}) => {
  if (!supabaseAdmin) throw new Error('Database not configured');

  // For now, fetch all records and aggregate in memory
  // In production, this could use a database view or aggregation query
  let query = supabaseAdmin
    .from('device_token_usage')
    .select('*');

  if (startDate) {
    query = query.gte('usage_date', startDate);
  }
  if (endDate) {
    query = query.lte('usage_date', endDate);
  }

  const { data: records, error } = await query;

  if (error) {
    logger.error('Failed to fetch token usage summary:', error);
    throw new Error('Failed to fetch token usage summary');
  }

  // Group by MAC address
  const byDevice = {};
  for (const record of records || []) {
    const mac = record.mac_address;
    if (!byDevice[mac]) {
      byDevice[mac] = {
        mac,
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
        sessionCount: 0,
        messageCount: 0,
        sessionDurationSeconds: 0,
        dayCount: 0
      };
    }
    byDevice[mac].inputTokens += record.input_tokens || 0;
    byDevice[mac].outputTokens += record.output_tokens || 0;
    byDevice[mac].totalTokens += record.total_tokens || 0;
    byDevice[mac].sessionCount += record.session_count || 0;
    byDevice[mac].messageCount += record.message_count || 0;
    byDevice[mac].sessionDurationSeconds += record.session_duration_seconds || 0;
    byDevice[mac].dayCount += 1;
  }

  // Sort by total tokens (descending)
  const devices = Object.values(byDevice)
    .sort((a, b) => b.totalTokens - a.totalTokens);

  // Paginate
  const total = devices.length;
  const offset = (page - 1) * limit;
  const paginatedDevices = devices.slice(offset, offset + limit);

  return {
    list: paginatedDevices,
    total,
    page,
    limit,
    startDate: startDate || null,
    endDate: endDate || null
  };
};

/**
 * Get token usage for a specific session
 * @param {string} mac - Device MAC address
 * @param {string} sessionId - Session identifier
 * @returns {Promise<Object|null>} Session usage data or null
 */
const getSessionTokenUsage = async (mac, sessionId) => {
  if (!supabaseAdmin) throw new Error('Database not configured');

  const normalizedMac = normalizeMacAddress(mac);
  if (!normalizedMac) throw new Error('Invalid MAC address format');

  const { data: record, error } = await supabaseAdmin
    .from('device_token_usage')
    .select('*')
    .eq('mac_address', normalizedMac)
    .eq('session_id', sessionId)
    .single();

  if (error || !record) return null;

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
  if (!supabaseAdmin) throw new Error('Database not configured');

  // Default to last 30 days if no dates provided (matching Spring Boot)
  if (!startDate) {
    const date = new Date();
    date.setDate(date.getDate() - 30);
    startDate = date.toISOString().split('T')[0];
  }
  if (!endDate) {
    endDate = new Date().toISOString().split('T')[0];
  }

  const { data: records, error } = await supabaseAdmin
    .from('device_token_usage')
    .select('*')
    .gte('usage_date', startDate)
    .lte('usage_date', endDate);

  if (error) {
    logger.error('Failed to fetch daily usage summary:', error);
    throw new Error('Failed to fetch daily usage summary');
  }

  // Group by date - use snake_case to match Spring Boot
  const byDate = {};
  for (const record of records || []) {
    const date = record.usage_date;
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
  if (!supabaseAdmin) throw new Error('Database not configured');

  // Default to last 30 days if no dates provided (matching Spring Boot)
  if (!startDate) {
    const date = new Date();
    date.setDate(date.getDate() - 30);
    startDate = date.toISOString().split('T')[0];
  }
  if (!endDate) {
    endDate = new Date().toISOString().split('T')[0];
  }

  // Fetch token usage records
  const { data: records, error } = await supabaseAdmin
    .from('device_token_usage')
    .select('*')
    .gte('usage_date', startDate)
    .lte('usage_date', endDate);

  if (error) {
    logger.error('Failed to fetch per-device usage:', error);
    throw new Error('Failed to fetch per-device usage');
  }

  // Get unique MAC addresses from records
  const macAddresses = [...new Set((records || []).map(r => r.mac_address))];

  // Fetch device info with kid and parent profiles
  let deviceMap = {};
  if (macAddresses.length > 0) {
    const { data: devices } = await supabaseAdmin
      .from('ai_device')
      .select('mac_address, alias, kid_id, user_id')
      .in('mac_address', macAddresses);

    // Get kid IDs and user IDs that exist
    const kidIds = (devices || []).filter(d => d.kid_id).map(d => d.kid_id);
    const userIds = (devices || []).filter(d => d.user_id).map(d => d.user_id);

    // Fetch kid profiles if any
    let kidMap = {};
    if (kidIds.length > 0) {
      const { data: kids } = await supabaseAdmin
        .from('kid_profile')
        .select('id, name, nickname')
        .in('id', kidIds);

      for (const kid of kids || []) {
        kidMap[kid.id] = kid.nickname || kid.name;
      }
    }

    // Fetch parent profiles if any
    let parentMap = {};
    if (userIds.length > 0) {
      // First try parent_profile table
      const { data: parents } = await supabaseAdmin
        .from('parent_profile')
        .select('user_id, display_name')
        .in('user_id', userIds);

      for (const parent of parents || []) {
        if (parent.display_name) {
          parentMap[parent.user_id] = parent.display_name;
        }
      }

      // Fallback to sys_user nickname for users without parent_profile
      const usersWithoutProfile = userIds.filter(id => !parentMap[id]);
      if (usersWithoutProfile.length > 0) {
        const { data: users } = await supabaseAdmin
          .from('sys_user')
          .select('id, nickname, username')
          .in('id', usersWithoutProfile);

        for (const user of users || []) {
          if (!parentMap[user.id]) {
            parentMap[user.id] = user.nickname || user.username;
          }
        }
      }
    }

    // Build device map with separate kid_name and owner_name (parent)
    for (const device of devices || []) {
      const kidName = device.kid_id && kidMap[device.kid_id] ? kidMap[device.kid_id] : null;
      const parentName = device.user_id && parentMap[device.user_id] ? parentMap[device.user_id] : null;

      deviceMap[device.mac_address] = {
        kid_name: kidName,
        owner_name: parentName || device.alias || null
      };
    }
  }

  // Transform records to snake_case format with cost_inr, kid_name, and owner_name
  const usage = (records || []).map(record => {
    const deviceInfo = deviceMap[record.mac_address] || {};
    return {
      mac_address: record.mac_address,
      usage_date: record.usage_date,
      input_tokens: record.input_tokens || 0,
      output_tokens: record.output_tokens || 0,
      total_tokens: record.total_tokens || 0,
      input_text_tokens: record.input_text_tokens || 0,
      input_audio_tokens: record.input_audio_tokens || 0,
      output_text_tokens: record.output_text_tokens || 0,
      output_audio_tokens: record.output_audio_tokens || 0,
      session_count: record.session_count || 0,
      message_count: record.message_count || 0,
      session_duration_seconds: record.session_duration_seconds || 0,
      // Frontend-expected aliases
      total_duration_seconds: record.session_duration_seconds || 0,
      avg_ttft_seconds: record.avg_ttft_seconds || 0,
      kid_name: deviceInfo.kid_name || null,
      owner_name: deviceInfo.owner_name || null,
      cost_inr: calculateCostInINR(
        record.input_text_tokens || 0,
        record.input_audio_tokens || 0,
        record.output_text_tokens || 0,
        record.output_audio_tokens || 0
      )
    };
  });

  // Sort by date descending
  usage.sort((a, b) => b.usage_date.localeCompare(a.usage_date));

  return {
    list: usage
  };
};

/**
 * Get overall usage totals across all devices
 * @param {Object} options - Query options
 * @returns {Promise<Object>} Usage totals
 */
const getUsageTotals = async ({ startDate, endDate } = {}) => {
  if (!supabaseAdmin) throw new Error('Database not configured');

  let query = supabaseAdmin
    .from('device_token_usage')
    .select('*');

  if (startDate) {
    query = query.gte('usage_date', startDate);
  }
  if (endDate) {
    query = query.lte('usage_date', endDate);
  }

  const { data: records, error } = await query;

  if (error) {
    logger.error('Failed to fetch usage totals:', error);
    throw new Error('Failed to fetch usage totals');
  }

  // Aggregate totals
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
    deviceCount: 0,
    dayCount: 0
  };

  const devices = new Set();
  const days = new Set();
  let weightedTtftSum = 0;

  for (const record of records || []) {
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
    devices.add(record.mac_address);
    days.add(record.usage_date);
  }

  // Calculate weighted average TTFT
  if (totals.messageCount > 0) {
    totals.avgTtftSeconds = weightedTtftSum / totals.messageCount;
  }

  totals.deviceCount = devices.size;
  totals.dayCount = days.size;

  return {
    period: {
      startDate: startDate || null,
      endDate: endDate || null
    },
    totals
  };
};

/**
 * Delete token usage records for a device
 * @param {string} mac - Device MAC address
 * @param {Object} options - Delete options
 * @returns {Promise<number>} Number of deleted records
 */
const deleteTokenUsage = async (mac, { startDate, endDate, olderThan } = {}) => {
  if (!supabaseAdmin) throw new Error('Database not configured');

  const normalizedMac = normalizeMacAddress(mac);
  if (!normalizedMac) throw new Error('Invalid MAC address format');

  let query = supabaseAdmin
    .from('device_token_usage')
    .delete()
    .eq('mac_address', normalizedMac);

  if (startDate) {
    query = query.gte('usage_date', startDate);
  }
  if (endDate) {
    query = query.lte('usage_date', endDate);
  }
  if (olderThan) {
    query = query.lt('usage_date', olderThan);
  }

  const { error, count } = await query;

  if (error) {
    logger.error('Failed to delete token usage:', error);
    throw new Error('Failed to delete token usage');
  }

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
