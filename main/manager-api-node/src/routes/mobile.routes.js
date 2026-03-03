const express = require('express');
const router = express.Router();
const asyncHandler = require('express-async-handler');
const { requireFirebaseAuth } = require('../middleware/firebaseAuth');
const mobileService = require('../services/mobile.service');
const agentService = require('../services/agent.service');
const deviceService = require('../services/device.service');
const { success } = require('../utils/response');

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

// Mock FCM token endpoints (since token is usually handled locally or via push service)
router.put('/parent-profile/fcm-token', asyncHandler(async (req, res) => {
    res.json({ success: true, message: 'FCM token recorded' });
}));

router.delete('/parent-profile/fcm-token', asyncHandler(async (req, res) => {
    res.json({ success: true, message: 'FCM token cleared' });
}));

// ─── User State ─────────────────────────────────────────────────────────────

router.get('/user-state', asyncHandler(async (req, res) => {
    const state = await mobileService.getUserState(req.firebaseUser.uid);
    if (!state) return res.status(404).json({ error: 'User state not found' });
    res.json(state);
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
    success(res, devices);
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

// ─── Activation ──────────────────────────────────────────────────────────────

// Activation code check is best-effort (codes live in device service in-memory cache)
// Returns null if not found — Flutter handles this gracefully
router.get('/activation/check-code', asyncHandler(async (req, res) => {
    success(res, null);
}));

module.exports = router;
