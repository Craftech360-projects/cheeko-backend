/**
 * OTA Management Routes (/otaMag)
 *
 * Admin endpoints for firmware management:
 * - GET /otaMag - Paginated firmware query
 * - GET /otaMag/:id - Get firmware info by ID
 * - POST /otaMag - Save/create firmware info
 * - PUT /otaMag/:id - Update firmware info
 * - DELETE /otaMag/:id - Delete firmware
 * - PUT /otaMag/forceUpdate/:id - Set firmware force update
 * - GET /otaMag/getDownloadUrl/:id - Get firmware download link
 * - GET /otaMag/download/:uuid - Download firmware file
 * - POST /otaMag/upload - Upload firmware file
 *
 * Base path: /otaMag
 */

const express = require('express');
const router = express.Router();
const multer = require('multer');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const deviceService = require('../services/device.service');
const { asyncHandler } = require('../middleware/errorHandler');
const { requireAuth, requireAdmin } = require('../middleware/auth');
const { success, error: errorResponse, notFound } = require('../utils/response');
const logger = require('../utils/logger');

// In-memory cache for OTA download URLs (simulates Redis)
// Format: { uuid: { id: firmwareId, downloadCount: number, createdAt: timestamp } }
const otaDownloadCache = new Map();

// Cleanup expired cache entries (5 minute expiry)
setInterval(() => {
  const now = Date.now();
  for (const [key, value] of otaDownloadCache.entries()) {
    if (now - value.createdAt > 5 * 60 * 1000) {
      otaDownloadCache.delete(key);
    }
  }
}, 60000);

/**
 * Transform snake_case firmware to camelCase for Spring Boot compatibility
 */
const transformFirmwareToCamelCase = (firmware) => {
  if (!firmware) return null;
  return {
    id: firmware.id,
    firmwareName: firmware.firmware_name,
    type: firmware.type,
    version: firmware.version,
    size: firmware.size,
    remark: firmware.remark,
    firmwarePath: firmware.firmware_path,
    forceUpdate: firmware.force_update,
    sort: firmware.sort,
    creator: firmware.creator,
    createDate: firmware.create_date,
    updater: firmware.updater,
    updateDate: firmware.update_date
  };
};

// Configure multer for firmware uploads
const UPLOAD_DIR = process.env.FIRMWARE_UPLOAD_DIR || path.join(__dirname, '../../uploadfile');

// Ensure upload directory exists
if (!fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

// Use memory storage first to calculate MD5, then write to disk
const memStorage = multer.memoryStorage();

const upload = multer({
  storage: memStorage,
  limits: {
    fileSize: 50 * 1024 * 1024 // 50MB limit
  },
  fileFilter: (req, file, cb) => {
    // Accept .bin and .apk files (matching Spring Boot)
    const allowedExts = ['.bin', '.apk'];
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowedExts.includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error('Only .bin and .apk format files are allowed'));
    }
  }
});

/**
 * @swagger
 * tags:
 *   - name: OTA Management
 *     description: Firmware management endpoints (Admin only)
 */

/**
 * @swagger
 * components:
 *   schemas:
 *     OtaEntity:
 *       type: object
 *       properties:
 *         id:
 *           type: string
 *           description: Firmware UUID
 *         firmwareName:
 *           type: string
 *           description: Firmware display name
 *         type:
 *           type: string
 *           description: Board type (esp32, esp32s3, esp32c3)
 *         version:
 *           type: string
 *           description: Firmware version
 *         size:
 *           type: integer
 *           description: File size in bytes
 *         remark:
 *           type: string
 *           description: Notes about this firmware
 *         firmwarePath:
 *           type: string
 *           description: Path or URL to firmware file
 *         forceUpdate:
 *           type: integer
 *           enum: [0, 1]
 *           description: Force update flag (0=no, 1=yes)
 *         createDate:
 *           type: string
 *           format: date-time
 *         updateDate:
 *           type: string
 *           format: date-time
 */

// =============================================
// SPECIFIC ROUTES MUST BE DEFINED BEFORE /:id
// =============================================

/**
 * @swagger
 * /otaMag/forceUpdate/{id}:
 *   put:
 *     tags: [OTA Management]
 *     summary: Set firmware force update
 *     description: Enable or disable force update for a firmware (admin only)
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Firmware UUID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - forceUpdate
 *               - type
 *             properties:
 *               forceUpdate:
 *                 type: integer
 *                 enum: [0, 1]
 *                 description: 0=disable, 1=enable
 *               type:
 *                 type: string
 *                 description: Firmware type
 *     responses:
 *       200:
 *         description: Force update flag set successfully
 *       400:
 *         description: Parameters incomplete
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Admin access required
 */
