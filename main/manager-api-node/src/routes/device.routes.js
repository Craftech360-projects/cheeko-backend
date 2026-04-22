/**
 * Device Routes
 *
 * Handles ESP32 device management, registration, binding, and mode control.
 * Base path: /device
 */

const express = require('express');
const router = express.Router();
const deviceService = require('../services/device.service');
const contentService = require('../services/content.service');
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

      // Transform to DeviceResponseDTO format (matching Spring Boot)
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

    // Check if user is super admin
    const isSuperAdmin = req.user.super_admin === 1;

    const devices = await deviceService.getDevicesByAgent(req.user.id, agentId, isSuperAdmin);

    // Transform to camelCase for Spring Boot compatibility
    const transformedDevices = devices.map(device => ({
      id: device.id,
      userId: device.user_id,
      macAddress: device.mac_address,
      lastConnectedAt: device.last_connected_at,
      autoUpdate: device.auto_update,
      board: device.board,
      alias: device.alias,
      agentId: device.agent_id,
      kidId: device.kid_id,
      mode: device.mode,
      deviceMode: device.device_mode,
      appVersion: device.app_version,
      sort: device.sort,
      updater: device.updater,
      updateDate: device.update_date,
      creator: device.creator,
      createDate: device.create_date
    }));

    success(res, transformedDevices);
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
    const { deviceId, hardDelete } = req.body;

    if (!deviceId) {
      return res.status(200).json({ code: 500, msg: 'Device ID cannot be empty', data: null });
    }

    // Check if user is super admin
    const isSuperAdmin = req.user.super_admin === 1;

    try {
      await deviceService.unbindDevice(req.user.id, deviceId, isSuperAdmin, { hardDelete: Boolean(hardDelete) });
      success(res, null);
    } catch (error) {
      // Match Spring Boot error response format
      return res.status(200).json({ code: 500, msg: error.message, data: null });
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

    // Check if user is super admin
    const isSuperAdmin = req.user.super_admin === 1;

    try {
      await deviceService.updateDevice(req.user.id, id, req.body, isSuperAdmin);
      // Spring Boot returns Result<Void> (no data)
      success(res, null);
    } catch (error) {
      // Match Spring Boot error response format
      return res.status(200).json({ code: 500, msg: error.message, data: null });
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
    // Support both 'mac' and 'macAddress' for compatibility
    const { mac, macAddress, board, appVersion, agentId, alias } = req.body;
    const deviceMac = macAddress || mac;

    if (!deviceMac) {
      return badRequest(res, 'MAC address is required');
    }

    try {
      await deviceService.manualAddDevice(req.user.id, {
        macAddress: deviceMac,
        board,
        appVersion,
        agentId,
        alias
      });
      // Spring Boot returns Result<Void> (no data)
      success(res, null);
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
      const modeResult = await deviceService.getMode(mac);
      // Gateway expects just the mode string: { code: 0, data: "conversation" }
      logger.info(`[DEVICE] GET /${mac}/mode response: ${modeResult.mode}`);
      success(res, modeResult.mode);
    } catch (error) {
      logger.info(`[DEVICE] GET /${mac}/mode error: ${error.message}`);
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
      const modeResult = await deviceService.getMode(mac);
      // Gateway expects just the device mode string: { code: 0, data: "auto" }
      logger.info(`[DEVICE] GET /${mac}/device-mode response: ${modeResult.deviceMode}`);
      success(res, modeResult.deviceMode);
    } catch (error) {
      logger.info(`[DEVICE] GET /${mac}/device-mode error: ${error.message}`);
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
 *         created_at:
 *           type: string
 *           format: date-time
 *         updated_at:
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
      const result = await deviceService.checkOtaVersion(mac, null, {
        version: version || null,
        board: board || null,
      });
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

// =============================================
// Token Usage Tracking Routes
// =============================================

/**
 * @swagger
 * components:
 *   schemas:
 *     TokenUsage:
 *       type: object
 *       properties:
 *         id:
 *           type: integer
 *         mac_address:
 *           type: string
 *         session_id:
 *           type: string
 *         usage_date:
 *           type: string
 *           format: date
 *         input_tokens:
 *           type: integer
 *         output_tokens:
 *           type: integer
 *         total_tokens:
 *           type: integer
 *         input_audio_tokens:
 *           type: integer
 *         input_text_tokens:
 *           type: integer
 *         input_cached_tokens:
 *           type: integer
 *         output_audio_tokens:
 *           type: integer
 *         output_text_tokens:
 *           type: integer
 *         session_duration_seconds:
 *           type: number
 *         avg_ttft_seconds:
 *           type: number
 *           description: Average time-to-first-token (latency)
 *         message_count:
 *           type: integer
 *         total_response_duration_seconds:
 *           type: number
 *         session_count:
 *           type: integer
 *         created_at:
 *           type: string
 *           format: date-time
 *         updated_at:
 *           type: string
 *           format: date-time
 *     TokenUsageInput:
 *       type: object
 *       required:
 *         - mac
 *       properties:
 *         mac:
 *           type: string
 *           description: Device MAC address
 *         sessionId:
 *           type: string
 *           description: Optional session identifier
 *         inputTokens:
 *           type: integer
 *           default: 0
 *         outputTokens:
 *           type: integer
 *           default: 0
 *         inputAudioTokens:
 *           type: integer
 *           default: 0
 *         inputTextTokens:
 *           type: integer
 *           default: 0
 *         inputCachedTokens:
 *           type: integer
 *           default: 0
 *         outputAudioTokens:
 *           type: integer
 *           default: 0
 *         outputTextTokens:
 *           type: integer
 *           default: 0
 *         sessionDurationSeconds:
 *           type: number
 *           default: 0
 *         avgTtftSeconds:
 *           type: number
 *           default: 0
 *           description: Average time-to-first-token
 *         messageCount:
 *           type: integer
 *           default: 0
 *         totalResponseDurationSeconds:
 *           type: number
 *           default: 0
 *     TokenUsageStats:
 *       type: object
 *       properties:
 *         mac:
 *           type: string
 *         period:
 *           type: string
 *         startDate:
 *           type: string
 *           format: date
 *           nullable: true
 *         endDate:
 *           type: string
 *           format: date
 *           nullable: true
 *         totals:
 *           type: object
 *           properties:
 *             inputTokens:
 *               type: integer
 *             outputTokens:
 *               type: integer
 *             totalTokens:
 *               type: integer
 *             inputAudioTokens:
 *               type: integer
 *             inputTextTokens:
 *               type: integer
 *             inputCachedTokens:
 *               type: integer
 *             outputAudioTokens:
 *               type: integer
 *             outputTextTokens:
 *               type: integer
 *             sessionDurationSeconds:
 *               type: number
 *             avgTtftSeconds:
 *               type: number
 *             messageCount:
 *               type: integer
 *             totalResponseDurationSeconds:
 *               type: number
 *             sessionCount:
 *               type: integer
 *             dayCount:
 *               type: integer
 *         daily:
 *           type: array
 *           items:
 *             $ref: '#/components/schemas/TokenUsage'
 */

/**
 * @swagger
 * /device/token-usage:
 *   post:
 *     tags: [Device - Token Usage]
 *     summary: Record token usage
 *     description: Public endpoint for LiveKit agents to record LLM token usage
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/TokenUsageInput'
 *     responses:
 *       200:
 *         description: Token usage recorded
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/TokenUsage'
 */
router.post('/token-usage',
  asyncHandler(async (req, res) => {
    const {
      mac,
      sessionId,
      inputTokens,
      outputTokens,
      inputAudioTokens,
      inputTextTokens,
      inputCachedTokens,
      outputAudioTokens,
      outputTextTokens,
      totalTokens,
      sessionDurationSeconds,
      avgTtftSeconds,
      messageCount,
      totalResponseDurationSeconds
    } = req.body;

    if (!mac) {
      return badRequest(res, 'MAC address is required');
    }

    try {
      const record = await deviceService.recordTokenUsage({
        mac,
        sessionId,
        inputTokens,
        outputTokens,
        inputAudioTokens,
        inputTextTokens,
        inputCachedTokens,
        outputAudioTokens,
        outputTextTokens,
        totalTokens,
        sessionDurationSeconds,
        avgTtftSeconds,
        messageCount,
        totalResponseDurationSeconds
      });
      success(res, record, 'Token usage recorded');
    } catch (error) {
      logger.error('Failed to record token usage:', error);
      badRequest(res, error.message);
    }
  })
);

/**
 * @swagger
 * /device/token-usage/summary:
 *   get:
 *     tags: [Device - Token Usage]
 *     summary: Get token usage summary across all devices (admin)
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
 *           default: 20
 *       - in: query
 *         name: startDate
 *         schema:
 *           type: string
 *           format: date
 *       - in: query
 *         name: endDate
 *         schema:
 *           type: string
 *           format: date
 *     responses:
 *       200:
 *         description: Token usage summary by device
 */
// NOTE: This route MUST come before /token-usage/:mac to avoid matching "summary" as a MAC address
router.get('/token-usage/summary',
  requireAuth,
  asyncHandler(async (req, res) => {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const { startDate, endDate } = req.query;

    try {
      const result = await deviceService.getTokenUsageSummary({
        page,
        limit,
        startDate,
        endDate
      });
      success(res, result);
    } catch (error) {
      badRequest(res, error.message);
    }
  })
);

/**
 * @swagger
 * /device/token-usage/{mac}/stats:
 *   get:
 *     tags: [Device - Token Usage]
 *     summary: Get token usage statistics for a device
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: mac
 *         required: true
 *         schema:
 *           type: string
 *         description: Device MAC address
 *       - in: query
 *         name: startDate
 *         schema:
 *           type: string
 *           format: date
 *         description: Start date for statistics (YYYY-MM-DD)
 *       - in: query
 *         name: endDate
 *         schema:
 *           type: string
 *           format: date
 *         description: End date for statistics (YYYY-MM-DD)
 *       - in: query
 *         name: period
 *         schema:
 *           type: string
 *           enum: [daily, weekly, monthly]
 *           default: daily
 *         description: Aggregation period
 *     responses:
 *       200:
 *         description: Token usage statistics
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/TokenUsageStats'
 */
router.get('/token-usage/:mac/stats',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { mac } = req.params;
    const { startDate, endDate, period } = req.query;

    try {
      const stats = await deviceService.getTokenUsageStats(mac, {
        startDate,
        endDate,
        period
      });
      success(res, stats);
    } catch (error) {
      badRequest(res, error.message);
    }
  })
);

/**
 * @swagger
 * /device/token-usage/{mac}:
 *   get:
 *     tags: [Device - Token Usage]
 *     summary: List token usage records for a device (paginated)
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: mac
 *         required: true
 *         schema:
 *           type: string
 *         description: Device MAC address
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           default: 1
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 30
 *       - in: query
 *         name: startDate
 *         schema:
 *           type: string
 *           format: date
 *       - in: query
 *         name: endDate
 *         schema:
 *           type: string
 *           format: date
 *     responses:
 *       200:
 *         description: Paginated token usage list
 */
router.get('/token-usage/:mac',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { mac } = req.params;
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 30;
    const { startDate, endDate } = req.query;

    try {
      const result = await deviceService.listTokenUsage(mac, {
        page,
        limit,
        startDate,
        endDate
      });
      success(res, result);
    } catch (error) {
      badRequest(res, error.message);
    }
  })
);

