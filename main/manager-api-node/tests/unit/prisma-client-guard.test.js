describe('Prisma client startup guard', () => {
  it('throws a clear error when a required generated model delegate is missing', () => {
    const { assertRequiredPrismaModels } = require('../../src/config/prisma-client-guard');

    expect(() => assertRequiredPrismaModels({
      voice_sessions: {},
      voice_session_messages: {},
      voice_session_summaries: {},
      device_token_usage_session: {}
    })).toThrow(/device_workspace_artifacts.*workspace_locks.*device_memory_documents.*device_memory_chunks.*npx prisma generate/s);
  });

  it('accepts a Prisma client that exposes all required runtime delegates', () => {
    const { assertRequiredPrismaModels } = require('../../src/config/prisma-client-guard');

    expect(() => assertRequiredPrismaModels({
      voice_sessions: {},
      voice_session_messages: {},
      voice_session_summaries: {},
      device_token_usage_session: {},
      device_workspace_artifacts: {},
      workspace_locks: {},
      device_memory_documents: {},
      device_memory_chunks: {}
    })).not.toThrow();
  });

  it('throws a clear error when the selected database is missing required runtime tables', async () => {
    const { assertRequiredDatabaseTables } = require('../../src/config/prisma-client-guard');
    const prisma = {
      $queryRawUnsafe: jest.fn().mockResolvedValue([
        { table_name: 'voice_sessions' },
        { table_name: 'voice_session_messages' },
        { table_name: 'voice_session_summaries' },
        { table_name: 'device_token_usage_session' },
        { table_name: 'device_workspace_artifacts' },
        { table_name: 'workspace_locks' }
      ])
    };

    await expect(assertRequiredDatabaseTables(prisma)).rejects.toThrow(
      /device_memory_documents.*device_memory_chunks.*prisma migrate deploy/s
    );
    expect(prisma.$queryRawUnsafe).toHaveBeenCalledWith(
      expect.stringContaining('information_schema.tables'),
      expect.arrayContaining(['device_memory_documents', 'device_memory_chunks'])
    );
  });

  it('accepts a selected database that contains all required runtime tables', async () => {
    const { assertRequiredDatabaseTables, REQUIRED_PRISMA_TABLES } = require('../../src/config/prisma-client-guard');
    const prisma = {
      $queryRawUnsafe: jest.fn().mockResolvedValue(
        REQUIRED_PRISMA_TABLES.map((table) => ({ table_name: table }))
      )
    };

    await expect(assertRequiredDatabaseTables(prisma)).resolves.toBe(true);
  });
});

describe('Prisma generate deployment guard scripts', () => {
  it('generates Prisma during install while server startup owns runtime generation', () => {
    const packageJson = require('../../package.json');

    expect(packageJson.scripts.postinstall).toBe('prisma generate');
    expect(packageJson.scripts.prestart).toBeUndefined();
    expect(packageJson.scripts.predev).toBeUndefined();
  });
});