router.put('/forceUpdate/:id',
  requireAuth,
  requireAdmin,
  asyncHandler(async (req, res) => {
    const { forceUpdate, type } = req.body;

    // Match Spring Boot validation
    if (forceUpdate === undefined || type === undefined) {
      return errorResponse(res, 'Parameters incomplete');
    }

    try {
      await deviceService.setForceUpdate(req.params.id, forceUpdate);
      // Return null data (Result<Void>) matching Spring Boot
      success(res, null);
    } catch (error) {
      errorResponse(res, error.message);
    }
  })
);

/**
 * @swagger
 * /otaMag/getDownloadUrl/{id}:
 *   get:
 *     tags: [OTA Management]
 *     summary: Get OTA firmware download link
 *     description: Generates a temporary download URL with UUID (admin only)
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Firmware UUID
 *     responses:
 *       200:
 *         description: Download UUID
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 code:
 *                   type: integer
 *                 data:
 *                   type: string
 *                   description: UUID for download endpoint
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Admin access required
 */
router.get('/getDownloadUrl/:id',
  requireAuth,
  requireAdmin,
  asyncHandler(async (req, res) => {
    const { id } = req.params;

    // Generate UUID and store mapping (like Spring Boot's Redis key)
    const uuid = uuidv4();
    otaDownloadCache.set(uuid, {
      id,
      downloadCount: 0,
      createdAt: Date.now()
    });

    // Return just the UUID string (matching Spring Boot)
    success(res, uuid);
  })
);

/**
 * @swagger
 * /otaMag/download/{uuid}:
 *   get:
 *     tags: [OTA Management]
 *     summary: Download firmware file
 *     description: Download a firmware file by UUID. Public endpoint for device OTA updates.
 *     parameters:
 *       - in: path
 *         name: uuid
 *         required: true
 *         schema:
 *           type: string
 *         description: Download UUID from getDownloadUrl
 *     responses:
 *       200:
 *         description: Firmware binary file
 *         content:
 *           application/octet-stream:
 *             schema:
 *               type: string
 *               format: binary
 *       404:
 *         description: Firmware file not found
 */
router.get('/download/:uuid',
  asyncHandler(async (req, res) => {
    const { uuid } = req.params;

    // Look up firmware ID from cache
    const cacheEntry = otaDownloadCache.get(uuid);
    let firmwareId;
    if (!cacheEntry) {
      // Backward compatibility: OTA check currently returns firmware ID directly,
      // while this endpoint originally expects a cached UUID token.
      firmwareId = uuid;
      logger.warn(`OTA download cache miss for key=${uuid}; falling back to direct firmware id lookup`);
    } else {
      // Check download count (max 3 times like Spring Boot)
      if (cacheEntry.downloadCount >= 3) {
        otaDownloadCache.delete(uuid);
        return res.status(404).send();
      }

      // Increment download count
      cacheEntry.downloadCount++;
      firmwareId = cacheEntry.id;
    }

    try {
      // Get firmware information
      const firmware = await deviceService.getFirmwareById(firmwareId);
      logger.info(`Download firmware lookup: id=${firmwareId}, firmware=${JSON.stringify(firmware)}`);
      if (!firmware) {
        logger.error(`Firmware not found in database: ${firmwareId}`);
        return res.status(404).send();
      }
      if (!firmware.firmware_path) {
        logger.error(`Firmware has no firmware_path: id=${firmwareId}, record=${JSON.stringify(firmware)}`);
        return res.status(404).send();
      }

      // Get file path
      let filePath;
      const firmwarePath = firmware.firmware_path;

      if (path.isAbsolute(firmwarePath)) {
        filePath = firmwarePath;
      } else {
        // Try relative to UPLOAD_DIR first (matches upload logic)
        const fileName = path.basename(firmwarePath);
        filePath = path.join(UPLOAD_DIR, fileName);
      }

      if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
        // Fallback: try the stored path relative to cwd
        const altPath = path.join(process.cwd(), firmwarePath);

        if (fs.existsSync(altPath) && fs.statSync(altPath).isFile()) {
          filePath = altPath;
        } else {
          logger.error('Firmware file not found:', firmwarePath, 'Tried:', filePath, 'and', altPath);
          return res.status(404).send();
        }
      }

      // Read file content
      const fileContent = fs.readFileSync(filePath);

      // Set response headers
      let originalFilename = firmware.type + '_' + firmware.version;
      if (firmwarePath.includes('.')) {
        const extension = firmwarePath.substring(firmwarePath.lastIndexOf('.'));
        originalFilename += extension;
      }

      const safeFilename = originalFilename.replace(/[^a-zA-Z0-9._-]/g, '_');

      res.setHeader('Content-Type', 'application/octet-stream');
      res.setHeader('Content-Disposition', `attachment; filename="${safeFilename}"`);
      res.send(fileContent);
    } catch (error) {
      logger.error('Failed to read firmware file', error);
      return res.status(500).send();
    }
  })
);

