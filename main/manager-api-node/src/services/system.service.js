/**
 * System Service
 *
 * Handles system parameters and dictionary management
 */

const { prisma } = require('../config/database');
const logger = require('../utils/logger');

// ==================== SYSTEM PARAMETERS ====================

/**
 * Get system parameters (paginated)
 * @param {Object} options - Pagination and filter options
 * @returns {Promise<Object>} Paginated params
 */
const listParams = async ({ page = 1, limit = 20, paramType } = {}) => {
  const offset = (page - 1) * limit;

  const where = {};

  if (paramType !== undefined) {
    where.param_type = paramType;
  }

  const [total, params] = await Promise.all([
    prisma.sys_params.count({ where }),
    prisma.sys_params.findMany({
      where,
      orderBy: { created_at: 'desc' },
      skip: offset,
      take: limit
    })
  ]);

  return {
    list: params || [],
    total: total || 0,
    page,
    limit
  };
};

/**
 * Get all system parameters (without pagination)
 * @returns {Promise<Array>} All params
 */
const getAllParams = async () => {
  const params = await prisma.sys_params.findMany({
    orderBy: { param_code: 'asc' }
  });

  return params || [];
};

/**
 * Get parameter by ID
 * @param {string} id - Parameter ID
 * @returns {Promise<Object|null>} Parameter or null
 */
const getParamById = async (id) => {
  const param = await prisma.sys_params.findFirst({
    where: { id: BigInt(id) }
  });

  if (!param) return null;

  return param;
};

/**
 * Get parameter by code
 * @param {string} paramCode - Parameter code
 * @returns {Promise<Object|null>} Parameter or null
 */
const getParamByCode = async (paramCode) => {
  const param = await prisma.sys_params.findFirst({
    where: { param_code: paramCode }
  });

  if (!param) return null;

  return param;
};

/**
 * Get parameter value by code
 * @param {string} paramCode - Parameter code
 * @param {*} defaultValue - Default value if not found
 * @returns {Promise<*>} Parameter value
 */
const getParamValue = async (paramCode, defaultValue = null) => {
  const param = await getParamByCode(paramCode);
  if (!param) return defaultValue;

  // Parse value based on value_type
  switch (param.value_type) {
  case 'number':
    return Number(param.param_value);
  case 'boolean':
    return param.param_value === 'true' || param.param_value === '1';
  case 'array':
  case 'object':
    try {
      return JSON.parse(param.param_value);
    } catch {
      return param.param_value;
    }
  default:
    return param.param_value;
  }
};

/**
 * Create system parameter
 * @param {number} userId - Creator user ID
 * @param {Object} data - Parameter data
 * @returns {Promise<Object>} Created parameter
 */
const createParam = async (userId, data) => {
  let param;
  try {
    param = await prisma.sys_params.create({
      data: {
        param_code: data.paramCode,
        param_value: data.paramValue,
        value_type: data.valueType || 'string',
        param_type: data.paramType !== undefined ? data.paramType : 1,
        remark: data.remark
        // Note: creator column doesn't exist in sys_params table
      }
    });
  } catch (error) {
    logger.error('Failed to create param:', error);
    if (error.code === 'P2002') {
      throw new Error('Parameter code already exists');
    }
    throw new Error('Failed to create system parameter');
  }

  return param;
};

/**
 * Update system parameter
 * @param {string} id - Parameter ID
 * @param {Object} data - Update data
 * @returns {Promise<Object>} Updated parameter
 */
const updateParam = async (id, data) => {
  const updateData = { updated_at: new Date() };

  if (data.paramCode !== undefined) updateData.param_code = data.paramCode;
  if (data.paramValue !== undefined) updateData.param_value = data.paramValue;
  if (data.valueType !== undefined) updateData.value_type = data.valueType;
  if (data.paramType !== undefined) updateData.param_type = data.paramType;
  if (data.remark !== undefined) updateData.remark = data.remark;
  // Note: updater column doesn't exist in sys_params table

  let param;
  try {
    param = await prisma.sys_params.update({
      where: { id: BigInt(id) },
      data: updateData
    });
  } catch (error) {
    logger.error('Failed to update param:', error);
    if (error.code === 'P2002') {
      throw new Error('Parameter code already exists');
    }
    throw new Error('Failed to update system parameter');
  }

  return param;
};

