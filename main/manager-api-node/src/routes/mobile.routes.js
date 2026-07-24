const express = require('express');
const router = express.Router();
const asyncHandler = require('express-async-handler');
const multer = require('multer');
const os = require('os');
const fs = require('fs/promises');
const path = require('path');
const ffmpeg = require('fluent-ffmpeg');
const { requireFirebaseAuth } = require('../middleware/firebaseAuth');
const mobileService = require('../services/mobile.service');
const agentService = require('../services/agent.service');
const deviceService = require('../services/device.service');
const deviceSettingsService = require('../services/deviceSettings.service');
const deviceAnalyticsService = require('../services/deviceAnalytics.service');
const uploadService = require('../services/upload.service');
const rfidService = require('../services/rfid.service');
const { success, badRequest } = require('../utils/response');
const logger = require('../utils/logger');

const voiceCardUpload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 20 * 1024 * 1024 },
    fileFilter: (_req, file, cb) => {
        const allowedMimes = ['audio/mpeg', 'audio/mp3', 'audio/wav', 'audio/ogg', 'audio/m4a', 'audio/aac', 'audio/x-m4a'];
        if (allowedMimes.includes(file.mimetype)) {
            cb(null, true);
        } else {
            cb(new Error('Invalid file type. Only audio files are allowed.'));
        }
    },
});

const kidAvatarUpload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 8 * 1024 * 1024 },
    fileFilter: (_req, file, cb) => {
        const allowedMimes = ['image/jpeg', 'image/png', 'image/webp'];
        if (allowedMimes.includes(file.mimetype)) {
            cb(null, true);
        } else {
            cb(new Error('Invalid file type. Only JPEG, PNG, or WEBP images are allowed.'));
        }
    },
});

// Device firmware only reliably decodes MP3; phone recordings commonly arrive as m4a/wav/ogg.
const VOICE_CARD_MIME_TO_EXT = {
    'audio/mpeg': '.mp3',
    'audio/mp3': '.mp3',
    'audio/wav': '.wav',
    'audio/ogg': '.ogg',
    'audio/m4a': '.m4a',
    'audio/aac': '.aac',
    'audio/x-m4a': '.m4a',
};

const transcodeToMp3 = async (inputBuffer, mimeType) => {
    const tmpId = `${Date.now()}_${Math.random().toString(36).slice(2)}`;
    const inputExt = VOICE_CARD_MIME_TO_EXT[mimeType] || '.dat';
    const inputPath = path.join(os.tmpdir(), `voicecard_in_${tmpId}${inputExt}`);
    const outputPath = path.join(os.tmpdir(), `voicecard_out_${tmpId}.mp3`);

    try {
        await fs.writeFile(inputPath, inputBuffer);
        await new Promise((resolve, reject) => {
            ffmpeg(inputPath)
                .audioCodec('libmp3lame')
                .audioBitrate('96k')
                .toFormat('mp3')
                .on('end', resolve)
                .on('error', reject)
                .save(outputPath);
        });
        return await fs.readFile(outputPath);
    } finally {
        await fs.unlink(inputPath).catch(() => {});
        await fs.unlink(outputPath).catch(() => {});
    }
};

const defaultDeviceName = (index) => `Cheeko - ${index + 1}`;

const mobileDeviceDisplayName = (device, index) => {
    const rawName = device.device_name || device.alias;
    const displayName = typeof rawName === 'string' ? rawName.trim() : rawName;
    return displayName || defaultDeviceName(index);
};

const formatMobileDevice = (device, index = 0) => {
    const displayName = mobileDeviceDisplayName(device, index);
    return {
        id: device.id,
        userId: device.user_id,
        user_id: device.user_id,
        macAddress: device.mac_address,
        mac_address: device.mac_address,
        deviceName: displayName,
        device_name: displayName,
        alias: device.alias,
        status: device.user_id ? 'active' : 'unbound',
        bindingStatus: device.user_id ? 'bound' : 'unbound',
        binding_status: device.user_id ? 'bound' : 'unbound',
        agentId: device.agent_id,
        agent_id: device.agent_id,
        kidId: device.kid_id,
        kid_id: device.kid_id,
        board: device.board,
        mode: device.mode,
        deviceMode: device.device_mode,
        device_mode: device.device_mode,
        appVersion: device.app_version,
        app_version: device.app_version,
        autoUpdate: device.auto_update,
        auto_update: device.auto_update,
        lastConnectedAt: device.last_connected_at,
        last_connected_at: device.last_connected_at,
        createdAt: device.create_date,
        created_at: device.create_date,
        updatedAt: device.update_date,
        updated_at: device.update_date,
    };
};

