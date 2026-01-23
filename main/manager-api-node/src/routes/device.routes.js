/**
 * Device Routes
 *
 * Handles ESP32 device management, registration, binding, and mode control.
 * Base path: /device
 */

const express = require('express');
const router = express.Router();
const deviceService = require('../services/device.service');
const { asyncHandler } = require('../middleware/errorHandler');
const { requireAuth, optionalAuth } = require('../middleware/auth');
const { validate, schemas } = require('../middleware/validation');
const { success, badRequest, notFound } = require('../utils/response');
const logger = require('../utils/logger');

/**
 * @swagger
 * /device/register:
 *   post:
 *     tags: [Device]
 *     summary: Register a device (called by ESP32)
 *     description: Public endpoint for ESP32 devices to register themselves
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - mac
 *             properties:
 *               mac:
 *                 type: string
 *                 description: MAC address (AA:BB:CC:DD:EE:FF or AABBCCDDEEFF)
 *               board:
 *                 type: string
 *                 description: Hardware board type
 *               appVersion:
 *                 type: string
 *                 description: Firmware version
 *     responses:
 *       200:
 *         description: Device registered
 */
router.post('/register',
  validate({ body: schemas.deviceRegister }),
  asyncHandler(async (req, res) => {
    const { mac, board, appVersion } = req.body;

    try {
      const device = await deviceService.registerDevice({ mac, board, appVersion });
      success(res, device, 'Device registered successfully');
    } catch (error) {
      logger.error('Device registration failed:', error);
      badRequest(res, error.message);
    }
  })
);

/**
 * @swagger
 * /device/bind/{agentId}/{deviceCode}:
 *   post:
 *     tags: [Device]
 *     summary: Bind device to user and agent
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: agentId
 *         required: true
 *         schema:
 *           type: string
 *       - in: path
 *         name: deviceCode
 *         required: true
 *         schema:
 *           type: string
 *         description: Device MAC address or validation code
 *     responses:
 *       200:
 *         description: Device bound successfully
 */
router.post('/bind/:agentId/:deviceCode',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { agentId, deviceCode } = req.params;

    try {
      const device = await deviceService.bindDevice(req.user.id, agentId, deviceCode);
      success(res, device, 'Device bound successfully');
    } catch (error) {
      badRequest(res, error.message);
    }
  })
);

/**
 * @swagger
 * /device/bind/{agentId}:
 *   get:
 *     tags: [Device]
 *     summary: Get devices bound to an agent
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: agentId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: List of devices
 */
router.get('/bind/:agentId',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { agentId } = req.params;

    const devices = await deviceService.getDevicesByAgent(req.user.id, agentId);
    success(res, devices);
  })
);

/**
 * @swagger
 * /device/unbind:
 *   post:
 *     tags: [Device]
 *     summary: Unbind device from user
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - deviceId
 *             properties:
 *               deviceId:
 *                 type: string
 *     responses:
 *       200:
 *         description: Device unbound successfully
 */
router.post('/unbind',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { deviceId } = req.body;

    if (!deviceId) {
      return badRequest(res, 'Device ID is required');
    }

    try {
      await deviceService.unbindDevice(req.user.id, deviceId);
      success(res, null, 'Device unbound successfully');
    } catch (error) {
      badRequest(res, error.message);
    }
  })
);

/**
 * @swagger
 * /device/update/{id}:
 *   put:
 *     tags: [Device]
 *     summary: Update device
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               alias:
 *                 type: string
 *               autoUpdate:
 *                 type: boolean
 *               agentId:
 *                 type: string
 *     responses:
 *       200:
 *         description: Device updated
 */
router.put('/update/:id',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { id } = req.params;

    try {
      const device = await deviceService.updateDevice(req.user.id, id, req.body);
      success(res, device, 'Device updated successfully');
    } catch (error) {
      badRequest(res, error.message);
    }
  })
);