/**
 * @swagger
 * /device/token-usage/{mac}:
 *   delete:
 *     tags: [Device - Token Usage]
 *     summary: Delete token usage records for a device
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: mac
 *         required: true
 *         schema:
 *           type: string
 *         description: Device MAC address
 *       - in: query
 *         name: startDate
 *         schema:
 *           type: string
 *           format: date
 *         description: Delete records from this date
 *       - in: query
 *         name: endDate
 *         schema:
 *           type: string
 *           format: date
 *         description: Delete records until this date
 *       - in: query
 *         name: olderThan
 *         schema:
 *           type: string
 *           format: date
 *         description: Delete records older than this date
 *     responses:
 *       200:
 *         description: Token usage records deleted
 */
router.delete('/token-usage/:mac',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { mac } = req.params;
    const { startDate, endDate, olderThan } = req.query;

    try {
      const count = await deviceService.deleteTokenUsage(mac, {
        startDate,
        endDate,
        olderThan
      });
      success(res, { deletedCount: count }, 'Token usage records deleted');
    } catch (error) {
      badRequest(res, error.message);
    }
  })
);

// ==================== DEVICE PLAYLIST PATH ALIASES ====================
// These routes provide an alternative path to access playlists via device MAC
// The same functionality is available under /content/playlist/{type}/{deviceId}

