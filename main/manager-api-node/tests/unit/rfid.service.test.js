'use strict';

const mockPrisma = {
  $queryRaw: jest.fn(),
  ai_device: {
    findFirst: jest.fn()
  },
  rfid_card_mapping: {
    findFirst: jest.fn(),
    create: jest.fn(),
    updateMany: jest.fn(),
    upsert: jest.fn()
  },
  rfid_card_tap_log: {
    upsert: jest.fn()
  }
};

jest.mock('../../src/config/database', () => ({
  prisma: mockPrisma
}));

jest.mock('../../src/services/integrations/qdrant.service', () => ({}));

const rfidService = require('../../src/services/rfid.service');

describe('rfid card mapping thumbnails', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockPrisma.$queryRaw.mockResolvedValue([{ exists: false }]);
    mockPrisma.ai_device.findFirst.mockResolvedValue(null);
  });

  it('persists thumbnailUrl when creating an AI card mapping', async () => {
    mockPrisma.rfid_card_mapping.findFirst.mockResolvedValue(null);
    mockPrisma.rfid_card_mapping.create.mockResolvedValue({ id: BigInt(1) });

    await rfidService.createCardMapping({
      rfidUid: 'aa:bb:10',
      cardType: 'ai',
      actionType: 'ai',
      thumbnailUrl: 'https://cdn.example.com/ai-card.png'
    });

    expect(mockPrisma.rfid_card_mapping.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        rfid_uid: 'AABB10',
        card_type: 'ai',
        action_type: 'ai',
        thumbnail_url: 'https://cdn.example.com/ai-card.png'
      })
    }));
  });

  it('persists thumbnailUrl when updating an AI card mapping', async () => {
    mockPrisma.rfid_card_mapping.findFirst.mockResolvedValue({ id: BigInt(7) });
    mockPrisma.rfid_card_mapping.updateMany.mockResolvedValue({ count: 1 });

    await rfidService.updateCardMapping({
      id: 1,
      rfidUid: 'aa:bb:10',
      thumbnailUrl: 'https://cdn.example.com/updated-card.png'
    });

    expect(mockPrisma.rfid_card_mapping.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: BigInt(7) },
      data: expect.objectContaining({
        thumbnail_url: 'https://cdn.example.com/updated-card.png'
      })
    }));
  });

  // A tap no longer mutates the mapping table: the voice-card pairing flow that
  // used to claim a blank card on tap has been removed, so recordCardTap is
  // read-only apart from the tap log.
  it('does not write a card mapping on tap', async () => {
    mockPrisma.rfid_card_mapping.findFirst.mockResolvedValue({
      id: 11n,
      rfid_uid: 'A1B2C3D4',
      card_type: 'story',
      content_pack_id: 99n,
      action_type: null,
      question_pack_id: null,
      question_id: null,
      question_ids: [],
      rfid_content_pack: {
        id: 99n,
        pack_code: 'story_pack',
        name: 'Story Pack',
        version: '1',
        content_hash: 'hash-1'
      }
    });

    await rfidService.recordCardTap({
      macAddress: 'AA:BB:CC:DD:EE:FF',
      rfidUid: 'A1:B2:C3:D4'
    });

    expect(mockPrisma.rfid_card_mapping.upsert).not.toHaveBeenCalled();
    expect(mockPrisma.rfid_card_mapping.create).not.toHaveBeenCalled();
    expect(mockPrisma.rfid_card_mapping.updateMany).not.toHaveBeenCalled();
  });
});
