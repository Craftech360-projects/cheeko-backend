/**
 * Validation Middleware
 *
 * Request validation using Joi schemas.
 * Validates body, query, and params.
 */

const Joi = require('joi');
const { badRequest } = require('../utils/response');

/**
 * Validate request against Joi schema
 * @param {Object} schema - Joi schema object with body, query, params keys
 * @param {Object} options - Validation options
 */
const validate = (schema, options = {}) => {
  const defaultOptions = {
    abortEarly: false,
    allowUnknown: true,
    stripUnknown: true,
    ...options
  };

  return (req, res, next) => {
    const errors = [];

    // Validate body
    if (schema.body) {
      const { error, value } = schema.body.validate(req.body, defaultOptions);
      if (error) {
        errors.push(...error.details.map(d => ({ field: d.path.join('.'), message: d.message })));
      } else {
        req.body = value;
      }
    }

    // Validate query
    if (schema.query) {
      const { error, value } = schema.query.validate(req.query, defaultOptions);
      if (error) {
        errors.push(...error.details.map(d => ({ field: `query.${d.path.join('.')}`, message: d.message })));
      } else {
        req.query = value;
      }
    }

    // Validate params
    if (schema.params) {
      const { error, value } = schema.params.validate(req.params, defaultOptions);
      if (error) {
        errors.push(...error.details.map(d => ({ field: `params.${d.path.join('.')}`, message: d.message })));
      } else {
        req.params = value;
      }
    }

    if (errors.length > 0) {
      return badRequest(res, 'Validation failed', errors);
    }

    next();
  };
};

// =============================================
// Common Validation Schemas
// =============================================

