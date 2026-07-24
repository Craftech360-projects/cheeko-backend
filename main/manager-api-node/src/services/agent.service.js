/**
 * Agent Service
 *
 * Handles AI agent configuration, chat history, and device integration.
 */

const { prisma } = require('../config/database');
const logger = require('../utils/logger');
const { normalizeMacAddress, transformKeysToCamel } = require('../utils/helpers');
const mem0Service = require('./integrations/mem0.service');
const { resolveSessionForCharacter } = require('./character-resolver');
const { validateAgentMd } = require('../utils/agent-md-validator');
const crypto = require('crypto');
const path = require('path');

const emptyMemoryPayload = () => ({ memories: [], relations: [], entities: [] });
const MAX_WORKSPACE_ARTIFACT_BYTES = 256 * 1024;
const MAX_DEVICE_MEMORY_DOCUMENT_BYTES = 512 * 1024;
const MAX_ROLLING_SUMMARY_MEMORY_CHARS = 1500;

const toStringOrNull = (value) => {
  if (value === null || value === undefined) return null;
  return value.toString();
};

const toISOStringOrNull = (value) => {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString();
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toISOString();
};

const clampLimit = (value, defaultLimit = 20, maxLimit = 100) => {
  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed)) return defaultLimit;
  if (parsed < 0) return 0;
  if (parsed > maxLimit) return maxLimit;
  return parsed;
};

const chatTypeToRole = (chatType) => {
  if (chatType === 1) return 'user';
  if (chatType === 2) return 'assistant';
  return 'unknown';
};

const roleToChatType = (role) => {
  if (role === 'user') return 1;
  if (role === 'assistant' || role === 'agent') return 2;
  return 0;
};

const normalizeWorkspaceRelativePath = (relativePath) => {
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
};

const artifactToDTO = (artifact) => ({
  id: artifact.id,
  macAddress: artifact.mac_address,
  sessionId: artifact.session_id,
  deviceId: artifact.device_id,
  agentId: artifact.agent_id,
  relativePath: artifact.relative_path,
  contentType: artifact.content_type,
  content: artifact.content,
  sizeBytes: artifact.size_bytes,
  sha256: artifact.sha256,
  metadata: artifact.metadata,
  createdAt: toISOStringOrNull(artifact.created_at),
  updatedAt: toISOStringOrNull(artifact.updated_at)
});

const memoryDocumentToDTO = (document) => ({
  id: document.id,
  macAddress: document.mac_address,
  deviceId: document.device_id,
  agentId: document.agent_id,
  kidId: toStringOrNull(document.kid_id),
  documentKey: document.document_key,
  memoryType: document.memory_type,
  memoryDate: document.memory_date ? toISOStringOrNull(document.memory_date)?.slice(0, 10) : null,
  content: document.content,
  source: document.source,
  sessionId: document.session_id,
  metadata: document.metadata,
  createdAt: toISOStringOrNull(document.created_at),
  updatedAt: toISOStringOrNull(document.updated_at)
});

const normalizeMemoryDocumentKey = (documentKey) => {
  if (typeof documentKey !== 'string' || documentKey.trim() === '') {
    throw new Error('documentKey is required');
  }
  const normalized = documentKey.trim().toLowerCase().replace(/[^a-z0-9:_-]+/g, '-').replace(/^-+|-+$/g, '');
  if (!normalized) throw new Error('documentKey is required');
  if (normalized.length > 120) throw new Error('documentKey is too long');
  return normalized;
};

const parseMemoryDate = (memoryDate) => {
  if (!memoryDate) return null;
  const parsed = new Date(memoryDate);
  if (Number.isNaN(parsed.getTime())) throw new Error('memoryDate is invalid');
  return parsed;
};

const parseMessageTimestamp = (timestamp, fallbackDate = new Date()) => {
  if (!timestamp) return fallbackDate;
  if (typeof timestamp === 'number') return new Date(timestamp * 1000);
  return new Date(timestamp);
};

const formatChatHistoryMessages = (messages, getChatType) => {
  if (!messages || messages.length === 0) return [];

  const sessionCreationTime = messages.reduce((min, msg) => {
    const msgTime = new Date(msg.created_at);
    return msgTime < min ? msgTime : min;
  }, new Date(messages[0].created_at));

  return messages.map(msg => ({
    createdAt: sessionCreationTime.toISOString(),
    chatType: getChatType(msg),
    content: msg.content,
    audioId: msg.audio_id,
    macAddress: msg.mac_address
  }));
};

/**
 * Create a new agent
 * @param {number} userId - User ID
 * @param {Object} data - Agent data
 * @returns {Promise<Object>} Created agent
 */
const createAgent = async (userId, data) => {
  validateAgentMd(data.systemPrompt);
  const agent = await prisma.ai_agent.create({
    data: {
      user_id: BigInt(userId),
      agent_code: data.agentCode || null,
      agent_name: data.agentName,
      asr_model_id: data.asrModelId || null,
      vad_model_id: data.vadModelId || null,
      llm_model_id: data.llmModelId || null,
      vllm_model_id: data.vllmModelId || null,
      tts_model_id: data.ttsModelId || null,
      tts_voice_id: data.ttsVoiceId || null,
      mem_model_id: data.memModelId || null,
      intent_model_id: data.intentModelId || null,
      chat_history_conf: data.chatHistoryConf || 0,
      system_prompt: data.systemPrompt || null,
      summary_memory: data.summaryMemory || null,
      lang_code: data.langCode || 'en',
      language: data.language || 'English',
      sort: data.sort || 0,
      creator: BigInt(userId),
    },
  });
  return agent;
};

/**
 * Get agent by ID
 * @param {string} agentId - Agent ID
 * @param {number} userId - User ID (optional, for ownership check)
 * @returns {Promise<Object>} Agent
 */
const getAgentById = async (agentId, userId = null) => {
  const agent = await prisma.ai_agent.findUnique({
    where: { id: agentId, ...(userId ? { user_id: BigInt(userId) } : {}) },
  });
  return agent || null;
};

/**
 * Update agent
 * @param {string} agentId - Agent ID
 * @param {number} userId - User ID (kept for backward compatibility but not used for filtering)
 * @param {Object} data - Update data
 * @returns {Promise<Object>} Updated agent
 */
const updateAgent = async (agentId, _userId, data) => {
  const existing = await getAgentById(agentId);
  if (!existing) throw new Error('Agent not found');

  const updateData = { updated_at: new Date() };
  if (data.agentCode !== undefined) updateData.agent_code = data.agentCode;
  if (data.agentName !== undefined) updateData.agent_name = data.agentName;
  if (data.asrModelId !== undefined) updateData.asr_model_id = data.asrModelId;
  if (data.vadModelId !== undefined) updateData.vad_model_id = data.vadModelId;
  if (data.llmModelId !== undefined) updateData.llm_model_id = data.llmModelId;
  if (data.vllmModelId !== undefined) updateData.vllm_model_id = data.vllmModelId;
  if (data.ttsModelId !== undefined) updateData.tts_model_id = data.ttsModelId;
  if (data.ttsVoiceId !== undefined) updateData.tts_voice_id = data.ttsVoiceId;
  if (data.memModelId !== undefined) updateData.mem_model_id = data.memModelId;
  if (data.intentModelId !== undefined) updateData.intent_model_id = data.intentModelId;
  if (data.chatHistoryConf !== undefined) updateData.chat_history_conf = data.chatHistoryConf;
  if (data.systemPrompt !== undefined) {
    validateAgentMd(data.systemPrompt);
    updateData.system_prompt = data.systemPrompt;
  }
  if (data.summaryMemory !== undefined) updateData.summary_memory = data.summaryMemory;
  if (data.langCode !== undefined) updateData.lang_code = data.langCode;
  if (data.language !== undefined) updateData.language = data.language;
  if (data.sort !== undefined) updateData.sort = data.sort;

  const agent = await prisma.ai_agent.update({ where: { id: agentId }, data: updateData });
  return agent;
};

/**
 * Delete agent and all associated records
 * Matches Spring Boot behavior: deletes devices, chat history, and plugins first
 * @param {string} agentId - Agent ID
 * @param {number} userId - User ID (kept for backward compatibility but not used for filtering)
 */
const deleteAgent = async (agentId, _userId) => {
  const existing = await getAgentById(agentId);
  if (!existing) throw new Error('Agent not found');

  // Fully unbind devices attached to this agent so they can be paired again.
  await prisma.ai_device.updateMany({
    where: { agent_id: agentId },
    data: { user_id: null, agent_id: null, kid_id: null, update_date: new Date() }
  });
  // Delete associated chat history
  await prisma.ai_agent_chat_history.deleteMany({ where: { agent_id: agentId } });
  // Delete plugin mappings via raw SQL (table not in Prisma schema)
  await prisma.$executeRawUnsafe(`DELETE FROM ai_agent_plugin_mapping WHERE agent_id = $1::uuid`, agentId).catch(() => {});
  // Delete the agent
  await prisma.ai_agent.delete({ where: { id: agentId } });
};

/**
 * List agents for user (paginated)
 * @param {number} userId - User ID
 * @param {Object} options - Pagination options
 * @returns {Promise<Object>} Paginated agents
 */
const listAgents = async (userId, { page = 1, limit = 10 } = {}) => {
  const skip = (page - 1) * limit;
  const where = { user_id: BigInt(userId) };

  const [total, agents] = await Promise.all([
    prisma.ai_agent.count({ where }),
    prisma.ai_agent.findMany({
      where,
      orderBy: [{ sort: 'asc' }, { created_at: 'desc' }],
      skip,
      take: limit,
    }),
  ]);

  return {
    list: agents || [],
    total,
    page,
    limit
  };
};

/**
 * Get all agents for user (no pagination)
 * @param {number} userId - User ID
 * @returns {Promise<Array>} All agents
 */
const getAllAgents = async (userId) => {
  const agents = await prisma.ai_agent.findMany({
    where: { user_id: BigInt(userId) },
    orderBy: { sort: 'asc' },
  });
  return agents || [];
};

/**
 * Get agent sessions (unique session IDs from chat history) with pagination
 * Matches Spring Boot PageData<AgentChatSessionDTO> format
 * @param {string} agentId - Agent ID
 * @param {Object} options - Pagination options
 * @param {number} [options.page=1] - Page number (1-indexed)
 * @param {number} [options.limit=10] - Items per page
 * @returns {Promise<Object>} PageData with list, total
 */
const getAgentSessions = async (agentId, options = {}) => {
  const page = parseInt(options.page) || 1;
  const limit = parseInt(options.limit) || 10;

  const data = await prisma.voice_session_messages.findMany({
    where: { agent_id: agentId },
    select: { session_id: true, created_at: true },
    orderBy: { created_at: 'desc' }
  });

  // Group by session ID and track message counts and earliest timestamp
  const sessionGroups = new Map();
  (data).forEach(item => {
    const sessionId = item.session_id;
    if (!sessionGroups.has(sessionId)) {
      sessionGroups.set(sessionId, {
        sessionId,
        messages: [],
        earliestTime: new Date(item.created_at)
      });
    }
    const session = sessionGroups.get(sessionId);
    session.messages.push(item);
    const msgTime = new Date(item.created_at);
    if (msgTime < session.earliestTime) {
      session.earliestTime = msgTime;
    }
  });

  // Convert to array, ordered by latest message (already sorted from query)
  const sessionIds = Array.from(sessionGroups.keys());
  const totalSessions = sessionIds.length;

  // Calculate pagination
  const startIndex = (page - 1) * limit;
  const endIndex = Math.min(startIndex + limit, totalSessions);
  const paginatedSessionIds = sessionIds.slice(startIndex, endIndex);

  // Build result list matching AgentChatSessionDTO
  const list = paginatedSessionIds.map(sessionId => {
    const session = sessionGroups.get(sessionId);
    return {
      sessionId: session.sessionId,
      createdAt: session.earliestTime.toISOString(),
      chatCount: session.messages.length
    };
  });

  return {
    list,
    total: totalSessions
  };
};

/**
 * Get chat history for a session
 * Matches Spring Boot List<AgentChatHistoryDTO> format
 * @param {string} agentId - Agent ID
 * @param {string} sessionId - Session ID
 * @returns {Promise<Array>} Chat messages with camelCase fields
 */
const getChatHistory = async (agentId, sessionId) => {
  const voiceMessages = await prisma.voice_session_messages.findMany({
    where: { agent_id: agentId, session_id: sessionId },
    select: { created_at: true, role: true, content: true, audio_id: true, mac_address: true },
    orderBy: { created_at: 'asc' }
  });

  return formatChatHistoryMessages(voiceMessages, msg => roleToChatType(msg.role));
};

