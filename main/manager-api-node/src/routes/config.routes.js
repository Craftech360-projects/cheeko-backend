/**
 * Config Routes
 *
 * Configuration endpoints used by LiveKit workers to get device/agent settings.
 * Base path: /config
 */

const express = require('express');
const router = express.Router();
const configService = require('../services/config.service');
const { asyncHandler } = require('../middleware/errorHandler');
const { success, badRequest, notFound } = require('../utils/response');
const logger = require('../utils/logger');

/**
 * @swagger
 * /config/server-base:
 *   post:
 *     tags: [Config]
 *     summary: Get server-side base configuration
 *     description: Returns server-side settings for LiveKit workers
 *     responses:
 *       200:
 *         description: Server configuration
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 serverVersion:
 *                   type: string
 *                 platform:
 *                   type: string
 *                 config:
 *                   type: object
 */
router.post('/server-base',
  asyncHandler(async (req, res) => {
    try {
      const config = await configService.getServerBaseConfig();
      success(res, config);
    } catch (error) {
      badRequest(res, error.message);
    }
  })
);

/**
 * @swagger
 * /config/agent-models:
 *   post:
 *     tags: [Config]
 *     summary: Get agent models for device
 *     description: Returns all model configurations for the device's agent
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - macAddress
 *             properties:
 *               macAddress:
 *                 type: string
 *                 description: Device MAC address
 *     responses:
 *       200:
 *         description: Agent model configuration
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 agentId:
 *                   type: string
 *                 agentName:
 *                   type: string
 *                 models:
 *                   type: object
 *                 voice:
 *                   type: object
 *       400:
 *         description: Missing macAddress or device not found
 */
router.post('/agent-models',
  asyncHandler(async (req, res) => {
    const { macAddress } = req.body;

    if (!macAddress) {
      return badRequest(res, 'macAddress is required');
    }

    try {
      const config = await configService.getAgentModels(macAddress);
      success(res, config);
    } catch (error) {
      if (error.message.includes('not found')) {
        return notFound(res, error.message);
      }
      badRequest(res, error.message);
    }
  })
);

/**
 * @swagger
 * /config/agent-prompt:
 *   post:
 *     tags: [Config]
 *     summary: Get agent prompt by MAC address
 *     description: Returns the system prompt configuration for the device's agent
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - macAddress
 *             properties:
 *               macAddress:
 *                 type: string
 *                 description: Device MAC address
 *     responses:
 *       200:
 *         description: Agent prompt configuration
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 agentId:
 *                   type: string
 *                 agentName:
 *                   type: string
 *                 systemPrompt:
 *                   type: string
 *                 summaryMemory:
 *                   type: string
 *                 langCode:
 *                   type: string
 *       400:
 *         description: Missing macAddress or device not found
 */
router.post('/agent-prompt',
  asyncHandler(async (req, res) => {
    const { macAddress } = req.body;

    if (!macAddress) {
      return badRequest(res, 'macAddress is required');
    }

    try {
      const config = await configService.getAgentPrompt(macAddress);
      success(res, config);
    } catch (error) {
      if (error.message.includes('not found')) {
        return notFound(res, error.message);
      }
      badRequest(res, error.message);
    }
  })
);

/**
 * @swagger
 * /config/child-profile-by-mac:
 *   post:
 *     tags: [Config]
 *     summary: Get child profile by device MAC
 *     description: Returns the kid profile associated with the device
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - macAddress
 *             properties:
 *               macAddress:
 *                 type: string
 *                 description: Device MAC address
 *     responses:
 *       200:
 *         description: Child profile (null if not configured)
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               nullable: true
 *               properties:
 *                 id:
 *                   type: integer
 *                 name:
 *                   type: string
 *                 age:
 *                   type: integer
 *                 gender:
 *                   type: string
 *                 interests:
 *                   type: array
 *       400:
 *         description: Missing macAddress or device not found
 */
router.post('/child-profile-by-mac',
  asyncHandler(async (req, res) => {
    const { macAddress } = req.body;
    logger.info(`[CONFIG] POST /child-profile-by-mac request: macAddress=${macAddress}`);

    if (!macAddress) {
      return badRequest(res, 'macAddress is required');
    }

    try {
      const profile = await configService.getChildProfileByMac(macAddress);
      logger.info(`[CONFIG] POST /child-profile-by-mac response: ${JSON.stringify(profile)}`);
      success(res, profile);
    } catch (error) {
      logger.info(`[CONFIG] POST /child-profile-by-mac error: ${error.message}`);
      if (error.message.includes('not found')) {
        return notFound(res, error.message);
      }
      badRequest(res, error.message);
    }
  })
);

/**
 * @swagger
 * /config/agent-template-id:
 *   post:
 *     tags: [Config]
 *     summary: Get agent template ID by MAC
 *     description: Returns the template ID if the device's agent was created from a template
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - macAddress
 *             properties:
 *               macAddress:
 *                 type: string
 *                 description: Device MAC address
 *     responses:
 *       200:
 *         description: Agent template ID info
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 agentId:
 *                   type: string
 *                 agentCode:
 *                   type: string
 *                 agentName:
 *                   type: string
 *                 templateId:
 *                   type: string
 *                   nullable: true
 *       400:
 *         description: Missing macAddress or device not found
 */
