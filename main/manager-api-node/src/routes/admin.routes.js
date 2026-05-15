/**
 * Admin Routes
 *
 * Handles admin operations (super admin only):
 * - User management
 * - System statistics
 *
 * Base path: /admin
 *
 * Endpoints:
 * - GET /admin/users/page - List users (paginated, super admin)
 * - GET /admin/users/list - List all users (super admin)
 * - GET /admin/users/:id - Get user by ID (super admin)
 * - POST /admin/users - Create user (super admin)
 * - PUT /admin/users/:id - Update user (super admin)
 * - DELETE /admin/users/:id - Delete user (super admin)
 * - DELETE /admin/users - Batch delete users (super admin)
 * - PUT /admin/users/:id/status - Update user status (super admin)
 * - PUT /admin/users/:id/password - Reset user password (super admin)
 * - PUT /admin/users/:id/super-admin - Set super admin flag (super admin)
 *
 * - GET /admin/stats/overview - System overview (super admin)
 * - GET /admin/stats/users - User registration stats (super admin)
 * - GET /admin/stats/devices - Device registration stats (super admin)
 * - GET /admin/stats/content - Content stats (super admin)
 * - GET /admin/stats/sessions - Session stats (super admin)
 * - GET /admin/stats/tokens - Token usage stats (super admin)
 * - GET /admin/stats/active - Active sessions (super admin)
 */

const express = require('express');
const router = express.Router();
const adminService = require('../services/admin.service');
const deviceSettingsService = require('../services/deviceSettings.service');
const { asyncHandler } = require('../middleware/errorHandler');
const { requireAuth, requireSuperAdmin } = require('../middleware/auth');
const { success, badRequest, notFound } = require('../utils/response');

/**
 * @swagger
 * components:
 *   schemas:
 *     AdminUser:
 *       type: object
 *       properties:
 *         id:
 *           type: integer
 *           description: User ID
 *         username:
 *           type: string
 *           description: Unique username
 *         status:
 *           type: integer
 *           enum: [0, 1]
 *           description: 0=disabled, 1=enabled
 *         super_admin:
 *           type: integer
 *           enum: [0, 1]
 *           description: 0=normal user, 1=super admin
 *         created_at:
 *           type: string
 *           format: date-time
 *         updated_at:
 *           type: string
 *           format: date-time
 *     AdminUserInput:
 *       type: object
 *       required:
 *         - username
 *         - password
 *       properties:
 *         username:
 *           type: string
 *           description: Unique username
 *         password:
 *           type: string
 *           description: User password
 *         status:
 *           type: integer
 *           enum: [0, 1]
 *           default: 1
 *           description: 0=disabled, 1=enabled
 *         superAdmin:
 *           type: integer
 *           enum: [0, 1]
 *           default: 0
 *           description: 0=normal user, 1=super admin
 *     SystemOverview:
 *       type: object
 *       properties:
 *         totalUsers:
 *           type: integer
 *         activeUsers:
 *           type: integer
 *         superAdmins:
 *           type: integer
 *         totalDevices:
 *           type: integer
 *         onlineDevices:
 *           type: integer
 *         totalAgents:
 *           type: integer
 *         totalContent:
 *           type: integer
 *         totalKids:
 *           type: integer
 *         totalRfidCards:
 *           type: integer
 *     RegistrationStats:
 *       type: object
 *       properties:
 *         period:
 *           type: integer
 *           description: Number of days in period
 *         data:
 *           type: array
 *           items:
 *             type: object
 *             properties:
 *               date:
 *                 type: string
 *                 format: date
 *               count:
 *                 type: integer
 *         total:
 *           type: integer
 *     ContentStats:
 *       type: object
 *       properties:
 *         total:
 *           type: integer
 *         byType:
 *           type: object
 *           additionalProperties:
 *             type: integer
 *     TokenUsageStats:
 *       type: object
 *       properties:
 *         period:
 *           type: integer
 *         totalInputTokens:
 *           type: integer
 *         totalOutputTokens:
 *           type: integer
 *         totalTokens:
 *           type: integer
 *         dailyStats:
 *           type: object
 *           additionalProperties:
 *             type: object
 *             properties:
 *               input:
 *                 type: integer
 *               output:
 *                 type: integer
 *               total:
 *                 type: integer
 */

