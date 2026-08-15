/**
 * The imagine gallery reads a table now, not an S3 prefix.
 *
 * That is what lets it follow the child, and it removes a real ceiling: the old
 * listing took a single ListObjectsV2 page (1000 objects) and applied the date
 * filter to whatever happened to be on it.
 */

jest.mock('../../src/config/database', () => ({
  prisma: {
    ai_device: { findUnique: jest.fn() },
    imagine_image: { findMany: jest.fn().mockResolvedValue([]), create: jest.fn() },
  },
}));
jest.mock('@aws-sdk/client-s3', () => ({
  S3Client: jest.fn(() => ({ send: jest.fn() })),
  PutObjectCommand: jest.fn(),
  ListObjectsV2Command: jest.fn(),
  DeleteObjectCommand: jest.fn(),
}));
jest.mock('../../src/utils/logger', () => ({
  info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(),
}));

const { prisma } = require('../../src/config/database');
const uploadService = require('../../src/services/upload.service');

const MAC = 'AA:BB:CC:DD:EE:FF';
const whereOf = () => prisma.imagine_image.findMany.mock.calls[0][0].where;

beforeEach(() => {
  jest.clearAllMocks();
  prisma.imagine_image.findMany.mockResolvedValue([]);
});

describe('whose pictures are these', () => {
  it('reads a paired device by child, so the gallery follows them to a new toy', async () => {
    prisma.ai_device.findUnique.mockResolvedValue({ kid_id: 77n, mac_address: MAC });

    await uploadService.listImagineImages(MAC, null);

    expect(whereOf().owner_key).toBe('kid:77');
  });

  it('reads an unpaired device in its own namespace, which a sibling cannot share', async () => {
    prisma.ai_device.findUnique.mockResolvedValue({ kid_id: null, mac_address: MAC });

    await uploadService.listImagineImages(MAC, null);

    expect(whereOf().owner_key).toBe('mac:aa:bb:cc:dd:ee:ff');
  });

  it('returns nothing for a MAC with no device rather than guessing an owner', async () => {
    prisma.ai_device.findUnique.mockResolvedValue(null);

    await expect(uploadService.listImagineImages(MAC, null)).resolves.toEqual([]);
    expect(prisma.imagine_image.findMany).not.toHaveBeenCalled();
  });

  it('serves one child directly, wherever the pictures were made', async () => {
    await uploadService.listImagineImagesForKid(77n, null);

    expect(whereOf().owner_key).toBe('kid:77');
    // No device lookup at all: the child is the question, the toy is irrelevant.
    expect(prisma.ai_device.findUnique).not.toHaveBeenCalled();
  });
});

describe('the date filter is a query, not a scan of one page', () => {
  it('bounds an IST calendar day in UTC', async () => {
    prisma.ai_device.findUnique.mockResolvedValue({ kid_id: 77n, mac_address: MAC });

    await uploadService.listImagineImages(MAC, '2026-08-12');

    // IST is +05:30, so the day opens at 18:30 UTC the previous date.
    const range = whereOf().created_at;
    expect(range.gte.toISOString()).toBe('2026-08-11T18:30:00.000Z');
    expect(range.lt.toISOString()).toBe('2026-08-12T18:30:00.000Z');
  });

  it('pages with a cursor instead of truncating at a fixed ceiling', async () => {
    prisma.ai_device.findUnique.mockResolvedValue({ kid_id: 77n, mac_address: MAC });

    await uploadService.listImagineImages(MAC, null, { limit: 50, cursor: '900' });

    const call = prisma.imagine_image.findMany.mock.calls[0][0];
    expect(call.take).toBe(50);
    expect(call.where.id).toEqual({ lt: 900n });
    expect(call.orderBy).toEqual({ id: 'desc' });
  });

  it('clamps an absurd limit rather than trusting the caller', async () => {
    prisma.ai_device.findUnique.mockResolvedValue({ kid_id: 77n, mac_address: MAC });

    await uploadService.listImagineImages(MAC, null, { limit: 999999 });

    expect(prisma.imagine_image.findMany.mock.calls[0][0].take).toBe(1000);
  });
});
