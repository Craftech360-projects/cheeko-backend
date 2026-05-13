const express = require('express');
const router = express.Router();
const asyncHandler = require('express-async-handler');
const { requireFirebaseAuth } = require('../middleware/firebaseAuth');
const mobileService = require('../services/mobile.service');
const agentService = require('../services/agent.service');
const deviceService = require('../services/device.service');
const { success, badRequest } = require('../utils/response');

const formatMobileDevice = (device) => ({
    id: device.id,
    userId: device.user_id,
    user_id: device.user_id,
    macAddress: device.mac_address,
    mac_address: device.mac_address,
    deviceName: device.device_name || device.alias || 'Cheeko',
    device_name: device.device_name || device.alias || 'Cheeko',
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
});

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
    const activity = await mobileService.getHomepageActivity(req.firebaseUser.uid);
    success(res, activity);
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
    const device = await deviceService.assignKidByMac(mac, kidId, req.mobileUser.id);
    success(res, formatMobileDevice(device), 'Kid assigned to device');
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

module.exports = router;
