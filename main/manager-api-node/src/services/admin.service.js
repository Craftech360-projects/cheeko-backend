/**
 * Admin Service
 *
 * Handles admin operations including:
 * - User management for super admins
 * - System statistics
 * - Role-based access control
 */

const { supabaseAdmin } = require('../config/database');
const bcrypt = require('bcryptjs');
const logger = require('../utils/logger');

// ==================== USER MANAGEMENT ====================

/**
 * Get all users (paginated)
 * @param {Object} options - Pagination and filter options
 * @returns {Promise<Object>} Paginated user list
 */
const listUsers = async ({ page = 1, limit = 20, status, superAdmin, search } = {}) => {
  if (!supabaseAdmin) throw new Error('Database not configured');

  const offset = (page - 1) * limit;

  let countQuery = supabaseAdmin
    .from('sys_user')
    .select('id', { count: 'exact', head: true });

  let dataQuery = supabaseAdmin
    .from('sys_user')
    .select('id, username, status, super_admin, created_at, updated_at')
    .order('created_at', { ascending: false });

  // Apply filters
  if (status !== undefined) {
    countQuery = countQuery.eq('status', status);
    dataQuery = dataQuery.eq('status', status);
  }

  if (superAdmin !== undefined) {
    countQuery = countQuery.eq('super_admin', superAdmin);
    dataQuery = dataQuery.eq('super_admin', superAdmin);
  }

  if (search) {
    countQuery = countQuery.ilike('username', `%${search}%`);
    dataQuery = dataQuery.ilike('username', `%${search}%`);
  }

  const { count } = await countQuery;
  const { data: users, error } = await dataQuery.range(offset, offset + limit - 1);

  if (error) {
    logger.error('Failed to fetch users:', error);
    throw new Error('Failed to fetch users');
  }

  return {
    list: users || [],
    total: count || 0,
    page,
    limit
  };
};

/**
 * Get users for admin page (paginated) - Spring Boot compatible format
 * Returns data in the format expected by manager-web frontend:
 * { userid, mobile, deviceCount, status, createDate }
 * @param {Object} options - Pagination and filter options
 * @returns {Promise<Object>} Paginated user list in Spring Boot format
 */
const listUsersForAdmin = async ({ page = 1, limit = 20, mobile } = {}) => {
  if (!supabaseAdmin) throw new Error('Database not configured');

  const offset = (page - 1) * limit;

  // Build count query
  let countQuery = supabaseAdmin
    .from('sys_user')
    .select('id', { count: 'exact', head: true });

  // Build data query
  let dataQuery = supabaseAdmin
    .from('sys_user')
    .select('id, username, status, created_at')
    .order('created_at', { ascending: false });

  // Apply mobile filter (searches username since we use username as mobile)
  if (mobile) {
    countQuery = countQuery.ilike('username', `%${mobile}%`);
    dataQuery = dataQuery.ilike('username', `%${mobile}%`);
  }

  const { count } = await countQuery;
  const { data: users, error } = await dataQuery.range(offset, offset + limit - 1);

  if (error) {
    logger.error('Failed to fetch users for admin:', error);
    throw new Error('Failed to fetch users');
  }

  // Get device info for each user (MAC addresses and IDs)
  const userIds = (users || []).map(u => u.id);
  let devicesByUser = {};

  if (userIds.length > 0) {
    const { data: devices } = await supabaseAdmin
      .from('ai_device')
      .select('id, user_id, mac_address')
      .in('user_id', userIds);

    // Group devices by user
    (devices || []).forEach(d => {
      if (!devicesByUser[d.user_id]) {
        devicesByUser[d.user_id] = [];
      }
      devicesByUser[d.user_id].push({
        id: d.id,
        macAddress: d.mac_address
      });
    });
  }

  // Transform to Spring Boot format
  const list = (users || []).map(user => ({
    userid: user.id,
    mobile: user.username, // Spring Boot uses mobile, we use username
    deviceCount: String((devicesByUser[user.id] || []).length),
    devices: devicesByUser[user.id] || [], // Include device list with MAC addresses
    status: user.status,
    createDate: user.created_at
  }));

  return {
    list,
    total: count || 0
  };
};

