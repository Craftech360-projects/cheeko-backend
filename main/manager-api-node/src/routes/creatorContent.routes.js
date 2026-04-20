/**
 * Creator Content Routes
 *
 * Separate creator-portal workflow for draft uploads, review, and manual AWS publishing.
 */

const express = require('express');
const multer = require('multer');

const creatorContentService = require('../services/creatorContent.service');
const creatorGenerationService = require('../services/creatorGeneration.service');
const { asyncHandler } = require('../middleware/errorHandler');
const { optionalAuth, requireAdmin } = require('../middleware/auth');
const { success, badRequest, created } = require('../utils/response');

const router = express.Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 25 * 1024 * 1024
  }
});

const ALLOWED_CONTENT_TYPES = new Set(['music', 'story', 'rfidcontent']);

const parsePagination = (query) => ({
  page: Math.max(parseInt(query.page, 10) || 1, 1),
  limit: Math.min(Math.max(parseInt(query.limit, 10) || 20, 1), 100)
});

const getAnonymousSessionId = (req) => {
  const value = req.headers['x-creator-session-id'];
  return typeof value === 'string' && value.trim() ? value.trim().slice(0, 128) : null;
};

const getCreatorActor = async (req) => {
  if (req.user?.id) {
    return {
      userId: req.user.id,
      anonymousSessionId: null
    };
  }

  return {
    userId: await creatorContentService.getPublicCreatorId(),
    anonymousSessionId: getAnonymousSessionId(req)
  };
};

router.post('/content',
  optionalAuth,
  asyncHandler(async (req, res) => {
    const { title, description, contentType, sourceType, language, category, metadata } = req.body;
    const actor = await getCreatorActor(req);

    if (!title?.trim()) {
      return badRequest(res, 'Title is required');
    }

    if (contentType && !ALLOWED_CONTENT_TYPES.has(contentType)) {
      return badRequest(res, 'Content type must be music, story or rfidcontent');
    }

    const submission = await creatorContentService.createSubmission(actor.userId, {
      title: title.trim(),
      description,
      contentType,
      sourceType,
      language,
      category,
      metadata: {
        ...(metadata || {}),
        ...(actor.anonymousSessionId ? { anonymousSessionId: actor.anonymousSessionId } : {})
      }
    });

    return created(res, submission, 'Draft submission created');
  })
);

router.get('/content/my',
  optionalAuth,
  asyncHandler(async (req, res) => {
    const actor = await getCreatorActor(req);
    const result = await creatorContentService.listCreatorSubmissions(actor.userId, {
      status: req.query.status,
      anonymousSessionId: actor.anonymousSessionId,
      ...parsePagination(req.query)
    });
    success(res, result);
  })
);

router.get('/content/:id',
  optionalAuth,
  asyncHandler(async (req, res) => {
    const actor = await getCreatorActor(req);
    const submission = await creatorContentService.getCreatorSubmission(req.params.id, actor.userId, {
      anonymousSessionId: actor.anonymousSessionId
    });
    success(res, submission);
  })
);

router.put('/content/:id',
  optionalAuth,
  asyncHandler(async (req, res) => {
    const { title, description, contentType, sourceType, language, category, metadata } = req.body;
    const actor = await getCreatorActor(req);

    if (contentType && !ALLOWED_CONTENT_TYPES.has(contentType)) {
      return badRequest(res, 'Content type must be music, story or rfidcontent');
    }

    const submission = await creatorContentService.updateSubmission(req.params.id, actor.userId, {
      title,
      description,
      contentType,
      sourceType,
      language,
      category,
      metadata
    }, {
      anonymousSessionId: actor.anonymousSessionId
    });

    success(res, submission, 'Draft submission updated');
  })
);