/**
 * @swagger
 * /device/manual-add:
 *   post:
 *     tags: [Device]
 *     summary: Manually add a device
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - mac
 *             properties:
 *               mac:
 *                 type: string
 *               alias:
 *                 type: string
 *               agentId:
 *                 type: string
 *     responses:
 *       200:
 *         description: Device created
 */
router.post('/manual-add',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { mac, alias, agentId } = req.body;

    if (!mac) {
      return badRequest(res, 'MAC address is required');
    }

    try {
      const device = await deviceService.manualAddDevice(req.user.id, { mac, alias, agentId });
      success(res, device, 'Device added successfully');
    } catch (error) {
      badRequest(res, error.message);
    }
  })
);

/**
 * @swagger
 * /device/assign-kid/{deviceId}:
 *   put:
 *     tags: [Device]
 *     summary: Assign kid profile to device
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: deviceId
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               kidId:
 *                 type: integer
 *     responses:
 *       200:
 *         description: Kid assigned to device
 */
router.put('/assign-kid/:deviceId',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { deviceId } = req.params;
    const { kidId } = req.body;

    try {
      const device = await deviceService.assignKidToDevice(req.user.id, deviceId, kidId);
      success(res, device, 'Kid assigned to device');
    } catch (error) {
      badRequest(res, error.message);
    }
  })
);

/**
 * @swagger
 * /device/assign-kid-by-mac:
 *   put:
 *     tags: [Device]
 *     summary: Assign kid profile to device by MAC address
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - mac
 *             properties:
 *               mac:
 *                 type: string
 *               kidId:
 *                 type: integer
 *     responses:
 *       200:
 *         description: Kid assigned to device
 */
router.put('/assign-kid-by-mac',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { mac, kidId } = req.body;

    if (!mac) {
      return badRequest(res, 'MAC address is required');
    }

    try {
      const device = await deviceService.assignKidByMac(mac, kidId);
      success(res, device, 'Kid assigned to device');
    } catch (error) {
      badRequest(res, error.message);
    }
  })
);

/**
 * @swagger
 * /device/{mac}/cycle-mode:
 *   post:
 *     tags: [Device]
 *     summary: Cycle device mode (conversation -> music -> story)
 *     description: Public endpoint for ESP32 button press
 *     parameters:
 *       - in: path
 *         name: mac
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Mode cycled
 */
router.post('/:mac/cycle-mode',
  asyncHandler(async (req, res) => {
    const { mac } = req.params;

    try {
      const result = await deviceService.cycleMode(mac);
      success(res, result, `Mode changed to ${result.mode}`);
    } catch (error) {
      badRequest(res, error.message);
    }
  })
);

/**
 * @swagger
 * /device/{mac}/mode:
 *   get:
 *     tags: [Device]
 *     summary: Get device mode
 *     description: Public endpoint for ESP32
 *     parameters:
 *       - in: path
 *         name: mac
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Device mode
 */
router.get('/:mac/mode',
  asyncHandler(async (req, res) => {
    const { mac } = req.params;

    try {
      const mode = await deviceService.getMode(mac);
      success(res, mode);
    } catch (error) {
      notFound(res, error.message);
    }
  })
);

/**
 * @swagger
 * /device/{mac}/device-mode:
 *   get:
 *     tags: [Device]
 *     summary: Get device PTT mode (auto/manual)
 *     description: Public endpoint for ESP32
 *     parameters:
 *       - in: path
 *         name: mac
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Device mode
 */
router.get('/:mac/device-mode',
  asyncHandler(async (req, res) => {
    const { mac } = req.params;

    try {
      const mode = await deviceService.getMode(mac);
      success(res, { deviceMode: mode.deviceMode });
    } catch (error) {
      notFound(res, error.message);
    }
  })
);

/**
 * @swagger
 * /device/list:
 *   get:
 *     tags: [Device]
 *     summary: List user's devices
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           default: 1
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 10
 *     responses:
 *       200:
 *         description: Paginated list of devices
 */
router.get('/list',
  requireAuth,
  asyncHandler(async (req, res) => {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;

    const result = await deviceService.listDevices(req.user.id, { page, limit });
    success(res, result);
  })
);

