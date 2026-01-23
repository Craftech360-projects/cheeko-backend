/**
 * Device Service
 *
 * Handles ESP32 device management, registration, binding, and mode control.
 */

const { supabaseAdmin } = require('../config/database');
const logger = require('../utils/logger');
const { generateDeviceCode, normalizeMacAddress } = require('../utils/helpers');

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
      device_mode: 'auto',
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
const bindDevice = async (userId, agentId, deviceCode) => {
  if (!supabaseAdmin) throw new Error('Database not configured');

  // Find device by code or MAC
  let query = supabaseAdmin.from('ai_device').select('*');

  if (deviceCode.includes(':') || deviceCode.length === 12) {
    // It's a MAC address
    const normalizedMac = normalizeMacAddress(deviceCode);
    query = query.eq('mac_address', normalizedMac);
  } else {
    // It's a device code - for now, we'll use MAC as identifier
    // In production, you might have a separate validation code system
    throw new Error('Device validation code system not implemented. Use MAC address.');
  }

  const { data: device, error: findError } = await query.single();

  if (findError || !device) {
    throw new Error('Device not found');
  }

  if (device.user_id && device.user_id !== userId) {
    throw new Error('Device is already bound to another user');
  }

  // Verify agent belongs to user
  const { data: agent } = await supabaseAdmin
    .from('ai_agent')
    .select('id')
    .eq('id', agentId)
    .eq('user_id', userId)
    .single();

  if (!agent) {
    throw new Error('Agent not found or does not belong to user');
  }

  // Bind device
  const { data: updated, error: updateError } = await supabaseAdmin
    .from('ai_device')
    .update({
      user_id: userId,
      agent_id: agentId,
      update_date: new Date().toISOString()
    })
    .eq('id', device.id)
    .select()
    .single();

  if (updateError) throw new Error('Failed to bind device');

  return updated;
};

/**
 * Get devices bound to an agent
 * @param {number} userId - User ID
 * @param {string} agentId - Agent ID
 * @returns {Promise<Array>} List of devices
 */
const getDevicesByAgent = async (userId, agentId) => {
  if (!supabaseAdmin) throw new Error('Database not configured');

  const { data: devices, error } = await supabaseAdmin
    .from('ai_device')
    .select('*')
    .eq('user_id', userId)
    .eq('agent_id', agentId)
    .order('create_date', { ascending: false });

  if (error) throw new Error('Failed to fetch devices');

  return devices || [];
};

/**
 * Unbind device from user
 * @param {number} userId - User ID
 * @param {string} deviceId - Device ID
 */
const unbindDevice = async (userId, deviceId) => {
  if (!supabaseAdmin) throw new Error('Database not configured');

  const { data: device } = await supabaseAdmin
    .from('ai_device')
    .select('id, user_id')
    .eq('id', deviceId)
    .single();

  if (!device) throw new Error('Device not found');
  if (device.user_id !== userId) throw new Error('Device does not belong to user');

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
 * @returns {Promise<Object>} Updated device
 */
const updateDevice = async (userId, deviceId, data) => {
  if (!supabaseAdmin) throw new Error('Database not configured');

  const { data: device } = await supabaseAdmin
    .from('ai_device')
    .select('id, user_id')
    .eq('id', deviceId)
    .single();

  if (!device) throw new Error('Device not found');
  if (device.user_id && device.user_id !== userId) {
    throw new Error('Device does not belong to user');
  }

  const updateData = {
    update_date: new Date().toISOString()
  };

  if (data.alias !== undefined) updateData.alias = data.alias;
  if (data.autoUpdate !== undefined) updateData.auto_update = data.autoUpdate ? 1 : 0;
  if (data.agentId !== undefined) updateData.agent_id = data.agentId;

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
const manualAddDevice = async (userId, { mac, alias, agentId }) => {
  if (!supabaseAdmin) throw new Error('Database not configured');

  const normalizedMac = normalizeMacAddress(mac);
  if (!normalizedMac) throw new Error('Invalid MAC address format');

  // Check if device exists
  const { data: existing } = await supabaseAdmin
    .from('ai_device')
    .select('id')
    .eq('mac_address', normalizedMac)
    .single();

  if (existing) throw new Error('Device already exists');

  const { data: device, error } = await supabaseAdmin
    .from('ai_device')
    .insert({
      mac_address: normalizedMac,
      user_id: userId,
      alias,
      agent_id: agentId,
      mode: 'conversation',
      device_mode: 'auto'
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
const checkOtaVersion = async (mac, currentVersion, board) => {
  if (!supabaseAdmin) throw new Error('Database not configured');

  const normalizedMac = normalizeMacAddress(mac);
  if (!normalizedMac) throw new Error('Invalid MAC address format');

  // Get or create device record
  let device = await getDeviceByMac(normalizedMac);
  if (!device) {
    device = await registerDevice({ mac: normalizedMac, board, appVersion: currentVersion });
  } else {
    // Update last connected time and current version
    await supabaseAdmin
      .from('ai_device')
      .update({
        last_connected_at: new Date().toISOString(),
        app_version: currentVersion,
        board: board || device.board
      })
      .eq('id', device.id);
  }

  // Determine firmware type from board
  const firmwareType = board || 'esp32';

  // Check for force update firmware first
  let firmware = await getForceUpdateFirmware(firmwareType);
  const isForceUpdate = !!firmware;

  // If no force update, get latest firmware
  if (!firmware) {
    firmware = await getLatestFirmware(firmwareType);
  }

  // Build response
  const response = {
    device: {
      mac: normalizedMac,
      currentVersion,
      board: device.board,
      autoUpdate: device.auto_update === 1
    },
    firmware: null,
    serverTime: {
      timestamp: Date.now(),
      timezone: 'UTC',
      offset: 0
    }
  };

  // Check if update is available
  if (firmware && firmware.version !== currentVersion) {
    response.firmware = {
      version: firmware.version,
      url: firmware.firmware_path,
      size: firmware.size,
      force: isForceUpdate ? 1 : 0,
      name: firmware.firmware_name,
      remark: firmware.remark
    };
  }

  return response;
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
  setForceUpdate
};
