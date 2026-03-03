/**
 * Content Service
 *
 * Handles music, stories, textbooks, and other educational content.
 * Includes unified content library management.
 */

const { prisma } = require('../config/database');
const logger = require('../utils/logger');

// ==================== CONTENT LIBRARY METHODS ====================

/**
 * Get content library list with pagination
 * @param {Object} options - Filter and pagination options
 * @returns {Promise<Object>} Paginated content list
 */
const getLibraryList = async ({ page = 1, limit = 10, contentType, category, isActive } = {}) => {
  const offset = (page - 1) * limit;

  const where = {};

  if (contentType) {
    where.content_type = contentType;
  }

  if (category) {
    where.category = category;
  }

  if (isActive !== undefined) {
    const activeValue = isActive === true || isActive === 'true' || isActive === 1 ? 1 : 0;
    where.status = activeValue;
  }

  const [total, content] = await Promise.all([
    prisma.content_library.count({ where }),
    prisma.content_library.findMany({
      where,
      orderBy: { created_at: 'desc' },
      skip: offset,
      take: limit
    })
  ]);

  return {
    list: content || [],
    total: total || 0,
    page,
    limit
  };
};

/**
 * Search content library with full-text search
 * @param {string} query - Search query
 * @param {Object} options - Filter and pagination options
 * @returns {Promise<Object>} Search results
 */
const searchLibrary = async (query, { page = 1, limit = 20, contentType, category } = {}) => {
  const offset = (page - 1) * limit;

  const where = {
    status: 1,
    OR: [
      { title: { contains: query, mode: 'insensitive' } },
      { description: { contains: query, mode: 'insensitive' } }
    ]
  };

  if (contentType) {
    where.content_type = contentType;
  }

  if (category) {
    where.category = category;
  }

  const [total, content] = await Promise.all([
    prisma.content_library.count({ where }),
    prisma.content_library.findMany({
      where,
      orderBy: { created_at: 'desc' },
      skip: offset,
      take: limit
    })
  ]);

  return {
    list: content || [],
    total: total || 0,
    page,
    limit,
    query
  };
};

/**
 * Get content library categories
 * @param {string} contentType - Optional filter by content type
 * @returns {Promise<Array>} List of categories
 */
const getLibraryCategories = async (contentType) => {
  const where = {
    status: 1,
    category: { not: null }
  };

  if (contentType) {
    where.content_type = contentType;
  }

  const data = await prisma.content_library.findMany({
    where,
    select: { category: true, content_type: true }
  });

  // Extract unique categories with counts
  const categoryMap = {};
  (data || []).forEach(item => {
    const key = `${item.category}_${item.content_type}`;
    if (!categoryMap[key]) {
      categoryMap[key] = {
        category: item.category,
        contentType: item.content_type,
        count: 0
      };
    }
    categoryMap[key].count++;
  });

  return Object.values(categoryMap);
};

/**
 * Get content library item by ID
 * @param {string} contentId - Content ID
 * @returns {Promise<Object|null>} Content item
 */
const getLibraryById = async (contentId) => {
  try {
    const content = await prisma.content_library.findFirst({
      where: { id: BigInt(contentId) }
    });
    return content || null;
  } catch {
    return null;
  }
};

/**
 * Create content library item
 * @param {Object} data - Content data
 * @returns {Promise<Object>} Created content
 */
const createLibraryItem = async (data) => {
  // Build metadata object if filename is provided
  const metadata = {};
  if (data.filename) metadata.filename = data.filename;

  const content = await prisma.content_library.create({
    data: {
      title: data.title,
      description: data.description || null,
      content_type: data.content_type || data.contentType,
      category: data.category || null,
      url: data.url || null,
      thumbnail_url: data.thumbnail_url || data.thumbnailUrl || null,
      duration_seconds: data.duration_seconds || data.durationSeconds || null,
      tags: data.tags || [],
      language: data.language || 'en',
      metadata: Object.keys(metadata).length > 0 ? metadata : null,
      status: data.status !== undefined ? data.status : 1
    }
  });

  return content;
};

/**
 * Update content library item
 * @param {string} contentId - Content ID
 * @param {Object} data - Update data
 * @returns {Promise<Object>} Updated content
 */
const updateLibraryItem = async (contentId, data) => {
  const updateData = { updated_at: new Date() };

  if (data.title !== undefined) updateData.title = data.title;
  if (data.description !== undefined) updateData.description = data.description;
  if (data.content_type !== undefined || data.contentType !== undefined) updateData.content_type = data.content_type || data.contentType;
  if (data.category !== undefined) updateData.category = data.category;
  if (data.url !== undefined) updateData.url = data.url;
  if (data.thumbnail_url !== undefined || data.thumbnailUrl !== undefined) updateData.thumbnail_url = data.thumbnail_url || data.thumbnailUrl;
  if (data.duration_seconds !== undefined || data.durationSeconds !== undefined) updateData.duration_seconds = data.duration_seconds || data.durationSeconds;
  if (data.tags !== undefined) updateData.tags = data.tags;
  if (data.language !== undefined) updateData.language = data.language;
  if (data.status !== undefined) updateData.status = data.status;

  // Handle metadata/filename update
  if (data.filename !== undefined) {
    // First get current metadata
    const current = await prisma.content_library.findFirst({
      where: { id: BigInt(contentId) },
      select: { metadata: true }
    });
    updateData.metadata = {
      ...(current?.metadata || {}),
      filename: data.filename
    };
  }

  const content = await prisma.content_library.update({
    where: { id: BigInt(contentId) },
    data: updateData
  });

  return content;
};