const getVoiceSessionMessagesForDevice = async (macAddress, sessionId, options = {}) => {
  const normalizedMac = normalizeMacAddress(macAddress);
  if (!normalizedMac) throw new Error('Invalid MAC address format');
  if (!sessionId || typeof sessionId !== 'string' || sessionId.trim() === '') {
    throw new Error('sessionId is required');
  }

  const limit = clampLimit(options.limit, 100, 500);
  const parsedCursor = Number.parseInt(options.cursor, 10);
  const cursor = Number.isNaN(parsedCursor) || parsedCursor < 0 ? 0 : parsedCursor;

  const rows = await prisma.voice_session_messages.findMany({
    where: {
      mac_address: normalizedMac,
      session_id: sessionId.trim(),
      sequence: { gt: cursor }
    },
    orderBy: { sequence: 'asc' },
    take: limit + 1,
    select: {
      id: true,
      session_id: true,
      sequence: true,
      role: true,
      content: true,
      audio_id: true,
      created_at: true,
      idempotency_key: true,
    }
  });

  const hasMore = rows.length > limit;
  const slice = hasMore ? rows.slice(0, limit) : rows;
  const nextCursor = hasMore && slice.length > 0 ? slice[slice.length - 1].sequence : null;

  return {
    sessionId: sessionId.trim(),
    macAddress: normalizedMac,
    cursor,
    nextCursor,
    hasMore,
    messages: slice.map((row) => ({
      id: row.id,
      sessionId: row.session_id,
      sequence: row.sequence,
      role: row.role,
      chatType: roleToChatType(row.role),
      content: row.content || '',
      audioId: row.audio_id || null,
      idempotencyKey: row.idempotency_key,
      createdAt: toISOStringOrNull(row.created_at)
    }))
  };
};

const ensureVoiceSession = async ({ sessionId, normalizedMac, agentId, eventAt }) => {
  await prisma.voice_sessions.upsert({
    where: { session_id: sessionId },
    create: {
      session_id: sessionId,
      mac_address: normalizedMac,
      agent_id: agentId || null,
      status: 'active',
      last_event_at: eventAt,
      metadata: {}
    },
    update: {
      mac_address: normalizedMac,
      agent_id: agentId || null,
      last_event_at: eventAt
    }
  });
};

const buildSessionEpisodeMemoryContent = ({ summary }) => {
  const cleanedSummary = normalizeMemoryText(summary);
  if (!cleanedSummary) return '';
  return `Session summary:\n${cleanedSummary}`;
};

const normalizeMemoryText = (value) => String(value || '')
  .replace(/\r\n/g, '\n')
  .replace(/[ \t]+/g, ' ')
  .replace(/\n{3,}/g, '\n\n')
  .trim();

const truncateMemoryText = (value, maxChars = MAX_ROLLING_SUMMARY_MEMORY_CHARS) => {
  const normalized = normalizeMemoryText(value);
  if (normalized.length <= maxChars) return normalized;

  const truncated = normalized.slice(0, maxChars);
  const lastBreak = truncated.lastIndexOf('\n');
  if (lastBreak > Math.floor(maxChars * 0.75)) {
    return truncated.slice(0, lastBreak).trim();
  }
  return truncated.trim();
};

const formatMemoryList = (items) => {
  const filtered = [...new Set((items || []).filter(Boolean))];
  if (filtered.length === 0) return '';
  if (filtered.length === 1) return filtered[0];
  if (filtered.length === 2) return `${filtered[0]} and ${filtered[1]}`;
  return `${filtered.slice(0, -1).join(', ')}, and ${filtered[filtered.length - 1]}`;
};

const extractChildName = (text) => {
  const candidates = [...String(text || '').matchAll(/\b([A-Z][a-z]+)\b(?=\s+(?:is|likes|loves|enjoys|asks|asked|expects|recently))/g)]
    .map((match) => match[1])
    .filter((name) => !['Cheeko', 'Child', 'After', 'Recent', 'Overall', 'The'].includes(name));
  return candidates[0] || null;
};

const extractChildAge = (text, childName) => {
  const escapedName = childName ? childName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') : '[A-Z][a-z]+';
  const pattern = new RegExp(`\\b${escapedName}\\s+is\\s+(\\d+)\\s+years?\\s+old\\b`, 'i');
  const match = String(text || '').match(pattern);
  return match ? match[1] : null;
};

const addIfMatches = (items, text, pattern, label) => {
  if (pattern.test(text)) items.push(label);
};

const uniqueNonEmptyItems = (items, maxItems = 8) => [...new Set(
  (items || [])
    .map((item) => String(item || '').trim())
    .filter(Boolean)
)].slice(0, maxItems);

const extractMemorySignals = (text) => {
  const normalized = normalizeMemoryText(text);
  const lower = normalized.toLowerCase();
  const interests = [];
  const topics = [];

  addIfMatches(interests, lower, /\bsongs?\b|sing|sings|rhyme/, 'songs');
  addIfMatches(interests, lower, /\bjokes?\b|silly joke|funny/, 'jokes');
  addIfMatches(interests, lower, /\bstor(?:y|ies)\b|\btale\b/, 'short stories');
  addIfMatches(interests, lower, /\bdrawing\b|\bdraw\b/, 'drawing');
  addIfMatches(interests, lower, /playful learning/, 'playful learning');
  addIfMatches(interests, lower, /\bscience\b|experiment|fun facts?/, 'science facts');
  addIfMatches(interests, lower, /\bsports?\b|cricket/, 'sports talk');

  addIfMatches(topics, lower, /\belephants?\b/, 'elephants');
  addIfMatches(topics, lower, /\bzoomy\b|\brocket ship\b|\brocket\b/, 'Zoomy the rocket');
  addIfMatches(topics, lower, /choco-?planet|chocolate planet/, 'chocolate planet');
  addIfMatches(topics, lower, /tomato.*joke|joke.*tomato/, 'tomato jokes');
  addIfMatches(topics, lower, /banana.*joke|joke.*banana/, 'banana jokes');
  addIfMatches(topics, lower, /\bflowers?\b/, 'flowers');
  addIfMatches(topics, lower, /\brobots?\b/, 'robot stories');
  addIfMatches(topics, lower, /\bipl\b|cricket/, 'IPL');
  addIfMatches(topics, lower, /\bscience\b|\bdiamond rain\b/, 'science facts');
  addIfMatches(topics, lower, /deep[- ]sea|ocean creatures?/, 'deep-sea creatures');
  addIfMatches(topics, lower, /\bdinosaurs?\b/, 'dinosaurs');

  return {
    interests: uniqueNonEmptyItems(interests, 8),
    topics: uniqueNonEmptyItems(topics, 10),
    expectsMemory: /remember|remembers|previous conversation|previous conversations|last time/.test(lower)
  };
};

const isControlOrTranscriptLine = (line) => {
  const trimmed = String(line || '').trim().replace(/^-+\s*/, '');
  if (!trimmed) return true;
  return /^Transcript excerpt:$/i.test(trimmed) ||
    /^Session summary:$/i.test(trimmed) ||
    /^\s*(User|Assistant|System|Tool):/i.test(trimmed) ||
    /\[System Event\]/i.test(trimmed) ||
    /successfully connected to the room/i.test(trimmed) ||
    /You must end this conversation now/i.test(trimmed);
};

const stripRollingMemoryNoise = (text) => normalizeMemoryText(text)
  .replace(/^Overall memory:\s*/i, '')
  .replace(/\n?\s*Recent durable context:\s*/gi, '\n')
  .split('\n')
  .reduce((lines, line) => {
    const trimmed = String(line || '').trim();
    const normalized = trimmed.replace(/^-+\s*/, '');
    const isBlockLabel = /^Transcript excerpt:$/i.test(normalized) || /^Session summary:$/i.test(normalized);
    if (isBlockLabel) {
      lines.skipRawBlock = true;
      return lines;
    }
    if (lines.skipRawBlock) {
      if (!trimmed || /^\s*(User|Assistant|System|Tool):/i.test(trimmed) || !trimmed.startsWith('-')) {
        return lines;
      }
      lines.skipRawBlock = false;
    }
    if (!isControlOrTranscriptLine(line)) {
      lines.values.push(line);
    }
    return lines;
  }, { values: [], skipRawBlock: false })
  .values
  .join('\n');

const normalizeMemoryLineKey = (line) => String(line || '')
  .toLowerCase()
  .replace(/^-+\s*/, '')
  .replace(/[^a-z0-9\s]/g, ' ')
  .replace(/\s+/g, ' ')
  .trim();

const parseRollingMemoryBullets = (text) => stripRollingMemoryNoise(text)
  .split('\n')
  .map((line) => line.trim())
  .filter(Boolean)
  .map((line) => (line.startsWith('-') ? line : `- ${line}`));

const isEphemeralRollingLine = (line) => {
  const trimmed = String(line || '').trim();
  return /^\-\s*(?:last|latest|most recent)\s+session\b/i.test(trimmed) ||
    /^\-\s*good follow-up topics\b/i.test(trimmed);
};

const categorizeRollingMemoryLine = (line) => {
  const normalized = String(line || '').trim().toLowerCase().replace(/^-+\s*/, '');
  if (!normalized) return null;
  if (/ is \d+ years old\.$/.test(normalized) || / is the child using this device\.$/.test(normalized)) {
    return 'child_profile';
  }
  if (/ is \d+ years old and likes /.test(normalized)) {
    return 'child_profile';
  }
  if (/ enjoys .* with cheeko\.$/.test(normalized)) {
    return 'interests';
  }
  if (/ expects cheeko to remember previous conversations\.$/.test(normalized)) {
    return 'memory_expectation';
  }
  if (/^recent recurring topics include /.test(normalized)) {
    return 'recurring_topics';
  }
  if (/^last session highlights: /.test(normalized)) {
    return 'last_session';
  }
  if (/^good follow-up topics: /.test(normalized)) {
    return 'follow_up';
  }
  return null;
};

const isNarrativeSessionLine = (line) => {
  const normalized = String(line || '').trim().toLowerCase().replace(/^-+\s*/, '');
  if (!normalized) return false;
  if (/^(after reconnecting|cheeko greets|cheeko greeted|the segment|the session|the call)\b/.test(normalized)) {
    return true;
  }
  if (/\b(the segment ends|the segment concludes|the session ends|the call ends)\b/.test(normalized)) {
    return true;
  }
  return normalized.length > 220 && categorizeRollingMemoryLine(line) === null;
};

const buildRollingOverallMemory = ({ existingMemory, latestSummary }) => {
  const existing = stripRollingMemoryNoise(existingMemory);
  const latest = normalizeMemoryText(latestSummary);
  if (!latest) return truncateMemoryText(existing);

  const combinedInput = normalizeMemoryText(`${existing}\n${latest}`);
  const childName = extractChildName(combinedInput);
  const displayName = childName || 'The child';
  const age = extractChildAge(combinedInput, childName);
  const signals = extractMemorySignals(combinedInput);
  const lines = ['Overall memory:'];
  const seenLineKeys = new Set();
  const generatedCategories = new Set();
  const pushUniqueLine = (line) => {
    const normalizedLine = String(line || '').trim();
    if (!normalizedLine) return;
    const lineWithBullet = normalizedLine.startsWith('-') ? normalizedLine : `- ${normalizedLine}`;
    const key = normalizeMemoryLineKey(lineWithBullet);
    if (!key || seenLineKeys.has(key)) return false;
    seenLineKeys.add(key);
    lines.push(lineWithBullet);
    return true;
  };
  const pushStructuredLine = (line, category) => {
    const added = pushUniqueLine(line);
    if (added && category) generatedCategories.add(category);
    return added;
  };

  if (childName && age) {
    pushStructuredLine(`- ${childName} is ${age} years old.`, 'child_profile');
  } else if (childName) {
    pushStructuredLine(`- ${childName} is the child using this device.`, 'child_profile');
  }

  if (signals.interests.length > 0) {
    pushStructuredLine(`- ${displayName} enjoys ${formatMemoryList(signals.interests)} with Cheeko.`, 'interests');
  }

  if (signals.expectsMemory && childName) {
    pushStructuredLine(`- ${childName} expects Cheeko to remember previous conversations.`, 'memory_expectation');
  } else if (signals.expectsMemory) {
    pushStructuredLine('- The child expects Cheeko to remember previous conversations.', 'memory_expectation');
  }

  if (signals.topics.length > 0) {
    pushStructuredLine(`- Recent recurring topics include ${formatMemoryList(signals.topics)}.`, 'recurring_topics');
  }

  const durableExistingLines = parseRollingMemoryBullets(existing)
    .filter((line) => !isEphemeralRollingLine(line))
    .filter((line) => !isNarrativeSessionLine(line));
  durableExistingLines.forEach((line) => {
    const lineCategory = categorizeRollingMemoryLine(line);
    if (lineCategory && generatedCategories.has(lineCategory)) return;
    pushUniqueLine(line);
  });

  if (lines.length === 1) {
    pushUniqueLine(`- ${truncateMemoryText(latest, 500)}`);
  }

  return truncateMemoryText(lines.join('\n'));
};