/**
 * @swagger
 * /device/{mac}/playlist/music:
 *   get:
 *     tags: [Device - Playlists]
 *     summary: Get music playlist for device
 *     description: Get all music items in a device's playlist ordered by position
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: mac
 *         required: true
 *         schema:
 *           type: string
 *         description: Device MAC address
 *     responses:
 *       200:
 *         description: Music playlist
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 code:
 *                   type: integer
 *                   example: 0
 *                 data:
 *                   type: array
 *                   items:
 *                     type: object
 */
router.get('/:mac/playlist/music',
  asyncHandler(async (req, res) => {
    const { mac } = req.params;

    // Verify device exists
    const device = await deviceService.getDeviceByMac(mac);
    if (!device) {
      return notFound(res, 'Device not found');
    }

    const playlist = await contentService.getPlaylist(device.id, 'music');
    success(res, playlist);
  })
);

/**
 * @swagger
 * /device/{mac}/playlist/music:
 *   post:
 *     tags: [Device - Playlists]
 *     summary: Add music to device playlist
 *     description: Add a content item to device's music playlist
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: mac
 *         required: true
 *         schema:
 *           type: string
 *         description: Device MAC address
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - contentId
 *             properties:
 *               contentId:
 *                 type: string
 *                 description: Content ID to add
 *               position:
 *                 type: integer
 *                 description: Position in playlist (appends to end if not specified)
 *     responses:
 *       200:
 *         description: Item added to playlist
 *       400:
 *         description: Invalid input or content already in playlist
 */
