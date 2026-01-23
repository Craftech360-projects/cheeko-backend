/**
 * Qdrant Vector Database Service
 *
 * Handles vector search operations for RAG (Retrieval-Augmented Generation).
 * Used for semantic content matching in RFID card lookups and content search.
 */

const { QdrantClient } = require('@qdrant/js-client-rest');
const logger = require('../../utils/logger');

// Environment variables
const QDRANT_URL = process.env.QDRANT_URL;
const QDRANT_API_KEY = process.env.QDRANT_API_KEY;

// Default collection name for RFID content
const DEFAULT_COLLECTION = process.env.QDRANT_COLLECTION || 'rfid_content';

// Default vector dimension (OpenAI ada-002 uses 1536)
const DEFAULT_VECTOR_SIZE = parseInt(process.env.QDRANT_VECTOR_SIZE, 10) || 1536;

/**
 * Qdrant client instance
 * Initialized lazily to allow graceful handling when not configured
 */
let qdrantClient = null;

/**
 * Initialize Qdrant client
 * @returns {QdrantClient|null} Qdrant client instance
 */
const getClient = () => {
  if (qdrantClient) {
    return qdrantClient;
  }

  if (!QDRANT_URL) {
    logger.warn('Qdrant URL not configured. Vector search will be unavailable.');
    return null;
  }

  try {
    const clientConfig = {
      url: QDRANT_URL
    };

    if (QDRANT_API_KEY) {
      clientConfig.apiKey = QDRANT_API_KEY;
    }

    qdrantClient = new QdrantClient(clientConfig);
    logger.info('Qdrant client initialized', { url: QDRANT_URL });
    return qdrantClient;
  } catch (error) {
    logger.error('Failed to initialize Qdrant client:', { error: error.message });
    return null;
  }
};

/**
 * Check if Qdrant is available
 * @returns {boolean} True if Qdrant client is configured
 */
const isAvailable = () => {
  return !!QDRANT_URL;
};

/**
 * Test connection to Qdrant
 * @returns {Promise<boolean>} True if connection is successful
 */
const testConnection = async () => {
  const client = getClient();
  if (!client) {
    return false;
  }

  try {
    // Try to list collections as a health check
    await client.getCollections();
    logger.info('Qdrant connection successful');
    return true;
  } catch (error) {
    logger.error('Qdrant connection failed:', { error: error.message });
    return false;
  }
};

/**
 * Ensure collection exists with proper configuration
 * @param {string} collectionName - Name of the collection
 * @param {number} vectorSize - Dimension of vectors
 * @returns {Promise<boolean>} True if collection exists or was created
 */
const ensureCollection = async (collectionName = DEFAULT_COLLECTION, vectorSize = DEFAULT_VECTOR_SIZE) => {
  const client = getClient();
  if (!client) {
    throw new Error('Qdrant client not initialized');
  }

  try {
    // Check if collection exists
    const collections = await client.getCollections();
    const exists = collections.collections.some(c => c.name === collectionName);

    if (exists) {
      return true;
    }

    // Create collection with cosine distance (best for semantic similarity)
    await client.createCollection(collectionName, {
      vectors: {
        size: vectorSize,
        distance: 'Cosine'
      }
    });

    logger.info('Created Qdrant collection:', { collectionName, vectorSize });
    return true;
  } catch (error) {
    logger.error('Failed to ensure collection:', { error: error.message, collectionName });
    throw error;
  }
};

/**
 * Search for similar vectors
 * @param {Object} options - Search options
 * @param {number[]} options.vector - Query vector (embedding)
 * @param {string} [options.collection] - Collection name
 * @param {number} [options.limit=5] - Max results to return
 * @param {number} [options.scoreThreshold=0.7] - Minimum similarity score
 * @param {Object} [options.filter] - Qdrant filter conditions
 * @param {boolean} [options.withPayload=true] - Include payload in results
 * @param {boolean} [options.withVector=false] - Include vector in results
 * @returns {Promise<Array>} Search results with scores and payloads
 */
const search = async ({
  vector,
  collection = DEFAULT_COLLECTION,
  limit = 5,
  scoreThreshold = 0.7,
  filter = null,
  withPayload = true,
  withVector = false
}) => {
  const client = getClient();
  if (!client) {
    throw new Error('Qdrant client not initialized');
  }

  if (!vector || !Array.isArray(vector) || vector.length === 0) {
    throw new Error('Search vector is required');
  }

  try {
    const searchParams = {
      vector,
      limit,
      score_threshold: scoreThreshold,
      with_payload: withPayload,
      with_vector: withVector
    };

    if (filter) {
      searchParams.filter = filter;
    }

    const results = await client.search(collection, searchParams);

    logger.debug('Qdrant search completed:', {
      collection,
      resultCount: results.length,
      limit
    });

    return results.map(result => ({
      id: result.id,
      score: result.score,
      payload: result.payload || {},
      vector: result.vector || null
    }));
  } catch (error) {
    logger.error('Qdrant search failed:', { error: error.message, collection });
    throw error;
  }
};

