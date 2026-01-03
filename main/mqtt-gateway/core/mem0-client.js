/**
 * Mem0 REST API Client for Node.js
 *
 * Uses direct REST API calls instead of the browser-only mem0ai SDK.
 * Supports knowledge graph with entities and relations.
 */

const axios = require('axios');
const logger = require('../utils/logger');

// Mem0 configuration
const MEM0_API_KEY = process.env.MEM0_API_KEY;
// Normalize API URL - remove trailing slash and /memories/ suffix if present
let MEM0_API_URL = process.env.MEM0_API_URL || 'https://api.mem0.ai/v1';
MEM0_API_URL = MEM0_API_URL.replace(/\/+$/, '').replace(/\/memories\/?$/, '');
const MEM0_MEMORY_LIMIT = 20; // ~500 tokens max
const MEM0_TIMEOUT_MS = 5000; // 5 second timeout for API calls

/**
 * Mem0Client - REST API client for memory retrieval and storage
 */
class Mem0Client {
    constructor() {
        if (!MEM0_API_KEY) {
            logger.warn('[MEM0] MEM0_API_KEY not set. Memory features will be disabled.');
            this.client = null;
        } else {
            this.client = axios.create({
                baseURL: MEM0_API_URL,
                timeout: MEM0_TIMEOUT_MS,
                headers: {
                    'Authorization': `Token ${MEM0_API_KEY}`,
                    'Content-Type': 'application/json'
                }
            });
            logger.info('[MEM0] REST API Client initialized with graph support');
        }
    }

    /**
     * Normalize user ID (MAC address) to consistent format
     * @param {string} userId - Device MAC address
     * @returns {string} Normalized user ID (lowercase, with colons)
     */
    _normalizeUserId(userId) {
        // Keep colons, just lowercase
        return userId.toLowerCase();
    }

    /**
     * Extract unique entities from memory results
     * @param {Array} results - Memory results
     * @returns {Array} Unique entities
     */
    _extractEntities(results) {
        const entities = new Map();
        for (const r of results || []) {
            for (const e of r.entities || []) {
                if (e.name) {
                    entities.set(e.name.toLowerCase(), {
                        name: e.name,
                        type: e.type || 'unknown'
                    });
                }
            }
        }
        return Array.from(entities.values());
    }

    /**
     * Fetch relevant memories for a user using semantic search with graph support
     * @param {string} userId - Unique identifier (e.g., device MAC)
     * @returns {Promise<{memories: string[], relations: Array, entities: Array}>} Memory data
     */
    async getMemories(userId) {
        if (!this.client || !userId) {
            return { memories: [], relations: [], entities: [] };
        }

        try {
            const cleanUserId = this._normalizeUserId(userId);
            logger.info(`[MEM0] Searching memories for user: ${cleanUserId}`);

            // Use semantic search with graph enabled
            const response = await this.client.post('/memories/search/', {
                query: "What is known about this person, their family, pets, interests, skills, routines, and feelings?",
                user_id: cleanUserId,
                limit: MEM0_MEMORY_LIMIT,
                output_format: "v1.1",
                enable_graph: true
            });

            const data = response.data;

            // Handle both array and v1.1 format responses
            const results = Array.isArray(data) ? data : (data.results || []);
            const topLevelRelations = data.relations || [];  // Relations at top level in v1.1

            if (results.length > 0) {
                const memories = [];
                const allEntities = new Map();
                const allRelations = [...topLevelRelations];  // Start with top-level relations
                
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

                logger.info(`[MEM0] Retrieved ${memories.length} memories, ${allRelations.length} relations, ${entities.length} entities`);

                return {
                    memories,
                    relations: allRelations,
                    entities
                };
            }

            return { memories: [], relations: [], entities: [] };
        } catch (error) {
            const apiError = error.response?.data?.message || error.response?.data?.detail || error.message;
            logger.error(`[MEM0] Search Error: ${apiError}`);
            return { memories: [], relations: [], entities: [] };
        }
    }

    /**
     * Add a new interaction/conversation to memory with graph extraction
     * @param {string} userId - Unique identifier
     * @param {Array} messages - Array of {role: 'user'|'assistant', content: string}
     * @param {object} metadata - Optional metadata (e.g., session_id)
     * @returns {Promise<object|null>} Result or null on error
     */
    async addMemory(userId, messages, metadata = null) {
        if (!this.client || !userId || !messages || messages.length === 0) {
            return null;
        }

        try {
            const cleanUserId = this._normalizeUserId(userId);

            const response = await this.client.post('/memories/', {
                messages: messages,
                user_id: cleanUserId,
                enable_graph: true,
                metadata: metadata
            });

            logger.info(`[MEM0] Added ${messages.length} messages for user ${cleanUserId}`);
            return response.data;
        } catch (error) {
            const apiError = error.response?.data?.message || error.response?.data?.detail || error.message;
            logger.error(`[MEM0] Failed to add memory: ${apiError}`);
            return null;
        }
    }

    /**
     * Add a single text fact to memory
     * @param {string} userId - Unique identifier
     * @param {string} text - The fact to add
     * @returns {Promise<object|null>} Result or null on error
     */
    async addFact(userId, text) {
        if (!text) return null;

        return this.addMemory(userId, [
            { role: 'user', content: text }
        ]);
    }

    /**
     * Get all memories for a user (without semantic search)
     * @param {string} userId - Unique identifier
     * @returns {Promise<{memories: string[], relations: Array}>} All memories
     */
    async getAllMemories(userId) {
        if (!this.client || !userId) {
            return { memories: [], relations: [] };
        }

        try {
            const cleanUserId = this._normalizeUserId(userId);

            const response = await this.client.get('/memories/', {
                params: {
                    user_id: cleanUserId,
                    enable_graph: true
                }
            });

            const results = response.data;

            if (results) {
                // API returns array directly, not { results: [...] }
                const memoryArray = Array.isArray(results) ? results : (results.results || []);
                const memories = memoryArray.map(m => m.memory).filter(Boolean);
                const relations = results.relations || [];

                logger.info(`[MEM0] Retrieved all ${memories.length} memories for ${cleanUserId}`);
                return { memories, relations };
            }

            return { memories: [], relations: [] };
        } catch (error) {
            const apiError = error.response?.data?.message || error.response?.data?.detail || error.message;
            logger.error(`[MEM0] Failed to get all memories: ${apiError}`);
            return { memories: [], relations: [] };
        }
    }

    /**
     * Check if client is initialized
     * @returns {boolean} True if client is ready
     */
    isReady() {
        return this.client !== null;
    }
}

// Export singleton instance
module.exports = new Mem0Client();