/**
 * Batch update user status
 * @param {Array<number>} userIds - User IDs to update
 * @param {number} status - New status (0=disabled, 1=enabled)
 */
const batchUpdateUserStatus = async (userIds, status) => {
  if (!supabaseAdmin) throw new Error('Database not configured');

  const { error } = await supabaseAdmin
    .from('sys_user')
    .update({ status, updated_at: new Date().toISOString() })
    .in('id', userIds);

  if (error) {
    logger.error('Failed to batch update user status:', error);
    throw new Error('Failed to update user status');
  }
};

/**
 * Get all users without pagination
 * @returns {Promise<Array>} All users
 */
const getAllUsers = async () => {
  if (!supabaseAdmin) throw new Error('Database not configured');

  const { data: users, error } = await supabaseAdmin
    .from('sys_user')
    .select('id, username, status, super_admin, created_at, updated_at')
    .order('username', { ascending: true });

  if (error) {
    logger.error('Failed to fetch all users:', error);
    throw new Error('Failed to fetch users');
  }

  return users || [];
};

/**
 * Get user by ID
 * @param {string} id - User ID
 * @returns {Promise<Object|null>} User or null
 */
const getUserById = async (id) => {
  if (!supabaseAdmin) throw new Error('Database not configured');

  const { data: user, error } = await supabaseAdmin
    .from('sys_user')
    .select('id, username, status, super_admin, created_at, updated_at')
    .eq('id', id)
    .single();

  if (error || !user) return null;

  return user;
};

/**
 * Get user by username
 * @param {string} username - Username
 * @returns {Promise<Object|null>} User or null
 */
const getUserByUsername = async (username) => {
  if (!supabaseAdmin) throw new Error('Database not configured');

  const { data: user, error } = await supabaseAdmin
    .from('sys_user')
    .select('id, username, status, super_admin, created_at, updated_at')
    .eq('username', username)
    .single();

  if (error || !user) return null;

  return user;
};

/**
 * Create a new user (admin function)
 * @param {number} creatorId - Admin user ID creating this user
 * @param {Object} data - User data
 * @returns {Promise<Object>} Created user
 */
const createUser = async (creatorId, data) => {
  if (!supabaseAdmin) throw new Error('Database not configured');

  // Check if username already exists
  const existing = await getUserByUsername(data.username);
  if (existing) {
    throw new Error('Username already exists');
  }

  // Hash password
  const salt = await bcrypt.genSalt(10);
  const hashedPassword = await bcrypt.hash(data.password, salt);

  const { data: user, error } = await supabaseAdmin
    .from('sys_user')
    .insert({
      username: data.username,
      password: hashedPassword,
      status: data.status !== undefined ? data.status : 1,
      super_admin: data.superAdmin !== undefined ? data.superAdmin : 0,
      creator: creatorId
    })
    .select('id, username, status, super_admin, created_at')
    .single();

  if (error) {
    logger.error('Failed to create user:', error);
    throw new Error('Failed to create user');
  }

  return user;
};

/**
 * Update user
 * @param {string} id - User ID
 * @param {Object} data - Update data
 * @returns {Promise<Object>} Updated user
 */
const updateUser = async (id, data) => {
  if (!supabaseAdmin) throw new Error('Database not configured');

  const updateData = { updated_at: new Date().toISOString() };

  if (data.username !== undefined) {
    // Check if new username is taken
    const existing = await getUserByUsername(data.username);
    if (existing && existing.id !== parseInt(id)) {
      throw new Error('Username already exists');
    }
    updateData.username = data.username;
  }

  if (data.password !== undefined) {
    const salt = await bcrypt.genSalt(10);
    updateData.password = await bcrypt.hash(data.password, salt);
  }

  if (data.status !== undefined) updateData.status = data.status;
  if (data.superAdmin !== undefined) updateData.super_admin = data.superAdmin;
  if (data.updater !== undefined) updateData.updater = data.updater;

  const { data: user, error } = await supabaseAdmin
    .from('sys_user')
    .update(updateData)
    .eq('id', id)
    .select('id, username, status, super_admin, created_at, updated_at')
    .single();

  if (error) {
    logger.error('Failed to update user:', error);
    throw new Error('Failed to update user');
  }

  return user;
};

