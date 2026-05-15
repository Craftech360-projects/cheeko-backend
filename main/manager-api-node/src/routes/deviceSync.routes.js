const express = require('express');
const router = express.Router();

const { requireServiceKey } = require('../middleware/auth');
const { asyncHandler } = require('../middleware/errorHandler');
const { success, badRequest } = require('../utils/response');
const deviceSettingsService = require('../services/deviceSettings.service');
const logger = require('../utils/logger');

router.use(requireServiceKey);

router.post('/settings-get', asyncHandler(async (req, res) => {
  const { mac_address, sender_client_id, device_id, current_version, payload } = req.body || {};
  logger.info(`[SETTINGS-SYNC][API] POST /device-sync/settings-get mac=${mac_address || 'na'} sender=${sender_client_id || 'na'} current_version=${current_version ?? 'na'}`);

  if (!mac_address) {
    return badRequest(res, 'mac_address is required');
  }

  const result = await deviceSettingsService.onSettingsGet({
    mac_address,
    sender_client_id: sender_client_id || null,
    device_id: device_id || null,
    current_version,
    payload: payload || req.body || {},
  });

  success(res, result);
}));

router.post('/settings-ack', asyncHandler(async (req, res) => {
  const {
    mac_address,
    sender_client_id,
    device_id,
    version,
    status,
    applied_version,
    reason,
    payload,
  } = req.body || {};
  logger.info(`[SETTINGS-SYNC][API] POST /device-sync/settings-ack mac=${mac_address || 'na'} sender=${sender_client_id || 'na'} status=${status || 'na'} version=${version ?? 'na'}`);

  if (!mac_address) {
    return badRequest(res, 'mac_address is required');
  }

  const result = await deviceSettingsService.onSettingsAck({
    mac_address,
    sender_client_id: sender_client_id || null,
    device_id: device_id || null,
    version,
    status,
    applied_version,
    reason,
    payload: payload || req.body || {},
  });

  success(res, {
    mac_address: result.mac_address,
    sync_status: result.sync_status,
    last_ack_status: result.last_ack_status,
    last_applied_version: result.last_applied_version,
  });
}));

router.post('/device-state', asyncHandler(async (req, res) => {
  const { mac_address, sender_client_id, device_id, payload } = req.body || {};
  logger.info(`[SETTINGS-SYNC][API] POST /device-sync/device-state mac=${mac_address || 'na'} sender=${sender_client_id || 'na'} reason=${payload?.reason || 'na'}`);

  if (!mac_address) {
    return badRequest(res, 'mac_address is required');
  }

  const result = await deviceSettingsService.onDeviceState({
    mac_address,
    sender_client_id: sender_client_id || null,
    device_id: device_id || null,
    payload: payload || req.body || {},
  });

  success(res, {
    mac_address: result.mac_address,
    online: result.online,
    last_seen_at: result.last_seen_at,
    settings_version: result.settings_version,
  });
}));

module.exports = router;
