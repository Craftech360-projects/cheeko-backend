/**
 * Creator Content Service
 *
 * Handles creator-owned draft submissions, reviewer actions, staged assets,
 * and manual AWS upload for approved submissions.
 */

const fs = require('fs/promises');
const path = require('path');

const { prisma } = require('../config/database');
const logger = require('../utils/logger');
const uploadService = require('./upload.service');
const contentService = require('./content.service');
const rfidService = require('./rfid.service');

const STORAGE_ROOT = path.resolve(__dirname, '../../storage/creator-content');
const EDITABLE_STATUSES = new Set(['draft', 'rejected', 'failed']);
const REVIEWABLE_STATUSES = new Set(['in_review', 'approved']);
const PUBLIC_CREATOR_USERNAME = process.env.CREATOR_PORTAL_PUBLIC_USERNAME || 'creator_portal_guest';

const sanitizeFilename = (value) => {
  const cleaned = (value || 'file')
    .replace(/[^a-zA-Z0-9.\-_ ]/g, '')
    .trim()
    .replace(/\s+/g, '-');
  return cleaned || 'file';
};

const ensureDir = async (dirPath) => {
  await fs.mkdir(dirPath, { recursive: true });
};

const getContentFolder = (contentId) => path.join(STORAGE_ROOT, String(contentId), 'draft');

const getRelativeStoragePath = (absolutePath) => path.relative(path.resolve(__dirname, '../..'), absolutePath).replace(/\\/g, '/');

const resolveStoragePath = (storedPath) => {
  if (!storedPath) return null;
  return path.isAbsolute(storedPath)
    ? storedPath
    : path.resolve(__dirname, '../..', storedPath);
};

const randomPackCode = (title) => {
  const prefix = (title || 'CP')
    .replace(/[^a-zA-Z]/g, '')
    .toUpperCase()
    .slice(0, 2)
    .padEnd(2, 'C');
  const suffix = `${Math.floor(Math.random() * 900000) + 100000}`;
  return `${prefix}${suffix}`;
};

const getPublicCreatorId = async () => {
  const existing = await prisma.sys_user.findUnique({
    where: { username: PUBLIC_CREATOR_USERNAME },
    select: { id: true }
  });

  if (existing) {
    return existing.id;
  }

  try {
    const created = await prisma.sys_user.create({
      data: {
        username: PUBLIC_CREATOR_USERNAME,
        nickname: 'Creator Portal Guest',
        role: 'user',
        status: 1
      },
      select: { id: true }
    });
    return created.id;
  } catch (error) {
    const raced = await prisma.sys_user.findUnique({
      where: { username: PUBLIC_CREATOR_USERNAME },
      select: { id: true }
    });
    if (raced) {
      return raced.id;
    }
    throw error;
  }
};

const mapSubmission = (submission) => {
  if (!submission) return null;

  return {
    ...submission,
    creatorId: submission.creator_id,
    reviewerId: submission.reviewer_id,
    contentType: submission.content_type,
    sourceType: submission.source_type,
    reviewNotes: submission.review_notes,
    awsUploadedAt: submission.aws_uploaded_at,
    publishedRefType: submission.published_ref_type,
    publishedRefId: submission.published_ref_id,
    createdAt: submission.created_at,
    updatedAt: submission.updated_at,
    creator: submission.creator ? {
      id: submission.creator.id,
      username: submission.creator.username,
      email: submission.creator.email
    } : null,
    reviewer: submission.reviewer ? {
      id: submission.reviewer.id,
      username: submission.reviewer.username,
      email: submission.reviewer.email
    } : null,
    assets: (submission.assets || []).map((asset) => ({
      ...asset,
      creatorContentId: asset.creator_content_id,
      assetType: asset.asset_type,
      storageType: asset.storage_type,
      originalFilename: asset.original_filename,
      mimeType: asset.mime_type,
      localPath: asset.local_path,
      awsUrl: asset.aws_url,
      createdAt: asset.created_at,
      updatedAt: asset.updated_at
    }))
  };
};

