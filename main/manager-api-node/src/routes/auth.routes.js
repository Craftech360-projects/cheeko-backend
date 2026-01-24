/**
 * Authentication Routes
 *
 * Handles user registration, login, password management.
 * Base path: /user
 */

const express = require('express');
const router = express.Router();
const authService = require('../services/auth.service');
const { asyncHandler } = require('../middleware/errorHandler');
const { requireAuth } = require('../middleware/auth');
const { validate, schemas } = require('../middleware/validation');
const { success, badRequest, serverError } = require('../utils/response');
const logger = require('../utils/logger');

/**
 * @swagger
 * /user/register:
 *   post:
 *     tags: [User]
 *     summary: Register a new user
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - username
 *               - password
 *             properties:
 *               username:
 *                 type: string
 *                 minLength: 3
 *                 maxLength: 100
 *               password:
 *                 type: string
 *                 minLength: 6
 *               email:
 *                 type: string
 *                 format: email
 *               phone:
 *                 type: string
 *     responses:
 *       200:
 *         description: User registered successfully
 *       400:
 *         description: Validation error or username exists
 */
router.post('/register',
  validate({ body: schemas.register }),
  asyncHandler(async (req, res) => {
    const { username, password, email, phone } = req.body;

    try {
      const user = await authService.register({ username, password, email, phone });
      success(res, user, 'Registration successful');
    } catch (error) {
      logger.error('Registration failed:', error);
      if (error.message === 'Username already exists') {
        return badRequest(res, error.message);
      }
      serverError(res, 'Registration failed');
    }
  })
);

/**
 * @swagger
 * /user/login:
 *   post:
 *     tags: [User]
 *     summary: User login
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - username
 *               - password
 *             properties:
 *               username:
 *                 type: string
 *               password:
 *                 type: string
 *               captcha:
 *                 type: string
 *     responses:
 *       200:
 *         description: Login successful
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 code:
 *                   type: integer
 *                   example: 0
 *                 data:
 *                   type: object
 *                   properties:
 *                     id:
 *                       type: integer
 *                     username:
 *                       type: string
 *                     token:
 *                       type: string
 *                     expire:
 *                       type: string
 *                       format: date-time
 *       400:
 *         description: Invalid credentials
 */
router.post('/login',
  validate({ body: schemas.login }),
  asyncHandler(async (req, res) => {
    const { username, password } = req.body;

    try {
      const result = await authService.login(username, password);
      success(res, result, 'Login successful');
    } catch (error) {
      logger.warn('Login failed for user:', username);
      badRequest(res, error.message || 'Invalid username or password');
    }
  })
);

/**
 * @swagger
 * /user/logout:
 *   post:
 *     tags: [User]
 *     summary: User logout
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Logout successful
 */
router.post('/logout',
  requireAuth,
  asyncHandler(async (req, res) => {
    await authService.logout(req.token);
    success(res, null, 'Logout successful');
  })
);

/**
 * @swagger
 * /user/captcha:
 *   get:
 *     tags: [User]
 *     summary: Get CAPTCHA image
 *     responses:
 *       200:
 *         description: CAPTCHA data
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 code:
 *                   type: integer
 *                   example: 0
 *                 data:
 *                   type: object
 *                   properties:
 *                     uuid:
 *                       type: string
 *                     image:
 *                       type: string
 *                       description: Base64 encoded image
 */
router.get('/captcha', (req, res) => {
  const captcha = authService.generateCaptcha();
  success(res, {
    uuid: captcha.uuid,
    image: captcha.image
  });
});

/**
 * @swagger
 * /user/change-password:
 *   put:
 *     tags: [User]
 *     summary: Change password (requires current password)
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - oldPassword
 *               - newPassword
 *             properties:
 *               oldPassword:
 *                 type: string
 *               newPassword:
 *                 type: string
 *                 minLength: 6
 *     responses:
 *       200:
 *         description: Password changed successfully
 *       400:
 *         description: Invalid current password
 */
router.put('/change-password',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { oldPassword, newPassword } = req.body;

    if (!oldPassword || !newPassword) {
      return badRequest(res, 'Both old and new passwords are required');
    }

    if (newPassword.length < 6) {
      return badRequest(res, 'New password must be at least 6 characters');
    }

    try {
      await authService.changePassword(req.user.id, oldPassword, newPassword);
      success(res, null, 'Password changed successfully');
    } catch (error) {
      badRequest(res, error.message);
    }
  })
);