const getExistingOverallMemory = async ({ normalizedMac, agentId }) => {
  const existingDocument = await prisma.device_memory_documents.findFirst({
    where: {
      mac_address: normalizedMac,
      document_key: 'summary'
    },
    select: { content: true },
    orderBy: { updated_at: 'desc' }
  });
  if (existingDocument?.content) return existingDocument.content;

  if (agentId) {
    const agent = await prisma.ai_agent.findUnique({
      where: { id: agentId },
      select: { summary_memory: true }
    });
    if (agent?.summary_memory) return agent.summary_memory;
  }

  return '';
};

const saveRollingOverallMemory = async ({
  macAddress,
  latestSummary,
  source,
  sessionId,
  metadata = {},
  agentId
}) => {
  const normalizedMac = normalizeMacAddress(macAddress);
  if (!normalizedMac) throw new Error('Invalid MAC address format');
  if (latestSummary === undefined || latestSummary === null) throw new Error('latestSummary is required');

  const device = agentId
    ? null
    : await prisma.ai_device.findUnique({
      where: { mac_address: normalizedMac },
      select: { agent_id: true }
    });
  const resolvedAgentId = agentId || device?.agent_id || null;
  const existingMemory = await getExistingOverallMemory({ normalizedMac, agentId: resolvedAgentId });
  const rollingMemory = buildRollingOverallMemory({
    existingMemory,
    latestSummary
  });
  const now = new Date();

  let updatedAgent = null;
  if (resolvedAgentId) {
    updatedAgent = await prisma.ai_agent.update({
      where: { id: resolvedAgentId },
      data: {
        summary_memory: rollingMemory,
        updated_at: now
      },
      select: { id: true, agent_name: true, summary_memory: true }
    });
  }

  await saveDeviceMemoryDocument({
    macAddress: normalizedMac,
    documentKey: 'summary',
    memoryType: 'summary',
    content: rollingMemory,
    source,
    sessionId,
    metadata: {
      ...metadata,
      rollingMemory: true,
      latestSummary: normalizeMemoryText(latestSummary)
    }
  });

  return {
    agent: updatedAgent,
    summaryMemory: updatedAgent ? updatedAgent.summary_memory : rollingMemory
  };
};

const consolidateDeviceMemoryForSession = async ({ macAddress, sessionId }) => {
  const normalizedMac = normalizeMacAddress(macAddress);
  if (!normalizedMac) throw new Error('Invalid MAC address format');
  if (!sessionId) throw new Error('sessionId is required');

  const [summaryRecord, messages] = await Promise.all([
    prisma.voice_session_summaries.findUnique({
      where: { session_id: sessionId },
      select: {
        summary: true,
        model: true,
        source_message_count: true
      }
    }),
    prisma.voice_session_messages.findMany({
      where: { session_id: sessionId },
      select: {
        sequence: true,
        role: true,
        content: true
      },
      orderBy: { sequence: 'asc' },
      take: 40
    })
  ]);

  if (!summaryRecord?.summary && (!messages || messages.length === 0)) {
    return {
      consolidated: false,
      reason: 'no_session_memory_inputs',
      documentKeys: []
    };
  }

  const documentKeys = [];
  if (summaryRecord?.summary) {
    await saveRollingOverallMemory({
      macAddress: normalizedMac,
      latestSummary: summaryRecord.summary,
      source: 'session_end_consolidation',
      sessionId,
      metadata: {
        model: summaryRecord.model || null,
        sourceMessageCount: summaryRecord.source_message_count ?? null
      }
    });
    documentKeys.push('summary');
  }

  const episodeKey = `session:${sessionId}`;
  const episodeContent = buildSessionEpisodeMemoryContent({
    summary: summaryRecord?.summary
  });

  if (episodeContent.trim()) {
    await saveDeviceMemoryDocument({
      macAddress: normalizedMac,
      documentKey: episodeKey,
      memoryType: 'episode',
      content: episodeContent,
      source: 'session_end_consolidation',
      sessionId,
      metadata: {
        messageCount: messages ? messages.length : 0,
        summaryModel: summaryRecord?.model || null,
        sourceMessageCount: summaryRecord?.source_message_count ?? null
      }
    });
    documentKeys.push(episodeKey);
  }

  return {
    consolidated: documentKeys.length > 0,
    documentKeys
  };
};

const endVoiceSession = async ({ macAddress, sessionId, status = 'ended', endedAt }) => {
  const normalizedMac = normalizeMacAddress(macAddress);
  if (!normalizedMac) throw new Error('Invalid MAC address format');
  if (!sessionId) throw new Error('sessionId is required');

  const endedAtDate = parseMessageTimestamp(endedAt);

  const session = await prisma.voice_sessions.update({
    where: { session_id: sessionId },
    data: {
      mac_address: normalizedMac,
      status,
      ended_at: endedAtDate,
      last_event_at: endedAtDate
    }
  });

  let memoryConsolidation;
  try {
    memoryConsolidation = await consolidateDeviceMemoryForSession({
      macAddress: normalizedMac,
      sessionId
    });
  } catch (error) {
    logger.error('Failed to consolidate device memory for ended session:', {
      error: error.message,
      mac: normalizedMac,
      sessionId
    });
    memoryConsolidation = {
      consolidated: false,
      reason: 'consolidation_failed',
      error: error.message,
      documentKeys: []
    };
  }

  return {
    ...session,
    memoryConsolidation
  };
};

const saveVoiceSessionSummary = async ({
  macAddress,
  sessionId,
  summary,
  model,
  sourceMessageCount,
  agentId
}) => {
  const normalizedMac = normalizeMacAddress(macAddress);
  if (!normalizedMac) throw new Error('Invalid MAC address format');
  if (!sessionId) throw new Error('sessionId is required');
  if (summary === undefined || summary === null) throw new Error('summary is required');

  const device = await prisma.ai_device.findUnique({
    where: { mac_address: normalizedMac },
    select: { id: true, agent_id: true, kid_id: true }
  });
  if (!device) throw new Error('Device not found');

  const resolvedAgentId = agentId || device.agent_id || null;
  const now = new Date();

  await ensureVoiceSession({
    sessionId,
    normalizedMac,
    agentId: resolvedAgentId,
    eventAt: now
  });

  const summaryRecord = await prisma.voice_session_summaries.upsert({
    where: { session_id: sessionId },
    create: {
      session_id: sessionId,
      mac_address: normalizedMac,
      summary,
      model: model || null,
      source_message_count: sourceMessageCount ?? null,
      created_at: now,
      updated_at: now
    },
    update: {
      mac_address: normalizedMac,
      summary,
      model: model || null,
      source_message_count: sourceMessageCount ?? null,
      updated_at: now
    }
  });

  const savedSummaryLog = {
    macAddress: normalizedMac,
    sessionId,
    agentId: resolvedAgentId,
    summaryChars: typeof summary === 'string' ? summary.length : 0,
    insertedSummary: summaryRecord.summary,
    sourceMessageCount: summaryRecord.source_message_count ?? null,
    model: summaryRecord.model || null,
    recordUpdatedAt: summaryRecord.updated_at
  };
  logger.info(`[VOICE-SESSION] Saved session summary record ${JSON.stringify(savedSummaryLog)}`);

  const rollingMemory = await saveRollingOverallMemory({
    macAddress: normalizedMac,
    latestSummary: summary,
    source: 'rolling_session_summary',
    sessionId,
    agentId: resolvedAgentId,
    metadata: {
      model: model || null,
      sourceMessageCount: sourceMessageCount ?? null
    }
  });

  const rollingSummaryLog = {
    macAddress: normalizedMac,
    sessionId,
    agentId: resolvedAgentId,
    summaryMemoryChars: rollingMemory?.summaryMemory ? rollingMemory.summaryMemory.length : 0,
    insertedSummaryMemory: rollingMemory?.summaryMemory || null
  };
  logger.info(`[VOICE-SESSION] Updated rolling agent summary memory ${JSON.stringify(rollingSummaryLog)}`);

  return {
    sessionId,
    macAddress: normalizedMac,
    agentId: resolvedAgentId,
    summaryMemory: rollingMemory.summaryMemory
  };
};

const saveDeviceWorkspaceArtifact = async ({
  macAddress,
  sessionId,
  relativePath,
  content,
  contentType = 'text/plain',
  metadata = {}
}) => {
  const normalizedMac = normalizeMacAddress(macAddress);
  if (!normalizedMac) throw new Error('Invalid MAC address format');

  const normalizedPath = normalizeWorkspaceRelativePath(relativePath);
  if (typeof content !== 'string') throw new Error('content is required');

  const sizeBytes = Buffer.byteLength(content, 'utf8');
  if (sizeBytes > MAX_WORKSPACE_ARTIFACT_BYTES) {
    throw new Error(`artifact exceeds ${MAX_WORKSPACE_ARTIFACT_BYTES} byte limit`);
  }

  const device = await prisma.ai_device.findUnique({
    where: { mac_address: normalizedMac },
    select: { id: true, agent_id: true }
  });
  if (!device) throw new Error('Device not found');

  const now = new Date();
  const sha256 = crypto.createHash('sha256').update(content, 'utf8').digest('hex');
  const artifact = await prisma.device_workspace_artifacts.upsert({
    where: {
      mac_address_relative_path: {
        mac_address: normalizedMac,
        relative_path: normalizedPath
      }
    },
    create: {
      mac_address: normalizedMac,
      device_id: device.id,
      agent_id: device.agent_id || null,
      session_id: sessionId || null,
      relative_path: normalizedPath,
      content,
      content_type: contentType || 'text/plain',
      size_bytes: sizeBytes,
      sha256,
      metadata: metadata || {},
      created_at: now,
      updated_at: now
    },
    update: {
      device_id: device.id,
      agent_id: device.agent_id || null,
      session_id: sessionId || null,
      content,
      content_type: contentType || 'text/plain',
      size_bytes: sizeBytes,
      sha256,
      metadata: metadata || {},
      updated_at: now
    }
  });

  return artifactToDTO(artifact);
};

const listDeviceWorkspaceArtifacts = async (macAddress, options = {}) => {
  const normalizedMac = normalizeMacAddress(macAddress);
  if (!normalizedMac) throw new Error('Invalid MAC address format');

  const includeContent = options.includeContent === true || options.includeContent === 'true' || options.includeContent === '1';
  const limit = clampLimit(options.limit, 50, 100);
  const artifacts = await prisma.device_workspace_artifacts.findMany({
    where: { mac_address: normalizedMac },
    orderBy: { updated_at: 'desc' },
    take: limit,
    select: {
      id: true,
      mac_address: true,
      device_id: true,
      agent_id: true,
      session_id: true,
      relative_path: true,
      content_type: true,
      ...(includeContent ? { content: true } : {}),
      size_bytes: true,
      sha256: true,
      metadata: true,
      created_at: true,
      updated_at: true
    }
  });

  return artifacts.map(artifactToDTO);
};

const getDeviceWorkspaceArtifact = async (macAddress, relativePath) => {
  const normalizedMac = normalizeMacAddress(macAddress);
  if (!normalizedMac) throw new Error('Invalid MAC address format');

  const normalizedPath = normalizeWorkspaceRelativePath(relativePath);
  const artifact = await prisma.device_workspace_artifacts.findUnique({
    where: {
      mac_address_relative_path: {
        mac_address: normalizedMac,
        relative_path: normalizedPath
      }
    }
  });
  if (!artifact) throw new Error('Artifact not found');
  return artifactToDTO(artifact);
};

