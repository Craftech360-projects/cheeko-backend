const { prisma } = require('../config/database');
const { normalizeMacAddress } = require('../utils/helpers');

const DEFAULT_LEASE_TTL_SECONDS = 20;
const DEFAULT_STALE_GRACE_SECONDS = 2;
const MAX_LEASE_TTL_SECONDS = 300;

function clampLeaseTTL(value) {
  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed) || parsed <= 0) return DEFAULT_LEASE_TTL_SECONDS;
  if (parsed > MAX_LEASE_TTL_SECONDS) return MAX_LEASE_TTL_SECONDS;
  return parsed;
}

function clampStaleGrace(value) {
  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed) || parsed < 0) return DEFAULT_STALE_GRACE_SECONDS;
  if (parsed > 30) return 30;
  return parsed;
}

function normalizeFencingToken(raw) {
  if (raw === null || raw === undefined || raw === '') return null;
  const parsed = Number.parseInt(String(raw), 10);
  if (Number.isNaN(parsed) || parsed <= 0) {
    const error = new Error('fencingToken must be a positive integer');
    error.statusCode = 400;
    throw error;
  }
  return parsed;
}

function normalizeLockRow(row) {
  if (!row) return null;
  const token = typeof row.fencing_token === 'bigint'
    ? Number(row.fencing_token)
    : Number.parseInt(String(row.fencing_token), 10);
  return {
    deviceMac: row.device_mac,
    holderId: row.holder_id,
    fencingToken: Number.isNaN(token) ? null : token,
    leaseExpiresAt: row.lease_expires_at ? new Date(row.lease_expires_at).toISOString() : null,
    heartbeatAt: row.heartbeat_at ? new Date(row.heartbeat_at).toISOString() : null,
    updatedAt: row.updated_at ? new Date(row.updated_at).toISOString() : null,
  };
}

function validateMacAndHolder(macAddress, holderId) {
  const normalizedMac = normalizeMacAddress(macAddress);
  if (!normalizedMac) {
    const error = new Error('Invalid MAC address');
    error.statusCode = 400;
    throw error;
  }
  const owner = typeof holderId === 'string' ? holderId.trim() : '';
  if (!owner) {
    const error = new Error('holderId is required');
    error.statusCode = 400;
    throw error;
  }
  return { normalizedMac, owner };
}

async function getWorkspaceLock(macAddress) {
  const normalizedMac = normalizeMacAddress(macAddress);
  if (!normalizedMac) {
    const error = new Error('Invalid MAC address');
    error.statusCode = 400;
    throw error;
  }

  const rows = await prisma.$queryRawUnsafe(
    `SELECT device_mac, holder_id, fencing_token, lease_expires_at, heartbeat_at, updated_at
     FROM workspace_locks
     WHERE device_mac = $1`,
    normalizedMac
  );
  const row = Array.isArray(rows) ? rows[0] : null;
  return normalizeLockRow(row);
}

