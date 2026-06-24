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

  it('preempt acquire force-takes the lock from a different live holder and bumps the fencing token', async () => {
    // ON CONFLICT update returns the new row directly (preempt drops the liveness guard).
    prisma.$queryRawUnsafe.mockResolvedValueOnce([
      {
        device_mac: 'AA:BB:CC:DD:EE:FF',
        holder_id: 'pod-new',
        fencing_token: BigInt(5),
        lease_expires_at: new Date('2026-05-19T10:05:00.000Z'),
        heartbeat_at: new Date('2026-05-19T10:04:50.000Z'),
        updated_at: new Date('2026-05-19T10:04:50.000Z'),
      }
    ]);

    const result = await lockService.acquireWorkspaceLock('aa-bb-cc-dd-ee-ff', 'pod-new', {
      preempt: true,
    });

    // Only ONE query (no busy fallback read), and the WHERE liveness guard is omitted.
    expect(prisma.$queryRawUnsafe).toHaveBeenCalledTimes(1);
    const sql = prisma.$queryRawUnsafe.mock.calls[0][0];
    expect(sql).not.toMatch(/WHERE\s+workspace_locks\.holder_id/);
    expect(result).toMatchObject({
      acquired: true,
      preempted: true,
      lock: { holderId: 'pod-new', fencingToken: 5 },
    });
  });

  it('non-preempt acquire keeps the liveness guard in the WHERE clause', async () => {
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

    await lockService.acquireWorkspaceLock('aa-bb-cc-dd-ee-ff', 'pod-a', { leaseTTLSeconds: 8 });

    const sql = prisma.$queryRawUnsafe.mock.calls[0][0];
    expect(sql).toMatch(/WHERE\s+workspace_locks\.holder_id/);
  });

  it('throws 409 LOCK_PREEMPTED on heartbeat when a newer holder owns the lock', async () => {
    prisma.$queryRawUnsafe
      // UPDATE ... RETURNING matches nothing
      .mockResolvedValueOnce([])
      // getWorkspaceLock read: a DIFFERENT holder now owns it (preempted)
      .mockResolvedValueOnce([
        {
          device_mac: 'AA:BB:CC:DD:EE:FF',
          holder_id: 'pod-new',
          fencing_token: BigInt(2),
          lease_expires_at: new Date('2026-05-19T10:05:00.000Z'),
          heartbeat_at: new Date('2026-05-19T10:04:50.000Z'),
          updated_at: new Date('2026-05-19T10:04:50.000Z'),
        }
      ]);

    await expect(
      lockService.heartbeatWorkspaceLock('aa-bb-cc-dd-ee-ff', 'pod-a', 1)
    ).rejects.toMatchObject({
      statusCode: 409,
      lockErrorCode: 'LOCK_PREEMPTED',
    });
  });

  it('throws 409 LOCK_PREEMPTED on heartbeat when the fencing token advanced past ours', async () => {
    prisma.$queryRawUnsafe
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        {
          device_mac: 'AA:BB:CC:DD:EE:FF',
          holder_id: 'pod-a',
          fencing_token: BigInt(7),
          lease_expires_at: new Date('2026-05-19T10:05:00.000Z'),
          heartbeat_at: new Date('2026-05-19T10:04:50.000Z'),
          updated_at: new Date('2026-05-19T10:04:50.000Z'),
        }
      ]);

    await expect(
      lockService.heartbeatWorkspaceLock('aa-bb-cc-dd-ee-ff', 'pod-a', 3)
    ).rejects.toMatchObject({
      statusCode: 409,
      lockErrorCode: 'LOCK_PREEMPTED',
    });
  });

  it('throws 409 LOCK_NOT_HELD on heartbeat when the lock row is gone', async () => {
    prisma.$queryRawUnsafe
      .mockResolvedValueOnce([]) // UPDATE matches nothing
      .mockResolvedValueOnce([]); // getWorkspaceLock: no row

    await expect(
      lockService.heartbeatWorkspaceLock('aa-bb-cc-dd-ee-ff', 'pod-a', 9)
    ).rejects.toMatchObject({
      statusCode: 409,
      lockErrorCode: 'LOCK_NOT_HELD',
    });
  });

  it('stale-token release is a safe no-op (released:false), never throws', async () => {
    prisma.$executeRawUnsafe.mockResolvedValueOnce(0);

    const result = await lockService.releaseWorkspaceLock('aa-bb-cc-dd-ee-ff', 'pod-a', 1);

    expect(result).toEqual({ released: false });
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