/**
 * Delete content library item
 * @param {string} contentId - Content ID
 */
const deleteLibraryItem = async (contentId) => {
  await prisma.content_library.delete({
    where: { id: BigInt(contentId) }
  });
};

/**
 * Batch create content library items
 * @param {Array} items - Array of content data
 * @returns {Promise<Object>} Result with created count
 */
const batchCreateLibraryItems = async (items) => {
  if (!Array.isArray(items) || items.length === 0) {
    throw new Error('Items must be a non-empty array');
  }

  const insertData = items.map(item => {
    const metadata = {};
    if (item.filename) metadata.filename = item.filename;

    return {
      title: item.title,
      description: item.description || null,
      content_type: item.content_type || item.contentType,
      category: item.category || null,
      url: item.url || null,
      thumbnail_url: item.thumbnail_url || null,
      duration_seconds: item.duration_seconds || null,
      tags: item.tags || [],
      language: item.language || 'en',
      metadata: Object.keys(metadata).length > 0 ? metadata : null,
      status: item.status !== undefined ? item.status : 1
    };
  });

  const result = await prisma.content_library.createMany({
    data: insertData
  });

  return {
    created: result.count || 0,
    items: []
  };
};

/**
 * Get content library statistics
 * @returns {Promise<Object>} Statistics object
 */
const getLibraryStatistics = async () => {
  const [total, typeData, categoryData] = await Promise.all([
    prisma.content_library.count(),
    prisma.content_library.findMany({ select: { content_type: true } }),
    prisma.content_library.findMany({ select: { category: true } })
  ]);

  const byType = {};
  if (typeData) {
    typeData.forEach(item => {
      byType[item.content_type] = (byType[item.content_type] || 0) + 1;
    });
  }

  const byCategory = {};
  if (categoryData) {
    categoryData.forEach(item => {
      if (item.category) {
        byCategory[item.category] = (byCategory[item.category] || 0) + 1;
      }
    });
  }

  return {
    total: total || 0,
    byType,
    byCategory
  };
};

// ==================== LEGACY MUSIC/STORY METHODS ====================

/**
 * Get music list with pagination
 * @param {Object} options - Filter and pagination options
 * @returns {Promise<Object>} Paginated music list
 */
const getMusicList = async ({ page = 1, limit = 10, category, language } = {}) => {
  const offset = (page - 1) * limit;
  const where = {};

  if (category) where.category = category;
  if (language) where.language = language;

  const [total, music] = await Promise.all([
    prisma.ai_music.count({ where }),
    prisma.ai_music.findMany({
      where,
      orderBy: [{ sort: 'asc' }, { created_at: 'desc' }],
      skip: offset,
      take: limit
    })
  ]);

  return {
    list: music || [],
    total: total || 0,
    page,
    limit
  };
};

/**
 * Get music by ID
 * @param {string} musicId - Music ID
 * @returns {Promise<Object>} Music item
 */
const getMusicById = async (musicId) => {
  try {
    const music = await prisma.ai_music.findFirst({
      where: { id: musicId }
    });
    return music || null;
  } catch {
    return null;
  }
};

/**
 * Create music entry
 * @param {number} userId - User ID
 * @param {Object} data - Music data
 * @returns {Promise<Object>} Created music
 */
const createMusic = async (userId, data) => {
  const music = await prisma.ai_music.create({
    data: {
      title: data.title,
      artist: data.artist,
      album: data.album,
      category: data.category,
      language: data.language,
      duration: data.duration,
      file_url: data.fileUrl,
      cover_url: data.coverUrl,
      lyrics: data.lyrics,
      sort: data.sort || 0,
      status: data.status || 1,
      creator: userId ? BigInt(userId) : null
    }
  });
  return music;
};

/**
 * Update music entry
 * @param {string} musicId - Music ID
 * @param {Object} data - Update data
 * @returns {Promise<Object>} Updated music
 */
const updateMusic = async (musicId, data) => {
  const updateData = { updated_at: new Date() };

  if (data.title !== undefined) updateData.title = data.title;
  if (data.artist !== undefined) updateData.artist = data.artist;
  if (data.album !== undefined) updateData.album = data.album;
  if (data.category !== undefined) updateData.category = data.category;
  if (data.language !== undefined) updateData.language = data.language;
  if (data.duration !== undefined) updateData.duration = data.duration;
  if (data.fileUrl !== undefined) updateData.file_url = data.fileUrl;
  if (data.coverUrl !== undefined) updateData.cover_url = data.coverUrl;
  if (data.lyrics !== undefined) updateData.lyrics = data.lyrics;
  if (data.sort !== undefined) updateData.sort = data.sort;
  if (data.status !== undefined) updateData.status = data.status;

  const music = await prisma.ai_music.update({
    where: { id: musicId },
    data: updateData
  });
  return music;
};