/**
 * Search with text query (requires external embedding)
 * This is a convenience wrapper that expects pre-computed embeddings
 * @param {Object} options - Search options
 * @param {number[]} options.embedding - Pre-computed embedding vector
 * @param {string} [options.collection] - Collection name
 * @param {number} [options.limit=5] - Max results
 * @param {Object} [options.filter] - Filter conditions
 * @returns {Promise<Array>} Search results
 */
const searchByEmbedding = async ({
  embedding,
  collection = DEFAULT_COLLECTION,
  limit = 5,
  filter = null
}) => {
  return search({
    vector: embedding,
    collection,
    limit,
    filter,
    withPayload: true
  });
};

/**
 * Upsert vectors into collection
 * @param {Object} options - Upsert options
 * @param {Array} options.points - Array of points to upsert
 * @param {string} [options.collection] - Collection name
 * @returns {Promise<Object>} Upsert result
 *
 * Point format:
 * {
 *   id: string | number,
 *   vector: number[],
 *   payload: Object
 * }
 */
const upsert = async ({
  points,
  collection = DEFAULT_COLLECTION
}) => {
  const client = getClient();
  if (!client) {
    throw new Error('Qdrant client not initialized');
  }

  if (!points || !Array.isArray(points) || points.length === 0) {
    throw new Error('Points array is required');
  }

  // Validate point structure
  for (const point of points) {
    if (!point.id) {
      throw new Error('Each point must have an id');
    }
    if (!point.vector || !Array.isArray(point.vector)) {
      throw new Error('Each point must have a vector array');
    }
  }

  try {
    // Ensure collection exists
    await ensureCollection(collection);

    const result = await client.upsert(collection, {
      wait: true,
      points: points.map(p => ({
        id: p.id,
        vector: p.vector,
        payload: p.payload || {}
      }))
    });

    logger.info('Qdrant upsert completed:', {
      collection,
      pointCount: points.length,
      status: result.status
    });

    return {
      success: result.status === 'completed',
      status: result.status,
      count: points.length
    };
  } catch (error) {
    logger.error('Qdrant upsert failed:', { error: error.message, collection });
    throw error;
  }
};

/**
 * Upsert a single point
 * @param {Object} options - Upsert options
 * @param {string|number} options.id - Point ID
 * @param {number[]} options.vector - Vector embedding
 * @param {Object} [options.payload] - Associated metadata
 * @param {string} [options.collection] - Collection name
 * @returns {Promise<Object>} Upsert result
 */
const upsertOne = async ({
  id,
  vector,
  payload = {},
  collection = DEFAULT_COLLECTION
}) => {
  return upsert({
    points: [{ id, vector, payload }],
    collection
  });
};

/**
 * Delete points by IDs
 * @param {Object} options - Delete options
 * @param {Array} options.ids - Point IDs to delete
 * @param {string} [options.collection] - Collection name
 * @returns {Promise<Object>} Delete result
 */
const deletePoints = async ({
  ids,
  collection = DEFAULT_COLLECTION
}) => {
  const client = getClient();
  if (!client) {
    throw new Error('Qdrant client not initialized');
  }

  if (!ids || !Array.isArray(ids) || ids.length === 0) {
    throw new Error('IDs array is required');
  }

  try {
    const result = await client.delete(collection, {
      wait: true,
      points: ids
    });

    logger.info('Qdrant delete completed:', {
      collection,
      idCount: ids.length,
      status: result.status
    });

    return {
      success: result.status === 'completed',
      status: result.status,
      count: ids.length
    };
  } catch (error) {
    logger.error('Qdrant delete failed:', { error: error.message, collection });
    throw error;
  }
};

/**
 * Delete points by filter
 * @param {Object} options - Delete options
 * @param {Object} options.filter - Qdrant filter conditions
 * @param {string} [options.collection] - Collection name
 * @returns {Promise<Object>} Delete result
 */