const getSubmission = async (contentId) => prisma.creator_content.findUnique({
  where: { id: BigInt(contentId) },
  include: {
    creator: {
      select: { id: true, username: true, email: true }
    },
    reviewer: {
      select: { id: true, username: true, email: true }
    },
    assets: {
      orderBy: { created_at: 'asc' }
    }
  }
});

const requireSubmission = async (contentId) => {
  const submission = await getSubmission(contentId);
  if (!submission) {
    throw new Error('Content submission not found');
  }
  return submission;
};

const ensureOwner = (submission, userId, { anonymousSessionId } = {}) => {
  const isUserOwner = userId && submission.creator_id && submission.creator_id === BigInt(userId);
  const isSessionOwner = anonymousSessionId &&
    submission.metadata?.anonymousSessionId &&
    submission.metadata.anonymousSessionId === anonymousSessionId;

  if (!isUserOwner && !isSessionOwner) {
    throw new Error('You do not have access to this content submission');
  }
};

const ensureEditable = (submission) => {
  if (!EDITABLE_STATUSES.has(submission.status)) {
    throw new Error(`Submission is not editable while in '${submission.status}' state`);
  }
};

const createSubmission = async (userId, payload) => {
  const created = await prisma.creator_content.create({
    data: {
      title: payload.title,
      description: payload.description || null,
      content_type: payload.contentType || 'music',
      source_type: payload.sourceType || 'upload',
      language: payload.language || 'en',
      category: payload.category || null,
      status: 'draft',
      creator_id: BigInt(userId),
      metadata: payload.metadata || {}
    },
    include: {
      assets: true
    }
  });

  return mapSubmission(created);
};

const updateSubmission = async (contentId, userId, payload, options = {}) => {
  const submission = await requireSubmission(contentId);
  ensureOwner(submission, userId, options);
  ensureEditable(submission);

  const updated = await prisma.creator_content.update({
    where: { id: submission.id },
    data: {
      title: payload.title ?? submission.title,
      description: payload.description ?? submission.description,
      content_type: payload.contentType ?? submission.content_type,
      source_type: payload.sourceType ?? submission.source_type,
      language: payload.language ?? submission.language,
      category: payload.category ?? submission.category,
      metadata: payload.metadata ?? submission.metadata,
      updated_at: new Date()
    },
    include: {
      creator: {
        select: { id: true, username: true, email: true }
      },
      reviewer: {
        select: { id: true, username: true, email: true }
      },
      assets: true
    }
  });

  return mapSubmission(updated);
};

const upsertDraftAsset = async (contentId, userId, assetType, file, options = {}) => {
  const submission = await requireSubmission(contentId);
  ensureOwner(submission, userId, options);
  ensureEditable(submission);

  const folder = getContentFolder(contentId);
  await ensureDir(folder);

  const extension = path.extname(file.originalname || '') || '';
  const safeBase = sanitizeFilename(path.basename(file.originalname || assetType, extension));
  const absolutePath = path.join(folder, `${assetType}-${safeBase}${extension}`);
  await fs.writeFile(absolutePath, file.buffer);

  const storedPath = getRelativeStoragePath(absolutePath);

  const asset = await prisma.creator_content_asset.upsert({
    where: {
      creator_content_id_asset_type: {
        creator_content_id: submission.id,
        asset_type: assetType
      }
    },
    update: {
      storage_type: 'draft',
      original_filename: file.originalname,
      mime_type: file.mimetype,
      local_path: storedPath,
      aws_url: null,
      updated_at: new Date()
    },
    create: {
      creator_content_id: submission.id,
      asset_type: assetType,
      storage_type: 'draft',
      original_filename: file.originalname,
      mime_type: file.mimetype,
      local_path: storedPath
    }
  });

  return {
    ...asset,
    assetType: asset.asset_type,
    storageType: asset.storage_type,
    localPath: asset.local_path,
    awsUrl: asset.aws_url
  };
};

