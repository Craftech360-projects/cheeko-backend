describe('agent device-scoped memory documents', () => {
  let prisma;
  let agentService;

  beforeEach(() => {
    jest.resetModules();

    prisma = {
      ai_device: {
        findUnique: jest.fn()
      },
      device_memory_documents: {
        upsert: jest.fn(),
        findMany: jest.fn()
      },
      device_memory_chunks: {
        deleteMany: jest.fn(),
        createMany: jest.fn()
      }
    };

    jest.doMock('../../src/config/database', () => ({ prisma }));
    jest.doMock('../../src/services/integrations/mem0.service', () => ({
      isAvailable: jest.fn(() => false),
      searchMemories: jest.fn(),
      formatForPrompt: jest.fn(() => '')
    }));
    jest.doMock('../../src/utils/logger', () => ({
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn()
    }));

    agentService = require('../../src/services/agent.service');
  });

  afterEach(() => {
    jest.dontMock('../../src/config/database');
    jest.dontMock('../../src/services/integrations/mem0.service');
    jest.dontMock('../../src/utils/logger');
  });

  it('upserts a device-scoped memory document and refreshes its chunks', async () => {
    prisma.ai_device.findUnique.mockResolvedValue({
      id: 'device-id',
      agent_id: 'agent-id',
      kid_id: 77n
    });
    prisma.device_memory_documents.upsert.mockResolvedValue({
      id: 'memory-doc-id',
      mac_address: 'AA:BB:CC:DD:EE:FF',
      device_id: 'device-id',
      agent_id: 'agent-id',
      kid_id: 77n,
      document_key: 'summary',
      memory_type: 'summary',
      memory_date: null,
      content: 'Rahul likes elephant songs.',
      source: 'session_summary',
      session_id: 'session-1',
      metadata: { confidence: 0.9 },
      updated_at: new Date('2026-04-23T10:00:00.000Z')
    });
    prisma.device_memory_chunks.deleteMany.mockResolvedValue({ count: 0 });
    prisma.device_memory_chunks.createMany.mockResolvedValue({ count: 1 });

    const result = await agentService.saveDeviceMemoryDocument({
      macAddress: 'aa-bb-cc-dd-ee-ff',
      documentKey: 'summary',
      memoryType: 'summary',
      content: 'Rahul likes elephant songs.',
      source: 'session_summary',
      sessionId: 'session-1',
      metadata: { confidence: 0.9 }
    });

    expect(prisma.device_memory_documents.upsert).toHaveBeenCalledWith({
      where: {
        mac_address_document_key: {
          mac_address: 'AA:BB:CC:DD:EE:FF',
          document_key: 'summary'
        }
      },
      create: expect.objectContaining({
        mac_address: 'AA:BB:CC:DD:EE:FF',
        device_id: 'device-id',
        agent_id: 'agent-id',
        kid_id: 77n,
        document_key: 'summary',
        memory_type: 'summary',
        content: 'Rahul likes elephant songs.',
        source: 'session_summary',
        session_id: 'session-1'
      }),
      update: expect.objectContaining({
        content: 'Rahul likes elephant songs.',
        source: 'session_summary',
        session_id: 'session-1'
      })
    });
    expect(prisma.device_memory_chunks.deleteMany).toHaveBeenCalledWith({
      where: { document_id: 'memory-doc-id' }
    });
    expect(prisma.device_memory_chunks.createMany).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({
          document_id: 'memory-doc-id',
          mac_address: 'AA:BB:CC:DD:EE:FF',
          content: 'Rahul likes elephant songs.',
          category: 'summary'
        })
      ],
      skipDuplicates: true
    });
    expect(result).toMatchObject({
      id: 'memory-doc-id',
      macAddress: 'AA:BB:CC:DD:EE:FF',
      documentKey: 'summary',
      memoryType: 'summary',
      content: 'Rahul likes elephant songs.'
    });
  });

  it('lists device-scoped memory documents newest first', async () => {
    prisma.device_memory_documents.findMany.mockResolvedValue([
      {
        id: 'memory-doc-id',
        mac_address: 'AA:BB:CC:DD:EE:FF',
        device_id: 'device-id',
        agent_id: 'agent-id',
        kid_id: 77n,
        document_key: 'summary',
        memory_type: 'summary',
        memory_date: null,
        content: 'Rahul likes elephant songs.',
        source: 'session_summary',
        session_id: 'session-1',
        metadata: {},
        updated_at: new Date('2026-04-23T10:00:00.000Z')
      }
    ]);

    const result = await agentService.listDeviceMemoryDocuments('aa-bb-cc-dd-ee-ff', { limit: 5 });

    expect(prisma.device_memory_documents.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { mac_address: 'AA:BB:CC:DD:EE:FF' },
      orderBy: { updated_at: 'desc' },
      take: 5
    }));
    expect(result).toEqual([
      expect.objectContaining({
        documentKey: 'summary',
        memoryType: 'summary',
        content: 'Rahul likes elephant songs.'
      })
    ]);
  });
});

describe('agent device memory routes', () => {
  it('protects device memory endpoints with service-key auth', () => {
    const fs = require('fs');
    const path = require('path');
    const source = fs.readFileSync(path.join(__dirname, '../../src/routes/agent.routes.js'), 'utf8');

    expect(source).toMatch(/router\.get\('\/device\/:mac\/memory',\s*requireServiceKey,/);
    expect(source).toMatch(/router\.post\('\/device\/:mac\/memory\/documents',\s*requireServiceKey,/);
  });
});