async function acquireWorkspaceLock(macAddress, holderId, options = {}) {
  const { normalizedMac, owner } = validateMacAndHolder(macAddress, holderId);
  const leaseTTLSeconds = clampLeaseTTL(options.leaseTTLSeconds);
  const staleGraceSeconds = clampStaleGrace(options.staleGraceSeconds);
  const preempt = options.preempt === true || options.preempt === 'true';

  // Last-tap-wins preemption: a freshly dispatched session is by definition the
  // newest, so when preempt=true we FORCE-acquire even from a live holder. The
  // ON CONFLICT update drops its liveness guard (the WHERE clause) and always
  // takes over a DIFFERENT holder, incrementing the fencing_token so the old
  // holder is fenced out on its next heartbeat. If two new dispatches race, the
  // fencing_token serializes them and the last writer wins.
  // Only the non-preempt path references $4 (staleGraceSeconds) in the WHERE clause, so the
  // bound params MUST match: 4 params with the WHERE, 3 without it (preempt). Mismatching
  // counts triggers Postgres 08P01 "bind message supplies N parameters...".
  const sql =
    `INSERT INTO workspace_locks (device_mac, holder_id, fencing_token, lease_expires_at, heartbeat_at, created_at, updated_at)
     VALUES ($1, $2, 1, now() + ($3 * interval '1 second'), now(), now(), now())
     ON CONFLICT (device_mac)
     DO UPDATE SET
       holder_id = EXCLUDED.holder_id,
       fencing_token = CASE
         WHEN workspace_locks.holder_id = EXCLUDED.holder_id THEN workspace_locks.fencing_token
         ELSE workspace_locks.fencing_token + 1
       END,
       lease_expires_at = now() + ($3 * interval '1 second'),
       heartbeat_at = now(),
       updated_at = now()
     ${preempt
       ? ''
       : `WHERE workspace_locks.holder_id = EXCLUDED.holder_id
       OR workspace_locks.lease_expires_at < (now() - ($4 * interval '1 second'))`}
     RETURNING device_mac, holder_id, fencing_token, lease_expires_at, heartbeat_at, updated_at`;
  const args = preempt
    ? [normalizedMac, owner, leaseTTLSeconds]
    : [normalizedMac, owner, leaseTTLSeconds, staleGraceSeconds];
  const rows = await prisma.$queryRawUnsafe(sql, ...args);

  if (Array.isArray(rows) && rows.length > 0) {
    return {
      acquired: true,
      preempted: preempt && Number(rows[0].fencing_token) > 1,
      lock: normalizeLockRow(rows[0]),
    };
  }

  const current = await getWorkspaceLock(normalizedMac);
  return {
    acquired: false,
    current,
  };
}

async function heartbeatWorkspaceLock(macAddress, holderId, fencingToken, options = {}) {
  const { normalizedMac, owner } = validateMacAndHolder(macAddress, holderId);
  const leaseTTLSeconds = clampLeaseTTL(options.leaseTTLSeconds);
  const token = normalizeFencingToken(fencingToken);

  const params = [normalizedMac, owner, leaseTTLSeconds];
  let tokenSql = '';
  if (token !== null) {
    params.push(token);
    tokenSql = ` AND fencing_token = $${params.length}`;
  }

  const rows = await prisma.$queryRawUnsafe(
    `UPDATE workspace_locks
     SET lease_expires_at = now() + ($3 * interval '1 second'),
         heartbeat_at = now(),
         updated_at = now()
     WHERE device_mac = $1
       AND holder_id = $2${tokenSql}
     RETURNING device_mac, holder_id, fencing_token, lease_expires_at, heartbeat_at, updated_at`,
    ...params
  );

  if (!Array.isArray(rows) || rows.length === 0) {
    // Distinguish "fenced out by a newer holder/token" (the caller was preempted
    // and must stop) from a transient miss. Read the current row so the worker
    // gets a definitive, distinguishable signal it was preempted.
    const current = await getWorkspaceLock(normalizedMac);
    const fenced =
      current !== null &&
      (current.holderId !== owner ||
        (token !== null && current.fencingToken !== null && current.fencingToken > token));
    const error = new Error(
      fenced
        ? 'workspace lock heartbeat rejected: preempted by newer holder'
        : 'workspace lock heartbeat rejected: lock owner/token mismatch'
    );
    error.statusCode = 409;
    error.lockErrorCode = fenced ? 'LOCK_PREEMPTED' : 'LOCK_NOT_HELD';
    error.current = current;
    throw error;
  }

  return {
    renewed: true,
    lock: normalizeLockRow(rows[0]),
  };
}

async function releaseWorkspaceLock(macAddress, holderId, fencingToken = null) {
  const { normalizedMac, owner } = validateMacAndHolder(macAddress, holderId);
  const token = normalizeFencingToken(fencingToken);
  const params = [normalizedMac, owner];
  let tokenSql = '';
  if (token !== null) {
    params.push(token);
    tokenSql = ` AND fencing_token = $${params.length}`;
  }

  const result = await prisma.$executeRawUnsafe(
    `DELETE FROM workspace_locks
     WHERE device_mac = $1
       AND holder_id = $2${tokenSql}`,
    ...params
  );

  return {
    released: Number(result || 0) > 0,
  };
}

module.exports = {
  acquireWorkspaceLock,
  heartbeatWorkspaceLock,
  releaseWorkspaceLock,
  getWorkspaceLock,
};
