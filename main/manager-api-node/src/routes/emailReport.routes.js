/**
 * Email Report Routes
 *
 * Handles email report configuration and management (admin only):
 * - Configuration management
 * - Test email sending
 * - Send history
 * - Manual report generation
 *
 * Base path: /admin/email-reports
 *
 * Endpoints:
 * - GET    /admin/email-reports/config    - Get current configuration
 * - PUT    /admin/email-reports/config    - Update configuration
 * - POST   /admin/email-reports/test      - Send test email
 * - GET    /admin/email-reports/history   - Get send history
 * - GET    /admin/email-reports/preview   - Preview report HTML
 * - POST   /admin/email-reports/generate  - Manually trigger report generation
 */

const express = require('express');
const router = express.Router();
const emailReportService = require('../services/emailReport.service');
const { asyncHandler } = require('../middleware/errorHandler');
const { requireAuth, requireSuperAdmin } = require('../middleware/auth');
const { success, badRequest } = require('../utils/response');

/**
 * @swagger
 * components:
 *   schemas:
 *     EmailReportConfig:
 *       type: object
 *       properties:
 *         id:
 *           type: string
 *           format: uuid
 *         enabled:
 *           type: boolean
 *           description: Whether daily reports are enabled
 *         scheduleHour:
 *           type: integer
 *           minimum: 0
 *           maximum: 23
 *           description: Hour to send report (0-23)
 *         scheduleTimezone:
 *           type: string
 *           description: Timezone for schedule (e.g., Asia/Kolkata)
 *         recipients:
 *           type: array
 *           items:
 *             type: string
 *             format: email
 *           description: List of email recipients
 *         sections:
 *           type: object
 *           properties:
 *             summary:
 *               type: boolean
 *             devices:
 *               type: boolean
 *             learning:
 *               type: boolean
 *             content:
 *               type: boolean
 *             tokens:
 *               type: boolean
 *             alerts:
 *               type: boolean
 *         createdAt:
 *           type: string
 *           format: date-time
 *         updatedAt:
 *           type: string
 *           format: date-time
 *     EmailReportHistory:
 *       type: object
 *       properties:
 *         id:
 *           type: string
 *           format: uuid
 *         reportDate:
 *           type: string
 *           format: date
 *         recipients:
 *           type: array
 *           items:
 *             type: string
 *         status:
 *           type: string
 *           enum: [sent, failed, partial]
 *         errorMessage:
 *           type: string
 *           nullable: true
 *         sentAt:
 *           type: string
 *           format: date-time
 */

// ==================== CONFIGURATION ====================

/**
 * @swagger
 * /admin/email-reports/config:
 *   get:
 *     tags: [Admin - Email Reports]
 *     summary: Get email report configuration
 *     description: Returns the current email report configuration (super admin only)
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Email report configuration
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
 *                   $ref: '#/components/schemas/EmailReportConfig'
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Super admin access required
 */
router.get('/config',
  requireAuth,
  requireSuperAdmin,
  asyncHandler(async (req, res) => {
    const config = await emailReportService.getConfig();
    success(res, config);
  })
);

/**
 * @swagger
 * /admin/email-reports/config:
 *   put:
 *     tags: [Admin - Email Reports]
 *     summary: Update email report configuration
 *     description: Updates the email report configuration (super admin only)
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               enabled:
 *                 type: boolean
 *               scheduleHour:
 *                 type: integer
 *                 minimum: 0
 *                 maximum: 23
 *               scheduleTimezone:
 *                 type: string
 *               recipients:
 *                 type: array
 *                 items:
 *                   type: string
 *                   format: email
 *               sections:
 *                 type: object
 *     responses:
 *       200:
 *         description: Configuration updated successfully
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
 *                   $ref: '#/components/schemas/EmailReportConfig'
 *       400:
 *         description: Validation error
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Super admin access required
 */
