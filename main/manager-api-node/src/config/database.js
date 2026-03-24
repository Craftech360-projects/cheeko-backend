/**
 * Database Configuration
 *
 * Prisma is the primary DB client → DigitalOcean Managed PostgreSQL.
 * Supabase clients are kept for the existing custom-token auth system
 * (sys_user_token table) used by the admin dashboard. They will be
 * removed in a later cleanup phase once the admin dashboard is migrated.
 */

const { createClient } = require('@supabase/supabase-js');
const { Pool } = require('pg');
const { PrismaClient } = require('@prisma/client');
const { PrismaPg } = require('@prisma/adapter-pg');
const logger = require('../utils/logger');

// ─── Prisma (primary DB — DigitalOcean PostgreSQL) ───────────────────────────
// Strip sslmode from the URL to prevent pg v8.19 from treating 'require' as
// 'verify-full' (which rejects DigitalOcean's self-signed CA cert chain).
// SSL is re-enabled explicitly via ssl: { rejectUnauthorized: false }.
const _rawUrl = process.env.DATABASE_URL || '';
const dbConnectionString = _rawUrl
  .replace(/([?&])sslmode=[^&]*/g, '$1') // remove sslmode value
  .replace(/\?&/g, '?')                  // fix ?& → ?
  .replace(/[?&]$/g, '');               // remove trailing ? or &

logger.info(`🔌 DB connecting to: ${dbConnectionString.replace(/:[^@]*@/, ':***@')}`);
logger.info(`🔐 SSL: rejectUnauthorized=false (DigitalOcean self-signed CA)`);

const pgPool = new Pool({
  connectionString: dbConnectionString,
  ssl: { rejectUnauthorized: false },
});

pgPool.on('error', (err) => {
  logger.error('❌ Unexpected idle pg pool error:', err.message);
});

const adapter = new PrismaPg(pgPool);

// Auto-generate BigInt IDs for tables that lack BIGSERIAL sequences in the DB.
// Without this, Prisma throws "Null constraint violation" on insert because
// the DB column is NOT NULL with no default.
const basePrisma = new PrismaClient({
  adapter,
  log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
});

const prisma = basePrisma.$extends({
  query: {
    $allModels: {
      async create({ args, query }) {
        if (args.data && (args.data.id === undefined || args.data.id === null)) {
          const ts = BigInt(Date.now()) * 1000n;
          const rand = BigInt(Math.floor(Math.random() * 1000));
          args.data.id = ts + rand;
        }
        return query(args);
      },
    },
  },
});

/**
 * Test database connection via Prisma (DigitalOcean PostgreSQL).
 * @returns {Promise<boolean>}
 */
const testConnection = async () => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    logger.info('✅ DigitalOcean PostgreSQL connection successful (Prisma)');
    return true;
  } catch (error) {
    logger.error('❌ DigitalOcean PostgreSQL connection failed:', { error: error.message });
    return false;
  }
};

// ─── Supabase (legacy — admin dashboard custom token auth only) ───────────────
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  logger.warn('Supabase credentials not configured. Admin token verification will fail.');
}

/**
 * Supabase client for client-side operations (respects RLS)
 */
const supabase = SUPABASE_URL && SUPABASE_ANON_KEY
  ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { autoRefreshToken: true, persistSession: false }
  })
  : null;

/**
 * Supabase admin client (bypasses RLS) — used by auth.js for sys_user_token verification
 */
const supabaseAdmin = SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY
  ? createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false }
  })
  : null;

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
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
    auth: { autoRefreshToken: false, persistSession: false }
  });
};

module.exports = {
  prisma,
  supabase,
  supabaseAdmin,
  testConnection,
  getClientWithAuth,
};
