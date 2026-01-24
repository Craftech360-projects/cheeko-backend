/**
 * Dictionary Routes (Spring Boot Compatible)
 *
 * Provides /admin/dict/* endpoints matching Spring Boot API format
 * Base path: /admin/dict
 *
 * Dictionary Type Endpoints:
 * - GET /admin/dict/type/page - Paginated dictionary type query
 * - GET /admin/dict/type/{id} - Get dictionary type by ID
 * - POST /admin/dict/type/save - Create dictionary type
 * - PUT /admin/dict/type/update - Update dictionary type
 * - POST /admin/dict/type/delete - Delete dictionary type(s)
 *
 * Dictionary Data Endpoints:
 * - GET /admin/dict/data/page - Paginated dictionary data query
 * - GET /admin/dict/data/{id} - Get dictionary data by ID
 * - GET /admin/dict/data/type/{dictType} - Get data by type code
 * - POST /admin/dict/data/save - Create dictionary data
 * - PUT /admin/dict/data/update - Update dictionary data
 * - POST /admin/dict/data/delete - Delete dictionary data(s)
 */

const express = require('express');
const router = express.Router();
const systemService = require('../services/system.service');
const { asyncHandler } = require('../middleware/errorHandler');
const { requireAdmin, requireAuth } = require('../middleware/auth');
const { success, error: errorResponse } = require('../utils/response');

/**
 * Format date for Spring Boot compatibility
 * @param {string|Date} date - Date to format
 * @returns {string} Formatted date string (yyyy-MM-dd HH:mm:ss)
 */
const formatDate = (date) => {
  if (!date) return null;
  const d = new Date(date);
  if (isNaN(d.getTime())) return null;

  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  const hours = String(d.getHours()).padStart(2, '0');
  const minutes = String(d.getMinutes()).padStart(2, '0');
  const seconds = String(d.getSeconds()).padStart(2, '0');

  return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
};

/**
 * Transform dict type from database format to Spring Boot camelCase format
 * @param {Object} item - Database item
 * @returns {Object} Transformed item
 */
const transformDictType = (item) => {
  if (!item) return null;
  return {
    id: item.id,
    dictType: item.dict_type,
    dictName: item.dict_name,
    remark: item.remark,
    sort: item.sort,
    creator: item.creator,
    creatorName: item.creator_name || null,
    createDate: formatDate(item.created_at),
    updater: item.updater,
    updaterName: item.updater_name || null,
    updateDate: formatDate(item.updated_at)
  };
};

/**
 * Transform dict data from database format to Spring Boot camelCase format
 * @param {Object} item - Database item
 * @returns {Object} Transformed item
 */
const transformDictData = (item) => {
  if (!item) return null;
  return {
    id: item.id,
    dictTypeId: item.dict_type_id,
    dictLabel: item.dict_label,
    dictValue: item.dict_value,
    remark: item.remark,
    sort: item.sort,
    creator: item.creator,
    creatorName: item.creator_name || null,
    createDate: formatDate(item.created_at),
    updater: item.updater,
    updaterName: item.updater_name || null,
    updateDate: formatDate(item.updated_at)
  };
};

/**
 * Transform dict data item for type lookup (simplified format)
 * @param {Object} item - Database item
 * @returns {Object} Transformed item with name and key
 */
const transformDictDataItem = (item) => {
  if (!item) return null;
  return {
    name: item.dict_label,
    key: item.dict_value
  };
};

// ==================== DICTIONARY TYPE ENDPOINTS ====================

/**
 * @swagger
 * /admin/dict/type/page:
 *   get:
 *     tags: [Admin - Dictionary Types]
 *     summary: Paginated dictionary type query
 *     description: Returns a paginated list of dictionary types (Spring Boot compatible)
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           default: 1
 *         description: Page number (starts from 1)
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 10
 *         description: Records per page
 *       - in: query
 *         name: dictType
 *         schema:
 *           type: string
 *         description: Filter by dictionary type code
 *       - in: query
 *         name: dictName
 *         schema:
 *           type: string
 *         description: Filter by dictionary type name
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
 *                         type: object
 *                         properties:
 *                           id:
 *                             type: integer
 *                           dictType:
 *                             type: string
 *                           dictName:
 *                             type: string
 *                           remark:
 *                             type: string
 *                           sort:
 *                             type: integer
 *                           createDate:
 *                             type: string
 *                           updateDate:
 *                             type: string
 *                     total:
 *                       type: integer
 *       401:
 *         description: Unauthorized
 */
router.get('/type/page',
  requireAdmin,
  asyncHandler(async (req, res) => {
    const { page, limit } = req.query;
    const result = await systemService.listDictTypes({
      page: parseInt(page) || 1,
      limit: parseInt(limit) || 10
    });

    // Transform to Spring Boot format
    success(res, {
      list: (result.list || []).map(transformDictType),
      total: result.total
    });
  })
);