// All mobile routes require a valid Firebase ID token
router.use(requireFirebaseAuth);

// ─── Parent Profile ─────────────────────────────────────────────────────────

router.get('/parent-profile', asyncHandler(async (req, res) => {
    const profile = await mobileService.getParentProfile(req.firebaseUser.uid);
    if (!profile) return res.status(404).json({ error: 'Profile not found' });
    res.json(profile);
}));

router.post('/parent-profile', asyncHandler(async (req, res) => {
    const profile = await mobileService.createParentProfile(req.firebaseUser.uid, req.body);
    res.status(201).json(profile);
}));

router.put('/parent-profile', asyncHandler(async (req, res) => {
    const profile = await mobileService.updateParentProfile(req.firebaseUser.uid, req.body);
    res.json(profile);
}));

router.put('/parent-profile/fcm-token', asyncHandler(async (req, res) => {
    const fcmToken = req.body.fcmToken || req.body.fcm_token || req.body.token;
    if (!fcmToken) return badRequest(res, 'FCM token is required');

    const profile = await mobileService.updateFcmToken(req.firebaseUser.uid, fcmToken);
    res.json({
        success: true,
        fcmToken: profile.fcmToken,
        fcm_token: profile.fcm_token,
    });
}));

router.delete('/parent-profile/fcm-token', asyncHandler(async (req, res) => {
    const profile = await mobileService.clearFcmToken(req.firebaseUser.uid);
    res.json({
        success: true,
        fcmToken: profile.fcmToken,
        fcm_token: profile.fcm_token,
    });
}));

// ─── User State ─────────────────────────────────────────────────────────────

router.get('/user-state', asyncHandler(async (req, res) => {
    const state = await mobileService.getUserState(req.firebaseUser.uid);
    if (!state) return res.status(404).json({ error: 'User state not found' });
    res.json(state);
}));

router.get('/homepage-activity', asyncHandler(async (req, res) => {
    const activity = await mobileService.getHomepageActivity(req.firebaseUser.uid, req.query);
    success(res, activity);
}));

router.get('/homepage-activity/details', asyncHandler(async (req, res) => {
    const details = await mobileService.getHomepageActivityDetails(req.firebaseUser.uid, req.query);
    success(res, details);
}));

router.get('/progress/summary', asyncHandler(async (req, res) => {
    const summary = await mobileService.getProgressSummary(req.firebaseUser.uid, req.query);
    success(res, summary);
}));

router.get('/progress/details', asyncHandler(async (req, res) => {
    const details = await mobileService.getProgressDetails(req.firebaseUser.uid, req.query);
    success(res, details);
}));

router.get('/progress/trend', asyncHandler(async (req, res) => {
    const trend = await mobileService.getProgressTrend(req.firebaseUser.uid, req.query);
    success(res, trend);
}));

router.get('/recommendations/homepage', asyncHandler(async (req, res) => {
    const { kidId, kid_id, limit } = req.query;
    const resolvedKidId = kidId || kid_id;
    if (!resolvedKidId) return badRequest(res, 'kidId is required');

    const recommendations = await mobileService.getHomepageRecommendations(req.firebaseUser.uid, {
        kidId: resolvedKidId,
        limit,
    });
    success(res, recommendations);
}));

router.get('/homepage-recommendations', asyncHandler(async (req, res) => {
    const { kidId, kid_id, limit } = req.query;
    const resolvedKidId = kidId || kid_id;
    if (!resolvedKidId) return badRequest(res, 'kidId is required');

    const recommendations = await mobileService.getHomepageRecommendations(req.firebaseUser.uid, {
        kidId: resolvedKidId,
        limit,
    });
    success(res, recommendations);
}));