/**
 * Delete music entry
 * @param {string} musicId - Music ID
 */
const deleteMusic = async (musicId) => {
  await prisma.ai_music.delete({ where: { id: musicId } });
};

/**
 * Get story list with pagination
 * @param {Object} options - Filter and pagination options
 * @returns {Promise<Object>} Paginated story list
 */
const getStoryList = async ({ page = 1, limit = 10, category, language, ageGroup } = {}) => {
  const offset = (page - 1) * limit;
  const where = {};

  if (category) where.category = category;
  if (language) where.language = language;
  if (ageGroup) where.age_group = ageGroup;

  const [total, stories] = await Promise.all([
    prisma.ai_story.count({ where }),
    prisma.ai_story.findMany({
      where,
      orderBy: [{ sort: 'asc' }, { created_at: 'desc' }],
      skip: offset,
      take: limit
    })
  ]);

  return {
    list: stories || [],
    total: total || 0,
    page,
    limit
  };
};

/**
 * Get story by ID
 * @param {string} storyId - Story ID
 * @returns {Promise<Object>} Story item
 */
const getStoryById = async (storyId) => {
  try {
    const story = await prisma.ai_story.findFirst({
      where: { id: storyId }
    });
    return story || null;
  } catch {
    return null;
  }
};

/**
 * Create story entry
 * @param {number} userId - User ID
 * @param {Object} data - Story data
 * @returns {Promise<Object>} Created story
 */
const createStory = async (userId, data) => {
  const story = await prisma.ai_story.create({
    data: {
      title: data.title,
      author: data.author,
      category: data.category,
      language: data.language,
      age_group: data.ageGroup,
      duration: data.duration,
      content: data.content,
      audio_url: data.audioUrl,
      cover_url: data.coverUrl,
      sort: data.sort || 0,
      status: data.status || 1,
      creator: userId ? BigInt(userId) : null
    }
  });
  return story;
};

/**
 * Update story entry
 * @param {string} storyId - Story ID
 * @param {Object} data - Update data
 * @returns {Promise<Object>} Updated story
 */
const updateStory = async (storyId, data) => {
  const updateData = { updated_at: new Date() };

  if (data.title !== undefined) updateData.title = data.title;
  if (data.author !== undefined) updateData.author = data.author;
  if (data.category !== undefined) updateData.category = data.category;
  if (data.language !== undefined) updateData.language = data.language;
  if (data.ageGroup !== undefined) updateData.age_group = data.ageGroup;
  if (data.duration !== undefined) updateData.duration = data.duration;
  if (data.content !== undefined) updateData.content = data.content;
  if (data.audioUrl !== undefined) updateData.audio_url = data.audioUrl;
  if (data.coverUrl !== undefined) updateData.cover_url = data.coverUrl;
  if (data.sort !== undefined) updateData.sort = data.sort;
  if (data.status !== undefined) updateData.status = data.status;

  const story = await prisma.ai_story.update({
    where: { id: storyId },
    data: updateData
  });
  return story;
};

/**
 * Delete story entry
 * @param {string} storyId - Story ID
 */
const deleteStory = async (storyId) => {
  await prisma.ai_story.delete({ where: { id: storyId } });
};

/**
 * Get textbook list with pagination
 * @param {Object} options - Filter and pagination options
 * @returns {Promise<Object>} Paginated textbook list
 */
const getTextbookList = async ({ page = 1, limit = 10, subject, grade, language } = {}) => {
  const offset = (page - 1) * limit;
  const where = {};

  if (subject) where.subject = subject;
  if (grade) where.grade = grade;
  if (language) where.language = language;

  const [total, textbooks] = await Promise.all([
    prisma.ai_textbook.count({ where }),
    prisma.ai_textbook.findMany({
      where,
      orderBy: [{ sort: 'asc' }, { created_at: 'desc' }],
      skip: offset,
      take: limit
    })
  ]);

  return {
    list: textbooks || [],
    total: total || 0,
    page,
    limit
  };
};

/**
 * Get textbook by ID with chapters
 * @param {string} textbookId - Textbook ID
 * @returns {Promise<Object>} Textbook with chapters
 */
const getTextbookById = async (textbookId) => {
  const textbook = await prisma.ai_textbook.findFirst({
    where: { id: textbookId },
    include: {
      ai_textbook_chapter: {
        orderBy: { sort: 'asc' }
      }
    }
  });

  if (!textbook) return null;

  const { ai_textbook_chapter, ...rest } = textbook;
  return {
    ...rest,
    chapters: ai_textbook_chapter || []
  };
};

/**
 * Create textbook
 * @param {number} userId - User ID
 * @param {Object} data - Textbook data
 * @returns {Promise<Object>} Created textbook
 */
