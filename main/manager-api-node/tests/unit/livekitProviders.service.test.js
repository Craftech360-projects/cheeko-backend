'use strict';

jest.mock('../../src/config/database', () => ({
  prisma: {
    llm_providers: {
      findMany: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn()
    },
    stt_providers: {
      findMany: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn()
    },
    tts_providers: {
      findMany: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn()
    },
    moderation_providers: {
      findMany: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn()
    },
    image_providers: {
      findMany: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn()
    },
    $transaction: jest.fn()
  }
}));

const { prisma } = require('../../src/config/database');
const livekitProvidersService = require('../../src/services/livekitProviders.service');

describe('livekitProviders.service provider management', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    prisma.$transaction.mockImplementation((callback) => callback(prisma));
  });

  it('lists llm, stt, and tts providers with JSON-safe string ids', async () => {
    prisma.llm_providers.findMany.mockResolvedValue([
      { id: 1n, model_name: 'gemini', model: 'gemini-2.0-flash', api_key: 'llm-key', is_active: true }
    ]);
    prisma.stt_providers.findMany.mockResolvedValue([
      { id: 2n, provider_name: 'deepgram', model: 'nova-3', api_key: 'stt-key', is_active: false }
    ]);
    prisma.tts_providers.findMany.mockResolvedValue([
      { id: 3n, provider_name: 'cartesia', voice_id: 'voice-1', api_key: 'tts-key', is_active: true }
    ]);
    prisma.moderation_providers.findMany.mockResolvedValue([]);
    prisma.image_providers.findMany.mockResolvedValue([]);

    const providers = await livekitProvidersService.listProviders();

    expect(providers.llm[0]).toEqual(expect.objectContaining({ id: '1', model_name: 'gemini' }));
    expect(providers.stt[0]).toEqual(expect.objectContaining({ id: '2', provider_name: 'deepgram' }));
    expect(providers.tts[0]).toEqual(expect.objectContaining({ id: '3', provider_name: 'cartesia' }));
  });

  it('updates only allowed llm provider fields', async () => {
    prisma.llm_providers.update.mockResolvedValue({
      id: 1n,
      model_name: 'gemini',
      model: 'gemini-2.5-flash',
      api_base: 'https://example.com',
      api_key: 'new-key',
      is_active: true,
      priority: 7
    });

    const updated = await livekitProvidersService.updateProvider('llm', '1', {
      model_name: 'gemini',
      model: 'gemini-2.5-flash',
      api_base: 'https://example.com',
      api_key: 'new-key',
      priority: '7',
      ignored: 'nope'
    });

    expect(prisma.llm_providers.update).toHaveBeenCalledWith({
      where: { id: 1n },
      data: expect.objectContaining({
        model_name: 'gemini',
        model: 'gemini-2.5-flash',
        api_base: 'https://example.com',
        api_key: 'new-key',
        priority: 7
      })
    });
    expect(prisma.llm_providers.update.mock.calls[0][0].data).not.toHaveProperty('ignored');
    expect(updated.id).toBe('1');
  });

  it('sets one tts provider active and deactivates other tts providers', async () => {
    prisma.tts_providers.update.mockResolvedValue({
      id: 3n,
      provider_name: 'cartesia',
      voice_id: 'voice-1',
      is_active: true
    });

    const activated = await livekitProvidersService.activateProvider('tts', '3');

    expect(prisma.tts_providers.updateMany).toHaveBeenCalledWith({
      where: { is_active: true },
      data: { is_active: false, updated_at: expect.any(Date) }
    });
    expect(prisma.tts_providers.update).toHaveBeenCalledWith({
      where: { id: 3n },
      data: { is_active: true, updated_at: expect.any(Date) }
    });
    expect(activated).toEqual(expect.objectContaining({ id: '3', is_active: true }));
  });
});