const saveDeviceMemoryDocument = async ({
  macAddress,
  documentKey,
  memoryType = 'general',
  memoryDate,
  content,
  source = 'manager_api',
  sessionId,
  metadata = {}
}) => {
  const normalizedMac = normalizeMacAddress(macAddress);
  if (!normalizedMac) throw new Error('Invalid MAC address format');
  const normalizedKey = normalizeMemoryDocumentKey(documentKey);
  if (typeof content !== 'string') throw new Error('content is required');

  const sizeBytes = Buffer.byteLength(content, 'utf8');
  if (sizeBytes > MAX_DEVICE_MEMORY_DOCUMENT_BYTES) {
    throw new Error(`memory document exceeds ${MAX_DEVICE_MEMORY_DOCUMENT_BYTES} byte limit`);
  }

  const device = await prisma.ai_device.findUnique({
    where: { mac_address: normalizedMac },
    select: { id: true, agent_id: true, kid_id: true }
  });
  if (!device) throw new Error('Device not found');

  const now = new Date();
  const parsedMemoryDate = parseMemoryDate(memoryDate);
  const document = await prisma.device_memory_documents.upsert({
    where: {
      mac_address_document_key: {
        mac_address: normalizedMac,
        document_key: normalizedKey
      }
    },
    create: {
      mac_address: normalizedMac,
      device_id: device.id,
      agent_id: device.agent_id || null,
      kid_id: device.kid_id || null,
      document_key: normalizedKey,
      memory_type: memoryType || 'general',
      memory_date: parsedMemoryDate,
      content,
      source: source || 'manager_api',
      session_id: sessionId || null,
      metadata: metadata || {},
      created_at: now,
      updated_at: now
    },
    update: {
      device_id: device.id,
      agent_id: device.agent_id || null,
      kid_id: device.kid_id || null,
      memory_type: memoryType || 'general',
      memory_date: parsedMemoryDate,
      content,
      source: source || 'manager_api',
      session_id: sessionId || null,
      metadata: metadata || {},
      updated_at: now
    }
  });

  await prisma.device_memory_chunks.deleteMany({
    where: { document_id: document.id }
  });

  const trimmedContent = content.trim();
  if (trimmedContent) {
    await prisma.device_memory_chunks.createMany({
      data: [
        {
          document_id: document.id,
          mac_address: normalizedMac,
          device_id: device.id,
          agent_id: device.agent_id || null,
          kid_id: device.kid_id || null,
          content: trimmedContent,
          content_hash: crypto.createHash('sha256').update(trimmedContent, 'utf8').digest('hex'),
          category: memoryType || 'general'
        }
      ],
      skipDuplicates: true
    });
  }

  return memoryDocumentToDTO(document);
};

const listDeviceMemoryDocuments = async (macAddress, options = {}) => {
  const normalizedMac = normalizeMacAddress(macAddress);
  if (!normalizedMac) throw new Error('Invalid MAC address format');

  const limit = clampLimit(options.limit, 20, 100);
  const memoryType = options.memoryType || options.type;
  const documents = await prisma.device_memory_documents.findMany({
    where: {
      mac_address: normalizedMac,
      ...(memoryType ? { memory_type: memoryType } : {})
    },
    orderBy: { updated_at: 'desc' },
    take: limit
  });

  return (documents || []).map(memoryDocumentToDTO);
};

const getNextVoiceMessageSequence = async (sessionId) => {
  const latest = await prisma.voice_session_messages.findFirst({
    where: { session_id: sessionId },
    select: { sequence: true },
    orderBy: { sequence: 'desc' }
  });

  return (latest?.sequence || 0) + 1;
};

const isVoiceMessageSequenceConflict = (error) => {
  if (!error) return false;

  const target = error.meta?.target || [];
  if (error.code === 'P2002') {
    if (Array.isArray(target) && target.includes('session_id') && target.includes('sequence')) {
      return true;
    }
    if (typeof target === 'string' && target.includes('session_id') && target.includes('sequence')) {
      return true;
    }
  }

  const message = String(error.message || '');
  return message.includes('Unique constraint failed') &&
    message.includes('session_id') &&
    message.includes('sequence');
};

const createVoiceMessageWithRetry = async (data, explicitSequence, explicitIdempotencyKey) => {
  let nextData = data;

  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await prisma.voice_session_messages.create({ data: nextData });
    } catch (error) {
      if (explicitSequence || explicitIdempotencyKey || !isVoiceMessageSequenceConflict(error) || attempt === 2) {
        throw error;
      }

      const latestSequence = await getNextVoiceMessageSequence(nextData.session_id);
      const retrySequence = Math.max(latestSequence, nextData.sequence + 1);
      nextData = {
        ...nextData,
        sequence: retrySequence,
        idempotency_key: `${nextData.session_id}:${retrySequence}`
      };
    }
  }

  return prisma.voice_session_messages.create({ data: nextData });
};

const createVoiceSessionMessage = async ({
  normalizedMac,
  agentId,
  sessionId,
  chatType,
  content,
  audioId,
  timestamp,
  sequence,
  idempotencyKey,
  providerMessage
}) => {
  const createdAt = parseMessageTimestamp(timestamp);
  const messageSequence = sequence || await getNextVoiceMessageSequence(sessionId);

  await ensureVoiceSession({
    sessionId,
    normalizedMac,
    agentId,
    eventAt: createdAt
  });

  const message = await createVoiceMessageWithRetry({
    session_id: sessionId,
    mac_address: normalizedMac,
    agent_id: agentId || null,
    sequence: messageSequence,
    role: chatTypeToRole(chatType),
    content,
    provider_message: providerMessage || null,
    audio_id: audioId || null,
    created_at: createdAt,
    idempotency_key: idempotencyKey || `${sessionId}:${messageSequence}`
  }, sequence !== undefined && sequence !== null, Boolean(idempotencyKey));

  return {
    ...message,
    mac_address: normalizedMac,
    agent_id: agentId || null,
    session_id: sessionId,
    chat_type: chatType,
    content,
    audio_id: audioId || null
  };
};

/**
 * Add chat message to history
 * @param {Object} data - Message data
 * @returns {Promise<Object>} Created message
 */
const addChatMessage = async ({ macAddress, agentId, sessionId, chatType, content, audioId }) => {
  const normalizedMac = normalizeMacAddress(macAddress);

  const message = await createVoiceSessionMessage({
    normalizedMac,
    agentId,
    sessionId,
    chatType,
    content,
    audioId
  });

  return message;
};

/**
 * Get agent prompt by device MAC
 * @param {string} mac - Device MAC address
 * @returns {Promise<Object>} Agent prompt config
 */
const getPromptByMac = async (mac) => {
  const normalizedMac = normalizeMacAddress(mac);

  const device = await prisma.ai_device.findUnique({
    where: { mac_address: normalizedMac },
    select: { agent_id: true },
  });

  if (!device || !device.agent_id) {
    throw new Error('Device or agent not found');
  }

  const agent = await prisma.ai_agent.findUnique({
    where: { id: device.agent_id },
  });

  if (!agent) {
    throw new Error('Agent not found');
  }

  return {
    agentId: agent.id,
    agentName: agent.agent_name,
    systemPrompt: agent.system_prompt,
    asrModelId: agent.asr_model_id,
    vadModelId: agent.vad_model_id,
    llmModelId: agent.llm_model_id,
    ttsModelId: agent.tts_model_id,
    ttsVoiceId: agent.tts_voice_id,
    memModelId: agent.mem_model_id,
    langCode: agent.lang_code,
    language: agent.language,
    chatHistoryConf: agent.chat_history_conf
  };
};

/**
 * Get agent ID by device MAC
 * @param {string} mac - Device MAC address
 * @returns {Promise<string>} Agent ID
 */
const getAgentIdByMac = async (mac) => {
  const normalizedMac = normalizeMacAddress(mac);
  const device = await prisma.ai_device.findUnique({
    where: { mac_address: normalizedMac },
    select: { agent_id: true },
  });
  if (!device) throw new Error('Device not found');
  return device.agent_id;
};

/**
 * Cycle character (agent) for device
 * @param {string} mac - Device MAC address
 * @returns {Promise<Object>} New agent info
 */
const cycleCharacter = async (mac) => {
  const normalizedMac = normalizeMacAddress(mac);

  const device = await prisma.ai_device.findUnique({
    where: { mac_address: normalizedMac },
    select: { id: true, user_id: true, agent_id: true },
  });

  if (!device) throw new Error('Device not found');

  const agents = await prisma.ai_agent.findMany({
    where: { user_id: device.user_id },
    select: { id: true, agent_name: true, runtime_agent_name: true, system_prompt: true, soul: true, language: true },
    orderBy: { sort: 'asc' },
  });

  if (!agents || agents.length === 0) {
    throw new Error('No agents available');
  }

  const currentIndex = agents.findIndex(a => a.id === device.agent_id);
  const nextIndex = (currentIndex + 1) % agents.length;
  const nextAgent = agents[nextIndex];

  await prisma.ai_device.update({
    where: { id: device.id },
    data: { agent_id: nextAgent.id },
  });

  return {
    agentId: nextAgent.id,
    agentName: nextAgent.agent_name,
    previousAgentId: device.agent_id,
    ...resolveSessionForCharacter(await mergeTemplatePersona(nextAgent)),
  };
};

/**
 * Set character (agent) for device
 * @param {string} mac - Device MAC address
 * @param {string} agentId - Agent ID to set
 * @returns {Promise<Object>} Agent info
 */
const setCharacter = async (mac, agentId) => {
  const normalizedMac = normalizeMacAddress(mac);

  const agent = await prisma.ai_agent.findUnique({
    where: { id: agentId },
    select: { id: true, agent_name: true },
  });

  if (!agent) throw new Error('Agent not found');

  await prisma.ai_device.update({
    where: { mac_address: normalizedMac },
    data: { agent_id: agentId },
  });

  return {
    agentId: agent.id,
    agentName: agent.agent_name
  };
};

/**
 * Set character (agent) for device by name
 * @param {string} mac - Device MAC address
 * @param {string} characterName - Agent name to set
 * @returns {Promise<Object>} Agent info
 */
const setCharacterByName = async (mac, characterName, { language, persist = true } = {}) => {
  const normalizedMac = normalizeMacAddress(mac);

  const device = await prisma.ai_device.findUnique({
    where: { mac_address: normalizedMac },
    select: { id: true, user_id: true },
  });
  if (!device) throw new Error('Device not found');

  // Find existing agent by name (case-insensitive) for this user
  let agent = await prisma.ai_agent.findFirst({
    where: { user_id: device.user_id, agent_name: { equals: characterName, mode: 'insensitive' } },
    select: { id: true, agent_name: true, runtime_agent_name: true, system_prompt: true, soul: true, language: true },
  });

  if (!agent) {
    // Look up template by character name to copy full config
    const template = await prisma.ai_agent_template.findFirst({
      where: { agent_name: { equals: characterName, mode: 'insensitive' } },
    });

    if (template) {
      logger.info(`[setCharacterByName] Found template for "${characterName}", applying to new agent`);
    } else {
      logger.warn(`[setCharacterByName] No template found for "${characterName}", creating minimal agent`);
    }

    agent = await prisma.ai_agent.create({
      data: {
        user_id: device.user_id,
        agent_name: characterName,
        lang_code: template?.lang_code ?? 'en',
        language: template?.language ?? 'English',
        creator: device.user_id,
        ...(template && {
          agent_code: template.agent_code,
          asr_model_id: template.asr_model_id,
          vad_model_id: template.vad_model_id,
          llm_model_id: template.llm_model_id,
          vllm_model_id: template.vllm_model_id,
          tts_model_id: template.tts_model_id,
          tts_voice_id: template.tts_voice_id,
          mem_model_id: template.mem_model_id,
          intent_model_id: template.intent_model_id,
          chat_history_conf: template.chat_history_conf,
          system_prompt: template.system_prompt,
          soul: template.soul,
          runtime_agent_name: template.runtime_agent_name,
          summary_memory: template.summary_memory,
        }),
      },
      select: { id: true, agent_name: true, runtime_agent_name: true, system_prompt: true, soul: true, language: true },
    });
    logger.info(`[setCharacterByName] Auto-created agent "${characterName}" for user ${device.user_id}`);
  }

  // Optional per-card/session language: persist it on the agent so the contract carries it.
  if (language && language !== agent.language) {
    await prisma.ai_agent.update({ where: { id: agent.id }, data: { language } });
    agent.language = language;
  }

  // Session-scoped switches (e.g. RFID card taps) skip persisting the device's
  // default agent — the character applies only to the dispatched session.
  if (persist) {
    await prisma.ai_device.update({ where: { id: device.id }, data: { agent_id: agent.id } });
  }

  logger.info(`[setCharacterByName] Device ${normalizedMac} -> agent: ${agent.agent_name} (persist=${persist})`);
  // Full routing+persona contract (template-sourced) so the gateway dispatches to the right
  // worker with characterId + language, and the worker pulls the right persona.
  return {
    agentId: agent.id,
    agentName: agent.agent_name,
    ...resolveSessionForCharacter(await mergeTemplatePersona(agent), { language }),
  };
};

/**
 * Get current character for device
 * @param {string} mac - Device MAC address
 * @returns {Promise<Object>} Current agent info
 */