/**
 * @swagger
 * /device/{mac}:
 *   get:
 *     tags: [Device]
 *     summary: Get device by MAC address
 *     parameters:
 *       - in: path
 *         name: mac
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Device details
 *       404:
 *         description: Device not found
 */
router.get('/:mac',
  optionalAuth,
  asyncHandler(async (req, res) => {
    const { mac } = req.params;

    const device = await deviceService.getDeviceByMac(mac);
    if (!device) {
      return notFound(res, 'Device not found');
    }

    success(res, device);
  })
);

// =============================================
// OTA (Over-The-Air) Firmware Update Routes
// =============================================

/**
 * @swagger
 * components:
 *   schemas:
 *     Firmware:
 *       type: object
 *       properties:
 *         id:
 *           type: string
 *         firmware_name:
 *           type: string
 *         type:
 *           type: string
 *           description: Firmware type (e.g., esp32, esp32s3)
 *         version:
 *           type: string
 *         size:
 *           type: integer
 *           description: File size in bytes
 *         remark:
 *           type: string
 *         firmware_path:
 *           type: string
 *         force_update:
 *           type: integer
 *           enum: [0, 1]
 *           description: 0=optional, 1=forced update
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
 *         type:
 *           type: string
 *         version:
 *           type: string
 *         size:
 *           type: integer
 *         remark:
 *           type: string
 *         firmwarePath:
 *           type: string
 *         forceUpdate:
 *           type: integer
 *           enum: [0, 1]
 *     OtaCheckResponse:
 *       type: object
 *       properties:
 *         device:
 *           type: object
 *           properties:
 *             mac:
 *               type: string
 *             currentVersion:
 *               type: string
 *             board:
 *               type: string
 *             autoUpdate:
 *               type: boolean
 *         firmware:
 *           type: object
 *           nullable: true
 *           properties:
 *             version:
 *               type: string
 *             url:
 *               type: string
 *             size:
 *               type: integer
 *             force:
 *               type: integer
 *             name:
 *               type: string
 *             remark:
 *               type: string
 *         serverTime:
 *           type: object
 *           properties:
 *             timestamp:
 *               type: integer
 *             timezone:
 *               type: string
 *             offset:
 *               type: integer
 */

/**
 * @swagger
 * /device/ota/check:
 *   post:
 *     tags: [Device - OTA]
 *     summary: Check for OTA firmware updates
 *     description: Public endpoint for ESP32 devices to check for firmware updates
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - mac
 *             properties:
 *               mac:
 *                 type: string
 *                 description: Device MAC address
 *               version:
 *                 type: string
 *                 description: Current firmware version
 *               board:
 *                 type: string
 *                 description: Board type (e.g., esp32, esp32s3)
 *     responses:
 *       200:
 *         description: OTA check response
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/OtaCheckResponse'
 */
router.post('/ota/check',
  asyncHandler(async (req, res) => {
    const { mac, version, board } = req.body;

    if (!mac) {
      return badRequest(res, 'MAC address is required');
    }

    try {
      const result = await deviceService.checkOtaVersion(mac, version, board);
      success(res, result);
    } catch (error) {
      logger.error('OTA check failed:', error);
      badRequest(res, error.message);
    }
  })
);

/**
 * @swagger
 * /device/ota/firmware:
 *   get:
 *     tags: [Device - OTA]
 *     summary: List firmware (paginated)
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           default: 1
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 10
 *       - in: query
 *         name: type
 *         schema:
 *           type: string
 *         description: Filter by firmware type
 *     responses:
 *       200:
 *         description: Paginated list of firmware
 */
router.get('/ota/firmware',
  requireAuth,
  asyncHandler(async (req, res) => {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const type = req.query.type;

    const result = await deviceService.listFirmware({ page, limit, type });
    success(res, result);
  })
);

/**
 * @swagger
 * /device/ota/firmware/all:
 *   get:
 *     tags: [Device - OTA]
 *     summary: List all firmware
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: type
 *         schema:
 *           type: string
 *         description: Filter by firmware type
 *     responses:
 *       200:
 *         description: List of all firmware
 */