const createTextbook = async (userId, data) => {
  const textbook = await prisma.ai_textbook.create({
    data: {
      title: data.title,
      subject: data.subject,
      grade: data.grade,
      language: data.language,
      publisher: data.publisher,
      cover_url: data.coverUrl,
      description: data.description,
      sort: data.sort || 0,
      status: data.status || 1,
      creator: userId ? BigInt(userId) : null
    }
  });
  return textbook;
};

/**
 * Get random content for device
 * @param {string} mac - Device MAC address
 * @param {string} contentType - music, story, or textbook
 * @returns {Promise<Object>} Random content item
 */
const getRandomContent = async (mac, contentType) => {
  let data;

  if (contentType === 'music') {
    data = await prisma.ai_music.findMany({
      where: { status: 1 },
      take: 10
    });
  } else if (contentType === 'story') {
    data = await prisma.ai_story.findMany({
      where: { status: 1 },
      take: 10
    });
  } else {
    data = await prisma.ai_textbook.findMany({
      where: { status: 1 },
      take: 10
    });
  }

  if (!data || data.length === 0) {
    throw new Error(`No ${contentType} content available`);
  }

  // Return random item
  const randomIndex = Math.floor(Math.random() * data.length);
  return data[randomIndex];
};

/**
 * Search content across all types
 * @param {string} query - Search query
 * @param {Object} options - Pagination options
 * @returns {Promise<Object>} Search results
 */
const searchContent = async (query, { page = 1, limit = 20 } = {}) => {
  const [music, stories, textbooks] = await Promise.all([
    prisma.ai_music.findMany({
      where: {
        OR: [
          { title: { contains: query, mode: 'insensitive' } },
          { artist: { contains: query, mode: 'insensitive' } }
        ]
      },
      select: { id: true, title: true, artist: true, category: true },
      take: limit
    }),
    prisma.ai_story.findMany({
      where: {
        OR: [
          { title: { contains: query, mode: 'insensitive' } },
          { author: { contains: query, mode: 'insensitive' } }
        ]
      },
      select: { id: true, title: true, author: true, category: true },
      take: limit
    }),
    prisma.ai_textbook.findMany({
      where: {
        OR: [
          { title: { contains: query, mode: 'insensitive' } },
          { subject: { contains: query, mode: 'insensitive' } }
        ]
      },
      select: { id: true, title: true, subject: true, grade: true },
      take: limit
    })
  ]);

  return {
    music: (music || []).map(m => ({ ...m, type: 'music' })),
    stories: (stories || []).map(s => ({ ...s, type: 'story' })),
    textbooks: (textbooks || []).map(t => ({ ...t, type: 'textbook' }))
  };
};

// ==================== PLAYLIST METHODS ====================

/**
 * Get playlist for a device
 * @param {string} deviceId - Device ID
 * @param {string} playlistType - 'music' or 'story'
 * @returns {Promise<Array>} Playlist items with content details
 */
const getPlaylist = async (deviceId, playlistType) => {
  const playlistItems = playlistType === 'music'
    ? await prisma.music_playlist.findMany({
      where: { device_id: deviceId },
      select: { id: true, position: true, created_at: true, content_id: true },
      orderBy: { position: 'asc' }
    })
    : await prisma.story_playlist.findMany({
      where: { device_id: deviceId },
      select: { id: true, position: true, created_at: true, content_id: true },
      orderBy: { position: 'asc' }
    });

  if (!playlistItems || playlistItems.length === 0) {
    return [];
  }

  // Get unique content IDs
  const contentIds = [...new Set(playlistItems.map(item => item.content_id).filter(Boolean))];

  if (contentIds.length === 0) {
    return playlistItems.map(item => ({
      id: item.id,
      position: item.position,
      contentId: item.content_id,
      createdAt: item.created_at,
      content: null
    }));
  }

  // Fetch content details from content_library
  let contentItems = [];
  try {
    contentItems = await prisma.content_library.findMany({
      where: { id: { in: contentIds } },
      select: {
        id: true,
        title: true,
        description: true,
        content_type: true,
        category: true,
        url: true,
        thumbnail_url: true,
        duration_seconds: true,
        metadata: true,
        status: true
      }
    });
  } catch (err) {
    logger.warn('Failed to fetch content for playlist', { error: err.message });
    return playlistItems.map(item => ({
      id: item.id,
      position: item.position,
      contentId: item.content_id,
      createdAt: item.created_at,
      content: null
    }));
  }

  // Create content lookup map
  const contentMap = {};
  (contentItems || []).forEach(content => {
    contentMap[String(content.id)] = content;
  });

  // Merge playlist with content
  return playlistItems.map(item => ({
    id: item.id,
    position: item.position,
    contentId: item.content_id,
    createdAt: item.created_at,
    content: contentMap[String(item.content_id)] || null
  }));
};

/**
 * Add content to playlist
 * @param {string} deviceId - Device ID
 * @param {string} contentId - Content ID
 * @param {string} playlistType - 'music' or 'story'
 * @param {number} position - Optional position (appends to end if not specified)
 * @returns {Promise<Object>} Created playlist item
 */
