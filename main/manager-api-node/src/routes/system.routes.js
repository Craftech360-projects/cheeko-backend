/**
 * System Routes
 *
 * Handles system parameters and dictionary management
 * Base path: /system
 *
 * Endpoints:
 * - GET /system/params/page - List params (paginated, auth)
 * - GET /system/params/list - List all params (auth)
 * - GET /system/params/:id - Get param by ID (auth)
 * - GET /system/params/code/:code - Get param by code (auth)
 * - POST /system/params - Create param (admin)
 * - PUT /system/params/:id - Update param (admin)
 * - DELETE /system/params/:id - Delete param (admin)
 * - DELETE /system/params - Batch delete params (admin)
 *
 * - GET /system/dict/type/page - List dict types (paginated, auth)
 * - GET /system/dict/type/list - List all dict types (auth)
 * - GET /system/dict/type/:id - Get dict type by ID (auth)
 * - POST /system/dict/type - Create dict type (admin)
 * - PUT /system/dict/type/:id - Update dict type (admin)
 * - DELETE /system/dict/type/:id - Delete dict type (admin)
 * - DELETE /system/dict/type - Batch delete dict types (admin)
 *
 * - GET /system/dict/data/page - List dict data (paginated, auth)
 * - GET /system/dict/data/:id - Get dict data by ID (auth)
 * - GET /system/dict/data/type/:dictType - Get dict data by type code (public)
 * - POST /system/dict/data - Create dict data (admin)
 * - PUT /system/dict/data/:id - Update dict data (admin)
 * - DELETE /system/dict/data/:id - Delete dict data (admin)
 * - DELETE /system/dict/data - Batch delete dict data (admin)
 */

const express = require('express');
const router = express.Router();
const systemService = require('../services/system.service');
const { asyncHandler } = require('../middleware/errorHandler');
const { requireAuth, requireAdmin } = require('../middleware/auth');
const { success, badRequest, notFound } = require('../utils/response');

/**
 * @swagger
 * components:
 *   schemas:
 *     SysParam:
 *       type: object
 *       properties:
 *         id:
 *           type: integer
 *           description: Parameter ID
 *         param_code:
 *           type: string
 *           description: Unique parameter code
 *         param_value:
 *           type: string
 *           description: Parameter value
 *         value_type:
 *           type: string
 *           enum: [string, number, boolean, array, object]
 *           description: Value type for parsing
 *         param_type:
 *           type: integer
 *           enum: [0, 1]
 *           description: 0=system (read-only), 1=configurable
 *         remark:
 *           type: string
 *           description: Parameter description/note
 *         creator:
 *           type: integer
 *         created_at:
 *           type: string
 *           format: date-time
 *         updater:
 *           type: integer
 *         updated_at:
 *           type: string
 *           format: date-time
 *     SysParamInput:
 *       type: object
 *       required:
 *         - paramCode
 *       properties:
 *         paramCode:
 *           type: string
 *           description: Unique parameter code
 *         paramValue:
 *           type: string
 *           description: Parameter value
 *         valueType:
 *           type: string
 *           enum: [string, number, boolean, array, object]
 *           default: string
 *         paramType:
 *           type: integer
 *           enum: [0, 1]
 *           default: 1
 *           description: 0=system (read-only), 1=configurable
 *         remark:
 *           type: string
 *     DictType:
 *       type: object
 *       properties:
 *         id:
 *           type: integer
 *           description: Dictionary type ID
 *         dict_type:
 *           type: string
 *           description: Unique type code
 *         dict_name:
 *           type: string
 *           description: Display name
 *         remark:
 *           type: string
 *         sort:
 *           type: integer
 *           description: Sort order
 *         creator:
 *           type: integer
 *         created_at:
 *           type: string
 *           format: date-time
 *         updater:
 *           type: integer
 *         updated_at:
 *           type: string
 *           format: date-time
 *     DictTypeInput:
 *       type: object
 *       required:
 *         - dictType
 *         - dictName
 *       properties:
 *         dictType:
 *           type: string
 *           description: Unique type code
 *         dictName:
 *           type: string
 *           description: Display name
 *         remark:
 *           type: string
 *         sort:
 *           type: integer
 *           default: 0
 *     DictData:
 *       type: object
 *       properties:
 *         id:
 *           type: integer
 *           description: Dictionary data ID
 *         dict_type_id:
 *           type: integer
 *           description: Parent dictionary type ID
 *         dict_label:
 *           type: string
 *           description: Display label
 *         dict_value:
 *           type: string
 *           description: Stored value
 *         remark:
 *           type: string
 *         sort:
 *           type: integer
 *           description: Sort order
 *         dict_type:
 *           type: object
 *           properties:
 *             id:
 *               type: integer
 *             dict_type:
 *               type: string
 *             dict_name:
 *               type: string
 *         creator:
 *           type: integer
 *         created_at:
 *           type: string
 *           format: date-time
 *         updater:
 *           type: integer
 *         updated_at:
 *           type: string
 *           format: date-time
 *     DictDataInput:
 *       type: object
 *       required:
 *         - dictTypeId
 *         - dictLabel
 *         - dictValue
 *       properties:
 *         dictTypeId:
 *           type: integer
 *           description: Parent dictionary type ID
 *         dictLabel:
 *           type: string
 *           description: Display label
 *         dictValue:
 *           type: string
 *           description: Stored value
 *         remark:
 *           type: string
 *         sort:
 *           type: integer
 *           default: 0
 */

