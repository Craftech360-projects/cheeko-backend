/**
 * Content Routes
 *
 * Handles music, stories, textbooks, and other educational content.
 * Base path: /content
 */

const express = require('express');
const router = express.Router();
const multer = require('multer');
const contentService = require('../services/content.service');
const uploadService = require('../services/upload.service');
const { asyncHandler } = require('../middleware/errorHandler');
const { requireAuth, requireAdmin } = require('../middleware/auth');
const { requireFlexAuth } = require('../middleware/flexAuth');
const { success, badRequest, notFound } = require('../utils/response');

// Configure multer for memory storage (files go to buffer, then to S3)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 50 * 1024 * 1024, // 50MB max file size
  },
  fileFilter: (req, file, cb) => {
    // Allow audio, image, and binary files (.bin for LVGL ESP32 images)
    const allowedMimes = [
      'audio/mpeg', 'audio/mp3', 'audio/wav', 'audio/ogg', 'audio/m4a',
      'image/jpeg', 'image/png', 'image/gif', 'image/webp',
      'application/octet-stream' // For .bin files (LVGL binary format)
    ];
    // Also check file extension for .bin files (some systems may not set correct MIME)
    const isBinFile = file.originalname && file.originalname.toLowerCase().endsWith('.bin');
    if (allowedMimes.includes(file.mimetype) || isBinFile) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type. Only audio, image, and .bin files are allowed.'));
    }
  }
});

// ==================== CONTENT LIBRARY ROUTES ====================

/**
 * @swagger
 * /content/library:
 *   get:
 *     tags: [Content Library]
 *     summary: List content library items
 *     description: Get paginated list of content from the unified content library
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           default: 1
 *         description: Page number
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 10
 *         description: Items per page
 *       - in: query
 *         name: contentType
 *         schema:
 *           type: string
 *           enum: [music, story]
 *         description: Filter by content type
 *       - in: query
 *         name: category
 *         schema:
 *           type: string
 *         description: Filter by category
 *       - in: query
 *         name: isActive
 *         schema:
 *           type: boolean
 *         description: Filter by active status
 *     responses:
 *       200:
 *         description: Paginated content list
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 code:
 *                   type: integer
 *                   example: 0
 *                 data:
 *                   type: object
 *                   properties:
 *                     list:
 *                       type: array
 *                     total:
 *                       type: integer
 *                     page:
 *                       type: integer
 *                     limit:
 *                       type: integer
 */
router.get('/library',
  requireFlexAuth,
  asyncHandler(async (req, res) => {
    const { page, limit, contentType, category, isActive } = req.query;
    const result = await contentService.getLibraryList({
      page: parseInt(page) || 1,
      limit: parseInt(limit) || 10,
      contentType,
      category,
      isActive
    });
    success(res, result);
  })
);

/**
 * @swagger
 * /content/library/search:
 *   get:
 *     tags: [Content Library]
 *     summary: Search content library
 *     description: Full-text search across content library with pagination
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: q
 *         required: true
 *         schema:
 *           type: string
 *           minLength: 2
 *         description: Search query (min 2 characters)
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           default: 1
 *         description: Page number
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 20
 *         description: Items per page
 *       - in: query
 *         name: contentType
 *         schema:
 *           type: string
 *           enum: [music, story]
 *         description: Filter by content type
 *       - in: query
 *         name: category
 *         schema:
 *           type: string
 *         description: Filter by category
 *     responses:
 *       200:
 *         description: Search results
 *       400:
 *         description: Invalid search query
 */
router.get('/library/search',
  requireFlexAuth,
  asyncHandler(async (req, res) => {
    const { q, page, limit, contentType, category } = req.query;

    if (!q || q.length < 2) {
      return badRequest(res, 'Search query must be at least 2 characters');
    }

    const result = await contentService.searchLibrary(q, {
      page: parseInt(page) || 1,
      limit: parseInt(limit) || 20,
      contentType,
      category
    });
    success(res, result);
  })
);

/**
 * @swagger
 * /content/library/categories:
 *   get:
 *     tags: [Content Library]
 *     summary: Get content categories
 *     description: Get list of all categories in the content library with counts
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: contentType
 *         schema:
 *           type: string
 *           enum: [music, story]
 *         description: Filter by content type
 *     responses:
 *       200:
 *         description: List of categories
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 code:
 *                   type: integer
 *                   example: 0
 *                 data:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       category:
 *                         type: string
 *                       contentType:
 *                         type: string
 *                       count:
 *                         type: integer
 */
router.get('/library/categories',
  requireFlexAuth,
  asyncHandler(async (req, res) => {
    const { contentType } = req.query;
    const categories = await contentService.getLibraryCategories(contentType);
    success(res, categories);
  })
);

/**
 * @swagger
 * /content/library/statistics:
 *   get:
 *     tags: [Content Library]
 *     summary: Get content library statistics
 *     description: Get aggregate statistics about content library items (total, by type, by category)
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Content library statistics
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 code:
 *                   type: integer
 *                   example: 0
 *                 data:
 *                   type: object
 *                   properties:
 *                     total:
 *                       type: integer
 *                     byType:
 *                       type: object
 *                       additionalProperties:
 *                         type: integer
 *                     byCategory:
 *                       type: object
 *                       additionalProperties:
 *                         type: integer
 */
router.get('/library/statistics',
  requireFlexAuth,
  asyncHandler(async (req, res) => {
    const stats = await contentService.getLibraryStatistics();
    success(res, stats);
  })
);

/**
 * @swagger
 * /content/library/batch:
 *   post:
 *     tags: [Content Library]
 *     summary: Batch create content items
 *     description: Create multiple content library items in a single request (Admin only)
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - items
 *             properties:
 *               items:
 *                 type: array
 *                 items:
 *                   type: object
 *                   required:
 *                     - title
 *                     - contentType
 *                   properties:
 *                     title:
 *                       type: string
 *                     romanized:
 *                       type: string
 *                     filename:
 *                       type: string
 *                     contentType:
 *                       type: string
 *                       enum: [music, story]
 *                     category:
 *                       type: string
 *                     alternatives:
 *                       type: array
 *                       items:
 *                         type: string
 *                     awsS3Url:
 *                       type: string
 *                     durationSeconds:
 *                       type: integer
 *                     fileSizeBytes:
 *                       type: integer
 *                     isActive:
 *                       type: integer
 *                       enum: [0, 1]
 *     responses:
 *       200:
 *         description: Batch creation result
 *       400:
 *         description: Invalid input
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Admin access required
 */
