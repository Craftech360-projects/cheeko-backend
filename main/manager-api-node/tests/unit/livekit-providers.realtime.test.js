const mockPrisma = {
  llm_providers: { findFirst: jest.fn().mockResolvedValue(null), findMany: jest.fn().mockResolvedValue([]) },
  stt_providers: { findFirst: jest.fn().mockResolvedValue(null), findMany: jest.fn().mockResolvedValue([]) },
  tts_providers: { findFirst: jest.fn().mockResolvedValue(null), findMany: jest.fn().mockResolvedValue([]) },
  moderation_providers: { findFirst: jest.fn().mockResolvedValue(null), findMany: jest.fn().mockResolvedValue([]) },
  image_providers: { findFirst: jest.fn().mockResolvedValue(null), findMany: jest.fn().mockResolvedValue([]) },
  realtime_providers: {
    findFirst: jest.fn(),
    findMany: jest.fn().mockResolvedValue([]),
    updateMany: jest.fn(),
    update: jest.fn()
  },
  $transaction: jest.fn(async (fn) => fn(mockPrisma))
};

jest.mock('../../src/config/database', () => ({ prisma: mockPrisma }));

const service = require('../../src/services/livekitProviders.service');

describe('realtime providers (GPT-Live)', () => {
  beforeEach(() => jest.clearAllMocks());

  test('getActiveProviders includes the active realtime provider', async () => {
    mockPrisma.realtime_providers.findFirst.mockResolvedValue({
      id: 1n, provider_name: 'google-gemini-live', vendor: 'google', model: 'gemini-2.5-flash-native-audio-preview-12-2025',
      backend_model: 'gemini-2.5-flash', voice: 'Kore', api_base: null, api_key: 'g-key', is_active: true, priority: 50, updated_at: new Date()
    });
    const out = await service.getActiveProviders();
    expect(out.realtime).toEqual({
      provider: 'google-gemini-live', vendor: 'google', model: 'gemini-2.5-flash-native-audio-preview-12-2025',
      backend_model: 'gemini-2.5-flash', voice: 'Kore', api_base: null, api_key: 'g-key'
    });
  });

  test('getActiveProviders returns realtime null when none active', async () => {
    mockPrisma.realtime_providers.findFirst.mockResolvedValue(null);
    expect((await service.getActiveProviders()).realtime).toBeNull();
  });

  test('listProviders lists realtime rows with string ids', async () => {
    mockPrisma.realtime_providers.findMany.mockResolvedValue([{ id: 7n, provider_name: 'openai-gpt-live' }]);
    const out = await service.listProviders();
    expect(out.realtime).toEqual([{ id: '7', provider_name: 'openai-gpt-live' }]);
  });

  test('updateProvider accepts type "realtime" and only its fields', async () => {
    mockPrisma.realtime_providers.update.mockResolvedValue({ id: 1n, provider_name: 'openai-gpt-live' });
    await service.updateProvider('realtime', '1', {
      model: 'gpt-live-1', backend_model: 'gpt-5.6-luna', voice: 'vesper', api_key: 'sk-new', api_base: '', is_active: true
    });
    const { data } = mockPrisma.realtime_providers.update.mock.calls[0][0];
    expect(data).toMatchObject({ model: 'gpt-live-1', backend_model: 'gpt-5.6-luna', voice: 'vesper', api_key: 'sk-new', api_base: null });
    expect(data.is_active).toBeUndefined();
  });

  test('activateProvider accepts type "realtime"', async () => {
    mockPrisma.realtime_providers.update.mockResolvedValue({ id: 1n, provider_name: 'openai-gpt-live', is_active: true });
    await service.activateProvider('realtime', '1');
    expect(mockPrisma.realtime_providers.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: { is_active: true } }));
  });

  test('updateProvider accepts a known realtime vendor, lower-cased', async () => {
    mockPrisma.realtime_providers.update.mockResolvedValue({ id: 2n, provider_name: 'xai-grok-voice' });
    await service.updateProvider('realtime', '2', { vendor: 'XAI' });
    expect(mockPrisma.realtime_providers.update.mock.calls[0][0].data.vendor).toBe('xai');
  });

  test('updateProvider rejects an unknown realtime vendor', async () => {
    await expect(service.updateProvider('realtime', '2', { vendor: 'azure' }))
      .rejects.toThrow('vendor must be one of openai, google, xai');
    expect(mockPrisma.realtime_providers.update).not.toHaveBeenCalled();
  });
});