// ==================== SYSTEM PARAMETERS ====================

/**
 * @swagger
 * /system/params/page:
 *   get:
 *     tags: [System - Parameters]
 *     summary: List system parameters (paginated)
 *     description: Returns a paginated list of system parameters
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
 *         name: paramType
 *         schema:
 *           type: integer
 *           enum: [0, 1]
 *         description: Filter by param type (0=system, 1=configurable)
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
 *                         $ref: '#/components/schemas/SysParam'
 *                     total:
 *                       type: integer
 *                     page:
 *                       type: integer
 *                     limit:
 *                       type: integer
 *       401:
 *         description: Unauthorized
 */
router.get('/params/page',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { page, limit, paramType } = req.query;
    const result = await systemService.listParams({
      page: parseInt(page) || 1,
      limit: parseInt(limit) || 20,
      paramType: paramType !== undefined ? parseInt(paramType) : undefined
    });
    success(res, result);
  })
);

/**
 * @swagger
 * /system/params/list:
 *   get:
 *     tags: [System - Parameters]
 *     summary: List all system parameters
 *     description: Returns all system parameters without pagination
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: List of all parameters
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
 *                     $ref: '#/components/schemas/SysParam'
 *       401:
 *         description: Unauthorized
 */
router.get('/params/list',
  requireAuth,
  asyncHandler(async (req, res) => {
    const params = await systemService.getAllParams();
    success(res, params);
  })
);

/**
 * @swagger
 * /system/params/code/{code}:
 *   get:
 *     tags: [System - Parameters]
 *     summary: Get parameter by code
 *     description: Retrieve a system parameter by its unique code
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: code
 *         required: true
 *         schema:
 *           type: string
 *         description: Parameter code
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
 *                   $ref: '#/components/schemas/SysParam'
 *       404:
 *         description: Parameter not found
 *       401:
 *         description: Unauthorized
 */
router.get('/params/code/:code',
  requireAuth,
  asyncHandler(async (req, res) => {
    const param = await systemService.getParamByCode(req.params.code);
    if (!param) {
      return notFound(res, 'Parameter not found');
    }
    success(res, param);
  })
);

/**
 * @swagger
 * /system/params:
 *   post:
 *     tags: [System - Parameters]
 *     summary: Create system parameter
 *     description: Create a new system parameter (admin only)
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/SysParamInput'
 *     responses:
 *       200:
 *         description: Parameter created successfully
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
 *                   $ref: '#/components/schemas/SysParam'
 *       400:
 *         description: Validation error
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Admin access required
 *   delete:
 *     tags: [System - Parameters]
 *     summary: Batch delete parameters
 *     description: Delete multiple system parameters by IDs (admin only)
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
 *                 description: Array of parameter IDs to delete
 *     responses:
 *       200:
 *         description: Parameters deleted successfully
 *       400:
 *         description: Validation error
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Admin access required
 */
router.post('/params',
  requireAdmin,
  asyncHandler(async (req, res) => {
    if (!req.body.paramCode) {
      return badRequest(res, 'Parameter code is required');
    }

    try {
      const param = await systemService.createParam(req.user.id, req.body);
      success(res, param, 'Parameter created successfully');
    } catch (error) {
      badRequest(res, error.message);
    }
  })
);

