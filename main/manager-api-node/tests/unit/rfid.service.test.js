'use strict';

const mockPrisma = {
  rfid_card_mapping: {
    findFirst: jest.fn(),
    create: jest.fn(),
    updateMany: jest.fn()
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
});
