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
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const deviceService = require('../services/device.service');
const { asyncHandler } = require('../middleware/errorHandler');
const { requireAuth, requireSuperAdmin } = require('../middleware/auth');
const { success, badRequest, notFound } = require('../utils/response');
const logger = require('../utils/logger');

// Configure multer for firmware uploads
const UPLOAD_DIR = process.env.FIRMWARE_UPLOAD_DIR || path.join(__dirname, '../../uploads/firmware');

// Ensure upload directory exists
if (!fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, UPLOAD_DIR);
  },
  filename: (req, file, cb) => {
    // Generate unique filename with UUID
    const ext = path.extname(file.originalname);
    const uuid = uuidv4();
    cb(null, `${uuid}${ext}`);
  }
});

const upload = multer({
  storage,
  limits: {
    fileSize: 50 * 1024 * 1024 // 50MB limit
  },
  fileFilter: (req, file, cb) => {
    // Accept .bin files for firmware
    const allowedExts = ['.bin', '.ota', '.hex'];
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowedExts.includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error(`Invalid file type. Allowed: ${allowedExts.join(', ')}`));
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
 *     Firmware:
 *       type: object
 *       properties:
 *         id:
 *           type: string
 *           description: Firmware UUID
 *         firmware_name:
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
 *         firmware_path:
 *           type: string
 *           description: Path or URL to firmware file
 *         force_update:
 *           type: integer
 *           enum: [0, 1]
 *           description: Force update flag (0=no, 1=yes)
 *         create_date:
 *           type: string
 *           format: date-time
 *         update_date:
 *           type: string
 *           format: date-time
 *     FirmwareInput:
 *       type: object
 *       required:
 *         - firmwareName
 *         - type
 *         - version
 *       properties:
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
 *           default: 0
 *           description: Force update flag
 */

/**
 * @swagger
 * /otaMag:
 *   get:
 *     tags: [OTA Management]
 *     summary: List firmware (paginated)
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
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 code:
 *                   type: integer
 *                   example: 0
 *                 msg:
 *                   type: string
 *                 data:
 *                   type: object
 *                   properties:
 *                     list:
 *                       type: array
 *                       items:
 *                         $ref: '#/components/schemas/Firmware'
 *                     total:
 *                       type: integer
 *                     page:
 *                       type: integer
 *                     limit:
 *                       type: integer
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Admin access required
 */
router.get('/',
  requireAuth,
  requireSuperAdmin,
  asyncHandler(async (req, res) => {
    const { page, limit, type } = req.query;
    const result = await deviceService.listFirmware({
      page: parseInt(page) || 1,
      limit: parseInt(limit) || 10,
      type
    });
    success(res, result);
  })
);

/**
 * @swagger
 * /otaMag/{id}:
 *   get:
 *     tags: [OTA Management]
 *     summary: Get firmware by ID
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
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 code:
 *                   type: integer
 *                 data:
 *                   $ref: '#/components/schemas/Firmware'
 *       404:
 *         description: Firmware not found
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Admin access required
 */
router.get('/:id',
  requireAuth,
  requireSuperAdmin,
  asyncHandler(async (req, res) => {
    const firmware = await deviceService.getFirmwareById(req.params.id);
    if (!firmware) {
      return notFound(res, 'Firmware not found');
    }
    success(res, firmware);
  })
);

/**
 * @swagger
 * /otaMag:
 *   post:
 *     tags: [OTA Management]
 *     summary: Create firmware
 *     description: Create a new firmware entry (admin only)
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/FirmwareInput'
 *     responses:
 *       200:
 *         description: Firmware created successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 code:
 *                   type: integer
 *                 msg:
 *                   type: string
 *                 data:
 *                   $ref: '#/components/schemas/Firmware'
 *       400:
 *         description: Validation error
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Admin access required
 */
router.post('/',
  requireAuth,
  requireSuperAdmin,
  asyncHandler(async (req, res) => {
    const { firmwareName, type, version, size, remark, firmwarePath, forceUpdate } = req.body;

    if (!firmwareName || !type || !version) {
      return badRequest(res, 'firmwareName, type, and version are required');
    }

    try {
      const firmware = await deviceService.createFirmware({
        firmwareName,
        type,
        version,
        size,
        remark,
        firmwarePath,
        forceUpdate: forceUpdate || 0
      });
      success(res, firmware, 'Firmware created successfully');
    } catch (error) {
      badRequest(res, error.message);
    }
  })
);

/**
 * @swagger
 * /otaMag/{id}:
 *   put:
 *     tags: [OTA Management]
 *     summary: Update firmware
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
 *             $ref: '#/components/schemas/FirmwareInput'
 *     responses:
 *       200:
 *         description: Firmware updated successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 code:
 *                   type: integer
 *                 msg:
 *                   type: string
 *                 data:
 *                   $ref: '#/components/schemas/Firmware'
 *       400:
 *         description: Validation error
 *       404:
 *         description: Firmware not found
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Admin access required
 *   delete:
 *     tags: [OTA Management]
 *     summary: Delete firmware
 *     description: Delete a firmware entry by ID (admin only)
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
 *         description: Firmware deleted successfully
 *       400:
 *         description: Error deleting firmware
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Admin access required
 */
router.put('/:id',
  requireAuth,
  requireSuperAdmin,
  asyncHandler(async (req, res) => {
    const { firmwareName, type, version, size, remark, firmwarePath, forceUpdate } = req.body;

    try {
      const firmware = await deviceService.updateFirmware(req.params.id, {
        firmwareName,
        type,
        version,
        size,
        remark,
        firmwarePath,
        forceUpdate
      });
      success(res, firmware, 'Firmware updated successfully');
    } catch (error) {
      if (error.message === 'Firmware not found') {
        return notFound(res, error.message);
      }
      badRequest(res, error.message);
    }
  })
);

router.delete('/:id',
  requireAuth,
  requireSuperAdmin,
  asyncHandler(async (req, res) => {
    try {
      // Get firmware to find file path before deletion
      const firmware = await deviceService.getFirmwareById(req.params.id);
      if (!firmware) {
        return notFound(res, 'Firmware not found');
      }

      // Delete from database
      await deviceService.deleteFirmware(req.params.id);

      // Optionally delete the file if it exists locally
      if (firmware.firmware_path) {
        const filePath = path.join(UPLOAD_DIR, path.basename(firmware.firmware_path));
        if (fs.existsSync(filePath)) {
          fs.unlinkSync(filePath);
          logger.info('Deleted firmware file:', filePath);
        }
      }

      success(res, null, 'Firmware deleted successfully');
    } catch (error) {
      badRequest(res, error.message);
    }
  })
);

/**
 * @swagger
 * /otaMag/forceUpdate/{id}:
 *   put:
 *     tags: [OTA Management]
 *     summary: Set force update flag
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
 *             properties:
 *               forceUpdate:
 *                 type: integer
 *                 enum: [0, 1]
 *                 description: 0=disable, 1=enable
 *     responses:
 *       200:
 *         description: Force update flag set successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 code:
 *                   type: integer
 *                 msg:
 *                   type: string
 *                 data:
 *                   $ref: '#/components/schemas/Firmware'
 *       400:
 *         description: Validation error
 *       404:
 *         description: Firmware not found
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Admin access required
 */
router.put('/forceUpdate/:id',
  requireAuth,
  requireSuperAdmin,
  asyncHandler(async (req, res) => {
    const { forceUpdate } = req.body;

    if (forceUpdate === undefined || (forceUpdate !== 0 && forceUpdate !== 1)) {
      return badRequest(res, 'forceUpdate must be 0 or 1');
    }

    try {
      const firmware = await deviceService.setForceUpdate(req.params.id, forceUpdate);
      success(res, firmware, 'Force update flag set successfully');
    } catch (error) {
      if (error.message === 'Firmware not found') {
        return notFound(res, error.message);
      }
      badRequest(res, error.message);
    }
  })
);

/**
 * @swagger
 * /otaMag/getDownloadUrl/{id}:
 *   get:
 *     tags: [OTA Management]
 *     summary: Get firmware download URL
 *     description: Get the download URL for a firmware file (admin only)
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
 *         description: Download URL
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 code:
 *                   type: integer
 *                 data:
 *                   type: object
 *                   properties:
 *                     downloadUrl:
 *                       type: string
 *                     filename:
 *                       type: string
 *                     size:
 *                       type: integer
 *       404:
 *         description: Firmware not found
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Admin access required
 */
router.get('/getDownloadUrl/:id',
  requireAuth,
  requireSuperAdmin,
  asyncHandler(async (req, res) => {
    const firmware = await deviceService.getFirmwareById(req.params.id);
    if (!firmware) {
      return notFound(res, 'Firmware not found');
    }

    if (!firmware.firmware_path) {
      return badRequest(res, 'No firmware file associated with this entry');
    }

    // Generate download URL
    const baseUrl = process.env.BASE_URL || `http://localhost:${process.env.PORT || 8002}`;
    const filename = path.basename(firmware.firmware_path);
    const downloadUrl = `${baseUrl}/toy/otaMag/download/${filename}`;

    success(res, {
      downloadUrl,
      filename: firmware.firmware_name || filename,
      size: firmware.size
    });
  })
);

/**
 * @swagger
 * /otaMag/download/{uuid}:
 *   get:
 *     tags: [OTA Management]
 *     summary: Download firmware file
 *     description: Download a firmware file by UUID/filename. Public endpoint for device OTA updates.
 *     parameters:
 *       - in: path
 *         name: uuid
 *         required: true
 *         schema:
 *           type: string
 *         description: Firmware file UUID or filename
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

    // Sanitize filename to prevent directory traversal
    const sanitizedFilename = path.basename(uuid);
    const filePath = path.join(UPLOAD_DIR, sanitizedFilename);

    // Check if file exists
    if (!fs.existsSync(filePath)) {
      // Try to find in database by ID
      const firmware = await deviceService.getFirmwareById(uuid);
      if (firmware && firmware.firmware_path) {
        const dbFilePath = path.join(UPLOAD_DIR, path.basename(firmware.firmware_path));
        if (fs.existsSync(dbFilePath)) {
          return res.download(dbFilePath, firmware.firmware_name || path.basename(dbFilePath));
        }
      }
      return notFound(res, 'Firmware file not found');
    }

    // Send the file
    res.download(filePath);
  })
);

/**
 * @swagger
 * /otaMag/upload:
 *   post:
 *     tags: [OTA Management]
 *     summary: Upload firmware file
 *     description: Upload a firmware binary file (admin only)
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
 *                 description: Firmware file (.bin, .ota, .hex)
 *     responses:
 *       200:
 *         description: File uploaded successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 code:
 *                   type: integer
 *                 msg:
 *                   type: string
 *                 data:
 *                   type: object
 *                   properties:
 *                     filename:
 *                       type: string
 *                     originalName:
 *                       type: string
 *                     size:
 *                       type: integer
 *                     path:
 *                       type: string
 *       400:
 *         description: Upload error
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Admin access required
 */
router.post('/upload',
  requireAuth,
  requireSuperAdmin,
  upload.single('file'),
  asyncHandler(async (req, res) => {
    if (!req.file) {
      return badRequest(res, 'No file uploaded');
    }

    const { filename, originalname, size } = req.file;
    const filePath = `/firmware/${filename}`;

    logger.info('Firmware uploaded:', {
      filename,
      originalName: originalname,
      size
    });

    success(res, {
      filename,
      originalName: originalname,
      size,
      path: filePath
    }, 'File uploaded successfully');
  })
);

// Error handler for multer
router.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return badRequest(res, 'File too large. Maximum size is 50MB');
    }
    return badRequest(res, err.message);
  }
  if (err.message && err.message.includes('Invalid file type')) {
    return badRequest(res, err.message);
  }
  next(err);
});

module.exports = router;