router.post('/library/batch',
  requireAdmin,
  asyncHandler(async (req, res) => {
    const { items } = req.body;

    if (!items || !Array.isArray(items) || items.length === 0) {
      return badRequest(res, 'Items must be a non-empty array');
    }

    // Validate each item has required fields
    for (let i = 0; i < items.length; i++) {
      if (!items[i].title || !items[i].contentType) {
        return badRequest(res, `Item at index ${i} is missing required fields (title, contentType)`);
      }
      if (!['music', 'story'].includes(items[i].contentType)) {
        return badRequest(res, `Item at index ${i} has invalid contentType (must be music or story)`);
      }
    }

    try {
      const result = await contentService.batchCreateLibraryItems(items);
      success(res, result, `Successfully created ${result.created} content items`);
    } catch (error) {
      badRequest(res, error.message);
    }
  })
);

/**
 * @swagger
 * /content/library/{id}:
 *   get:
 *     tags: [Content Library]
 *     summary: Get content by ID
 *     description: Get a single content library item by its ID
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Content ID
 *     responses:
 *       200:
 *         description: Content item details
 *       404:
 *         description: Content not found
 */
router.get('/library/:id',
  requireFlexAuth,
  asyncHandler(async (req, res) => {
    const content = await contentService.getLibraryById(req.params.id);
    if (!content) {
      return notFound(res, 'Content not found');
    }
    success(res, content);
  })
);

/**
 * @swagger
 * /content/library:
 *   post:
 *     tags: [Content Library]
 *     summary: Create content item
 *     description: Create a new content library item (Admin only)
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - title
 *               - contentType
 *             properties:
 *               title:
 *                 type: string
 *                 description: Content title
 *               romanized:
 *                 type: string
 *                 description: Romanized title for search
 *               filename:
 *                 type: string
 *                 description: Original filename
 *               contentType:
 *                 type: string
 *                 enum: [music, story]
 *                 description: Type of content
 *               category:
 *                 type: string
 *                 description: Category (language for music, genre for stories)
 *               alternatives:
 *                 type: array
 *                 items:
 *                   type: string
 *                 description: Alternative search terms
 *               awsS3Url:
 *                 type: string
 *                 description: S3 URL for the content file
 *               durationSeconds:
 *                 type: integer
 *                 description: Duration in seconds
 *               fileSizeBytes:
 *                 type: integer
 *                 description: File size in bytes
 *               isActive:
 *                 type: integer
 *                 enum: [0, 1]
 *                 default: 1
 *                 description: Active status (0=inactive, 1=active)
 *     responses:
 *       200:
 *         description: Content created successfully
 *       400:
 *         description: Invalid input
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Admin access required
 */

/**
 * @swagger
 * /content/library/upload:
 *   post:
 *     tags: [Content Library]
 *     summary: Upload content file to S3
 *     description: Upload audio file to AWS S3 and get the CloudFront URL
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             required:
 *               - file
 *               - contentType
 *             properties:
 *               file:
 *                 type: string
 *                 format: binary
 *                 description: Audio file (mp3, wav, ogg, m4a)
 *               contentType:
 *                 type: string
 *                 enum: [music, story]
 *                 description: Type of content
 *               category:
 *                 type: string
 *                 description: Category/language (e.g., English, Hindi)
 *     responses:
 *       200:
 *         description: File uploaded successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 code:
 *                   type: integer
 *                   example: 0
 *                 data:
 *                   type: object
 *                   properties:
 *                     url:
 *                       type: string
 *                     filename:
 *                       type: string
 *       400:
 *         description: Invalid file or missing parameters
 */
router.post('/library/upload',
  requireAdmin,
  upload.single('file'),
  asyncHandler(async (req, res) => {
    if (!req.file) {
      return badRequest(res, 'No file uploaded');
    }

    const { contentType, category } = req.body;

    if (!contentType || !['music', 'story', 'rfidcontent'].includes(contentType)) {
      return badRequest(res, 'Content type must be music, story or rfidcontent');
    }

    try {
      const result = await uploadService.uploadContentFile(
        req.file.buffer,
        req.file.originalname,
        contentType,
        category || 'English',
        req.file.mimetype
      );

      return success(res, result);
    } catch (error) {
      return badRequest(res, error.message);
    }
  })
);

router.post('/library',
  requireAdmin,
  asyncHandler(async (req, res) => {
    const { title, contentType } = req.body;

    if (!title) {
      return badRequest(res, 'Title is required');
    }

    if (!contentType || !['music', 'story'].includes(contentType)) {
      return badRequest(res, 'Content type must be music or story');
    }

    try {
      const content = await contentService.createLibraryItem(req.body);
      success(res, content, 'Content created successfully');
    } catch (error) {
      badRequest(res, error.message);
    }
  })
);

/**
 * @swagger
 * /content/library/{id}:
 *   put:
 *     tags: [Content Library]
 *     summary: Update content item
 *     description: Update an existing content library item (Admin only)
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Content ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               title:
 *                 type: string
 *               romanized:
 *                 type: string
 *               filename:
 *                 type: string
 *               contentType:
 *                 type: string
 *                 enum: [music, story]
 *               category:
 *                 type: string
 *               alternatives:
 *                 type: array
 *                 items:
 *                   type: string
 *               awsS3Url:
 *                 type: string
 *               durationSeconds:
 *                 type: integer
 *               fileSizeBytes:
 *                 type: integer
 *               isActive:
 *                 type: integer
 *                 enum: [0, 1]
 *     responses:
 *       200:
 *         description: Content updated successfully
 *       400:
 *         description: Invalid input
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Admin access required
 *       404:
 *         description: Content not found
 */