router.post('/agent-template-id',
  asyncHandler(async (req, res) => {
    const { macAddress } = req.body;

    if (!macAddress) {
      return badRequest(res, 'macAddress is required');
    }

    try {
      const result = await configService.getAgentTemplateIdByMac(macAddress);
      success(res, result);
    } catch (error) {
      if (error.message.includes('not found')) {
        return notFound(res, error.message);
      }
      badRequest(res, error.message);
    }
  })
);

/**
 * @swagger
 * /config/template/{templateId}:
 *   get:
 *     tags: [Config]
 *     summary: Get template content (personality)
 *     description: Returns the full template configuration by ID
 *     parameters:
 *       - in: path
 *         name: templateId
 *         required: true
 *         schema:
 *           type: string
 *         description: Template ID
 *     responses:
 *       200:
 *         description: Template content
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 id:
 *                   type: string
 *                 agentCode:
 *                   type: string
 *                 agentName:
 *                   type: string
 *                 systemPrompt:
 *                   type: string
 *                 summaryMemory:
 *                   type: string
 *                 langCode:
 *                   type: string
 *       404:
 *         description: Template not found
 */
router.get('/template/:templateId',
  asyncHandler(async (req, res) => {
    try {
      const template = await configService.getTemplateContent(req.params.templateId);
      if (!template) {
        return notFound(res, 'Template not found');
      }
      success(res, template);
    } catch (error) {
      badRequest(res, error.message);
    }
  })
);

/**
 * @swagger
 * /config/device-location:
 *   post:
 *     tags: [Config]
 *     summary: Get device location info
 *     description: Returns cached location information for the device
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - macAddress
 *             properties:
 *               macAddress:
 *                 type: string
 *                 description: Device MAC address
 *     responses:
 *       200:
 *         description: Device location info
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 macAddress:
 *                   type: string
 *                 deviceId:
 *                   type: string
 *                 location:
 *                   type: object
 *                   nullable: true
 *                 timezone:
 *                   type: string
 *                   nullable: true
 *       400:
 *         description: Missing macAddress or device not found
 */
router.post('/device-location',
  asyncHandler(async (req, res) => {
    const { macAddress } = req.body;

    if (!macAddress) {
      return badRequest(res, 'macAddress is required');
    }

    try {
      const location = await configService.getDeviceLocation(macAddress);
      success(res, location);
    } catch (error) {
      if (error.message.includes('not found')) {
        return notFound(res, error.message);
      }
      badRequest(res, error.message);
    }
  })
);

/**
 * @swagger
 * /config/weather:
 *   post:
 *     tags: [Config]
 *     summary: Get weather forecast by location
 *     description: Returns weather forecast for the specified location
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               latitude:
 *                 type: number
 *                 description: Location latitude
 *               longitude:
 *                 type: number
 *                 description: Location longitude
 *               city:
 *                 type: string
 *                 description: City name (optional alternative to lat/long)
 *     responses:
 *       200:
 *         description: Weather forecast
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 available:
 *                   type: boolean
 *                 message:
 *                   type: string
 *                 location:
 *                   type: object
 *                 forecast:
 *                   type: object
 *                   nullable: true
 */
router.post('/weather',
  asyncHandler(async (req, res) => {
    const { latitude, longitude, city } = req.body;

    try {
      const weather = await configService.getWeather({ latitude, longitude, city });
      success(res, weather);
    } catch (error) {
      badRequest(res, error.message);
    }
  })
);

/**
 * @swagger
 * /config/assign-child-profile:
 *   post:
 *     tags: [Config]
 *     summary: Create and assign child profile to device (service endpoint)
 *     description: Internal endpoint for creating and assigning a child profile to a device
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - macAddress
 *               - name
 *             properties:
 *               macAddress:
 *                 type: string
 *               name:
 *                 type: string
 *               dateOfBirth:
 *                 type: string
 *                 format: date
 *               gender:
 *                 type: string
 *               interests:
 *                 type: array
 *                 items:
 *                   type: string
 *     responses:
 *       200:
 *         description: Child profile created and assigned
 */
router.post('/assign-child-profile',
  asyncHandler(async (req, res) => {
    const { macAddress, name, dateOfBirth, gender, interests, additionalNotes } = req.body;

    // Verify service secret header
    const secret = req.headers['secret'];
    if (!secret || secret !== process.env.SERVICE_SECRET_KEY) {
      return badRequest(res, 'Invalid or missing service secret');
    }

    if (!macAddress || !name) {
      return badRequest(res, 'macAddress and name are required');
    }

    try {
      const result = await configService.createAndAssignChildProfile(macAddress, {
        name,
        dateOfBirth,
        gender,
        interests,
        additionalNotes
      });
      logger.info(`[CONFIG] POST /assign-child-profile response: ${JSON.stringify(result)}`);
      success(res, result, 'Child profile created and assigned');
    } catch (error) {
      logger.info(`[CONFIG] POST /assign-child-profile error: ${error.message}`);
      badRequest(res, error.message);
    }
  })
);

module.exports = router;
