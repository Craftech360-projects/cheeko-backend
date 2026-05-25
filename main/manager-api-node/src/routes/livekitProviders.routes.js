const express = require('express');
const router = express.Router();

const { requireAdmin } = require('../middleware/auth');
const { asyncHandler } = require('../middleware/errorHandler');
const { success, badRequest } = require('../utils/response');
const livekitProvidersService = require('../services/livekitProviders.service');

router.get('/providers/active',
  requireAdmin,
  asyncHandler(async (req, res) => {
    const data = await livekitProvidersService.getActiveProviders();
    success(res, data);
  })
);

router.put('/providers/active/llm',
  requireAdmin,
  asyncHandler(async (req, res) => {
    try {
      await livekitProvidersService.setActiveLLMProvider(req.body || {});
      const data = await livekitProvidersService.getActiveProviders();
      success(res, data, 'LLM provider updated');
    } catch (error) {
      badRequest(res, error.message);
    }
  })
);

router.put('/providers/active/stt',
  requireAdmin,
  asyncHandler(async (req, res) => {
    try {
      await livekitProvidersService.setActiveSTTProvider(req.body || {});
      const data = await livekitProvidersService.getActiveProviders();
      success(res, data, 'STT provider updated');
    } catch (error) {
      badRequest(res, error.message);
    }
  })
);

router.put('/providers/active/tts',
  requireAdmin,
  asyncHandler(async (req, res) => {
    try {
      await livekitProvidersService.setActiveTTSProvider(req.body || {});
      const data = await livekitProvidersService.getActiveProviders();
      success(res, data, 'TTS provider updated');
    } catch (error) {
      badRequest(res, error.message);
    }
  })
);

module.exports = router;