/**
 * @swagger
 * /user/update-password:
 *   put:
 *     tags: [User]
 *     summary: Update password (for recovery, no auth required)
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - username
 *               - newPassword
 *             properties:
 *               username:
 *                 type: string
 *               newPassword:
 *                 type: string
 *                 minLength: 6
 *               verificationCode:
 *                 type: string
 *                 description: SMS verification code (when SMS is enabled)
 *     responses:
 *       200:
 *         description: Password updated successfully
 *       400:
 *         description: User not found or verification failed
 */
router.put('/update-password',
  asyncHandler(async (req, res) => {
    const { username, newPassword, verificationCode } = req.body;

    if (!username || !newPassword) {
      return badRequest(res, 'Username and new password are required');
    }

    if (newPassword.length < 6) {
      return badRequest(res, 'New password must be at least 6 characters');
    }

    // Note: SMS verification is deferred, so we skip verification code check
    // In production, you would verify the SMS code here

    try {
      await authService.updatePassword(username, newPassword);
      success(res, null, 'Password updated successfully');
    } catch (error) {
      badRequest(res, error.message);
    }
  })
);

/**
 * @swagger
 * /user/retrieve-password:
 *   put:
 *     tags: [User]
 *     summary: Retrieve/reset forgotten password
 *     description: Alias for /user/update-password - resets password for a user (no auth required)
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - username
 *               - newPassword
 *             properties:
 *               username:
 *                 type: string
 *                 description: Username or email of the account
 *               newPassword:
 *                 type: string
 *                 minLength: 6
 *                 description: New password (minimum 6 characters)
 *               verificationCode:
 *                 type: string
 *                 description: SMS verification code (when SMS verification is enabled)
 *     responses:
 *       200:
 *         description: Password retrieved/reset successfully
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
 *                   example: Password retrieved successfully
 *       400:
 *         description: User not found or invalid input
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 code:
 *                   type: integer
 *                   example: 400
 *                 msg:
 *                   type: string
 *                   example: User not found
 */
router.put('/retrieve-password',
  asyncHandler(async (req, res) => {
    const { username, newPassword } = req.body;

    if (!username || !newPassword) {
      return badRequest(res, 'Username and new password are required');
    }

    if (newPassword.length < 6) {
      return badRequest(res, 'New password must be at least 6 characters');
    }

    // Note: SMS verification is deferred, so we skip verification code check
    // In production, you would verify the SMS code here before allowing password reset

    try {
      await authService.updatePassword(username, newPassword);
      success(res, null, 'Password retrieved successfully');
    } catch (error) {
      badRequest(res, error.message);
    }
  })
);

/**
 * @swagger
 * /user/delete-account:
 *   delete:
 *     tags: [User]
 *     summary: Delete user account (no auth required, uses password verification)
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - username
 *               - password
 *             properties:
 *               username:
 *                 type: string
 *               password:
 *                 type: string
 *     responses:
 *       200:
 *         description: Account deleted successfully
 *       400:
 *         description: Invalid credentials
 */
router.delete('/delete-account',
  asyncHandler(async (req, res) => {
    const { username, password } = req.body;

    if (!username || !password) {
      return badRequest(res, 'Username and password are required');
    }

    try {
      await authService.deleteAccount(username, password);
      success(res, null, 'Account deleted successfully');
    } catch (error) {
      badRequest(res, error.message);
    }
  })
);

/**
 * @swagger
 * /user/pub-config:
 *   get:
 *     tags: [User]
 *     summary: Get public configuration
 *     responses:
 *       200:
 *         description: Public configuration
 */
router.get('/pub-config',
  asyncHandler(async (req, res) => {
    const config = await authService.getPublicConfig();
    success(res, config);
  })
);

/**
 * @swagger
 * /user/info:
 *   get:
 *     tags: [User]
 *     summary: Get current user info
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: User information
 *       401:
 *         description: Unauthorized
 */
router.get('/info',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { password, ...userWithoutPassword } = req.user;
    success(res, userWithoutPassword);
  })
);

/**
 * @swagger
 * /user/smsVerification:
 *   post:
 *     tags: [User]
 *     summary: Send SMS verification code (deferred - not implemented)
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - phone
 *             properties:
 *               phone:
 *                 type: string
 *     responses:
 *       200:
 *         description: SMS sent (placeholder)
 *       501:
 *         description: Not implemented
 */
router.post('/smsVerification',
  asyncHandler(async (req, res) => {
    // SMS verification is deferred
    success(res, {
      message: 'SMS verification is not yet implemented',
      sent: false
    });
  })
);

module.exports = router;
