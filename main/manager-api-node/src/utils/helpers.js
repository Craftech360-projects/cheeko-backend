/**
 * Helper Utilities
 *
 * Common utility functions used across the application.
 */

const { v4: uuidv4 } = require('uuid');

/**
 * Generate a UUID v4
 * @returns {string} UUID string
 */
const generateUUID = () => {
  return uuidv4();
};

/**
 * Generate a random 6-digit code (for device validation)
 * @returns {string} 6-digit code
 */
const generateDeviceCode = () => {
  return Math.floor(100000 + Math.random() * 900000).toString();
};

/**
 * Generate a random alphanumeric string
 * @param {number} length - Length of the string
 * @returns {string} Random string
 */
const generateRandomString = (length = 32) => {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';
  for (let i = 0; i < length; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
};

/**
 * Parse pagination parameters from query
 * @param {Object} query - Express request query object
 * @param {number} defaultLimit - Default items per page
 * @param {number} maxLimit - Maximum items per page
 * @returns {Object} { page, limit, offset }
 */
const parsePagination = (query, defaultLimit = 10, maxLimit = 100) => {
  let page = parseInt(query.page) || 1;
  let limit = parseInt(query.limit) || parseInt(query.pageSize) || defaultLimit;

  if (page < 1) page = 1;
  if (limit < 1) limit = defaultLimit;
  if (limit > maxLimit) limit = maxLimit;

  const offset = (page - 1) * limit;

  return { page, limit, offset };
};

/**
 * Parse sort parameters from query
 * Supports format: "field:asc" or "field:desc"
 * @param {Object} query - Express request query object
 * @param {string} defaultField - Default sort field
 * @param {string} defaultOrder - Default sort order
 * @returns {Object} { field, order, ascending }
 */
const parseSort = (query, defaultField = 'created_at', defaultOrder = 'desc') => {
  let field = defaultField;
  let order = defaultOrder;

  if (query.sort) {
    const parts = query.sort.split(':');
    field = parts[0] || defaultField;
    order = (parts[1] || defaultOrder).toLowerCase();
  }

  if (query.sortField) field = query.sortField;
  if (query.sortOrder) order = query.sortOrder.toLowerCase();

  const ascending = order === 'asc';

  return { field, order, ascending };
};

/**
 * Validate MAC address format
 * @param {string} mac - MAC address string
 * @returns {boolean} True if valid
 */
const isValidMacAddress = (mac) => {
  if (!mac) return false;
  // Accept formats: AA:BB:CC:DD:EE:FF or AA-BB-CC-DD-EE-FF or AABBCCDDEEFF
  const macRegex = /^([0-9A-Fa-f]{2}[:-]){5}([0-9A-Fa-f]{2})$|^([0-9A-Fa-f]{12})$/;
  return macRegex.test(mac);
};

/**
 * Normalize MAC address to uppercase with colons
 * @param {string} mac - MAC address string
 * @returns {string} Normalized MAC address
 */
const normalizeMacAddress = (mac) => {
  if (!mac) return null;
  // Remove all separators and convert to uppercase
  const clean = mac.replace(/[:-]/g, '').toUpperCase();
  if (clean.length !== 12) return null;
  // Insert colons
  return clean.match(/.{2}/g).join(':');
};

/**
 * Check if a value is empty (null, undefined, empty string, or empty array)
 * @param {*} value - Value to check
 * @returns {boolean} True if empty
 */
const isEmpty = (value) => {
  if (value === null || value === undefined) return true;
  if (typeof value === 'string' && value.trim() === '') return true;
  if (Array.isArray(value) && value.length === 0) return true;
  if (typeof value === 'object' && Object.keys(value).length === 0) return true;
  return false;
};

/**
 * Remove null/undefined values from an object
 * @param {Object} obj - Object to clean
 * @returns {Object} Cleaned object
 */
const removeNullValues = (obj) => {
  const cleaned = {};
  for (const [key, value] of Object.entries(obj)) {
    if (value !== null && value !== undefined) {
      cleaned[key] = value;
    }
  }
  return cleaned;
};

/**
 * Convert camelCase to snake_case
 * @param {string} str - camelCase string
 * @returns {string} snake_case string
 */
const camelToSnake = (str) => {
  return str.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
};

/**
 * Convert snake_case to camelCase
 * @param {string} str - snake_case string
 * @returns {string} camelCase string
 */
const snakeToCamel = (str) => {
  return str.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase());
};

/**
 * Transform object keys from snake_case to camelCase
 * @param {Object} obj - Object with snake_case keys
 * @returns {Object} Object with camelCase keys
 */
const transformKeysToCamel = (obj) => {
  if (Array.isArray(obj)) {
    return obj.map(transformKeysToCamel);
  }
  if (obj !== null && typeof obj === 'object') {
    const transformed = {};
    for (const [key, value] of Object.entries(obj)) {
      transformed[snakeToCamel(key)] = transformKeysToCamel(value);
    }
    return transformed;
  }
  return obj;
};

/**
 * Transform object keys from camelCase to snake_case
 * @param {Object} obj - Object with camelCase keys
 * @returns {Object} Object with snake_case keys
 */
const transformKeysToSnake = (obj) => {
  if (Array.isArray(obj)) {
    return obj.map(transformKeysToSnake);
  }
  if (obj !== null && typeof obj === 'object') {
    const transformed = {};
    for (const [key, value] of Object.entries(obj)) {
      transformed[camelToSnake(key)] = transformKeysToSnake(value);
    }
    return transformed;
  }
  return obj;
};

/**
 * Sleep for a specified duration
 * @param {number} ms - Milliseconds to sleep
 * @returns {Promise} Promise that resolves after the duration
 */
const sleep = (ms) => {
  return new Promise((resolve) => setTimeout(resolve, ms));
};

module.exports = {
  generateUUID,
  generateDeviceCode,
  generateRandomString,
  parsePagination,
  parseSort,
  isValidMacAddress,
  normalizeMacAddress,
  isEmpty,
  removeNullValues,
  camelToSnake,
  snakeToCamel,
  transformKeysToCamel,
  transformKeysToSnake,
  sleep
};
