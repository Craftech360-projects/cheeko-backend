/**
 * Bulk Import Service
 *
 * Parses uploaded XLSX files and bulk-imports RFID content packs + card mappings.
 */

const XLSX = require('xlsx');
const { prisma } = require('../config/database');
const logger = require('../utils/logger');

// Agent name mapping for AI cards (notes → agent)
const AI_CARD_AGENT_MAP = {
  'magic card': 'cheeko-magic-agent',
  'magic': 'cheeko-magic-agent',
  'cheeko magic': 'cheeko-magic-agent',
  'astronaut card': 'cheeko-astronaut-agent',
  'astronaut': 'cheeko-astronaut-agent',
  'astrount card': 'cheeko-astronaut-agent',
  'cheeko astronaut': 'cheeko-astronaut-agent',
  'cheeko swiss german card': 'cheeko-german-agent',
  'swiss german': 'cheeko-german-agent',
  'german card': 'cheeko-german-agent',
  'cheeko german': 'cheeko-german-agent',
  'cheeko conversation card': null, // default Cheeko, no override
  'ai card': null,
  'ai content card': null,
};

/**
 * Resolve agent name from card notes
 */
function resolveAgentName(notes) {
  if (!notes) return null;
  const key = notes.toLowerCase().trim();
  if (key in AI_CARD_AGENT_MAP) return AI_CARD_AGENT_MAP[key];
  // Partial match
  for (const [pattern, agent] of Object.entries(AI_CARD_AGENT_MAP)) {
    if (key.includes(pattern) || pattern.includes(key)) return agent;
  }
  return null;
}

/**
 * Parse uploaded XLSX buffer into structured data
 * @param {Buffer} fileBuffer - The xlsx file buffer
 * @returns {Object} { contentRows, mappingRows, summary }
 */
const parseExcel = (fileBuffer) => {
  const wb = XLSX.read(fileBuffer, { type: 'buffer' });

  const result = { contentRows: [], mappingRows: [], summary: {} };

  // Parse Content sheet
  if (wb.SheetNames.includes('Content')) {
    result.contentRows = XLSX.utils.sheet_to_json(wb.Sheets['Content']);
    logger.info(`[BULK-IMPORT] Parsed ${result.contentRows.length} content rows`);
  }

  // Parse Card Mappings sheet
  if (wb.SheetNames.includes('Card Mappings')) {
    result.mappingRows = XLSX.utils.sheet_to_json(wb.Sheets['Card Mappings']);
    logger.info(`[BULK-IMPORT] Parsed ${result.mappingRows.length} mapping rows`);
  }

  result.summary = {
    sheets: wb.SheetNames,
    contentRows: result.contentRows.length,
    mappingRows: result.mappingRows.length,
  };

  return result;
};

/**
 * Preview import — validate all rows and return status per row
 * @param {Buffer} fileBuffer
 * @returns {Object} { content: [...], mappings: [...], summary }
 */