const addToPlaylist = async (deviceId, contentId, playlistType, position) => {
  // If position not specified, get the max position and add 1
  if (position === undefined || position === null) {
    let maxItem;
    if (playlistType === 'music') {
      maxItem = await prisma.music_playlist.findFirst({
        where: { device_id: deviceId },
        select: { position: true },
        orderBy: { position: 'desc' }
      });
    } else {
      maxItem = await prisma.story_playlist.findFirst({
        where: { device_id: deviceId },
        select: { position: true },
        orderBy: { position: 'desc' }
      });
    }
    position = maxItem ? maxItem.position + 1 : 0;
  }

  // Insert playlist item
  let data;
  try {
    if (playlistType === 'music') {
      data = await prisma.music_playlist.create({
        data: {
          device_id: deviceId,
          content_id: BigInt(contentId),
          position
        },
        select: { id: true, position: true, created_at: true, content_id: true }
      });
    } else {
      data = await prisma.story_playlist.create({
        data: {
          device_id: deviceId,
          content_id: BigInt(contentId),
          position
        },
        select: { id: true, position: true, created_at: true, content_id: true }
      });
    }
  } catch (error) {
    // Check for unique constraint violation
    if (error.code === 'P2002') {
      throw new Error('Content already exists in playlist');
    }
    logger.error(`Failed to add to ${playlistType} playlist`, { error: error.message, deviceId, contentId });
    throw new Error(`Failed to add to ${playlistType} playlist`);
  }

  // Fetch content details separately
  let content = null;
  if (contentId) {
    try {
      content = await prisma.content_library.findFirst({
        where: { id: BigInt(contentId) },
        select: {
          id: true,
          title: true,
          description: true,
          content_type: true,
          category: true,
          url: true,
          thumbnail_url: true,
          duration_seconds: true,
          metadata: true,
          status: true
        }
      });
    } catch {
      // ignore
    }
  }

  return {
    id: data.id,
    position: data.position,
    contentId: data.content_id,
    createdAt: data.created_at,
    content
  };
};

/**
 * Remove content from playlist
 * @param {string} deviceId - Device ID
 * @param {string} contentId - Content ID
 * @param {string} playlistType - 'music' or 'story'
 */
const removeFromPlaylist = async (deviceId, contentId, playlistType) => {
  try {
    if (playlistType === 'music') {
      await prisma.music_playlist.deleteMany({
        where: { device_id: deviceId, content_id: BigInt(contentId) }
      });
    } else {
      await prisma.story_playlist.deleteMany({
        where: { device_id: deviceId, content_id: BigInt(contentId) }
      });
    }
  } catch (error) {
    logger.error(`Failed to remove from ${playlistType} playlist`, { error: error.message, deviceId, contentId });
    throw new Error(`Failed to remove from ${playlistType} playlist`);
  }
};

/**
 * Remove playlist item by ID
 * @param {number} playlistItemId - Playlist item ID
 * @param {string} playlistType - 'music' or 'story'
 */
const removePlaylistItem = async (playlistItemId, playlistType) => {
  try {
    if (playlistType === 'music') {
      await prisma.music_playlist.delete({
        where: { id: BigInt(playlistItemId) }
      });
    } else {
      await prisma.story_playlist.delete({
        where: { id: BigInt(playlistItemId) }
      });
    }
  } catch (error) {
    logger.error('Failed to remove playlist item', { error: error.message, playlistItemId });
    throw new Error('Failed to remove playlist item');
  }
};

/**
 * Clear entire playlist for a device
 * @param {string} deviceId - Device ID
 * @param {string} playlistType - 'music' or 'story'
 */
const clearPlaylist = async (deviceId, playlistType) => {
  try {
    if (playlistType === 'music') {
      await prisma.music_playlist.deleteMany({ where: { device_id: deviceId } });
    } else {
      await prisma.story_playlist.deleteMany({ where: { device_id: deviceId } });
    }
  } catch (error) {
    logger.error(`Failed to clear ${playlistType} playlist`, { error: error.message, deviceId });
    throw new Error(`Failed to clear ${playlistType} playlist`);
  }
};

/**
 * Reorder playlist items
 * @param {string} deviceId - Device ID
 * @param {Array} itemIds - Array of playlist item IDs in new order
 * @param {string} playlistType - 'music' or 'story'
 */
const reorderPlaylist = async (deviceId, itemIds, playlistType) => {
  // Update positions based on array order
  for (let index = 0; index < itemIds.length; index++) {
    const id = itemIds[index];
    try {
      if (playlistType === 'music') {
        await prisma.music_playlist.updateMany({
          where: { id: BigInt(id), device_id: deviceId },
          data: { position: index, updated_at: new Date() }
        });
      } else {
        await prisma.story_playlist.updateMany({
          where: { id: BigInt(id), device_id: deviceId },
          data: { position: index, updated_at: new Date() }
        });
      }
    } catch (error) {
      logger.error(`Failed to reorder ${playlistType} playlist`, { error: error.message, deviceId });
      throw new Error(`Failed to reorder ${playlistType} playlist`);
    }
  }

  // Return updated playlist
  return getPlaylist(deviceId, playlistType);
};