// ==================== USER MANAGEMENT ====================

/**
 * @swagger
 * /admin/users:
 *   get:
 *     tags: [Admin - User Management]
 *     summary: List users (Spring Boot compatible)
 *     description: Returns a paginated list of users in Spring Boot format for manager-web frontend
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
 *         name: mobile
 *         schema:
 *           type: string
 *         description: Filter by mobile/username
 *     responses:
 *       200:
 *         description: Paginated user list
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
 *                         type: object
 *                         properties:
 *                           userid:
 *                             type: integer
 *                           mobile:
 *                             type: string
 *                           deviceCount:
 *                             type: string
 *                           status:
 *                             type: integer
 *                           createDate:
 *                             type: string
 *                             format: date-time
 *                     total:
 *                       type: integer
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Super admin access required
 */
router.get('/users',
  requireAuth,
  requireSuperAdmin,
  asyncHandler(async (req, res) => {
    const { page, limit, mobile } = req.query;
    const result = await adminService.listUsersForAdmin({
      page: parseInt(page) || 1,
      limit: parseInt(limit) || 10,
      mobile
    });
    success(res, result);
  })
);

/**
 * @swagger
 * /admin/users/changeStatus/{status}:
 *   put:
 *     tags: [Admin - User Management]
 *     summary: Batch update user status
 *     description: Enable or disable multiple users at once (super admin only)
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: status
 *         required: true
 *         schema:
 *           type: integer
 *           enum: [0, 1]
 *         description: New status (0=disabled, 1=enabled)
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: array
 *             items:
 *               type: integer
 *             description: Array of user IDs to update
 *     responses:
 *       200:
 *         description: User status updated successfully
 *       400:
 *         description: Validation error
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Super admin access required
 */
router.put('/users/changeStatus/:status',
  requireAuth,
  requireSuperAdmin,
  asyncHandler(async (req, res) => {
    const status = parseInt(req.params.status);
    const userIds = req.body;

    if (status !== 0 && status !== 1) {
      return badRequest(res, 'Status must be 0 or 1');
    }

    if (!Array.isArray(userIds) || userIds.length === 0) {
      return badRequest(res, 'User IDs array is required');
    }

    try {
      await adminService.batchUpdateUserStatus(userIds, status);
      success(res, null, 'User status updated successfully');
    } catch (error) {
      badRequest(res, error.message);
    }
  })
);

/**
 * @swagger
 * /admin/users/page:
 *   get:
 *     tags: [Admin - User Management]
 *     summary: List users (paginated)
 *     description: Returns a paginated list of users (super admin only)
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
 *           default: 20
 *         description: Items per page
 *       - in: query
 *         name: status
 *         schema:
 *           type: integer
 *           enum: [0, 1]
 *         description: Filter by status
 *       - in: query
 *         name: superAdmin
 *         schema:
 *           type: integer
 *           enum: [0, 1]
 *         description: Filter by super admin flag
 *       - in: query
 *         name: search
 *         schema:
 *           type: string
 *         description: Search by username
 *     responses:
 *       200:
 *         description: Paginated user list
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
 *                         $ref: '#/components/schemas/AdminUser'
 *                     total:
 *                       type: integer
 *                     page:
 *                       type: integer
 *                     limit:
 *                       type: integer
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Super admin access required
 */
router.get('/users/page',
  requireAuth,
  requireSuperAdmin,
  asyncHandler(async (req, res) => {
    const { page, limit, status, superAdmin, search } = req.query;
    const result = await adminService.listUsers({
      page: parseInt(page) || 1,
      limit: parseInt(limit) || 20,
      status: status !== undefined ? parseInt(status) : undefined,
      superAdmin: superAdmin !== undefined ? parseInt(superAdmin) : undefined,
      search
    });
    success(res, result);
  })
);