const submitForReview = async (contentId, userId, options = {}) => {
  const submission = await requireSubmission(contentId);
  ensureOwner(submission, userId, options);
  ensureEditable(submission);

  if (submission.source_type === 'generated') {
    const generatedItems = submission.metadata?.generatedItems || [];
    if (!Array.isArray(generatedItems) || generatedItems.length === 0) {
      throw new Error('Generated content must finish successfully before submitting for review');
    }
  } else {
    const assetTypes = new Set((submission.assets || []).map((asset) => asset.asset_type));
    if (!assetTypes.has('audio') || !assetTypes.has('cover_image')) {
      throw new Error('Audio and cover image are both required before submitting for review');
    }
  }

  const updated = await prisma.creator_content.update({
    where: { id: submission.id },
    data: {
      status: 'in_review',
      review_notes: null,
      reviewer_id: null,
      updated_at: new Date()
    },
    include: {
      creator: {
        select: { id: true, username: true, email: true }
      },
      reviewer: {
        select: { id: true, username: true, email: true }
      },
      assets: true
    }
  });

  return mapSubmission(updated);
};

const getCreatorSubmission = async (contentId, userId, options = {}) => {
  const submission = await requireSubmission(contentId);
  if (!options.allowReviewer) {
    ensureOwner(submission, userId, options);
  }
  return mapSubmission(submission);
};

const listCreatorSubmissions = async (userId, { status, page = 1, limit = 20, anonymousSessionId } = {}) => {
  const where = {
    creator_id: BigInt(userId)
  };
  if (status) {
    where.status = status;
  }
  if (anonymousSessionId) {
    where.metadata = {
      path: ['anonymousSessionId'],
      equals: anonymousSessionId
    };
  }

  const skip = (page - 1) * limit;
  const [total, submissions] = await Promise.all([
    prisma.creator_content.count({ where }),
    prisma.creator_content.findMany({
      where,
      include: {
        creator: {
          select: { id: true, username: true, email: true }
        },
        reviewer: {
          select: { id: true, username: true, email: true }
        },
        assets: true
      },
      orderBy: { updated_at: 'desc' },
      skip,
      take: limit
    })
  ]);

  return {
    list: submissions.map(mapSubmission),
    total,
    page,
    limit
  };
};

const listReviewQueue = async ({ status, page = 1, limit = 20 } = {}) => {
  const where = {};
  if (status) {
    where.status = status;
  } else {
    where.status = { in: ['in_review', 'approved', 'uploading', 'failed'] };
  }

  const skip = (page - 1) * limit;
  const [total, submissions] = await Promise.all([
    prisma.creator_content.count({ where }),
    prisma.creator_content.findMany({
      where,
      include: {
        creator: {
          select: { id: true, username: true, email: true }
        },
        reviewer: {
          select: { id: true, username: true, email: true }
        },
        assets: true
      },
      orderBy: [
        { status: 'asc' },
        { updated_at: 'desc' }
      ],
      skip,
      take: limit
    })
  ]);

  return {
    list: submissions.map(mapSubmission),
    total,
    page,
    limit
  };
};

const reviewSubmission = async (contentId, reviewerId, nextStatus, reviewNotes) => {
  const submission = await requireSubmission(contentId);
  if (!REVIEWABLE_STATUSES.has(submission.status) && submission.status !== 'rejected') {
    throw new Error(`Submission cannot be reviewed while in '${submission.status}' state`);
  }

  const updated = await prisma.creator_content.update({
    where: { id: submission.id },
    data: {
      status: nextStatus,
      review_notes: reviewNotes || null,
      reviewer_id: BigInt(reviewerId),
      updated_at: new Date()
    },
    include: {
      creator: {
        select: { id: true, username: true, email: true }
      },
      reviewer: {
        select: { id: true, username: true, email: true }
      },
      assets: true
    }
  });

  return mapSubmission(updated);
};

