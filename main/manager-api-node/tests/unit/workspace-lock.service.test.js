describe('workspace lock service', () => {
  let prisma;
  let lockService;

  beforeEach(() => {
    jest.resetModules();

    prisma = {
      $queryRawUnsafe: jest.fn(),
      $executeRawUnsafe: jest.fn(),
    };

    jest.doMock('../../src/config/database', () => ({ prisma }));
    jest.doMock('../../src/utils/helpers', () => ({
      normalizeMacAddress: jest.fn(() => 'AA:BB:CC:DD:EE:FF')
    }));

    lockService = require('../../src/services/workspace-lock.service');
  });

  afterEach(() => {
    jest.dontMock('../../src/config/database');
    jest.dontMock('../../src/utils/helpers');
  });

  it('acquires a workspace lock when row insert/upsert returns a lock row', async () => {
    prisma.$queryRawUnsafe.mockResolvedValueOnce([
      {
        device_mac: 'AA:BB:CC:DD:EE:FF',
        holder_id: 'pod-a',
        fencing_token: BigInt(1),
        lease_expires_at: new Date('2026-05-19T10:00:20.000Z'),
        heartbeat_at: new Date('2026-05-19T10:00:00.000Z'),
        updated_at: new Date('2026-05-19T10:00:00.000Z'),
      }
    ]);

    const result = await lockService.acquireWorkspaceLock('aa-bb-cc-dd-ee-ff', 'pod-a', {
      leaseTTLSeconds: 20
    });

    expect(prisma.$queryRawUnsafe).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({
      acquired: true,
      lock: {
        deviceMac: 'AA:BB:CC:DD:EE:FF',
        holderId: 'pod-a',
        fencingToken: 1,
      }
    });
  });

  it('returns busy with current owner when lock acquisition update does not apply', async () => {
    prisma.$queryRawUnsafe
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        {
          device_mac: 'AA:BB:CC:DD:EE:FF',
          holder_id: 'pod-b',
          fencing_token: BigInt(4),
          lease_expires_at: new Date('2026-05-19T10:02:00.000Z'),
          heartbeat_at: new Date('2026-05-19T10:01:50.000Z'),
          updated_at: new Date('2026-05-19T10:01:50.000Z'),
        }
      ]);

    const result = await lockService.acquireWorkspaceLock('aa-bb-cc-dd-ee-ff', 'pod-a');

    expect(result).toMatchObject({
      acquired: false,
      current: {
        holderId: 'pod-b',
        fencingToken: 4
      }
    });
  });

  it('throws 409 conflict on heartbeat when holder/token does not match', async () => {
    prisma.$queryRawUnsafe.mockResolvedValueOnce([]);

    await expect(lockService.heartbeatWorkspaceLock('aa-bb-cc-dd-ee-ff', 'pod-a', 9)).rejects.toMatchObject({
      statusCode: 409
    });
  });

  it('releases lock only when holder matches', async () => {
    prisma.$executeRawUnsafe.mockResolvedValueOnce(1);
    prisma.$executeRawUnsafe.mockResolvedValueOnce(0);

    const released = await lockService.releaseWorkspaceLock('aa-bb-cc-dd-ee-ff', 'pod-a', 1);
    const notReleased = await lockService.releaseWorkspaceLock('aa-bb-cc-dd-ee-ff', 'pod-a', 2);

    expect(released).toEqual({ released: true });
    expect(notReleased).toEqual({ released: false });
  });
});