const previewImport = async (fileBuffer) => {
  const { contentRows, mappingRows } = parseExcel(fileBuffer);

  // ── Group content rows by pack code ──
  const packMap = new Map();
  for (const row of contentRows) {
    const code = row['Pack Code'];
    if (!code) continue;
    if (!packMap.has(code)) {
      packMap.set(code, {
        packCode: code,
        packName: row['Pack Name'] || code,
        contentType: row['Content Type'] || 'rfidcontent',
        language: row['Language'] || 'en',
        version: row['Version'] || null,
        active: row['Active'] === 'Yes',
        items: [],
      });
    }
    packMap.get(code).items.push({
      storyNumber: row['Story #'] || null,
      storyTitle: row['Story Title'] || null,
      itemNumber: row['Item #'] || packMap.get(code).items.length + 1,
      title: row['Item Title'] || null,
      audioUrl: row['Audio URL'] || null,
      imageUrl: row['Image URL'] || null,
    });
  }

  // ── Check which packs exist in DB ──
  const packCodes = [...packMap.keys()];
  const existingPacks = await prisma.rfid_content_pack.findMany({
    where: { pack_code: { in: packCodes } },
    select: { id: true, pack_code: true, total_items: true },
  });
  const existingPackMap = new Map(existingPacks.map(p => [p.pack_code, p]));

  const contentPreview = [...packMap.values()].map(pack => ({
    ...pack,
    itemCount: pack.items.length,
    status: existingPackMap.has(pack.packCode) ? 'mapped' : 'new',
    dbId: existingPackMap.get(pack.packCode)?.id?.toString() || null,
  }));

  // ── Check which card mappings exist in DB ──
  const uids = mappingRows.filter(r => r['RFID UID']).map(r => r['RFID UID'].toUpperCase().replace(/[:-]/g, ''));
  const existingCards = await prisma.rfid_card_mapping.findMany({
    where: { rfid_uid: { in: uids } },
    select: { rfid_uid: true, card_type: true, action_data: true },
  });
  const existingCardMap = new Map(existingCards.map(c => [c.rfid_uid, c]));

  const mappingPreview = mappingRows.filter(r => r['RFID UID']).map(row => {
    const uid = row['RFID UID'].toUpperCase().replace(/[:-]/g, '');
    const cardType = row['Card Type'] || 'content';
    const existing = existingCardMap.get(uid);
    const agentName = cardType === 'ai' ? resolveAgentName(row['Notes'] || row['Mapped To']) : null;

    return {
      rfidUid: uid,
      cardType,
      mappedTo: row['Mapped To'] || null,
      packCode: row['Pack Code'] || null,
      category: row['Category'] || null,
      notes: row['Notes'] || null,
      active: row['Active'] === 'Yes',
      agentName,
      status: existing ? 'exists' : 'new',
      existingType: existing?.card_type || null,
    };
  });

  const summary = {
    contentPacks: {
      total: contentPreview.length,
      new: contentPreview.filter(p => p.status === 'new').length,
      mapped: contentPreview.filter(p => p.status === 'mapped').length,
    },
    cardMappings: {
      total: mappingPreview.length,
      new: mappingPreview.filter(m => m.status === 'new').length,
      mapped: mappingPreview.filter(m => m.status === 'exists').length,
      aiCards: mappingPreview.filter(m => m.cardType === 'ai').length,
      contentCards: mappingPreview.filter(m => m.cardType === 'content').length,
    },
  };

  return { content: contentPreview, mappings: mappingPreview, summary };
};

/**
 * Execute bulk import — creates packs and card mappings
 * @param {Buffer} fileBuffer
 * @param {number} userId
 * @returns {Object} { results, summary }
 */