router.post('/user-state', asyncHandler(async (req, res) => {
    res.status(201).json({ success: true }); // Sys_user is auto-created in auth middleware
}));

router.put('/user-state', asyncHandler(async (req, res) => {
    res.json({ success: true });
}));

router.put('/user-state/onboarding-completed', asyncHandler(async (req, res) => {
    await mobileService.markOnboardingCompleted(req.firebaseUser.uid);
    res.json({ success: true });
}));

// ─── Kids ───────────────────────────────────────────────────────────────────

router.get('/kids', asyncHandler(async (req, res) => {
    const kids = await mobileService.getKids(req.firebaseUser.uid);
    res.json(kids);
}));

router.post('/kids', asyncHandler(async (req, res) => {
    const kid = await mobileService.createKid(req.firebaseUser.uid, req.body);
    res.status(201).json(kid);
}));

router.put('/kids/:id', asyncHandler(async (req, res) => {
    const kid = await mobileService.updateKid(req.params.id, req.body);
    res.json(kid);
}));

router.delete('/kids/:id', asyncHandler(async (req, res) => {
    await mobileService.deleteKid(req.firebaseUser.uid, req.params.id);
    success(res, null, 'Kid profile deleted');
}));

router.post('/kids/:id/avatar', kidAvatarUpload.single('file'), asyncHandler(async (req, res) => {
    if (!req.file) {
        return badRequest(res, 'No file uploaded');
    }

    const uploadResult = await uploadService.uploadKidAvatar(
        req.file.buffer,
        req.params.id,
        req.file.mimetype
    );

    const kid = await mobileService.updateKid(req.params.id, { avatar_url: uploadResult.url });

    success(res, { avatarUrl: uploadResult.url, kid });
}));

// ─── RPC Replacements ───────────────────────────────────────────────────────

router.get('/check-email', asyncHandler(async (req, res) => {
    const result = await mobileService.checkEmailExists(req.query.email);
    res.json(result);
}));

router.delete('/account', asyncHandler(async (req, res) => {
    const result = await mobileService.deleteUserAccount(req.firebaseUser.uid);
    res.json(result);
}));

// ─── Agents ─────────────────────────────────────────────────────────────────

router.get('/agents', asyncHandler(async (req, res) => {
    const { page, limit } = req.query;
    const result = await agentService.getAgentListForUser(req.mobileUser.id, false, { page, limit });
    success(res, result);
}));

router.post('/agents', asyncHandler(async (req, res) => {
    const agent = await agentService.createAgent(req.mobileUser.id, req.body);
    success(res, agent.id.toString());
}));

router.get('/agents/:agentId', asyncHandler(async (req, res) => {
    const agent = await agentService.getAgentInfoById(req.params.agentId);
    if (!agent) return res.status(404).json({ code: 404, msg: 'Agent not found', data: null });
    success(res, agent);
}));

router.put('/agents/:agentId', asyncHandler(async (req, res) => {
    const agent = await agentService.updateAgent(req.params.agentId, req.mobileUser.id, req.body);
    success(res, agent);
}));

router.delete('/agents/:agentId', asyncHandler(async (req, res) => {
    await agentService.deleteAgent(req.params.agentId, req.mobileUser.id);
    success(res, null, 'Agent deleted');
}));

router.get('/agents/:agentId/devices', asyncHandler(async (req, res) => {
    const devices = await deviceService.getDevicesByAgent(req.mobileUser.id, req.params.agentId);
    const mapped = devices.map(formatMobileDevice);
    success(res, mapped);
}));

router.get('/devices', asyncHandler(async (req, res) => {
    const { page, limit } = req.query;
    const result = await deviceService.listDevices(req.mobileUser.id, {
        page: parseInt(page) || 1,
        limit: parseInt(limit) || 50,
    });
    success(res, {
        ...result,
        list: result.list.map(formatMobileDevice),
    });
}));