const schemas = {
  // Pagination query params
  pagination: Joi.object({
    page: Joi.number().integer().min(1).default(1),
    limit: Joi.number().integer().min(1).max(100).default(10),
    pageSize: Joi.number().integer().min(1).max(100),
    sort: Joi.string(),
    sortField: Joi.string(),
    sortOrder: Joi.string().valid('asc', 'desc')
  }),

  // UUID parameter
  uuidParam: Joi.object({
    id: Joi.string().uuid().required()
  }),

  // MAC address parameter
  macParam: Joi.object({
    mac: Joi.string().pattern(/^([0-9A-Fa-f]{2}[:-]){5}([0-9A-Fa-f]{2})$|^([0-9A-Fa-f]{12})$/).required()
  }),

  // ID parameter (bigint)
  idParam: Joi.object({
    id: Joi.number().integer().positive().required()
  }),

  // Login request
  login: Joi.object({
    username: Joi.string().min(1).max(100).required(),
    password: Joi.string().min(1).max(100).required(),
    captcha: Joi.string(),
    captchaId: Joi.string()
  }),

  // Register request
  register: Joi.object({
    username: Joi.string().min(3).max(100).required(),
    password: Joi.string().min(6).max(100).required(),
    email: Joi.string().email(),
    phone: Joi.string()
  }),

  // Device registration
  deviceRegister: Joi.object({
    mac: Joi.string().pattern(/^([0-9A-Fa-f]{2}[:-]){5}([0-9A-Fa-f]{2})$|^([0-9A-Fa-f]{12})$/).required(),
    board: Joi.string(),
    appVersion: Joi.string()
  }),

  // Agent create/update
  agent: Joi.object({
    agentCode: Joi.string().max(100),
    agentName: Joi.string().max(255).required(),
    asrModelId: Joi.string().uuid().allow(null, ''),
    vadModelId: Joi.string().uuid().allow(null, ''),
    llmModelId: Joi.string().uuid().allow(null, ''),
    vllmModelId: Joi.string().uuid().allow(null, ''),
    ttsModelId: Joi.string().uuid().allow(null, ''),
    ttsVoiceId: Joi.string().uuid().allow(null, ''),
    memModelId: Joi.string().uuid().allow(null, ''),
    intentModelId: Joi.string().uuid().allow(null, ''),
    chatHistoryConf: Joi.number().integer().min(0).max(2),
    systemPrompt: Joi.string().allow(null, ''),
    summaryMemory: Joi.string().allow(null, ''),
    langCode: Joi.string().max(10),
    language: Joi.string().max(50)
  }),

  // Agent template create/update
  agentTemplate: Joi.object({
    agentCode: Joi.string().max(100).pattern(/^[^0-9]+$/)
      .messages({ 'string.pattern.base': 'agentCode must not contain numbers' }),
    agentName: Joi.string().max(255).required().pattern(/^[^0-9]+$/)
      .messages({ 'string.pattern.base': 'agentName must not contain numbers' }),
    asrModelId: Joi.string().uuid().allow(null, ''),
    vadModelId: Joi.string().uuid().allow(null, ''),
    llmModelId: Joi.string().uuid().allow(null, ''),
    vllmModelId: Joi.string().uuid().allow(null, ''),
    ttsModelId: Joi.string().uuid().allow(null, ''),
    ttsVoiceId: Joi.string().uuid().allow(null, ''),
    memModelId: Joi.string().uuid().allow(null, ''),
    intentModelId: Joi.string().uuid().allow(null, ''),
    chatHistoryConf: Joi.number().integer().min(0).max(2),
    systemPrompt: Joi.string().allow(null, ''),
    summaryMemory: Joi.string().allow(null, ''),
    langCode: Joi.string().max(10),
    language: Joi.string().max(50),
    isVisible: Joi.number().integer().valid(0, 1).default(1),
    sort: Joi.number().integer().default(0)
  }),

  // Kid profile
  kidProfile: Joi.object({
    name: Joi.string().max(255).required(),
    dateOfBirth: Joi.date().iso(),
    gender: Joi.string().valid('male', 'female', 'other'),
    interests: Joi.array().items(Joi.string()),
    avatarUrl: Joi.string().uri().allow(null, ''),
    primaryLanguage: Joi.string().max(10),
    additionalNotes: Joi.string().allow(null, '')
  }),

  // Content library
  content: Joi.object({
    title: Joi.string().max(500).required(),
    romanized: Joi.string().max(500).allow(null, ''),
    filename: Joi.string().max(500),
    contentType: Joi.string().valid('music', 'story').required(),
    category: Joi.string().max(255),
    alternatives: Joi.array().items(Joi.string()),
    awsS3Url: Joi.string().uri().allow(null, ''),
    durationSeconds: Joi.number().integer().min(0),
    fileSizeBytes: Joi.number().integer().min(0),
    isActive: Joi.number().integer().valid(0, 1)
  }),

  // RFID card mapping
  rfidCardMapping: Joi.object({
    rfidUid: Joi.string().max(50).required(),
    questionId: Joi.number().integer().positive().allow(null),
    questionIds: Joi.array().items(Joi.number().integer().positive()),
    packCode: Joi.string().max(100).allow(null, ''),
    packId: Joi.number().integer().positive().allow(null),
    contentPackId: Joi.number().integer().positive().allow(null),
    notes: Joi.string().max(500).allow(null, ''),
    active: Joi.boolean()
  }),

  // Analytics session
  analyticsSession: Joi.object({
    sessionId: Joi.string().max(100).required(),
    macAddress: Joi.string().max(20).required(),
    agentId: Joi.string().uuid().allow(null, ''),
    modeType: Joi.string().max(50).required(),
    startedAt: Joi.date().iso().required()
  }),

  // Analytics game attempt
  gameAttempt: Joi.object({
    sessionId: Joi.string().max(100).required(),
    macAddress: Joi.string().max(20).required(),
    gameType: Joi.string().max(50).required(),
    questionText: Joi.string().allow(null, ''),
    questionType: Joi.string().max(100).allow(null, ''),
    difficultyLevel: Joi.string().valid('easy', 'medium', 'hard').allow(null),
    correctAnswer: Joi.string().max(500).allow(null, ''),
    userAnswer: Joi.string().max(500).allow(null, ''),
    isCorrect: Joi.boolean(),
    attemptNumber: Joi.number().integer().min(1).max(3),
    responseTimeMs: Joi.number().integer().min(0)
  })
};

module.exports = {
  validate,
  schemas
};