const deleteByFilter = async ({
  filter,
  collection = DEFAULT_COLLECTION
}) => {
  const client = getClient();
  if (!client) {
    throw new Error('Qdrant client not initialized');
  }

  if (!filter) {
    throw new Error('Filter is required');
  }

  try {
    const result = await client.delete(collection, {
      wait: true,
      filter
    });

    logger.info('Qdrant delete by filter completed:', {
      collection,
      status: result.status
    });

    return {
      success: result.status === 'completed',
      status: result.status
    };
  } catch (error) {
    logger.error('Qdrant delete by filter failed:', { error: error.message, collection });
    throw error;
  }
};

/**
 * Get point by ID
 * @param {Object} options - Get options
 * @param {string|number} options.id - Point ID
 * @param {string} [options.collection] - Collection name
 * @param {boolean} [options.withVector=false] - Include vector in result
 * @returns {Promise<Object|null>} Point data or null if not found
 */
const getPoint = async ({
  id,
  collection = DEFAULT_COLLECTION,
  withVector = false
}) => {
  const client = getClient();
  if (!client) {
    throw new Error('Qdrant client not initialized');
  }

  try {
    const result = await client.retrieve(collection, {
      ids: [id],
      with_payload: true,
      with_vector: withVector
    });

    if (result.length === 0) {
      return null;
    }

    const point = result[0];
    return {
      id: point.id,
      payload: point.payload || {},
      vector: point.vector || null
    };
  } catch (error) {
    // 404-like errors mean point doesn't exist
    if (error.message.includes('not found')) {
      return null;
    }
    logger.error('Qdrant get point failed:', { error: error.message, collection, id });
    throw error;
  }
};

/**
 * Get collection info
 * @param {string} [collectionName] - Collection name
 * @returns {Promise<Object>} Collection information
 */
const getCollectionInfo = async (collectionName = DEFAULT_COLLECTION) => {
  const client = getClient();
  if (!client) {
    throw new Error('Qdrant client not initialized');
  }

  try {
    const info = await client.getCollection(collectionName);
    return {
      name: collectionName,
      pointsCount: info.points_count,
      vectorsCount: info.vectors_count,
      status: info.status,
      config: info.config
    };
  } catch (error) {
    logger.error('Failed to get collection info:', { error: error.message, collectionName });
    throw error;
  }
};

/**
 * List all collections
 * @returns {Promise<Array>} List of collection names
 */
const listCollections = async () => {
  const client = getClient();
  if (!client) {
    throw new Error('Qdrant client not initialized');
  }

  try {
    const result = await client.getCollections();
    return result.collections.map(c => c.name);
  } catch (error) {
    logger.error('Failed to list collections:', { error: error.message });
    throw error;
  }
};

/**
 * Build a Qdrant filter for common use cases
 * @param {Object} conditions - Filter conditions
 * @returns {Object} Qdrant filter object
 *
 * Example:
 * buildFilter({
 *   must: { category: 'science', age_min: { $lte: 8 } },
 *   should: { language: ['en', 'es'] }
 * })
 */
const buildFilter = (conditions) => {
  const filter = {};

  if (conditions.must) {
    filter.must = Object.entries(conditions.must).map(([key, value]) => {
      if (typeof value === 'object' && value !== null) {
        // Handle operators like $lte, $gte, $eq
        const [[op, val]] = Object.entries(value);
        const operators = {
          $lt: 'lt',
          $lte: 'lte',
          $gt: 'gt',
          $gte: 'gte',
          $eq: 'value'
        };
        return {
          key,
          range: op === '$eq' ? undefined : { [operators[op]]: val },
          match: op === '$eq' ? { value: val } : undefined
        };
      }
      // Simple equality
      return {
        key,
        match: { value }
      };
    });
  }

  if (conditions.should) {
    filter.should = Object.entries(conditions.should).map(([key, value]) => {
      if (Array.isArray(value)) {
        return {
          key,
          match: { any: value }
        };
      }
      return {
        key,
        match: { value }
      };
    });
  }

  if (conditions.must_not) {
    filter.must_not = Object.entries(conditions.must_not).map(([key, value]) => ({
      key,
      match: { value }
    }));
  }

  return filter;
};

module.exports = {
  // Client management
  getClient,
  isAvailable,
  testConnection,

  // Collection management
  ensureCollection,
  getCollectionInfo,
  listCollections,

  // Search operations
  search,
  searchByEmbedding,

  // CRUD operations
  upsert,
  upsertOne,
  deletePoints,
  deleteByFilter,
  getPoint,

  // Utilities
  buildFilter,

  // Constants
  DEFAULT_COLLECTION,
  DEFAULT_VECTOR_SIZE
};