const approveSubmission = async (contentId, reviewerId, reviewNotes) =>
  reviewSubmission(contentId, reviewerId, 'approved', reviewNotes);

const rejectSubmission = async (contentId, reviewerId, reviewNotes) =>
  reviewSubmission(contentId, reviewerId, 'rejected', reviewNotes);

const createPublishedContentRecord = async (submission, assetUrls) => {
  const creatorId = submission.creator_id ? Number(submission.creator_id) : null;

  if (submission.content_type === 'music') {
    const createdMusic = await contentService.createMusic(creatorId, {
      title: submission.title,
      category: submission.category,
      language: submission.language,
      fileUrl: assetUrls.audio,
      coverUrl: assetUrls.cover_image,
      status: 1
    });

    return {
      publishedRefType: 'music',
      publishedRefId: createdMusic.id
    };
  }

  if (submission.content_type === 'story') {
    const createdStory = await contentService.createStory(creatorId, {
      title: submission.title,
      category: submission.category,
      language: submission.language,
      audioUrl: assetUrls.audio,
      coverUrl: assetUrls.cover_image,
      status: 1
    });

    return {
      publishedRefType: 'story',
      publishedRefId: createdStory.id
    };
  }

  return {
    publishedRefType: null,
    publishedRefId: null
  };
};

const uploadGeneratedContentPack = async (submission, reviewerId) => {
  const generatedItems = submission.metadata?.generatedItems || [];
  const categoryFolder = submission.category || randomPackCode(submission.title);

  if (!Array.isArray(generatedItems) || generatedItems.length === 0) {
    throw new Error('No generated draft items found to upload');
  }

  const packItems = [];

  for (const item of generatedItems) {
    const itemNumber = String(item.step || packItems.length + 1).padStart(2, '0');
    const itemPayload = {
      itemNumber: item.step || packItems.length + 1,
      title: item.title || `Step ${item.step}`,
      text: item.text || ''
    };

    if (item.audioPath) {
      const audioAbsolutePath = resolveStoragePath(item.audioPath);
      const audioExtension = path.extname(audioAbsolutePath) || '.mp3';
      const audioBuffer = await fs.readFile(audioAbsolutePath);
      const audioUpload = await uploadService.uploadContentFile(
        audioBuffer,
        `${itemNumber}${audioExtension}`,
        submission.content_type,
        categoryFolder,
        audioExtension === '.wav' ? 'audio/wav' : 'audio/mpeg'
      );
      itemPayload.audioUrl = audioUpload.url;
    }

    if (item.imagePath) {
      const imageAbsolutePath = resolveStoragePath(item.imagePath);
      const imageBuffer = await fs.readFile(imageAbsolutePath);
      const imageExtension = path.extname(imageAbsolutePath) || '.png';
      const mimeType = imageExtension === '.jpg' || imageExtension === '.jpeg' ? 'image/jpeg' : 'image/png';
      const imageUpload = await uploadService.uploadContentFile(
        imageBuffer,
        `${itemNumber}${imageExtension}`,
        submission.content_type,
        categoryFolder,
        mimeType
      );
      itemPayload.imageUrl = imageUpload.url;
    }

    packItems.push(itemPayload);
  }

  const packCode = randomPackCode(submission.title);

  await rfidService.createContentPack({
    packCode,
    name: submission.title,
    description: submission.description || `Generated ${submission.content_type} content from creator portal`,
    contentType: submission.content_type || 'rfidcontent',
    language: submission.language || 'en',
    active: true,
    totalItems: packItems.length,
    items: packItems
  }, reviewerId);

  return {
    publishedRefType: 'content_pack',
    publishedRefId: packCode,
    generatedItems: packItems,
    categoryFolder
  };
};