router.delete('/params',
  requireAdmin,
  asyncHandler(async (req, res) => {
    const { ids } = req.body;

    if (!ids || !Array.isArray(ids) || ids.length === 0) {
      return badRequest(res, 'IDs array is required');
    }

    try {
      await systemService.deleteParams(ids);
      success(res, null, 'Parameters deleted successfully');
    } catch (error) {
      badRequest(res, error.message);
    }
  })
);

/**
 * @swagger
 * /system/params/{id}:
 *   get:
 *     tags: [System - Parameters]
 *     summary: Get parameter by ID
 *     description: Retrieve a system parameter by its ID
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
 *                   $ref: '#/components/schemas/SysParam'
 *       404:
 *         description: Parameter not found
 *       401:
 *         description: Unauthorized
 *   put:
 *     tags: [System - Parameters]
 *     summary: Update system parameter
 *     description: Update an existing system parameter (admin only)
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *         description: Parameter ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/SysParamInput'
 *     responses:
 *       200:
 *         description: Parameter updated successfully
 *       400:
 *         description: Validation error
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Admin access required
 *   delete:
 *     tags: [System - Parameters]
 *     summary: Delete system parameter
 *     description: Delete a system parameter by ID (admin only)
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
 *         description: Parameter deleted successfully
 *       400:
 *         description: Error deleting parameter
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Admin access required
 */
router.get('/params/:id',
  requireAuth,
  asyncHandler(async (req, res) => {
    const param = await systemService.getParamById(req.params.id);
    if (!param) {
      return notFound(res, 'Parameter not found');
    }
    success(res, param);
  })
);

router.put('/params/:id',
  requireAdmin,
  asyncHandler(async (req, res) => {
    try {
      const param = await systemService.updateParam(req.params.id, {
        ...req.body,
        updater: req.user.id
      });
      success(res, param, 'Parameter updated successfully');
    } catch (error) {
      badRequest(res, error.message);
    }
  })
);

router.delete('/params/:id',
  requireAdmin,
  asyncHandler(async (req, res) => {
    try {
      await systemService.deleteParam(req.params.id);
      success(res, null, 'Parameter deleted successfully');
    } catch (error) {
      badRequest(res, error.message);
    }
  })
);

// ==================== DICTIONARY TYPES ====================

/**
 * @swagger
 * /system/dict/type/page:
 *   get:
 *     tags: [System - Dictionary Types]
 *     summary: List dictionary types (paginated)
 *     description: Returns a paginated list of dictionary types
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
 *     responses:
 *       200:
 *         description: Paginated dictionary type list
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
 *                         $ref: '#/components/schemas/DictType'
 *                     total:
 *                       type: integer
 *                     page:
 *                       type: integer
 *                     limit:
 *                       type: integer
 *       401:
 *         description: Unauthorized
 */
router.get('/dict/type/page',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { page, limit } = req.query;
    const result = await systemService.listDictTypes({
      page: parseInt(page) || 1,
      limit: parseInt(limit) || 20
    });
    success(res, result);
  })
);

/**
 * @swagger
 * /system/dict/type/list:
 *   get:
 *     tags: [System - Dictionary Types]
 *     summary: List all dictionary types
 *     description: Returns all dictionary types without pagination
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: List of all dictionary types
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
 *                     $ref: '#/components/schemas/DictType'
 *       401:
 *         description: Unauthorized
 */
router.get('/dict/type/list',
  requireAuth,
  asyncHandler(async (req, res) => {
    const types = await systemService.getAllDictTypes();
    success(res, types);
  })
);

/**
 * @swagger
 * /system/dict/type:
 *   post:
 *     tags: [System - Dictionary Types]
 *     summary: Create dictionary type
 *     description: Create a new dictionary type (admin only)
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/DictTypeInput'
 *     responses:
 *       200:
 *         description: Dictionary type created successfully
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
 *                   $ref: '#/components/schemas/DictType'
 *       400:
 *         description: Validation error
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Admin access required
 *   delete:
 *     tags: [System - Dictionary Types]
 *     summary: Batch delete dictionary types
 *     description: Delete multiple dictionary types by IDs (admin only)
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
 *                 description: Array of dictionary type IDs to delete
 *     responses:
 *       200:
 *         description: Dictionary types deleted successfully
 *       400:
 *         description: Validation error
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Admin access required
 */
