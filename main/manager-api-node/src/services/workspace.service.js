const crypto = require('crypto');
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

  const device = await prisma.ai_device.findUnique({
    where: { mac_address: normalizedMac },
    select: { id: true, agent_id: true },
  });
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

module.exports = {
  getWorkspaceFiles,
  saveWorkspaceFiles,
};