/**
 * Delete user
 * @param {string} id - User ID
 */
const deleteUser = async (id) => {
  if (!supabaseAdmin) throw new Error('Database not configured');

  // First delete user tokens
  await supabaseAdmin
    .from('sys_user_token')
    .delete()
    .eq('user_id', id);

  // Delete user
  const { error } = await supabaseAdmin
    .from('sys_user')
    .delete()
    .eq('id', id);

  if (error) {
    logger.error('Failed to delete user:', error);
    throw new Error('Failed to delete user');
  }
};

/**
 * Batch delete users
 * @param {Array<string>} ids - User IDs to delete
 */
const deleteUsers = async (ids) => {
  if (!supabaseAdmin) throw new Error('Database not configured');

  // First delete user tokens
  await supabaseAdmin
    .from('sys_user_token')
    .delete()
    .in('user_id', ids);

  // Delete users
  const { error } = await supabaseAdmin
    .from('sys_user')
    .delete()
    .in('id', ids);

  if (error) {
    logger.error('Failed to delete users:', error);
    throw new Error('Failed to delete users');
  }
};

/**
 * Update user status (enable/disable)
 * @param {string} id - User ID
 * @param {number} status - Status (0=disabled, 1=enabled)
 * @returns {Promise<Object>} Updated user
 */
const updateUserStatus = async (id, status) => {
  return updateUser(id, { status });
};

/**
 * Reset user password
 * @param {string} id - User ID
 * @param {string} newPassword - New password
 * @returns {Promise<Object>} Updated user
 */
const resetUserPassword = async (id, newPassword) => {
  return updateUser(id, { password: newPassword });
};

/**
 * Reset user password and return the new password (Spring Boot compatible)
 * Generates a random 6-digit password, updates the user, and returns the password
 * @param {string} id - User ID
 * @returns {Promise<string>} The new password
 */
const resetPasswordAndReturn = async (id) => {
  if (!supabaseAdmin) throw new Error('Database not configured');

  // Generate random 6-digit password (matches Spring Boot behavior)
  const newPassword = String(Math.floor(100000 + Math.random() * 900000));

  // Hash and update
  const salt = await bcrypt.genSalt(10);
  const hashedPassword = await bcrypt.hash(newPassword, salt);

  const { error } = await supabaseAdmin
    .from('sys_user')
    .update({
      password: hashedPassword,
      updated_at: new Date().toISOString()
    })
    .eq('id', id);

  if (error) {
    logger.error('Failed to reset password:', error);
    throw new Error('Failed to reset password');
  }

  return newPassword;
};

/**
 * Grant or revoke super admin
 * @param {string} id - User ID
 * @param {number} superAdmin - Super admin flag (0 or 1)
 * @returns {Promise<Object>} Updated user
 */
const setUserSuperAdmin = async (id, superAdmin) => {
  return updateUser(id, { superAdmin });
};

// ==================== SYSTEM STATISTICS ====================

/**
 * Get system overview statistics
 * @returns {Promise<Object>} Overview stats
 */
