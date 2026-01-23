/**
 * System Service
 *
 * Handles system parameters and dictionary management
 */

const { supabaseAdmin } = require('../config/database');
const logger = require('../utils/logger');

// ==================== SYSTEM PARAMETERS ====================

/**
 * Get system parameters (paginated)
 * @param {Object} options - Pagination and filter options
 * @returns {Promise<Object>} Paginated params
 */
const listParams = async ({ page = 1, limit = 20, paramType } = {}) => {
  if (!supabaseAdmin) throw new Error('Database not configured');

  const offset = (page - 1) * limit;

  let countQuery = supabaseAdmin
    .from('sys_params')
    .select('id', { count: 'exact', head: true });

  let dataQuery = supabaseAdmin
    .from('sys_params')
    .select('*')
    .order('create_date', { ascending: false });

  if (paramType !== undefined) {
    countQuery = countQuery.eq('param_type', paramType);
    dataQuery = dataQuery.eq('param_type', paramType);
  }

  const { count } = await countQuery;
  const { data: params, error } = await dataQuery.range(offset, offset + limit - 1);

  if (error) {
    logger.error('Failed to fetch params:', error);
    throw new Error('Failed to fetch system parameters');
  }

  return {
    list: params || [],
    total: count || 0,
    page,
    limit
  };
};

/**
 * Get all system parameters (without pagination)
 * @returns {Promise<Array>} All params
 */
const getAllParams = async () => {
  if (!supabaseAdmin) throw new Error('Database not configured');

  const { data: params, error } = await supabaseAdmin
    .from('sys_params')
    .select('*')
    .order('param_code', { ascending: true });

  if (error) {
    logger.error('Failed to fetch all params:', error);
    throw new Error('Failed to fetch system parameters');
  }

  return params || [];
};

/**
 * Get parameter by ID
 * @param {string} id - Parameter ID
 * @returns {Promise<Object|null>} Parameter or null
 */
const getParamById = async (id) => {
  if (!supabaseAdmin) throw new Error('Database not configured');

  const { data: param, error } = await supabaseAdmin
    .from('sys_params')
    .select('*')
    .eq('id', id)
    .single();

  if (error || !param) return null;

  return param;
};

/**
 * Get parameter by code
 * @param {string} paramCode - Parameter code
 * @returns {Promise<Object|null>} Parameter or null
 */
