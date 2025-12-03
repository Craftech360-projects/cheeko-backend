/**
 * Media API Client Configuration
 * 
 * Cerebrium API configuration for music and story bot integration.
 * Handles authentication and axios configuration.
 */

// Cerebrium API base URL
const MEDIA_API_BASE =
    process.env.MEDIA_API_BASE ||
    "https://api.aws.us-east-1.cerebrium.ai/v4/p-89052e36/livekit-server-simple";

// Cerebrium authentication token (required for API calls)
const CEREBRIUM_TOKEN = process.env.CEREBRIUM_API_TOKEN;

/**
 * Validate Cerebrium token on module load
 * Exits process if token is not configured
 */
function validateCerebriumToken() {
    if (!CEREBRIUM_TOKEN) {
        console.error("❌ [FATAL] CEREBRIUM_API_TOKEN not set in environment!");
        console.error("💡 [HINT] Add CEREBRIUM_API_TOKEN to your .env file");
        process.exit(1);
    }
    console.log("✅ [AUTH] Cerebrium authentication configured");
}

/**
 * Create axios configuration with Cerebrium authentication
 * @param {Object} extra - Additional axios config options
 * @returns {Object} Axios configuration object
 */
function mediaAxiosConfig(extra = {}) {
    const cfg = {
        timeout: 20000, // 20s: Media API can be slow on cold start + model init
        ...extra,
    };

    cfg.headers = {
        ...(cfg.headers || {}),
        "Content-Type": "application/json",
    };

    if (CEREBRIUM_TOKEN) {
        cfg.headers.Authorization = `Bearer ${CEREBRIUM_TOKEN}`;
    }

    return cfg;
}

module.exports = {
    MEDIA_API_BASE,
    CEREBRIUM_TOKEN,
    validateCerebriumToken,
    mediaAxiosConfig,
};