/**
 * Move playlist item to new position
 * @param {string} deviceId - Device ID
 * @param {number} playlistItemId - Playlist item ID to move
 * @param {number} newPosition - New position for the item
 * @param {string} playlistType - 'music' or 'story'
 */
const movePlaylistItem = async (deviceId, playlistItemId, newPosition, playlistType) => {
  // Get current playlist
  let playlist;
  try {
    if (playlistType === 'music') {
      playlist = await prisma.music_playlist.findMany({
        where: { device_id: deviceId },
        select: { id: true, position: true },
        orderBy: { position: 'asc' }
      });
    } else {
      playlist = await prisma.story_playlist.findMany({
        where: { device_id: deviceId },
        select: { id: true, position: true },
        orderBy: { position: 'asc' }
      });
    }
  } catch (error) {
    logger.error('Failed to fetch playlist for reorder', { error: error.message, deviceId });
    throw new Error('Failed to move playlist item');
  }

  // Find current item (compare as strings to handle BigInt)
  const currentIndex = playlist.findIndex(item => String(item.id) === String(playlistItemId));
  if (currentIndex === -1) {
    throw new Error('Playlist item not found');
  }

  // Clamp new position to valid range
  const clampedPosition = Math.max(0, Math.min(newPosition, playlist.length - 1));

  // Create new ordered array
  const item = playlist.splice(currentIndex, 1)[0];
  playlist.splice(clampedPosition, 0, item);

  // Update all positions
  const updates = playlist.map((item) => item.id);
  return reorderPlaylist(deviceId, updates, playlistType);
};

/**
 * Get playlist item by ID
 * @param {number} playlistItemId - Playlist item ID
 * @param {string} playlistType - 'music' or 'story'
 * @returns {Promise<Object|null>} Playlist item
 */
const getPlaylistItem = async (playlistItemId, playlistType) => {
  let data;
  try {
    if (playlistType === 'music') {
      data = await prisma.music_playlist.findFirst({
        where: { id: BigInt(playlistItemId) },
        select: { id: true, device_id: true, position: true, created_at: true, content_id: true }
      });
    } else {
      data = await prisma.story_playlist.findFirst({
        where: { id: BigInt(playlistItemId) },
        select: { id: true, device_id: true, position: true, created_at: true, content_id: true }
      });
    }
  } catch {
    return null;
  }

  if (!data) return null;

  // Fetch content details separately
  let content = null;
  if (data.content_id) {
    try {
      content = await prisma.content_library.findFirst({
        where: { id: data.content_id },
        select: {
          id: true,
          title: true,
          description: true,
          content_type: true,
          category: true,
          url: true,
          thumbnail_url: true,
          duration_seconds: true,
          metadata: true,
          status: true
        }
      });
    } catch {
      // ignore
    }
  }

  return {
    id: data.id,
    deviceId: data.device_id,
    position: data.position,
    contentId: data.content_id,
    createdAt: data.created_at,
    content
  };
};

// ==================== CONTENT ITEMS METHODS ====================
// Note: 'content_items' table is not in the Prisma schema; using $queryRaw fallback.

/**
 * Get content items with pagination
 * @param {Object} options - Filter and pagination options
 * @returns {Promise<Object>} Paginated content items list
 */
