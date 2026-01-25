#!/usr/bin/env node

/**
 * MySQL to Supabase Data Migration Script
 *
 * Migrates data from the Spring Boot MySQL database to Supabase PostgreSQL.
 *
 * Tables migrated:
 * - sys_dict_type
 * - sys_dict_data
 * - sys_params
 * - sys_user
 *
 * Usage:
 *   node scripts/migrate-mysql-to-supabase.js [--dry-run] [--table=TABLE_NAME]
 *
 * Options:
 *   --dry-run       Preview what would be migrated without making changes
 *   --table=NAME    Migrate only a specific table (sys_dict_type, sys_dict_data, sys_params, sys_user)
 *   --clear         Clear target tables before migration (WARNING: destructive)
 *
 * Environment:
 *   Requires .env with DATABASE_URL (Supabase) configured
 *   MySQL connection is configured in this script or via environment variables
 */

require('dotenv').config();
const mysql = require('mysql2/promise');
const { PrismaClient } = require('@prisma/client');

// MySQL connection config (from manager-api Spring Boot)
const MYSQL_CONFIG = {
  host: process.env.MYSQL_HOST || 'localhost',
  port: parseInt(process.env.MYSQL_PORT || '3307'),
  user: process.env.MYSQL_USER || 'manager',
  password: process.env.MYSQL_PASSWORD || 'managerpassword',
  database: process.env.MYSQL_DATABASE || 'manager_api',
  charset: 'utf8mb4',
};

// Parse command line arguments
const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const CLEAR_TABLES = args.includes('--clear');
const tableArg = args.find(a => a.startsWith('--table='));
const SPECIFIC_TABLE = tableArg ? tableArg.split('=')[1] : null;

// Initialize Prisma client
const prisma = new PrismaClient({
  log: DRY_RUN ? ['query'] : ['error'],
});

// Colors for console output
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
};

function log(message, color = '') {
  console.log(`${color}${message}${colors.reset}`);
}

function logHeader(message) {
  console.log('\n' + '='.repeat(60));
  log(message, colors.bright + colors.cyan);
  console.log('='.repeat(60));
}

function logSuccess(message) {
  log(`✓ ${message}`, colors.green);
}

function logWarning(message) {
  log(`⚠ ${message}`, colors.yellow);
}

function logError(message) {
  log(`✗ ${message}`, colors.red);
}

function logInfo(message) {
  log(`  ${message}`, colors.blue);
}

/**
 * Convert MySQL datetime to ISO string for PostgreSQL
 */
function convertDate(mysqlDate) {
  if (!mysqlDate) return null;
  if (mysqlDate instanceof Date) {
    return mysqlDate.toISOString();
  }
  return new Date(mysqlDate).toISOString();
}

/**
 * Migrate sys_dict_type table
 */
async function migrateDictType(mysqlConn) {
  logHeader('Migrating sys_dict_type');

  const [rows] = await mysqlConn.execute('SELECT * FROM sys_dict_type ORDER BY id');
  logInfo(`Found ${rows.length} records in MySQL`);

  if (rows.length === 0) {
    logWarning('No records to migrate');
    return { migrated: 0, skipped: 0, errors: 0 };
  }

  let migrated = 0, skipped = 0, errors = 0;

  if (CLEAR_TABLES && !DRY_RUN) {
    logWarning('Clearing sys_dict_type table...');
    await prisma.sys_dict_data.deleteMany({});
    await prisma.sys_dict_type.deleteMany({});
  }

  for (const row of rows) {
    const data = {
      id: BigInt(row.id),
      dict_type: row.dict_type,
      dict_name: row.dict_name,
      remark: row.remark,
      sort: row.sort || 0,
      created_at: convertDate(row.create_date),
      updated_at: convertDate(row.update_date),
    };

    if (DRY_RUN) {
      logInfo(`Would insert: id=${data.id}, dict_type=${data.dict_type}, dict_name=${data.dict_name}`);
      migrated++;
      continue;
    }

    try {
      // Check if already exists
      const existing = await prisma.sys_dict_type.findUnique({
        where: { id: data.id }
      });

      if (existing && !CLEAR_TABLES) {
        logInfo(`Skipping existing: id=${data.id}, dict_type=${data.dict_type}`);
        skipped++;
        continue;
      }

      await prisma.sys_dict_type.upsert({
        where: { id: data.id },
        create: data,
        update: data,
      });
      logSuccess(`Migrated: id=${data.id}, dict_type=${data.dict_type}`);
      migrated++;
    } catch (err) {
      logError(`Failed to migrate id=${data.id}: ${err.message}`);
      errors++;
    }
  }

  return { migrated, skipped, errors };
}

/**
 * Migrate sys_dict_data table
 */