router.post('/:mac/playlist/music',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { mac } = req.params;
    const { contentId, position } = req.body;

    if (!contentId) {
      return badRequest(res, 'Content ID is required');
    }

    // Verify device exists
    const device = await deviceService.getDeviceByMac(mac);
    if (!device) {
      return notFound(res, 'Device not found');
    }

    // Verify content exists and is music type
    const content = await contentService.getLibraryById(contentId);
    if (!content) {
      return notFound(res, 'Content not found');
    }
    if (content.content_type !== 'music') {
      return badRequest(res, 'Content must be of type music');
    }

    try {
      const item = await contentService.addToPlaylist(device.id, contentId, 'music', position);
      success(res, item, 'Added to music playlist');
    } catch (error) {
      badRequest(res, error.message);
    }
  })
);

/**
 * @swagger
 * /device/{mac}/playlist/music/{contentId}:
 *   delete:
 *     tags: [Device - Playlists]
 *     summary: Remove music from device playlist
 *     description: Remove a content item from device's music playlist
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: mac
 *         required: true
 *         schema:
 *           type: string
 *         description: Device MAC address
 *       - in: path
 *         name: contentId
 *         required: true
 *         schema:
 *           type: string
 *         description: Content ID to remove
 *     responses:
 *       200:
 *         description: Item removed from playlist
 */
