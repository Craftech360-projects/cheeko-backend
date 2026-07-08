const mockPrisma = {
  llm_providers: { findFirst: jest.fn().mockResolvedValue(null), findMany: jest.fn().mockResolvedValue([]) },
  stt_providers: { findFirst: jest.fn().mockResolvedValue(null), findMany: jest.fn().mockResolvedValue([]) },
  tts_providers: { findFirst: jest.fn().mockResolvedValue(null), findMany: jest.fn().mockResolvedValue([]) },
  moderation_providers: {
    findFirst: jest.fn(),
    findMany: jest.fn().mockResolvedValue([]),
    updateMany: jest.fn(),
    upsert: jest.fn()
  },
  image_providers: { findFirst: jest.fn().mockResolvedValue(null), findMany: jest.fn().mockResolvedValue([]) },
  $transaction: jest.fn(async (fn) => fn(mockPrisma))
};

jest.mock('../../src/config/database', () => ({ prisma: mockPrisma }));

const service = require('../../src/services/livekitProviders.service');

describe('moderation providers', () => {
  beforeEach(() => jest.clearAllMocks());

  test('getActiveProviders includes the active moderation provider', async () => {
    mockPrisma.moderation_providers.findFirst.mockResolvedValue({
      id: 1n, provider_name: 'groq', model: 'llama-3.1-8b-instant',
      api_key: 'gk', is_active: true, priority: 100, updated_at: new Date()
    });
    const out = await service.getActiveProviders();
    expect(out.moderation).toEqual({
      provider: 'groq', model: 'llama-3.1-8b-instant', api_key: 'gk'
    });
  });

  test('getActiveProviders returns moderation null when none active', async () => {
    mockPrisma.moderation_providers.findFirst.mockResolvedValue(null);
    const out = await service.getActiveProviders();
    expect(out.moderation).toBeNull();
  });

  test('setActiveModerationProvider deactivates others and upserts', async () => {
    mockPrisma.moderation_providers.upsert.mockResolvedValue({ id: 2n, provider_name: 'openai' });
    await service.setActiveModerationProvider({ provider: 'openai', model: 'gpt-4o-mini', api_key: 'sk' });
    expect(mockPrisma.moderation_providers.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { is_active: true } }));
    expect(mockPrisma.moderation_providers.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ where: { provider_name: 'openai' } }));
  });

  test('updateProvider accepts type "moderation"', async () => {
    mockPrisma.moderation_providers.update = jest.fn().mockResolvedValue({ id: 1n, provider_name: 'groq' });
    await service.updateProvider('moderation', '1', { api_key: 'newkey' });
    expect(mockPrisma.moderation_providers.update).toHaveBeenCalled();
  });
});
