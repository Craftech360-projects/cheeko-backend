/**
 * OTA (Over-The-Air) Root Routes
 *
 * Provides Spring Boot compatible /ota/ endpoints as aliases to /device/ota/ endpoints.
 * ESP32 devices expect this path format for OTA version and activation checks.
 */

const express = require('express');
const router = express.Router();
const deviceService = require('../services/device.service');
const { asyncHandler } = require('../middleware/errorHandler');
const { success, badRequest } = require('../utils/response');
const logger = require('../utils/logger');

/**
 * @swagger
 * tags:
 *   - name: OTA
 *     description: OTA firmware update endpoints (Spring Boot compatibility)
 */

/**
 * @swagger
 * /ota/:
 *   post:
 *     tags: [OTA]
 *     summary: OTA version and activation check
 *     description: |
 *       Public endpoint for ESP32 devices to check for firmware updates.
 *       This is the Spring Boot compatible endpoint that devices call on boot.
 *       Registers or updates device record and returns available firmware update if any.
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
 *                 example: "AA:BB:CC:DD:EE:FF"
 *               version:
 *                 type: string
 *                 description: Current firmware version
 *                 example: "1.0.5"
 *               board:
 *                 type: string
 *                 description: Board type (e.g., esp32, esp32s3)
 *                 example: "esp32s3"
 *     responses:
 *       200:
 *         description: OTA check response with device status and available firmware
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
 *                   example: success
 *                 data:
 *                   type: object
 *                   properties:
 *                     device:
 *                       type: object
 *                       properties:
 *                         mac:
 *                           type: string
 *                         currentVersion:
 *                           type: string
 *                         board:
 *                           type: string
 *                         autoUpdate:
 *                           type: boolean
 *                     firmware:
 *                       type: object
 *                       nullable: true
 *                       properties:
 *                         version:
 *                           type: string
 *                         url:
 *                           type: string
 *                         size:
 *                           type: integer
 *                         force:
 *                           type: integer
 *                         name:
 *                           type: string
 *                         remark:
 *                           type: string
 *                     serverTime:
 *                       type: object
 *                       properties:
 *                         timestamp:
 *                           type: integer
 *                         timezone:
 *                           type: string
 *                         offset:
 *                           type: integer
 *       400:
 *         description: Bad request - MAC address required
 */
router.post('/',
  asyncHandler(async (req, res) => {
    // Log incoming request
    logger.info('[OTA] Incoming request: ' + JSON.stringify({
      headers: {
        'device-id': req.headers['device-id'],
        'client-id': req.headers['client-id'],
        'content-type': req.headers['content-type']
      },
      body: req.body
    }, null, 2));

    // Spring Boot compatibility: MAC comes from Device-Id header, not body
    const deviceId = req.headers['device-id'] || req.headers['Device-Id'];
    const clientId = req.headers['client-id'] || req.headers['Client-Id'] || deviceId;

    // Fallback to body for backwards compatibility
    const mac = deviceId || req.body.mac || req.body.mac_address;

    if (!mac) {
      logger.info('[OTA] Outgoing response: { code: 400, msg: "Device ID is required" }');
      return badRequest(res, 'Device ID is required (Device-Id header or mac in body)');
    }

    // Validate MAC address format
    const macPattern = /^([0-9A-Fa-f]{2}[:-]){5}([0-9A-Fa-f]{2})$/;
    if (!macPattern.test(mac)) {
      logger.info('[OTA] Outgoing response: { code: 400, msg: "Invalid device ID format" }');
      return badRequest(res, 'Invalid device ID format');
    }

    try {
      // Extract device info from body (Spring Boot DeviceReportReqDTO format)
      const deviceReport = {
        version: req.body.version,
        flashSize: req.body.flash_size,
        macAddress: req.body.mac_address || mac,
        chipModelName: req.body.chip_model_name,
        chipInfo: req.body.chip_info,
        application: req.body.application,
        board: req.body.board,
        ota: req.body.ota
      };

      const result = await deviceService.checkOtaVersion(mac, clientId, deviceReport);
      // Log outgoing response
      logger.info('[OTA] Outgoing response: ' + JSON.stringify(result, null, 2));
      // Return raw response (Spring Boot doesn't wrap in {code, msg, data})
      res.json(result);
    } catch (error) {
      logger.error('OTA check failed:', error);
      logger.info('[OTA] Outgoing response (error): ' + JSON.stringify({ error: error.message }));
      // Spring Boot returns error in response body
      res.json({ error: error.message });
    }
  })
);

