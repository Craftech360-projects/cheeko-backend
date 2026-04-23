const mockExecSync = jest.fn();
const mockLoggerInfo = jest.fn();
const mockLoggerWarn = jest.fn();
const mockLoggerError = jest.fn();

jest.mock('child_process', () => ({
  execSync: mockExecSync
}));

jest.mock('../../src/utils/logger', () => ({
  info: mockLoggerInfo,
  warn: mockLoggerWarn,
  error: mockLoggerError
}));

describe('Prisma startup migration runner', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
    process.env = {
      ...originalEnv,
      DATABASE_URL: 'postgresql://example.invalid/db'
    };
    delete process.env.DIRECT_URL;
    delete process.env.SKIP_DB_SYNC;
    delete process.env.ALLOW_PRISMA_DB_PUSH;
    delete process.env.NODE_ENV;

    mockExecSync.mockReturnValue('');
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('uses committed migrations by default in development startup', async () => {
    process.env.NODE_ENV = 'development';
    const { runPrismaMigrations } = require('../../src/config/prisma-migrations');

    await runPrismaMigrations();

    expect(mockExecSync).toHaveBeenNthCalledWith(
      1,
      'npx prisma migrate deploy',
      expect.objectContaining({ timeout: 60000 })
    );
  });

  it('can generate the Prisma client as part of server startup', async () => {
    const { runPrismaGenerate } = require('../../src/config/prisma-migrations');

    await runPrismaGenerate();

    expect(mockExecSync).toHaveBeenNthCalledWith(
      1,
      'npx prisma generate',
      expect.objectContaining({ timeout: 60000 })
    );
  });

  it('uses db push only when explicitly opted in for local schema prototyping', async () => {
    process.env.NODE_ENV = 'development';
    process.env.ALLOW_PRISMA_DB_PUSH = '1';
    const { runPrismaMigrations } = require('../../src/config/prisma-migrations');

    await runPrismaMigrations();

    expect(mockExecSync).toHaveBeenNthCalledWith(
      1,
      'npx prisma db push --accept-data-loss',
      expect.objectContaining({ timeout: 60000 })
    );
    expect(mockLoggerWarn).toHaveBeenCalledWith(
      expect.stringContaining('ALLOW_PRISMA_DB_PUSH=1')
    );
  });
});

describe('Manager API startup logging', () => {
  it('reports database readiness instead of claiming synchronization after optional sync', () => {
    const serverSource = require('fs').readFileSync(
      require('path').resolve(__dirname, '../../server.js'),
      'utf8'
    );

    expect(serverSource).toContain("logger.info('Database schema ready.')");
    expect(serverSource).not.toContain("logger.info('Database schema synchronized.')");
  });

  it('generates Prisma client before loading modules that instantiate PrismaClient', () => {
    const serverSource = require('fs').readFileSync(
      require('path').resolve(__dirname, '../../server.js'),
      'utf8'
    );

    expect(serverSource).toContain('await runPrismaGenerate();');
    expect(serverSource.indexOf('await runPrismaGenerate();')).toBeLessThan(
      serverSource.indexOf("require('./src/app')")
    );
  });
});