/**
 * @swagger
 * /admin/users/list:
 *   get:
 *     tags: [Admin - User Management]
 *     summary: List all users
 *     description: Returns all users without pagination (super admin only)
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: List of all users
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
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/AdminUser'
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Super admin access required
 */
router.get('/users/list',
  requireAuth,
  requireSuperAdmin,
  asyncHandler(async (req, res) => {
    const users = await adminService.getAllUsers();
    success(res, users);
  })
);

/**
 * @swagger
 * /admin/users:
 *   post:
 *     tags: [Admin - User Management]
 *     summary: Create user
 *     description: Create a new user (super admin only)
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/AdminUserInput'
 *     responses:
 *       200:
 *         description: User created successfully
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
 *                   $ref: '#/components/schemas/AdminUser'
 *       400:
 *         description: Validation error
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Super admin access required
 *   delete:
 *     tags: [Admin - User Management]
 *     summary: Batch delete users
 *     description: Delete multiple users by IDs (super admin only)
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - ids
 *             properties:
 *               ids:
 *                 type: array
 *                 items:
 *                   type: integer
 *                 description: Array of user IDs to delete
 *     responses:
 *       200:
 *         description: Users deleted successfully
 *       400:
 *         description: Validation error
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Super admin access required
 */
router.post('/users',
  requireAuth,
  requireSuperAdmin,
  asyncHandler(async (req, res) => {
    if (!req.body.username || !req.body.password) {
      return badRequest(res, 'Username and password are required');
    }

    try {
      const user = await adminService.createUser(req.user.id, req.body);
      success(res, user, 'User created successfully');
    } catch (error) {
      badRequest(res, error.message);
    }
  })
);

router.delete('/users',
  requireAuth,
  requireSuperAdmin,
  asyncHandler(async (req, res) => {
    const { ids } = req.body;

    if (!ids || !Array.isArray(ids) || ids.length === 0) {
      return badRequest(res, 'IDs array is required');
    }

    try {
      await adminService.deleteUsers(ids);
      success(res, null, 'Users deleted successfully');
    } catch (error) {
      badRequest(res, error.message);
    }
  })
);

/**
 * @swagger
 * /admin/users/{id}:
 *   get:
 *     tags: [Admin - User Management]
 *     summary: Get user by ID
 *     description: Retrieve a user by ID (super admin only)
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *         description: User ID
 *     responses:
 *       200:
 *         description: User details
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 code:
 *                   type: integer
 *                 data:
 *                   $ref: '#/components/schemas/AdminUser'
 *       404:
 *         description: User not found
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Super admin access required
 *   put:
 *     tags: [Admin - User Management]
 *     summary: Update user
 *     description: Update an existing user (super admin only)
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *         description: User ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               username:
 *                 type: string
 *               password:
 *                 type: string
 *               status:
 *                 type: integer
 *                 enum: [0, 1]
 *               superAdmin:
 *                 type: integer
 *                 enum: [0, 1]
 *     responses:
 *       200:
 *         description: User updated successfully
 *       400:
 *         description: Validation error
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Super admin access required
 *   delete:
 *     tags: [Admin - User Management]
 *     summary: Delete user
 *     description: Delete a user by ID (super admin only)
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *         description: User ID
 *     responses:
 *       200:
 *         description: User deleted successfully
 *       400:
 *         description: Error deleting user
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Super admin access required
 */
router.get('/users/:id',
  requireAuth,
  requireSuperAdmin,
  asyncHandler(async (req, res) => {
    const user = await adminService.getUserById(req.params.id);
    if (!user) {
      return notFound(res, 'User not found');
    }
    success(res, user);
  })
);

router.put('/users/:id',
  requireAuth,
  requireSuperAdmin,
  asyncHandler(async (req, res) => {
    try {
      // Spring Boot behavior: reset password and return new password
      const newPassword = await adminService.resetPasswordAndReturn(req.params.id);
      success(res, newPassword);
    } catch (error) {
      badRequest(res, error.message);
    }
  })
);

router.delete('/users/:id',
  requireAuth,
  requireSuperAdmin,
  asyncHandler(async (req, res) => {
    try {
      await adminService.deleteUser(req.params.id);
      success(res, null, 'User deleted successfully');
    } catch (error) {
      badRequest(res, error.message);
    }
  })
);