router.put('/library/:id',
  requireAdmin,
  asyncHandler(async (req, res) => {
    // Check if content exists
    const existing = await contentService.getLibraryById(req.params.id);
    if (!existing) {
      return notFound(res, 'Content not found');
    }

    // Validate contentType if provided
    if (req.body.contentType && !['music', 'story'].includes(req.body.contentType)) {
      return badRequest(res, 'Content type must be music or story');
    }

    try {
      const content = await contentService.updateLibraryItem(req.params.id, req.body);
      success(res, content, 'Content updated successfully');
    } catch (error) {
      badRequest(res, error.message);
    }
  })
);

/**
 * @swagger
 * /content/library/{id}:
 *   delete:
 *     tags: [Content Library]
 *     summary: Delete content item
 *     description: Delete a content library item (Admin only)
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Content ID
 *     responses:
 *       200:
 *         description: Content deleted successfully
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Admin access required
 *       404:
 *         description: Content not found
 */
router.delete('/library/:id',
  requireAdmin,
  asyncHandler(async (req, res) => {
    // Check if content exists
    const existing = await contentService.getLibraryById(req.params.id);
    if (!existing) {
      return notFound(res, 'Content not found');
    }

    try {
      await contentService.deleteLibraryItem(req.params.id);
      success(res, null, 'Content deleted successfully');
    } catch (error) {
      badRequest(res, error.message);
    }
  })
);

// ==================== MUSIC ROUTES ====================

/**
 * @swagger
 * /content/music/list:
 *   get:
 *     tags: [Content - Music]
 *     summary: Get music list
 *     parameters:
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *       - in: query
 *         name: category
 *         schema:
 *           type: string
 *       - in: query
 *         name: language
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Music list
 */
router.get('/music/list',
  asyncHandler(async (req, res) => {
    const { page, limit, category, language } = req.query;
    const result = await contentService.getMusicList({
      page: parseInt(page) || 1,
      limit: parseInt(limit) || 10,
      category,
      language
    });
    success(res, result);
  })
);

/**
 * @swagger
 * /content/music/{id}:
 *   get:
 *     tags: [Content - Music]
 *     summary: Get music by ID
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Music details
 */
router.get('/music/:id',
  asyncHandler(async (req, res) => {
    const music = await contentService.getMusicById(req.params.id);
    if (!music) {
      return notFound(res, 'Music not found');
    }
    success(res, music);
  })
);

/**
 * @swagger
 * /content/music/create:
 *   post:
 *     tags: [Content - Music]
 *     summary: Create music entry
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - title
 *             properties:
 *               title:
 *                 type: string
 *               artist:
 *                 type: string
 *               album:
 *                 type: string
 *               category:
 *                 type: string
 *               language:
 *                 type: string
 *               duration:
 *                 type: integer
 *               fileUrl:
 *                 type: string
 *               coverUrl:
 *                 type: string
 *               lyrics:
 *                 type: string
 *     responses:
 *       200:
 *         description: Music created
 */
router.post('/music/create',
  requireAuth,
  asyncHandler(async (req, res) => {
    try {
      const music = await contentService.createMusic(req.user.id, req.body);
      success(res, music, 'Music created successfully');
    } catch (error) {
      badRequest(res, error.message);
    }
  })
);

/**
 * @swagger
 * /content/music/update/{id}:
 *   put:
 *     tags: [Content - Music]
 *     summary: Update music
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Music updated
 */
router.put('/music/update/:id',
  requireAuth,
  asyncHandler(async (req, res) => {
    try {
      const music = await contentService.updateMusic(req.params.id, req.body);
      success(res, music, 'Music updated successfully');
    } catch (error) {
      badRequest(res, error.message);
    }
  })
);

/**
 * @swagger
 * /content/music/delete/{id}:
 *   delete:
 *     tags: [Content - Music]
 *     summary: Delete music
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Music deleted
 */
router.delete('/music/delete/:id',
  requireAuth,
  asyncHandler(async (req, res) => {
    try {
      await contentService.deleteMusic(req.params.id);
      success(res, null, 'Music deleted successfully');
    } catch (error) {
      badRequest(res, error.message);
    }
  })
);

// ==================== STORY ROUTES ====================

/**
 * @swagger
 * /content/story/list:
 *   get:
 *     tags: [Content - Story]
 *     summary: Get story list
 *     parameters:
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *       - in: query
 *         name: category
 *         schema:
 *           type: string
 *       - in: query
 *         name: language
 *         schema:
 *           type: string
 *       - in: query
 *         name: ageGroup
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Story list
 */
router.get('/story/list',
  asyncHandler(async (req, res) => {
    const { page, limit, category, language, ageGroup } = req.query;
    const result = await contentService.getStoryList({
      page: parseInt(page) || 1,
      limit: parseInt(limit) || 10,
      category,
      language,
      ageGroup
    });
    success(res, result);
  })
);

/**
 * @swagger
 * /content/story/{id}:
 *   get:
 *     tags: [Content - Story]
 *     summary: Get story by ID
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Story details
 */
router.get('/story/:id',
  asyncHandler(async (req, res) => {
    const story = await contentService.getStoryById(req.params.id);
    if (!story) {
      return notFound(res, 'Story not found');
    }
    success(res, story);
  })
);

/**
 * @swagger
 * /content/story/create:
 *   post:
 *     tags: [Content - Story]
 *     summary: Create story entry
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - title
 *             properties:
 *               title:
 *                 type: string
 *               author:
 *                 type: string
 *               category:
 *                 type: string
 *               language:
 *                 type: string
 *               ageGroup:
 *                 type: string
 *               duration:
 *                 type: integer
 *               content:
 *                 type: string
 *               audioUrl:
 *                 type: string
 *               coverUrl:
 *                 type: string
 *     responses:
 *       200:
 *         description: Story created
 */
router.post('/story/create',
  requireAuth,
  asyncHandler(async (req, res) => {
    try {
      const story = await contentService.createStory(req.user.id, req.body);
      success(res, story, 'Story created successfully');
    } catch (error) {
      badRequest(res, error.message);
    }
  })
);

/**
 * @swagger
 * /content/story/update/{id}:
 *   put:
 *     tags: [Content - Story]
 *     summary: Update story
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Story updated
 */
router.put('/story/update/:id',
  requireAuth,
  asyncHandler(async (req, res) => {
    try {
      const story = await contentService.updateStory(req.params.id, req.body);
      success(res, story, 'Story updated successfully');
    } catch (error) {
      badRequest(res, error.message);
    }
  })
);