const uploadSubmissionToAws = async (contentId, reviewerId) => {
  const submission = await requireSubmission(contentId);

  if (submission.status !== 'approved' && submission.status !== 'failed') {
    throw new Error(`Submission must be approved before upload. Current state: '${submission.status}'`);
  }

  await prisma.creator_content.update({
    where: { id: submission.id },
    data: {
      status: 'uploading',
      reviewer_id: BigInt(reviewerId),
      updated_at: new Date()
    }
  });

  try {
    let publishedRecord = null;
    let updated = null;

    if (submission.source_type === 'generated') {
      publishedRecord = await uploadGeneratedContentPack(submission, reviewerId);

      updated = await prisma.creator_content.update({
        where: { id: submission.id },
        data: {
          status: 'uploaded',
          reviewer_id: BigInt(reviewerId),
          aws_uploaded_at: new Date(),
          published_ref_type: publishedRecord.publishedRefType,
          published_ref_id: publishedRecord.publishedRefId ? String(publishedRecord.publishedRefId) : null,
          metadata: {
            ...(submission.metadata || {}),
            uploadedGeneratedItems: publishedRecord.generatedItems,
            uploadedCategoryFolder: publishedRecord.categoryFolder
          },
          updated_at: new Date()
        },
        include: {
          creator: {
            select: { id: true, username: true, email: true }
          },
          reviewer: {
            select: { id: true, username: true, email: true }
          },
          assets: true
        }
      });
    } else {
      const assets = submission.assets || [];
      const audioAsset = assets.find((asset) => asset.asset_type === 'audio');
      const coverImageAsset = assets.find((asset) => asset.asset_type === 'cover_image');

      if (!audioAsset || !coverImageAsset) {
        throw new Error('Both audio and cover image must be present before AWS upload');
      }

      const assetUploads = {};

      for (const asset of [audioAsset, coverImageAsset]) {
        const filePath = resolveStoragePath(asset.local_path);
        const fileBuffer = await fs.readFile(filePath);
        const uploadResult = await uploadService.uploadContentFile(
          fileBuffer,
          asset.original_filename || `${asset.asset_type}`,
          submission.content_type,
          submission.category || 'CreatorPortal',
          asset.mime_type || undefined
        );

        assetUploads[asset.asset_type] = uploadResult.url;
      }

      publishedRecord = await createPublishedContentRecord(submission, assetUploads);

      updated = await prisma.$transaction(async (tx) => {
        await Promise.all(Object.entries(assetUploads).map(([assetType, awsUrl]) =>
          tx.creator_content_asset.updateMany({
            where: {
              creator_content_id: submission.id,
              asset_type: assetType
            },
            data: {
              aws_url: awsUrl,
              storage_type: 'aws',
              updated_at: new Date()
            }
          })
        ));

        return tx.creator_content.update({
          where: { id: submission.id },
          data: {
            status: 'uploaded',
            reviewer_id: BigInt(reviewerId),
            aws_uploaded_at: new Date(),
            published_ref_type: publishedRecord.publishedRefType,
            published_ref_id: publishedRecord.publishedRefId ? String(publishedRecord.publishedRefId) : null,
            updated_at: new Date()
          },
          include: {
            creator: {
              select: { id: true, username: true, email: true }
            },
            reviewer: {
              select: { id: true, username: true, email: true }
            },
            assets: true
          }
        });
      });
    }

    return mapSubmission(updated);
  } catch (error) {
    logger.error('Failed to upload creator content to AWS', {
      contentId: String(contentId),
      error: error.message
    });

    await prisma.creator_content.update({
      where: { id: submission.id },
      data: {
        status: 'failed',
        reviewer_id: BigInt(reviewerId),
        review_notes: error.message,
        updated_at: new Date()
      }
    });

    throw error;
  }
};

module.exports = {
  getPublicCreatorId,
  createSubmission,
  updateSubmission,
  upsertDraftAsset,
  submitForReview,
  getCreatorSubmission,
  listCreatorSubmissions,
  listReviewQueue,
  approveSubmission,
  rejectSubmission,
  uploadSubmissionToAws
};
