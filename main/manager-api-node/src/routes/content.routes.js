/**
 * Content Routes
 *
 * Handles music, stories, textbooks, and other educational content.
 * Base path: /content
 */

const express = require('express');
const router = express.Router();
const contentService = require('../services/content.service');
const { asyncHandler } = require('../middleware/errorHandler');
const { requireAuth, requireAdmin } = require('../middleware/auth');
const { success, badRequest, notFound } = require('../utils/response');

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
  requireAuth,
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
  requireAuth,
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
  requireAuth,
  asyncHandler(async (req, res) => {
    const { contentType } = req.query;
    const categories = await contentService.getLibraryCategories(contentType);
    success(res, categories);
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
  requireAuth,
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

module.exports = router;