router.post('/content/:id/assets',
  optionalAuth,
  upload.fields([
    { name: 'audio', maxCount: 1 },
    { name: 'coverImage', maxCount: 1 }
  ]),
  asyncHandler(async (req, res) => {
    const uploadedFiles = req.files || {};
    const results = {};
    const actor = await getCreatorActor(req);

    if (!uploadedFiles.audio?.[0] && !uploadedFiles.coverImage?.[0]) {
      return badRequest(res, 'At least one asset file is required');
    }

    if (uploadedFiles.audio?.[0]) {
      results.audio = await creatorContentService.upsertDraftAsset(
        req.params.id,
        actor.userId,
        'audio',
        uploadedFiles.audio[0],
        { anonymousSessionId: actor.anonymousSessionId }
      );
    }

    if (uploadedFiles.coverImage?.[0]) {
      results.coverImage = await creatorContentService.upsertDraftAsset(
        req.params.id,
        actor.userId,
        'cover_image',
        uploadedFiles.coverImage[0],
        { anonymousSessionId: actor.anonymousSessionId }
      );
    }

    success(res, results, 'Draft assets saved');
  })
);

router.post('/content/:id/submit-review',
  optionalAuth,
  asyncHandler(async (req, res) => {
    const actor = await getCreatorActor(req);
    const submission = await creatorContentService.submitForReview(req.params.id, actor.userId, {
      anonymousSessionId: actor.anonymousSessionId
    });
    success(res, submission, 'Submission sent for review');
  })
);

router.post('/generation',
  optionalAuth,
  asyncHandler(async (req, res) => {
    const {
      title,
      topic,
      description,
      contentType,
      language,
      category,
      generationMode,
      stepCount,
      esp32Mode
    } = req.body;
    const actor = await getCreatorActor(req);

    if (!title?.trim()) {
      return badRequest(res, 'Title is required');
    }

    if (!topic?.trim()) {
      return badRequest(res, 'Topic is required');
    }

    if (contentType && !ALLOWED_CONTENT_TYPES.has(contentType)) {
      return badRequest(res, 'Content type must be music, story or rfidcontent');
    }

    const result = await creatorGenerationService.startGenerationJob(actor.userId, {
      title: title.trim(),
      topic: topic.trim(),
      description,
      contentType: contentType || 'story',
      language: language || 'en',
      category,
      generationMode,
      stepCount,
      esp32Mode,
      anonymousSessionId: actor.anonymousSessionId
    });

    return created(res, result, 'Generation job created');
  })
);

router.get('/generation/:jobId',
  optionalAuth,
  asyncHandler(async (req, res) => {
    const actor = await getCreatorActor(req);
    const result = await creatorGenerationService.getGenerationJob(req.params.jobId, actor.userId, {
      anonymousSessionId: actor.anonymousSessionId
    });
    success(res, result);
  })
);

router.post('/generation/:jobId/retry',
  optionalAuth,
  asyncHandler(async (req, res) => {
    const actor = await getCreatorActor(req);
    const result = await creatorGenerationService.retryGenerationJob(req.params.jobId, actor.userId, {
      anonymousSessionId: actor.anonymousSessionId
    });
    success(res, result, 'Generation job queued for retry');
  })
);

router.get('/review/content',
  requireAdmin,
  asyncHandler(async (req, res) => {
    const result = await creatorContentService.listReviewQueue({
      status: req.query.status,
      ...parsePagination(req.query)
    });
    success(res, result);
  })
);

router.get('/review/content/:id',
  requireAdmin,
  asyncHandler(async (req, res) => {
    const submission = await creatorContentService.getCreatorSubmission(req.params.id, req.user.id, {
      allowReviewer: true
    });
    success(res, submission);
  })
);

router.post('/review/content/:id/approve',
  requireAdmin,
  asyncHandler(async (req, res) => {
    const submission = await creatorContentService.approveSubmission(
      req.params.id,
      req.user.id,
      req.body.reviewNotes
    );
    success(res, submission, 'Submission approved');
  })
);

router.post('/review/content/:id/reject',
  requireAdmin,
  asyncHandler(async (req, res) => {
    const submission = await creatorContentService.rejectSubmission(
      req.params.id,
      req.user.id,
      req.body.reviewNotes
    );
    success(res, submission, 'Submission rejected');
  })
);

router.post('/review/content/:id/upload',
  requireAdmin,
  asyncHandler(async (req, res) => {
    const submission = await creatorContentService.uploadSubmissionToAws(req.params.id, req.user.id);
    success(res, submission, 'Submission uploaded to AWS');
  })
);

module.exports = router;