/**
 * @swagger
 * /content/story/delete/{id}:
 *   delete:
 *     tags: [Content - Story]
 *     summary: Delete story
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Story deleted
 */
router.delete('/story/delete/:id',
  requireAuth,
  asyncHandler(async (req, res) => {
    try {
      await contentService.deleteStory(req.params.id);
      success(res, null, 'Story deleted successfully');
    } catch (error) {
      badRequest(res, error.message);
    }
  })
);

// ==================== TEXTBOOK ROUTES ====================

/**
 * @swagger
 * /content/textbook/list:
 *   get:
 *     tags: [Content - Textbook]
 *     summary: Get textbook list
 *     parameters:
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *       - in: query
 *         name: subject
 *         schema:
 *           type: string
 *       - in: query
 *         name: grade
 *         schema:
 *           type: string
 *       - in: query
 *         name: language
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Textbook list
 */
router.get('/textbook/list',
  asyncHandler(async (req, res) => {
    const { page, limit, subject, grade, language } = req.query;
    const result = await contentService.getTextbookList({
      page: parseInt(page) || 1,
      limit: parseInt(limit) || 10,
      subject,
      grade,
      language
    });
    success(res, result);
  })
);

/**
 * @swagger
 * /content/textbook/{id}:
 *   get:
 *     tags: [Content - Textbook]
 *     summary: Get textbook by ID with chapters
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Textbook details with chapters
 */
router.get('/textbook/:id',
  asyncHandler(async (req, res) => {
    const textbook = await contentService.getTextbookById(req.params.id);
    if (!textbook) {
      return notFound(res, 'Textbook not found');
    }
    success(res, textbook);
  })
);

/**
 * @swagger
 * /content/textbook/create:
 *   post:
 *     tags: [Content - Textbook]
 *     summary: Create textbook
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - title
 *             properties:
 *               title:
 *                 type: string
 *               subject:
 *                 type: string
 *               grade:
 *                 type: string
 *               language:
 *                 type: string
 *               publisher:
 *                 type: string
 *               coverUrl:
 *                 type: string
 *               description:
 *                 type: string
 *     responses:
 *       200:
 *         description: Textbook created
 */
router.post('/textbook/create',
  requireAuth,
  asyncHandler(async (req, res) => {
    try {
      const textbook = await contentService.createTextbook(req.user.id, req.body);
      success(res, textbook, 'Textbook created successfully');
    } catch (error) {
      badRequest(res, error.message);
    }
  })
);

// ==================== MUSIC PLAYLIST ROUTES ====================

/**
 * @swagger
 * /content/playlist/music/{deviceId}:
 *   get:
 *     tags: [Content - Playlists]
 *     summary: Get music playlist for device
 *     description: Get all music items in a device's playlist ordered by position
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: deviceId
 *         required: true
 *         schema:
 *           type: string
 *         description: Device ID
 *     responses:
 *       200:
 *         description: Music playlist
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 code:
 *                   type: integer
 *                   example: 0
 *                 data:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       id:
 *                         type: integer
 *                       position:
 *                         type: integer
 *                       contentId:
 *                         type: string
 *                       content:
 *                         type: object
 */
router.get('/playlist/music/:deviceId',
  requireFlexAuth,
  asyncHandler(async (req, res) => {
    const playlist = await contentService.getPlaylist(req.params.deviceId, 'music');
    success(res, playlist);
  })
);

/**
 * @swagger
 * /content/playlist/music/{deviceId}:
 *   post:
 *     tags: [Content - Playlists]
 *     summary: Add music to playlist
 *     description: Add a content item to device's music playlist
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: deviceId
 *         required: true
 *         schema:
 *           type: string
 *         description: Device ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - contentId
 *             properties:
 *               contentId:
 *                 type: string
 *                 description: Content ID to add
 *               position:
 *                 type: integer
 *                 description: Position in playlist (appends to end if not specified)
 *     responses:
 *       200:
 *         description: Item added to playlist
 *       400:
 *         description: Invalid input or content already in playlist
 */
router.post('/playlist/music/:deviceId',
  requireFlexAuth,
  asyncHandler(async (req, res) => {
    const { contentId, position } = req.body;

    if (!contentId) {
      return badRequest(res, 'Content ID is required');
    }

    // Verify content exists and is music type
    const content = await contentService.getLibraryById(contentId);
    if (!content) {
      return notFound(res, 'Content not found');
    }
    if (content.content_type !== 'music') {
      return badRequest(res, 'Content must be of type music');
    }

    try {
      const item = await contentService.addToPlaylist(
        req.params.deviceId,
        contentId,
        'music',
        position
      );
      success(res, item, 'Added to music playlist');
    } catch (error) {
      badRequest(res, error.message);
    }
  })
);

/**
 * @swagger
 * /content/playlist/music/{deviceId}/{contentId}:
 *   delete:
 *     tags: [Content - Playlists]
 *     summary: Remove music from playlist
 *     description: Remove a content item from device's music playlist
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: deviceId
 *         required: true
 *         schema:
 *           type: string
 *         description: Device ID
 *       - in: path
 *         name: contentId
 *         required: true
 *         schema:
 *           type: string
 *         description: Content ID to remove
 *     responses:
 *       200:
 *         description: Item removed from playlist
 */
router.delete('/playlist/music/:deviceId/:contentId',
  requireFlexAuth,
  asyncHandler(async (req, res) => {
    try {
      await contentService.removeFromPlaylist(
        req.params.deviceId,
        req.params.contentId,
        'music'
      );
      success(res, null, 'Removed from music playlist');
    } catch (error) {
      badRequest(res, error.message);
    }
  })
);

/**
 * @swagger
 * /content/playlist/music/{deviceId}/clear:
 *   delete:
 *     tags: [Content - Playlists]
 *     summary: Clear music playlist
 *     description: Remove all items from device's music playlist
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: deviceId
 *         required: true
 *         schema:
 *           type: string
 *         description: Device ID
 *     responses:
 *       200:
 *         description: Playlist cleared
 */
