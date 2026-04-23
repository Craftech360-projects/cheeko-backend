describe('Prisma client startup guard', () => {
  it('throws a clear error when a required generated model delegate is missing', () => {
    const { assertRequiredPrismaModels } = require('../../src/config/prisma-client-guard');

    expect(() => assertRequiredPrismaModels({
      voice_sessions: {},
      voice_session_messages: {},
      voice_session_summaries: {},
      device_token_usage_session: {}
    })).toThrow(/device_workspace_artifacts.*npx prisma generate/s);
  });

  it('accepts a Prisma client that exposes all required runtime delegates', () => {
    const { assertRequiredPrismaModels } = require('../../src/config/prisma-client-guard');

    expect(() => assertRequiredPrismaModels({
      voice_sessions: {},
      voice_session_messages: {},
      voice_session_summaries: {},
      device_token_usage_session: {},
      device_workspace_artifacts: {}
    })).not.toThrow();
  });

  it('throws a clear error when the selected database is missing required runtime tables', async () => {
    const { assertRequiredDatabaseTables } = require('../../src/config/prisma-client-guard');
    const prisma = {
      $queryRawUnsafe: jest.fn().mockResolvedValue([
        { table_name: 'voice_sessions' },
        { table_name: 'voice_session_messages' },
        { table_name: 'voice_session_summaries' },
        { table_name: 'device_token_usage_session' }
      ])
    };

    await expect(assertRequiredDatabaseTables(prisma)).rejects.toThrow(
      /device_workspace_artifacts.*prisma migrate deploy/s
    );
    expect(prisma.$queryRawUnsafe).toHaveBeenCalledWith(
      expect.stringContaining('information_schema.tables'),
      expect.arrayContaining(['device_workspace_artifacts'])
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
  it('runs prisma generate before normal server entrypoints', () => {
    const packageJson = require('../../package.json');

    expect(packageJson.scripts.prestart).toBe('prisma generate');
    expect(packageJson.scripts.predev).toBe('prisma generate');
  });
});
