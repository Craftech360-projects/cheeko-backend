/**
 * Database Configuration
 *
 * Prisma is the primary DB client → DigitalOcean Managed PostgreSQL.
 * Supabase clients are kept for the existing custom-token auth system
 * (sys_user_token table) used by the admin dashboard. They will be
 * removed in a later cleanup phase once the admin dashboard is migrated.
 */

const { createClient } = require('@supabase/supabase-js');
const WebSocket = require('ws');
const { Pool } = require('pg');
const { PrismaClient } = require('@prisma/client');
const logger = require('../utils/logger');

let PrismaPg = null;
try {
  ({ PrismaPg } = require('@prisma/adapter-pg'));
} catch (error) {
  // Keep startup alive when adapter package is absent in a deployed environment.
  logger.warn(
    `@prisma/adapter-pg is unavailable (${error.code || error.message}); using Prisma default connection mode.`
  );
}

/**
 * Derive a safe/usable DB URL for Supabase pooler deployments.
 * This prevents opaque "Tenant or user not found" failures when
 * DATABASE_URL has stale project-ref credentials.
 *
 * @param {string} rawUrl
 * @returns {string}
 */
const resolveDatabaseUrl = (rawUrl) => {
  const input = String(rawUrl || '').trim();
  if (!input) return input;

  let parsed;
  try {
    parsed = new URL(input);
  } catch (_) {
    return input;
  }

  const isSupabasePooler = parsed.hostname.endsWith('.pooler.supabase.com');
  if (!isSupabasePooler) return input;

  const supabaseUrl = String(process.env.SUPABASE_URL || '').trim();
  const projectRef = supabaseUrl.match(/^https?:\/\/([^.]+)\.supabase\.co\/?$/i)?.[1] || null;
  const dbPassword = process.env.SUPABASE_DB_PASSWORD || null;

  let changed = false;
  const [baseUser, userRef] = parsed.username.split('.');
  const hasExplicitProjectRef = baseUser === 'postgres' && Boolean(userRef);

  // Trust explicit postgres.<project-ref> credentials in DATABASE_URL.
  // Auto-rewrite only when user is plain "postgres" (missing project-ref).
  if (!hasExplicitProjectRef && projectRef && baseUser === 'postgres') {
    parsed.username = `postgres.${projectRef}`;
    changed = true;
  }

  // If we had to rewrite missing project-ref, prefer canonical DB password from env.
  if (changed && dbPassword) {
    parsed.password = dbPassword;
  }

  if (!changed) return input;

  logger.warn(
    `DATABASE_URL credentials looked stale for Supabase pooler; auto-corrected to project ${projectRef}`
  );
  return parsed.toString();
};

// ─── Prisma (primary DB — DigitalOcean PostgreSQL) ───────────────────────────
// Strip sslmode from the URL to prevent pg v8.19 from treating 'require' as
// 'verify-full' (which rejects DigitalOcean's self-signed CA cert chain).
// SSL is re-enabled explicitly via ssl: { rejectUnauthorized: false }.
const _rawUrl = process.env.DATABASE_URL || '';
const dbConnectionString = resolveDatabaseUrl(_rawUrl)
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

const prismaClientOptions = {
  log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
};

if (PrismaPg) {
  prismaClientOptions.adapter = new PrismaPg(pgPool);
} else if (dbConnectionString) {
  prismaClientOptions.datasourceUrl = dbConnectionString;
}

const prisma = new PrismaClient(prismaClientOptions);

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

const supabaseRealtimeOptions = {
  realtime: { transport: WebSocket },
};

/**
 * Supabase client for client-side operations (respects RLS)
 */
const supabase = SUPABASE_URL && SUPABASE_ANON_KEY
  ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    ...supabaseRealtimeOptions,
    auth: { autoRefreshToken: true, persistSession: false }
  })
  : null;

/**
 * Supabase admin client (bypasses RLS) — used by auth.js for sys_user_token verification
 */
const supabaseAdmin = SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY
  ? createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    ...supabaseRealtimeOptions,
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
    ...supabaseRealtimeOptions,
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
