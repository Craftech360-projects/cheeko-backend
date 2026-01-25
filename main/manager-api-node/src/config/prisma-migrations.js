/**
 * Prisma Migration Runner
 *
 * Runs Prisma migrations on server startup using `prisma migrate deploy`.
 * This ensures the database schema is synchronized with the Prisma schema definition.
 *
 * Usage:
 *   const { runPrismaMigrations } = require('./config/prisma-migrations');
 *   await runPrismaMigrations(); // Throws on failure
 */

const { execSync } = require('child_process');
const path = require('path');
const logger = require('../utils/logger');

/**
 * Run database seed to insert initial data
 *
 * Only inserts records that don't exist (safe to run multiple times)
 */
const runSeed = async () => {
  try {
    logger.info('Running database seed...');

    const projectRoot = path.resolve(__dirname, '../..');

    const output = execSync('node prisma/seed.js', {
      cwd: projectRoot,
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
      env: {
        ...process.env,
        NO_COLOR: '1',
        FORCE_COLOR: '0'
      },
      timeout: 60000
    });

    // Log seed output
    if (output) {
      const lines = output.trim().split('\n');
      for (const line of lines) {
        if (line.trim()) {
          logger.info(`Seed: ${line.trim()}`);
        }
      }
    }

    logger.info('Database seed completed.');
  } catch (error) {
    // Extract error message
    let errorMessage = error.message;
    if (error.stderr) {
      errorMessage = error.stderr.toString().trim();
    } else if (error.stdout) {
      errorMessage = error.stdout.toString().trim();
    }

    logger.warn(`Database seed warning: ${errorMessage}`);
    // Don't throw - seed failures shouldn't prevent server startup
    // The seed only inserts missing data, so failures usually mean
    // the data already exists or there's a non-critical issue
  }
};

/**
 * Run Prisma migrations/schema sync
 *
 * In DEVELOPMENT: Uses `prisma db push` to auto-sync schema changes (creates missing tables/columns)
 * In PRODUCTION: Uses `prisma migrate deploy` to apply migration files only (safe, no auto-changes)
 *
 * @returns {Promise<boolean>} True if migrations succeeded
 * @throws {Error} If migrations fail
 */
const runPrismaMigrations = async () => {
  // Skip if SKIP_DB_SYNC is set
  if (process.env.SKIP_DB_SYNC === '1') {
    logger.info('Skipping database sync (SKIP_DB_SYNC=1)');
    return true;
  }

  logger.info('Starting Prisma database sync...');

  // Check if DIRECT_URL is set (required for Prisma migrations)
  if (!process.env.DIRECT_URL && !process.env.DATABASE_URL) {
    logger.warn('═══════════════════════════════════════════════════════════');
    logger.warn('Neither DIRECT_URL nor DATABASE_URL is configured.');
    logger.warn('Prisma migrations require a database connection URL.');
    logger.warn('');
    logger.warn('Add to your .env file:');
    logger.warn('  DIRECT_URL="postgresql://user:password@host:5432/database"');
    logger.warn('═══════════════════════════════════════════════════════════');
    throw new Error('Database URL not configured for Prisma migrations');
  }

  try {
    // Get the project root directory (where prisma.config.ts is located)
    const projectRoot = path.resolve(__dirname, '../..');

    const isDevelopment = process.env.NODE_ENV !== 'production';

    // In development: use db push to auto-sync schema (creates missing tables)
    // In production: use migrate deploy (only applies existing migration files)
    const command = isDevelopment
      ? 'npx prisma db push --accept-data-loss'
      : 'npx prisma migrate deploy';

    logger.info(`Running: ${command} (${isDevelopment ? 'development' : 'production'} mode)`);

    const output = execSync(command, {
      cwd: projectRoot,
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
      env: {
        ...process.env,
        // Ensure colors are disabled for cleaner logging
        NO_COLOR: '1',
        FORCE_COLOR: '0'
      },
      timeout: 60000 // 60 second timeout
    });

    // Log migration output
    if (output) {
      const lines = output.trim().split('\n');
      for (const line of lines) {
        if (line.trim()) {
          logger.info(`Prisma: ${line.trim()}`);
        }
      }
    }

    logger.info('Prisma migrations completed successfully!');

    // Run seed to ensure initial data exists
    await runSeed();

    return true;

  } catch (error) {
    // Extract meaningful error message
    let errorMessage = 'Migration failed';

    if (error.stderr) {
      errorMessage = error.stderr.toString().trim();
    } else if (error.stdout) {
      errorMessage = error.stdout.toString().trim();
    } else if (error.message) {
      errorMessage = error.message;
    }

    logger.error('═══════════════════════════════════════════════════════════');
    logger.error('Prisma migration failed!');
    logger.error('');
    logger.error(`Error: ${errorMessage}`);
    logger.error('');

    // Provide helpful troubleshooting tips
    if (errorMessage.includes('database') || errorMessage.includes('connection')) {
      logger.error('Troubleshooting:');
      logger.error('  1. Check your DIRECT_URL in .env is correct');
      logger.error('  2. Ensure the database server is running');
      logger.error('  3. Verify network connectivity to the database');
    } else if (errorMessage.includes('migration') || errorMessage.includes('schema')) {
      logger.error('Troubleshooting:');
      logger.error('  1. Check prisma/migrations folder exists');
      logger.error('  2. Verify migration files are not corrupted');
      logger.error('  3. Run: npx prisma migrate status');
    }

    logger.error('═══════════════════════════════════════════════════════════');

    throw new Error(`Prisma migration failed: ${errorMessage}`);
  }
};

/**
 * Check migration status without applying changes
 *
 * @returns {Promise<string>} Migration status output
 */
const getMigrationStatus = async () => {
  try {
    const projectRoot = path.resolve(__dirname, '../..');

    const output = execSync('npx prisma migrate status', {
      cwd: projectRoot,
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
      env: {
        ...process.env,
        NO_COLOR: '1',
        FORCE_COLOR: '0'
      },
      timeout: 30000
    });

    return output.trim();

  } catch (error) {
    const errorOutput = error.stderr?.toString() || error.stdout?.toString() || error.message;
    return `Status check failed: ${errorOutput}`;
  }
};

module.exports = {
  runPrismaMigrations,
  getMigrationStatus
};
