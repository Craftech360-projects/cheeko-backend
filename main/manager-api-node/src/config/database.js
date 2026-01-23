/**
 * Supabase Database Configuration
 *
 * Initializes the Supabase client for database operations and authentication.
 */

const { createClient } = require('@supabase/supabase-js');
const logger = require('../utils/logger');

// Environment variables
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

// Validate required environment variables
if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  logger.warn('Supabase credentials not configured. Database operations will fail.');
}

/**
 * Supabase client for client-side operations (respects RLS)
 * Use this for user-authenticated requests
 */
const supabase = SUPABASE_URL && SUPABASE_ANON_KEY
  ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: {
        autoRefreshToken: true,
        persistSession: false
      }
    })
  : null;

/**
 * Supabase admin client (bypasses RLS)
 * Use this for server-side operations that need full access
 */
const supabaseAdmin = SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY
  ? createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: {
        autoRefreshToken: false,
        persistSession: false
      }
    })
  : null;

/**
 * Test database connection
 * @returns {Promise<boolean>} True if connection is successful
 */
const testConnection = async () => {
  if (!supabaseAdmin) {
    logger.error('Supabase admin client not initialized');
    return false;
  }

  try {
    // Try to query a simple table or run a health check
    const { data, error } = await supabaseAdmin
      .from('sys_params')
      .select('id')
      .limit(1);

    if (error && error.code !== 'PGRST116') {
      // PGRST116 = table doesn't exist (ok for initial setup)
      throw error;
    }

    logger.info('Supabase connection successful');
    return true;
  } catch (error) {
    logger.error('Supabase connection failed:', { error: error.message });
    return false;
  }
};

/**
 * Get a Supabase client with user's JWT token for RLS
 * @param {string} accessToken - User's JWT token
 * @returns {Object} Supabase client with user context
 */
const getClientWithAuth = (accessToken) => {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    throw new Error('Supabase not configured');
  }

  return createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: {
      headers: {
        Authorization: `Bearer ${accessToken}`
      }
    },
    auth: {
      autoRefreshToken: false,
      persistSession: false
    }
  });
};

module.exports = {
  supabase,
  supabaseAdmin,
  testConnection,
  getClientWithAuth
};
