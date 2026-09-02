const express = require('express');
const router = express.Router();
const asyncHandler = require('express-async-handler');
const multer = require('multer');
const { requireFirebaseAuth } = require('../middleware/firebaseAuth');
const mobileService = require('../services/mobile.service');
const agentService = require('../services/agent.service');
const deviceService = require('../services/device.service');
const deviceSettingsService = require('../services/deviceSettings.service');
const deviceAnalyticsService = require('../services/deviceAnalytics.service');
const uploadService = require('../services/upload.service');
const customCardService = require('../services/customCard.service');
const idempotencyService = require('../services/idempotency.service');
const { success, badRequest } = require('../utils/response');
const { ApiError } = require('../middleware/errorHandler');
const logger = require('../utils/logger');
const { prisma } = require('../config/database');

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

// Custom card audio and artwork. The 10 MB ceiling mirrors the client-side check
// for a recording; a picture's own 5 MB ceiling is enforced in the service,
// because multer's limit is per-request and cannot differ by field. The real
// enforcement (extension + sniffed magic bytes + size) lives in
// customCard.service so a forged Content-Type cannot get past it. multer's limit
// only exists to stop us buffering an oversized body in memory, and its error is
// remapped to a 400 with a readable sentence rather than the default
// 500/LIMIT_FILE_SIZE.
//
// The filter is a cheap first pass, not the control, which is why
// application/octet-stream is on the list: Flutter sends it for any part built
// from bytes, and rejecting it would turn away perfectly good uploads. Magic
// bytes decide in the service.
const CUSTOM_CARD_MIMES = [
    'audio/mpeg', 'audio/mp3', 'audio/wav', 'audio/x-wav', 'audio/wave',
    'image/png', 'image/jpeg', 'image/jpg',
    'application/octet-stream',
];

const customCardUpload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 10 * 1024 * 1024 },
    fileFilter: (_req, file, cb) => {
        if (CUSTOM_CARD_MIMES.includes((file.mimetype || '').toLowerCase())) {
            cb(null, true);
        } else {
            cb(new ApiError('Only MP3 or WAV recordings and PNG or JPEG pictures can be uploaded.', 400));
        }
    },
});

// image_1..image_10 pair with the files parts by field-name index, `image` with
// the single-file `file` part. Built once so POST and the service agree on the
// field names.
const CUSTOM_CARD_IMAGE_FIELDS = [
    ...Array.from({ length: customCardService.MAX_ITEMS }, (_, i) => ({ name: `image_${i + 1}`, maxCount: 1 })),
    { name: 'image', maxCount: 1 },
];

// The edit endpoint's parts. `audio` is what the spec names; `file` and `files`
// are accepted alongside it because that is what every other custom-card route
// calls the recording, and multer answers an unexpected field name with a
// message no parent can act on.
const CUSTOM_CARD_PATCH_FIELDS = [
    { name: 'audio', maxCount: 1 },
    { name: 'file', maxCount: 1 },
    { name: 'files', maxCount: 1 },
    { name: 'image', maxCount: 1 },
];

const isTruthyField = (value) => ['true', '1', 'yes'].includes(String(value ?? '').trim().toLowerCase());

/**
 * Replay a retried write instead of performing it twice.
 *
 * Opt-in: a request with no `Idempotency-Key` passes straight through, which is
 * what keeps every shipped build working. The response is captured by wrapping
 * res.json, so the handler below needs no knowledge of any of this; only a 2xx
 * is remembered, because a failure has to stay retryable.
 *
 * @param {(req) => string} scopeFor - namespaces the key to one parent and one
 *   target, so a guessed key can only replay the caller's own response
 */