/**
 * @swagger
 * /ota/activate:
 *   post:
 *     tags: [OTA]
 *     summary: Device quick activation check
 *     description: |
 *       Quick activation check for devices. Returns minimal response indicating
 *       if device is registered and activated in the system.
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
 *                 example: "AA:BB:CC:DD:EE:FF"
 *     responses:
 *       200:
 *         description: Activation status response
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
 *                   example: success
 *                 data:
 *                   type: object
 *                   properties:
 *                     activated:
 *                       type: boolean
 *                       description: Whether device is activated
 *                     deviceId:
 *                       type: string
 *                       description: Device ID if activated
 *                     mac:
 *                       type: string
 *                       description: Normalized MAC address
 *                     serverTime:
 *                       type: integer
 *                       description: Server timestamp
 *       400:
 *         description: Bad request - MAC address required
 */
router.post('/activate',
  asyncHandler(async (req, res) => {
    // Spring Boot compatibility: MAC comes from Device-Id header
    const deviceId = req.headers['device-id'] || req.headers['Device-Id'];
    const clientId = req.headers['client-id'] || req.headers['Client-Id'] || deviceId;
    const mac = deviceId || req.body.mac || req.body.mac_address;

    if (!mac) {
      // Spring Boot returns 202 for missing device ID
      return res.status(202).end();
    }

    try {
      // Get device by MAC to check if it exists/activated
      const device = await deviceService.getDeviceByMac(mac);

      if (!device || !device.user_id) {
        const deviceReport = {
          version: req.body.version,
          flashSize: req.body.flash_size,
          macAddress: req.body.mac_address || mac,
          chipModelName: req.body.chip_model_name,
          chipInfo: req.body.chip_info,
          application: req.body.application,
          board: req.body.board,
          ota: req.body.ota
        };

        const result = await deviceService.checkOtaVersion(mac, clientId || mac, deviceReport);
        logger.info('[OTA activate] Outgoing activation payload: ' + JSON.stringify(result, null, 2));
        return res.status(200).json(result);
      }

      // Spring Boot returns simple "success" string for activated devices
      res.status(200).send('success');
    } catch (error) {
      logger.error('Activation check failed:', error);
      res.status(202).end();
    }
  })
);

/**
 * @swagger
 * /ota/:
 *   get:
 *     tags: [OTA]
 *     summary: Get OTA status
 *     description: |
 *       Returns OTA system status including available firmware versions
 *       and update statistics. This is a public status endpoint.
 *     parameters:
 *       - in: query
 *         name: type
 *         schema:
 *           type: string
 *         description: Filter by firmware type (e.g., esp32, esp32s3)
 *     responses:
 *       200:
 *         description: OTA system status
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
 *                   example: success
 *                 data:
 *                   type: object
 *                   properties:
 *                     status:
 *                       type: string
 *                       example: online
 *                     latestVersions:
 *                       type: object
 *                       additionalProperties:
 *                         type: object
 *                         properties:
 *                           version:
 *                             type: string
 *                           forceUpdate:
 *                             type: boolean
 *                     serverTime:
 *                       type: integer
 */
router.get('/',
  asyncHandler(async (req, res) => {
    const type = req.query.type;

    try {
      // Get firmware status
      const latestVersions = {};

      if (type) {
        // Get latest for specific type
        const firmware = await deviceService.getLatestFirmware(type);
        if (firmware) {
          latestVersions[type] = {
            version: firmware.version,
            forceUpdate: firmware.force_update === 1
          };
        }
      } else {
        // Get latest for common types
        const types = ['esp32', 'esp32s3', 'esp32c3'];
        for (const t of types) {
          const firmware = await deviceService.getLatestFirmware(t);
          if (firmware) {
            latestVersions[t] = {
              version: firmware.version,
              forceUpdate: firmware.force_update === 1
            };
          }
        }
      }

      const response = {
        status: 'online',
        latestVersions,
        serverTime: Date.now()
      };

      success(res, response);
    } catch (error) {
      logger.error('OTA status check failed:', error);
      badRequest(res, error.message);
    }
  })
);

module.exports = router;
