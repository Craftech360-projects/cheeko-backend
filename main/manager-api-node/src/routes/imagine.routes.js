/**
 * Imagine Routes
 *
 * Internal endpoint for AI-generated JPEG upload from mqtt-gateway.
 * Base path: /imagine
 */

const express = require('express');
const multer = require('multer');
const { requireServiceKey } = require('../middleware/auth');
const { asyncHandler } = require('../middleware/errorHandler');
const { success, badRequest } = require('../utils/response');
const uploadService = require('../services/upload.service');
const subscriptionService = require('../services/subscription.service');
const logger = require('../utils/logger');

const router = express.Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 200 * 1024 }, // 200 KB
  fileFilter: (req, file, cb) => {
    if (file.mimetype === 'image/jpeg') return cb(null, true);
    cb(new Error('Only JPEG images are allowed'));
  },
});

// Wrap multer so size/mime errors become deterministic 400s instead of bubbling.
const uploadJpeg = (req, res, next) => upload.single('file')(req, res, (err) => {
  if (err) return badRequest(res, err.message);
  next();
});

router.post('/upload', requireServiceKey, uploadJpeg, asyncHandler(async (req, res) => {
  if (!req.file) return badRequest(res, 'No file uploaded');
  const result = await uploadService.uploadImagineImage(req.file.buffer, req.body.deviceMac);
  // Count the image against the device's buckets (SUB-3). The image already
  // exists and the toy is waiting for it — a failed count must not fail delivery.
  try {
    await subscriptionService.recordImageGeneration(req.body.deviceMac);
  } catch (error) {
    logger.error(`[IMAGINE] Image generated but not counted for ${req.body.deviceMac}: ${error.message}`);
  }
  return success(res, result);
}));

module.exports = router;