router.get('/devices/:mac/settings', asyncHandler(async (req, res) => {
    logger.info(`[SETTINGS-SYNC][MOBILE] GET /devices/${req.params.mac}/settings user=${req.mobileUser?.id}`);
    const device = await deviceSettingsService.resolveOwnedDeviceForMobile(req.mobileUser.id, req.params.mac);
    if (!device) {
        return res.status(404).json({ code: 404, msg: 'Device not found', data: null });
    }

    const settings = await deviceSettingsService.getSettingsByMac(device.mac_address);
    success(res, {
        deviceId: device.id,
        macAddress: device.mac_address,
        settingsVersion: settings.settings_version,
        settings: settings.settings,
        syncStatus: settings.sync_status,
        lastAckStatus: settings.last_ack_status,
        lastAckReason: settings.last_ack_reason,
        lastAppliedVersion: settings.last_applied_version,
    });
}));

router.patch('/devices/:mac/settings', asyncHandler(async (req, res) => {
    logger.info(`[SETTINGS-SYNC][MOBILE] PATCH /devices/${req.params.mac}/settings user=${req.mobileUser?.id}`);
    const device = await deviceSettingsService.resolveOwnedDeviceForMobile(req.mobileUser.id, req.params.mac);
    if (!device) {
        return res.status(404).json({ code: 404, msg: 'Device not found', data: null });
    }

    const payloadSettings = req.body?.settings;
    if (!payloadSettings || typeof payloadSettings !== 'object' || Array.isArray(payloadSettings)) {
        return badRequest(res, 'settings object is required');
    }

    const patchResult = await deviceSettingsService.patchSettingsByMac(
        device.mac_address,
        payloadSettings
    );

    let publishResult = null;
    if (patchResult.changed) {
        try {
            if (!patchResult.publishRequired) {
                logger.info(`[SETTINGS-SYNC][MOBILE] publish override mac=${device.mac_address} reason=stale_online_check`);
            }
            publishResult = await deviceSettingsService.requestGatewaySettingsPublish({
                mac_address: device.mac_address,
                version: patchResult.settings.settings_version,
                settings: patchResult.settings.settings,
            });
        } catch (error) {
            // Device likely offline or gateway unavailable - mark pending_offline.
            logger.warn(`[SETTINGS-SYNC][MOBILE] publish failed for mac=${device.mac_address}: ${error.message}`);
            await deviceSettingsService.markSyncStatusByMac(
                device.mac_address,
                'pending_offline',
                `publish_failed:${error.message}`
            );
        }
    }

    const finalSettings = await deviceSettingsService.getSettingsByMac(device.mac_address);

    success(res, {
        changed: patchResult.changed,
        publishRequired: patchResult.publishRequired,
        publishResult,
        deviceId: device.id,
        macAddress: device.mac_address,
        settingsVersion: finalSettings.settings_version,
        settings: finalSettings.settings,
        syncStatus: finalSettings.sync_status,
    });
}));

router.get('/devices/:mac/state', asyncHandler(async (req, res) => {
    logger.info(`[SETTINGS-SYNC][MOBILE] GET /devices/${req.params.mac}/state user=${req.mobileUser?.id}`);
    const device = await deviceSettingsService.resolveOwnedDeviceForMobile(req.mobileUser.id, req.params.mac);
    if (!device) {
        return res.status(404).json({ code: 404, msg: 'Device not found', data: null });
    }

    const state = await deviceSettingsService.getRuntimeStateByMac(device.mac_address);
    success(res, {
        deviceId: device.id,
        macAddress: device.mac_address,
        state,
    });
}));

router.get('/devices/:mac/sync-events', asyncHandler(async (req, res) => {
    logger.info(`[SETTINGS-SYNC][MOBILE] GET /devices/${req.params.mac}/sync-events user=${req.mobileUser?.id}`);
    const device = await deviceSettingsService.resolveOwnedDeviceForMobile(req.mobileUser.id, req.params.mac);
    if (!device) {
        return res.status(404).json({ code: 404, msg: 'Device not found', data: null });
    }

    const limit = req.query.limit ? Number(req.query.limit) : 50;
    const events = await deviceSettingsService.listSyncEventsByMac(device.mac_address, limit);
  success(res, {
    deviceId: device.id,
    macAddress: device.mac_address,
    events,
  });
}));

