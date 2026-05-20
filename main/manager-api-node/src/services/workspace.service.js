const crypto = require('crypto');
const path = require('path');
const { prisma } = require('../config/database');
const { normalizeMacAddress } = require('../utils/helpers');

const FILE_MAP = {
  'AGENT.md': 'AGENT.md',
  'USER.md': 'USER.md',
  'SOUL.md': 'SOUL.md',
  'HEARTBEAT.md': 'HEARTBEAT.md',
  'MEMORY.md': 'memory/MEMORY.md',
};

const INPUT_KEY_ALIASES = {
  'memory/MEMORY.md': 'MEMORY.md',
};

const MAX_BYTES = 256 * 1024;
const DEFAULT_SYNC_LIMIT = 500;
const MAX_SYNC_LIMIT = 2000;
const MANIFEST_PATH = '.picoclaw/workspace-manifest.json';
const NUL_CHAR = '\u0000';

function clampLimit(value, defaultLimit = DEFAULT_SYNC_LIMIT, maxLimit = MAX_SYNC_LIMIT) {
  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed) || parsed <= 0) return defaultLimit;
  if (parsed > maxLimit) return maxLimit;
  return parsed;
}

function normalizeWorkspaceRelativePath(relativePath) {
  if (typeof relativePath !== 'string' || relativePath.trim() === '') {
    throw new Error('relativePath is required');
  }

  const slashPath = relativePath.trim().replace(/\\/g, '/');
  if (/^[A-Za-z]:/.test(slashPath) || slashPath.startsWith('/')) {
    throw new Error('relativePath must stay inside the workspace');
  }

  const normalized = path.posix.normalize(slashPath);
  if (normalized === '.' || normalized.startsWith('../') || normalized === '..') {
    throw new Error('relativePath must stay inside the workspace');
  }
  if (normalized.length > 500) {
    throw new Error('relativePath is too long');
  }
  return normalized;
}

function parseManifestContent(content) {
  if (typeof content !== 'string' || content.trim() === '') return {};
  try {
    const parsed = JSON.parse(content);
    if (parsed && typeof parsed === 'object') return parsed;
  } catch (_) {
    // ignore malformed old manifest
  }
  return {};
}

function ensureNoNulBytes(content, label) {
  if (typeof content !== 'string') return;
  if (content.includes(NUL_CHAR)) {
    const error = new Error(`${label} contains unsupported binary null bytes`);
    error.statusCode = 400;
    throw error;
  }
}

async function getDeviceByMac(normalizedMac) {
  return prisma.ai_device.findUnique({
    where: { mac_address: normalizedMac },
    select: { id: true, agent_id: true },
  });
}

async function verifyOwnership(macAddress, userId) {
  const device = await prisma.ai_device.findFirst({
    where: { mac_address: macAddress, user_id: BigInt(userId) },
    select: { id: true },
  });

  if (!device) {
    const error = new Error('Device not found or access denied');
    error.statusCode = 403;
    throw error;
  }
}

async function getWorkspaceFiles(macAddress, userId = null) {
  const normalizedMac = normalizeMacAddress(macAddress);
  if (!normalizedMac) throw new Error('Invalid MAC address');

  if (userId !== null && userId !== undefined) {
    await verifyOwnership(normalizedMac, userId);
  }

  const result = {};
  for (const [displayName, storagePath] of Object.entries(FILE_MAP)) {
    const row = await prisma.device_workspace_artifacts.findUnique({
      where: {
        mac_address_relative_path: {
          mac_address: normalizedMac,
          relative_path: storagePath,
        },
      },
      select: { content: true, updated_at: true },
    });

    const payload = {
      content: row?.content ?? '',
      updatedAt: row?.updated_at?.toISOString() ?? null,
    };
    result[displayName] = payload;

    // Backward-compatible response alias for memory path.
    if (displayName === 'MEMORY.md') {
      result['memory/MEMORY.md'] = payload;
    }
  }

  return result;
}