const getSystemOverview = async () => {
  if (!supabaseAdmin) throw new Error('Database not configured');

  const stats = {};

  // User counts
  const { count: totalUsers } = await supabaseAdmin
    .from('sys_user')
    .select('id', { count: 'exact', head: true });
  stats.totalUsers = totalUsers || 0;

  const { count: activeUsers } = await supabaseAdmin
    .from('sys_user')
    .select('id', { count: 'exact', head: true })
    .eq('status', 1);
  stats.activeUsers = activeUsers || 0;

  const { count: superAdmins } = await supabaseAdmin
    .from('sys_user')
    .select('id', { count: 'exact', head: true })
    .eq('super_admin', 1);
  stats.superAdmins = superAdmins || 0;

  // Device counts
  const { count: totalDevices } = await supabaseAdmin
    .from('ai_device')
    .select('id', { count: 'exact', head: true });
  stats.totalDevices = totalDevices || 0;

  const { count: onlineDevices } = await supabaseAdmin
    .from('ai_device')
    .select('id', { count: 'exact', head: true })
    .eq('online', 1);
  stats.onlineDevices = onlineDevices || 0;

  // Agent counts
  const { count: totalAgents } = await supabaseAdmin
    .from('ai_agent')
    .select('id', { count: 'exact', head: true });
  stats.totalAgents = totalAgents || 0;

  // Content counts
  const { count: totalContent } = await supabaseAdmin
    .from('content_library')
    .select('id', { count: 'exact', head: true });
  stats.totalContent = totalContent || 0;

  // Kid profiles count
  const { count: totalKids } = await supabaseAdmin
    .from('kid_profile')
    .select('id', { count: 'exact', head: true });
  stats.totalKids = totalKids || 0;

  // RFID card counts
  const { count: totalRfidCards } = await supabaseAdmin
    .from('rfid_card_mapping')
    .select('id', { count: 'exact', head: true });
  stats.totalRfidCards = totalRfidCards || 0;

  return stats;
};

/**
 * Get user registration statistics
 * @param {number} days - Number of days to include (default 30)
 * @returns {Promise<Object>} Registration stats by day
 */
const getUserRegistrationStats = async (days = 30) => {
  if (!supabaseAdmin) throw new Error('Database not configured');

  const startDate = new Date();
  startDate.setDate(startDate.getDate() - days);
  startDate.setHours(0, 0, 0, 0);

  const { data: users, error } = await supabaseAdmin
    .from('sys_user')
    .select('created_at')
    .gte('created_at', startDate.toISOString())
    .order('created_at', { ascending: true });

  if (error) {
    logger.error('Failed to fetch user registration stats:', error);
    throw new Error('Failed to fetch statistics');
  }

  // Group by date
  const dailyStats = {};
  (users || []).forEach(user => {
    const date = new Date(user.created_at).toISOString().split('T')[0];
    dailyStats[date] = (dailyStats[date] || 0) + 1;
  });

  // Fill in missing dates with 0
  const result = [];
  const currentDate = new Date(startDate);
  const endDate = new Date();

  while (currentDate <= endDate) {
    const dateStr = currentDate.toISOString().split('T')[0];
    result.push({
      date: dateStr,
      count: dailyStats[dateStr] || 0
    });
    currentDate.setDate(currentDate.getDate() + 1);
  }

  return {
    period: days,
    data: result,
    total: users?.length || 0
  };
};

/**
 * Get device registration statistics
 * @param {number} days - Number of days to include (default 30)
 * @returns {Promise<Object>} Device registration stats by day
 */
const getDeviceRegistrationStats = async (days = 30) => {
  if (!supabaseAdmin) throw new Error('Database not configured');

  const startDate = new Date();
  startDate.setDate(startDate.getDate() - days);
  startDate.setHours(0, 0, 0, 0);

  const { data: devices, error } = await supabaseAdmin
    .from('ai_device')
    .select('created_at')
    .gte('created_at', startDate.toISOString())
    .order('created_at', { ascending: true });

  if (error) {
    logger.error('Failed to fetch device registration stats:', error);
    throw new Error('Failed to fetch statistics');
  }

  // Group by date
  const dailyStats = {};
  (devices || []).forEach(device => {
    const date = new Date(device.created_at).toISOString().split('T')[0];
    dailyStats[date] = (dailyStats[date] || 0) + 1;
  });

  // Fill in missing dates with 0
  const result = [];
  const currentDate = new Date(startDate);
  const endDate = new Date();

  while (currentDate <= endDate) {
    const dateStr = currentDate.toISOString().split('T')[0];
    result.push({
      date: dateStr,
      count: dailyStats[dateStr] || 0
    });
    currentDate.setDate(currentDate.getDate() + 1);
  }

  return {
    period: days,
    data: result,
    total: devices?.length || 0
  };
};

/**
 * Get content statistics by type
 * @returns {Promise<Object>} Content counts by type
 */