router.delete('/playlist/music/:deviceId/clear',
  requireFlexAuth,
  asyncHandler(async (req, res) => {
    try {
      await contentService.clearPlaylist(req.params.deviceId, 'music');
      success(res, null, 'Music playlist cleared');
    } catch (error) {
      badRequest(res, error.message);
    }
  })
);

/**
 * @swagger
 * /content/playlist/music/{deviceId}/reorder:
 *   put:
 *     tags: [Content - Playlists]
 *     summary: Reorder music playlist
 *     description: Reorder items in device's music playlist
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: deviceId
 *         required: true
 *         schema:
 *           type: string
 *         description: Device ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - itemIds
 *             properties:
 *               itemIds:
 *                 type: array
 *                 items:
 *                   type: integer
 *                 description: Playlist item IDs in new order
 *     responses:
 *       200:
 *         description: Playlist reordered
 *       400:
 *         description: Invalid input
 */
router.put('/playlist/music/:deviceId/reorder',
  requireFlexAuth,
  asyncHandler(async (req, res) => {
    const { itemIds } = req.body;

    if (!itemIds || !Array.isArray(itemIds) || itemIds.length === 0) {
      return badRequest(res, 'itemIds must be a non-empty array');
    }

    try {
      const playlist = await contentService.reorderPlaylist(
        req.params.deviceId,
        itemIds,
        'music'
      );
      success(res, playlist, 'Music playlist reordered');
    } catch (error) {
      badRequest(res, error.message);
    }
  })
);

/**
 * @swagger
 * /content/playlist/music/{deviceId}/move:
 *   put:
 *     tags: [Content - Playlists]
 *     summary: Move music playlist item
 *     description: Move a single item to a new position in the playlist
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: deviceId
 *         required: true
 *         schema:
 *           type: string
 *         description: Device ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - itemId
 *               - newPosition
 *             properties:
 *               itemId:
 *                 type: integer
 *                 description: Playlist item ID to move
 *               newPosition:
 *                 type: integer
 *                 description: New position (0-based)
 *     responses:
 *       200:
 *         description: Item moved
 *       400:
 *         description: Invalid input
 */
router.put('/playlist/music/:deviceId/move',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { itemId, newPosition } = req.body;

    if (itemId === undefined || newPosition === undefined) {
      return badRequest(res, 'itemId and newPosition are required');
    }

    try {
      const playlist = await contentService.movePlaylistItem(
        req.params.deviceId,
        itemId,
        newPosition,
        'music'
      );
      success(res, playlist, 'Music playlist item moved');
    } catch (error) {
      badRequest(res, error.message);
    }
  })
);

// ==================== STORY PLAYLIST ROUTES ====================

/**
 * @swagger
 * /content/playlist/story/{deviceId}:
 *   get:
 *     tags: [Content - Playlists]
 *     summary: Get story playlist for device
 *     description: Get all story items in a device's playlist ordered by position
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: deviceId
 *         required: true
 *         schema:
 *           type: string
 *         description: Device ID
 *     responses:
 *       200:
 *         description: Story playlist
 */
router.get('/playlist/story/:deviceId',
  requireFlexAuth,
  asyncHandler(async (req, res) => {
    const playlist = await contentService.getPlaylist(req.params.deviceId, 'story');
    success(res, playlist);
  })
);

/**
 * @swagger
 * /content/playlist/story/{deviceId}:
 *   post:
 *     tags: [Content - Playlists]
 *     summary: Add story to playlist
 *     description: Add a content item to device's story playlist
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: deviceId
 *         required: true
 *         schema:
 *           type: string
 *         description: Device ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - contentId
 *             properties:
 *               contentId:
 *                 type: string
 *                 description: Content ID to add
 *               position:
 *                 type: integer
 *                 description: Position in playlist (appends to end if not specified)
 *     responses:
 *       200:
 *         description: Item added to playlist
 *       400:
 *         description: Invalid input or content already in playlist
 */
router.post('/playlist/story/:deviceId',
  requireFlexAuth,
  asyncHandler(async (req, res) => {
    const { contentId, position } = req.body;

    if (!contentId) {
      return badRequest(res, 'Content ID is required');
    }

    // Verify content exists and is story type
    const content = await contentService.getLibraryById(contentId);
    if (!content) {
      return notFound(res, 'Content not found');
    }
    if (content.content_type !== 'story') {
      return badRequest(res, 'Content must be of type story');
    }

    try {
      const item = await contentService.addToPlaylist(
        req.params.deviceId,
        contentId,
        'story',
        position
      );
      success(res, item, 'Added to story playlist');
    } catch (error) {
      badRequest(res, error.message);
    }
  })
);

/**
 * @swagger
 * /content/playlist/story/{deviceId}/{contentId}:
 *   delete:
 *     tags: [Content - Playlists]
 *     summary: Remove story from playlist
 *     description: Remove a content item from device's story playlist
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: deviceId
 *         required: true
 *         schema:
 *           type: string
 *         description: Device ID
 *       - in: path
 *         name: contentId
 *         required: true
 *         schema:
 *           type: string
 *         description: Content ID to remove
 *     responses:
 *       200:
 *         description: Item removed from playlist
 */
router.delete('/playlist/story/:deviceId/:contentId',
  requireFlexAuth,
  asyncHandler(async (req, res) => {
    try {
      await contentService.removeFromPlaylist(
        req.params.deviceId,
        req.params.contentId,
        'story'
      );
      success(res, null, 'Removed from story playlist');
    } catch (error) {
      badRequest(res, error.message);
    }
  })
);

/**
 * @swagger
 * /content/playlist/story/{deviceId}/clear:
 *   delete:
 *     tags: [Content - Playlists]
 *     summary: Clear story playlist
 *     description: Remove all items from device's story playlist
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: deviceId
 *         required: true
 *         schema:
 *           type: string
 *         description: Device ID
 *     responses:
 *       200:
 *         description: Playlist cleared
 */
router.delete('/playlist/story/:deviceId/clear',
  requireFlexAuth,
  asyncHandler(async (req, res) => {
    try {
      await contentService.clearPlaylist(req.params.deviceId, 'story');
      success(res, null, 'Story playlist cleared');
    } catch (error) {
      badRequest(res, error.message);
    }
  })
);