/**
 * @swagger
 * /admin/users/{id}/status:
 *   put:
 *     tags: [Admin - User Management]
 *     summary: Update user status
 *     description: Enable or disable a user (super admin only)
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *         description: User ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - status
 *             properties:
 *               status:
 *                 type: integer
 *                 enum: [0, 1]
 *                 description: 0=disabled, 1=enabled
 *     responses:
 *       200:
 *         description: User status updated successfully
 *       400:
 *         description: Validation error
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Super admin access required
 */
router.put('/users/:id/status',
  requireAuth,
  requireSuperAdmin,
  asyncHandler(async (req, res) => {
    if (req.body.status === undefined) {
      return badRequest(res, 'Status is required');
    }

    try {
      const user = await adminService.updateUserStatus(req.params.id, req.body.status);
      success(res, user, 'User status updated successfully');
    } catch (error) {
      badRequest(res, error.message);
    }
  })
);

/**
 * @swagger
 * /admin/users/{id}/password:
 *   put:
 *     tags: [Admin - User Management]
 *     summary: Reset user password
 *     description: Reset a user's password (super admin only)
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *         description: User ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - password
 *             properties:
 *               password:
 *                 type: string
 *                 description: New password
 *     responses:
 *       200:
 *         description: Password reset successfully
 *       400:
 *         description: Validation error
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Super admin access required
 */
router.put('/users/:id/password',
  requireAuth,
  requireSuperAdmin,
  asyncHandler(async (req, res) => {
    if (!req.body.password) {
      return badRequest(res, 'Password is required');
    }

    try {
      const user = await adminService.resetUserPassword(req.params.id, req.body.password);
      success(res, user, 'Password reset successfully');
    } catch (error) {
      badRequest(res, error.message);
    }
  })
);

/**
 * @swagger
 * /admin/users/{id}/super-admin:
 *   put:
 *     tags: [Admin - User Management]
 *     summary: Set super admin flag
 *     description: Grant or revoke super admin privileges (super admin only)
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *         description: User ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - superAdmin
 *             properties:
 *               superAdmin:
 *                 type: integer
 *                 enum: [0, 1]
 *                 description: 0=revoke, 1=grant
 *     responses:
 *       200:
 *         description: Super admin status updated successfully
 *       400:
 *         description: Validation error
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Super admin access required
 */
router.put('/users/:id/super-admin',
  requireAuth,
  requireSuperAdmin,
  asyncHandler(async (req, res) => {
    if (req.body.superAdmin === undefined) {
      return badRequest(res, 'superAdmin flag is required');
    }

    try {
      const user = await adminService.setUserSuperAdmin(req.params.id, req.body.superAdmin);
      success(res, user, 'Super admin status updated successfully');
    } catch (error) {
      badRequest(res, error.message);
    }
  })
);

// ==================== KID PROFILES ====================

/**
 * @swagger
 * /admin/users/{id}/kids:
 *   get:
 *     tags: [Admin - User Management]
 *     summary: Get user's kid profiles
 *     description: Returns all kid profiles for a specific user (super admin only)
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *         description: User ID
 *     responses:
 *       200:
 *         description: List of kid profiles
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Super admin access required
 */
router.get('/users/:id/kids',
  requireAuth,
  requireSuperAdmin,
  asyncHandler(async (req, res) => {
    const userId = parseInt(req.params.id);
    console.log('[admin.routes] GET /users/:id/kids - userId:', userId);

    if (isNaN(userId)) {
      return badRequest(res, 'Invalid user ID');
    }

    try {
      const profiles = await adminService.getKidProfilesByUserId(userId);
      success(res, profiles);
    } catch (error) {
      console.error('[admin.routes] Error:', error.message);
      badRequest(res, error.message);
    }
  })
);

/**
 * @swagger
 * /admin/users/{id}/kids:
 *   post:
 *     tags: [Admin - User Management]
 *     summary: Create kid profile for user
 *     description: Creates a new kid profile for a specific user (super admin only)
 *     security:
 *       - bearerAuth: []
 */
