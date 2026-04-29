const REQUIRED_PRISMA_MODELS = [
  'voice_sessions',
  'voice_session_messages',
  'voice_session_summaries',
  'device_token_usage_session',
  'device_workspace_artifacts',
  'device_memory_documents',
  'device_memory_chunks'
];

const REQUIRED_PRISMA_TABLES = [...REQUIRED_PRISMA_MODELS];

const assertRequiredPrismaModels = (prisma, requiredModels = REQUIRED_PRISMA_MODELS) => {
  const missing = requiredModels.filter((model) => !prisma || typeof prisma[model] !== 'object');
  if (missing.length === 0) {
    return true;
  }

  throw new Error(
    `Generated Prisma Client is stale or incomplete. Missing model delegates: ${missing.join(', ')}. ` +
    'Run `npx prisma generate` before starting Manager API, then restart the process.'
  );
};

const assertRequiredDatabaseTables = async (prisma, requiredTables = REQUIRED_PRISMA_TABLES) => {
  if (!prisma || typeof prisma.$queryRawUnsafe !== 'function') {
    throw new Error('Prisma client cannot verify database table readiness: $queryRawUnsafe is unavailable.');
  }

  const rows = await prisma.$queryRawUnsafe(`
    SELECT table_name::text AS table_name
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_type = 'BASE TABLE'
      AND table_name::text = ANY($1::text[])
  `, requiredTables);

  const existing = new Set((rows || []).map((row) => row.table_name || row.tableName));
  const missing = requiredTables.filter((table) => !existing.has(table));
  if (missing.length === 0) {
    return true;
  }

  throw new Error(
    `Database schema is incomplete for the selected DATABASE_URL. Missing tables: ${missing.join(', ')}. ` +
    'Run `npx prisma migrate deploy` against the selected database, then restart Manager API.'
  );
};

module.exports = {
  REQUIRED_PRISMA_MODELS,
  REQUIRED_PRISMA_TABLES,
  assertRequiredPrismaModels,
  assertRequiredDatabaseTables
};
