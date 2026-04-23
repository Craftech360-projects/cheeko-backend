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
});

describe('Prisma generate deployment guard scripts', () => {
  it('runs prisma generate before normal server entrypoints', () => {
    const packageJson = require('../../package.json');

    expect(packageJson.scripts.prestart).toBe('prisma generate');
    expect(packageJson.scripts.predev).toBe('prisma generate');
  });
});