/**
 * @swagger
 * /admin/dict/type/{id}:
 *   get:
 *     tags: [Admin - Dictionary Types]
 *     summary: Get dictionary type details
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
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: Dictionary type not found
 */
router.get('/type/:id',
  requireAdmin,
  asyncHandler(async (req, res) => {
    const type = await systemService.getDictTypeById(req.params.id);
    if (!type) {
      return errorResponse(res, 'Dictionary type not found', 404);
    }
    success(res, transformDictType(type));
  })
);

/**
 * @swagger
 * /admin/dict/type/save:
 *   post:
 *     tags: [Admin - Dictionary Types]
 *     summary: Save dictionary type
 *     description: Create a new dictionary type
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - dictType
 *               - dictName
 *             properties:
 *               dictType:
 *                 type: string
 *                 description: Unique dictionary type code
 *               dictName:
 *                 type: string
 *                 description: Display name
 *               remark:
 *                 type: string
 *                 description: Remark/description
 *               sort:
 *                 type: integer
 *                 description: Sort order
 *     responses:
 *       200:
 *         description: Dictionary type created successfully
 *       400:
 *         description: Validation error
 *       401:
 *         description: Unauthorized
 */
router.post('/type/save',
  requireAdmin,
  asyncHandler(async (req, res) => {
    const { dictType, dictName, remark, sort } = req.body;

    if (!dictType || !dictName) {
      return errorResponse(res, 'dictType and dictName are required');
    }

    try {
      await systemService.createDictType(req.user.id, {
        dictType,
        dictName,
        remark,
        sort
      });
      success(res, null);
    } catch (err) {
      errorResponse(res, err.message);
    }
  })
);

/**
 * @swagger
 * /admin/dict/type/update:
 *   put:
 *     tags: [Admin - Dictionary Types]
 *     summary: Modify dictionary type
 *     description: Update an existing dictionary type
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - id
 *             properties:
 *               id:
 *                 type: integer
 *                 description: Dictionary type ID to update
 *               dictType:
 *                 type: string
 *               dictName:
 *                 type: string
 *               remark:
 *                 type: string
 *               sort:
 *                 type: integer
 *     responses:
 *       200:
 *         description: Dictionary type updated successfully
 *       400:
 *         description: Validation error
 *       401:
 *         description: Unauthorized
 */
router.put('/type/update',
  requireAdmin,
  asyncHandler(async (req, res) => {
    const { id, dictType, dictName, remark, sort } = req.body;

    if (!id) {
      return errorResponse(res, 'id is required');
    }

    try {
      await systemService.updateDictType(id, {
        dictType,
        dictName,
        remark,
        sort,
        updater: req.user.id
      });
      success(res, null);
    } catch (err) {
      errorResponse(res, err.message);
    }
  })
);

/**
 * @swagger
 * /admin/dict/type/delete:
 *   post:
 *     tags: [Admin - Dictionary Types]
 *     summary: Delete dictionary type
 *     description: Delete one or more dictionary types by IDs
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: array
 *             items:
 *               type: integer
 *             description: Array of dictionary type IDs to delete
 *     responses:
 *       200:
 *         description: Dictionary types deleted successfully
 *       400:
 *         description: Validation error
 *       401:
 *         description: Unauthorized
 */
router.post('/type/delete',
  requireAdmin,
  asyncHandler(async (req, res) => {
    const ids = req.body;

    if (!ids || !Array.isArray(ids) || ids.length === 0) {
      return errorResponse(res, 'IDs array is required');
    }

    try {
      await systemService.deleteDictTypes(ids);
      success(res, null);
    } catch (err) {
      errorResponse(res, err.message);
    }
  })
);

// ==================== DICTIONARY DATA ENDPOINTS ====================

/**
 * @swagger
 * /admin/dict/data/page:
 *   get:
 *     tags: [Admin - Dictionary Data]
 *     summary: Paginated dictionary data query
 *     description: Returns a paginated list of dictionary data for a given type ID
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: dictTypeId
 *         required: true
 *         schema:
 *           type: integer
 *         description: Dictionary type ID (required)
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
 *         description: Records per page
 *       - in: query
 *         name: dictLabel
 *         schema:
 *           type: string
 *         description: Filter by label
 *       - in: query
 *         name: dictValue
 *         schema:
 *           type: string
 *         description: Filter by value
 *     responses:
 *       200:
 *         description: Paginated dictionary data list
 *       400:
 *         description: dictTypeId is required
 *       401:
 *         description: Unauthorized
 */
router.get('/data/page',
  requireAdmin,
  asyncHandler(async (req, res) => {
    const { dictTypeId, page, limit } = req.query;

    if (!dictTypeId) {
      return errorResponse(res, 'dictTypeId cannot be empty');
    }

    const result = await systemService.listDictData({
      page: parseInt(page) || 1,
      limit: parseInt(limit) || 10,
      dictTypeId: parseInt(dictTypeId)
    });

    // Transform to Spring Boot format
    success(res, {
      list: (result.list || []).map(transformDictData),
      total: result.total
    });
  })
);