/**
 * @swagger
 * /content/playlist/story/{deviceId}/reorder:
 *   put:
 *     tags: [Content - Playlists]
 *     summary: Reorder story playlist
 *     description: Reorder items in device's story playlist
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: deviceId
 *         required: true
 *         schema:
 *           type: string
 *         description: Device ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - itemIds
 *             properties:
 *               itemIds:
 *                 type: array
 *                 items:
 *                   type: integer
 *                 description: Playlist item IDs in new order
 *     responses:
 *       200:
 *         description: Playlist reordered
 *       400:
 *         description: Invalid input
 */
router.put('/playlist/story/:deviceId/reorder',
  requireFlexAuth,
  asyncHandler(async (req, res) => {
    const { itemIds } = req.body;

    if (!itemIds || !Array.isArray(itemIds) || itemIds.length === 0) {
      return badRequest(res, 'itemIds must be a non-empty array');
    }

    try {
      const playlist = await contentService.reorderPlaylist(
        req.params.deviceId,
        itemIds,
        'story'
      );
      success(res, playlist, 'Story playlist reordered');
    } catch (error) {
      badRequest(res, error.message);
    }
  })
);

/**
 * @swagger
 * /content/playlist/story/{deviceId}/move:
 *   put:
 *     tags: [Content - Playlists]
 *     summary: Move story playlist item
 *     description: Move a single item to a new position in the playlist
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: deviceId
 *         required: true
 *         schema:
 *           type: string
 *         description: Device ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - itemId
 *               - newPosition
 *             properties:
 *               itemId:
 *                 type: integer
 *                 description: Playlist item ID to move
 *               newPosition:
 *                 type: integer
 *                 description: New position (0-based)
 *     responses:
 *       200:
 *         description: Item moved
 *       400:
 *         description: Invalid input
 */
router.put('/playlist/story/:deviceId/move',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { itemId, newPosition } = req.body;

    if (itemId === undefined || newPosition === undefined) {
      return badRequest(res, 'itemId and newPosition are required');
    }

    try {
      const playlist = await contentService.movePlaylistItem(
        req.params.deviceId,
        itemId,
        newPosition,
        'story'
      );
      success(res, playlist, 'Story playlist item moved');
    } catch (error) {
      badRequest(res, error.message);
    }
  })
);

// ==================== GENERIC CONTENT ROUTES ====================

/**
 * @swagger
 * /content/random/{type}/{mac}:
 *   get:
 *     tags: [Content]
 *     summary: Get random content for device
 *     parameters:
 *       - in: path
 *         name: type
 *         required: true
 *         schema:
 *           type: string
 *           enum: [music, story, textbook]
 *       - in: path
 *         name: mac
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Random content item
 */
router.get('/random/:type/:mac',
  asyncHandler(async (req, res) => {
    const { type, mac } = req.params;

    if (!['music', 'story', 'textbook'].includes(type)) {
      return badRequest(res, 'Invalid content type');
    }

    try {
      const content = await contentService.getRandomContent(mac, type);
      success(res, content);
    } catch (error) {
      notFound(res, error.message);
    }
  })
);

/**
 * @swagger
 * /content/search:
 *   get:
 *     tags: [Content]
 *     summary: Search content across all types
 *     parameters:
 *       - in: query
 *         name: q
 *         required: true
 *         schema:
 *           type: string
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: Search results
 */
router.get('/search',
  asyncHandler(async (req, res) => {
    const { q, page, limit } = req.query;

    if (!q || q.length < 2) {
      return badRequest(res, 'Search query must be at least 2 characters');
    }

    const results = await contentService.searchContent(q, {
      page: parseInt(page) || 1,
      limit: parseInt(limit) || 20
    });
    success(res, results);
  })
);

// ==================== CONTENT ITEMS ROUTES ====================

/**
 * @swagger
 * /content/items:
 *   get:
 *     tags: [Content Items]
 *     summary: Get all content items
 *     description: Returns paginated list of content items with optional filters
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           default: 1
 *         description: Page number
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 10
 *         description: Items per page
 *       - in: query
 *         name: contentType
 *         schema:
 *           type: string
 *         description: Filter by content type (music, story, etc.)
 *       - in: query
 *         name: category
 *         schema:
 *           type: string
 *         description: Filter by category
 *     responses:
 *       200:
 *         description: Paginated content items list
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 code:
 *                   type: integer
 *                 msg:
 *                   type: string
 *                 data:
 *                   type: object
 *                   properties:
 *                     list:
 *                       type: array
 *                       items:
 *                         $ref: '#/components/schemas/ContentItem'
 *                     total:
 *                       type: integer
 *                     page:
 *                       type: integer
 *                     limit:
 *                       type: integer
 *                     pages:
 *                       type: integer
 */
router.get('/items',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { page, limit, contentType, category } = req.query;
    const result = await contentService.getContentItems({
      page: parseInt(page) || 1,
      limit: parseInt(limit) || 10,
      contentType,
      category
    });
    success(res, result);
  })
);

/**
 * @swagger
 * /content/items/search:
 *   get:
 *     tags: [Content Items]
 *     summary: Search content items
 *     description: Full-text search across content items
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: q
 *         required: true
 *         schema:
 *           type: string
 *         description: Search query (min 2 characters)
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           default: 1
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 20
 *       - in: query
 *         name: contentType
 *         schema:
 *           type: string
 *         description: Filter by content type
 *       - in: query
 *         name: category
 *         schema:
 *           type: string
 *         description: Filter by category
 *     responses:
 *       200:
 *         description: Search results
 *       400:
 *         description: Search query too short
 */
router.get('/items/search',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { q, page, limit, contentType, category } = req.query;

    if (!q || q.length < 2) {
      return badRequest(res, 'Search query must be at least 2 characters');
    }

    const result = await contentService.searchContentItems(q, {
      page: parseInt(page) || 1,
      limit: parseInt(limit) || 20,
      contentType,
      category
    });
    success(res, result);
  })
);

