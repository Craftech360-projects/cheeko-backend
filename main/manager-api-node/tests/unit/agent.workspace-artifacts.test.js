describe('agent workspace artifacts', () => {
  let prisma;
  let agentService;

  beforeEach(() => {
    jest.resetModules();

    prisma = {
      ai_device: {
        findUnique: jest.fn()
      },
      device_workspace_artifacts: {
        upsert: jest.fn(),
        findMany: jest.fn(),
        findUnique: jest.fn()
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

  it('upserts a small text artifact for a normalized device path', async () => {
    prisma.ai_device.findUnique.mockResolvedValue({
      id: 'device-id',
      agent_id: 'agent-id'
    });
    prisma.device_workspace_artifacts.upsert.mockResolvedValue({
      id: 'artifact-id',
      mac_address: 'AA:BB:CC:DD:EE:FF',
      device_id: 'device-id',
      agent_id: 'agent-id',
      session_id: 'session-1',
      relative_path: 'songs/flower_song.txt',
      content_type: 'text/plain',
      content: 'petals',
      size_bytes: 6,
      sha256: 'sha',
      updated_at: new Date('2026-04-22T10:00:00.000Z')
    });

    const result = await agentService.saveDeviceWorkspaceArtifact({
      macAddress: 'aa-bb-cc-dd-ee-ff',
      sessionId: 'session-1',
      relativePath: 'songs\\flower_song.txt',
      content: 'petals'
    });

    expect(prisma.device_workspace_artifacts.upsert).toHaveBeenCalledWith({
      where: {
        mac_address_relative_path: {
          mac_address: 'AA:BB:CC:DD:EE:FF',
          relative_path: 'songs/flower_song.txt'
        }
      },
      create: expect.objectContaining({
        mac_address: 'AA:BB:CC:DD:EE:FF',
        device_id: 'device-id',
        agent_id: 'agent-id',
        session_id: 'session-1',
        relative_path: 'songs/flower_song.txt',
        content: 'petals',
        content_type: 'text/plain',
        size_bytes: 6
      }),
      update: expect.objectContaining({
        agent_id: 'agent-id',
        session_id: 'session-1',
        content: 'petals',
        size_bytes: 6
      })
    });
    expect(result).toMatchObject({
      id: 'artifact-id',
      macAddress: 'AA:BB:CC:DD:EE:FF',
      relativePath: 'songs/flower_song.txt',
      contentType: 'text/plain',
      sizeBytes: 6
    });
  });

  it('rejects path traversal before writing an artifact', async () => {
    await expect(agentService.saveDeviceWorkspaceArtifact({
      macAddress: 'aa-bb-cc-dd-ee-ff',
      relativePath: '../secret.txt',
      content: 'nope'
    })).rejects.toThrow('relativePath must stay inside the workspace');

    expect(prisma.device_workspace_artifacts.upsert).not.toHaveBeenCalled();
  });

  it('lists recent artifacts without content unless requested', async () => {
    prisma.device_workspace_artifacts.findMany.mockResolvedValue([
      {
        id: 'artifact-id',
        mac_address: 'AA:BB:CC:DD:EE:FF',
        session_id: 'session-1',
        relative_path: 'flower_song.txt',
        content_type: 'text/plain',
        size_bytes: 12,
        sha256: 'sha',
        updated_at: new Date('2026-04-22T10:00:00.000Z')
      }
    ]);

    const result = await agentService.listDeviceWorkspaceArtifacts('aa-bb-cc-dd-ee-ff', {
      limit: 5,
      includeContent: false
    });

    expect(prisma.device_workspace_artifacts.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { mac_address: 'AA:BB:CC:DD:EE:FF' },
      take: 5,
      orderBy: { updated_at: 'desc' },
      select: expect.not.objectContaining({ content: true })
    }));
    expect(result).toEqual([
      expect.objectContaining({
        relativePath: 'flower_song.txt',
        content: undefined
      })
    ]);
  });
});

describe('agent workspace artifact routes', () => {
  it('protects artifact endpoints with service-key auth', () => {
    const fs = require('fs');
    const path = require('path');
    const source = fs.readFileSync(path.join(__dirname, '../../src/routes/agent.routes.js'), 'utf8');

    expect(source).toMatch(/router\.put\('\/device\/:mac\/artifacts',\s*requireServiceKey,/);
    expect(source).toMatch(/router\.get\('\/device\/:mac\/artifacts',\s*requireServiceKey,/);
    expect(source).toMatch(/router\.get\('\/device\/:mac\/artifacts\/content',\s*requireServiceKey,/);
  });
});
