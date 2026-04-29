/**
 * Public Device Onboarding Routes
 *
 * Separate flow backed by ONBOARDING_* Supabase configuration.
 * Base path: /onboarding
 */

const express = require('express');
const Joi = require('joi');
const router = express.Router();
const onboardingService = require('../services/onboarding.service');
const { requireOnboardingAuth } = require('../middleware/onboardingAuth');
const { asyncHandler } = require('../middleware/errorHandler');
const { validate } = require('../middleware/validation');
const { success, badRequest } = require('../utils/response');

const websocketSchema = Joi.string().trim().uri({ scheme: ['ws', 'wss'] }).max(500).required();
const handleOnboardingError = (error, res) => {
  if (error.statusCode) throw error;
  return badRequest(res, error.message);
};

router.post('/register',
  validate({
    body: Joi.object({
      username: Joi.string().trim().min(3).max(100).required(),
      password: Joi.string().min(6).max(100).required(),
      email: Joi.string().trim().email().allow(null, '')
    })
  }),
  asyncHandler(async (req, res) => {
    try {
      const user = await onboardingService.register(req.body);
      success(res, user, 'Registration successful');
    } catch (error) {
      handleOnboardingError(error, res);
    }
  })
);

router.post('/login',
  validate({
    body: Joi.object({
      username: Joi.string().trim().min(1).max(100).required(),
      password: Joi.string().min(1).max(100).required()
    })
  }),
  asyncHandler(async (req, res) => {
    try {
      const result = await onboardingService.login(req.body);
      success(res, result, 'Login successful');
    } catch (error) {
      handleOnboardingError(error, res);
    }
  })
);

router.get('/me',
  requireOnboardingAuth,
  asyncHandler(async (req, res) => {
    success(res, req.onboardingUser);
  })
);

router.post('/bind-device',
  requireOnboardingAuth,
  validate({
    body: Joi.object({
      activationCode: Joi.string().trim().pattern(/^\d{6}$/).required()
    })
  }),
  asyncHandler(async (req, res) => {
    try {
      const device = await onboardingService.bindDevice({
        userId: req.onboardingUser.id,
        activationCode: req.body.activationCode
      });
      success(res, device, 'Device bound successfully');
    } catch (error) {
      handleOnboardingError(error, res);
    }
  })
);

router.put('/devices/:deviceId/websocket',
  requireOnboardingAuth,
  validate({
    params: Joi.object({
      deviceId: Joi.string().uuid().required()
    }),
    body: Joi.object({
      websocketUrl: websocketSchema
    })
  }),
  asyncHandler(async (req, res) => {
    try {
      const result = await onboardingService.saveDeviceWebsocket({
        userId: req.onboardingUser.id,
        deviceId: req.params.deviceId,
        websocketUrl: req.body.websocketUrl
      });
      success(res, result, 'WebSocket address saved');
    } catch (error) {
      handleOnboardingError(error, res);
    }
  })
);

module.exports = router;
