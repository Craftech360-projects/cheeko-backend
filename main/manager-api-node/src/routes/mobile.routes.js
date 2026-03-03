const express = require('express');
const router = express.Router();
const asyncHandler = require('express-async-handler');
const { requireFirebaseAuth } = require('../middleware/firebaseAuth');
const mobileService = require('../services/mobile.service');

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

module.exports = router;