const getCurrentCharacter = async (mac) => {
  const normalizedMac = normalizeMacAddress(mac);
  logger.info(`[getCurrentCharacter] Looking up device: ${mac} -> normalized: ${normalizedMac}`);

  const device = await prisma.ai_device.findUnique({
    where: { mac_address: normalizedMac },
    select: { id: true, mac_address: true, agent_id: true },
  });

  if (!device) {
    logger.info(`[getCurrentCharacter] Device not found for MAC: ${normalizedMac}`);
    throw new Error('Device not found');
  }

  logger.info(`[getCurrentCharacter] Device found: id=${device.id}, agent_id=${device.agent_id}`);

  if (!device.agent_id) {
    logger.info(`[getCurrentCharacter] Device has no agent assigned`);
    return { agentId: null, agentName: null, agentCode: null };
  }

  const agent = await prisma.ai_agent.findUnique({
    where: { id: device.agent_id },
    select: {
      id: true,
      agent_name: true,
      agent_code: true,
      runtime_agent_name: true,
      system_prompt: true,
      soul: true,
      language: true,
    },
  });

  if (!agent) {
    logger.info(`[getCurrentCharacter] Agent not found: ${device.agent_id}`);
    return { agentId: device.agent_id, agentName: null, agentCode: null };
  }

  logger.info(`[getCurrentCharacter] Agent found: ${agent.agent_name}`);
  // Additive: keep legacy agentId/agentName/agentCode; add the worker session contract
  // (characterId, characterName, runtimeAgentName, language, systemPrompt, soul).
  return {
    agentId: agent.id,
    agentName: agent.agent_name,
    agentCode: agent.agent_code,
    ...resolveSessionForCharacter(await mergeTemplatePersona(agent)),
  };
};

/**
 * Persona (system_prompt + soul) is character-level, not per-instance. Source it from the
 * shared ai_agent_template (matched by agent_name, the same link setCharacterByName uses) so
 * the prompt is edited in ONE place for every device. Falls back to the instance's own fields
 * when no template exists. Single source of persona for ALL contract paths (worker pull +
 * current-character). Routing (runtime_agent_name): instance override wins, then template.
 * @param {{agent_name: string, system_prompt?: string|null, soul?: string|null, runtime_agent_name?: string|null}} agent
 */
const mergeTemplatePersona = async (agent) => {
  const template = await prisma.ai_agent_template.findFirst({
    where: { agent_name: { equals: agent.agent_name, mode: 'insensitive' } },
    select: { system_prompt: true, soul: true, runtime_agent_name: true },
  });
  return {
    ...agent,
    system_prompt: template?.system_prompt ?? agent.system_prompt,
    soul: template?.soul ?? agent.soul,
    runtime_agent_name: agent.runtime_agent_name ?? template?.runtime_agent_name ?? null,
  };
};

/**
 * Worker-facing: resolve the persona session contract for a Character by id.
 * Used by the picoclaw-livekit worker to PULL persona on every session start
 * (ADR-0003). Returns { characterId, characterName, runtimeAgentName, language,
 * systemPrompt, soul } via the shared resolver — no hashes.
 * @param {string} characterId - ai_agent.id
 * @param {{language?: string}} [opts] - optional language override
 */
const getCharacterSession = async (characterId, { language } = {}) => {
  const agent = await prisma.ai_agent.findUnique({
    where: { id: characterId },
    select: {
      id: true,
      agent_name: true,
      runtime_agent_name: true,
      system_prompt: true,
      soul: true,
      language: true,
    },
  });

  if (!agent) {
    throw new Error('Character not found');
  }

  return resolveSessionForCharacter(await mergeTemplatePersona(agent), { language });
};

/**
 * Worker-facing: resolve the persona session contract for a Character by NAME,
 * straight from ai_agent_template (no ai_agent row, no device binding). The
 * gateway puts the character name in room metadata and the worker pulls the
 * persona by that name — template is the single source. Falls back nowhere:
 * unknown name -> 404 (worker keeps last-rendered).
 * @param {string} characterName
 * @param {{language?: string}} [opts]
 */
const getCharacterSessionByName = async (characterName, { language } = {}) => {
  const template = await prisma.ai_agent_template.findFirst({
    where: { agent_name: { equals: characterName, mode: 'insensitive' } },
    select: { id: true, agent_name: true, runtime_agent_name: true, system_prompt: true, soul: true, language: true },
  });
  if (!template) throw new Error('Character not found');
  return resolveSessionForCharacter(
    {
      id: null, // template-only; no per-device ai_agent instance
      agent_name: template.agent_name,
      runtime_agent_name: template.runtime_agent_name,
      system_prompt: template.system_prompt,
      soul: template.soul,
      language: template.language,
    },
    { language }
  );
};

/**
 * Get memories for a device (for personalization)
 * @param {string} mac - Device MAC address
 * @param {Object} [options] - Options
 * @param {string} [options.query] - Custom search query
 * @param {number} [options.limit] - Max memories to return
 * @returns {Promise<Object>} Memory data with memories, relations, entities
 */
const getMemoriesByMac = async (mac, options = {}) => {
  const normalizedMac = normalizeMacAddress(mac);

  try {
    if (prisma.device_memory_documents) {
      const documents = await listDeviceMemoryDocuments(normalizedMac, {
        limit: options.limit,
        memoryType: options.memoryType
      });
      if (documents.length > 0 || !mem0Service.isAvailable()) {
        return {
          memories: documents.map((document) => ({
            id: document.id,
            memory: document.content,
            content: document.content,
            documentKey: document.documentKey,
            memoryType: document.memoryType,
            source: document.source,
            sessionId: document.sessionId,
            updatedAt: document.updatedAt
          })),
          relations: [],
          entities: [],
          source: 'postgres'
        };
      }
    }
  } catch (error) {
    logger.error('Failed to get Postgres memories by MAC:', { error: error.message, mac: normalizedMac });
  }

  if (!mem0Service.isAvailable()) {
    logger.debug('Mem0 not configured, returning empty memories');
    return { memories: [], relations: [], entities: [] };
  }

  try {
    const result = await mem0Service.searchMemories({
      userId: normalizedMac,
      query: options.query,
      limit: options.limit
    });

    return result;
  } catch (error) {
    logger.error('Failed to get memories by MAC:', { error: error.message, mac: normalizedMac });
    return { memories: [], relations: [], entities: [] };
  }
};

/**
 * Add conversation to memory for a device
 * @param {string} mac - Device MAC address
 * @param {Array} chatHistory - Array of {chatType: 1|2, content: string}
 * @param {string} [sessionId] - Session identifier
 * @returns {Promise<boolean>} True if successful
 */
const addConversationToMemory = async (mac, chatHistory, sessionId = null) => {
  const normalizedMac = normalizeMacAddress(mac);

  if (!mem0Service.isAvailable()) {
    logger.debug('Mem0 not configured, skipping memory storage');
    return false;
  }

  if (!chatHistory || chatHistory.length === 0) {
    return false;
  }

  try {
    const result = await mem0Service.addConversation({
      userId: normalizedMac,
      chatHistory,
      sessionId
    });

    return result !== null;
  } catch (error) {
    logger.error('Failed to add conversation to memory:', { error: error.message, mac: normalizedMac });
    return false;
  }
};

/**
 * Add a fact to memory for a device
 * @param {string} mac - Device MAC address
 * @param {string} fact - The fact to store
 * @returns {Promise<boolean>} True if successful
 */
const addFactToMemory = async (mac, fact) => {
  const normalizedMac = normalizeMacAddress(mac);

  if (!mem0Service.isAvailable()) {
    logger.debug('Mem0 not configured, skipping fact storage');
    return false;
  }

  if (!fact) {
    return false;
  }

  try {
    const result = await mem0Service.addFact({
      userId: normalizedMac,
      fact
    });

    return result !== null;
  } catch (error) {
    logger.error('Failed to add fact to memory:', { error: error.message, mac: normalizedMac });
    return false;
  }
};

/**
 * Get agent prompt with memories included
 * @param {string} mac - Device MAC address
 * @param {Object} [options] - Options
 * @param {boolean} [options.includeMemories=true] - Include memories in response
 * @returns {Promise<Object>} Agent prompt config with optional memories
 */
const getPromptWithMemories = async (mac, options = { includeMemories: true }) => {
  const promptConfig = await getPromptByMac(mac);

  if (!options.includeMemories || !mem0Service.isAvailable()) {
    return promptConfig;
  }

  try {
    const normalizedMac = normalizeMacAddress(mac);
    const memoryData = await mem0Service.searchMemories({
      userId: normalizedMac
    });

    // Format memories for prompt injection
    const memoriesText = mem0Service.formatForPrompt(memoryData);

    return {
      ...promptConfig,
      memories: memoryData,
      memoriesText
    };
  } catch (error) {
    logger.error('Failed to get memories for prompt:', { error: error.message, mac });
    return promptConfig;
  }
};

/**
 * Build manager-backed bootstrap context for LiveKit fallback/debug hydration.
 * Room metadata should remain the primary worker startup source.
 * @param {string} mac - Device MAC address
 * @param {Object} [options] - Bootstrap options
 * @param {boolean} [options.includeMemories=true] - Include Mem0 memories when configured
 * @param {number} [options.recentLimit=20] - Recent chat-history messages to include
 * @param {number} [options.memoryLimit] - Memory search limit
 * @returns {Promise<Object>} Bootstrap context
 */
const getDeviceBootstrap = async (mac, options = {}) => {
  const normalizedMac = normalizeMacAddress(mac);
  if (!normalizedMac) {
    throw new Error('Invalid MAC address');
  }

  const recentLimit = clampLimit(options.recentLimit, 20, 100);
  const includeMemories = options.includeMemories !== false;

  const device = await prisma.ai_device.findUnique({
    where: { mac_address: normalizedMac },
    select: {
      id: true,
      user_id: true,
      mac_address: true,
      agent_id: true,
      kid_id: true,
      mode: true,
      device_mode: true,
      app_version: true,
      last_connected_at: true
    }
  });

  if (!device) {
    throw new Error('Device not found');
  }

  if (!device.agent_id) {
    throw new Error('Device has no agent assigned');
  }

  const recentMessagesPromise = recentLimit > 0
    ? prisma.voice_session_messages.findMany({
      where: {
        mac_address: normalizedMac,
        agent_id: device.agent_id
      },
      select: {
        id: true,
        session_id: true,
        role: true,
        content: true,
        audio_id: true,
        created_at: true
      },
      orderBy: { created_at: 'desc' },
      take: recentLimit
    })
    : Promise.resolve([]);

  const recentSessionsPromise = recentLimit > 0
    ? prisma.voice_sessions.findMany({
      where: {
        mac_address: normalizedMac,
        agent_id: device.agent_id
      },
      select: {
        session_id: true,
        status: true,
        started_at: true,
        ended_at: true,
        last_event_at: true,
        _count: {
          select: { voice_session_messages: true }
        }
      },
      orderBy: { started_at: 'desc' },
      take: recentLimit
    })
    : Promise.resolve([]);

  const sessionSummariesPromise = recentLimit > 0
    ? prisma.voice_session_summaries.findMany({
      where: {
        mac_address: normalizedMac,
        voice_sessions: {
          agent_id: device.agent_id
        }
      },
      select: {
        session_id: true,
        summary: true,
        model: true,
        source_message_count: true,
        updated_at: true,
        voice_sessions: {
          select: {
            started_at: true,
            ended_at: true,
            status: true
          }
        }
      },
      orderBy: { updated_at: 'desc' },
      take: recentLimit
    })
    : Promise.resolve([]);

  const childProfilePromise = device.kid_id
    ? prisma.kid_profile.findUnique({
      where: { id: BigInt(device.kid_id) },
      select: {
        id: true,
        user_id: true,
        name: true,
        nickname: true,
        avatar_url: true,
        birth_date: true,
        gender: true,
        grade: true,
        school: true,
        interests: true,
        language: true,
        timezone: true,
        preferences: true
      }
    })
    : Promise.resolve(null);

  const memoryPromise = includeMemories
    ? getMemoriesByMac(normalizedMac, { limit: options.memoryLimit })
    : Promise.resolve(emptyMemoryPayload());

  const [agent, childProfile, recentMessages, recentSessions, sessionSummaries, memories] = await Promise.all([
    prisma.ai_agent.findUnique({
      where: { id: device.agent_id },
      select: {
        id: true,
        user_id: true,
        agent_code: true,
        agent_name: true,
        asr_model_id: true,
        vad_model_id: true,
        llm_model_id: true,
        vllm_model_id: true,
        tts_model_id: true,
        tts_voice_id: true,
        mem_model_id: true,
        intent_model_id: true,
        chat_history_conf: true,
        system_prompt: true,
        summary_memory: true,
        lang_code: true,
        language: true
      }
    }),
    childProfilePromise,
    recentMessagesPromise,
    recentSessionsPromise,
    sessionSummariesPromise,
    memoryPromise
  ]);

  if (!agent) {
    throw new Error('Agent not found');
  }

  return {
    bootstrapSource: 'manager_api_fallback',
    device: {
      id: device.id,
      userId: toStringOrNull(device.user_id),
      macAddress: device.mac_address,
      agentId: device.agent_id,
      kidId: toStringOrNull(device.kid_id),
      mode: device.mode,
      deviceMode: device.device_mode,
      appVersion: device.app_version,
      lastConnectedAt: toISOStringOrNull(device.last_connected_at)
    },
    agent: {
      agentId: agent.id,
      userId: toStringOrNull(agent.user_id),
      agentCode: agent.agent_code,
      agentName: agent.agent_name,
      asrModelId: agent.asr_model_id,
      vadModelId: agent.vad_model_id,
      llmModelId: agent.llm_model_id,
      vllmModelId: agent.vllm_model_id,
      ttsModelId: agent.tts_model_id,
      ttsVoiceId: agent.tts_voice_id,
      memModelId: agent.mem_model_id,
      intentModelId: agent.intent_model_id,
      chatHistoryConf: agent.chat_history_conf,
      systemPrompt: agent.system_prompt,
      summaryMemory: agent.summary_memory,
      langCode: agent.lang_code,
      language: agent.language
    },
    childProfile: childProfile ? {
      id: toStringOrNull(childProfile.id),
      userId: toStringOrNull(childProfile.user_id),
      name: childProfile.name,
      nickname: childProfile.nickname,
      avatarUrl: childProfile.avatar_url,
      birthDate: toISOStringOrNull(childProfile.birth_date),
      gender: childProfile.gender,
      grade: childProfile.grade,
      school: childProfile.school,
      interests: childProfile.interests || [],
      language: childProfile.language,
      timezone: childProfile.timezone,
      preferences: childProfile.preferences || {}
    } : null,
    recentMessages: [...recentMessages].reverse().map((message) => ({
      id: message.id,
      sessionId: message.session_id,
      role: message.role,
      chatType: roleToChatType(message.role),
      content: message.content,
      audioId: message.audio_id,
      createdAt: toISOStringOrNull(message.created_at)
    })),
    recentSessions: recentSessions.map((session) => ({
      sessionId: session.session_id,
      status: session.status,
      startedAt: toISOStringOrNull(session.started_at),
      endedAt: toISOStringOrNull(session.ended_at),
      lastEventAt: toISOStringOrNull(session.last_event_at),
      messageCount: session._count?.voice_session_messages || 0
    })),
    sessionSummaries: sessionSummaries.map((summary) => ({
      sessionId: summary.session_id,
      summary: summary.summary,
      model: summary.model,
      sourceMessageCount: summary.source_message_count,
      updatedAt: toISOStringOrNull(summary.updated_at),
      startedAt: toISOStringOrNull(summary.voice_sessions?.started_at),
      endedAt: toISOStringOrNull(summary.voice_sessions?.ended_at),
      status: summary.voice_sessions?.status || null
    })),
    memories: memories || emptyMemoryPayload(),
    generatedAt: new Date().toISOString()
  };
};