router.post('/dict/type',
  requireAdmin,
  asyncHandler(async (req, res) => {
    if (!req.body.dictType || !req.body.dictName) {
      return badRequest(res, 'Dictionary type code and name are required');
    }

    try {
      const type = await systemService.createDictType(req.user.id, req.body);
      success(res, type, 'Dictionary type created successfully');
    } catch (error) {
      badRequest(res, error.message);
    }
  })
);

router.delete('/dict/type',
  requireAdmin,
  asyncHandler(async (req, res) => {
    const { ids } = req.body;

    if (!ids || !Array.isArray(ids) || ids.length === 0) {
      return badRequest(res, 'IDs array is required');
    }

    try {
      await systemService.deleteDictTypes(ids);
      success(res, null, 'Dictionary types deleted successfully');
    } catch (error) {
      badRequest(res, error.message);
    }
  })
);

/**
 * @swagger
 * /system/dict/type/{id}:
 *   get:
 *     tags: [System - Dictionary Types]
 *     summary: Get dictionary type by ID
 *     description: Retrieve a dictionary type by its ID
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *         description: Dictionary type ID
 *     responses:
 *       200:
 *         description: Dictionary type details
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 code:
 *                   type: integer
 *                 data:
 *                   $ref: '#/components/schemas/DictType'
 *       404:
 *         description: Dictionary type not found
 *       401:
 *         description: Unauthorized
 *   put:
 *     tags: [System - Dictionary Types]
 *     summary: Update dictionary type
 *     description: Update an existing dictionary type (admin only)
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *         description: Dictionary type ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/DictTypeInput'
 *     responses:
 *       200:
 *         description: Dictionary type updated successfully
 *       400:
 *         description: Validation error
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Admin access required
 *   delete:
 *     tags: [System - Dictionary Types]
 *     summary: Delete dictionary type
 *     description: Delete a dictionary type by ID (admin only). Will cascade delete related data.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *         description: Dictionary type ID
 *     responses:
 *       200:
 *         description: Dictionary type deleted successfully
 *       400:
 *         description: Error deleting dictionary type
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Admin access required
 */
router.get('/dict/type/:id',
  requireAuth,
  asyncHandler(async (req, res) => {
    const type = await systemService.getDictTypeById(req.params.id);
    if (!type) {
      return notFound(res, 'Dictionary type not found');
    }
    success(res, type);
  })
);

router.put('/dict/type/:id',
  requireAdmin,
  asyncHandler(async (req, res) => {
    try {
      const type = await systemService.updateDictType(req.params.id, {
        ...req.body,
        updater: req.user.id
      });
      success(res, type, 'Dictionary type updated successfully');
    } catch (error) {
      badRequest(res, error.message);
    }
  })
);

router.delete('/dict/type/:id',
  requireAdmin,
  asyncHandler(async (req, res) => {
    try {
      await systemService.deleteDictType(req.params.id);
      success(res, null, 'Dictionary type deleted successfully');
    } catch (error) {
      badRequest(res, error.message);
    }
  })
);

// ==================== DICTIONARY DATA ====================

/**
 * @swagger
 * /system/dict/data/page:
 *   get:
 *     tags: [System - Dictionary Data]
 *     summary: List dictionary data (paginated)
 *     description: Returns a paginated list of dictionary data
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
 *         name: dictTypeId
 *         schema:
 *           type: integer
 *         description: Filter by dictionary type ID
 *     responses:
 *       200:
 *         description: Paginated dictionary data list
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
 *                         $ref: '#/components/schemas/DictData'
 *                     total:
 *                       type: integer
 *                     page:
 *                       type: integer
 *                     limit:
 *                       type: integer
 *       401:
 *         description: Unauthorized
 */
router.get('/dict/data/page',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { page, limit, dictTypeId } = req.query;
    const result = await systemService.listDictData({
      page: parseInt(page) || 1,
      limit: parseInt(limit) || 20,
      dictTypeId: dictTypeId ? parseInt(dictTypeId) : undefined
    });
    success(res, result);
  })
);