/**
 * @swagger
 * /content/items/categories:
 *   get:
 *     tags: [Content Items]
 *     summary: Get categories
 *     description: Get list of unique categories, optionally filtered by content type
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: contentType
 *         schema:
 *           type: string
 *         description: Filter categories by content type
 *     responses:
 *       200:
 *         description: List of categories
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 code:
 *                   type: integer
 *                 msg:
 *                   type: string
 *                 data:
 *                   type: array
 *                   items:
 *                     type: string
 */
router.get('/items/categories',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { contentType } = req.query;
    const categories = await contentService.getContentItemCategories(contentType);
    success(res, categories);
  })
);

/**
 * @swagger
 * /content/items/statistics:
 *   get:
 *     tags: [Content Items]
 *     summary: Get content statistics
 *     description: Get aggregate statistics about content items
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Content statistics
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 code:
 *                   type: integer
 *                 msg:
 *                   type: string
 *                 data:
 *                   type: object
 *                   properties:
 *                     total:
 *                       type: integer
 *                     byType:
 *                       type: object
 *                       additionalProperties:
 *                         type: integer
 *                     byCategory:
 *                       type: object
 *                       additionalProperties:
 *                         type: integer
 */
router.get('/items/statistics',
  requireAuth,
  asyncHandler(async (req, res) => {
    const stats = await contentService.getContentItemStatistics();
    success(res, stats);
  })
);

/**
 * @swagger
 * /content/items/type/{contentType}:
 *   get:
 *     tags: [Content Items]
 *     summary: Get items by type
 *     description: Get content items filtered by content type
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: contentType
 *         required: true
 *         schema:
 *           type: string
 *         description: Content type (music, story, etc.)
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           default: 1
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 10
 *     responses:
 *       200:
 *         description: Items of specified type
 */
router.get('/items/type/:contentType',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { contentType } = req.params;
    const { page, limit } = req.query;
    const result = await contentService.getContentItemsByType(contentType, {
      page: parseInt(page) || 1,
      limit: parseInt(limit) || 10
    });
    success(res, result);
  })
);

/**
 * @swagger
 * /content/items/category/{category}:
 *   get:
 *     tags: [Content Items]
 *     summary: Get items by category
 *     description: Get content items filtered by category
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: category
 *         required: true
 *         schema:
 *           type: string
 *         description: Category name
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           default: 1
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 10
 *     responses:
 *       200:
 *         description: Items in specified category
 */
router.get('/items/category/:category',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { category } = req.params;
    const { page, limit } = req.query;
    const result = await contentService.getContentItemsByCategory(category, {
      page: parseInt(page) || 1,
      limit: parseInt(limit) || 10
    });
    success(res, result);
  })
);

/**
 * @swagger
 * /content/items/{id}:
 *   get:
 *     tags: [Content Items]
 *     summary: Get item by ID
 *     description: Get a specific content item by its ID
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Content item ID
 *     responses:
 *       200:
 *         description: Content item details
 *       404:
 *         description: Item not found
 */
router.get('/items/:id',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { id } = req.params;

    // Skip special routes
    if (['search', 'categories', 'statistics', 'type', 'category', 'batch'].includes(id)) {
      return notFound(res, 'Content item not found');
    }

    const item = await contentService.getContentItemById(id);
    if (!item) {
      return notFound(res, 'Content item not found');
    }
    success(res, item);
  })
);

/**
 * @swagger
 * /content/items:
 *   post:
 *     tags: [Content Items]
 *     summary: Create content item
 *     description: Create a new content item (admin only)
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - title
 *               - contentType
 *             properties:
 *               title:
 *                 type: string
 *                 description: Item title
 *               romanized:
 *                 type: string
 *                 description: Romanized title for search
 *               filename:
 *                 type: string
 *                 description: Original filename
 *               contentType:
 *                 type: string
 *                 description: Content type (music, story, etc.)
 *               category:
 *                 type: string
 *                 description: Category name
 *               alternatives:
 *                 type: array
 *                 items:
 *                   type: string
 *                 description: Alternative titles/names
 *               fileUrl:
 *                 type: string
 *                 description: URL to the file
 *               thumbnailUrl:
 *                 type: string
 *                 description: URL to thumbnail image
 *               durationSeconds:
 *                 type: integer
 *                 description: Duration in seconds
 *     responses:
 *       200:
 *         description: Created content item
 *       400:
 *         description: Validation error
 */
router.post('/items',
  requireAdmin,
  asyncHandler(async (req, res) => {
    const { title, contentType } = req.body;

    if (!title) {
      return badRequest(res, 'Title is required');
    }
    if (!contentType) {
      return badRequest(res, 'Content type is required');
    }

    try {
      const item = await contentService.createContentItem(req.body);
      success(res, item, 'Content item created successfully');
    } catch (error) {
      badRequest(res, error.message);
    }
  })
);

/**
 * @swagger
 * /content/items/batch:
 *   post:
 *     tags: [Content Items]
 *     summary: Batch create content items
 *     description: Create multiple content items at once (admin only)
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - items
 *             properties:
 *               items:
 *                 type: array
 *                 items:
 *                   type: object
 *                   required:
 *                     - title
 *                     - contentType
 *                   properties:
 *                     title:
 *                       type: string
 *                     contentType:
 *                       type: string
 *                     category:
 *                       type: string
 *     responses:
 *       200:
 *         description: Batch creation result
 *       400:
 *         description: Validation error
 */
router.post('/items/batch',
  requireAdmin,
  asyncHandler(async (req, res) => {
    const { items } = req.body;

    if (!items || !Array.isArray(items) || items.length === 0) {
      return badRequest(res, 'Items array is required');
    }

    try {
      const result = await contentService.batchCreateContentItems(items);
      success(res, result, `Created ${result.created} content items`);
    } catch (error) {
      badRequest(res, error.message);
    }
  })
);

/**
 * @swagger
 * /content/items/{id}:
 *   put:
 *     tags: [Content Items]
 *     summary: Update content item
 *     description: Update a content item (admin only)
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Content item ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               title:
 *                 type: string
 *               romanized:
 *                 type: string
 *               filename:
 *                 type: string
 *               contentType:
 *                 type: string
 *               category:
 *                 type: string
 *               alternatives:
 *                 type: array
 *                 items:
 *                   type: string
 *               fileUrl:
 *                 type: string
 *               thumbnailUrl:
 *                 type: string
 *               durationSeconds:
 *                 type: integer
 *     responses:
 *       200:
 *         description: Updated content item
 *       400:
 *         description: Validation error
 */