/**
 * Delete system parameter
 * @param {string} id - Parameter ID
 */
const deleteParam = async (id) => {
  try {
    await prisma.sys_params.delete({ where: { id: BigInt(id) } });
  } catch (error) {
    logger.error('Failed to delete param:', error);
    throw new Error('Failed to delete system parameter');
  }
};

/**
 * Batch delete system parameters
 * @param {Array<string>} ids - Parameter IDs to delete
 */
const deleteParams = async (ids) => {
  try {
    await prisma.sys_params.deleteMany({
      where: { id: { in: ids.map(id => BigInt(id)) } }
    });
  } catch (error) {
    logger.error('Failed to delete params:', error);
    throw new Error('Failed to delete system parameters');
  }
};

// ==================== DICTIONARY TYPES ====================

/**
 * Get dictionary types (paginated)
 * @param {Object} options - Pagination options
 * @returns {Promise<Object>} Paginated dict types
 */
const listDictTypes = async ({ page = 1, limit = 20 } = {}) => {
  const offset = (page - 1) * limit;

  const [total, types] = await Promise.all([
    prisma.sys_dict_type.count(),
    prisma.sys_dict_type.findMany({
      orderBy: [{ sort: 'asc' }, { created_at: 'desc' }],
      skip: offset,
      take: limit
    })
  ]);

  return {
    list: types || [],
    total: total || 0,
    page,
    limit
  };
};

/**
 * Get all dictionary types (without pagination)
 * @returns {Promise<Array>} All dict types
 */
const getAllDictTypes = async () => {
  const types = await prisma.sys_dict_type.findMany({
    orderBy: { sort: 'asc' }
  });

  return types || [];
};

/**
 * Get dictionary type by ID
 * @param {string} id - Dictionary type ID
 * @returns {Promise<Object|null>} Dictionary type or null
 */
const getDictTypeById = async (id) => {
  const type = await prisma.sys_dict_type.findFirst({
    where: { id: BigInt(id) }
  });

  if (!type) return null;

  return type;
};

/**
 * Get dictionary type by type code
 * @param {string} dictType - Dictionary type code
 * @returns {Promise<Object|null>} Dictionary type or null
 */
const getDictTypeByCode = async (dictType) => {
  const type = await prisma.sys_dict_type.findFirst({
    where: { dict_type: dictType }
  });

  if (!type) return null;

  return type;
};

/**
 * Create dictionary type
 * @param {number} userId - Creator user ID
 * @param {Object} data - Dictionary type data
 * @returns {Promise<Object>} Created dictionary type
 */
const createDictType = async (userId, data) => {
  let type;
  try {
    type = await prisma.sys_dict_type.create({
      data: {
        dict_type: data.dictType,
        dict_name: data.dictName,
        remark: data.remark,
        sort: data.sort || 0
        // Note: creator column removed as it doesn't exist in current schema
      }
    });
  } catch (error) {
    logger.error('Failed to create dict type:', error);
    if (error.code === 'P2002') {
      throw new Error('Dictionary type code already exists');
    }
    throw new Error('Failed to create dictionary type');
  }

  return type;
};

/**
 * Update dictionary type
 * @param {string} id - Dictionary type ID
 * @param {Object} data - Update data
 * @returns {Promise<Object>} Updated dictionary type
 */