/**
 * @swagger
 * /otaMag/upload:
 *   post:
 *     tags: [OTA Management]
 *     summary: Upload firmware file
 *     description: Upload a firmware binary file (admin only). Uses MD5 as filename.
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             required:
 *               - file
 *             properties:
 *               file:
 *                 type: string
 *                 format: binary
 *                 description: Firmware file (.bin, .apk)
 *     responses:
 *       200:
 *         description: File path
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 code:
 *                   type: integer
 *                 data:
 *                   type: string
 *                   description: File path
 *       400:
 *         description: Upload error
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Admin access required
 */
router.post('/upload',
  requireAuth,
  requireAdmin,
  upload.single('file'),
  asyncHandler(async (req, res) => {
    if (!req.file) {
      return errorResponse(res, 'UploadFileCannot beEmpty');
    }

    const originalFilename = req.file.originalname;
    if (!originalFilename) {
      return errorResponse(res, 'FileNameCannot beEmpty');
    }

    const extension = path.extname(originalFilename).toLowerCase();

    // Calculate MD5 hash of file content
    const md5 = crypto.createHash('md5').update(req.file.buffer).digest('hex');

    // Use MD5 as filename with original extension
    const uniqueFileName = md5 + extension;
    const filePath = path.join(UPLOAD_DIR, uniqueFileName);

    // Check if file already exists
    if (fs.existsSync(filePath)) {
      // Return existing file path (matching Spring Boot)
      return success(res, `uploadfile/${uniqueFileName}`);
    }

    // Save file
    fs.writeFileSync(filePath, req.file.buffer);

    logger.info('Firmware uploaded:', {
      filename: uniqueFileName,
      originalName: originalFilename,
      size: req.file.size
    });

    // Return file path (matching Spring Boot)
    success(res, `uploadfile/${uniqueFileName}`);
  })
);

// =============================================
// GENERIC ROUTES (AFTER SPECIFIC ROUTES)
// =============================================

/**
 * @swagger
 * /otaMag:
 *   get:
 *     tags: [OTA Management]
 *     summary: Pagination query OTA firmware information
 *     description: Returns a paginated list of firmware entries (admin only)
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           default: 1
 *         description: Page number
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 10
 *         description: Items per page
 *       - in: query
 *         name: type
 *         schema:
 *           type: string
 *         description: Filter by board type
 *     responses:
 *       200:
 *         description: Paginated firmware list
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Admin access required
 */
router.get('/',
  requireAuth,
  requireAdmin,
  asyncHandler(async (req, res) => {
    const { page, limit, type } = req.query;
    const result = await deviceService.listFirmware({
      page: parseInt(page) || 1,
      limit: parseInt(limit) || 10,
      type
    });
    // Transform to camelCase for Spring Boot compatibility
    success(res, {
      ...result,
      list: (result.list || []).map(transformFirmwareToCamelCase)
    });
  })
);

/**
 * @swagger
 * /otaMag:
 *   post:
 *     tags: [OTA Management]
 *     summary: Save OTA firmware information
 *     description: Create a new firmware entry (admin only)
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/OtaEntity'
 *     responses:
 *       200:
 *         description: Success (Result<Void>)
 *       400:
 *         description: Validation error
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Admin access required
 */