const getContentStats = async () => {
  if (!supabaseAdmin) throw new Error('Database not configured');

  const { data: content, error } = await supabaseAdmin
    .from('content_library')
    .select('content_type');

  if (error) {
    logger.error('Failed to fetch content stats:', error);
    throw new Error('Failed to fetch statistics');
  }

  // Group by type
  const byType = {};
  (content || []).forEach(item => {
    const type = item.content_type || 'unknown';
    byType[type] = (byType[type] || 0) + 1;
  });

  return {
    total: content?.length || 0,
    byType
  };
};

/**
 * Get session statistics (analytics)
 * @param {number} days - Number of days to include (default 30)
 * @returns {Promise<Object>} Session stats
 */
const getSessionStats = async (days = 30) => {
  if (!supabaseAdmin) throw new Error('Database not configured');

  const startDate = new Date();
  startDate.setDate(startDate.getDate() - days);
  startDate.setHours(0, 0, 0, 0);

  const { data: sessions, error } = await supabaseAdmin
    .from('analytics_game_session')
    .select('game_type, start_time, total_score')
    .gte('start_time', startDate.toISOString())
    .order('start_time', { ascending: true });

  if (error) {
    logger.error('Failed to fetch session stats:', error);
    throw new Error('Failed to fetch statistics');
  }

  // Group by game type
  const byGameType = {};
  let totalScore = 0;

  (sessions || []).forEach(session => {
    const type = session.game_type || 'unknown';
    byGameType[type] = (byGameType[type] || 0) + 1;
    totalScore += session.total_score || 0;
  });

  // Group by date
  const dailyStats = {};
  (sessions || []).forEach(session => {
    const date = new Date(session.start_time).toISOString().split('T')[0];
    dailyStats[date] = (dailyStats[date] || 0) + 1;
  });

  return {
    period: days,
    totalSessions: sessions?.length || 0,
    totalScore,
    byGameType,
    dailyStats
  };
};

/**
 * Get token usage statistics
 * @param {number} days - Number of days to include (default 30)
 * @returns {Promise<Object>} Token usage stats
 */
const getTokenUsageStats = async (days = 30) => {
  if (!supabaseAdmin) throw new Error('Database not configured');

  const startDate = new Date();
  startDate.setDate(startDate.getDate() - days);
  startDate.setHours(0, 0, 0, 0);

  const { data: usage, error } = await supabaseAdmin
    .from('device_token_usage')
    .select('input_tokens, output_tokens, total_tokens, usage_date')
    .gte('usage_date', startDate.toISOString().split('T')[0])
    .order('usage_date', { ascending: true });

  if (error) {
    logger.error('Failed to fetch token usage stats:', error);
    throw new Error('Failed to fetch statistics');
  }

  // Aggregate totals
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let totalTokens = 0;

  // Group by date
  const dailyStats = {};

  (usage || []).forEach(record => {
    totalInputTokens += record.input_tokens || 0;
    totalOutputTokens += record.output_tokens || 0;
    totalTokens += record.total_tokens || 0;

    const date = record.usage_date;
    if (!dailyStats[date]) {
      dailyStats[date] = { input: 0, output: 0, total: 0 };
    }
    dailyStats[date].input += record.input_tokens || 0;
    dailyStats[date].output += record.output_tokens || 0;
    dailyStats[date].total += record.total_tokens || 0;
  });

  return {
    period: days,
    totalInputTokens,
    totalOutputTokens,
    totalTokens,
    dailyStats
  };
};

/**
 * Get active sessions (currently online devices with activity)
 * @returns {Promise<Object>} Active session info
 */
const getActiveSessions = async () => {
  if (!supabaseAdmin) throw new Error('Database not configured');

  // Get online devices with recent activity
  const fiveMinutesAgo = new Date();
  fiveMinutesAgo.setMinutes(fiveMinutesAgo.getMinutes() - 5);

  const { data: devices, error } = await supabaseAdmin
    .from('ai_device')
    .select('mac_address, device_name, online, agent_id, updated_at')
    .eq('online', 1)
    .gte('updated_at', fiveMinutesAgo.toISOString());

  if (error) {
    logger.error('Failed to fetch active sessions:', error);
    throw new Error('Failed to fetch active sessions');
  }

  return {
    count: devices?.length || 0,
    devices: devices || []
  };
};