async function migrateDictData(mysqlConn) {
  logHeader('Migrating sys_dict_data');

  // Join with sys_dict_type to get dict_type string
  const [rows] = await mysqlConn.execute(`
    SELECT d.*, t.dict_type
    FROM sys_dict_data d
    LEFT JOIN sys_dict_type t ON d.dict_type_id = t.id
    ORDER BY d.id
  `);
  logInfo(`Found ${rows.length} records in MySQL`);

  if (rows.length === 0) {
    logWarning('No records to migrate');
    return { migrated: 0, skipped: 0, errors: 0 };
  }

  let migrated = 0, skipped = 0, errors = 0;

  if (CLEAR_TABLES && !DRY_RUN) {
    logWarning('Clearing sys_dict_data table...');
    await prisma.sys_dict_data.deleteMany({});
  }

  for (const row of rows) {
    const data = {
      id: BigInt(row.id),
      dict_type_id: row.dict_type_id ? BigInt(row.dict_type_id) : null,
      dict_type: row.dict_type,
      dict_label: row.dict_label,
      dict_value: row.dict_value,
      remark: row.remark,
      sort: row.sort || 0,
      created_at: convertDate(row.create_date),
      updated_at: convertDate(row.update_date),
    };

    if (DRY_RUN) {
      logInfo(`Would insert: id=${data.id}, dict_type=${data.dict_type}, label=${data.dict_label}, value=${data.dict_value}`);
      migrated++;
      continue;
    }

    try {
      const existing = await prisma.sys_dict_data.findUnique({
        where: { id: data.id }
      });

      if (existing && !CLEAR_TABLES) {
        logInfo(`Skipping existing: id=${data.id}`);
        skipped++;
        continue;
      }

      await prisma.sys_dict_data.upsert({
        where: { id: data.id },
        create: data,
        update: data,
      });
      logSuccess(`Migrated: id=${data.id}, label=${data.dict_label}`);
      migrated++;
    } catch (err) {
      logError(`Failed to migrate id=${data.id}: ${err.message}`);
      errors++;
    }
  }

  return { migrated, skipped, errors };
}

/**
 * Migrate sys_params table
 */
async function migrateParams(mysqlConn) {
  logHeader('Migrating sys_params');

  const [rows] = await mysqlConn.execute('SELECT * FROM sys_params ORDER BY id');
  logInfo(`Found ${rows.length} records in MySQL`);

  if (rows.length === 0) {
    logWarning('No records to migrate');
    return { migrated: 0, skipped: 0, errors: 0 };
  }

  let migrated = 0, skipped = 0, errors = 0;

  if (CLEAR_TABLES && !DRY_RUN) {
    logWarning('Clearing sys_params table...');
    await prisma.sys_params.deleteMany({});
  }

  for (const row of rows) {
    const data = {
      id: BigInt(row.id),
      param_code: row.param_code,
      param_value: row.param_value,
      value_type: row.value_type || 'string',
      param_type: row.param_type || 1,
      remark: row.remark,
      created_at: convertDate(row.create_date),
      updated_at: convertDate(row.update_date),
    };

    if (DRY_RUN) {
      logInfo(`Would insert: id=${data.id}, param_code=${data.param_code}, value=${data.param_value?.substring(0, 50)}...`);
      migrated++;
      continue;
    }

    try {
      const existing = await prisma.sys_params.findUnique({
        where: { id: data.id }
      });

      if (existing && !CLEAR_TABLES) {
        logInfo(`Skipping existing: id=${data.id}, param_code=${data.param_code}`);
        skipped++;
        continue;
      }

      await prisma.sys_params.upsert({
        where: { id: data.id },
        create: data,
        update: data,
      });
      logSuccess(`Migrated: id=${data.id}, param_code=${data.param_code}`);
      migrated++;
    } catch (err) {
      logError(`Failed to migrate id=${data.id}: ${err.message}`);
      errors++;
    }
  }

  return { migrated, skipped, errors };
}

/**
 * Migrate sys_user table
 */
async function migrateUsers(mysqlConn) {
  logHeader('Migrating sys_user');

  const [rows] = await mysqlConn.execute('SELECT * FROM sys_user ORDER BY id');
  logInfo(`Found ${rows.length} records in MySQL`);

  if (rows.length === 0) {
    logWarning('No records to migrate');
    return { migrated: 0, skipped: 0, errors: 0 };
  }

  let migrated = 0, skipped = 0, errors = 0;

  if (CLEAR_TABLES && !DRY_RUN) {
    logWarning('Clearing sys_user table (and related)...');
    await prisma.sys_user_token.deleteMany({});
    await prisma.sys_user.deleteMany({});
  }

  for (const row of rows) {
    // Map superAdmin to role
    const role = row.super_admin === 1 ? 'admin' : 'user';

    const data = {
      id: BigInt(row.id),
      username: row.username,
      password: row.password,
      email: row.email || null,
      phone: row.phone || null,
      nickname: row.nickname || row.username,
      avatar: row.avatar || null,
      gender: row.gender || 0,
      status: row.status ?? 1,
      role: role,
      last_login_at: null,
      created_at: convertDate(row.create_date),
      updated_at: convertDate(row.update_date),
    };

    if (DRY_RUN) {
      logInfo(`Would insert: id=${data.id}, username=${data.username}, role=${data.role}`);
      migrated++;
      continue;
    }

    try {
      const existing = await prisma.sys_user.findUnique({
        where: { id: data.id }
      });

      if (existing && !CLEAR_TABLES) {
        logInfo(`Skipping existing: id=${data.id}, username=${data.username}`);
        skipped++;
        continue;
      }

      await prisma.sys_user.upsert({
        where: { id: data.id },
        create: data,
        update: data,
      });
      logSuccess(`Migrated: id=${data.id}, username=${data.username}, role=${data.role}`);
      migrated++;
    } catch (err) {
      logError(`Failed to migrate id=${data.id}: ${err.message}`);
      errors++;
    }
  }

  return { migrated, skipped, errors };
}

