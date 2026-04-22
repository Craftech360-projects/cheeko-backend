#!/usr/bin/env node
/**
 * Backfill legacy ai_agent_chat_history rows into voice_sessions and
 * voice_session_messages.
 *
 * Usage:
 *   node scripts/backfill-ai-agent-chat-history-to-voice-sessions.js --dry-run
 *   node scripts/backfill-ai-agent-chat-history-to-voice-sessions.js
 */

function chatTypeToRole(chatType) {
  if (chatType === 1) return 'user';
  if (chatType === 2) return 'assistant';
  return 'unknown';
}

function firstPresent(rows, field, fallback = null) {
  const row = rows.find(item => item[field] !== null && item[field] !== undefined && item[field] !== '');
  return row ? row[field] : fallback;
}

function normalizeMac(macAddress) {
  return macAddress || '';
}

function buildVoiceSessionRecord(sessionId, orderedRows) {
  if (!orderedRows || orderedRows.length === 0) {
    throw new Error(`No legacy rows found for session ${sessionId}`);
  }

  const first = orderedRows[0];
  const last = orderedRows[orderedRows.length - 1];

  return {
    session_id: sessionId,
    mac_address: normalizeMac(firstPresent(orderedRows, 'mac_address', '')),
    agent_id: firstPresent(orderedRows, 'agent_id'),
    status: 'ended',
    started_at: first.created_at || new Date(),
    ended_at: last.created_at || first.created_at || new Date(),
    last_event_at: last.created_at || first.created_at || new Date(),
    metadata: {
      backfill: {
        source: 'ai_agent_chat_history',
        rowCount: orderedRows.length
      }
    }
  };
}

function buildVoiceMessageRecords(orderedRows) {
  return orderedRows.map((row, index) => ({
    session_id: row.session_id,
    mac_address: normalizeMac(row.mac_address),
    agent_id: row.agent_id || null,
    sequence: index + 1,
    role: chatTypeToRole(row.chat_type),
    content: row.content || null,
    provider_message: null,
    audio_id: row.audio_id || null,
    created_at: row.created_at || new Date(),
    idempotency_key: `legacy:ai_agent_chat_history:${row.id}`
  }));
}

async function backfillLegacyChatHistory(prisma, options = {}) {
  const dryRun = options.dryRun === true;
  const sessions = await prisma.ai_agent_chat_history.findMany({
    select: { session_id: true },
    distinct: ['session_id'],
    orderBy: { session_id: 'asc' }
  });

  const summary = {
    dryRun,
    sessions: sessions.length,
    messages: 0,
    insertedMessages: 0
  };

  for (const session of sessions) {
    const sessionId = session.session_id;
    if (!sessionId) continue;

    const legacyRows = await prisma.ai_agent_chat_history.findMany({
      where: { session_id: sessionId },
      orderBy: [{ created_at: 'asc' }, { id: 'asc' }]
    });
    if (legacyRows.length === 0) continue;

    const voiceSession = buildVoiceSessionRecord(sessionId, legacyRows);
    const voiceMessages = buildVoiceMessageRecords(legacyRows);
    summary.messages += voiceMessages.length;

    if (dryRun) continue;

    await prisma.voice_sessions.upsert({
      where: { session_id: sessionId },
      create: voiceSession,
      update: {
        mac_address: voiceSession.mac_address,
        agent_id: voiceSession.agent_id,
        ended_at: voiceSession.ended_at,
        last_event_at: voiceSession.last_event_at,
        metadata: voiceSession.metadata
      }
    });

    const result = await prisma.voice_session_messages.createMany({
      data: voiceMessages,
      skipDuplicates: true
    });
    summary.insertedMessages += result.count || 0;
  }

  return summary;
}

function parseArgs(argv) {
  return {
    dryRun: argv.includes('--dry-run')
  };
}

function buildDbConnectionString(rawUrl) {
  if (!rawUrl) {
    throw new Error('DATABASE_URL is required for chat-history backfill');
  }

  return rawUrl
    .replace(/([?&])sslmode=[^&]*/g, '$1')
    .replace(/\?&/g, '?')
    .replace(/[?&]$/g, '');
}

function createPrismaClient() {
  const { Pool } = require('pg');
  const { PrismaClient } = require('@prisma/client');
  const { PrismaPg } = require('@prisma/adapter-pg');

  const pgPool = new Pool({
    connectionString: buildDbConnectionString(process.env.DATABASE_URL || process.env.DIRECT_URL),
    ssl: { rejectUnauthorized: false }
  });
  const prisma = new PrismaClient({ adapter: new PrismaPg(pgPool) });
  const disconnect = prisma.$disconnect.bind(prisma);

  prisma.$disconnect = async () => {
    await disconnect();
    await pgPool.end();
  };

  return prisma;
}

async function main() {
  require('dotenv').config();
  const prisma = createPrismaClient();
  const options = parseArgs(process.argv.slice(2));

  try {
    const summary = await backfillLegacyChatHistory(prisma, options);
    console.log(JSON.stringify(summary, null, 2));
  } finally {
    await prisma.$disconnect();
  }
}

if (require.main === module) {
  main().catch(error => {
    console.error(error);
    process.exit(1);
  });
}

module.exports = {
  backfillLegacyChatHistory,
  buildVoiceSessionRecord,
  buildVoiceMessageRecords,
  buildDbConnectionString,
  createPrismaClient,
  chatTypeToRole,
  parseArgs
};
