/**
 * Default Configuration
 *
 * Base configuration for all environments.
 * Environment-specific configs override these values.
 */

module.exports = {
  // Server
  server: {
    port: parseInt(process.env.PORT) || 8002,
    contextPath: process.env.CONTEXT_PATH || '/toy',
    env: process.env.NODE_ENV || 'development'
  },

  // Supabase
  supabase: {
    url: process.env.SUPABASE_URL,
    anonKey: process.env.SUPABASE_ANON_KEY,
    serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY
  },

  // Service Auth
  auth: {
    serviceSecretKey: process.env.SERVICE_SECRET_KEY
  },

  // Qdrant Vector Database
  qdrant: {
    url: process.env.QDRANT_URL,
    apiKey: process.env.QDRANT_API_KEY,
    collection: process.env.QDRANT_COLLECTION_NAME || 'rfid_content',
    vectorSize: parseInt(process.env.QDRANT_VECTOR_SIZE) || 1536
  },

  // Mem0 Memory API
  mem0: {
    apiKey: process.env.MEM0_API_KEY,
    apiUrl: process.env.MEM0_API_URL || 'https://api.mem0.ai/v1',
    memoryLimit: parseInt(process.env.MEM0_MEMORY_LIMIT) || 20,
    timeoutMs: parseInt(process.env.MEM0_TIMEOUT_MS) || 5000
  },

  // Logging
  logging: {
    level: process.env.LOG_LEVEL || 'info',
    dir: process.env.LOGS_DIR || 'logs',
    maxSize: parseInt(process.env.LOG_MAX_SIZE) || 5242880, // 5MB
    maxFiles: parseInt(process.env.LOG_MAX_FILES) || 5,
    enableInTest: process.env.LOG_IN_TEST === 'true'
  },

  // Rate Limiting
  rateLimit: {
    windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 900000, // 15 minutes
    maxRequests: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS) || 100
  },

  // CORS
  cors: {
    origins: process.env.CORS_ORIGINS
      ? process.env.CORS_ORIGINS.split(',').map(s => s.trim())
      : ['http://localhost:8080', 'http://localhost:3000']
  },

  // Swagger/OpenAPI
  swagger: {
    enabled: true,
    path: '/doc.html'
  }
};