router.delete('/:mac/playlist/music/:contentId',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { mac, contentId } = req.params;

    // Verify device exists
    const device = await deviceService.getDeviceByMac(mac);
    if (!device) {
      return notFound(res, 'Device not found');
    }

    try {
      await contentService.removeFromPlaylist(device.id, contentId, 'music');
      success(res, null, 'Removed from music playlist');
    } catch (error) {
      badRequest(res, error.message);
    }
  })
);

/**
 * @swagger
 * /device/{mac}/playlist/music/clear:
 *   delete:
 *     tags: [Device - Playlists]
 *     summary: Clear device music playlist
 *     description: Remove all items from device's music playlist
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: mac
 *         required: true
 *         schema:
 *           type: string
 *         description: Device MAC address
 *     responses:
 *       200:
 *         description: Playlist cleared
 */
router.delete('/:mac/playlist/music/clear',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { mac } = req.params;

    // Verify device exists
    const device = await deviceService.getDeviceByMac(mac);
    if (!device) {
      return notFound(res, 'Device not found');
    }

    try {
      await contentService.clearPlaylist(device.id, 'music');
      success(res, null, 'Music playlist cleared');
    } catch (error) {
      badRequest(res, error.message);
    }
  })
);

/**
 * @swagger
 * /device/{mac}/playlist/music/reorder:
 *   put:
 *     tags: [Device - Playlists]
 *     summary: Reorder device music playlist
 *     description: Reorder items in device's music playlist
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: mac
 *         required: true
 *         schema:
 *           type: string
 *         description: Device MAC address
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - itemIds
 *             properties:
 *               itemIds:
 *                 type: array
 *                 items:
 *                   type: integer
 *                 description: Playlist item IDs in new order
 *     responses:
 *       200:
 *         description: Playlist reordered
 */
router.put('/:mac/playlist/music/reorder',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { mac } = req.params;
    const { itemIds } = req.body;

    if (!itemIds || !Array.isArray(itemIds) || itemIds.length === 0) {
      return badRequest(res, 'itemIds must be a non-empty array');
    }

    // Verify device exists
    const device = await deviceService.getDeviceByMac(mac);
    if (!device) {
      return notFound(res, 'Device not found');
    }

    try {
      const playlist = await contentService.reorderPlaylist(device.id, itemIds, 'music');
      success(res, playlist, 'Music playlist reordered');
    } catch (error) {
      badRequest(res, error.message);
    }
  })
);

/**
 * @swagger
 * /device/{mac}/playlist/story:
 *   get:
 *     tags: [Device - Playlists]
 *     summary: Get story playlist for device
 *     description: Get all story items in a device's playlist ordered by position
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: mac
 *         required: true
 *         schema:
 *           type: string
 *         description: Device MAC address
 *     responses:
 *       200:
 *         description: Story playlist
 */
router.get('/:mac/playlist/story',
  asyncHandler(async (req, res) => {
    const { mac } = req.params;

    // Verify device exists
    const device = await deviceService.getDeviceByMac(mac);
    if (!device) {
      return notFound(res, 'Device not found');
    }

    const playlist = await contentService.getPlaylist(device.id, 'story');
    success(res, playlist);
  })
);

/**
 * @swagger
 * /device/{mac}/playlist/story:
 *   post:
 *     tags: [Device - Playlists]
 *     summary: Add story to device playlist
 *     description: Add a content item to device's story playlist
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: mac
 *         required: true
 *         schema:
 *           type: string
 *         description: Device MAC address
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - contentId
 *             properties:
 *               contentId:
 *                 type: string
 *                 description: Content ID to add
 *               position:
 *                 type: integer
 *                 description: Position in playlist (appends to end if not specified)
 *     responses:
 *       200:
 *         description: Item added to playlist
 *       400:
 *         description: Invalid input or content already in playlist
 */