router.post('/users/:id/kids',
  requireAuth,
  requireSuperAdmin,
  asyncHandler(async (req, res) => {
    const userId = parseInt(req.params.id);

    if (isNaN(userId)) {
      return badRequest(res, 'Invalid user ID');
    }

    try {
      const profile = await adminService.createKidProfileForUser(userId, req.body);
      success(res, profile, 'Kid profile created successfully');
    } catch (error) {
      badRequest(res, error.message);
    }
  })
);

/**
 * @swagger
 * /admin/kids/{kidId}:
 *   put:
 *     tags: [Admin - User Management]
 *     summary: Update kid profile (admin)
 */
router.put('/kids/:kidId',
  requireAuth,
  requireSuperAdmin,
  asyncHandler(async (req, res) => {
    const kidId = parseInt(req.params.kidId);

    if (isNaN(kidId)) {
      return badRequest(res, 'Invalid kid ID');
    }

    try {
      const profile = await adminService.updateKidProfile(kidId, req.body);
      success(res, profile, 'Kid profile updated successfully');
    } catch (error) {
      badRequest(res, error.message);
    }
  })
);

/**
 * @swagger
 * /admin/kids/{kidId}:
 *   delete:
 *     tags: [Admin - User Management]
 *     summary: Delete kid profile (admin)
 */
router.delete('/kids/:kidId',
  requireAuth,
  requireSuperAdmin,
  asyncHandler(async (req, res) => {
    const kidId = parseInt(req.params.kidId);

    if (isNaN(kidId)) {
      return badRequest(res, 'Invalid kid ID');
    }

    try {
      await adminService.deleteKidProfile(kidId);
      success(res, null, 'Kid profile deleted successfully');
    } catch (error) {
      badRequest(res, error.message);
    }
  })
);

/**
 * @swagger
 * /admin/devices/{deviceId}/kid:
 *   put:
 *     tags: [Admin - Device Management]
 *     summary: Assign kid to device (admin)
 */
router.put('/devices/:deviceId/kid',
  requireAuth,
  requireSuperAdmin,
  asyncHandler(async (req, res) => {
    const { deviceId } = req.params;
    const { kidId } = req.body;

    try {
      const device = await adminService.assignKidToDeviceAdmin(deviceId, kidId);
      success(res, device, kidId ? 'Kid assigned to device' : 'Kid unassigned from device');
    } catch (error) {
      badRequest(res, error.message);
    }
  })
);

// ==================== SYSTEM STATISTICS ====================

/**
 * @swagger
 * /admin/stats/overview:
 *   get:
 *     tags: [Admin - Statistics]
 *     summary: Get system overview
 *     description: Returns overall system statistics (super admin only)
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: System overview statistics
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
 *                   $ref: '#/components/schemas/SystemOverview'
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Super admin access required
 */
router.get('/stats/overview',
  requireAuth,
  requireSuperAdmin,
  asyncHandler(async (req, res) => {
    const stats = await adminService.getSystemOverview();
    success(res, stats);
  })
);

/**
 * @swagger
 * /admin/stats/users:
 *   get:
 *     tags: [Admin - Statistics]
 *     summary: Get user registration statistics
 *     description: Returns user registration stats over time (super admin only)
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: days
 *         schema:
 *           type: integer
 *           default: 30
 *         description: Number of days to include
 *     responses:
 *       200:
 *         description: User registration statistics
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
 *                   $ref: '#/components/schemas/RegistrationStats'
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Super admin access required
 */
router.get('/stats/users',
  requireAuth,
  requireSuperAdmin,
  asyncHandler(async (req, res) => {
    const days = parseInt(req.query.days) || 30;
    const stats = await adminService.getUserRegistrationStats(days);
    success(res, stats);
  })
);

/**
 * @swagger
 * /admin/stats/devices:
 *   get:
 *     tags: [Admin - Statistics]
 *     summary: Get device registration statistics
 *     description: Returns device registration stats over time (super admin only)
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: days
 *         schema:
 *           type: integer
 *           default: 30
 *         description: Number of days to include
 *     responses:
 *       200:
 *         description: Device registration statistics
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
 *                   $ref: '#/components/schemas/RegistrationStats'
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Super admin access required
 */
