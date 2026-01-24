/**
 * Database Connection Utilities
 *
 * NOTE: Database migrations are now handled by Prisma.
 * See: src/config/prisma-migrations.js
 *
 * This file retains utility functions for PostgreSQL pool access
 * that may be needed for specialized queries outside of Supabase client.
 *
 * Migration Commands:
 *   npx prisma migrate dev    # Create new migration in development
 *   npx prisma migrate deploy # Apply migrations in production
 *   npx prisma migrate status # Check migration status
 */

const { Pool } = require('pg');
const logger = require('../utils/logger');

/**
 * Get a PostgreSQL connection pool
 *
 * Useful for:
 * - Direct SQL queries not supported by Supabase client
 * - Bulk operations requiring transactions
 * - Database introspection utilities
 *
 * @returns {Pool|null} PostgreSQL connection pool or null if not configured
 */
const getPool = () => {
  // Option 1: Direct DATABASE_URL (recommended)
  if (process.env.DATABASE_URL) {
    return new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.DATABASE_SSL === 'false' ? false : { rejectUnauthorized: false }
    });
  }

  // Option 2: DIRECT_URL (non-pooled, used by Prisma)
  if (process.env.DIRECT_URL) {
    return new Pool({
      connectionString: process.env.DIRECT_URL,
      ssl: process.env.DATABASE_SSL === 'false' ? false : { rejectUnauthorized: false }
    });
  }

  // Option 3: Supabase connection string components
  const supabaseUrl = process.env.SUPABASE_URL;
  const dbPassword = process.env.SUPABASE_DB_PASSWORD;

  if (supabaseUrl && dbPassword) {
    const match = supabaseUrl.match(/https:\/\/([^.]+)\.supabase\.co/);
    if (match) {
      const projectRef = match[1];
      const region = process.env.SUPABASE_REGION || 'aws-0-ap-south-1';
      const connectionString = `postgresql://postgres.${projectRef}:${encodeURIComponent(dbPassword)}@${region}.pooler.supabase.com:6543/postgres`;

      return new Pool({
        connectionString,
        ssl: { rejectUnauthorized: false }
      });
    }
  }

  // Option 4: Individual connection parameters
  if (process.env.DB_HOST && process.env.DB_PASSWORD) {
    return new Pool({
      host: process.env.DB_HOST,
      port: parseInt(process.env.DB_PORT || '5432'),
      database: process.env.DB_NAME || 'postgres',
      user: process.env.DB_USER || 'postgres',
      password: process.env.DB_PASSWORD,
      ssl: process.env.DATABASE_SSL === 'false' ? false : { rejectUnauthorized: false }
    });
  }

  return null;
};

/**
 * Check if a table exists in the database
 *
 * @param {Pool} pool - PostgreSQL connection pool
 * @param {string} tableName - Name of the table to check
 * @returns {Promise<boolean>} True if table exists
 */
const tableExists = async (pool, tableName) => {
  try {
    const result = await pool.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables
        WHERE table_schema = 'public'
        AND table_name = $1
      );
    `, [tableName]);
    return result.rows[0].exists;
  } catch (error) {
    logger.error(`Error checking table ${tableName}:`, error.message);
    return false;
  }
};

/**
 * Test database connection
 *
 * @returns {Promise<boolean>} True if connection succeeds
 */
const testConnection = async () => {
  const pool = getPool();
  if (!pool) {
    logger.warn('No database connection configured');
    return false;
  }

  try {
    await pool.query('SELECT 1');
    await pool.end();
    return true;
  } catch (error) {
    logger.error('Database connection test failed:', error.message);
    try {
      await pool.end();
    } catch (e) {
      // Ignore cleanup errors
    }
    return false;
  }
};

// Export utility functions only
// Migration functions removed - use Prisma migrations instead
module.exports = {
  getPool,
  tableExists,
  testConnection
};
