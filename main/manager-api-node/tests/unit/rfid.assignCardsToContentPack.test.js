'use strict';

/**
 * Bulk "Assign cards" on a content pack. New UIDs get a mapping, UIDs mapped
 * elsewhere are moved onto the pack with their old role cleared, and nothing
 * is written for a UID that is already there.
 */

const mockTx = {
  rfid_card_mapping: { findMany: jest.fn(), updateMany: jest.fn(), createMany: jest.fn() }
};

const mockPrisma = {
  $queryRaw: jest.fn(),
  $transaction: jest.fn(fn => fn(mockTx)),
  rfid_content_pack: { findFirst: jest.fn() }
};

jest.mock('../../src/config/database', () => ({ prisma: mockPrisma }));
jest.mock('../../src/services/integrations/qdrant.service', () => ({}));
jest.mock('../../src/services/upload.service', () => ({}));

const { assignCardsToContentPack } = require('../../src/services/rfid.service');

beforeEach(() => {
  jest.clearAllMocks();
  mockPrisma.$transaction.mockImplementation(fn => fn(mockTx));
  mockPrisma.rfid_content_pack.findFirst.mockResolvedValue({ id: BigInt(7), content_type: 'story_pack' });
  mockTx.rfid_card_mapping.findMany.mockResolvedValue([]);
});

it('normalises, dedupes, and creates mappings for new UIDs', async () => {
  const result = await assignCardsToContentPack(7, ['79:41:ae:0d', ' 7941AE0D ', '29994a0e', '']);

  expect(result).toEqual({ added: ['7941AE0D', '29994A0E'], moved: [], unchanged: [], invalid: [] });
  const rows = mockTx.rfid_card_mapping.createMany.mock.calls[0][0].data;
  expect(rows.map(r => r.rfid_uid)).toEqual(['7941AE0D', '29994A0E']);
  expect(rows[0]).toMatchObject({ content_pack_id: BigInt(7), card_type: 'content', active: true });
  expect(mockTx.rfid_card_mapping.updateMany).not.toHaveBeenCalled();
});

it('rejects non-hex input instead of normalising it into a different UID', async () => {
  const result = await assignCardsToContentPack(7, ['hello', 'AB12']);
  expect(result.invalid).toEqual(['hello']);
  expect(result.added).toEqual(['AB12']);
});

it('moves a UID mapped elsewhere and clears its old role, leaves one already on the pack', async () => {
  mockTx.rfid_card_mapping.findMany.mockResolvedValue([
    { id: BigInt(1), rfid_uid: 'AAAA', content_pack_id: BigInt(3), card_type: 'content', rfid_content_pack: { name: 'Bedtime' } },
    { id: BigInt(2), rfid_uid: 'BBBB', content_pack_id: null, card_type: 'ai', rfid_content_pack: null },
    { id: BigInt(4), rfid_uid: 'CCCC', content_pack_id: BigInt(7), card_type: 'content', rfid_content_pack: { name: 'Adventure' } }
  ]);

  const result = await assignCardsToContentPack(7, ['AAAA', 'BBBB', 'CCCC']);

  expect(result.unchanged).toEqual(['CCCC']);
  expect(result.moved).toEqual([
    { rfidUid: 'AAAA', fromContentPackId: '3', fromName: 'Bedtime' },
    { rfidUid: 'BBBB', fromContentPackId: null, fromName: null }
  ]);
  const { where, data } = mockTx.rfid_card_mapping.updateMany.mock.calls[0][0];
  expect(where.id.in).toEqual([BigInt(1), BigInt(2)]);
  expect(data).toMatchObject({
    content_pack_id: BigInt(7), question_pack_id: null, question_id: null,
    question_ids: [], card_type: 'content', action_data: {}
  });
  expect(mockTx.rfid_card_mapping.createMany).not.toHaveBeenCalled();
});

it('marks cards as game when the pack is a sound quiz', async () => {
  mockPrisma.rfid_content_pack.findFirst.mockResolvedValue({ id: BigInt(7), content_type: 'sound_quiz' });
  await assignCardsToContentPack(7, ['AB12']);
  expect(mockTx.rfid_card_mapping.createMany.mock.calls[0][0].data[0].card_type).toBe('game');
});

it('throws when the pack does not exist', async () => {
  mockPrisma.rfid_content_pack.findFirst.mockResolvedValue(null);
  await expect(assignCardsToContentPack(99, ['AB12'])).rejects.toThrow('Content pack not found');
  expect(mockPrisma.$transaction).not.toHaveBeenCalled();
});