const updateDictType = async (id, data) => {
  const updateData = { updated_at: new Date() };

  if (data.dictType !== undefined) updateData.dict_type = data.dictType;
  if (data.dictName !== undefined) updateData.dict_name = data.dictName;
  if (data.remark !== undefined) updateData.remark = data.remark;
  if (data.sort !== undefined) updateData.sort = data.sort;
  // Note: updater column doesn't exist in sys_dict_type; skipping data.updater

  let type;
  try {
    type = await prisma.sys_dict_type.update({
      where: { id: BigInt(id) },
      data: updateData
    });
  } catch (error) {
    logger.error('Failed to update dict type:', error);
    if (error.code === 'P2002') {
      throw new Error('Dictionary type code already exists');
    }
    throw new Error('Failed to update dictionary type');
  }

  return type;
};

/**
 * Delete dictionary type
 * @param {string} id - Dictionary type ID
 */
const deleteDictType = async (id) => {
  try {
    // Note: Will cascade delete related dict_data entries
    await prisma.sys_dict_type.delete({ where: { id: BigInt(id) } });
  } catch (error) {
    logger.error('Failed to delete dict type:', error);
    throw new Error('Failed to delete dictionary type');
  }
};

/**
 * Batch delete dictionary types
 * @param {Array<string>} ids - Dictionary type IDs to delete
 */
const deleteDictTypes = async (ids) => {
  try {
    await prisma.sys_dict_type.deleteMany({
      where: { id: { in: ids.map(id => BigInt(id)) } }
    });
  } catch (error) {
    logger.error('Failed to delete dict types:', error);
    throw new Error('Failed to delete dictionary types');
  }
};

// ==================== DICTIONARY DATA ====================

/**
 * Get dictionary data (paginated)
 * @param {Object} options - Pagination and filter options
 * @returns {Promise<Object>} Paginated dict data
 */
const listDictData = async ({ page = 1, limit = 20, dictTypeId } = {}) => {
  const offset = (page - 1) * limit;

  const where = {};

  if (dictTypeId) {
    where.dict_type_id = BigInt(dictTypeId);
  }

  const [total, items] = await Promise.all([
    prisma.sys_dict_data.count({ where }),
    prisma.sys_dict_data.findMany({
      where,
      include: {
        sys_dict_type: {
          select: { id: true, dict_type: true, dict_name: true }
        }
      },
      orderBy: [{ sort: 'asc' }, { created_at: 'desc' }],
      skip: offset,
      take: limit
    })
  ]);

  // Reshape to match original Supabase nested alias: dict_type: sys_dict_type(...)
  const list = (items || []).map(item => {
    const { sys_dict_type, ...rest } = item;
    return { ...rest, dict_type: sys_dict_type };
  });

  return {
    list,
    total: total || 0,
    page,
    limit
  };
};

/**
 * Get all dictionary data for a type
 * @param {string} dictTypeId - Dictionary type ID
 * @returns {Promise<Array>} All dict data for type
 */
const getDictDataByTypeId = async (dictTypeId) => {
  const items = await prisma.sys_dict_data.findMany({
    where: { dict_type_id: BigInt(dictTypeId) },
    orderBy: { sort: 'asc' }
  });

  return items || [];
};

/**
 * Get dictionary data by type code
 * @param {string} dictType - Dictionary type code
 * @returns {Promise<Array>} Dict data for type
 */
const getDictDataByType = async (dictType) => {
  // Return empty array if database is not configured (public endpoint)
  // First get the dict type
  const type = await getDictTypeByCode(dictType);
  if (!type) return [];

  return getDictDataByTypeId(type.id);
};

/**
 * Get dictionary data by ID
 * @param {string} id - Dictionary data ID
 * @returns {Promise<Object|null>} Dictionary data or null
 */
const getDictDataById = async (id) => {
  const item = await prisma.sys_dict_data.findFirst({
    where: { id: BigInt(id) },
    include: {
      sys_dict_type: {
        select: { id: true, dict_type: true, dict_name: true }
      }
    }
  });

  if (!item) return null;

  // Reshape to match original Supabase nested alias
  const { sys_dict_type, ...rest } = item;
  return { ...rest, dict_type: sys_dict_type };
};