/**
 * Clear all memories for a device
 * @param {string} mac - Device MAC address
 * @returns {Promise<boolean>} True if successful
 */
const clearMemoriesByMac = async (mac) => {
  const normalizedMac = normalizeMacAddress(mac);

  if (!mem0Service.isAvailable()) {
    return false;
  }

  try {
    return await mem0Service.deleteAllMemories({
      userId: normalizedMac
    });
  } catch (error) {
    logger.error('Failed to clear memories:', { error: error.message, mac: normalizedMac });
    return false;
  }
};

// =============================================
// Agent Memory and Mode Methods
// =============================================

/**
 * Save/update agent summary memory by device MAC
 * Used by LiveKit workers to persist conversation summary
 * @param {string} mac - Device MAC address
 * @param {string} summaryMemory - Summary memory content to save
 * @returns {Promise<Object>} Updated agent info
 */
const saveMemory = async (mac, summaryMemory) => {
  const normalizedMac = normalizeMacAddress(mac);

  const device = await prisma.ai_device.findUnique({
    where: { mac_address: normalizedMac },
    select: { agent_id: true },
  });

  if (!device || !device.agent_id) {
    throw new Error('Device or agent not found');
  }

  const rollingMemory = await saveRollingOverallMemory({
    macAddress: normalizedMac,
    latestSummary: summaryMemory,
    source: 'save_memory',
    agentId: device.agent_id
  });

  const agent = rollingMemory.agent;

  return {
    agentId: agent ? agent.id : device.agent_id,
    agentName: agent ? agent.agent_name : null,
    summaryMemory: rollingMemory.summaryMemory
  };
};

/**
 * Update agent mode from template
 * Copies template settings to agent while optionally preserving some fields
 * @param {Object} data - Update data
 * @param {string} data.macAddress - Device MAC address
 * @param {string} data.templateId - Template ID to apply
 * @param {boolean} [data.preserveMemory=true] - Keep existing summary_memory
 * @returns {Promise<Object>} Updated agent
 */
const updateModeFromTemplate = async (data) => {
  const { macAddress, templateId, preserveMemory = true } = data;
  const normalizedMac = normalizeMacAddress(macAddress);

  const device = await prisma.ai_device.findUnique({
    where: { mac_address: normalizedMac },
    select: { agent_id: true },
  });

  if (!device || !device.agent_id) {
    throw new Error('Device or agent not found');
  }

  const template = await prisma.ai_agent_template.findUnique({
    where: { id: templateId },
  });

  if (!template) {
    throw new Error('Template not found');
  }

  const updateData = {
    agent_code: template.agent_code,
    agent_name: template.agent_name,
    asr_model_id: template.asr_model_id,
    vad_model_id: template.vad_model_id,
    llm_model_id: template.llm_model_id,
    vllm_model_id: template.vllm_model_id,
    tts_model_id: template.tts_model_id,
    tts_voice_id: template.tts_voice_id,
    mem_model_id: template.mem_model_id,
    intent_model_id: template.intent_model_id,
    chat_history_conf: template.chat_history_conf,
    system_prompt: template.system_prompt,
    lang_code: template.lang_code,
    language: template.language,
    updated_at: new Date(),
  };

  if (!preserveMemory) {
    updateData.summary_memory = template.summary_memory;
  }

  const agent = await prisma.ai_agent.update({
    where: { id: device.agent_id },
    data: updateData,
  });

  return agent;
};

/**
 * Get agent name by device MAC
 * Used by game mode detection in LiveKit workers
 * @param {string} mac - Device MAC address
 * @returns {Promise<Object>} Agent name and code
 */
const getAgentNameByMac = async (mac) => {
  const normalizedMac = normalizeMacAddress(mac);

  const device = await prisma.ai_device.findUnique({
    where: { mac_address: normalizedMac },
    select: { agent_id: true, mode: true },
  });

  if (!device) {
    throw new Error('Device not found');
  }

  if (!device.agent_id) {
    return {
      agentId: null,
      agentName: null,
      agentCode: null,
      mode: device.mode
    };
  }

  const agent = await prisma.ai_agent.findUnique({
    where: { id: device.agent_id },
    select: { id: true, agent_name: true, agent_code: true },
  });

  return {
    agentId: agent ? agent.id : null,
    agentName: agent ? agent.agent_name : null,
    agentCode: agent ? agent.agent_code : null,
    mode: device.mode
  };
};

// =============================================
// Agent Chat History Batch Methods
// =============================================

/**
 * Report a single chat message (used by cheeko service)
 * Similar to addChatMessage but with slightly different structure
 * @param {Object} data - Message data
 * @param {string} data.macAddress - Device MAC address
 * @param {string} [data.agentId] - Agent ID (optional)
 * @param {string} data.sessionId - Session ID
 * @param {number} data.chatType - Chat type (1=user, 2=agent)
 * @param {string} data.content - Message content
 * @param {string} [data.audioId] - Audio ID (optional)
 * @returns {Promise<Object>} Created message
 */
const reportChatMessage = async (data) => {
  const { macAddress, agentId, sessionId, chatType, content, audioId, timestamp, sequence, idempotencyKey } = data;
  const normalizedMac = normalizeMacAddress(macAddress);

  let resolvedAgentId = agentId;
  if (!resolvedAgentId) {
    try {
      resolvedAgentId = await getAgentIdByMac(normalizedMac);
    } catch {
      resolvedAgentId = null;
    }
  }

  const message = await createVoiceSessionMessage({
    normalizedMac,
    agentId: resolvedAgentId,
    sessionId,
    chatType,
    content,
    audioId,
    timestamp,
    sequence,
    idempotencyKey
  });

  return message;
};

/**
 * Batch upload all session messages (used by LiveKit workers at end of session)
 * @param {Object} data - Session data
 * @param {string} data.macAddress - Device MAC address
 * @param {string} [data.agentId] - Agent ID (optional)
 * @param {string} data.sessionId - Session ID
 * @param {Array} data.messages - Array of {chatType, content, audioId, timestamp}
 * @returns {Promise<Object>} Result with count of inserted messages
 */
const batchUploadSession = async (data) => {
  const { macAddress, agentId, sessionId, messages } = data;

  if (!messages || !Array.isArray(messages) || messages.length === 0) {
    throw new Error('messages array is required and must not be empty');
  }

  const normalizedMac = normalizeMacAddress(macAddress);

  let resolvedAgentId = agentId;
  if (!resolvedAgentId) {
    try {
      resolvedAgentId = await getAgentIdByMac(normalizedMac);
    } catch {
      resolvedAgentId = null;
    }
  }

  const startSequence = await getNextVoiceMessageSequence(sessionId);
  const insertData = messages.map((msg, index) => {
    const createdAt = parseMessageTimestamp(msg.timestamp, new Date(Date.now() + index));
    const sequence = msg.sequence || startSequence + index;

    return {
      session_id: sessionId,
      mac_address: normalizedMac,
      agent_id: resolvedAgentId,
      sequence,
      role: chatTypeToRole(msg.chatType),
      content: msg.content,
      provider_message: msg.providerMessage || null,
      audio_id: msg.audioId || null,
      created_at: createdAt,
      idempotency_key: msg.idempotencyKey || `${sessionId}:${sequence}`
    };
  });

  const lastEventAt = insertData.reduce((max, msg) => {
    const msgTime = new Date(msg.created_at);
    return msgTime > max ? msgTime : max;
  }, new Date(insertData[0].created_at));

  await ensureVoiceSession({
    sessionId,
    normalizedMac,
    agentId: resolvedAgentId,
    eventAt: lastEventAt
  });

  const result = await prisma.voice_session_messages.createMany({
    data: insertData,
    skipDuplicates: true
  });

  return {
    sessionId,
    macAddress: normalizedMac,
    agentId: resolvedAgentId,
    insertedCount: result.count || 0
  };
};

/**
 * Get recent chat history for user (mobile app)
 * Matches Spring Boot List<AgentChatHistoryUserVO> format
 * Returns only USER messages (chat_type=1) with audio_id
 * @param {string} agentId - Agent ID
 * @param {number} [limit=50] - Max messages to return (default 50)
 * @returns {Promise<Array>} Recent chat messages with only content and audioId
 */
const getRecentUserChatHistory = async (agentId, limit = 50) => {
  const voiceMessages = await prisma.voice_session_messages.findMany({
    where: {
      agent_id: agentId,
      role: 'user',
      audio_id: { not: null }
    },
    select: { content: true, audio_id: true },
    orderBy: { created_at: 'desc' },
    take: limit
  });

  return voiceMessages.map(msg => ({
    content: extractContentFromString(msg.content),
    audioId: msg.audio_id
  }));
};

/**
 * Extract chat content from content field
 * If content is JSON format (e.g., {"speaker": "...", "content": "..."}), extract the content field
 * If content is a plain string, return directly
 * @param {string} content - Original content
 * @returns {string} Extracted chat content
 */
const extractContentFromString = (content) => {
  if (!content || typeof content !== 'string' || content.trim() === '') {
    return content;
  }

  // Try to parse as JSON
  try {
    const jsonObj = JSON.parse(content);
    if (jsonObj && typeof jsonObj === 'object' && jsonObj.content) {
      return String(jsonObj.content);
    }
  } catch {
    // If not valid JSON, return original content
  }

  return content;
};

/**
 * Get audio content by audio ID
 * Matches Spring Boot behavior: returns just the content string
 * Note: Spring Boot's endpoint uses the path param as audioId, not agentId
 * @param {string} audioId - Audio ID
 * @returns {Promise<string|null>} Content string or null
 */
const getAudioContent = async (audioId) => {
  const voiceRecord = await prisma.voice_session_messages.findFirst({
    where: { audio_id: audioId },
    select: { content: true }
  });

  return voiceRecord ? voiceRecord.content : null;
};

// =============================================
// Agent Template Methods
// =============================================

/**
 * Get all visible agent templates
 * @returns {Promise<Array>} List of visible templates (camelCase keys for Spring Boot compatibility)
 */
const getTemplates = async (includeHidden = false) => {
  const where = includeHidden ? {} : { is_visible: 1 };

  const templates = await prisma.ai_agent_template.findMany({
    where,
    orderBy: [{ sort: 'asc' }, { created_at: 'desc' }],
  });

  return (templates || []).map(transformKeysToCamel);
};