router.get('/stats/devices',
  requireAuth,
  requireSuperAdmin,
  asyncHandler(async (req, res) => {
    const days = parseInt(req.query.days) || 30;
    const stats = await adminService.getDeviceRegistrationStats(days);
    success(res, stats);
  })
);

/**
 * @swagger
 * /admin/stats/content:
 *   get:
 *     tags: [Admin - Statistics]
 *     summary: Get content statistics
 *     description: Returns content counts by type (super admin only)
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Content statistics
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
 *                   $ref: '#/components/schemas/ContentStats'
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Super admin access required
 */
router.get('/stats/content',
  requireAuth,
  requireSuperAdmin,
  asyncHandler(async (req, res) => {
    const stats = await adminService.getContentStats();
    success(res, stats);
  })
);

/**
 * @swagger
 * /admin/stats/sessions:
 *   get:
 *     tags: [Admin - Statistics]
 *     summary: Get session statistics
 *     description: Returns game session analytics (super admin only)
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: days
 *         schema:
 *           type: integer
 *           default: 30
 *         description: Number of days to include
 *     responses:
 *       200:
 *         description: Session statistics
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
 *                     period:
 *                       type: integer
 *                     totalSessions:
 *                       type: integer
 *                     totalScore:
 *                       type: integer
 *                     byGameType:
 *                       type: object
 *                       additionalProperties:
 *                         type: integer
 *                     dailyStats:
 *                       type: object
 *                       additionalProperties:
 *                         type: integer
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Super admin access required
 */
router.get('/stats/sessions',
  requireAuth,
  requireSuperAdmin,
  asyncHandler(async (req, res) => {
    const days = parseInt(req.query.days) || 30;
    const stats = await adminService.getSessionStats(days);
    success(res, stats);
  })
);

/**
 * @swagger
 * /admin/stats/tokens:
 *   get:
 *     tags: [Admin - Statistics]
 *     summary: Get token usage statistics
 *     description: Returns token usage analytics (super admin only)
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: days
 *         schema:
 *           type: integer
 *           default: 30
 *         description: Number of days to include
 *     responses:
 *       200:
 *         description: Token usage statistics
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
 *                   $ref: '#/components/schemas/TokenUsageStats'
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Super admin access required
 */
router.get('/stats/tokens',
  requireAuth,
  requireSuperAdmin,
  asyncHandler(async (req, res) => {
    const days = parseInt(req.query.days) || 30;
    const stats = await adminService.getTokenUsageStats(days);
    success(res, stats);
  })
);

/**
 * @swagger
 * /admin/stats/active:
 *   get:
 *     tags: [Admin - Statistics]
 *     summary: Get active sessions
 *     description: Returns currently active devices and sessions (super admin only)
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Active sessions
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
 *                     count:
 *                       type: integer
 *                       description: Number of active sessions
 *                     devices:
 *                       type: array
 *                       items:
 *                         type: object
 *                         properties:
 *                           mac_address:
 *                             type: string
 *                           device_name:
 *                             type: string
 *                           online:
 *                             type: integer
 *                           agent_id:
 *                             type: integer
 *                           updated_at:
 *                             type: string
 *                             format: date-time
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Super admin access required
 */
router.get('/stats/active',
  requireAuth,
  requireSuperAdmin,
  asyncHandler(async (req, res) => {
    const stats = await adminService.getActiveSessions();
    success(res, stats);
  })
);

/**
 * @swagger
 * /admin/device/all:
 *   get:
 *     tags: [Admin]
 *     summary: Paginated device search (admin)
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
 *         name: keywords
 *         schema:
 *           type: string
 *         description: Search by MAC address or device alias
 *     responses:
 *       200:
 *         description: Paginated device list
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
 *                     list:
 *                       type: array
 *                       items:
 *                         type: object
 *                         properties:
 *                           id:
 *                             type: string
 *                           macAddress:
 *                             type: string
 *                           deviceType:
 *                             type: string
 *                           appVersion:
 *                             type: string
 *                           agentId:
 *                             type: string
 *                           bindUserName:
 *                             type: string
 *                           otaUpgrade:
 *                             type: integer
 *                           recentChatTime:
 *                             type: string
 *                     total:
 *                       type: integer
 *                     page:
 *                       type: integer
 *                     limit:
 *                       type: integer
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Super admin access required
 */