const withIdempotency = (scopeFor) => asyncHandler(async (req, res, next) => {
    const key = req.get('Idempotency-Key');
    if (!key) return next();

    const scope = scopeFor(req);
    const claim = await idempotencyService.begin(scope, key);

    if (claim.replay) {
        return res.status(claim.replay.statusCode).json(claim.replay.body);
    }
    if (claim.inFlight) {
        return res.status(409).json({
            code: 409,
            msg: 'That change is still being saved. Please wait a moment and try again.',
            data: null,
        });
    }
    if (claim.commit) {
        const sendJson = res.json.bind(res);
        res.json = (body) => {
            const done = res.statusCode >= 200 && res.statusCode < 300
                ? claim.commit(res.statusCode, body)
                : claim.release();
            done.catch(() => {});
            return sendJson(body);
        };
    }
    return next();
});

const handleUploadErrors = (uploadMiddleware) => (req, res, next) => {
    uploadMiddleware(req, res, (err) => {
        if (!err) return next();
        if (err instanceof multer.MulterError) {
            const msg = err.code === 'LIMIT_FILE_SIZE'
                ? 'That recording is larger than 10 MB. Please choose a shorter one.'
                : 'That file could not be uploaded. Please try again.';
            return res.status(400).json({ code: 400, msg, data: null });
        }
        return next(err);
    });
};

