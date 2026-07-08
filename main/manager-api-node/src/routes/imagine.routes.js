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
  return success(res, result);
}));

module.exports = router;