/**
 * Get all devices (paginated) with user info
 * Matches Spring Boot UserShowDeviceListVO format
 * @param {Object} options - Pagination and filter options
 * @returns {Promise<Object>} Paginated device list
 */
const getAllDevices = async ({ page = 1, limit = 10, keywords = '' } = {}) => {
  if (!supabaseAdmin) throw new Error('Database not configured');

  const offset = (page - 1) * limit;

  // Build query with optional keyword search
  let countQuery = supabaseAdmin
    .from('ai_device')
    .select('id', { count: 'exact', head: true });

  let dataQuery = supabaseAdmin
    .from('ai_device')
    .select(`
      id,
      mac_address,
      board,
      app_version,
      agent_id,
      auto_update,
      last_connected_at,
      user_id,
      alias,
      kid_id,
      device_mode
    `);

  // Apply keyword filter if provided
  if (keywords) {
    countQuery = countQuery.or(`mac_address.ilike.%${keywords}%,alias.ilike.%${keywords}%`);
    dataQuery = dataQuery.or(`mac_address.ilike.%${keywords}%,alias.ilike.%${keywords}%`);
  }

  // Get count
  const { count, error: countError } = await countQuery;
  if (countError) {
    logger.error('Failed to count devices:', countError);
    throw new Error('Failed to fetch devices');
  }

  // Get paginated data
  const { data: devices, error: dataError } = await dataQuery
    .order('create_date', { ascending: false })
    .range(offset, offset + limit - 1);

  if (dataError) {
    logger.error('Failed to fetch devices:', dataError);
    throw new Error('Failed to fetch devices');
  }

  // Get usernames for each device
  const userIds = [...new Set(devices?.filter(d => d.user_id).map(d => d.user_id) || [])];
  let userMap = {};

  if (userIds.length > 0) {
    const { data: users } = await supabaseAdmin
      .from('sys_user')
      .select('id, username')
      .in('id', userIds);

    if (users) {
      userMap = users.reduce((acc, u) => {
        acc[u.id] = u.username;
        return acc;
      }, {});
    }
  }

  // Transform to Spring Boot UserShowDeviceListVO format
  const list = (devices || []).map(device => ({
    id: device.id,
    macAddress: device.mac_address,
    deviceType: device.board,
    board: device.board, // Also include as 'board' for frontend compatibility
    appVersion: device.app_version,
    agentId: device.agent_id,
    userId: device.user_id, // Include user_id for admin operations
    kidId: device.kid_id, // Include kid_id for kid profile navigation
    alias: device.alias, // Include alias for display/edit
    deviceMode: device.device_mode || 'manual', // Include device mode (auto/manual)
    bindUserName: userMap[device.user_id] || null,
    autoUpdate: device.auto_update, // Also include as autoUpdate for frontend
    otaUpgrade: device.auto_update,
    lastConnectedAt: device.last_connected_at, // Also include for frontend
    recentChatTime: device.last_connected_at
      ? new Date(device.last_connected_at).toISOString().replace('T', ' ').slice(0, 19)
      : null
  }));

  return {
    list,
    total: count || 0,
    page,
    limit
  };
};

/**
 * Get kid profiles by user ID (admin only)
 */
const getKidProfilesByUserId = async (userId) => {
  if (!supabaseAdmin) throw new Error('Database not configured');

  console.log('[admin.service] Fetching kid profiles for userId:', userId);

  const { data, error } = await supabaseAdmin
    .from('kid_profile')
    .select('*')
    .eq('user_id', userId);

  if (error) {
    console.error('[admin.service] Error fetching kid profiles:', error);
    throw new Error(`Failed to get kid profiles: ${error.message}`);
  }

  console.log('[admin.service] Found kid profiles:', data?.length || 0);
  return data || [];
};