const getParamByCode = async (paramCode) => {
  if (!supabaseAdmin) throw new Error('Database not configured');

  const { data: param, error } = await supabaseAdmin
    .from('sys_params')
    .select('*')
    .eq('param_code', paramCode)
    .single();

  if (error || !param) return null;

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
  if (!supabaseAdmin) throw new Error('Database not configured');

  const { data: param, error } = await supabaseAdmin
    .from('sys_params')
    .insert({
      param_code: data.paramCode,
      param_value: data.paramValue,
      value_type: data.valueType || 'string',
      param_type: data.paramType !== undefined ? data.paramType : 1,
      remark: data.remark,
      creator: userId
    })
    .select()
    .single();

  if (error) {
    logger.error('Failed to create param:', error);
    if (error.code === '23505') {
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
  if (!supabaseAdmin) throw new Error('Database not configured');

  const updateData = { update_date: new Date().toISOString() };

  if (data.paramCode !== undefined) updateData.param_code = data.paramCode;
  if (data.paramValue !== undefined) updateData.param_value = data.paramValue;
  if (data.valueType !== undefined) updateData.value_type = data.valueType;
  if (data.paramType !== undefined) updateData.param_type = data.paramType;
  if (data.remark !== undefined) updateData.remark = data.remark;
  if (data.updater !== undefined) updateData.updater = data.updater;

  const { data: param, error } = await supabaseAdmin
    .from('sys_params')
    .update(updateData)
    .eq('id', id)
    .select()
    .single();

  if (error) {
    logger.error('Failed to update param:', error);
    if (error.code === '23505') {
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
  if (!supabaseAdmin) throw new Error('Database not configured');

  const { error } = await supabaseAdmin
    .from('sys_params')
    .delete()
    .eq('id', id);

  if (error) {
    logger.error('Failed to delete param:', error);
    throw new Error('Failed to delete system parameter');
  }
};

/**
 * Batch delete system parameters
 * @param {Array<string>} ids - Parameter IDs to delete
 */
const deleteParams = async (ids) => {
  if (!supabaseAdmin) throw new Error('Database not configured');

  const { error } = await supabaseAdmin
    .from('sys_params')
    .delete()
    .in('id', ids);

  if (error) {
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
  if (!supabaseAdmin) throw new Error('Database not configured');

  const offset = (page - 1) * limit;

  const { count } = await supabaseAdmin
    .from('sys_dict_type')
    .select('id', { count: 'exact', head: true });

  const { data: types, error } = await supabaseAdmin
    .from('sys_dict_type')
    .select('*')
    .order('sort', { ascending: true })
    .order('create_date', { ascending: false })
    .range(offset, offset + limit - 1);

  if (error) {
    logger.error('Failed to fetch dict types:', error);
    throw new Error('Failed to fetch dictionary types');
  }

  return {
    list: types || [],
    total: count || 0,
    page,
    limit
  };
};

/**
 * Get all dictionary types (without pagination)
 * @returns {Promise<Array>} All dict types
 */
const getAllDictTypes = async () => {
  if (!supabaseAdmin) throw new Error('Database not configured');

  const { data: types, error } = await supabaseAdmin
    .from('sys_dict_type')
    .select('*')
    .order('sort', { ascending: true });

  if (error) {
    logger.error('Failed to fetch all dict types:', error);
    throw new Error('Failed to fetch dictionary types');
  }

  return types || [];
};

/**
 * Get dictionary type by ID
 * @param {string} id - Dictionary type ID
 * @returns {Promise<Object|null>} Dictionary type or null
 */
const getDictTypeById = async (id) => {
  if (!supabaseAdmin) throw new Error('Database not configured');

  const { data: type, error } = await supabaseAdmin
    .from('sys_dict_type')
    .select('*')
    .eq('id', id)
    .single();

  if (error || !type) return null;

  return type;
};

/**
 * Get dictionary type by type code
 * @param {string} dictType - Dictionary type code
 * @returns {Promise<Object|null>} Dictionary type or null
 */
const getDictTypeByCode = async (dictType) => {
  if (!supabaseAdmin) throw new Error('Database not configured');

  const { data: type, error } = await supabaseAdmin
    .from('sys_dict_type')
    .select('*')
    .eq('dict_type', dictType)
    .single();

  if (error || !type) return null;

  return type;
};

/**
 * Create dictionary type
 * @param {number} userId - Creator user ID
 * @param {Object} data - Dictionary type data
 * @returns {Promise<Object>} Created dictionary type
 */
const createDictType = async (userId, data) => {
  if (!supabaseAdmin) throw new Error('Database not configured');

  const { data: type, error } = await supabaseAdmin
    .from('sys_dict_type')
    .insert({
      dict_type: data.dictType,
      dict_name: data.dictName,
      remark: data.remark,
      sort: data.sort || 0,
      creator: userId
    })
    .select()
    .single();

  if (error) {
    logger.error('Failed to create dict type:', error);
    if (error.code === '23505') {
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
  if (!supabaseAdmin) throw new Error('Database not configured');

  const updateData = { update_date: new Date().toISOString() };

  if (data.dictType !== undefined) updateData.dict_type = data.dictType;
  if (data.dictName !== undefined) updateData.dict_name = data.dictName;
  if (data.remark !== undefined) updateData.remark = data.remark;
  if (data.sort !== undefined) updateData.sort = data.sort;
  if (data.updater !== undefined) updateData.updater = data.updater;

  const { data: type, error } = await supabaseAdmin
    .from('sys_dict_type')
    .update(updateData)
    .eq('id', id)
    .select()
    .single();

  if (error) {
    logger.error('Failed to update dict type:', error);
    if (error.code === '23505') {
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
  if (!supabaseAdmin) throw new Error('Database not configured');

  // Note: Will cascade delete related dict_data entries
  const { error } = await supabaseAdmin
    .from('sys_dict_type')
    .delete()
    .eq('id', id);

  if (error) {
    logger.error('Failed to delete dict type:', error);
    throw new Error('Failed to delete dictionary type');
  }
};

/**
 * Batch delete dictionary types
 * @param {Array<string>} ids - Dictionary type IDs to delete
 */
const deleteDictTypes = async (ids) => {
  if (!supabaseAdmin) throw new Error('Database not configured');

  const { error } = await supabaseAdmin
    .from('sys_dict_type')
    .delete()
    .in('id', ids);

  if (error) {
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
  if (!supabaseAdmin) throw new Error('Database not configured');

  const offset = (page - 1) * limit;

  let countQuery = supabaseAdmin
    .from('sys_dict_data')
    .select('id', { count: 'exact', head: true });

  let dataQuery = supabaseAdmin
    .from('sys_dict_data')
    .select('*, dict_type:sys_dict_type(id, dict_type, dict_name)')
    .order('sort', { ascending: true })
    .order('create_date', { ascending: false });

  if (dictTypeId) {
    countQuery = countQuery.eq('dict_type_id', dictTypeId);
    dataQuery = dataQuery.eq('dict_type_id', dictTypeId);
  }

  const { count } = await countQuery;
  const { data: items, error } = await dataQuery.range(offset, offset + limit - 1);

  if (error) {
    logger.error('Failed to fetch dict data:', error);
    throw new Error('Failed to fetch dictionary data');
  }

  return {
    list: items || [],
    total: count || 0,
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
  if (!supabaseAdmin) throw new Error('Database not configured');

  const { data: items, error } = await supabaseAdmin
    .from('sys_dict_data')
    .select('*')
    .eq('dict_type_id', dictTypeId)
    .order('sort', { ascending: true });

  if (error) {
    logger.error('Failed to fetch dict data by type:', error);
    throw new Error('Failed to fetch dictionary data');
  }

  return items || [];
};

/**
 * Get dictionary data by type code
 * @param {string} dictType - Dictionary type code
 * @returns {Promise<Array>} Dict data for type
 */
const getDictDataByType = async (dictType) => {
  // Return empty array if database is not configured (public endpoint)
  if (!supabaseAdmin) return [];

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
  if (!supabaseAdmin) throw new Error('Database not configured');

  const { data: item, error } = await supabaseAdmin
    .from('sys_dict_data')
    .select('*, dict_type:sys_dict_type(id, dict_type, dict_name)')
    .eq('id', id)
    .single();

  if (error || !item) return null;

  return item;
};

/**
 * Create dictionary data
 * @param {number} userId - Creator user ID
 * @param {Object} data - Dictionary data
 * @returns {Promise<Object>} Created dictionary data
 */
const createDictData = async (userId, data) => {
  if (!supabaseAdmin) throw new Error('Database not configured');

  const { data: item, error } = await supabaseAdmin
    .from('sys_dict_data')
    .insert({
      dict_type_id: data.dictTypeId,
      dict_label: data.dictLabel,
      dict_value: data.dictValue,
      remark: data.remark,
      sort: data.sort || 0,
      creator: userId
    })
    .select('*, dict_type:sys_dict_type(id, dict_type, dict_name)')
    .single();

  if (error) {
    logger.error('Failed to create dict data:', error);
    if (error.code === '23503') {
      throw new Error('Invalid dictionary type ID');
    }
    throw new Error('Failed to create dictionary data');
  }

  return item;
};

/**
 * Update dictionary data
 * @param {string} id - Dictionary data ID
 * @param {Object} data - Update data
 * @returns {Promise<Object>} Updated dictionary data
 */
const updateDictData = async (id, data) => {
  if (!supabaseAdmin) throw new Error('Database not configured');

  const updateData = { update_date: new Date().toISOString() };

  if (data.dictTypeId !== undefined) updateData.dict_type_id = data.dictTypeId;
  if (data.dictLabel !== undefined) updateData.dict_label = data.dictLabel;
  if (data.dictValue !== undefined) updateData.dict_value = data.dictValue;
  if (data.remark !== undefined) updateData.remark = data.remark;
  if (data.sort !== undefined) updateData.sort = data.sort;
  if (data.updater !== undefined) updateData.updater = data.updater;

  const { data: item, error } = await supabaseAdmin
    .from('sys_dict_data')
    .update(updateData)
    .eq('id', id)
    .select('*, dict_type:sys_dict_type(id, dict_type, dict_name)')
    .single();

  if (error) {
    logger.error('Failed to update dict data:', error);
    if (error.code === '23503') {
      throw new Error('Invalid dictionary type ID');
    }
    throw new Error('Failed to update dictionary data');
  }

  return item;
};

/**
 * Delete dictionary data
 * @param {string} id - Dictionary data ID
 */
const deleteDictData = async (id) => {
  if (!supabaseAdmin) throw new Error('Database not configured');

  const { error } = await supabaseAdmin
    .from('sys_dict_data')
    .delete()
    .eq('id', id);

  if (error) {
    logger.error('Failed to delete dict data:', error);
    throw new Error('Failed to delete dictionary data');
  }
};

/**
 * Batch delete dictionary data
 * @param {Array<string>} ids - Dictionary data IDs to delete
 */
const deleteDictDataBatch = async (ids) => {
  if (!supabaseAdmin) throw new Error('Database not configured');

  const { error } = await supabaseAdmin
    .from('sys_dict_data')
    .delete()
    .in('id', ids);

  if (error) {
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
