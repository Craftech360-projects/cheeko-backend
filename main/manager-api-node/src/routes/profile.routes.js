/**
 * Profile Routes
 *
 * Handles kid profiles and preferences.
 * Base path: /api/mobile
 */

const express = require('express');
const router = express.Router();
const profileService = require('../services/profile.service');
const { asyncHandler } = require('../middleware/errorHandler');
const { requireAuth } = require('../middleware/auth');
const { success, badRequest, notFound } = require('../utils/response');

/**
 * @swagger
 * components:
 *   schemas:
 *     KidProfile:
 *       type: object
 *       properties:
 *         id:
 *           type: integer
 *           description: Kid profile ID
 *         user_id:
 *           type: string
 *           description: Parent user ID
 *         name:
 *           type: string
 *           description: Kid's name
 *         nickname:
 *           type: string
 *           description: Kid's nickname
 *         avatar_url:
 *           type: string
 *           description: URL to kid's avatar image
 *         birth_date:
 *           type: string
 *           format: date
 *           description: Kid's date of birth
 *         gender:
 *           type: string
 *           enum: [male, female, other]
 *           description: Kid's gender
 *         grade:
 *           type: string
 *           description: Kid's school grade
 *         school:
 *           type: string
 *           description: Kid's school name
 *         interests:
 *           type: array
 *           items:
 *             type: string
 *           description: Kid's interests
 *         language:
 *           type: string
 *           description: Preferred language (default 'en')
 *         timezone:
 *           type: string
 *           description: Kid's timezone
 *         preferences:
 *           type: object
 *           description: Additional preferences
 *         created_at:
 *           type: string
 *           format: date-time
 *         updated_at:
 *           type: string
 *           format: date-time
 *     KidProfileInput:
 *       type: object
 *       required:
 *         - name
 *       properties:
 *         name:
 *           type: string
 *           description: Kid's name (required)
 *         nickname:
 *           type: string
 *           description: Kid's nickname
 *         avatarUrl:
 *           type: string
 *           description: URL to kid's avatar image
 *         birthDate:
 *           type: string
 *           format: date
 *           description: Kid's date of birth (YYYY-MM-DD)
 *         gender:
 *           type: string
 *           enum: [male, female, other]
 *           description: Kid's gender
 *         grade:
 *           type: string
 *           description: Kid's school grade
 *         school:
 *           type: string
 *           description: Kid's school name
 *         interests:
 *           type: array
 *           items:
 *             type: string
 *           description: Kid's interests
 *         language:
 *           type: string
 *           description: Preferred language (default 'en')
 *         timezone:
 *           type: string
 *           description: Kid's timezone
 *         preferences:
 *           type: object
 *           description: Additional preferences
 */

/**
 * @swagger
 * /api/mobile/kids/list:
 *   get:
 *     tags: [Profile]
 *     summary: List kid profiles
 *     description: Get all kid profiles for the authenticated user (PRD-compliant path)
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: List of kid profiles
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
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/KidProfile'
 *       401:
 *         description: Unauthorized - authentication required
 */
router.get('/kids/list',
  requireAuth,
  asyncHandler(async (req, res) => {
    const profiles = await profileService.getKidProfiles(req.user.id);
    success(res, profiles);
  })
);

/**
 * @swagger
 * /api/mobile/kids/create:
 *   post:
 *     tags: [Profile]
 *     summary: Create kid profile
 *     description: Create a new kid profile for the authenticated user (PRD-compliant path)
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/KidProfileInput'
 *     responses:
 *       200:
 *         description: Kid profile created successfully
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
 *                   example: Kid profile created successfully
 *                 data:
 *                   $ref: '#/components/schemas/KidProfile'
 *       400:
 *         description: Bad request - validation error
 *       401:
 *         description: Unauthorized - authentication required
 */
router.post('/kids/create',
  requireAuth,
  asyncHandler(async (req, res) => {
    if (!req.body.name) {
      return badRequest(res, 'Name is required');
    }

    try {
      const profile = await profileService.createKid(req.user.id, req.body);
      success(res, profile, 'Kid profile created successfully');
    } catch (error) {
      badRequest(res, error.message);
    }
  })
);

// Legacy/REST-style routes (backward compatibility)

/**
 * @swagger
 * /api/mobile/kids:
 *   get:
 *     tags: [Profile]
 *     summary: Get all kid profiles (legacy)
 *     description: Alias for /api/mobile/kids/list (REST-style)
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: List of kid profiles
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
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/KidProfile'
 *       401:
 *         description: Unauthorized - authentication required
 */
router.get('/kids',
  requireAuth,
  asyncHandler(async (req, res) => {
    const profiles = await profileService.getKidProfiles(req.user.id);
    success(res, profiles);
  })
);

/**
 * @swagger
 * /api/mobile/kids/{id}:
 *   get:
 *     tags: [Profile]
 *     summary: Get kid profile by ID
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: Kid profile
 */
router.get('/kids/:id',
  requireAuth,
  asyncHandler(async (req, res) => {
    const profile = await profileService.getKidById(req.user.id, parseInt(req.params.id));
    if (!profile) {
      return notFound(res, 'Kid profile not found');
    }
    success(res, profile);
  })
);

/**
 * @swagger
 * /api/mobile/kids:
 *   post:
 *     tags: [Profile]
 *     summary: Create kid profile
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - name
 *             properties:
 *               name:
 *                 type: string
 *               nickname:
 *                 type: string
 *               avatarUrl:
 *                 type: string
 *               birthDate:
 *                 type: string
 *                 format: date
 *               gender:
 *                 type: string
 *                 enum: [male, female, other]
 *               grade:
 *                 type: string
 *               school:
 *                 type: string
 *               interests:
 *                 type: array
 *                 items:
 *                   type: string
 *               language:
 *                 type: string
 *               timezone:
 *                 type: string
 *     responses:
 *       200:
 *         description: Kid profile created
 */
