/**
 * Mem0 Memory Service
 *
 * Handles memory/personalization operations using the Mem0 API.
 * Used for storing and retrieving user preferences, facts, and conversation history.
 * Supports knowledge graph with entities and relations.
 */

const logger = require('../../utils/logger');

// Environment variables
const MEM0_API_KEY = process.env.MEM0_API_KEY;
// Normalize API URL - remove trailing slash and /memories/ suffix if present
let MEM0_API_URL = process.env.MEM0_API_URL || 'https://api.mem0.ai/v1';
MEM0_API_URL = MEM0_API_URL.replace(/\/+$/, '').replace(/\/memories\/?$/, '');

// Configuration
const MEM0_MEMORY_LIMIT = parseInt(process.env.MEM0_MEMORY_LIMIT, 10) || 20;
const MEM0_TIMEOUT_MS = parseInt(process.env.MEM0_TIMEOUT_MS, 10) || 5000;

/**
 * HTTP client for Mem0 API
 * Uses native fetch API available in Node.js 18+
 */
let httpClient = null;

/**
 * Initialize HTTP client for Mem0 API
 * @returns {Object|null} HTTP client configuration or null if not configured
 */
const getClient = () => {
  if (httpClient) {
    return httpClient;
  }

  if (!MEM0_API_KEY) {
    logger.warn('Mem0 API key not configured. Memory features will be disabled.');
    return null;
  }

  httpClient = {
    baseURL: MEM0_API_URL,
    timeout: MEM0_TIMEOUT_MS,
    headers: {
      'Authorization': `Token ${MEM0_API_KEY}`,
      'Content-Type': 'application/json'
    }
  };

  logger.info('Mem0 client initialized', { url: MEM0_API_URL });
  return httpClient;
};

/**
 * Check if Mem0 is available
 * @returns {boolean} True if Mem0 API key is configured
 */
const isAvailable = () => {
  return !!MEM0_API_KEY;
};

/**
 * Test connection to Mem0 API
 * @returns {Promise<boolean>} True if connection is successful
 */
const testConnection = async () => {
  const client = getClient();
  if (!client) {
    return false;
  }

  try {
    // Try to list memories as a health check (with empty user_id returns empty array)
    const response = await makeRequest('GET', '/memories/', { user_id: 'health_check' });
    logger.info('Mem0 connection successful');
    return response !== null;
  } catch (error) {
    logger.error('Mem0 connection failed:', { error: error.message });
    return false;
  }
};

/**
 * Make HTTP request to Mem0 API
 * @param {string} method - HTTP method (GET, POST, etc.)
 * @param {string} path - API path
 * @param {Object} [params] - Query parameters (for GET) or body (for POST)
 * @returns {Promise<Object>} Response data
 */
const makeRequest = async (method, path, params = null) => {
  const client = getClient();
  if (!client) {
    throw new Error('Mem0 client not initialized');
  }

  const url = new URL(path, client.baseURL + '/');
  const options = {
    method,
    headers: client.headers,
    signal: AbortSignal.timeout(client.timeout)
  };

  if (method === 'GET' && params) {
    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined && value !== null) {
        url.searchParams.append(key, value);
      }
    });
  } else if (params) {
    options.body = JSON.stringify(params);
  }

  const response = await fetch(url.toString(), options);

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    const message = errorData.message || errorData.detail || response.statusText;
    throw new Error(`Mem0 API error: ${message}`);
  }

  return response.json();
};

/**
 * Normalize user ID (MAC address) to consistent format
 * @param {string} userId - Device MAC address or user identifier
 * @returns {string} Normalized user ID (lowercase)
 */
const normalizeUserId = (userId) => {
  if (!userId) return '';
  // Keep colons/dashes, just lowercase
  return userId.toLowerCase();
};

/**
 * Search memories for a user using semantic search with graph support
 * @param {Object} options - Search options
 * @param {string} options.userId - User identifier (e.g., device MAC)
 * @param {string} [options.query] - Search query (default: comprehensive query)
 * @param {number} [options.limit] - Max memories to return
 * @returns {Promise<Object>} Search results with memories, relations, and entities
 */