/**
 * Get agent template by ID
 * @param {string} templateId - Template ID
 * @returns {Promise<Object|null>} Template or null (camelCase keys for Spring Boot compatibility)
 */
const getTemplateById = async (templateId) => {
  const template = await prisma.ai_agent_template.findUnique({
    where: { id: templateId },
  });

  if (!template) return null;

  return transformKeysToCamel(template);
};

/**
 * Create a new agent template
 * @param {Object} data - Template data
 * @returns {Promise<string>} Created template ID (matches Spring Boot Result<String>)
 */
const createTemplate = async (data) => {
  validateAgentMd(data.systemPrompt);
  const toNullIfEmpty = (val) => (val === '' || val === undefined) ? null : val;

  // No duplicate names/codes: by-name persona resolution and RFID routing key
  // on agent_name, so a duplicate would resolve to an arbitrary row.
  const dupName = await prisma.ai_agent_template.findFirst({
    where: { agent_name: { equals: data.agentName, mode: 'insensitive' } },
    select: { id: true },
  });
  if (dupName) {
    const err = new Error(`Agent name "${data.agentName}" already exists`);
    err.statusCode = 400;
    throw err;
  }
  if (data.agentCode) {
    const dupCode = await prisma.ai_agent_template.findFirst({
      where: { agent_code: { equals: data.agentCode, mode: 'insensitive' } },
      select: { id: true },
    });
    if (dupCode) {
      const err = new Error(`Agent code "${data.agentCode}" already exists`);
      err.statusCode = 400;
      throw err;
    }
  }

  const template = await prisma.ai_agent_template.create({
    data: {
      agent_code: data.agentCode || null,
      agent_name: data.agentName,
      asr_model_id: toNullIfEmpty(data.asrModelId),
      vad_model_id: toNullIfEmpty(data.vadModelId),
      llm_model_id: toNullIfEmpty(data.llmModelId),
      vllm_model_id: toNullIfEmpty(data.vllmModelId),
      tts_model_id: toNullIfEmpty(data.ttsModelId),
      tts_voice_id: toNullIfEmpty(data.ttsVoiceId),
      mem_model_id: toNullIfEmpty(data.memModelId),
      intent_model_id: toNullIfEmpty(data.intentModelId),
      chat_history_conf: data.chatHistoryConf || 0,
      system_prompt: data.systemPrompt,
      soul: data.soul ?? null,
      summary_memory: data.summaryMemory,
      lang_code: data.langCode || 'en',
      language: data.language || 'English',
      is_visible: data.isVisible !== undefined ? data.isVisible : 1,
      sort: data.sort || 0,
    },
    select: { id: true },
  });

  return template.id;
};

/**
 * Update an agent template
 * @param {string} templateId - Template ID
 * @param {Object} data - Update data
 * @returns {Promise<null>} null (matches Spring Boot Result<Void>)
 */
const updateTemplate = async (templateId, data) => {
  const existing = await prisma.ai_agent_template.findUnique({
    where: { id: templateId },
    select: { id: true },
  });

  if (!existing) throw new Error('Template not found');

  const toNullIfEmpty = (val) => (val === '' || val === undefined) ? null : val;

  const updateData = {
    updated_at: new Date(),
  };

  if (data.agentCode !== undefined) updateData.agent_code = data.agentCode || null;
  if (data.agentName !== undefined) updateData.agent_name = data.agentName;
  if (data.asrModelId !== undefined) updateData.asr_model_id = toNullIfEmpty(data.asrModelId);
  if (data.vadModelId !== undefined) updateData.vad_model_id = toNullIfEmpty(data.vadModelId);
  if (data.llmModelId !== undefined) updateData.llm_model_id = toNullIfEmpty(data.llmModelId);
  if (data.vllmModelId !== undefined) updateData.vllm_model_id = toNullIfEmpty(data.vllmModelId);
  if (data.ttsModelId !== undefined) updateData.tts_model_id = toNullIfEmpty(data.ttsModelId);
  if (data.ttsVoiceId !== undefined) updateData.tts_voice_id = toNullIfEmpty(data.ttsVoiceId);
  if (data.memModelId !== undefined) updateData.mem_model_id = toNullIfEmpty(data.memModelId);
  if (data.intentModelId !== undefined) updateData.intent_model_id = toNullIfEmpty(data.intentModelId);
  if (data.chatHistoryConf !== undefined) updateData.chat_history_conf = data.chatHistoryConf;
  if (data.systemPrompt !== undefined) {
    validateAgentMd(data.systemPrompt);
    updateData.system_prompt = data.systemPrompt;
  }
  if (data.soul !== undefined) updateData.soul = data.soul; // SOUL.md (admin dashboard edits this)
  if (data.summaryMemory !== undefined) updateData.summary_memory = data.summaryMemory;
  if (data.langCode !== undefined) updateData.lang_code = data.langCode;
  if (data.language !== undefined) updateData.language = data.language;
  if (data.isVisible !== undefined) updateData.is_visible = data.isVisible;
  if (data.sort !== undefined) updateData.sort = data.sort;

  await prisma.ai_agent_template.update({
    where: { id: templateId },
    data: updateData,
  });

  // Read-back verify: don't report success unless the bytes actually landed.
  // Makes the dashboard's "Saved" truthful instead of trusting a blind 200.
  if (updateData.system_prompt !== undefined || updateData.soul !== undefined) {
    const after = await prisma.ai_agent_template.findUnique({
      where: { id: templateId },
      select: { system_prompt: true, soul: true },
    });
    if (updateData.system_prompt !== undefined && after.system_prompt !== updateData.system_prompt) {
      throw new Error('Save not persisted: system_prompt mismatch after write');
    }
    if (updateData.soul !== undefined && after.soul !== updateData.soul) {
      throw new Error('Save not persisted: soul mismatch after write');
    }
  }

  return null;
};

/**
 * Apply template changes to all agents using this template (by agent_code OR agent_name)
 * @param {string} templateId - Template ID
 * @returns {Promise<Object>} Result with updatedCount
 */
const applyTemplateToAgents = async (templateId) => {
  const template = await prisma.ai_agent_template.findUnique({
    where: { id: templateId },
  });

  if (!template) throw new Error('Template not found');

  // Build OR conditions for agent_code and agent_name
  const orConditions = [];
  if (template.agent_code) {
    orConditions.push({ agent_code: template.agent_code });
  }
  if (template.agent_name) {
    orConditions.push({ agent_name: template.agent_name });
  }

  if (orConditions.length === 0) {
    return { updatedCount: 0, agentCode: template.agent_code, agentName: template.agent_name };
  }

  const updateData = {
    agent_name: template.agent_name,
    asr_model_id: template.asr_model_id,
    vad_model_id: template.vad_model_id,
    llm_model_id: template.llm_model_id,
    vllm_model_id: template.vllm_model_id,
    tts_model_id: template.tts_model_id,
    tts_voice_id: template.tts_voice_id,
    mem_model_id: template.mem_model_id,
    intent_model_id: template.intent_model_id,
    chat_history_conf: template.chat_history_conf,
    system_prompt: template.system_prompt,
    lang_code: template.lang_code,
    language: template.language,
    updated_at: new Date(),
  };

  const result = await prisma.ai_agent.updateMany({
    where: { OR: orConditions },
    data: updateData,
  });

  logger.info(`Applied template "${template.agent_name}" (code: ${template.agent_code}) to ${result.count} agents`);
  return {
    updatedCount: result.count,
    agentCode: template.agent_code,
    agentName: template.agent_name
  };
};

/**
 * Delete an agent template
 * @param {string} templateId - Template ID
 * @returns {Promise<void>}
 */
const deleteTemplate = async (templateId) => {
  const existing = await prisma.ai_agent_template.findUnique({
    where: { id: templateId },
    select: { id: true },
  });

  if (!existing) throw new Error('Template not found');

  await prisma.ai_agent_template.delete({
    where: { id: templateId },
  });
};

// ==============================================
// MCP Access Point Methods (Spring Boot Compatible)
// ==============================================

const WebSocket = require('ws');

// System param key for MCP endpoint
const SERVER_MCP_ENDPOINT = 'server.mcp_endpoint';

// JSON-RPC 2.0 messages for MCP protocol
const MCP_JSON_RPC = {
  initialize: JSON.stringify({
    jsonrpc: '2.0',
    method: 'initialize',
    params: {
      protocolVersion: '2024-11-05',
      capabilities: {
        roots: { listChanged: false },
        sampling: {}
      },
      clientInfo: {
        name: 'xz-mcp-broker',
        version: '0.0.1'
      }
    },
    id: 1
  }),
  notificationsInitialized: '{"jsonrpc":"2.0","method":"notifications/initialized"}',
  toolsList: JSON.stringify({
    jsonrpc: '2.0',
    method: 'tools/list',
    params: null,
    id: 2
  })
};

/**
 * Pad AES key to 16, 24, or 32 bytes (matching Java AESUtils.padKey)
 * @param {Buffer} keyBytes - Key as buffer
 * @returns {Buffer} Padded key
 */
const padKey = (keyBytes) => {
  const keyLength = keyBytes.length;
  if (keyLength === 16 || keyLength === 24 || keyLength === 32) {
    return keyBytes;
  }
  // Pad to 32 bytes with zeros or truncate
  const paddedKey = Buffer.alloc(32);
  keyBytes.copy(paddedKey, 0, 0, Math.min(keyLength, 32));
  return paddedKey;
};

/**
 * AES ECB encrypt with PKCS5 padding (matching Java AESUtils.encrypt)
 * @param {string} key - Encryption key
 * @param {string} plainText - Text to encrypt
 * @returns {string} Base64 encoded ciphertext
 */
const aesEncrypt = (key, plainText) => {
  const keyBytes = padKey(Buffer.from(key, 'utf8'));
  const cipher = crypto.createCipheriv('aes-256-ecb', keyBytes, null);
  let encrypted = cipher.update(plainText, 'utf8', 'base64');
  encrypted += cipher.final('base64');
  return encrypted;
};

/**
 * MD5 hash (matching Java HashEncryptionUtil.Md5hexDigest)
 * @param {string} text - Text to hash
 * @returns {string} MD5 hex digest
 */
const md5Hash = (text) => {
  return crypto.createHash('md5').update(text, 'utf8').digest('hex');
};

/**
 * Get MCP access point URL for an agent
 * Matches Spring Boot AgentMcpAccessPointServiceImpl.getAgentMcpAccessAddress
 * @param {string} agentId - Agent ID
 * @returns {string|null} MCP WebSocket URL or null if not configured
 */
const getMcpAddress = async (agentId) => {
  const param = await prisma.sys_params.findFirst({
    where: { param_code: SERVER_MCP_ENDPOINT },
    select: { param_value: true },
  });

  if (!param || !param.param_value || param.param_value === 'null') {
    return null;
  }

  const url = param.param_value;

  try {
    // Parse the URL
    const parsedUrl = new URL(url);

    // Get the secret key from query params
    const key = parsedUrl.searchParams.get('key');
    if (!key) {
      logger.error('MCP endpoint URL missing key parameter');
      return null;
    }

    // Get WebSocket scheme (wss for https, ws for http)
    const wsScheme = parsedUrl.protocol === 'https:' ? 'wss' : 'ws';

    // Get path before the last /
    let path = parsedUrl.pathname;
    path = path.substring(0, path.lastIndexOf('/'));

    // Build agent MCP URL prefix
    const agentMcpUrl = `${wsScheme}://${parsedUrl.host}${path}`;

    // Create encrypted token
    // 1. MD5 hash the agentId
    const md5AgentId = md5Hash(agentId);
    // 2. Create JSON with the MD5 hash
    const json = JSON.stringify({ agentId: md5AgentId });
    // 3. AES encrypt
    const encryptedToken = aesEncrypt(key, json);
    // 4. URL encode
    const encodedToken = encodeURIComponent(encryptedToken);

    // Return the full MCP access URL
    return `${agentMcpUrl}/mcp/?token=${encodedToken}`;
  } catch (err) {
    logger.error('Failed to parse MCP endpoint URL:', err.message);
    throw new Error('MCP address error, please contact admin to update MCP access point address in parameter management');
  }
};

/**
 * Get MCP tools list for an agent via WebSocket JSON-RPC
 * Matches Spring Boot AgentMcpAccessPointServiceImpl.getAgentMcpToolsList
 * @param {string} agentId - Agent ID
 * @returns {array} List of tool names
 */