const getContentItems = async ({ page = 1, limit = 10, contentType, category } = {}) => {
  const offset = (page - 1) * limit;

  try {
    // Build dynamic WHERE clauses
    const conditions = [];
    const params = [];
    let paramIdx = 1;

    if (contentType) {
      conditions.push(`content_type = $${paramIdx++}`);
      params.push(contentType);
    }
    if (category) {
      conditions.push(`category = $${paramIdx++}`);
      params.push(category);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const countResult = await prisma.$queryRawUnsafe(
      `SELECT COUNT(*)::int AS count FROM content_items ${whereClause}`,
      ...params
    );
    const total = countResult[0]?.count || 0;

    const items = await prisma.$queryRawUnsafe(
      `SELECT * FROM content_items ${whereClause} ORDER BY created_at DESC LIMIT $${paramIdx++} OFFSET $${paramIdx++}`,
      ...params, limit, offset
    );

    return {
      list: items || [],
      total,
      page,
      limit,
      pages: Math.ceil(total / limit)
    };
  } catch (error) {
    logger.error('Failed to fetch content items', { error: error.message });
    throw new Error('Failed to fetch content items');
  }
};

/**
 * Get content item by ID
 * @param {string} id - Content item ID
 * @returns {Promise<Object>} Content item
 */
const getContentItemById = async (id) => {
  try {
    const results = await prisma.$queryRaw`SELECT * FROM content_items WHERE id = ${id} LIMIT 1`;
    return results[0] || null;
  } catch (error) {
    logger.error('Failed to fetch content item', { error: error.message });
    throw new Error('Failed to fetch content item');
  }
};

/**
 * Get content items by type
 * @param {string} contentType - Content type (music, story, etc.)
 * @param {Object} options - Pagination options
 * @returns {Promise<Object>} Paginated items
 */
const getContentItemsByType = async (contentType, { page = 1, limit = 10 } = {}) => {
  return getContentItems({ page, limit, contentType });
};

/**
 * Get content items by category
 * @param {string} category - Category name
 * @param {Object} options - Pagination options
 * @returns {Promise<Object>} Paginated items
 */
const getContentItemsByCategory = async (category, { page = 1, limit = 10 } = {}) => {
  return getContentItems({ page, limit, category });
};

/**
 * Search content items
 * @param {string} query - Search query
 * @param {Object} options - Filter and pagination options
 * @returns {Promise<Object>} Search results
 */
const searchContentItems = async (query, { page = 1, limit = 20, contentType, category } = {}) => {
  const offset = (page - 1) * limit;

  try {
    const conditions = [`(title ILIKE $1 OR romanized ILIKE $1)`];
    const params = [`%${query}%`];
    let paramIdx = 2;

    if (contentType) {
      conditions.push(`content_type = $${paramIdx++}`);
      params.push(contentType);
    }
    if (category) {
      conditions.push(`category = $${paramIdx++}`);
      params.push(category);
    }

    const whereClause = `WHERE ${conditions.join(' AND ')}`;

    const countResult = await prisma.$queryRawUnsafe(
      `SELECT COUNT(*)::int AS count FROM content_items ${whereClause}`,
      ...params
    );
    const total = countResult[0]?.count || 0;

    const items = await prisma.$queryRawUnsafe(
      `SELECT * FROM content_items ${whereClause} ORDER BY created_at DESC LIMIT $${paramIdx++} OFFSET $${paramIdx++}`,
      ...params, limit, offset
    );

    return {
      list: items || [],
      total,
      page,
      limit,
      pages: Math.ceil(total / limit)
    };
  } catch (error) {
    logger.error('Failed to search content items', { error: error.message });
    throw new Error('Failed to search content items');
  }
};

/**
 * Get categories for content items
 * @param {string} [contentType] - Optional content type filter
 * @returns {Promise<Array>} List of categories
 */
const getContentItemCategories = async (contentType) => {
  try {
    let results;
    if (contentType) {
      results = await prisma.$queryRaw`SELECT DISTINCT category FROM content_items WHERE category IS NOT NULL AND content_type = ${contentType}`;
    } else {
      results = await prisma.$queryRaw`SELECT DISTINCT category FROM content_items WHERE category IS NOT NULL`;
    }

    const categories = (results || []).map(r => r.category).filter(Boolean);
    return categories.sort();
  } catch (error) {
    logger.error('Failed to fetch categories', { error: error.message });
    throw new Error('Failed to fetch categories');
  }
};

/**
 * Get content statistics
 * @returns {Promise<Object>} Statistics object
 */
const getContentItemStatistics = async () => {
  try {
    const [countResult, typeData, categoryData] = await Promise.all([
      prisma.$queryRaw`SELECT COUNT(*)::int AS count FROM content_items`,
      prisma.$queryRaw`SELECT content_type FROM content_items`,
      prisma.$queryRaw`SELECT category FROM content_items`
    ]);

    const total = countResult[0]?.count || 0;

    const byType = {};
    if (typeData) {
      typeData.forEach(item => {
        byType[item.content_type] = (byType[item.content_type] || 0) + 1;
      });
    }

    const byCategory = {};
    if (categoryData) {
      categoryData.forEach(item => {
        if (item.category) {
          byCategory[item.category] = (byCategory[item.category] || 0) + 1;
        }
      });
    }

    return { total, byType, byCategory };
  } catch (error) {
    logger.error('Failed to fetch content item statistics', { error: error.message });
    throw new Error('Failed to fetch content item statistics');
  }
};

/**
 * Create content item
 * @param {Object} data - Content item data
 * @returns {Promise<Object>} Created item
 */
const createContentItem = async (data) => {
  try {
    const results = await prisma.$queryRaw`
      INSERT INTO content_items (title, romanized, filename, content_type, category, alternatives, file_url, thumbnail_url, duration_seconds)
      VALUES (
        ${data.title},
        ${data.romanized || null},
        ${data.filename || null},
        ${data.contentType},
        ${data.category || null},
        ${JSON.stringify(data.alternatives || [])}::jsonb,
        ${data.fileUrl || null},
        ${data.thumbnailUrl || null},
        ${data.durationSeconds || null}
      )
      RETURNING *
    `;
    return results[0];
  } catch (error) {
    logger.error('Failed to create content item', { error: error.message });
    throw new Error('Failed to create content item');
  }
};

/**
 * Batch create content items
 * @param {Array} items - Array of content item data
 * @returns {Promise<Object>} Result with created count
 */
const batchCreateContentItems = async (items) => {
  if (!Array.isArray(items) || items.length === 0) {
    throw new Error('Items array is required');
  }

  const created = [];
  for (const item of items) {
    const result = await createContentItem(item);
    created.push(result);
  }

  return {
    created: created.length,
    items: created
  };
};

/**
 * Update content item
 * @param {string} id - Content item ID
 * @param {Object} data - Update data
 * @returns {Promise<Object>} Updated item
 */
const updateContentItem = async (id, data) => {
  const setClauses = ['updated_at = NOW()'];
  const params = [];
  let paramIdx = 1;

  if (data.title !== undefined) { setClauses.push(`title = $${paramIdx++}`); params.push(data.title); }
  if (data.romanized !== undefined) { setClauses.push(`romanized = $${paramIdx++}`); params.push(data.romanized); }
  if (data.filename !== undefined) { setClauses.push(`filename = $${paramIdx++}`); params.push(data.filename); }
  if (data.contentType !== undefined) { setClauses.push(`content_type = $${paramIdx++}`); params.push(data.contentType); }
  if (data.category !== undefined) { setClauses.push(`category = $${paramIdx++}`); params.push(data.category); }
  if (data.alternatives !== undefined) { setClauses.push(`alternatives = $${paramIdx++}::jsonb`); params.push(JSON.stringify(data.alternatives)); }
  if (data.fileUrl !== undefined) { setClauses.push(`file_url = $${paramIdx++}`); params.push(data.fileUrl); }
  if (data.thumbnailUrl !== undefined) { setClauses.push(`thumbnail_url = $${paramIdx++}`); params.push(data.thumbnailUrl); }
  if (data.durationSeconds !== undefined) { setClauses.push(`duration_seconds = $${paramIdx++}`); params.push(data.durationSeconds); }

  params.push(id);

  try {
    const results = await prisma.$queryRawUnsafe(
      `UPDATE content_items SET ${setClauses.join(', ')} WHERE id = $${paramIdx} RETURNING *`,
      ...params
    );
    return results[0];
  } catch (error) {
    logger.error('Failed to update content item', { error: error.message });
    throw new Error('Failed to update content item');
  }
};

/**
 * Batch update content items
 * @param {Array} updates - Array of {id, ...updateData} objects
 * @returns {Promise<Object>} Result with updated count
 */
const batchUpdateContentItems = async (updates) => {
  if (!Array.isArray(updates) || updates.length === 0) {
    throw new Error('Updates array is required');
  }

  let updatedCount = 0;
  const results = [];

  for (const update of updates) {
    const { id, ...data } = update;
    if (!id) continue;

    try {
      const item = await updateContentItem(id, data);
      results.push(item);
      updatedCount++;
    } catch (error) {
      logger.warn(`Failed to update content item ${id}`, { error: error.message });
    }
  }

  return {
    updated: updatedCount,
    items: results
  };
};

/**
 * Delete content item
 * @param {string} id - Content item ID
 * @returns {Promise<boolean>} Success status
 */
const deleteContentItem = async (id) => {
  try {
    await prisma.$queryRaw`DELETE FROM content_items WHERE id = ${id}`;
    return true;
  } catch (error) {
    logger.error('Failed to delete content item', { error: error.message });
    throw new Error('Failed to delete content item');
  }
};

/**
 * Batch delete content items
 * @param {Array} ids - Array of content item IDs
 * @returns {Promise<Object>} Result with deleted count
 */
const batchDeleteContentItems = async (ids) => {
  if (!Array.isArray(ids) || ids.length === 0) {
    throw new Error('IDs array is required');
  }

  try {
    await prisma.$queryRawUnsafe(
      `DELETE FROM content_items WHERE id = ANY($1::text[])`,
      ids
    );
    return { deleted: ids.length };
  } catch (error) {
    logger.error('Failed to batch delete content items', { error: error.message });
    throw new Error('Failed to batch delete content items');
  }
};

module.exports = {
  // Content Library methods
  getLibraryList,
  searchLibrary,
  getLibraryCategories,
  getLibraryById,
  createLibraryItem,
  updateLibraryItem,
  deleteLibraryItem,
  batchCreateLibraryItems,
  getLibraryStatistics,
  // Legacy music methods
  getMusicList,
  getMusicById,
  createMusic,
  updateMusic,
  deleteMusic,
  // Legacy story methods
  getStoryList,
  getStoryById,
  createStory,
  updateStory,
  deleteStory,
  // Legacy textbook methods
  getTextbookList,
  getTextbookById,
  createTextbook,
  // Generic methods
  getRandomContent,
  searchContent,
  // Playlist methods
  getPlaylist,
  addToPlaylist,
  removeFromPlaylist,
  removePlaylistItem,
  clearPlaylist,
  reorderPlaylist,
  movePlaylistItem,
  getPlaylistItem,
  // Content Items methods
  getContentItems,
  getContentItemById,
  getContentItemsByType,
  getContentItemsByCategory,
  searchContentItems,
  getContentItemCategories,
  getContentItemStatistics,
  createContentItem,
  batchCreateContentItems,
  updateContentItem,
  batchUpdateContentItems,
  deleteContentItem,
  batchDeleteContentItems
};
