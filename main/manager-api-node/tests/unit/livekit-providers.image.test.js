const mockPrisma = {
  llm_providers: { findFirst: jest.fn().mockResolvedValue(null), findMany: jest.fn().mockResolvedValue([]) },
  stt_providers: { findFirst: jest.fn().mockResolvedValue(null), findMany: jest.fn().mockResolvedValue([]) },
  tts_providers: { findFirst: jest.fn().mockResolvedValue(null), findMany: jest.fn().mockResolvedValue([]) },
  moderation_providers: { findFirst: jest.fn().mockResolvedValue(null), findMany: jest.fn().mockResolvedValue([]) },
  image_providers: {
    findFirst: jest.fn(),
    findMany: jest.fn().mockResolvedValue([]),
    updateMany: jest.fn(),
    upsert: jest.fn()
  },
  $transaction: jest.fn(async (fn) => fn(mockPrisma))
};

jest.mock('../../src/config/database', () => ({ prisma: mockPrisma }));

const service = require('../../src/services/livekitProviders.service');

describe('image providers', () => {
  beforeEach(() => jest.clearAllMocks());

  test('getActiveProviders includes the active image provider', async () => {
    mockPrisma.image_providers.findFirst.mockResolvedValue({
      id: 1n, provider_name: 'runware', model: 'runware:400@4',
      api_key: 'rk', is_active: true, priority: 100, updated_at: new Date()
    });
    const out = await service.getActiveProviders();
    expect(out.image).toEqual({
      provider: 'runware', model: 'runware:400@4', api_key: 'rk'
    });
  });

  test('getActiveProviders returns image null when none active', async () => {
    mockPrisma.image_providers.findFirst.mockResolvedValue(null);
    const out = await service.getActiveProviders();
    expect(out.image).toBeNull();
  });

  test('setActiveImageProvider deactivates others and upserts', async () => {
    mockPrisma.image_providers.upsert.mockResolvedValue({ id: 2n, provider_name: 'runware' });
    await service.setActiveImageProvider({ provider: 'runware', model: 'runware:400@4', api_key: 'rk' });
    expect(mockPrisma.image_providers.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { is_active: true } }));
    expect(mockPrisma.image_providers.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ where: { provider_name: 'runware' } }));
  });

  test('updateProvider accepts type "image"', async () => {
    mockPrisma.image_providers.update = jest.fn().mockResolvedValue({ id: 1n, provider_name: 'runware' });
    await service.updateProvider('image', '1', { api_key: 'newkey' });
    expect(mockPrisma.image_providers.update).toHaveBeenCalled();
  });
});