router.post('/',
  requireAuth,
  requireAdmin,
  asyncHandler(async (req, res) => {
    const entity = req.body;

    // Match Spring Boot validation exactly
    if (!entity) {
      return errorResponse(res, 'FirmwareInformationCannot beEmpty');
    }
    if (!entity.firmwareName) {
      return errorResponse(res, 'FirmwareNameCannot beEmpty');
    }
    if (!entity.type) {
      return errorResponse(res, 'FirmwareTypeCannot beEmpty');
    }
    if (!entity.version) {
      return errorResponse(res, 'Version number cannot be empty');
    }

    try {
      logger.info('Creating firmware with data:', {
        firmwareName: entity.firmwareName,
        type: entity.type,
        version: entity.version,
        firmwarePath: entity.firmwarePath
      });
      await deviceService.createFirmware({
        firmwareName: entity.firmwareName,
        type: entity.type,
        version: entity.version,
        size: entity.size,
        remark: entity.remark,
        firmwarePath: entity.firmwarePath,
        forceUpdate: entity.forceUpdate || 0
      });
      // Return null data (Result<Void>) matching Spring Boot
      success(res, null);
    } catch (error) {
      errorResponse(res, error.message);
    }
  })
);

/**
 * @swagger
 * /otaMag/{id}:
 *   get:
 *     tags: [OTA Management]
 *     summary: Get OTA firmware information by ID
 *     description: Retrieve firmware info by ID (admin only)
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Firmware UUID
 *     responses:
 *       200:
 *         description: Firmware details
 *       404:
 *         description: Firmware not found
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Admin access required
 */
router.get('/:id',
  requireAuth,
  requireAdmin,
  asyncHandler(async (req, res) => {
    const firmware = await deviceService.getFirmwareById(req.params.id);
    if (!firmware) {
      return notFound(res, 'Firmware not found');
    }
    // Transform to camelCase for Spring Boot compatibility
    success(res, transformFirmwareToCamelCase(firmware));
  })
);

/**
 * @swagger
 * /otaMag/{id}:
 *   put:
 *     tags: [OTA Management]
 *     summary: Update OTA firmware information
 *     description: Update an existing firmware entry (admin only)
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Firmware UUID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/OtaEntity'
 *     responses:
 *       200:
 *         description: Success (Result<Void>)
 *       400:
 *         description: Validation error
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Admin access required
 */
router.put('/:id',
  requireAuth,
  requireAdmin,
  asyncHandler(async (req, res) => {
    const entity = req.body;

    // Match Spring Boot validation
    if (!entity) {
      return errorResponse(res, 'FirmwareInformationCannot beEmpty');
    }

    try {
      await deviceService.updateFirmware(req.params.id, {
        firmwareName: entity.firmwareName,
        type: entity.type,
        version: entity.version,
        size: entity.size,
        remark: entity.remark,
        firmwarePath: entity.firmwarePath,
        forceUpdate: entity.forceUpdate
      });
      // Return null data (Result<Void>) matching Spring Boot
      success(res, null);
    } catch (error) {
      errorResponse(res, error.message);
    }
  })
);

/**
 * @swagger
 * /otaMag/{id}:
 *   delete:
 *     tags: [OTA Management]
 *     summary: OTA Delete
 *     description: Delete firmware entry by ID (admin only). Supports multiple IDs.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Firmware UUID(s) - can be comma-separated
 *     responses:
 *       200:
 *         description: Success (Result<Void>)
 *       400:
 *         description: Error deleting firmware
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Admin access required
 */
router.delete('/:id',
  requireAuth,
  requireAdmin,
  asyncHandler(async (req, res) => {
    const ids = req.params.id.split(',');

    // Match Spring Boot validation
    if (!ids || ids.length === 0) {
      return errorResponse(res, 'Deletes FirmwareIDCannot beEmpty');
    }

    try {
      // Optionally delete firmware files
      for (const id of ids) {
        const firmware = await deviceService.getFirmwareById(id.trim());
        if (firmware && firmware.firmware_path) {
          const filePath = path.join(UPLOAD_DIR, path.basename(firmware.firmware_path));
          if (fs.existsSync(filePath)) {
            fs.unlinkSync(filePath);
            logger.info('Deleted firmware file:', filePath);
          }
        }
      }

      // Delete from database
      await deviceService.deleteFirmware(ids.map(id => id.trim()));

      // Return null data (Result<Void>) matching Spring Boot
      success(res, null);
    } catch (error) {
      errorResponse(res, error.message);
    }
  })
);

// Error handler for multer
router.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return errorResponse(res, 'File too large. Maximum size is 50MB');
    }
    return errorResponse(res, err.message);
  }
  if (err.message && err.message.includes('.bin and .apk')) {
    return errorResponse(res, err.message);
  }
  next(err);
});

module.exports = router;