router.post('/:mac/playlist/story',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { mac } = req.params;
    const { contentId, position } = req.body;

    if (!contentId) {
      return badRequest(res, 'Content ID is required');
    }

    // Verify device exists
    const device = await deviceService.getDeviceByMac(mac);
    if (!device) {
      return notFound(res, 'Device not found');
    }

    // Verify content exists and is story type
    const content = await contentService.getLibraryById(contentId);
    if (!content) {
      return notFound(res, 'Content not found');
    }
    if (content.content_type !== 'story') {
      return badRequest(res, 'Content must be of type story');
    }

    try {
      const item = await contentService.addToPlaylist(device.id, contentId, 'story', position);
      success(res, item, 'Added to story playlist');
    } catch (error) {
      badRequest(res, error.message);
    }
  })
);

/**
 * @swagger
 * /device/{mac}/playlist/story/{contentId}:
 *   delete:
 *     tags: [Device - Playlists]
 *     summary: Remove story from device playlist
 *     description: Remove a content item from device's story playlist
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: mac
 *         required: true
 *         schema:
 *           type: string
 *         description: Device MAC address
 *       - in: path
 *         name: contentId
 *         required: true
 *         schema:
 *           type: string
 *         description: Content ID to remove
 *     responses:
 *       200:
 *         description: Item removed from playlist
 */
router.delete('/:mac/playlist/story/:contentId',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { mac, contentId } = req.params;

    // Verify device exists
    const device = await deviceService.getDeviceByMac(mac);
    if (!device) {
      return notFound(res, 'Device not found');
    }

    try {
      await contentService.removeFromPlaylist(device.id, contentId, 'story');
      success(res, null, 'Removed from story playlist');
    } catch (error) {
      badRequest(res, error.message);
    }
  })
);

/**
 * @swagger
 * /device/{mac}/playlist/story/clear:
 *   delete:
 *     tags: [Device - Playlists]
 *     summary: Clear device story playlist
 *     description: Remove all items from device's story playlist
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: mac
 *         required: true
 *         schema:
 *           type: string
 *         description: Device MAC address
 *     responses:
 *       200:
 *         description: Playlist cleared
 */
router.delete('/:mac/playlist/story/clear',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { mac } = req.params;

    // Verify device exists
    const device = await deviceService.getDeviceByMac(mac);
    if (!device) {
      return notFound(res, 'Device not found');
    }

    try {
      await contentService.clearPlaylist(device.id, 'story');
      success(res, null, 'Story playlist cleared');
    } catch (error) {
      badRequest(res, error.message);
    }
  })
);

/**
 * @swagger
 * /device/{mac}/playlist/story/reorder:
 *   put:
 *     tags: [Device - Playlists]
 *     summary: Reorder device story playlist
 *     description: Reorder items in device's story playlist
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: mac
 *         required: true
 *         schema:
 *           type: string
 *         description: Device MAC address
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - itemIds
 *             properties:
 *               itemIds:
 *                 type: array
 *                 items:
 *                   type: integer
 *                 description: Playlist item IDs in new order
 *     responses:
 *       200:
 *         description: Playlist reordered
 */
router.put('/:mac/playlist/story/reorder',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { mac } = req.params;
    const { itemIds } = req.body;

    if (!itemIds || !Array.isArray(itemIds) || itemIds.length === 0) {
      return badRequest(res, 'itemIds must be a non-empty array');
    }

    // Verify device exists
    const device = await deviceService.getDeviceByMac(mac);
    if (!device) {
      return notFound(res, 'Device not found');
    }

    try {
      const playlist = await contentService.reorderPlaylist(device.id, itemIds, 'story');
      success(res, playlist, 'Story playlist reordered');
    } catch (error) {
      badRequest(res, error.message);
    }
  })
);

module.exports = router;