router.post('/kids',
  requireAuth,
  asyncHandler(async (req, res) => {
    if (!req.body.name) {
      return badRequest(res, 'Name is required');
    }

    try {
      const profile = await profileService.createKid(req.user.id, req.body);
      success(res, profile, 'Kid profile created successfully');
    } catch (error) {
      badRequest(res, error.message);
    }
  })
);

/**
 * @swagger
 * /api/mobile/kids/{id}:
 *   put:
 *     tags: [Profile]
 *     summary: Update kid profile
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: Kid profile updated
 */
router.put('/kids/:id',
  requireAuth,
  asyncHandler(async (req, res) => {
    try {
      const profile = await profileService.updateKid(
        req.user.id,
        parseInt(req.params.id),
        req.body
      );
      success(res, profile, 'Kid profile updated successfully');
    } catch (error) {
      badRequest(res, error.message);
    }
  })
);

/**
 * @swagger
 * /api/mobile/kids/{id}:
 *   delete:
 *     tags: [Profile]
 *     summary: Delete kid profile
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: Kid profile deleted
 */
router.delete('/kids/:id',
  requireAuth,
  asyncHandler(async (req, res) => {
    try {
      await profileService.deleteKid(req.user.id, parseInt(req.params.id));
      success(res, null, 'Kid profile deleted successfully');
    } catch (error) {
      badRequest(res, error.message);
    }
  })
);

/**
 * @swagger
 * /api/mobile/kids/{id}/progress:
 *   get:
 *     tags: [Profile]
 *     summary: Get kid's learning progress
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: Learning progress
 */
router.get('/kids/:id/progress',
  requireAuth,
  asyncHandler(async (req, res) => {
    try {
      const progress = await profileService.getProgress(
        req.user.id,
        parseInt(req.params.id)
      );
      success(res, progress);
    } catch (error) {
      badRequest(res, error.message);
    }
  })
);

/**
 * @swagger
 * /api/mobile/kids/{id}/progress:
 *   post:
 *     tags: [Profile]
 *     summary: Update learning progress
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - subject
 *               - topic
 *             properties:
 *               subject:
 *                 type: string
 *               topic:
 *                 type: string
 *               score:
 *                 type: integer
 *               timeSpent:
 *                 type: integer
 *               completed:
 *                 type: boolean
 *     responses:
 *       200:
 *         description: Progress updated
 */
router.post('/kids/:id/progress',
  requireAuth,
  asyncHandler(async (req, res) => {
    try {
      const progress = await profileService.updateProgress(
        parseInt(req.params.id),
        req.body
      );
      success(res, progress, 'Progress updated successfully');
    } catch (error) {
      badRequest(res, error.message);
    }
  })
);

/**
 * @swagger
 * /api/mobile/kids/{id}/activity:
 *   get:
 *     tags: [Profile]
 *     summary: Get kid's activity history
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: Activity history
 */
router.get('/kids/:id/activity',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { page, limit } = req.query;
    try {
      const result = await profileService.getActivityHistory(
        req.user.id,
        parseInt(req.params.id),
        {
          page: parseInt(page) || 1,
          limit: parseInt(limit) || 20
        }
      );
      success(res, result);
    } catch (error) {
      badRequest(res, error.message);
    }
  })
);

/**
 * @swagger
 * /api/mobile/kids/{id}/activity:
 *   post:
 *     tags: [Profile]
 *     summary: Log kid activity
 *     description: Internal endpoint for logging activities
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - activityType
 *             properties:
 *               activityType:
 *                 type: string
 *                 enum: [conversation, music, story, game, learning]
 *               contentType:
 *                 type: string
 *               contentId:
 *                 type: string
 *               duration:
 *                 type: integer
 *     responses:
 *       200:
 *         description: Activity logged
 */
router.post('/kids/:id/activity',
  asyncHandler(async (req, res) => {
    try {
      const activity = await profileService.logActivity(
        parseInt(req.params.id),
        req.body
      );
      success(res, activity);
    } catch (error) {
      badRequest(res, error.message);
    }
  })
);

/**
 * @swagger
 * /api/mobile/kids/{id}/preferences:
 *   get:
 *     tags: [Profile]
 *     summary: Get kid preferences
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: Kid preferences
 */
router.get('/kids/:id/preferences',
  requireAuth,
  asyncHandler(async (req, res) => {
    const prefs = await profileService.getPreferences(parseInt(req.params.id));
    if (!prefs) {
      return notFound(res, 'Kid profile not found');
    }
    success(res, prefs);
  })
);

/**
 * @swagger
 * /api/mobile/kids/{id}/preferences:
 *   put:
 *     tags: [Profile]
 *     summary: Update kid preferences
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               volumeLevel:
 *                 type: integer
 *               voiceSpeed:
 *                 type: number
 *               preferredVoice:
 *                 type: string
 *               contentFilters:
 *                 type: array
 *                 items:
 *                   type: string
 *     responses:
 *       200:
 *         description: Preferences updated
 */
router.put('/kids/:id/preferences',
  requireAuth,
  asyncHandler(async (req, res) => {
    try {
      const prefs = await profileService.updatePreferences(
        req.user.id,
        parseInt(req.params.id),
        req.body
      );
      success(res, prefs, 'Preferences updated successfully');
    } catch (error) {
      badRequest(res, error.message);
    }
  })
);

module.exports = router;
