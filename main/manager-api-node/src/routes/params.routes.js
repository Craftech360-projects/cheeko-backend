/**
 * Params Routes (Spring Boot Compatible)
 *
 * Handles system parameters management at /admin/params
 * This matches the Spring Boot API path for manager-web frontend compatibility
 *
 * Base path: /admin/params
 *
 * Endpoints:
 * - GET /admin/params/page - List params (paginated, super admin)
 * - GET /admin/params/{id} - Get param by ID (super admin)
 * - POST /admin/params - Create param (super admin)
 * - PUT /admin/params - Update param (super admin)
 * - POST /admin/params/delete - Delete param(s) (super admin)
 */

const express = require('express');
const router = express.Router();
const systemService = require('../services/system.service');
const { asyncHandler } = require('../middleware/errorHandler');
const { requireAuth, requireSuperAdmin } = require('../middleware/auth');
const { success, badRequest, notFound } = require('../utils/response');

/**
 * Transform database record to Spring Boot format
 * Converts snake_case to camelCase and formats dates
 */
const transformToSpringBootFormat = (param) => {
  if (!param) return null;

  // Format date to 'yyyy-MM-dd HH:mm:ss'
  const formatDate = (dateStr) => {
    if (!dateStr) return null;
    const date = new Date(dateStr);
    const pad = (n) => n.toString().padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
  };

  return {
    id: param.id,
    paramCode: param.param_code,
    paramValue: param.param_value,
    valueType: param.value_type || 'string',
    remark: param.remark,
    createDate: formatDate(param.created_at),
    updateDate: formatDate(param.updated_at)
  };
};

/**
 * @swagger
 * /admin/params/page:
 *   get:
 *     tags: [Admin - Parameters]
 *     summary: List system parameters (paginated)
 *     description: Returns a paginated list of system parameters (super admin only). Spring Boot compatible endpoint.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           default: 1
 *         description: Current page number, starts from 1
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 10
 *         description: Records per page
 *       - in: query
 *         name: order
 *         schema:
 *           type: string
 *           enum: [asc, desc]
 *         description: Sort order
 *       - in: query
 *         name: paramCode
 *         schema:
 *           type: string
 *         description: Filter by parameter code or remark
 *     responses:
 *       200:
 *         description: Paginated parameter list
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
 *                           id:
 *                             type: integer
 *                           paramCode:
 *                             type: string
 *                           paramValue:
 *                             type: string
 *                           valueType:
 *                             type: string
 *                           remark:
 *                             type: string
 *                           createDate:
 *                             type: string
 *                           updateDate:
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
router.get('/page',
  requireAuth,
  requireSuperAdmin,
  asyncHandler(async (req, res) => {
    const { page, limit, paramCode } = req.query;
    const result = await systemService.listParams({
      page: parseInt(page) || 1,
      limit: parseInt(limit) || 10,
      search: paramCode
    });

    // Transform to Spring Boot format
    success(res, {
      list: result.list.map(transformToSpringBootFormat),
      total: result.total,
      page: result.page,
      limit: result.limit
    });
  })
);

/**
 * @swagger
 * /admin/params/{id}:
 *   get:
 *     tags: [Admin - Parameters]
 *     summary: Get parameter by ID
 *     description: Retrieve a system parameter by its ID (super admin only)
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *         description: Parameter ID
 *     responses:
 *       200:
 *         description: Parameter details
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 code:
 *                   type: integer
 *                 data:
 *                   type: object
 *       404:
 *         description: Parameter not found
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Super admin access required
 */
router.get('/:id',
  requireAuth,
  requireSuperAdmin,
  asyncHandler(async (req, res) => {
    const param = await systemService.getParamById(req.params.id);
    if (!param) {
      return notFound(res, 'Parameter not found');
    }
    success(res, transformToSpringBootFormat(param));
  })
);

/**
 * @swagger
 * /admin/params:
 *   post:
 *     tags: [Admin - Parameters]
 *     summary: Create system parameter
 *     description: Create a new system parameter (super admin only)
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - paramCode
 *               - paramValue
 *               - valueType
 *             properties:
 *               paramCode:
 *                 type: string
 *               paramValue:
 *                 type: string
 *               valueType:
 *                 type: string
 *                 enum: [string, number, boolean, array, json]
 *               remark:
 *                 type: string
 *     responses:
 *       200:
 *         description: Parameter created successfully
 *       400:
 *         description: Validation error
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Super admin access required
 */
router.post('/',
  requireAuth,
  requireSuperAdmin,
  asyncHandler(async (req, res) => {
    if (!req.body.paramCode || !req.body.paramValue || !req.body.valueType) {
      return badRequest(res, 'paramCode, paramValue, and valueType are required');
    }

    try {
      await systemService.createParam(req.user.id, {
        paramCode: req.body.paramCode,
        paramValue: req.body.paramValue,
        valueType: req.body.valueType,
        remark: req.body.remark
      });
      success(res, null, 'success');
    } catch (error) {
      badRequest(res, error.message);
    }
  })
);

/**
 * @swagger
 * /admin/params:
 *   put:
 *     tags: [Admin - Parameters]
 *     summary: Update system parameter
 *     description: Update an existing system parameter (super admin only)
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: skipValidation
 *         schema:
 *           type: boolean
 *           default: false
 *         description: Skip WebSocket/OTA URL validation
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - id
 *               - paramCode
 *               - paramValue
 *               - valueType
 *             properties:
 *               id:
 *                 type: integer
 *               paramCode:
 *                 type: string
 *               paramValue:
 *                 type: string
 *               valueType:
 *                 type: string
 *                 enum: [string, number, boolean, array, json]
 *               remark:
 *                 type: string
 *     responses:
 *       200:
 *         description: Parameter updated successfully
 *       400:
 *         description: Validation error
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Super admin access required
 */
router.put('/',
  requireAuth,
  requireSuperAdmin,
  asyncHandler(async (req, res) => {
    if (!req.body.id) {
      return badRequest(res, 'id is required');
    }

    try {
      await systemService.updateParam(req.body.id, {
        paramCode: req.body.paramCode,
        paramValue: req.body.paramValue,
        valueType: req.body.valueType,
        remark: req.body.remark,
        updater: req.user.id
      });
      success(res, null, 'success');
    } catch (error) {
      badRequest(res, error.message);
    }
  })
);

/**
 * @swagger
 * /admin/params/delete:
 *   post:
 *     tags: [Admin - Parameters]
 *     summary: Delete system parameters
 *     description: Delete one or more system parameters by IDs (super admin only)
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: array
 *             items:
 *               type: string
 *             description: Array of parameter IDs to delete
 *     responses:
 *       200:
 *         description: Parameters deleted successfully
 *       400:
 *         description: Validation error
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Super admin access required
 */
router.post('/delete',
  requireAuth,
  requireSuperAdmin,
  asyncHandler(async (req, res) => {
    const ids = req.body;

    if (!Array.isArray(ids) || ids.length === 0) {
      return badRequest(res, 'IDs array is required');
    }

    try {
      await systemService.deleteParams(ids);
      success(res, null, 'success');
    } catch (error) {
      badRequest(res, error.message);
    }
  })
);

module.exports = router;
