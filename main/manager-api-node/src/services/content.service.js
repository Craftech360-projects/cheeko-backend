/**
 * Content Service
 *
 * Handles music, stories, textbooks, and other educational content.
 * Includes unified content library management.
 */

const { supabaseAdmin } = require('../config/database');
const logger = require('../utils/logger');

// ==================== CONTENT LIBRARY METHODS ====================

/**
 * Get content library list with pagination
 * @param {Object} options - Filter and pagination options
 * @returns {Promise<Object>} Paginated content list
 */
const getLibraryList = async ({ page = 1, limit = 10, contentType, category, isActive } = {}) => {
  if (!supabaseAdmin) throw new Error('Database not configured');

  const offset = (page - 1) * limit;

  let countQuery = supabaseAdmin
    .from('content_library')
    .select('id', { count: 'exact', head: true });

  let dataQuery = supabaseAdmin
    .from('content_library')
    .select('*')
    .order('created_at', { ascending: false });

  if (contentType) {
    countQuery = countQuery.eq('content_type', contentType);
    dataQuery = dataQuery.eq('content_type', contentType);
  }

  if (category) {
    countQuery = countQuery.eq('category', category);
    dataQuery = dataQuery.eq('category', category);
  }

  if (isActive !== undefined) {
    const activeValue = isActive === true || isActive === 'true' || isActive === 1 ? 1 : 0;
    countQuery = countQuery.eq('status', activeValue);
    dataQuery = dataQuery.eq('status', activeValue);
  }

  const { count } = await countQuery;
  const { data: content, error } = await dataQuery.range(offset, offset + limit - 1);

  if (error) {
    logger.error('Failed to fetch content library', { error: error.message });
    throw new Error('Failed to fetch content library');
  }

  return {
    list: content || [],
    total: count || 0,
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
  if (!supabaseAdmin) throw new Error('Database not configured');

  const offset = (page - 1) * limit;
  const searchPattern = `%${query}%`;

  let countQuery = supabaseAdmin
    .from('content_library')
    .select('id', { count: 'exact', head: true })
    .eq('status', 1)
    .or(`title.ilike.${searchPattern},description.ilike.${searchPattern}`);

  let dataQuery = supabaseAdmin
    .from('content_library')
    .select('*')
    .eq('status', 1)
    .or(`title.ilike.${searchPattern},description.ilike.${searchPattern}`)
    .order('created_at', { ascending: false });

  if (contentType) {
    countQuery = countQuery.eq('content_type', contentType);
    dataQuery = dataQuery.eq('content_type', contentType);
  }

  if (category) {
    countQuery = countQuery.eq('category', category);
    dataQuery = dataQuery.eq('category', category);
  }

  const { count } = await countQuery;
  const { data: content, error } = await dataQuery.range(offset, offset + limit - 1);

  if (error) {
    logger.error('Failed to search content library', { error: error.message });
    throw new Error('Failed to search content library');
  }

  return {
    list: content || [],
    total: count || 0,
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
  if (!supabaseAdmin) throw new Error('Database not configured');

  let query = supabaseAdmin
    .from('content_library')
    .select('category, content_type')
    .eq('status', 1)
    .not('category', 'is', null);

  if (contentType) {
    query = query.eq('content_type', contentType);
  }

  const { data, error } = await query;

  if (error) {
    logger.error('Failed to fetch categories', { error: error.message });
    throw new Error('Failed to fetch categories');
  }

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
  if (!supabaseAdmin) throw new Error('Database not configured');

  const { data: content, error } = await supabaseAdmin
    .from('content_library')
    .select('*')
    .eq('id', contentId)
    .single();

  if (error || !content) return null;

  return content;
};

/**
 * Create content library item
 * @param {Object} data - Content data
 * @returns {Promise<Object>} Created content
 */
const createLibraryItem = async (data) => {
  if (!supabaseAdmin) throw new Error('Database not configured');

  // Build metadata object if filename is provided
  const metadata = {};
  if (data.filename) metadata.filename = data.filename;

  const { data: content, error } = await supabaseAdmin
    .from('content_library')
    .insert({
      title: data.title,
      description: data.description || null,
      content_type: data.content_type || data.contentType,
      category: data.category || null,
      url: data.url || null,
      thumbnail_url: data.thumbnail_url || null,
      duration_seconds: data.duration_seconds || null,
      tags: data.tags || [],
      language: data.language || 'en',
      metadata: Object.keys(metadata).length > 0 ? metadata : null,
      status: data.status !== undefined ? data.status : 1
    })
    .select()
    .single();

  if (error) {
    logger.error('Failed to create content', { error: error.message });
    throw new Error('Failed to create content');
  }

  return content;
};

/**
 * Update content library item
 * @param {string} contentId - Content ID
 * @param {Object} data - Update data
 * @returns {Promise<Object>} Updated content
 */
const updateLibraryItem = async (contentId, data) => {
  if (!supabaseAdmin) throw new Error('Database not configured');

  const updateData = { updated_at: new Date().toISOString() };

  if (data.title !== undefined) updateData.title = data.title;
  if (data.description !== undefined) updateData.description = data.description;
  if (data.content_type !== undefined) updateData.content_type = data.content_type;
  if (data.category !== undefined) updateData.category = data.category;
  if (data.url !== undefined) updateData.url = data.url;
  if (data.thumbnail_url !== undefined) updateData.thumbnail_url = data.thumbnail_url;
  if (data.duration_seconds !== undefined) updateData.duration_seconds = data.duration_seconds;
  if (data.tags !== undefined) updateData.tags = data.tags;
  if (data.language !== undefined) updateData.language = data.language;
  if (data.status !== undefined) updateData.status = data.status;

  // Handle metadata/filename update
  if (data.filename !== undefined) {
    // First get current metadata
    const { data: current } = await supabaseAdmin
      .from('content_library')
      .select('metadata')
      .eq('id', contentId)
      .single();

    updateData.metadata = {
      ...(current?.metadata || {}),
      filename: data.filename
    };
  }

  const { data: content, error } = await supabaseAdmin
    .from('content_library')
    .update(updateData)
    .eq('id', contentId)
    .select()
    .single();

  if (error) {
    logger.error('Failed to update content', { error: error.message });
    throw new Error('Failed to update content');
  }

  return content;
};

/**
 * Delete content library item
 * @param {string} contentId - Content ID
 */
const deleteLibraryItem = async (contentId) => {
  if (!supabaseAdmin) throw new Error('Database not configured');

  const { error } = await supabaseAdmin
    .from('content_library')
    .delete()
    .eq('id', contentId);

  if (error) {
    logger.error('Failed to delete content', { error: error.message });
    throw new Error('Failed to delete content');
  }
};

/**
 * Batch create content library items
 * @param {Array} items - Array of content data
 * @returns {Promise<Object>} Result with created count
 */
const batchCreateLibraryItems = async (items) => {
  if (!supabaseAdmin) throw new Error('Database not configured');

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

  const { data: content, error } = await supabaseAdmin
    .from('content_library')
    .insert(insertData)
    .select();

  if (error) {
    logger.error('Failed to batch create content', { error: error.message });
    throw new Error('Failed to batch create content');
  }

  return {
    created: content?.length || 0,
    items: content || []
  };
};

/**
 * Get content library statistics
 * @returns {Promise<Object>} Statistics object
 */
const getLibraryStatistics = async () => {
  if (!supabaseAdmin) throw new Error('Database not configured');

  // Get total count
  const { count: total } = await supabaseAdmin
    .from('content_library')
    .select('id', { count: 'exact', head: true });

  // Get count by type
  const { data: typeData } = await supabaseAdmin
    .from('content_library')
    .select('content_type');

  const byType = {};
  if (typeData) {
    typeData.forEach(item => {
      byType[item.content_type] = (byType[item.content_type] || 0) + 1;
    });
  }

  // Get count by category
  const { data: categoryData } = await supabaseAdmin
    .from('content_library')
    .select('category');

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
  if (!supabaseAdmin) throw new Error('Database not configured');

  const offset = (page - 1) * limit;

  let countQuery = supabaseAdmin
    .from('ai_music')
    .select('id', { count: 'exact', head: true });

  let dataQuery = supabaseAdmin
    .from('ai_music')
    .select('*')
    .order('sort', { ascending: true })
    .order('created_at', { ascending: false });

  if (category) {
    countQuery = countQuery.eq('category', category);
    dataQuery = dataQuery.eq('category', category);
  }

  if (language) {
    countQuery = countQuery.eq('language', language);
    dataQuery = dataQuery.eq('language', language);
  }

  const { count } = await countQuery;
  const { data: music, error } = await dataQuery.range(offset, offset + limit - 1);

  if (error) throw new Error('Failed to fetch music');

  return {
    list: music || [],
    total: count || 0,
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
  if (!supabaseAdmin) throw new Error('Database not configured');

  const { data: music, error } = await supabaseAdmin
    .from('ai_music')
    .select('*')
    .eq('id', musicId)
    .single();

  if (error || !music) return null;

  return music;
};

/**
 * Create music entry
 * @param {number} userId - User ID
 * @param {Object} data - Music data
 * @returns {Promise<Object>} Created music
 */
const createMusic = async (userId, data) => {
  if (!supabaseAdmin) throw new Error('Database not configured');

  const { data: music, error } = await supabaseAdmin
    .from('ai_music')
    .insert({
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
      creator: userId
    })
    .select()
    .single();

  if (error) throw new Error('Failed to create music');

  return music;
};

/**
 * Update music entry
 * @param {string} musicId - Music ID
 * @param {Object} data - Update data
 * @returns {Promise<Object>} Updated music
 */
const updateMusic = async (musicId, data) => {
  if (!supabaseAdmin) throw new Error('Database not configured');

  const updateData = { updated_at: new Date().toISOString() };

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

  const { data: music, error } = await supabaseAdmin
    .from('ai_music')
    .update(updateData)
    .eq('id', musicId)
    .select()
    .single();

  if (error) throw new Error('Failed to update music');

  return music;
};

/**
 * Delete music entry
 * @param {string} musicId - Music ID
 */
const deleteMusic = async (musicId) => {
  if (!supabaseAdmin) throw new Error('Database not configured');

  const { error } = await supabaseAdmin
    .from('ai_music')
    .delete()
    .eq('id', musicId);

  if (error) throw new Error('Failed to delete music');
};

/**
 * Get story list with pagination
 * @param {Object} options - Filter and pagination options
 * @returns {Promise<Object>} Paginated story list
 */
const getStoryList = async ({ page = 1, limit = 10, category, language, ageGroup } = {}) => {
  if (!supabaseAdmin) throw new Error('Database not configured');

  const offset = (page - 1) * limit;

  let countQuery = supabaseAdmin
    .from('ai_story')
    .select('id', { count: 'exact', head: true });

  let dataQuery = supabaseAdmin
    .from('ai_story')
    .select('*')
    .order('sort', { ascending: true })
    .order('created_at', { ascending: false });

  if (category) {
    countQuery = countQuery.eq('category', category);
    dataQuery = dataQuery.eq('category', category);
  }

  if (language) {
    countQuery = countQuery.eq('language', language);
    dataQuery = dataQuery.eq('language', language);
  }

  if (ageGroup) {
    countQuery = countQuery.eq('age_group', ageGroup);
    dataQuery = dataQuery.eq('age_group', ageGroup);
  }

  const { count } = await countQuery;
  const { data: stories, error } = await dataQuery.range(offset, offset + limit - 1);

  if (error) throw new Error('Failed to fetch stories');

  return {
    list: stories || [],
    total: count || 0,
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
  if (!supabaseAdmin) throw new Error('Database not configured');

  const { data: story, error } = await supabaseAdmin
    .from('ai_story')
    .select('*')
    .eq('id', storyId)
    .single();

  if (error || !story) return null;

  return story;
};

/**
 * Create story entry
 * @param {number} userId - User ID
 * @param {Object} data - Story data
 * @returns {Promise<Object>} Created story
 */
const createStory = async (userId, data) => {
  if (!supabaseAdmin) throw new Error('Database not configured');

  const { data: story, error } = await supabaseAdmin
    .from('ai_story')
    .insert({
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
      creator: userId
    })
    .select()
    .single();

  if (error) throw new Error('Failed to create story');

  return story;
};

/**
 * Update story entry
 * @param {string} storyId - Story ID
 * @param {Object} data - Update data
 * @returns {Promise<Object>} Updated story
 */
const updateStory = async (storyId, data) => {
  if (!supabaseAdmin) throw new Error('Database not configured');

  const updateData = { updated_at: new Date().toISOString() };

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

  const { data: story, error } = await supabaseAdmin
    .from('ai_story')
    .update(updateData)
    .eq('id', storyId)
    .select()
    .single();

  if (error) throw new Error('Failed to update story');

  return story;
};

/**
 * Delete story entry
 * @param {string} storyId - Story ID
 */
const deleteStory = async (storyId) => {
  if (!supabaseAdmin) throw new Error('Database not configured');

  const { error } = await supabaseAdmin
    .from('ai_story')
    .delete()
    .eq('id', storyId);

  if (error) throw new Error('Failed to delete story');
};

/**
 * Get textbook list with pagination
 * @param {Object} options - Filter and pagination options
 * @returns {Promise<Object>} Paginated textbook list
 */
const getTextbookList = async ({ page = 1, limit = 10, subject, grade, language } = {}) => {
  if (!supabaseAdmin) throw new Error('Database not configured');

  const offset = (page - 1) * limit;

  let countQuery = supabaseAdmin
    .from('ai_textbook')
    .select('id', { count: 'exact', head: true });

  let dataQuery = supabaseAdmin
    .from('ai_textbook')
    .select('*')
    .order('sort', { ascending: true })
    .order('created_at', { ascending: false });

  if (subject) {
    countQuery = countQuery.eq('subject', subject);
    dataQuery = dataQuery.eq('subject', subject);
  }

  if (grade) {
    countQuery = countQuery.eq('grade', grade);
    dataQuery = dataQuery.eq('grade', grade);
  }

  if (language) {
    countQuery = countQuery.eq('language', language);
    dataQuery = dataQuery.eq('language', language);
  }

  const { count } = await countQuery;
  const { data: textbooks, error } = await dataQuery.range(offset, offset + limit - 1);

  if (error) throw new Error('Failed to fetch textbooks');

  return {
    list: textbooks || [],
    total: count || 0,
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
  if (!supabaseAdmin) throw new Error('Database not configured');

  const { data: textbook, error } = await supabaseAdmin
    .from('ai_textbook')
    .select('*')
    .eq('id', textbookId)
    .single();

  if (error || !textbook) return null;

  // Get chapters
  const { data: chapters } = await supabaseAdmin
    .from('ai_textbook_chapter')
    .select('*')
    .eq('textbook_id', textbookId)
    .order('sort', { ascending: true });

  return {
    ...textbook,
    chapters: chapters || []
  };
};

/**
 * Create textbook
 * @param {number} userId - User ID
 * @param {Object} data - Textbook data
 * @returns {Promise<Object>} Created textbook
 */
const createTextbook = async (userId, data) => {
  if (!supabaseAdmin) throw new Error('Database not configured');

  const { data: textbook, error } = await supabaseAdmin
    .from('ai_textbook')
    .insert({
      title: data.title,
      subject: data.subject,
      grade: data.grade,
      language: data.language,
      publisher: data.publisher,
      cover_url: data.coverUrl,
      description: data.description,
      sort: data.sort || 0,
      status: data.status || 1,
      creator: userId
    })
    .select()
    .single();

  if (error) throw new Error('Failed to create textbook');

  return textbook;
};

/**
 * Get random content for device
 * @param {string} mac - Device MAC address
 * @param {string} contentType - music, story, or textbook
 * @returns {Promise<Object>} Random content item
 */
const getRandomContent = async (mac, contentType) => {
  if (!supabaseAdmin) throw new Error('Database not configured');

  const table = contentType === 'music' ? 'ai_music' :
    contentType === 'story' ? 'ai_story' : 'ai_textbook';

  // Get random content
  const { data, error } = await supabaseAdmin
    .from(table)
    .select('*')
    .eq('status', 1)
    .limit(10);

  if (error || !data || data.length === 0) {
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
  if (!supabaseAdmin) throw new Error('Database not configured');

  const searchPattern = `%${query}%`;

  // Search music
  const { data: music } = await supabaseAdmin
    .from('ai_music')
    .select('id, title, artist, category')
    .or(`title.ilike.${searchPattern},artist.ilike.${searchPattern}`)
    .limit(limit);

  // Search stories
  const { data: stories } = await supabaseAdmin
    .from('ai_story')
    .select('id, title, author, category')
    .or(`title.ilike.${searchPattern},author.ilike.${searchPattern}`)
    .limit(limit);

  // Search textbooks
  const { data: textbooks } = await supabaseAdmin
    .from('ai_textbook')
    .select('id, title, subject, grade')
    .or(`title.ilike.${searchPattern},subject.ilike.${searchPattern}`)
    .limit(limit);

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
  if (!supabaseAdmin) throw new Error('Database not configured');

  const table = playlistType === 'music' ? 'music_playlist' : 'story_playlist';

  const { data, error } = await supabaseAdmin
    .from(table)
    .select(`
      id,
      position,
      created_at,
      content_id,
      content_library (
        id,
        title,
        romanized,
        filename,
        content_type,
        category,
        aws_s3_url,
        duration_seconds,
        status
      )
    `)
    .eq('device_id', deviceId)
    .order('position', { ascending: true });

  if (error) {
    logger.error(`Failed to fetch ${playlistType} playlist`, { error: error.message, deviceId });
    throw new Error(`Failed to fetch ${playlistType} playlist`);
  }

  // Flatten the response
  return (data || []).map(item => ({
    id: item.id,
    position: item.position,
    contentId: item.content_id,
    createdAt: item.created_at,
    content: item.content_library
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
  if (!supabaseAdmin) throw new Error('Database not configured');

  const table = playlistType === 'music' ? 'music_playlist' : 'story_playlist';

  // If position not specified, get the max position and add 1
  if (position === undefined || position === null) {
    const { data: maxData } = await supabaseAdmin
      .from(table)
      .select('position')
      .eq('device_id', deviceId)
      .order('position', { ascending: false })
      .limit(1)
      .single();

    position = maxData ? maxData.position + 1 : 0;
  }

  const { data, error } = await supabaseAdmin
    .from(table)
    .insert({
      device_id: deviceId,
      content_id: contentId,
      position
    })
    .select(`
      id,
      position,
      created_at,
      content_id,
      content_library (
        id,
        title,
        romanized,
        filename,
        content_type,
        category,
        aws_s3_url,
        duration_seconds
      )
    `)
    .single();

  if (error) {
    // Check for duplicate entry
    if (error.code === '23505') {
      throw new Error('Content already exists in playlist');
    }
    logger.error(`Failed to add to ${playlistType} playlist`, { error: error.message, deviceId, contentId });
    throw new Error(`Failed to add to ${playlistType} playlist`);
  }

  return {
    id: data.id,
    position: data.position,
    contentId: data.content_id,
    createdAt: data.created_at,
    content: data.content_library
  };
};

/**
 * Remove content from playlist
 * @param {string} deviceId - Device ID
 * @param {string} contentId - Content ID
 * @param {string} playlistType - 'music' or 'story'
 */
const removeFromPlaylist = async (deviceId, contentId, playlistType) => {
  if (!supabaseAdmin) throw new Error('Database not configured');

  const table = playlistType === 'music' ? 'music_playlist' : 'story_playlist';

  const { error } = await supabaseAdmin
    .from(table)
    .delete()
    .eq('device_id', deviceId)
    .eq('content_id', contentId);

  if (error) {
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
  if (!supabaseAdmin) throw new Error('Database not configured');

  const table = playlistType === 'music' ? 'music_playlist' : 'story_playlist';

  const { error } = await supabaseAdmin
    .from(table)
    .delete()
    .eq('id', playlistItemId);

  if (error) {
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
  if (!supabaseAdmin) throw new Error('Database not configured');

  const table = playlistType === 'music' ? 'music_playlist' : 'story_playlist';

  const { error } = await supabaseAdmin
    .from(table)
    .delete()
    .eq('device_id', deviceId);

  if (error) {
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
  if (!supabaseAdmin) throw new Error('Database not configured');

  const table = playlistType === 'music' ? 'music_playlist' : 'story_playlist';

  // Update positions based on array order
  const updates = itemIds.map((id, index) => ({
    id,
    position: index,
    updated_at: new Date().toISOString()
  }));

  // Perform batch update
  for (const update of updates) {
    const { error } = await supabaseAdmin
      .from(table)
      .update({ position: update.position, updated_at: update.updated_at })
      .eq('id', update.id)
      .eq('device_id', deviceId);

    if (error) {
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
  if (!supabaseAdmin) throw new Error('Database not configured');

  const table = playlistType === 'music' ? 'music_playlist' : 'story_playlist';

  // Get current playlist
  const { data: playlist, error: fetchError } = await supabaseAdmin
    .from(table)
    .select('id, position')
    .eq('device_id', deviceId)
    .order('position', { ascending: true });

  if (fetchError) {
    logger.error('Failed to fetch playlist for reorder', { error: fetchError.message, deviceId });
    throw new Error('Failed to move playlist item');
  }

  // Find current item
  const currentIndex = playlist.findIndex(item => item.id === playlistItemId);
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
  if (!supabaseAdmin) throw new Error('Database not configured');

  const table = playlistType === 'music' ? 'music_playlist' : 'story_playlist';

  const { data, error } = await supabaseAdmin
    .from(table)
    .select(`
      id,
      device_id,
      position,
      created_at,
      content_id,
      content_library (
        id,
        title,
        romanized,
        filename,
        content_type,
        category,
        aws_s3_url,
        duration_seconds
      )
    `)
    .eq('id', playlistItemId)
    .single();

  if (error || !data) return null;

  return {
    id: data.id,
    deviceId: data.device_id,
    position: data.position,
    contentId: data.content_id,
    createdAt: data.created_at,
    content: data.content_library
  };
};

// ==================== CONTENT ITEMS METHODS ====================

/**
 * Get content items with pagination
 * @param {Object} options - Filter and pagination options
 * @returns {Promise<Object>} Paginated content items list
 */
const getContentItems = async ({ page = 1, limit = 10, contentType, category } = {}) => {
  if (!supabaseAdmin) throw new Error('Database not configured');

  const offset = (page - 1) * limit;

  let countQuery = supabaseAdmin
    .from('content_items')
    .select('id', { count: 'exact', head: true });

  let dataQuery = supabaseAdmin
    .from('content_items')
    .select('*')
    .order('created_at', { ascending: false });

  if (contentType) {
    countQuery = countQuery.eq('content_type', contentType);
    dataQuery = dataQuery.eq('content_type', contentType);
  }

  if (category) {
    countQuery = countQuery.eq('category', category);
    dataQuery = dataQuery.eq('category', category);
  }

  const { count } = await countQuery;
  const { data: items, error } = await dataQuery.range(offset, offset + limit - 1);

  if (error) {
    logger.error('Failed to fetch content items', { error: error.message });
    throw new Error('Failed to fetch content items');
  }

  return {
    list: items || [],
    total: count || 0,
    page,
    limit,
    pages: Math.ceil((count || 0) / limit)
  };
};

/**
 * Get content item by ID
 * @param {string} id - Content item ID
 * @returns {Promise<Object>} Content item
 */
const getContentItemById = async (id) => {
  if (!supabaseAdmin) throw new Error('Database not configured');

  const { data: item, error } = await supabaseAdmin
    .from('content_items')
    .select('*')
    .eq('id', id)
    .single();

  if (error && error.code !== 'PGRST116') {
    logger.error('Failed to fetch content item', { error: error.message });
    throw new Error('Failed to fetch content item');
  }

  return item || null;
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
  if (!supabaseAdmin) throw new Error('Database not configured');

  const offset = (page - 1) * limit;
  const searchPattern = `%${query}%`;

  let countQuery = supabaseAdmin
    .from('content_items')
    .select('id', { count: 'exact', head: true })
    .or(`title.ilike.${searchPattern},romanized.ilike.${searchPattern}`);

  let dataQuery = supabaseAdmin
    .from('content_items')
    .select('*')
    .or(`title.ilike.${searchPattern},romanized.ilike.${searchPattern}`)
    .order('created_at', { ascending: false });

  if (contentType) {
    countQuery = countQuery.eq('content_type', contentType);
    dataQuery = dataQuery.eq('content_type', contentType);
  }

  if (category) {
    countQuery = countQuery.eq('category', category);
    dataQuery = dataQuery.eq('category', category);
  }

  const { count } = await countQuery;
  const { data: items, error } = await dataQuery.range(offset, offset + limit - 1);

  if (error) {
    logger.error('Failed to search content items', { error: error.message });
    throw new Error('Failed to search content items');
  }

  return {
    list: items || [],
    total: count || 0,
    page,
    limit,
    pages: Math.ceil((count || 0) / limit)
  };
};

/**
 * Get categories for content items
 * @param {string} [contentType] - Optional content type filter
 * @returns {Promise<Array>} List of categories
 */
const getContentItemCategories = async (contentType) => {
  if (!supabaseAdmin) throw new Error('Database not configured');

  let query = supabaseAdmin
    .from('content_items')
    .select('category')
    .not('category', 'is', null);

  if (contentType) {
    query = query.eq('content_type', contentType);
  }

  const { data, error } = await query;

  if (error) {
    logger.error('Failed to fetch categories', { error: error.message });
    throw new Error('Failed to fetch categories');
  }

  // Extract unique categories
  const categories = [...new Set(data.map(item => item.category).filter(Boolean))];
  return categories.sort();
};

/**
 * Get content statistics
 * @returns {Promise<Object>} Statistics object
 */
const getContentItemStatistics = async () => {
  if (!supabaseAdmin) throw new Error('Database not configured');

  // Get total count
  const { count: total } = await supabaseAdmin
    .from('content_items')
    .select('id', { count: 'exact', head: true });

  // Get count by type
  const { data: typeData } = await supabaseAdmin
    .from('content_items')
    .select('content_type');

  const byType = {};
  if (typeData) {
    typeData.forEach(item => {
      byType[item.content_type] = (byType[item.content_type] || 0) + 1;
    });
  }

  // Get count by category
  const { data: categoryData } = await supabaseAdmin
    .from('content_items')
    .select('category');

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

/**
 * Create content item
 * @param {Object} data - Content item data
 * @returns {Promise<Object>} Created item
 */
const createContentItem = async (data) => {
  if (!supabaseAdmin) throw new Error('Database not configured');

  const insertData = {
    title: data.title,
    romanized: data.romanized || null,
    filename: data.filename || null,
    content_type: data.contentType,
    category: data.category || null,
    alternatives: data.alternatives || [],
    file_url: data.fileUrl || null,
    thumbnail_url: data.thumbnailUrl || null,
    duration_seconds: data.durationSeconds || null
  };

  const { data: item, error } = await supabaseAdmin
    .from('content_items')
    .insert(insertData)
    .select()
    .single();

  if (error) {
    logger.error('Failed to create content item', { error: error.message });
    throw new Error('Failed to create content item');
  }

  return item;
};

/**
 * Batch create content items
 * @param {Array} items - Array of content item data
 * @returns {Promise<Object>} Result with created count
 */
const batchCreateContentItems = async (items) => {
  if (!supabaseAdmin) throw new Error('Database not configured');

  if (!Array.isArray(items) || items.length === 0) {
    throw new Error('Items array is required');
  }

  const insertData = items.map(item => ({
    title: item.title,
    romanized: item.romanized || null,
    filename: item.filename || null,
    content_type: item.contentType,
    category: item.category || null,
    alternatives: item.alternatives || [],
    file_url: item.fileUrl || null,
    thumbnail_url: item.thumbnailUrl || null,
    duration_seconds: item.durationSeconds || null
  }));

  const { data, error } = await supabaseAdmin
    .from('content_items')
    .insert(insertData)
    .select();

  if (error) {
    logger.error('Failed to batch create content items', { error: error.message });
    throw new Error('Failed to batch create content items');
  }

  return {
    created: data.length,
    items: data
  };
};

/**
 * Update content item
 * @param {string} id - Content item ID
 * @param {Object} data - Update data
 * @returns {Promise<Object>} Updated item
 */
const updateContentItem = async (id, data) => {
  if (!supabaseAdmin) throw new Error('Database not configured');

  const updateData = {
    updated_at: new Date().toISOString()
  };

  if (data.title !== undefined) updateData.title = data.title;
  if (data.romanized !== undefined) updateData.romanized = data.romanized;
  if (data.filename !== undefined) updateData.filename = data.filename;
  if (data.contentType !== undefined) updateData.content_type = data.contentType;
  if (data.category !== undefined) updateData.category = data.category;
  if (data.alternatives !== undefined) updateData.alternatives = data.alternatives;
  if (data.fileUrl !== undefined) updateData.file_url = data.fileUrl;
  if (data.thumbnailUrl !== undefined) updateData.thumbnail_url = data.thumbnailUrl;
  if (data.durationSeconds !== undefined) updateData.duration_seconds = data.durationSeconds;

  const { data: item, error } = await supabaseAdmin
    .from('content_items')
    .update(updateData)
    .eq('id', id)
    .select()
    .single();

  if (error) {
    logger.error('Failed to update content item', { error: error.message });
    throw new Error('Failed to update content item');
  }

  return item;
};

/**
 * Batch update content items
 * @param {Array} updates - Array of {id, ...updateData} objects
 * @returns {Promise<Object>} Result with updated count
 */
const batchUpdateContentItems = async (updates) => {
  if (!supabaseAdmin) throw new Error('Database not configured');

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
  if (!supabaseAdmin) throw new Error('Database not configured');

  const { error } = await supabaseAdmin
    .from('content_items')
    .delete()
    .eq('id', id);

  if (error) {
    logger.error('Failed to delete content item', { error: error.message });
    throw new Error('Failed to delete content item');
  }

  return true;
};

/**
 * Batch delete content items
 * @param {Array} ids - Array of content item IDs
 * @returns {Promise<Object>} Result with deleted count
 */
const batchDeleteContentItems = async (ids) => {
  if (!supabaseAdmin) throw new Error('Database not configured');

  if (!Array.isArray(ids) || ids.length === 0) {
    throw new Error('IDs array is required');
  }

  const { error, count } = await supabaseAdmin
    .from('content_items')
    .delete()
    .in('id', ids);

  if (error) {
    logger.error('Failed to batch delete content items', { error: error.message });
    throw new Error('Failed to batch delete content items');
  }

  return {
    deleted: count || ids.length
  };
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
