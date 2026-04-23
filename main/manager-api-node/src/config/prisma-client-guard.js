const REQUIRED_PRISMA_MODELS = [
  'voice_sessions',
  'voice_session_messages',
  'voice_session_summaries',
  'device_token_usage_session',
  'device_workspace_artifacts'
];

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

module.exports = {
  REQUIRED_PRISMA_MODELS,
  assertRequiredPrismaModels
};
