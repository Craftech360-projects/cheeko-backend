'use strict';

jest.mock('../../src/config/database', () => ({
  prisma: {
    creator_content: {
      create: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
      count: jest.fn(),
      findMany: jest.fn(),
    },
    creator_content_asset: {
      upsert: jest.fn(),
      updateMany: jest.fn(),
    },
    $transaction: jest.fn(),
  },
}));

jest.mock('fs/promises', () => ({
  mkdir: jest.fn(),
  writeFile: jest.fn(),
  readFile: jest.fn(),
}));

jest.mock('../../src/services/upload.service', () => ({
  uploadContentFile: jest.fn(),
}));

jest.mock('../../src/services/content.service', () => ({
  createMusic: jest.fn(),
  createStory: jest.fn(),
}));

jest.mock('../../src/services/rfid.service', () => ({
  createContentPack: jest.fn(),
}));

const fs = require('fs/promises');
const { prisma } = require('../../src/config/database');
const uploadService = require('../../src/services/upload.service');
const contentService = require('../../src/services/content.service');
const creatorContentService = require('../../src/services/creatorContent.service');

describe('creatorContent.service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('createSubmission', () => {
    it('creates a draft upload submission for the creator', async () => {
      prisma.creator_content.create.mockResolvedValue({
        id: 10n,
        title: 'Moon Music',
        description: 'Soft sleeping track',
        content_type: 'music',
        source_type: 'upload',
        language: 'en',
        category: 'Sleep',
        status: 'draft',
        creator_id: 5n,
        reviewer_id: null,
        review_notes: null,
        aws_uploaded_at: null,
        published_ref_type: null,
        published_ref_id: null,
        created_at: new Date('2026-04-15T10:00:00Z'),
        updated_at: new Date('2026-04-15T10:00:00Z'),
        assets: [],
      });

      const result = await creatorContentService.createSubmission(5, {
        title: 'Moon Music',
        description: 'Soft sleeping track',
        contentType: 'music',
        category: 'Sleep',
      });

      expect(prisma.creator_content.create).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({
          title: 'Moon Music',
          creator_id: 5n,
          status: 'draft',
          content_type: 'music',
        })
      }));
      expect(result.title).toBe('Moon Music');
      expect(result.status).toBe('draft');
      expect(result.contentType).toBe('music');
    });
  });

  describe('uploadSubmissionToAws', () => {
    it('uploads approved assets and creates a published music record', async () => {
      prisma.creator_content.findUnique.mockResolvedValue({
        id: 21n,
        title: 'Bedtime Waves',
        description: 'Ocean sounds for bedtime',
        content_type: 'music',
        source_type: 'upload',
        language: 'en',
        category: 'Sleep',
        status: 'approved',
        creator_id: 5n,
        reviewer_id: null,
        review_notes: null,
        aws_uploaded_at: null,
        published_ref_type: null,
        published_ref_id: null,
        metadata: {},
        created_at: new Date('2026-04-15T10:00:00Z'),
        updated_at: new Date('2026-04-15T10:00:00Z'),
        creator: { id: 5n, username: 'creator', email: 'creator@example.com' },
        reviewer: null,
        assets: [
          {
            id: 1n,
            creator_content_id: 21n,
            asset_type: 'audio',
            storage_type: 'draft',
            original_filename: 'waves.mp3',
            mime_type: 'audio/mpeg',
            local_path: 'storage/creator-content/21/draft/audio-waves.mp3',
            aws_url: null,
            created_at: new Date(),
            updated_at: new Date(),
          },
          {
            id: 2n,
            creator_content_id: 21n,
            asset_type: 'cover_image',
            storage_type: 'draft',
            original_filename: 'cover.png',
            mime_type: 'image/png',
            local_path: 'storage/creator-content/21/draft/cover_image-cover.png',
            aws_url: null,
            created_at: new Date(),
            updated_at: new Date(),
          }
        ]
      });

      prisma.creator_content.update.mockResolvedValue({});
      fs.readFile.mockResolvedValue(Buffer.from('filedata'));
      uploadService.uploadContentFile
        .mockResolvedValueOnce({ url: 'https://cdn.example.com/music/Sleep/waves.mp3' })
        .mockResolvedValueOnce({ url: 'https://cdn.example.com/music/Sleep/cover.png' });
      contentService.createMusic.mockResolvedValue({ id: 'music-123' });

      prisma.$transaction.mockImplementation(async (callback) => callback({
        creator_content_asset: {
          updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        },
        creator_content: {
          update: jest.fn().mockResolvedValue({
            id: 21n,
            title: 'Bedtime Waves',
            description: 'Ocean sounds for bedtime',
            content_type: 'music',
            source_type: 'upload',
            language: 'en',
            category: 'Sleep',
            status: 'uploaded',
            creator_id: 5n,
            reviewer_id: 9n,
            review_notes: null,
            aws_uploaded_at: new Date('2026-04-15T11:00:00Z'),
            published_ref_type: 'music',
            published_ref_id: 'music-123',
            metadata: {},
            created_at: new Date('2026-04-15T10:00:00Z'),
            updated_at: new Date('2026-04-15T11:00:00Z'),
            creator: { id: 5n, username: 'creator', email: 'creator@example.com' },
            reviewer: { id: 9n, username: 'admin', email: 'admin@example.com' },
            assets: [
              {
                id: 1n,
                creator_content_id: 21n,
                asset_type: 'audio',
                storage_type: 'aws',
                original_filename: 'waves.mp3',
                mime_type: 'audio/mpeg',
                local_path: 'storage/creator-content/21/draft/audio-waves.mp3',
                aws_url: 'https://cdn.example.com/music/Sleep/waves.mp3',
                created_at: new Date(),
                updated_at: new Date(),
              }
            ]
          }),
        },
      }));

      const result = await creatorContentService.uploadSubmissionToAws(21, 9);

      expect(uploadService.uploadContentFile).toHaveBeenCalledTimes(2);
      expect(contentService.createMusic).toHaveBeenCalledWith(5, expect.objectContaining({
        title: 'Bedtime Waves',
        fileUrl: 'https://cdn.example.com/music/Sleep/waves.mp3',
        coverUrl: 'https://cdn.example.com/music/Sleep/cover.png',
      }));
      expect(result.status).toBe('uploaded');
      expect(result.publishedRefType).toBe('music');
      expect(result.publishedRefId).toBe('music-123');
    });
  });
});