/**
 * Create kid profile for a user (admin)
 * @param {number} userId - User ID
 * @param {Object} data - Profile data
 * @returns {Promise<Object>} Created profile
 */
const createKidProfileForUser = async (userId, data) => {
  if (!supabaseAdmin) throw new Error('Database not configured');

  const { data: profile, error } = await supabaseAdmin
    .from('kid_profile')
    .insert({
      user_id: userId,
      name: data.name,
      nickname: data.nickname,
      avatar_url: data.avatarUrl,
      birth_date: data.birthDate,
      gender: data.gender,
      grade: data.grade,
      school: data.school,
      interests: data.interests,
      language: data.language || 'en',
      timezone: data.timezone,
      preferences: data.preferences || {}
    })
    .select()
    .single();

  if (error) throw new Error('Failed to create kid profile');

  return profile;
};

/**
 * Update kid profile (admin - no ownership check)
 * @param {number} kidId - Kid ID
 * @param {Object} data - Update data
 * @returns {Promise<Object>} Updated profile
 */
const updateKidProfile = async (kidId, data) => {
  if (!supabaseAdmin) throw new Error('Database not configured');

  const updateData = { updated_at: new Date().toISOString() };

  if (data.name !== undefined) updateData.name = data.name;
  if (data.nickname !== undefined) updateData.nickname = data.nickname;
  if (data.avatarUrl !== undefined) updateData.avatar_url = data.avatarUrl;
  if (data.birthDate !== undefined) updateData.birth_date = data.birthDate;
  if (data.gender !== undefined) updateData.gender = data.gender;
  if (data.grade !== undefined) updateData.grade = data.grade;
  if (data.school !== undefined) updateData.school = data.school;
  if (data.interests !== undefined) updateData.interests = data.interests;
  if (data.language !== undefined) updateData.language = data.language;
  if (data.timezone !== undefined) updateData.timezone = data.timezone;
  if (data.preferences !== undefined) updateData.preferences = data.preferences;

  const { data: profile, error } = await supabaseAdmin
    .from('kid_profile')
    .update(updateData)
    .eq('id', kidId)
    .select()
    .single();

  if (error) throw new Error('Failed to update kid profile');

  return profile;
};

/**
 * Delete kid profile (admin - no ownership check)
 * @param {number} kidId - Kid ID
 */
const deleteKidProfile = async (kidId) => {
  if (!supabaseAdmin) throw new Error('Database not configured');

  // First unassign from any devices
  await supabaseAdmin
    .from('ai_device')
    .update({ kid_id: null })
    .eq('kid_id', kidId);

  const { error } = await supabaseAdmin
    .from('kid_profile')
    .delete()
    .eq('id', kidId);

  if (error) throw new Error('Failed to delete kid profile');
};

/**
 * Assign kid to device (admin - no ownership check)
 * @param {string} deviceId - Device ID
 * @param {number|null} kidId - Kid ID or null to unassign
 * @returns {Promise<Object>} Updated device
 */
const assignKidToDeviceAdmin = async (deviceId, kidId) => {
  if (!supabaseAdmin) throw new Error('Database not configured');

  const { data: device, error } = await supabaseAdmin
    .from('ai_device')
    .update({ kid_id: kidId })
    .eq('id', deviceId)
    .select()
    .single();

  if (error) throw new Error('Failed to assign kid to device');

  return device;
};

module.exports = {
  // User Management
  listUsers,
  listUsersForAdmin,
  getAllUsers,
  getUserById,
  getUserByUsername,
  createUser,
  updateUser,
  deleteUser,
  deleteUsers,
  updateUserStatus,
  batchUpdateUserStatus,
  resetUserPassword,
  resetPasswordAndReturn,
  setUserSuperAdmin,

  // Device Management
  getAllDevices,

  // Kid Profiles
  getKidProfilesByUserId,
  createKidProfileForUser,
  updateKidProfile,
  deleteKidProfile,
  assignKidToDeviceAdmin,

  // System Statistics
  getSystemOverview,
  getUserRegistrationStats,
  getDeviceRegistrationStats,
  getContentStats,
  getSessionStats,
  getTokenUsageStats,
  getActiveSessions
};