const searchMemories = async ({
  userId,
  query = 'What is known about this person, their family, pets, interests, skills, routines, and feelings?',
  limit = MEM0_MEMORY_LIMIT
}) => {
  if (!userId) {
    throw new Error('User ID is required');
  }

  const client = getClient();
  if (!client) {
    return { memories: [], relations: [], entities: [] };
  }

  try {
    const cleanUserId = normalizeUserId(userId);

    const response = await makeRequest('POST', '/memories/search/', {
      query,
      user_id: cleanUserId,
      limit,
      output_format: 'v1.1',
      enable_graph: true
    });

    // Handle both array and v1.1 format responses
    const results = Array.isArray(response) ? response : (response.results || []);
    const topLevelRelations = response.relations || [];

    const memories = [];
    const allEntities = new Map();
    const allRelations = [...topLevelRelations];

    // Extract memories, entities, and relations from each result
    results.forEach(item => {
      if (item.memory) {
        memories.push(item.memory);
      }

      // Extract entities from this memory (graph feature)
      if (item.entities && Array.isArray(item.entities)) {
        item.entities.forEach(e => {
          if (e.name) {
            allEntities.set(e.id || e.name, {
              id: e.id,
              name: e.name,
              type: e.type || 'unknown'
            });
          }
        });
      }

      // Extract relations from this memory (if any)
      if (item.relations && Array.isArray(item.relations)) {
        allRelations.push(...item.relations);
      }
    });

    const entities = Array.from(allEntities.values());

    logger.debug('Mem0 search completed:', {
      userId: cleanUserId,
      memoriesCount: memories.length,
      relationsCount: allRelations.length,
      entitiesCount: entities.length
    });

    return {
      memories,
      relations: allRelations,
      entities
    };
  } catch (error) {
    logger.error('Mem0 search failed:', { error: error.message, userId });
    return { memories: [], relations: [], entities: [] };
  }
};

/**
 * Get all memories for a user (without semantic search)
 * @param {Object} options - Options
 * @param {string} options.userId - User identifier
 * @returns {Promise<Object>} All memories and relations
 */
const getAllMemories = async ({ userId }) => {
  if (!userId) {
    throw new Error('User ID is required');
  }

  const client = getClient();
  if (!client) {
    return { memories: [], relations: [] };
  }

  try {
    const cleanUserId = normalizeUserId(userId);

    const response = await makeRequest('GET', '/memories/', {
      user_id: cleanUserId,
      enable_graph: true
    });

    // API returns array directly, not { results: [...] }
    const memoryArray = Array.isArray(response) ? response : (response.results || []);
    const memories = memoryArray.map(m => m.memory).filter(Boolean);
    const relations = response.relations || [];

    logger.debug('Mem0 getAllMemories:', {
      userId: cleanUserId,
      count: memories.length
    });

    return { memories, relations };
  } catch (error) {
    logger.error('Mem0 getAllMemories failed:', { error: error.message, userId });
    return { memories: [], relations: [] };
  }
};

/**
 * Add conversation messages to memory with graph extraction
 * @param {Object} options - Add options
 * @param {string} options.userId - User identifier
 * @param {Array} options.messages - Array of {role: 'user'|'assistant', content: string}
 * @param {Object} [options.metadata] - Optional metadata (e.g., session_id)
 * @returns {Promise<Object|null>} Result or null on error
 */
const addMemory = async ({ userId, messages, metadata = null }) => {
  if (!userId) {
    throw new Error('User ID is required');
  }

  if (!messages || !Array.isArray(messages) || messages.length === 0) {
    throw new Error('Messages array is required');
  }

  const client = getClient();
  if (!client) {
    return null;
  }

  try {
    const cleanUserId = normalizeUserId(userId);

    // Validate message format
    const validMessages = messages.filter(m =>
      m.role && ['user', 'assistant'].includes(m.role) && m.content
    );

    if (validMessages.length === 0) {
      logger.warn('No valid messages to add to Mem0');
      return null;
    }

    const body = {
      messages: validMessages,
      user_id: cleanUserId,
      enable_graph: true
    };

    if (metadata) {
      body.metadata = metadata;
    }

    const result = await makeRequest('POST', '/memories/', body);

    logger.info('Mem0 addMemory completed:', {
      userId: cleanUserId,
      messagesCount: validMessages.length
    });

    return result;
  } catch (error) {
    logger.error('Mem0 addMemory failed:', { error: error.message, userId });
    return null;
  }
};

/**
 * Add a single fact to memory
 * @param {Object} options - Add options
 * @param {string} options.userId - User identifier
 * @param {string} options.fact - The fact to add
 * @returns {Promise<Object|null>} Result or null on error
 */
const addFact = async ({ userId, fact }) => {
  if (!fact) {
    return null;
  }

  return addMemory({
    userId,
    messages: [{ role: 'user', content: fact }]
  });
};

/**
 * Add conversation transcript to memory (from chat history format)
 * @param {Object} options - Add options
 * @param {string} options.userId - User identifier (e.g., MAC address)
 * @param {Array} options.chatHistory - Array of {chatType: 1|2, content: string}
 * @param {string} [options.sessionId] - Optional session identifier
 * @returns {Promise<Object|null>} Result or null on error
 */
const addConversation = async ({ userId, chatHistory, sessionId = null }) => {
  if (!chatHistory || !Array.isArray(chatHistory) || chatHistory.length === 0) {
    return null;
  }

  // Convert chat history format to Mem0 message format
  // chatType: 1 = user, 2 = agent/assistant
  const messages = chatHistory
    .filter(msg => msg.content && msg.content.trim())
    .map(msg => ({
      role: msg.chatType === 1 ? 'user' : 'assistant',
      content: msg.content.trim()
    }));

  if (messages.length === 0) {
    return null;
  }

  const metadata = sessionId ? { session_id: sessionId } : null;

  return addMemory({
    userId,
    messages,
    metadata
  });
};