/**
 * @swagger
 * /system/dict/data/type/{dictType}:
 *   get:
 *     tags: [System - Dictionary Data]
 *     summary: Get dictionary data by type code
 *     description: Retrieve all dictionary data for a given type code (public endpoint)
 *     parameters:
 *       - in: path
 *         name: dictType
 *         required: true
 *         schema:
 *           type: string
 *         description: Dictionary type code
 *     responses:
 *       200:
 *         description: Dictionary data for type
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 code:
 *                   type: integer
 *                 data:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/DictData'
 */
router.get('/dict/data/type/:dictType',
  asyncHandler(async (req, res) => {
    const data = await systemService.getDictDataByType(req.params.dictType);
    success(res, data);
  })
);

/**
 * @swagger
 * /system/dict/data:
 *   post:
 *     tags: [System - Dictionary Data]
 *     summary: Create dictionary data
 *     description: Create a new dictionary data entry (admin only)
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/DictDataInput'
 *     responses:
 *       200:
 *         description: Dictionary data created successfully
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
 *                   $ref: '#/components/schemas/DictData'
 *       400:
 *         description: Validation error
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Admin access required
 *   delete:
 *     tags: [System - Dictionary Data]
 *     summary: Batch delete dictionary data
 *     description: Delete multiple dictionary data entries by IDs (admin only)
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
 *                 description: Array of dictionary data IDs to delete
 *     responses:
 *       200:
 *         description: Dictionary data deleted successfully
 *       400:
 *         description: Validation error
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Admin access required
 */
router.post('/dict/data',
  requireAdmin,
  asyncHandler(async (req, res) => {
    if (!req.body.dictTypeId || !req.body.dictLabel || !req.body.dictValue) {
      return badRequest(res, 'Dictionary type ID, label, and value are required');
    }

    try {
      const data = await systemService.createDictData(req.user.id, req.body);
      success(res, data, 'Dictionary data created successfully');
    } catch (error) {
      badRequest(res, error.message);
    }
  })
);

router.delete('/dict/data',
  requireAdmin,
  asyncHandler(async (req, res) => {
    const { ids } = req.body;

    if (!ids || !Array.isArray(ids) || ids.length === 0) {
      return badRequest(res, 'IDs array is required');
    }

    try {
      await systemService.deleteDictDataBatch(ids);
      success(res, null, 'Dictionary data deleted successfully');
    } catch (error) {
      badRequest(res, error.message);
    }
  })
);

/**
 * @swagger
 * /system/dict/data/{id}:
 *   get:
 *     tags: [System - Dictionary Data]
 *     summary: Get dictionary data by ID
 *     description: Retrieve dictionary data by its ID
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *         description: Dictionary data ID
 *     responses:
 *       200:
 *         description: Dictionary data details
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 code:
 *                   type: integer
 *                 data:
 *                   $ref: '#/components/schemas/DictData'
 *       404:
 *         description: Dictionary data not found
 *       401:
 *         description: Unauthorized
 *   put:
 *     tags: [System - Dictionary Data]
 *     summary: Update dictionary data
 *     description: Update an existing dictionary data entry (admin only)
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *         description: Dictionary data ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/DictDataInput'
 *     responses:
 *       200:
 *         description: Dictionary data updated successfully
 *       400:
 *         description: Validation error
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Admin access required
 *   delete:
 *     tags: [System - Dictionary Data]
 *     summary: Delete dictionary data
 *     description: Delete dictionary data by ID (admin only)
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *         description: Dictionary data ID
 *     responses:
 *       200:
 *         description: Dictionary data deleted successfully
 *       400:
 *         description: Error deleting dictionary data
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Admin access required
 */
router.get('/dict/data/:id',
  requireAuth,
  asyncHandler(async (req, res) => {
    const data = await systemService.getDictDataById(req.params.id);
    if (!data) {
      return notFound(res, 'Dictionary data not found');
    }
    success(res, data);
  })
);

router.put('/dict/data/:id',
  requireAdmin,
  asyncHandler(async (req, res) => {
    try {
      const data = await systemService.updateDictData(req.params.id, {
        ...req.body,
        updater: req.user.id
      });
      success(res, data, 'Dictionary data updated successfully');
    } catch (error) {
      badRequest(res, error.message);
    }
  })
);

router.delete('/dict/data/:id',
  requireAdmin,
  asyncHandler(async (req, res) => {
    try {
      await systemService.deleteDictData(req.params.id);
      success(res, null, 'Dictionary data deleted successfully');
    } catch (error) {
      badRequest(res, error.message);
    }
  })
);

module.exports = router;