router.get('/ota/firmware/all',
  requireAuth,
  asyncHandler(async (req, res) => {
    const type = req.query.type;
    const firmware = await deviceService.getAllFirmware(type);
    success(res, firmware);
  })
);

/**
 * @swagger
 * /device/ota/firmware/latest/{type}:
 *   get:
 *     tags: [Device - OTA]
 *     summary: Get latest firmware by type
 *     description: Public endpoint to get the latest firmware for a specific type
 *     parameters:
 *       - in: path
 *         name: type
 *         required: true
 *         schema:
 *           type: string
 *         description: Firmware type (e.g., esp32, esp32s3)
 *     responses:
 *       200:
 *         description: Latest firmware
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Firmware'
 *       404:
 *         description: No firmware found for this type
 */
router.get('/ota/firmware/latest/:type',
  asyncHandler(async (req, res) => {
    const { type } = req.params;

    const firmware = await deviceService.getLatestFirmware(type);
    if (!firmware) {
      return notFound(res, 'No firmware found for this type');
    }

    success(res, firmware);
  })
);

/**
 * @swagger
 * /device/ota/firmware/{id}:
 *   get:
 *     tags: [Device - OTA]
 *     summary: Get firmware by ID
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Firmware details
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Firmware'
 *       404:
 *         description: Firmware not found
 */
router.get('/ota/firmware/:id',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { id } = req.params;

    const firmware = await deviceService.getFirmwareById(id);
    if (!firmware) {
      return notFound(res, 'Firmware not found');
    }

    success(res, firmware);
  })
);

/**
 * @swagger
 * /device/ota/firmware:
 *   post:
 *     tags: [Device - OTA]
 *     summary: Create firmware record
 *     description: Admin endpoint to create a new firmware record
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
 *         description: Firmware created
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Firmware'
 */
router.post('/ota/firmware',
  requireAuth,
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
 * /device/ota/firmware/{id}:
 *   put:
 *     tags: [Device - OTA]
 *     summary: Update firmware record
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/FirmwareInput'
 *     responses:
 *       200:
 *         description: Firmware updated
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Firmware'
 */
router.put('/ota/firmware/:id',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { id } = req.params;

    try {
      const firmware = await deviceService.updateFirmware(id, req.body);
      success(res, firmware, 'Firmware updated successfully');
    } catch (error) {
      badRequest(res, error.message);
    }
  })
);

/**
 * @swagger
 * /device/ota/firmware/{id}:
 *   delete:
 *     tags: [Device - OTA]
 *     summary: Delete firmware record
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Firmware deleted
 */
router.delete('/ota/firmware/:id',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { id } = req.params;

    try {
      await deviceService.deleteFirmware(id);
      success(res, null, 'Firmware deleted successfully');
    } catch (error) {
      badRequest(res, error.message);
    }
  })
);

/**
 * @swagger
 * /device/ota/firmware/{id}/force-update:
 *   put:
 *     tags: [Device - OTA]
 *     summary: Set force update flag on firmware
 *     description: Only one firmware per type can have force update enabled
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - forceUpdate
 *             properties:
 *               forceUpdate:
 *                 type: integer
 *                 enum: [0, 1]
 *                 description: 0=disable, 1=enable force update
 *     responses:
 *       200:
 *         description: Force update flag set
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Firmware'
 */
router.put('/ota/firmware/:id/force-update',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    const { forceUpdate } = req.body;

    if (forceUpdate === undefined || (forceUpdate !== 0 && forceUpdate !== 1)) {
      return badRequest(res, 'forceUpdate must be 0 or 1');
    }

    try {
      const firmware = await deviceService.setForceUpdate(id, forceUpdate);
      success(res, firmware, `Force update ${forceUpdate === 1 ? 'enabled' : 'disabled'}`);
    } catch (error) {
      badRequest(res, error.message);
    }
  })
);

module.exports = router;