async function saveWorkspaceFiles(macAddress, userId = null, files = {}) {
  const normalizedMac = normalizeMacAddress(macAddress);
  if (!normalizedMac) throw new Error('Invalid MAC address');

  if (userId !== null && userId !== undefined) {
    await verifyOwnership(normalizedMac, userId);
  }

  const device = await getDeviceByMac(normalizedMac);
  if (!device) throw new Error('Device not found');

  const normalizedFiles = {};
  for (const [rawKey, rawValue] of Object.entries(files || {})) {
    const canonicalKey = INPUT_KEY_ALIASES[rawKey] || rawKey;
    if (!(canonicalKey in FILE_MAP)) continue;
    if (!(canonicalKey in normalizedFiles)) {
      normalizedFiles[canonicalKey] = rawValue;
    }
  }

  const saved = [];
  const now = new Date();

  for (const [displayName, storagePath] of Object.entries(FILE_MAP)) {
    if (!(displayName in normalizedFiles)) continue;

    const content = typeof normalizedFiles[displayName] === 'string' ? normalizedFiles[displayName] : '';
    ensureNoNulBytes(content, displayName);
    const sizeBytes = Buffer.byteLength(content, 'utf8');
    if (sizeBytes > MAX_BYTES) {
      throw new Error(`${displayName} exceeds 256 KB`);
    }

    const sha256 = crypto.createHash('sha256').update(content, 'utf8').digest('hex');

    await prisma.device_workspace_artifacts.upsert({
      where: {
        mac_address_relative_path: {
          mac_address: normalizedMac,
          relative_path: storagePath,
        },
      },
      create: {
        mac_address: normalizedMac,
        device_id: device.id,
        agent_id: device.agent_id || null,
        relative_path: storagePath,
        content,
        content_type: 'text/markdown',
        size_bytes: sizeBytes,
        sha256,
        metadata: {},
        created_at: now,
        updated_at: now,
      },
      update: {
        device_id: device.id,
        agent_id: device.agent_id || null,
        content,
        content_type: 'text/markdown',
        size_bytes: sizeBytes,
        sha256,
        metadata: {},
        updated_at: now,
      },
    });

    saved.push(displayName);
  }

  return { saved };
}

async function getWorkspaceSync(macAddress, userId = null, options = {}) {
  const normalizedMac = normalizeMacAddress(macAddress);
  if (!normalizedMac) throw new Error('Invalid MAC address');

  if (userId !== null && userId !== undefined) {
    await verifyOwnership(normalizedMac, userId);
  }

  const sinceRevision = typeof options.sinceRevision === 'string'
    ? options.sinceRevision.trim()
    : '';
  const limit = clampLimit(options.limit, DEFAULT_SYNC_LIMIT, MAX_SYNC_LIMIT);

  const manifestRow = await prisma.device_workspace_artifacts.findUnique({
    where: {
      mac_address_relative_path: {
        mac_address: normalizedMac,
        relative_path: MANIFEST_PATH,
      },
    },
    select: { content: true, updated_at: true },
  });

  const manifest = parseManifestContent(manifestRow?.content || '');
  const revision = typeof manifest.revision === 'string' && manifest.revision.trim() !== ''
    ? manifest.revision.trim()
    : null;

  if (sinceRevision && revision && sinceRevision === revision) {
    return {
      revision,
      manifest,
      files: [],
      deleted: Array.isArray(manifest.deleted) ? manifest.deleted : [],
      delta: true,
    };
  }

  const artifacts = await prisma.device_workspace_artifacts.findMany({
    where: { mac_address: normalizedMac },
    orderBy: { updated_at: 'desc' },
    take: limit,
    select: {
      relative_path: true,
      content: true,
      content_type: true,
      sha256: true,
      size_bytes: true,
      updated_at: true,
    },
  });

  const files = artifacts
    .filter((row) => row.relative_path !== MANIFEST_PATH)
    .map((row) => ({
      relativePath: row.relative_path,
      content: row.content || '',
      contentType: row.content_type || 'text/plain',
      sha256: row.sha256 || '',
      sizeBytes: row.size_bytes || 0,
      updatedAt: row.updated_at ? row.updated_at.toISOString() : null,
    }));

  return {
    revision,
    manifest,
    files,
    deleted: Array.isArray(manifest.deleted) ? manifest.deleted : [],
    delta: Boolean(sinceRevision),
  };
}