const executeBulkImport = async (fileBuffer, userId) => {
  const { contentRows, mappingRows } = parseExcel(fileBuffer);
  const results = { packs: [], mappings: [] };

  // ── Step 1: Upsert content packs ──
  const packMap = new Map();
  for (const row of contentRows) {
    const code = row['Pack Code'];
    if (!code) continue;
    if (!packMap.has(code)) {
      packMap.set(code, {
        packCode: code,
        packName: row['Pack Name'] || code,
        contentType: row['Content Type'] || 'rfidcontent',
        language: row['Language'] || 'en',
        version: row['Version'] || null,
        active: row['Active'] === 'Yes',
        items: [],
      });
    }
    packMap.get(code).items.push({
      storyNumber: row['Story #'] || null,
      storyTitle: row['Story Title'] || null,
      itemNumber: row['Item #'] || packMap.get(code).items.length + 1,
      title: row['Item Title'] || null,
      audioUrl: row['Audio URL'] || null,
      imageUrl: row['Image URL'] || null,
    });
  }

  for (const [code, pack] of packMap) {
    try {
      // Check if pack exists
      const existing = await prisma.rfid_content_pack.findFirst({
        where: { pack_code: code },
      });

      let packId;
      if (existing) {
        // Pack already exists — skip it entirely
        results.packs.push({ packCode: code, status: 'skipped', itemCount: existing.total_items || 0 });
        continue;
      } else {
        const newPack = await prisma.rfid_content_pack.create({
          data: {
            pack_code: code,
            name: pack.packName,
            content_type: pack.contentType,
            language: pack.language,
            version: pack.version ? String(pack.version) : null,
            active: pack.active,
            total_items: pack.items.length,
            creator: userId ? BigInt(userId) : null,
          },
        });
        packId = newPack.id;
        results.packs.push({ packCode: code, status: 'created', itemCount: pack.items.length });
      }

      // Insert items
      if (pack.items.length > 0) {
        const itemsData = pack.items.map((item, idx) => ({
          content_pack_id: packId,
          item_number: item.itemNumber || idx + 1,
          title: item.title,
          audio_url: item.audioUrl || null,
          image_url: item.imageUrl || null,
          story_number: item.storyNumber || null,
          story_title: item.storyTitle || null,
          active: true,
          creator: userId ? BigInt(userId) : null,
        }));
        await prisma.content_item.createMany({ data: itemsData });
      }
    } catch (err) {
      logger.error(`[BULK-IMPORT] Failed to upsert pack ${code}:`, err.message);
      results.packs.push({ packCode: code, status: 'failed', error: err.message });
    }
  }

  // ── Step 2: Create card mappings ──
  // Build a pack_code → id map for linking
  const allPacks = await prisma.rfid_content_pack.findMany({
    select: { id: true, pack_code: true },
  });
  const packCodeToId = new Map(allPacks.map(p => [p.pack_code, p.id]));

  for (const row of mappingRows) {
    const uid = (row['RFID UID'] || '').toUpperCase().replace(/[:-]/g, '');
    if (!uid) continue;

    const cardType = row['Card Type'] || 'content';
    const packCode = row['Pack Code'] || null;
    const notes = row['Notes'] || row['Mapped To'] || null;

    try {
      // Check if already exists
      const existing = await prisma.rfid_card_mapping.findFirst({
        where: { rfid_uid: uid },
      });

      if (existing) {
        // Card already exists — skip it
        results.mappings.push({ rfidUid: uid, status: 'skipped', cardType });
      } else {
        // Create new
        let actionType = null;
        let actionData = '{}';
        let contentPackId = null;
        let finalPackCode = null;

        if (cardType === 'ai') {
          const agentName = resolveAgentName(notes);
          actionType = agentName ? 'agent' : null;
          actionData = agentName ? JSON.stringify({ agent_name: agentName }) : '{}';
        } else if (packCode && packCodeToId.has(packCode)) {
          contentPackId = packCodeToId.get(packCode);
          finalPackCode = packCode;
        }

        await prisma.$executeRawUnsafe(
          `INSERT INTO rfid_card_mapping (rfid_uid, card_type, active, status, notes, question_ids, action_type, action_data, content_pack_id, pack_code, creator, create_date, update_date)
           VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8::jsonb, $9, $10, $11, NOW(), NOW())`,
          uid, cardType, row['Active'] !== 'No', 1, notes, '[]', actionType, actionData,
          contentPackId, finalPackCode, userId ? BigInt(userId) : null
        );
        results.mappings.push({ rfidUid: uid, status: 'created', cardType });
      }
    } catch (err) {
      logger.error(`[BULK-IMPORT] Failed to map card ${uid}:`, err.message);
      results.mappings.push({ rfidUid: uid, status: 'failed', error: err.message });
    }
  }

  const summary = {
    packs: {
      created: results.packs.filter(p => p.status === 'created').length,
      skipped: results.packs.filter(p => p.status === 'skipped').length,
      failed: results.packs.filter(p => p.status === 'failed').length,
    },
    mappings: {
      created: results.mappings.filter(m => m.status === 'created').length,
      skipped: results.mappings.filter(m => m.status === 'skipped').length,
      failed: results.mappings.filter(m => m.status === 'failed').length,
    },
  };

  logger.info(`[BULK-IMPORT] Complete — Packs: ${summary.packs.created} created, ${summary.packs.skipped} skipped, ${summary.packs.failed} failed | Mappings: ${summary.mappings.created} created, ${summary.mappings.skipped} skipped, ${summary.mappings.failed} failed`);

  return { results, summary };
};

/**
 * Export current card mappings as array (for xlsx generation)
 */
const exportMappings = async () => {
  const mappings = await prisma.rfid_card_mapping.findMany({
    orderBy: { create_date: 'desc' },
  });

  const packs = await prisma.rfid_content_pack.findMany({
    select: { id: true, pack_code: true, name: true },
  });
  const packIdToInfo = new Map(packs.map(p => [p.id, { code: p.pack_code, name: p.name }]));

  const rows = mappings.map(m => ({
    'RFID UID': m.rfid_uid,
    'Card Type': m.card_type || 'content',
    'Mapped To': m.notes || (m.content_pack_id ? packIdToInfo.get(m.content_pack_id)?.name : null) || '',
    'Content Pack': m.content_pack_id ? packIdToInfo.get(m.content_pack_id)?.name : '',
    'Pack Code': m.pack_code || (m.content_pack_id ? packIdToInfo.get(m.content_pack_id)?.code : '') || '',
    'Agent': m.action_data?.agent_name || '',
    'Notes': m.notes || '',
    'Active': m.active ? 'Yes' : 'No',
    'Mapped': m.card_type === 'ai'
      ? (m.action_data?.agent_name ? 'Yes' : 'No')
      : (m.content_pack_id ? 'Yes' : 'No'),
    'Created': m.create_date ? new Date(m.create_date).toISOString() : '',
  }));

  return rows;
};

/**
 * Generate xlsx buffer from rows
 */
const generateExcel = (rows) => {
  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Card Mappings');
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
};

module.exports = {
  parseExcel,
  previewImport,
  executeBulkImport,
  exportMappings,
  generateExcel,
};