// The stored URL is <publicBase>/<key>; strip scheme + host to recover the key.
// deleteCustomCardObject ignores anything outside the customcard prefix, so a
// pack that somehow referenced catalogue audio cannot delete it from here.
const sweepCustomCardUrls = async (urls = []) => {
    for (const url of urls) {
        await uploadService.deleteCustomCardObject(String(url).split('/').slice(3).join('/'));
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

router.get('/progress/quiz', asyncHandler(async (req, res) => {
    const analytics = await mobileService.getQuizAnalytics(req.firebaseUser.uid, req.query);
    success(res, analytics);
}));

// The home-screen quiz card. Note the path: the shipped app calls
// /quiz/progress, not /progress/quiz, and swallows a 404 as "no data" — so
// until this route existed the card silently rendered its empty state.
router.get('/quiz/progress', asyncHandler(async (req, res) => {
    const progress = await mobileService.getQuizCharacterProgress(req.firebaseUser.uid, req.query);
    success(res, progress);
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

// ?mac=<address> narrows this to the child paired to that toy, for screens
// opened from a device. Without it, every child, active-toy first.
router.get('/kids', asyncHandler(async (req, res) => {
    const kids = await mobileService.getKids(req.firebaseUser.uid, req.query);
    res.json(kids);
}));

router.post('/kids', asyncHandler(async (req, res) => {
    const kid = await mobileService.createKid(req.firebaseUser.uid, req.body);
    res.status(201).json(kid);
}));

router.put('/kids/:id', asyncHandler(async (req, res) => {
    const kid = await mobileService.updateKid(req.firebaseUser.uid, req.params.id, req.body);
    res.json(kid);
}));

router.delete('/kids/:id', asyncHandler(async (req, res) => {
    const deleted = await mobileService.deleteKid(req.firebaseUser.uid, req.params.id);
    // Storage is swept only after the delete has committed, so a failed
    // transaction can never leave rows pointing at objects that are gone.
    await uploadService.deleteKidAvatarByUrl(deleted.avatar_url);
    await sweepCustomCardUrls(deleted.retired);
    success(res, null, 'Kid profile deleted');
}));

router.post('/kids/:id/avatar', kidAvatarUpload.single('file'), asyncHandler(async (req, res) => {
    if (!req.file) {
        return badRequest(res, 'No file uploaded');
    }

    // updateKid() does not scope by owner, so verify the kid belongs to this parent first
    const ownedKids = await mobileService.getKids(req.firebaseUser.uid);
    const existingKid = ownedKids.find((k) => String(k.id) === String(req.params.id));
    if (!existingKid) {
        return res.status(404).json({ code: 404, msg: 'Kid profile not found', data: null });
    }

    const uploadResult = await uploadService.uploadKidAvatar(
        req.file.buffer,
        req.params.id,
        req.file.mimetype
    );

    const kid = await mobileService.updateKid(req.firebaseUser.uid, req.params.id, { avatar_url: uploadResult.url });

    // Only after the profile points at the new image, so a failed update never orphans the kid
    await uploadService.deleteKidAvatarByUrl(existingKid.avatar_url);

    success(res, { avatarUrl: uploadResult.url, kid });
}));

// ─── Custom Card ────────────────────────────────────────────────────────────

// Custom content belongs to a child, not to a toy or to a particular card: any
// issued custom card tapped on the toy that child is paired to plays this pack,
// and it follows them to a new toy. Always 200 — a null contentPack means
// "nothing recorded yet", which is a normal state, not an error.
// The ETag is a hash of the body, not the pack version: `deviceMac` and
// `kidName` change without a card write (pairing a toy bumps nothing), and a
// version-keyed 304 kept answering "no toy paired" until the next edit. The
// version is still what `If-Match` fences a PATCH with — it is in the body.
router.get('/kids/:kidId/custom-card', asyncHandler(async (req, res) => {
    const card = await customCardService.getCustomCardForKid(req.mobileUser.id, req.params.kidId);
    const etag = customCardService.cardETag(card);

    res.set('ETag', `"${etag}"`);
    const offered = String(req.get('If-None-Match') || '')
        .split(',')
        .map((tag) => customCardService.parseIfMatch(tag))
        .filter(Boolean);
    if (offered.some((tag) => tag === '*' || tag === etag)) {
        return res.status(304).end();
    }

    success(res, card);
}));

// Adds recordings to the child's pack, creating it on first upload. Appends up
// to MAX_ITEMS so a parent can build the card up over several sessions.
// Accepts either `files` (up to 10) or a single `file`, so the shipped app's
// one-file-per-upload call keeps working unchanged. Each recording may carry one
// picture: `image_N` for the Nth `files` part, `image` for `file`.
router.post('/kids/:kidId/custom-card/content',
    handleUploadErrors(customCardUpload.fields([
        { name: 'files', maxCount: customCardService.MAX_ITEMS },
        { name: 'file', maxCount: 1 },
        ...CUSTOM_CARD_IMAGE_FIELDS,
    ])),
    withIdempotency((req) => `${req.mobileUser.id}:add-content:${req.params.kidId}`),
    asyncHandler(async (req, res) => {
        const { uploads, images } = customCardService.pairCustomCardUploads(req.files);
        if (uploads.length === 0) {
            return badRequest(res, 'Please choose a recording to upload.');
        }

        // The path segment is authoritative; a repeated kid field must agree with
        // it so a mismatched body cannot write to another child's card.
        const bodyKidId = req.body?.kidId || req.body?.kid_id;
        if (bodyKidId && String(bodyKidId) !== String(req.params.kidId)) {
            return badRequest(res, 'The child in the request does not match the one being updated.');
        }

        const card = await customCardService.addCustomCardContent(
            req.mobileUser.id,
            req.params.kidId,
            uploads,
            { title: req.body?.title, images }
        );

        res.status(201).json({ code: 0, msg: 'success', data: card });
    })
);

// Edits one recording: picture, title and audio, in a single atomic request.
//
// PATCH rather than PUT because every part is optional — this is a partial
// update of a row, not a replacement of it. What separates it from the three
// legacy routes below is that the row keeps its id and its number (nothing is
// deleted and reinserted), the whole thing lands or none of it does, and a
// caller may fence its write with `If-Match`.
//
// The legacy routes are not deprecated by this and never will be: shipped app
// builds and the manager dashboard both still call them.
router.patch('/kids/:kidId/custom-card/content/:itemNumber',
    handleUploadErrors(customCardUpload.fields(CUSTOM_CARD_PATCH_FIELDS)),
    withIdempotency((req) => `${req.mobileUser.id}:patch-item:${req.params.kidId}:${req.params.itemNumber}`),
    asyncHandler(async (req, res) => {
        const card = await customCardService.patchCustomCardItem(
            req.mobileUser.id,
            req.params.kidId,
            req.params.itemNumber,
            {
                title: req.body?.title,
                audioFile: (req.files?.audio || req.files?.file || req.files?.files || [])[0] || null,
                imageFile: (req.files?.image || [])[0] || null,
                clearImage: isTruthyField(req.body?.clearImage),
                // Absent means an unconditional write. That is required rather
                // than tolerated: no legacy caller sends the header.
                ifMatch: customCardService.parseIfMatch(req.get('If-Match')),
            }
        );

        const version = card.contentPack?.version ?? null;
        if (version !== null) {
            res.set('ETag', `"${version}"`);
        }
        success(res, card);
    })
);

// Swaps the audio at one position. Unlike delete + re-add, the item keeps its
// number, so the card does not reorder under the parent. A picture may ride
// along; sending one alone belongs on the dedicated route below, because this
// endpoint's meaning is "replace the recording".
router.put('/kids/:kidId/custom-card/content/:itemNumber',
    handleUploadErrors(customCardUpload.fields([
        { name: 'file', maxCount: 1 },
        { name: 'files', maxCount: 1 },
        { name: 'image', maxCount: 1 },
    ])),
    asyncHandler(async (req, res) => {
        const upload = (req.files?.file || [])[0] || (req.files?.files || [])[0];
        const image = (req.files?.image || [])[0];
        if (!upload) {
            return badRequest(res, image
                ? 'To change only the picture, use the picture endpoint for this recording.'
                : 'Please choose a recording to upload.');
        }

        const card = await customCardService.replaceCustomCardItem(
            req.mobileUser.id,
            req.params.kidId,
            req.params.itemNumber,
            upload,
            { title: req.body?.title, image }
        );
        success(res, card);
    })
);

// Changes one recording's artwork without re-uploading the recording itself.
router.put('/kids/:kidId/custom-card/content/:itemNumber/image',
    handleUploadErrors(customCardUpload.fields([
        { name: 'image', maxCount: 1 },
    ])),
    asyncHandler(async (req, res) => {
        const image = (req.files?.image || [])[0];
        if (!image) {
            return badRequest(res, 'Please choose a picture to upload.');
        }

        const card = await customCardService.setCustomCardItemImage(
            req.mobileUser.id,
            req.params.kidId,
            req.params.itemNumber,
            image
        );
        success(res, card);
    })
);

// Clears one recording's artwork, keeping the recording. Stays registered ahead
// of the bare /content/:itemNumber delete below, so the more specific path wins.
router.delete('/kids/:kidId/custom-card/content/:itemNumber/image',
    asyncHandler(async (req, res) => {
        const card = await customCardService.clearCustomCardItemImage(
            req.mobileUser.id,
            req.params.kidId,
            req.params.itemNumber
        );
        success(res, card);
    })
);

// Removes one recording and its stored object. Survivors are renumbered, so the
// response is the card the client must rebuild its list from — an itemNumber
// read before this call is stale the moment the response lands.
router.delete('/kids/:kidId/custom-card/content/:itemNumber',
    asyncHandler(async (req, res) => {
        const card = await customCardService.deleteCustomCardItem(
            req.mobileUser.id,
            req.params.kidId,
            req.params.itemNumber
        );
        success(res, card);
    })
);

// ─── RPC Replacements ───────────────────────────────────────────────────────

router.get('/check-email', asyncHandler(async (req, res) => {
    const result = await mobileService.checkEmailExists(req.query.email);
    res.json(result);
}));

router.delete('/account', asyncHandler(async (req, res) => {
    const { retired, avatar_urls: avatarUrls, ...result } =
        await mobileService.deleteUserAccount(req.firebaseUser.uid);
    // Same post-commit ordering as the single-kid delete above. The two URL
    // lists are the sweep's input, not part of the response body — the shape
    // the app parses stays what it was.
    for (const avatarUrl of avatarUrls || []) {
        await uploadService.deleteKidAvatarByUrl(avatarUrl);
    }
    await sweepCustomCardUrls(retired);
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
    const images = await uploadService.listImagineImages(device.mac_address, null, {
        limit: req.query.limit,
        cursor: req.query.cursor,
    });
    success(res, images);
}));

// One child's gallery, wherever the pictures were made. The route above answers
// "what has this toy drawn"; this one answers "what has my child drawn", which
// is the question a parent whose child changed toys is actually asking.
router.get('/kids/:kidId/imagine', asyncHandler(async (req, res) => {
    const kid = await prisma.kid_profile.findFirst({
        where: { id: BigInt(req.params.kidId), user_id: BigInt(req.mobileUser.id) },
        select: { id: true },
    });
    if (!kid) {
        return res.status(404).json({ code: 404, msg: 'Kid not found', data: null });
    }
    const images = await uploadService.listImagineImagesForKid(kid.id, (req.query.date || '').trim() || null, {
        limit: req.query.limit,
        cursor: req.query.cursor,
    });
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
    const { kidId } = req.body || {};
    const device = await deviceService.bindDevice(req.mobileUser.id, req.params.agentId, req.params.deviceCode, kidId);
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

// Remove a toy from the parent's account.
//
// Until this existed, the only removal the mobile API exposed was
// DELETE /agents/:agentId — which deletes the account's shared CHARACTER and, on
// the way, clears the owner, the agent link and the child from every toy attached
// to it. A parent wanting to remove one toy had nothing else to reach for, and
// the app's failed-bind cleanup called it too.
//
// unbindDevice is the operation that was always meant for this. It has been
// correct for a while and simply lived on the wrong side of the wall: it sits in
// device.routes.js behind the manager's JWT session, while the app authenticates
// with Firebase against /api/mobile. This is the same function, reachable by the
// people who need it.
//
// hardDelete is deliberately not forwarded, whatever the client sends. Unbinding
// already clears user_id, which is all the app needs — the toy leaves the
// parent's list either way — while deleting the row would also destroy the
// assignment history and the analytics keyed on the MAC. It stays a super-admin
// tool asking for it on purpose.
router.delete('/devices/:mac', asyncHandler(async (req, res) => {
    try {
        await deviceService.unbindDevice(req.mobileUser.id, req.params.mac, false);
    } catch (error) {
        // The service throws plain Errors, and device.routes.js turns them into a
        // 200-with-code-500 envelope its client expects. Translating here rather
        // than in the service keeps that path byte-identical.
        //
        // An address that is not a valid MAC reaches "not found" rather than a
        // 400, following the decision already made in 761f47ed: from the caller's
        // side there is no difference between a toy that never existed and an
        // address that could not name one.
        if (error.message === 'Device not found') throw new ApiError('Device not found', 404, 404);
        if (error.message.includes('permission')) {
            throw new ApiError('This device belongs to another account', 403, 403);
        }
        throw error;
    }
    success(res, null, 'Device unbound');
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

// The two routes above are account-wide: a character, whoever spoke to it. These
// three are the browse the app actually wants — child, then character, then the
// transcript — and they follow the child rather than the toy.
router.get('/kids/:kidId/characters', asyncHandler(async (req, res) => {
    const characters = await mobileService.getKidCharacters(req.firebaseUser.uid, req.params.kidId, req.query);
    success(res, characters);
}));

router.get('/kids/:kidId/characters/:agentId/sessions', asyncHandler(async (req, res) => {
    const sessions = await mobileService.getKidCharacterSessions(
        req.firebaseUser.uid, req.params.kidId, req.params.agentId, req.query);
    success(res, sessions);
}));

router.get('/kids/:kidId/sessions/:sessionId/messages', asyncHandler(async (req, res) => {
    const messages = await mobileService.getKidSessionMessages(
        req.firebaseUser.uid, req.params.kidId, req.params.sessionId, req.query);
    success(res, messages);
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