router.put('/config',
  requireAuth,
  requireSuperAdmin,
  asyncHandler(async (req, res) => {
    const { enabled, scheduleHour, scheduleTimezone, recipients, sections } = req.body;

    // Validate schedule hour
    if (scheduleHour !== undefined && (scheduleHour < 0 || scheduleHour > 23)) {
      return badRequest(res, 'Schedule hour must be between 0 and 23');
    }

    // Validate recipients are valid emails
    if (recipients) {
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      const invalidEmails = recipients.filter(email => !emailRegex.test(email));
      if (invalidEmails.length > 0) {
        return badRequest(res, `Invalid email addresses: ${invalidEmails.join(', ')}`);
      }
    }

    try {
      const config = await emailReportService.updateConfig({
        enabled,
        scheduleHour,
        scheduleTimezone,
        recipients,
        sections
      });
      success(res, config, 'Configuration updated successfully');
    } catch (error) {
      badRequest(res, error.message);
    }
  })
);

// ==================== TEST EMAIL ====================

/**
 * @swagger
 * /admin/email-reports/test:
 *   post:
 *     tags: [Admin - Email Reports]
 *     summary: Send test email
 *     description: Sends a test email report to a specified recipient (super admin only)
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - recipient
 *             properties:
 *               recipient:
 *                 type: string
 *                 format: email
 *                 description: Email address to send test to
 *     responses:
 *       200:
 *         description: Test email sent
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
 *                     success:
 *                       type: boolean
 *                     message:
 *                       type: string
 *       400:
 *         description: Validation error or send failed
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Super admin access required
 */
router.post('/test',
  requireAuth,
  requireSuperAdmin,
  asyncHandler(async (req, res) => {
    const { recipient } = req.body;

    if (!recipient) {
      return badRequest(res, 'Recipient email is required');
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(recipient)) {
      return badRequest(res, 'Invalid email address');
    }

    try {
      const result = await emailReportService.sendTestEmail(recipient);
      if (result.success) {
        success(res, result, 'Test email sent successfully');
      } else {
        badRequest(res, result.message);
      }
    } catch (error) {
      badRequest(res, error.message);
    }
  })
);

// ==================== HISTORY ====================

/**
 * @swagger
 * /admin/email-reports/history:
 *   get:
 *     tags: [Admin - Email Reports]
 *     summary: Get email send history
 *     description: Returns paginated history of sent email reports (super admin only)
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
 *     responses:
 *       200:
 *         description: Email send history
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
 *                         $ref: '#/components/schemas/EmailReportHistory'
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
router.get('/history',
  requireAuth,
  requireSuperAdmin,
  asyncHandler(async (req, res) => {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;

    const history = await emailReportService.getHistory({ page, limit });
    success(res, history);
  })
);

// ==================== PREVIEW & GENERATE ====================

/**
 * @swagger
 * /admin/email-reports/preview:
 *   get:
 *     tags: [Admin - Email Reports]
 *     summary: Preview report
 *     description: Generates and returns report preview without sending (super admin only)
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Report preview
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
 *                     reportData:
 *                       type: object
 *                     html:
 *                       type: string
 *                     sections:
 *                       type: object
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Super admin access required
 */
router.get('/preview',
  requireAuth,
  requireSuperAdmin,
  asyncHandler(async (req, res) => {
    try {
      const preview = await emailReportService.previewReport();
      success(res, preview);
    } catch (error) {
      badRequest(res, error.message);
    }
  })
);

/**
 * @swagger
 * /admin/email-reports/generate:
 *   post:
 *     tags: [Admin - Email Reports]
 *     summary: Manually generate and send report
 *     description: Triggers immediate report generation and sending (super admin only)
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Report generated and sent
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
 *                     success:
 *                       type: boolean
 *                     message:
 *                       type: string
 *       400:
 *         description: Send failed
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Super admin access required
 */
router.post('/generate',
  requireAuth,
  requireSuperAdmin,
  asyncHandler(async (req, res) => {
    try {
      const result = await emailReportService.generateAndSendDailyReport();
      if (result.success) {
        success(res, result, 'Report generated and sent successfully');
      } else {
        badRequest(res, result.message);
      }
    } catch (error) {
      badRequest(res, error.message);
    }
  })
);

module.exports = router;