/**
 * Reset PostgreSQL sequences after migration
 */
async function resetSequences() {
  logHeader('Resetting PostgreSQL sequences');

  const tables = ['sys_dict_type', 'sys_dict_data', 'sys_params', 'sys_user'];

  for (const table of tables) {
    if (SPECIFIC_TABLE && table !== SPECIFIC_TABLE) continue;

    try {
      // Get max ID
      const result = await prisma.$queryRawUnsafe(`SELECT MAX(id) as max_id FROM ${table}`);
      const maxId = result[0]?.max_id || 0;

      if (maxId > 0) {
        // Reset sequence to max_id + 1
        await prisma.$executeRawUnsafe(`SELECT setval(pg_get_serial_sequence('${table}', 'id'), ${maxId}, true)`);
        logSuccess(`Reset ${table}_id_seq to ${maxId}`);
      }
    } catch (err) {
      logWarning(`Could not reset sequence for ${table}: ${err.message}`);
    }
  }
}

/**
 * Main migration function
 */
async function main() {
  console.log('\n');
  log('╔═══════════════════════════════════════════════════════════╗', colors.cyan);
  log('║     MySQL to Supabase Data Migration                      ║', colors.cyan);
  log('╚═══════════════════════════════════════════════════════════╝', colors.cyan);

  if (DRY_RUN) {
    logWarning('\n*** DRY RUN MODE - No changes will be made ***\n');
  }

  if (CLEAR_TABLES) {
    logWarning('\n*** CLEAR MODE - Target tables will be cleared before migration ***\n');
  }

  if (SPECIFIC_TABLE) {
    logInfo(`Migrating only: ${SPECIFIC_TABLE}\n`);
  }

  // Connect to MySQL
  logInfo('Connecting to MySQL...');
  logInfo(`  Host: ${MYSQL_CONFIG.host}:${MYSQL_CONFIG.port}`);
  logInfo(`  Database: ${MYSQL_CONFIG.database}`);

  let mysqlConn;
  try {
    mysqlConn = await mysql.createConnection(MYSQL_CONFIG);
    logSuccess('Connected to MySQL');
  } catch (err) {
    logError(`Failed to connect to MySQL: ${err.message}`);
    process.exit(1);
  }

  // Connect to Supabase via Prisma
  logInfo('Connecting to Supabase via Prisma...');
  try {
    await prisma.$connect();
    logSuccess('Connected to Supabase');
  } catch (err) {
    logError(`Failed to connect to Supabase: ${err.message}`);
    await mysqlConn.end();
    process.exit(1);
  }

  // Migration results
  const results = {};
  const tables = [
    { name: 'sys_dict_type', fn: migrateDictType },
    { name: 'sys_dict_data', fn: migrateDictData },
    { name: 'sys_params', fn: migrateParams },
    { name: 'sys_user', fn: migrateUsers },
  ];

  try {
    for (const { name, fn } of tables) {
      if (SPECIFIC_TABLE && name !== SPECIFIC_TABLE) continue;
      results[name] = await fn(mysqlConn);
    }

    // Reset sequences after migration
    if (!DRY_RUN) {
      await resetSequences();
    }

  } finally {
    // Close connections
    await mysqlConn.end();
    await prisma.$disconnect();
  }

  // Print summary
  logHeader('Migration Summary');

  let totalMigrated = 0, totalSkipped = 0, totalErrors = 0;

  for (const [table, { migrated, skipped, errors }] of Object.entries(results)) {
    console.log(`  ${table}:`);
    console.log(`    Migrated: ${migrated}, Skipped: ${skipped}, Errors: ${errors}`);
    totalMigrated += migrated;
    totalSkipped += skipped;
    totalErrors += errors;
  }

  console.log('\n  ' + '-'.repeat(40));
  console.log(`  Total: Migrated=${totalMigrated}, Skipped=${totalSkipped}, Errors=${totalErrors}`);

  if (DRY_RUN) {
    logWarning('\n*** This was a DRY RUN - No changes were made ***');
    logInfo('Run without --dry-run to perform actual migration');
  }

  if (totalErrors > 0) {
    logError('\nMigration completed with errors!');
    process.exit(1);
  } else {
    logSuccess('\nMigration completed successfully!');
  }
}

// Run migration
main().catch(err => {
  logError(`Migration failed: ${err.message}`);
  console.error(err);
  process.exit(1);
});