/**
 * Delete a specific memory by ID
 * @param {Object} options - Delete options
 * @param {string} options.memoryId - Memory ID to delete
 * @returns {Promise<boolean>} True if successful
 */
const deleteMemory = async ({ memoryId }) => {
  if (!memoryId) {
    throw new Error('Memory ID is required');
  }

  const client = getClient();
  if (!client) {
    return false;
  }

  try {
    await makeRequest('DELETE', `/memories/${memoryId}/`);
    logger.info('Mem0 memory deleted:', { memoryId });
    return true;
  } catch (error) {
    logger.error('Mem0 deleteMemory failed:', { error: error.message, memoryId });
    return false;
  }
};

/**
 * Delete all memories for a user
 * @param {Object} options - Delete options
 * @param {string} options.userId - User identifier
 * @returns {Promise<boolean>} True if successful
 */
const deleteAllMemories = async ({ userId }) => {
  if (!userId) {
    throw new Error('User ID is required');
  }

  const client = getClient();
  if (!client) {
    return false;
  }

  try {
    const cleanUserId = normalizeUserId(userId);

    await makeRequest('DELETE', '/memories/', {
      user_id: cleanUserId
    });

    logger.info('Mem0 all memories deleted:', { userId: cleanUserId });
    return true;
  } catch (error) {
    logger.error('Mem0 deleteAllMemories failed:', { error: error.message, userId });
    return false;
  }
};

/**
 * Get memory by ID
 * @param {Object} options - Get options
 * @param {string} options.memoryId - Memory ID
 * @returns {Promise<Object|null>} Memory object or null
 */
const getMemory = async ({ memoryId }) => {
  if (!memoryId) {
    throw new Error('Memory ID is required');
  }

  const client = getClient();
  if (!client) {
    return null;
  }

  try {
    const result = await makeRequest('GET', `/memories/${memoryId}/`);
    return result;
  } catch (error) {
    if (error.message.includes('404') || error.message.includes('not found')) {
      return null;
    }
    logger.error('Mem0 getMemory failed:', { error: error.message, memoryId });
    throw error;
  }
};

/**
 * Update a memory
 * @param {Object} options - Update options
 * @param {string} options.memoryId - Memory ID
 * @param {string} options.text - New memory text
 * @returns {Promise<Object|null>} Updated memory or null
 */
const updateMemory = async ({ memoryId, text }) => {
  if (!memoryId) {
    throw new Error('Memory ID is required');
  }

  if (!text) {
    throw new Error('Text is required');
  }

  const client = getClient();
  if (!client) {
    return null;
  }

  try {
    const result = await makeRequest('PUT', `/memories/${memoryId}/`, {
      text
    });

    logger.info('Mem0 memory updated:', { memoryId });
    return result;
  } catch (error) {
    logger.error('Mem0 updateMemory failed:', { error: error.message, memoryId });
    return null;
  }
};

/**
 * Get memory history (previous versions)
 * @param {Object} options - Options
 * @param {string} options.memoryId - Memory ID
 * @returns {Promise<Array>} History entries
 */
const getMemoryHistory = async ({ memoryId }) => {
  if (!memoryId) {
    throw new Error('Memory ID is required');
  }

  const client = getClient();
  if (!client) {
    return [];
  }

  try {
    const result = await makeRequest('GET', `/memories/${memoryId}/history/`);
    return Array.isArray(result) ? result : (result.results || []);
  } catch (error) {
    logger.error('Mem0 getMemoryHistory failed:', { error: error.message, memoryId });
    return [];
  }
};

/**
 * Format memories for prompt injection
 * @param {Object} memoryData - Memory data from searchMemories
 * @returns {string} Formatted string for prompt
 */
const formatForPrompt = (memoryData) => {
  if (!memoryData || !memoryData.memories || memoryData.memories.length === 0) {
    return '';
  }

  const lines = ['## What I know about you:', ''];

  // Add memories
  memoryData.memories.forEach(memory => {
    lines.push(`- ${memory}`);
  });

  // Add relations if present
  if (memoryData.relations && memoryData.relations.length > 0) {
    lines.push('');
    lines.push('### Relationships:');
    memoryData.relations.forEach(rel => {
      if (rel.source && rel.relation && rel.target) {
        lines.push(`- ${rel.source} ${rel.relation} ${rel.target}`);
      }
    });
  }

  return lines.join('\n');
};

/**
 * Reset HTTP client (for testing)
 */
const resetClient = () => {
  httpClient = null;
};

module.exports = {
  // Client management
  getClient,
  isAvailable,
  testConnection,
  resetClient,

  // Memory operations
  searchMemories,
  getAllMemories,
  addMemory,
  addFact,
  addConversation,
  deleteMemory,
  deleteAllMemories,
  getMemory,
  updateMemory,
  getMemoryHistory,

  // Utilities
  normalizeUserId,
  formatForPrompt,

  // Constants
  MEM0_MEMORY_LIMIT,
  MEM0_TIMEOUT_MS
};
