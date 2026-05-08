describe('workspace sync service', () => {
  let prisma;
  let workspaceService;

  beforeEach(() => {
    jest.resetModules();

    prisma = {
      ai_device: {
        findFirst: jest.fn(),
        findUnique: jest.fn()
      },
      device_workspace_artifacts: {
        findUnique: jest.fn(),
        findMany: jest.fn(),
        upsert: jest.fn(),
        deleteMany: jest.fn()
      }
    };

    jest.doMock('../../src/config/database', () => ({ prisma }));
    jest.doMock('../../src/utils/helpers', () => ({
      normalizeMacAddress: jest.fn(() => 'AA:BB:CC:DD:EE:FF')
    }));

    workspaceService = require('../../src/services/workspace.service');
  });

  afterEach(() => {
    jest.dontMock('../../src/config/database');
    jest.dontMock('../../src/utils/helpers');
  });

  it('returns delta empty set when sinceRevision matches manifest revision', async () => {
    prisma.device_workspace_artifacts.findUnique.mockResolvedValue({
      content: JSON.stringify({ revision: 'rev-2', deleted: ['notes/old.md'] }),
      updated_at: new Date('2026-05-08T10:00:00.000Z')
    });

    const result = await workspaceService.getWorkspaceSync('aa-bb-cc-dd-ee-ff', null, {
      sinceRevision: 'rev-2'
    });

    expect(prisma.device_workspace_artifacts.findMany).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      revision: 'rev-2',
      delta: true,
      files: [],
      deleted: ['notes/old.md']
    });
  });

  it('throws 409 conflict when baseRevision does not match current manifest', async () => {
    prisma.ai_device.findUnique.mockResolvedValue({
      id: 'device-id',
      agent_id: 'agent-id'
    });
    prisma.device_workspace_artifacts.findUnique.mockResolvedValue({
      content: JSON.stringify({ revision: 'rev-live' })
    });

    await expect(workspaceService.saveWorkspaceSync('aa-bb-cc-dd-ee-ff', null, {
      baseRevision: 'rev-old',
      newRevision: 'rev-new',
      files: []
    })).rejects.toMatchObject({
      statusCode: 409,
      serverRevision: 'rev-live'
    });
  });

  it('saves changed files, deleted paths, and manifest snapshot', async () => {
    prisma.ai_device.findUnique.mockResolvedValue({
      id: 'device-id',
      agent_id: 'agent-id'
    });
    prisma.device_workspace_artifacts.findUnique.mockResolvedValue({
      content: JSON.stringify({ revision: 'rev-1' })
    });
    prisma.device_workspace_artifacts.upsert.mockResolvedValue({});
    prisma.device_workspace_artifacts.deleteMany.mockResolvedValue({ count: 1 });

    const result = await workspaceService.saveWorkspaceSync('aa-bb-cc-dd-ee-ff', null, {
      baseRevision: 'rev-1',
      newRevision: 'rev-2',
      files: [
        {
          relativePath: 'notes/today.md',
          content: 'hello',
          contentType: 'text/markdown'
        }
      ],
      deleted: ['notes/old.md'],
      manifest: {
        generatedBy: 'unit-test'
      }
    });

    expect(prisma.device_workspace_artifacts.upsert).toHaveBeenCalledTimes(2);
    expect(prisma.device_workspace_artifacts.deleteMany).toHaveBeenCalledWith({
      where: {
        mac_address: 'AA:BB:CC:DD:EE:FF',
        relative_path: 'notes/old.md'
      }
    });
    expect(result).toMatchObject({
      appliedRevision: 'rev-2',
      previousRevision: 'rev-1',
      savedCount: 1,
      deletedCount: 1
    });
  });

  it('rejects workspace sync files containing NUL bytes with 400 validation error', async () => {
    prisma.ai_device.findUnique.mockResolvedValue({
      id: 'device-id',
      agent_id: 'agent-id'
    });
    prisma.device_workspace_artifacts.findUnique.mockResolvedValue({
      content: JSON.stringify({ revision: 'rev-1' })
    });

    await expect(workspaceService.saveWorkspaceSync('aa-bb-cc-dd-ee-ff', null, {
      baseRevision: 'rev-1',
      newRevision: 'rev-2',
      files: [
        {
          relativePath: 'notes/binary.txt',
          content: 'hello\u0000world',
          contentType: 'text/plain'
        }
      ]
    })).rejects.toMatchObject({
      statusCode: 400
    });

    expect(prisma.device_workspace_artifacts.upsert).not.toHaveBeenCalled();
  });
});