router.put('/items/:id',
  requireAdmin,
  asyncHandler(async (req, res) => {
    const { id } = req.params;

    try {
      const item = await contentService.updateContentItem(id, req.body);
      success(res, item, 'Content item updated successfully');
    } catch (error) {
      badRequest(res, error.message);
    }
  })
);

/**
 * @swagger
 * /content/items/{id}:
 *   patch:
 *     tags: [Content Items]
 *     summary: Partial update content item
 *     description: Partial update a content item (admin only)
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Content item ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               title:
 *                 type: string
 *               category:
 *                 type: string
 *     responses:
 *       200:
 *         description: Updated content item
 */
router.patch('/items/:id',
  requireAdmin,
  asyncHandler(async (req, res) => {
    const { id } = req.params;

    try {
      const item = await contentService.updateContentItem(id, req.body);
      success(res, item, 'Content item updated successfully');
    } catch (error) {
      badRequest(res, error.message);
    }
  })
);

/**
 * @swagger
 * /content/items/batch:
 *   put:
 *     tags: [Content Items]
 *     summary: Batch update content items
 *     description: Update multiple content items at once (admin only)
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - updates
 *             properties:
 *               updates:
 *                 type: array
 *                 items:
 *                   type: object
 *                   required:
 *                     - id
 *                   properties:
 *                     id:
 *                       type: string
 *                     title:
 *                       type: string
 *                     category:
 *                       type: string
 *     responses:
 *       200:
 *         description: Batch update result
 */
router.put('/items/batch',
  requireAdmin,
  asyncHandler(async (req, res) => {
    const { updates } = req.body;

    if (!updates || !Array.isArray(updates) || updates.length === 0) {
      return badRequest(res, 'Updates array is required');
    }

    try {
      const result = await contentService.batchUpdateContentItems(updates);
      success(res, result, `Updated ${result.updated} content items`);
    } catch (error) {
      badRequest(res, error.message);
    }
  })
);

/**
 * @swagger
 * /content/items/{id}:
 *   delete:
 *     tags: [Content Items]
 *     summary: Delete content item
 *     description: Delete a content item (admin only)
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Content item ID
 *     responses:
 *       200:
 *         description: Item deleted
 *       400:
 *         description: Deletion failed
 */
router.delete('/items/:id',
  requireAdmin,
  asyncHandler(async (req, res) => {
    const { id } = req.params;

    try {
      await contentService.deleteContentItem(id);
      success(res, null, 'Content item deleted successfully');
    } catch (error) {
      badRequest(res, error.message);
    }
  })
);

/**
 * @swagger
 * /content/items/batch:
 *   delete:
 *     tags: [Content Items]
 *     summary: Batch delete content items
 *     description: Delete multiple content items at once (admin only)
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - ids
 *             properties:
 *               ids:
 *                 type: array
 *                 items:
 *                   type: string
 *                 description: Array of content item IDs to delete
 *     responses:
 *       200:
 *         description: Batch deletion result
 *       400:
 *         description: IDs array required
 */
router.delete('/items/batch',
  requireAdmin,
  asyncHandler(async (req, res) => {
    const { ids } = req.body;

    if (!ids || !Array.isArray(ids) || ids.length === 0) {
      return badRequest(res, 'IDs array is required');
    }

    try {
      const result = await contentService.batchDeleteContentItems(ids);
      success(res, result, `Deleted ${result.deleted} content items`);
    } catch (error) {
      badRequest(res, error.message);
    }
  })
);

// ==================== FILE PROXY ROUTE ====================

/**
 * @swagger
 * /content/proxy:
 *   get:
 *     tags: [Content]
 *     summary: Proxy file fetch (bypasses CORS)
 *     description: Fetches a file from URL and returns it. Used for .bin file preview in dashboard.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: url
 *         required: true
 *         schema:
 *           type: string
 *         description: URL of the file to fetch
 *     responses:
 *       200:
 *         description: File content
 *       400:
 *         description: URL parameter required
 *       500:
 *         description: Failed to fetch file
 */
router.get('/proxy',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { url } = req.query;

    if (!url) {
      return badRequest(res, 'URL parameter is required');
    }

    try {
      // Validate URL is from allowed domains (S3/CDN)
      const parsedUrl = new URL(url);
      const allowedHosts = [
        'amazonaws.com',
        'cloudfront.net',
        's3.amazonaws.com',
        'cheeko.co',
        'cheeko.com'
      ];

      const isAllowed = allowedHosts.some(host =>
        parsedUrl.hostname.endsWith(host) || parsedUrl.hostname.includes(host)
      );

      if (!isAllowed) {
        return badRequest(res, 'URL domain not allowed');
      }

      // Fetch the file
      const fetch = (await import('node-fetch')).default;
      const response = await fetch(url);

      if (!response.ok) {
        throw new Error(`Failed to fetch: ${response.status}`);
      }

      // Get content type and set headers
      const contentType = response.headers.get('content-type') || 'application/octet-stream';
      res.setHeader('Content-Type', contentType);
      res.setHeader('Cache-Control', 'public, max-age=3600'); // Cache for 1 hour

      // Stream the response
      const buffer = await response.buffer();
      res.send(buffer);

    } catch (error) {
      console.error('Proxy fetch error:', error);
      res.status(500).json({ code: 1, msg: `Failed to fetch file: ${error.message}` });
    }
  })
);

/**
 * @swagger
 * components:
 *   schemas:
 *     ContentItem:
 *       type: object
 *       properties:
 *         id:
 *           type: string
 *         title:
 *           type: string
 *         romanized:
 *           type: string
 *         filename:
 *           type: string
 *         content_type:
 *           type: string
 *         category:
 *           type: string
 *         alternatives:
 *           type: array
 *           items:
 *             type: string
 *         file_url:
 *           type: string
 *         thumbnail_url:
 *           type: string
 *         duration_seconds:
 *           type: integer
 *         created_at:
 *           type: string
 *           format: date-time
 *         updated_at:
 *           type: string
 *           format: date-time
 */

module.exports = router;