router.get('/devices/:mac/analytics/overview', asyncHandler(async (req, res) => {
    logger.info(`[ANALYTICS][MOBILE] GET /devices/${req.params.mac}/analytics/overview user=${req.mobileUser?.id}`);
    const device = await deviceSettingsService.resolveOwnedDeviceForMobile(req.mobileUser.id, req.params.mac);
    if (!device) {
        return res.status(404).json({ code: 404, msg: 'Device not found', data: null });
    }

    const { from, to } = req.query;
    const overview = await deviceAnalyticsService.getAnalyticsOverviewByMac(device.mac_address, { from, to });
    success(res, {
        deviceId: device.id,
        macAddress: device.mac_address,
        ...overview,
    });
}));

router.get('/devices/:mac/analytics/timeseries', asyncHandler(async (req, res) => {
    logger.info(`[ANALYTICS][MOBILE] GET /devices/${req.params.mac}/analytics/timeseries user=${req.mobileUser?.id}`);
    const device = await deviceSettingsService.resolveOwnedDeviceForMobile(req.mobileUser.id, req.params.mac);
    if (!device) {
        return res.status(404).json({ code: 404, msg: 'Device not found', data: null });
    }

    const { from, to } = req.query;
    const timeseries = await deviceAnalyticsService.getAnalyticsTimeSeriesByMac(device.mac_address, { from, to });
    success(res, {
        deviceId: device.id,
        macAddress: device.mac_address,
        timeseries,
    });
}));

router.get('/devices/:mac/analytics/events', asyncHandler(async (req, res) => {
    logger.info(`[ANALYTICS][MOBILE] GET /devices/${req.params.mac}/analytics/events user=${req.mobileUser?.id}`);
    const device = await deviceSettingsService.resolveOwnedDeviceForMobile(req.mobileUser.id, req.params.mac);
    if (!device) {
        return res.status(404).json({ code: 404, msg: 'Device not found', data: null });
    }

    const limit = req.query.limit ? Number(req.query.limit) : 100;
    const events = await deviceAnalyticsService.getRecentAnalyticsEventsByMac(device.mac_address, { limit });
    success(res, {
        deviceId: device.id,
        macAddress: device.mac_address,
        events,
    });
}));

router.get('/devices/:mac/analytics/battery', asyncHandler(async (req, res) => {
    logger.info(`[ANALYTICS][MOBILE] GET /devices/${req.params.mac}/analytics/battery user=${req.mobileUser?.id}`);
    const device = await deviceSettingsService.resolveOwnedDeviceForMobile(req.mobileUser.id, req.params.mac);
    if (!device) {
        return res.status(404).json({ code: 404, msg: 'Device not found', data: null });
    }

    const { from, to } = req.query;
    const battery = await deviceAnalyticsService.getBatteryTrendByMac(device.mac_address, { from, to });
    success(res, {
        deviceId: device.id,
        macAddress: device.mac_address,
        ...battery,
    });
}));

router.get('/devices/:mac/games-played', asyncHandler(async (req, res) => {
    const details = await mobileService.getDeviceGamesPlayed(req.firebaseUser.uid, req.params.mac, req.query);
    success(res, details);
}));

router.get('/devices/:mac/radio-played', asyncHandler(async (req, res) => {
    const details = await mobileService.getDeviceRadioPlayed(req.firebaseUser.uid, req.params.mac, req.query);
    success(res, details);
}));

// ─── AI Imagine gallery ───────────────────────────────────────────────────────

router.get('/devices/:mac/imagine', asyncHandler(async (req, res) => {
    const device = await deviceSettingsService.resolveOwnedDeviceForMobile(req.mobileUser.id, req.params.mac);
    if (!device) {
        return res.status(404).json({ code: 404, msg: 'Device not found', data: null });
    }
    const images = await uploadService.listImagineImages(device.mac_address);
    success(res, images);
}));
router.get('/user-devices', asyncHandler(async (req, res) => {
    const { page, limit } = req.query;
    const result = await deviceService.listDevices(req.mobileUser.id, {
        page: parseInt(page) || 1,
        limit: parseInt(limit) || 50,
    });
    success(res, {
        ...result,
        list: result.list.map(formatMobileDevice),
    });
}));