/**
 * Create dictionary data
 * @param {number} userId - Creator user ID
 * @param {Object} data - Dictionary data
 * @returns {Promise<Object>} Created dictionary data
 */
const createDictData = async (userId, data) => {
  let item;
  try {
    item = await prisma.sys_dict_data.create({
      data: {
        dict_type_id: data.dictTypeId ? BigInt(data.dictTypeId) : null,
        dict_label: data.dictLabel,
        dict_value: data.dictValue,
        remark: data.remark,
        sort: data.sort || 0
        // Note: creator column removed as it doesn't exist in current schema
      },
      include: {
        sys_dict_type: {
          select: { id: true, dict_type: true, dict_name: true }
        }
      }
    });
  } catch (error) {
    logger.error('Failed to create dict data:', error);
    if (error.code === 'P2003') {
      throw new Error('Invalid dictionary type ID');
    }
    throw new Error('Failed to create dictionary data');
  }

  // Reshape to match original Supabase nested alias
  const { sys_dict_type, ...rest } = item;
  return { ...rest, dict_type: sys_dict_type };
};

/**
 * Update dictionary data
 * @param {string} id - Dictionary data ID
 * @param {Object} data - Update data
 * @returns {Promise<Object>} Updated dictionary data
 */
const updateDictData = async (id, data) => {
  const updateData = { updated_at: new Date() };

  if (data.dictTypeId !== undefined) updateData.dict_type_id = BigInt(data.dictTypeId);
  if (data.dictLabel !== undefined) updateData.dict_label = data.dictLabel;
  if (data.dictValue !== undefined) updateData.dict_value = data.dictValue;
  if (data.remark !== undefined) updateData.remark = data.remark;
  if (data.sort !== undefined) updateData.sort = data.sort;
  // Note: updater column doesn't exist in sys_dict_data; skipping data.updater

  let item;
  try {
    item = await prisma.sys_dict_data.update({
      where: { id: BigInt(id) },
      data: updateData,
      include: {
        sys_dict_type: {
          select: { id: true, dict_type: true, dict_name: true }
        }
      }
    });
  } catch (error) {
    logger.error('Failed to update dict data:', error);
    if (error.code === 'P2003') {
      throw new Error('Invalid dictionary type ID');
    }
    throw new Error('Failed to update dictionary data');
  }

  // Reshape to match original Supabase nested alias
  const { sys_dict_type, ...rest } = item;
  return { ...rest, dict_type: sys_dict_type };
};

/**
 * Delete dictionary data
 * @param {string} id - Dictionary data ID
 */
const deleteDictData = async (id) => {
  try {
    await prisma.sys_dict_data.delete({ where: { id: BigInt(id) } });
  } catch (error) {
    logger.error('Failed to delete dict data:', error);
    throw new Error('Failed to delete dictionary data');
  }
};

/**
 * Batch delete dictionary data
 * @param {Array<string>} ids - Dictionary data IDs to delete
 */
const deleteDictDataBatch = async (ids) => {
  try {
    await prisma.sys_dict_data.deleteMany({
      where: { id: { in: ids.map(id => BigInt(id)) } }
    });
  } catch (error) {
    logger.error('Failed to delete dict data batch:', error);
    throw new Error('Failed to delete dictionary data');
  }
};

module.exports = {
  // System Parameters
  listParams,
  getAllParams,
  getParamById,
  getParamByCode,
  getParamValue,
  createParam,
  updateParam,
  deleteParam,
  deleteParams,

  // Dictionary Types
  listDictTypes,
  getAllDictTypes,
  getDictTypeById,
  getDictTypeByCode,
  createDictType,
  updateDictType,
  deleteDictType,
  deleteDictTypes,

  // Dictionary Data
  listDictData,
  getDictDataByTypeId,
  getDictDataByType,
  getDictDataById,
  createDictData,
  updateDictData,
  deleteDictData,
  deleteDictDataBatch
};