router.get('/device/all',
  requireAuth,
  requireSuperAdmin,
  asyncHandler(async (req, res) => {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const keywords = req.query.keywords || '';

    const result = await adminService.getAllDevices({ page, limit, keywords });
    success(res, result);
  })
);

/**
 * Admin: Get device settings by MAC for dashboard testing.
 */
router.get('/device/:mac/settings',
  requireAuth,
  requireSuperAdmin,
  asyncHandler(async (req, res) => {
    const mac = (req.params.mac || '').trim();
    if (!mac) {
      return badRequest(res, 'mac is required');
    }

    const settings = await deviceSettingsService.getSettingsByMac(mac);
    success(res, {
      deviceId: settings.device_id,
      macAddress: settings.mac_address,
      settingsVersion: settings.settings_version,
      settings: settings.settings,
      syncStatus: settings.sync_status,
      lastAckStatus: settings.last_ack_status,
      lastAckReason: settings.last_ack_reason,
      lastAppliedVersion: settings.last_applied_version,
    });
  })
);

/**
 * Admin: Patch device settings by MAC for dashboard testing.
 */
router.patch('/device/:mac/settings',
  requireAuth,
  requireSuperAdmin,
  asyncHandler(async (req, res) => {
    const mac = (req.params.mac || '').trim();
    if (!mac) {
      return badRequest(res, 'mac is required');
    }

    const payloadSettings = req.body?.settings;
    if (!payloadSettings || typeof payloadSettings !== 'object' || Array.isArray(payloadSettings)) {
      return badRequest(res, 'settings object is required');
    }

    const patchResult = await deviceSettingsService.patchSettingsByMac(mac, payloadSettings);

    let publishResult = null;
    if (patchResult.changed && patchResult.publishRequired) {
      try {
        publishResult = await deviceSettingsService.requestGatewaySettingsPublish({
          mac_address: patchResult.settings.mac_address,
          version: patchResult.settings.settings_version,
          settings: patchResult.settings.settings,
        });
      } catch (error) {
        await deviceSettingsService.markSyncStatusByMac(
          patchResult.settings.mac_address,
          'pending_offline',
          `publish_failed:${error.message}`
        );
      }
    }

    const finalSettings = await deviceSettingsService.getSettingsByMac(mac);
    success(res, {
      changed: patchResult.changed,
      publishRequired: patchResult.publishRequired,
      publishResult,
      deviceId: finalSettings.device_id,
      macAddress: finalSettings.mac_address,
      settingsVersion: finalSettings.settings_version,
      settings: finalSettings.settings,
      syncStatus: finalSettings.sync_status,
      lastAckStatus: finalSettings.last_ack_status,
      lastAckReason: finalSettings.last_ack_reason,
      lastAppliedVersion: finalSettings.last_applied_version,
    });
  })
);

/**
 * Admin: Get runtime state by MAC.
 */
router.get('/device/:mac/state',
  requireAuth,
  requireSuperAdmin,
  asyncHandler(async (req, res) => {
    const mac = (req.params.mac || '').trim();
    if (!mac) {
      return badRequest(res, 'mac is required');
    }

    const state = await deviceSettingsService.getRuntimeStateByMac(mac);
    success(res, { state });
  })
);

/**
 * Admin: Get sync events by MAC.
 */
router.get('/device/:mac/sync-events',
  requireAuth,
  requireSuperAdmin,
  asyncHandler(async (req, res) => {
    const mac = (req.params.mac || '').trim();
    if (!mac) {
      return badRequest(res, 'mac is required');
    }

    const limit = req.query.limit ? Number(req.query.limit) : 50;
    const events = await deviceSettingsService.listSyncEventsByMac(mac, limit);
    success(res, { events });
  })
);

module.exports = router;