/**
 * @swagger
 * /admin/dict/data/{id}:
 *   get:
 *     tags: [Admin - Dictionary Data]
 *     summary: Get dictionary data details
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
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: Dictionary data not found
 */
router.get('/data/:id',
  requireAdmin,
  asyncHandler(async (req, res) => {
    const data = await systemService.getDictDataById(req.params.id);
    if (!data) {
      return errorResponse(res, 'Dictionary data not found', 404);
    }
    success(res, transformDictData(data));
  })
);

/**
 * @swagger
 * /admin/dict/data/type/{dictType}:
 *   get:
 *     tags: [Admin - Dictionary Data]
 *     summary: Get dictionary data list
 *     description: Get dictionary data by type code (returns simplified format with name and key)
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: dictType
 *         required: true
 *         schema:
 *           type: string
 *         description: Dictionary type code
 *     responses:
 *       200:
 *         description: Dictionary data list
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
 *                     properties:
 *                       name:
 *                         type: string
 *                         description: Display label
 *                       key:
 *                         type: string
 *                         description: Stored value
 *       401:
 *         description: Unauthorized
 */
router.get('/data/type/:dictType',
  requireAuth,
  asyncHandler(async (req, res) => {
    const data = await systemService.getDictDataByType(req.params.dictType);
    // Transform to Spring Boot SysDictDataItem format: {name, key}
    success(res, (data || []).map(transformDictDataItem));
  })
);

/**
 * @swagger
 * /admin/dict/data/save:
 *   post:
 *     tags: [Admin - Dictionary Data]
 *     summary: Add dictionary data
 *     description: Create a new dictionary data entry
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - dictTypeId
 *               - dictLabel
 *               - dictValue
 *             properties:
 *               dictTypeId:
 *                 type: integer
 *                 description: Parent dictionary type ID
 *               dictLabel:
 *                 type: string
 *                 description: Display label
 *               dictValue:
 *                 type: string
 *                 description: Stored value
 *               remark:
 *                 type: string
 *               sort:
 *                 type: integer
 *     responses:
 *       200:
 *         description: Dictionary data created successfully
 *       400:
 *         description: Validation error
 *       401:
 *         description: Unauthorized
 */
router.post('/data/save',
  requireAdmin,
  asyncHandler(async (req, res) => {
    const { dictTypeId, dictLabel, dictValue, remark, sort } = req.body;

    if (!dictTypeId || !dictLabel || dictValue === undefined) {
      return errorResponse(res, 'dictTypeId, dictLabel, and dictValue are required');
    }

    try {
      await systemService.createDictData(req.user.id, {
        dictTypeId,
        dictLabel,
        dictValue,
        remark,
        sort
      });
      success(res, null);
    } catch (err) {
      errorResponse(res, err.message);
    }
  })
);

/**
 * @swagger
 * /admin/dict/data/update:
 *   put:
 *     tags: [Admin - Dictionary Data]
 *     summary: Modify dictionary data
 *     description: Update an existing dictionary data entry
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - id
 *             properties:
 *               id:
 *                 type: integer
 *                 description: Dictionary data ID to update
 *               dictTypeId:
 *                 type: integer
 *               dictLabel:
 *                 type: string
 *               dictValue:
 *                 type: string
 *               remark:
 *                 type: string
 *               sort:
 *                 type: integer
 *     responses:
 *       200:
 *         description: Dictionary data updated successfully
 *       400:
 *         description: Validation error
 *       401:
 *         description: Unauthorized
 */
router.put('/data/update',
  requireAdmin,
  asyncHandler(async (req, res) => {
    const { id, dictTypeId, dictLabel, dictValue, remark, sort } = req.body;

    if (!id) {
      return errorResponse(res, 'id is required');
    }

    try {
      await systemService.updateDictData(id, {
        dictTypeId,
        dictLabel,
        dictValue,
        remark,
        sort,
        updater: req.user.id
      });
      success(res, null);
    } catch (err) {
      errorResponse(res, err.message);
    }
  })
);

/**
 * @swagger
 * /admin/dict/data/delete:
 *   post:
 *     tags: [Admin - Dictionary Data]
 *     summary: Delete dictionary data
 *     description: Delete one or more dictionary data entries by IDs
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: array
 *             items:
 *               type: integer
 *             description: Array of dictionary data IDs to delete
 *     responses:
 *       200:
 *         description: Dictionary data deleted successfully
 *       400:
 *         description: Validation error
 *       401:
 *         description: Unauthorized
 */
router.post('/data/delete',
  requireAdmin,
  asyncHandler(async (req, res) => {
    const ids = req.body;

    if (!ids || !Array.isArray(ids) || ids.length === 0) {
      return errorResponse(res, 'IDs array is required');
    }

    try {
      await systemService.deleteDictDataBatch(ids);
      success(res, null);
    } catch (err) {
      errorResponse(res, err.message);
    }
  })
);

module.exports = router;