router.post('/agents/:agentId/bind/:deviceCode', asyncHandler(async (req, res) => {
    const device = await deviceService.bindDevice(req.mobileUser.id, req.params.agentId, req.params.deviceCode);
    const response = {
        id: device.id,
        macAddress: device.mac_address,
        agentId: device.agent_id,
        alias: device.alias,
        board: device.board,
        kidId: device.kid_id,
        appVersion: device.app_version
    };
    success(res, response);
}));

router.put('/devices/assign-kid-by-mac', asyncHandler(async (req, res) => {
    const { mac, kidId } = req.body;
    try {
        const device = await deviceService.assignKidByMac(mac, kidId, req.mobileUser.id);
        success(res, formatMobileDevice(device), 'Kid assigned to device');
    } catch (error) {
        if (error.message === 'Device already has a child assigned') {
            return res.status(409).json({
                code: 409,
                msg: error.message,
                data: null,
            });
        }
        throw error;
    }
}));

// ─── Chat History ────────────────────────────────────────────────────────────

router.get('/agents/:agentId/sessions', asyncHandler(async (req, res) => {
    const { page, limit } = req.query;
    const sessions = await agentService.getAgentSessions(req.params.agentId, { page, limit });
    success(res, sessions);
}));

router.get('/agents/:agentId/chat-history/:sessionId', asyncHandler(async (req, res) => {
    const history = await agentService.getChatHistory(req.params.agentId, req.params.sessionId);
    success(res, history);
}));

// ─── Device → Agent lookup ────────────────────────────────────────────────────

router.get('/agents/device/:mac/agent-id', asyncHandler(async (req, res) => {
    const agentId = await agentService.getAgentIdByMac(req.params.mac);
    success(res, agentId);
}));

// ─── Activation ──────────────────────────────────────────────────────────────

// Activation code check is best-effort (codes live in device service in-memory cache)
// Returns null if not found — Flutter handles this gracefully
router.get('/activation/check-code', asyncHandler(async (req, res) => {
    success(res, null);
}));

// ─── Custom Voice Cards ─────────────────────────────────────────────────────

router.post('/voice-cards/upload', voiceCardUpload.single('file'), asyncHandler(async (req, res) => {
    if (!req.file) {
        return badRequest(res, 'No file uploaded');
    }

    const mp3Buffer = await transcodeToMp3(req.file.buffer, req.file.mimetype);

    const uploadResult = await uploadService.uploadContentFile(
        mp3Buffer,
        `voicecard_${Date.now()}.mp3`,
        'rfidcontent',
        'voicecards',
        'audio/mpeg'
    );

    const { contentPackId } = await rfidService.createCustomVoiceCardPack({
        audioUrl: uploadResult.url,
        userId: req.mobileUser.id
    });

    success(res, { contentPackId });
}));

router.post('/devices/:mac/voice-cards/pairing', asyncHandler(async (req, res) => {
    const { contentPackId, kidId } = req.body;
    if (!contentPackId) {
        return badRequest(res, 'contentPackId is required');
    }

    const device = await deviceSettingsService.resolveOwnedDeviceForMobile(req.mobileUser.id, req.params.mac);
    if (!device) {
        return res.status(404).json({ code: 404, msg: 'Device not found', data: null });
    }

    const pairing = await rfidService.createPendingCardPairing({
        macAddress: device.mac_address,
        contentPackId,
        kidId,
        userId: req.mobileUser.id
    });

    success(res, {
        pairingId: Number(pairing.id),
        expiresAt: pairing.expires_at
    });
}));

router.get('/voice-cards/pairing/:pairingId', asyncHandler(async (req, res) => {
    if (!/^\d+$/.test(req.params.pairingId)) {
        return badRequest(res, 'Invalid pairingId');
    }

    const pairing = await rfidService.getPendingCardPairingStatus(req.params.pairingId);
    if (!pairing || String(pairing.user_id) !== String(req.mobileUser.id)) {
        return res.status(404).json({ code: 404, msg: 'Pairing not found', data: null });
    }

    success(res, {
        status: pairing.status,
        rfidUid: pairing.rfid_uid
    });
}));

module.exports = router;