async function saveWorkspaceSync(macAddress, userId = null, payload = {}) {
  const normalizedMac = normalizeMacAddress(macAddress);
  if (!normalizedMac) throw new Error('Invalid MAC address');

  if (userId !== null && userId !== undefined) {
    await verifyOwnership(normalizedMac, userId);
  }

  const device = await getDeviceByMac(normalizedMac);
  if (!device) throw new Error('Device not found');

  const baseRevision = typeof payload.baseRevision === 'string'
    ? payload.baseRevision.trim()
    : '';
  const newRevision = typeof payload.newRevision === 'string'
    ? payload.newRevision.trim()
    : '';
  if (!newRevision) {
    throw new Error('newRevision is required');
  }

  const rawFiles = Array.isArray(payload.files) ? payload.files : [];
  const rawDeleted = Array.isArray(payload.deleted) ? payload.deleted : [];
  const now = new Date();

  const normalizedFiles = new Map();
  for (const item of rawFiles) {
    if (!item || typeof item !== 'object') continue;
    const relativePath = normalizeWorkspaceRelativePath(item.relativePath || item.relative_path);
    if (relativePath === MANIFEST_PATH) continue;

    const content = typeof item.content === 'string' ? item.content : '';
    ensureNoNulBytes(content, relativePath);
    const sizeBytes = Buffer.byteLength(content, 'utf8');
    if (sizeBytes > MAX_BYTES) {
      throw new Error(`${relativePath} exceeds ${MAX_BYTES} bytes`);
    }

    normalizedFiles.set(relativePath, {
      relativePath,
      content,
      contentType: typeof item.contentType === 'string' && item.contentType.trim() !== ''
        ? item.contentType.trim()
        : 'text/plain',
      sizeBytes,
      sha256: crypto.createHash('sha256').update(content, 'utf8').digest('hex'),
    });
  }

  const normalizedDeleted = [];
  const deletedSet = new Set();
  for (const rawPath of rawDeleted) {
    const normalizedPath = normalizeWorkspaceRelativePath(rawPath);
    if (normalizedPath === MANIFEST_PATH) continue;
    if (!deletedSet.has(normalizedPath)) {
      deletedSet.add(normalizedPath);
      normalizedDeleted.push(normalizedPath);
    }
  }

  return prisma.$transaction(async (tx) => {
    const lockedDeviceRows = await tx.$queryRawUnsafe(
      `SELECT id
       FROM ai_device
       WHERE mac_address = $1
       FOR UPDATE`,
      normalizedMac
    );
    if (!Array.isArray(lockedDeviceRows) || lockedDeviceRows.length === 0) {
      throw new Error('Device not found');
    }

    const manifestRow = await tx.device_workspace_artifacts.findUnique({
      where: {
        mac_address_relative_path: {
          mac_address: normalizedMac,
          relative_path: MANIFEST_PATH,
        },
      },
      select: { content: true },
    });
    const currentManifest = parseManifestContent(manifestRow?.content || '');
    const currentRevision = typeof currentManifest.revision === 'string' ? currentManifest.revision.trim() : '';

    if (baseRevision && currentRevision && baseRevision !== currentRevision) {
      const conflict = new Error(`workspace revision conflict: expected ${baseRevision}, current ${currentRevision}`);
      conflict.statusCode = 409;
      conflict.serverRevision = currentRevision;
      throw conflict;
    }

    let savedCount = 0;
    for (const file of normalizedFiles.values()) {
      await tx.device_workspace_artifacts.upsert({
        where: {
          mac_address_relative_path: {
            mac_address: normalizedMac,
            relative_path: file.relativePath,
          },
        },
        create: {
          mac_address: normalizedMac,
          device_id: device.id,
          agent_id: device.agent_id || null,
          relative_path: file.relativePath,
          content: file.content,
          content_type: file.contentType,
          size_bytes: file.sizeBytes,
          sha256: file.sha256,
          metadata: {
            source: 'workspace-sync',
            revision: newRevision,
          },
          created_at: now,
          updated_at: now,
        },
        update: {
          device_id: device.id,
          agent_id: device.agent_id || null,
          content: file.content,
          content_type: file.contentType,
          size_bytes: file.sizeBytes,
          sha256: file.sha256,
          metadata: {
            source: 'workspace-sync',
            revision: newRevision,
          },
          updated_at: now,
        },
      });
      savedCount++;
    }

    let deletedCount = 0;
    for (const relativePath of normalizedDeleted) {
      const result = await tx.device_workspace_artifacts.deleteMany({
        where: {
          mac_address: normalizedMac,
          relative_path: relativePath,
        },
      });
      deletedCount += result.count || 0;
    }

    const manifestContent = {
      ...(payload.manifest && typeof payload.manifest === 'object' ? payload.manifest : {}),
      revision: newRevision,
      baseRevision: baseRevision || currentRevision || null,
      generatedAt: now.toISOString(),
      deleted: normalizedDeleted,
    };
    const manifestText = JSON.stringify(manifestContent, null, 2);
    ensureNoNulBytes(manifestText, MANIFEST_PATH);

    await tx.device_workspace_artifacts.upsert({
      where: {
        mac_address_relative_path: {
          mac_address: normalizedMac,
          relative_path: MANIFEST_PATH,
        },
      },
      create: {
        mac_address: normalizedMac,
        device_id: device.id,
        agent_id: device.agent_id || null,
        relative_path: MANIFEST_PATH,
        content: manifestText,
        content_type: 'application/json',
        size_bytes: Buffer.byteLength(manifestText, 'utf8'),
        sha256: crypto.createHash('sha256').update(manifestText, 'utf8').digest('hex'),
        metadata: {
          source: 'workspace-sync-manifest',
          revision: newRevision,
        },
        created_at: now,
        updated_at: now,
      },
      update: {
        device_id: device.id,
        agent_id: device.agent_id || null,
        content: manifestText,
        content_type: 'application/json',
        size_bytes: Buffer.byteLength(manifestText, 'utf8'),
        sha256: crypto.createHash('sha256').update(manifestText, 'utf8').digest('hex'),
        metadata: {
          source: 'workspace-sync-manifest',
          revision: newRevision,
        },
        updated_at: now,
      },
    });

    return {
      appliedRevision: newRevision,
      previousRevision: currentRevision || null,
      savedCount,
      deletedCount,
    };
  });
}

module.exports = {
  getWorkspaceFiles,
  saveWorkspaceFiles,
  getWorkspaceSync,
  saveWorkspaceSync,
};