const getMcpTools = async (agentId) => {
  // Get the MCP address
  const wsUrl = await getMcpAddress(agentId);
  if (!wsUrl) {
    return [];
  }

  // Replace /mcp/ with /call/ for tools endpoint
  const callUrl = wsUrl.replace('/mcp/', '/call/');

  return new Promise((resolve) => {
    let ws;
    let initSucceeded = false;
    let resolved = false;

    // Cleanup function - defined first for reference
    const doCleanup = (timer) => {
      if (timer) clearTimeout(timer);
      if (ws && ws.readyState === WebSocket.OPEN) {
        try { ws.close(); } catch { /* ignore */ }
      }
    };

    // Safe resolve that only resolves once
    const safeResolve = (value, timer) => {
      if (!resolved) {
        resolved = true;
        doCleanup(timer);
        resolve(value);
      }
    };

    // Set overall timeout
    const timeoutHandle = setTimeout(() => {
      logger.warn(`MCP tools request timeout for agent ${agentId}`);
      safeResolve([], timeoutHandle);
    }, 15000);

    try {
      ws = new WebSocket(callUrl, {
        handshakeTimeout: 8000
      });

      ws.on('open', () => {
        // Step 1: Send initialize message
        logger.info(`Sending MCP initialize message, AgentID: ${agentId}`);
        ws.send(MCP_JSON_RPC.initialize);
      });

      ws.on('message', (data) => {
        try {
          const response = JSON.parse(data.toString());

          // Check for initialize response (id=1)
          if (response.id === 1) {
            if (response.result) {
              logger.info(`MCP initialize success, AgentID: ${agentId}`);
              initSucceeded = true;
              // Step 2: Send notifications/initialized
              logger.info(`Sending MCP initialize complete notification, AgentID: ${agentId}`);
              ws.send(MCP_JSON_RPC.notificationsInitialized);
              // Step 3: Send tools/list request
              logger.info(`Sending MCP tools list request, AgentID: ${agentId}`);
              ws.send(MCP_JSON_RPC.toolsList);
            } else if (response.error) {
              logger.error(`MCP initialize failure, AgentID: ${agentId}, Error:`, response.error);
              safeResolve([], timeoutHandle);
            }
          }
          // Check for tools/list response (id=2)
          else if (response.id === 2) {
            if (response.result && response.result.tools && Array.isArray(response.result.tools)) {
              const toolNames = response.result.tools
                .map(tool => tool.name)
                .filter(name => name !== null);
              logger.info(`Successfully got MCP tools list, AgentID: ${agentId}, Tools count: ${toolNames.length}`);
              safeResolve(toolNames, timeoutHandle);
            } else if (response.error) {
              logger.error(`Get tools list failure, AgentID: ${agentId}, Error:`, response.error);
              safeResolve([], timeoutHandle);
            }
          }
        } catch (err) {
          logger.warn(`Parse MCP response failure: ${data.toString()}`, err);
        }
      });

      ws.on('error', (err) => {
        logger.error(`Get agent MCP tools list failure, AgentID: ${agentId}, Error: ${err.message}`);
        safeResolve([], timeoutHandle);
      });

      ws.on('close', () => {
        if (!initSucceeded) {
          logger.warn(`MCP WebSocket closed before init succeeded, AgentID: ${agentId}`);
        }
      });
    } catch (err) {
      logger.error(`Failed to connect to MCP, AgentID: ${agentId}, Error: ${err.message}`);
      safeResolve([], timeoutHandle);
    }
  });
};

/**
 * Get user's agents list (Spring Boot /agent/list format)
 * Returns AgentDTO array with device counts, etc.
 * Admin sees all agents with owner info, user sees own agents
 * Optimized: batch fetches all device data in 1 query instead of N+1
 * @param {number} userId - User ID
 * @param {boolean} isSuperAdmin - Whether user is super admin
 * @param {Object} options - Pagination options
 * @param {number} [options.page=1] - Page number (1-indexed)
 * @param {number} [options.limit=20] - Items per page
 * @returns {Promise<Object>} Object with list and total
 */
const getAgentListForUser = async (userId, isSuperAdmin, options = {}) => {
  const page = parseInt(options.page) || 1;
  const limit = parseInt(options.limit) || 10;
  const skip = (page - 1) * limit;
  const where = isSuperAdmin ? {} : { user_id: BigInt(userId) };

  const [totalCount, agents] = await Promise.all([
    prisma.ai_agent.count({ where }),
    prisma.ai_agent.findMany({
      where,
      select: {
        id: true, agent_name: true, mem_model_id: true, system_prompt: true,
        summary_memory: true, created_at: true, user_id: true,
        ...(isSuperAdmin ? { sys_user: { select: { username: true } } } : {}),
      },
      orderBy: [{ sort: 'asc' }, { created_at: 'desc' }],
      skip,
      take: limit,
    }),
  ]);

  if (!agents.length) return { list: [], total: totalCount };

  const agentIds = agents.map(a => a.id);
  const allDevices = await prisma.ai_device.findMany({
    where: { agent_id: { in: agentIds } },
    select: { agent_id: true, mac_address: true, last_connected_at: true },
  });

  // Apple/Firebase sign-ups get an opaque UID as their username, so the Owner
  // column alone cannot identify a parent. Pull contact details and child
  // names for admins so the row is recognisable.
  let contactMap = {};
  if (isSuperAdmin) {
    const ownerIds = [...new Set(agents.map(a => a.user_id).filter(Boolean))];
    if (ownerIds.length) {
      const [parents, kids] = await Promise.all([
        prisma.parent_profile.findMany({
          where: { user_id: { in: ownerIds } },
          select: { user_id: true, display_name: true, email: true, phone_number: true },
        }),
        prisma.kid_profile.findMany({
          where: { user_id: { in: ownerIds } },
          select: { user_id: true, name: true },
        }),
      ]);
      parents.forEach(p => {
        contactMap[p.user_id] = {
          parentName: p.display_name || null,
          parentEmail: p.email || null,
          parentPhone: p.phone_number || null,
          kidNames: [],
        };
      });
      kids.forEach(k => {
        if (!contactMap[k.user_id]) {
          contactMap[k.user_id] = { parentName: null, parentEmail: null, parentPhone: null, kidNames: [] };
        }
        if (k.name) contactMap[k.user_id].kidNames.push(k.name);
      });
    }
  }

  const deviceStatsMap = {};
  allDevices.forEach(device => {
    const aid = device.agent_id;
    if (!deviceStatsMap[aid]) deviceStatsMap[aid] = { count: 0, macs: [], lastConnected: null };
    deviceStatsMap[aid].count++;
    deviceStatsMap[aid].macs.push(device.mac_address);
    if (device.last_connected_at) {
      const connTime = new Date(device.last_connected_at);
      if (!deviceStatsMap[aid].lastConnected || connTime > new Date(deviceStatsMap[aid].lastConnected)) {
        deviceStatsMap[aid].lastConnected = device.last_connected_at;
      }
    }
  });

  const list = agents.map(agent => {
    const stats = deviceStatsMap[agent.id] || { count: 0, macs: [], lastConnected: null };
    const contact = contactMap[agent.user_id] || {};
    return {
      id: agent.id,
      agentName: agent.agent_name,
      agent_name: agent.agent_name,
      displayName: agent.agent_name,
      display_name: agent.agent_name,
      memModelId: agent.mem_model_id,
      systemPrompt: agent.system_prompt,
      summaryMemory: agent.summary_memory,
      lastConnectedAt: stats.lastConnected,
      deviceCount: stats.count,
      deviceMacAddresses: stats.macs.join(','),
      ownerUsername: isSuperAdmin ? (agent.sys_user?.username || null) : undefined,
      parentName: isSuperAdmin ? (contact.parentName || null) : undefined,
      parentEmail: isSuperAdmin ? (contact.parentEmail || null) : undefined,
      parentPhone: isSuperAdmin ? (contact.parentPhone || null) : undefined,
      kidNames: isSuperAdmin ? (contact.kidNames || []) : undefined,
      createDate: agent.created_at,
    };
  });

  return { list, total: totalCount };
};

/**
 * Admin agent list with pagination (Spring Boot /agent/all format)
 * Returns PageData<AgentEntity> with pagination
 * @param {Object} params - Query parameters with page, limit
 * @returns {Promise<Object>} Paginated agents with {list, total, page, limit}
 */
const adminAgentListPaginated = async (params = {}) => {
  const page = parseInt(params.page) || 1;
  const limit = parseInt(params.limit) || 10;
  const skip = (page - 1) * limit;

  const [count, agents] = await Promise.all([
    prisma.ai_agent.count(),
    prisma.ai_agent.findMany({
      orderBy: [{ sort: 'asc' }, { created_at: 'desc' }],
      skip,
      take: limit,
    }),
  ]);

  const list = (agents || []).map(agent => ({
    id: agent.id,
    userId: agent.user_id,
    agentCode: agent.agent_code,
    agentName: agent.agent_name,
    asrModelId: agent.asr_model_id,
    vadModelId: agent.vad_model_id,
    llmModelId: agent.llm_model_id,
    vllmModelId: agent.vllm_model_id,
    ttsModelId: agent.tts_model_id,
    ttsVoiceId: agent.tts_voice_id,
    memModelId: agent.mem_model_id,
    intentModelId: agent.intent_model_id,
    chatHistoryConf: agent.chat_history_conf,
    systemPrompt: agent.system_prompt,
    summaryMemory: agent.summary_memory,
    langCode: agent.lang_code,
    language: agent.language,
    sort: agent.sort,
    creator: agent.creator,
    createdAt: agent.created_at,
    updater: agent.updater,
    updatedAt: agent.updated_at
  }));

  return {
    list,
    total: count || 0
  };
};

/**
 * Get agent info by ID (Spring Boot AgentInfoVO format)
 * Returns agent with plugin mappings (functions) - no user filtering
 * @param {string} agentId - Agent ID
 * @returns {Promise<Object|null>} Agent info with functions or null
 */
const getAgentInfoById = async (agentId) => {
  const agent = await prisma.ai_agent.findUnique({ where: { id: agentId } });
  if (!agent) return null;

  // Plugin mappings table not in Prisma schema; use raw query
  let functions = [];
  try {
    const pluginMappings = await prisma.$queryRawUnsafe(
      `SELECT id, agent_id, plugin_id, param_info FROM ai_agent_plugin_mapping WHERE agent_id = $1::uuid`,
      agentId
    );
    functions = (pluginMappings || []).map(mapping => ({
      id: mapping.id,
      agentId: mapping.agent_id,
      pluginId: mapping.plugin_id,
      paramInfo: mapping.param_info,
    }));
  } catch (_) { /* table may not exist */ }

  // Transform agent to camelCase AgentInfoVO format
  return {
    id: agent.id,
    userId: agent.user_id,
    agentCode: agent.agent_code,
    agentName: agent.agent_name,
    asrModelId: agent.asr_model_id,
    vadModelId: agent.vad_model_id,
    llmModelId: agent.llm_model_id,
    vllmModelId: agent.vllm_model_id,
    ttsModelId: agent.tts_model_id,
    ttsVoiceId: agent.tts_voice_id,
    memModelId: agent.mem_model_id,
    intentModelId: agent.intent_model_id,
    chatHistoryConf: agent.chat_history_conf,
    systemPrompt: agent.system_prompt,
    summaryMemory: agent.summary_memory,
    langCode: agent.lang_code,
    language: agent.language,
    sort: agent.sort,
    creator: agent.creator,
    createdAt: agent.created_at,
    updater: agent.updater,
    updatedAt: agent.updated_at,
    functions: functions
  };
};

module.exports = {
  createAgent,
  getAgentById,
  getAgentInfoById,
  updateAgent,
  deleteAgent,
  listAgents,
  getAllAgents,
  getAgentListForUser,
  adminAgentListPaginated,
  getAgentSessions,
  getChatHistory,
  getVoiceSessionMessagesForDevice,
  addChatMessage,
  getPromptByMac,
  getAgentIdByMac,
  cycleCharacter,
  setCharacter,
  setCharacterByName,
  getCurrentCharacter,
  getCharacterSession,
  getCharacterSessionByName,
  // Memory integration
  getMemoriesByMac,
  addConversationToMemory,
  addFactToMemory,
  getPromptWithMemories,
  getDeviceBootstrap,
  saveDeviceWorkspaceArtifact,
  listDeviceWorkspaceArtifacts,
  getDeviceWorkspaceArtifact,
  saveDeviceMemoryDocument,
  listDeviceMemoryDocuments,
  consolidateDeviceMemoryForSession,
  clearMemoriesByMac,
  // Agent memory and mode methods
  saveMemory,
  saveVoiceSessionSummary,
  endVoiceSession,
  updateModeFromTemplate,
  getAgentNameByMac,
  // Chat history batch methods
  reportChatMessage,
  batchUploadSession,
  getRecentUserChatHistory,
  getAudioContent,
  // Template methods
  getTemplates,
  getTemplateById,
  createTemplate,
  updateTemplate,
  deleteTemplate,
  applyTemplateToAgents,
  // MCP Access Point methods
  getMcpAddress,
  getMcpTools
};

module.exports.__testables = {
  buildRollingOverallMemory,
  buildSessionEpisodeMemoryContent,
  normalizeMemoryText
};
