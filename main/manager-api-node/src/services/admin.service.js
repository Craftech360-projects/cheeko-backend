/**
 * Admin Service
 *
 * Handles admin operations including:
 * - User management for super admins
 * - System statistics
 * - Role-based access control
 */

const { prisma } = require('../config/database');
const bcrypt = require('bcryptjs');
const logger = require('../utils/logger');
const { sanitizeParentRule } = require('./profile.service');

// ==================== USER MANAGEMENT ====================

/**
 * Get all users (paginated)
 * @param {Object} options - Pagination and filter options
 * @returns {Promise<Object>} Paginated user list
 */
const listUsers = async ({ page = 1, limit = 20, status, superAdmin, search } = {}) => {
  const offset = (page - 1) * limit;

  const where = {};

  if (status !== undefined) {
    where.status = status;
  }

  // super_admin=1 maps to role='admin' in the new schema
  if (superAdmin !== undefined) {
    where.role = superAdmin === 1 ? 'admin' : { not: 'admin' };
  }

  if (search) {
    where.username = { contains: search, mode: 'insensitive' };
  }

  try {
    const [total, users] = await Promise.all([
      prisma.sys_user.count({ where }),
      prisma.sys_user.findMany({
        where,
        select: {
          id: true,
          username: true,
          status: true,
          role: true,
          created_at: true,
          updated_at: true
        },
        orderBy: { created_at: 'desc' },
        skip: offset,
        take: limit
      })
    ]);

    // Map role back to super_admin for backward compatibility with callers
    const list = users.map(u => ({
      ...u,
      id: u.id,
      super_admin: u.role === 'admin' ? 1 : 0
    }));

    return {
      list,
      total,
      page,
      limit
    };
  } catch (err) {
    logger.error('Failed to fetch users:', err);
    throw new Error('Failed to fetch users');
  }
};

/**
 * Get users for admin page (paginated) - Spring Boot compatible format
 * Returns data in the format expected by manager-web frontend:
 * { userid, mobile, deviceCount, status, createDate }
 * @param {Object} options - Pagination and filter options
 * @returns {Promise<Object>} Paginated user list in Spring Boot format
 */
const listUsersForAdmin = async ({ page = 1, limit = 20, mobile } = {}) => {
  const offset = (page - 1) * limit;

  const where = {};

  // Apply mobile filter (searches username since we use username as mobile)
  if (mobile) {
    where.username = { contains: mobile, mode: 'insensitive' };
  }

  try {
    const [total, users] = await Promise.all([
      prisma.sys_user.count({ where }),
      prisma.sys_user.findMany({
        where,
        select: {
          id: true,
          username: true,
          status: true,
          created_at: true
        },
        orderBy: { created_at: 'desc' },
        skip: offset,
        take: limit
      })
    ]);

    // Get device info for each user (MAC addresses and IDs)
    const userIds = users.map(u => u.id);
    let devicesByUser = {};

    if (userIds.length > 0) {
      const devices = await prisma.ai_device.findMany({
        where: { user_id: { in: userIds } },
        select: { id: true, user_id: true, mac_address: true }
      });

      // Group devices by user
      devices.forEach(d => {
        const uid = d.user_id;
        if (!devicesByUser[uid]) {
          devicesByUser[uid] = [];
        }
        devicesByUser[uid].push({
          id: d.id,
          macAddress: d.mac_address
        });
      });
    }

    // Transform to Spring Boot format
    const list = users.map(user => ({
      userid: user.id,
      mobile: user.username, // Spring Boot uses mobile, we use username
      deviceCount: String((devicesByUser[user.id] || []).length),
      devices: devicesByUser[user.id] || [], // Include device list with MAC addresses
      status: user.status,
      createDate: user.created_at
    }));

    return {
      list,
      total
    };
  } catch (err) {
    logger.error('Failed to fetch users for admin:', err);
    throw new Error('Failed to fetch users');
  }
};

/**
 * Batch update user status
 * @param {Array<number>} userIds - User IDs to update
 * @param {number} status - New status (0=disabled, 1=enabled)
 */
const batchUpdateUserStatus = async (userIds, status) => {
  try {
    await prisma.sys_user.updateMany({
      where: { id: { in: userIds.map(id => BigInt(id)) } },
      data: { status, updated_at: new Date() }
    });
  } catch (err) {
    logger.error('Failed to batch update user status:', err);
    throw new Error('Failed to update user status');
  }
};

/**
 * Get all users without pagination
 * @returns {Promise<Array>} All users
 */
const getAllUsers = async () => {
  try {
    const users = await prisma.sys_user.findMany({
      select: {
        id: true,
        username: true,
        status: true,
        role: true,
        created_at: true,
        updated_at: true
      },
      orderBy: { username: 'asc' }
    });

    return users.map(u => ({
      ...u,
      super_admin: u.role === 'admin' ? 1 : 0
    }));
  } catch (err) {
    logger.error('Failed to fetch all users:', err);
    throw new Error('Failed to fetch users');
  }
};

/**
 * Get user by ID
 * @param {string} id - User ID
 * @returns {Promise<Object|null>} User or null
 */
const getUserById = async (id) => {
  try {
    const user = await prisma.sys_user.findFirst({
      where: { id: BigInt(id) },
      select: {
        id: true,
        username: true,
        status: true,
        role: true,
        created_at: true,
        updated_at: true
      }
    });

    if (!user) return null;

    return {
      ...user,
      super_admin: user.role === 'admin' ? 1 : 0
    };
  } catch (err) {
    return null;
  }
};

/**
 * Get user by username
 * @param {string} username - Username
 * @returns {Promise<Object|null>} User or null
 */
const getUserByUsername = async (username) => {
  try {
    const user = await prisma.sys_user.findFirst({
      where: { username },
      select: {
        id: true,
        username: true,
        status: true,
        role: true,
        created_at: true,
        updated_at: true
      }
    });

    if (!user) return null;

    return {
      ...user,
      super_admin: user.role === 'admin' ? 1 : 0
    };
  } catch (err) {
    return null;
  }
};

/**
 * Create a new user (admin function)
 * @param {number} creatorId - Admin user ID creating this user
 * @param {Object} data - User data
 * @returns {Promise<Object>} Created user
 */
const createUser = async (creatorId, data) => {
  // Check if username already exists
  const existing = await getUserByUsername(data.username);
  if (existing) {
    throw new Error('Username already exists');
  }

  // Hash password
  const salt = await bcrypt.genSalt(10);
  const hashedPassword = await bcrypt.hash(data.password, salt);

  // Map superAdmin flag to role
  const role = data.superAdmin === 1 ? 'admin' : 'user';

  try {
    const user = await prisma.sys_user.create({
      data: {
        username: data.username,
        password: hashedPassword,
        status: data.status !== undefined ? data.status : 1,
        role
      },
      select: {
        id: true,
        username: true,
        status: true,
        role: true,
        created_at: true
      }
    });

    return {
      ...user,
      super_admin: user.role === 'admin' ? 1 : 0
    };
  } catch (err) {
    logger.error('Failed to create user:', err);
    throw new Error('Failed to create user');
  }
};

/**
 * Update user
 * @param {string} id - User ID
 * @param {Object} data - Update data
 * @returns {Promise<Object>} Updated user
 */
const updateUser = async (id, data) => {
  const updateData = { updated_at: new Date() };

  if (data.username !== undefined) {
    // Check if new username is taken
    const existing = await getUserByUsername(data.username);
    if (existing && String(existing.id) !== String(id)) {
      throw new Error('Username already exists');
    }
    updateData.username = data.username;
  }

  if (data.password !== undefined) {
    const salt = await bcrypt.genSalt(10);
    updateData.password = await bcrypt.hash(data.password, salt);
  }

  if (data.status !== undefined) updateData.status = data.status;

  // Map superAdmin flag to role field
  if (data.superAdmin !== undefined) {
    updateData.role = data.superAdmin === 1 ? 'admin' : 'user';
  }

  try {
    const user = await prisma.sys_user.update({
      where: { id: BigInt(id) },
      data: updateData,
      select: {
        id: true,
        username: true,
        status: true,
        role: true,
        created_at: true,
        updated_at: true
      }
    });

    return {
      ...user,
      super_admin: user.role === 'admin' ? 1 : 0
    };
  } catch (err) {
    logger.error('Failed to update user:', err);
    throw new Error('Failed to update user');
  }
};

/**
 * Delete user
 * @param {string} id - User ID
 */
const deleteUser = async (id) => {
  try {
    // First delete user tokens
    await prisma.sys_user_token.deleteMany({
      where: { user_id: BigInt(id) }
    });

    // Delete user
    await prisma.sys_user.delete({
      where: { id: BigInt(id) }
    });
  } catch (err) {
    logger.error('Failed to delete user:', err);
    throw new Error('Failed to delete user');
  }
};

/**
 * Batch delete users
 * @param {Array<string>} ids - User IDs to delete
 */
const deleteUsers = async (ids) => {
  const bigIntIds = ids.map(id => BigInt(id));

  try {
    // First delete user tokens
    await prisma.sys_user_token.deleteMany({
      where: { user_id: { in: bigIntIds } }
    });

    // Delete users
    await prisma.sys_user.deleteMany({
      where: { id: { in: bigIntIds } }
    });
  } catch (err) {
    logger.error('Failed to delete users:', err);
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
  // Generate random 6-digit password (matches Spring Boot behavior)
  const newPassword = String(Math.floor(100000 + Math.random() * 900000));

  // Hash and update
  const salt = await bcrypt.genSalt(10);
  const hashedPassword = await bcrypt.hash(newPassword, salt);

  try {
    await prisma.sys_user.update({
      where: { id: BigInt(id) },
      data: {
        password: hashedPassword,
        updated_at: new Date()
      }
    });
  } catch (err) {
    logger.error('Failed to reset password:', err);
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
  try {
    const stats = {};

    // User counts — run all in parallel for performance
    const [
      totalUsers,
      activeUsers,
      superAdmins,
      totalDevices,
      totalAgents,
      totalContent,
      totalKids,
      totalRfidCards
    ] = await Promise.all([
      prisma.sys_user.count(),
      prisma.sys_user.count({ where: { status: 1 } }),
      prisma.sys_user.count({ where: { role: 'admin' } }),
      prisma.ai_device.count(),
      prisma.ai_agent.count(),
      prisma.content_library.count(),
      prisma.kid_profile.count(),
      prisma.rfid_card_mapping.count()
    ]);

    stats.totalUsers = totalUsers;
    stats.activeUsers = activeUsers;
    stats.superAdmins = superAdmins;
    stats.totalDevices = totalDevices;
    // ai_device has no `online` field in current schema — report 0
    stats.onlineDevices = 0;
    stats.totalAgents = totalAgents;
    stats.totalContent = totalContent;
    stats.totalKids = totalKids;
    stats.totalRfidCards = totalRfidCards;

    return stats;
  } catch (err) {
    logger.error('Failed to fetch system overview:', err);
    throw new Error('Failed to fetch statistics');
  }
};

/**
 * Get user registration statistics
 * @param {number} days - Number of days to include (default 30)
 * @returns {Promise<Object>} Registration stats by day
 */
const getUserRegistrationStats = async (days = 30) => {
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - days);
  startDate.setHours(0, 0, 0, 0);

  try {
    const users = await prisma.sys_user.findMany({
      where: { created_at: { gte: startDate } },
      select: { created_at: true },
      orderBy: { created_at: 'asc' }
    });

    // Group by date
    const dailyStats = {};
    users.forEach(user => {
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
      total: users.length
    };
  } catch (err) {
    logger.error('Failed to fetch user registration stats:', err);
    throw new Error('Failed to fetch statistics');
  }
};

/**
 * Get device registration statistics
 * @param {number} days - Number of days to include (default 30)
 * @returns {Promise<Object>} Device registration stats by day
 */
const getDeviceRegistrationStats = async (days = 30) => {
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - days);
  startDate.setHours(0, 0, 0, 0);

  try {
    const devices = await prisma.ai_device.findMany({
      where: { create_date: { gte: startDate } },
      select: { create_date: true },
      orderBy: { create_date: 'asc' }
    });

    // Group by date
    const dailyStats = {};
    devices.forEach(device => {
      const date = new Date(device.create_date).toISOString().split('T')[0];
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
      total: devices.length
    };
  } catch (err) {
    logger.error('Failed to fetch device registration stats:', err);
    throw new Error('Failed to fetch statistics');
  }
};

/**
 * Get content statistics by type
 * @returns {Promise<Object>} Content counts by type
 */
const getContentStats = async () => {
  try {
    const content = await prisma.content_library.findMany({
      select: { content_type: true }
    });

    // Group by type
    const byType = {};
    content.forEach(item => {
      const type = item.content_type || 'unknown';
      byType[type] = (byType[type] || 0) + 1;
    });

    return {
      total: content.length,
      byType
    };
  } catch (err) {
    logger.error('Failed to fetch content stats:', err);
    throw new Error('Failed to fetch statistics');
  }
};

/**
 * Get session statistics (analytics)
 * @param {number} days - Number of days to include (default 30)
 * @returns {Promise<Object>} Session stats
 */
const getSessionStats = async (days = 30) => {
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - days);
  startDate.setHours(0, 0, 0, 0);

  try {
    // Use analytics_game_sessions (the actual Prisma model name)
    const sessions = await prisma.analytics_game_sessions.findMany({
      where: { started_at: { gte: startDate } },
      select: { mode_type: true, started_at: true },
      orderBy: { started_at: 'asc' }
    });

    // Group by mode_type (replaces game_type from old schema)
    const byGameType = {};

    sessions.forEach(session => {
      const type = session.mode_type || 'unknown';
      byGameType[type] = (byGameType[type] || 0) + 1;
    });

    // Group by date
    const dailyStats = {};
    sessions.forEach(session => {
      const date = new Date(session.started_at).toISOString().split('T')[0];
      dailyStats[date] = (dailyStats[date] || 0) + 1;
    });

    return {
      period: days,
      totalSessions: sessions.length,
      totalScore: 0, // No total_score field in current schema
      byGameType,
      dailyStats
    };
  } catch (err) {
    logger.error('Failed to fetch session stats:', err);
    throw new Error('Failed to fetch statistics');
  }
};

/**
 * Get token usage statistics
 * @param {number} days - Number of days to include (default 30)
 * @returns {Promise<Object>} Token usage stats
 */
const getTokenUsageStats = async (days = 30) => {
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - days);
  startDate.setHours(0, 0, 0, 0);
  // usage_date is a Date field — compare as Date
  const startDateOnly = new Date(startDate.toISOString().split('T')[0]);

  try {
    const usage = await prisma.device_token_usage.findMany({
      where: { usage_date: { gte: startDateOnly } },
      select: {
        input_tokens: true,
        output_tokens: true,
        total_tokens: true,
        usage_date: true
      },
      orderBy: { usage_date: 'asc' }
    });

    // Aggregate totals
    let totalInputTokens = 0;
    let totalOutputTokens = 0;
    let totalTokens = 0;

    // Group by date
    const dailyStats = {};

    usage.forEach(record => {
      totalInputTokens += record.input_tokens || 0;
      totalOutputTokens += record.output_tokens || 0;
      totalTokens += record.total_tokens || 0;

      // usage_date is a Date object; convert to YYYY-MM-DD string
      const date = new Date(record.usage_date).toISOString().split('T')[0];
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
  } catch (err) {
    logger.error('Failed to fetch token usage stats:', err);
    throw new Error('Failed to fetch statistics');
  }
};

/**
 * Get active sessions (currently online devices with activity)
 * @returns {Promise<Object>} Active session info
 */
const getActiveSessions = async () => {
  // Get devices with recent last_connected_at (within 5 minutes)
  const fiveMinutesAgo = new Date();
  fiveMinutesAgo.setMinutes(fiveMinutesAgo.getMinutes() - 5);

  try {
    // ai_device has no `online` field in current schema; use last_connected_at as proxy
    const devices = await prisma.ai_device.findMany({
      where: {
        last_connected_at: { gte: fiveMinutesAgo }
      },
      select: {
        mac_address: true,
        alias: true,
        agent_id: true,
        update_date: true
      }
    });

    return {
      count: devices.length,
      devices: devices.map(d => ({
        mac_address: d.mac_address,
        device_name: d.alias || null,
        online: 1,
        agent_id: d.agent_id,
        updated_at: d.update_date
      }))
    };
  } catch (err) {
    logger.error('Failed to fetch active sessions:', err);
    throw new Error('Failed to fetch active sessions');
  }
};

/**
 * Get all devices (paginated) with user info
 * Matches Spring Boot UserShowDeviceListVO format
 * @param {Object} options - Pagination and filter options
 * @returns {Promise<Object>} Paginated device list
 */
const getAllDevices = async ({ page = 1, limit = 10, keywords = '' } = {}) => {
  const offset = (page - 1) * limit;

  const where = {};

  // Apply keyword filter if provided
  if (keywords) {
    where.OR = [
      { mac_address: { contains: keywords, mode: 'insensitive' } },
      { alias: { contains: keywords, mode: 'insensitive' } }
    ];
  }

  try {
    const [total, devices] = await Promise.all([
      prisma.ai_device.count({ where }),
      prisma.ai_device.findMany({
        where,
        select: {
          id: true,
          mac_address: true,
          board: true,
          app_version: true,
          agent_id: true,
          auto_update: true,
          last_connected_at: true,
          user_id: true,
          alias: true,
          kid_id: true,
          device_mode: true
        },
        orderBy: { create_date: 'desc' },
        skip: offset,
        take: limit
      })
    ]);

    // Get usernames for each device
    const userIds = [...new Set(devices.filter(d => d.user_id).map(d => d.user_id))];
    let userMap = {};

    if (userIds.length > 0) {
      const users = await prisma.sys_user.findMany({
        where: { id: { in: userIds } },
        select: { id: true, username: true }
      });

      userMap = users.reduce((acc, u) => {
        acc[u.id] = u.username;
        return acc;
      }, {});
    }

    // Transform to Spring Boot UserShowDeviceListVO format
    const list = devices.map(device => ({
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
      bindUserName: device.user_id ? (userMap[device.user_id] || null) : null,
      autoUpdate: device.auto_update, // Also include as autoUpdate for frontend
      otaUpgrade: device.auto_update,
      lastConnectedAt: device.last_connected_at, // Also include for frontend
      recentChatTime: device.last_connected_at
        ? new Date(device.last_connected_at).toISOString().replace('T', ' ').slice(0, 19)
        : null
    }));

    return {
      list,
      total,
      page,
      limit
    };
  } catch (err) {
    logger.error('Failed to fetch devices:', err);
    throw new Error('Failed to fetch devices');
  }
};

/**
 * Get kid profiles by user ID (admin only)
 */
const getKidProfilesByUserId = async (userId) => {
  console.log('[admin.service] Fetching kid profiles for userId:', userId);

  try {
    const profiles = await prisma.kid_profile.findMany({
      where: { user_id: BigInt(userId) }
    });

    console.log('[admin.service] Found kid profiles:', profiles.length);
    return profiles;
  } catch (err) {
    console.error('[admin.service] Error fetching kid profiles:', err);
    throw new Error(`Failed to get kid profiles: ${err.message}`);
  }
};

/**
 * Create kid profile for a user (admin)
 * @param {number} userId - User ID
 * @param {Object} data - Profile data
 * @returns {Promise<Object>} Created profile
 */
const createKidProfileForUser = async (userId, data) => {
  try {
    const profile = await prisma.kid_profile.create({
      data: {
        user_id: BigInt(userId),
        name: data.name,
        nickname: data.nickname || null,
        avatar_url: data.avatarUrl || null,
        birth_date: data.birthDate ? new Date(data.birthDate) : null,
        gender: data.gender || null,
        grade: data.grade || null,
        school: data.school || null,
        interests: data.interests || [],
        language: data.language || 'en',
        timezone: data.timezone || null,
        parent_rule: sanitizeParentRule(data.parent_rule),
        preferences: data.preferences || {}
      }
    });

    return profile;
  } catch (err) {
    logger.error('Failed to create kid profile:', err);
    throw new Error('Failed to create kid profile');
  }
};

/**
 * Update kid profile (admin - no ownership check)
 * @param {number} kidId - Kid ID
 * @param {Object} data - Update data
 * @returns {Promise<Object>} Updated profile
 */
const updateKidProfile = async (kidId, data) => {
  const updateData = { updated_at: new Date() };

  if (data.name !== undefined) updateData.name = data.name;
  if (data.nickname !== undefined) updateData.nickname = data.nickname;
  if (data.avatarUrl !== undefined) updateData.avatar_url = data.avatarUrl;
  if (data.birthDate !== undefined) updateData.birth_date = data.birthDate ? new Date(data.birthDate) : null;
  if (data.gender !== undefined) updateData.gender = data.gender;
  if (data.grade !== undefined) updateData.grade = data.grade;
  if (data.school !== undefined) updateData.school = data.school;
  if (data.interests !== undefined) updateData.interests = data.interests;
  if (data.language !== undefined) updateData.language = data.language;
  if (data.timezone !== undefined) updateData.timezone = data.timezone;
  if (data.parent_rule !== undefined) updateData.parent_rule = sanitizeParentRule(data.parent_rule);
  if (data.preferences !== undefined) updateData.preferences = data.preferences;

  try {
    const profile = await prisma.kid_profile.update({
      where: { id: BigInt(kidId) },
      data: updateData
    });

    return profile;
  } catch (err) {
    logger.error('Failed to update kid profile:', err);
    throw new Error('Failed to update kid profile');
  }
};

/**
 * Delete kid profile (admin - no ownership check)
 * @param {number} kidId - Kid ID
 */
const deleteKidProfile = async (kidId) => {
  try {
    // First unassign from any devices
    await prisma.ai_device.updateMany({
      where: { kid_id: BigInt(kidId) },
      data: { kid_id: null }
    });

    await prisma.kid_profile.delete({
      where: { id: BigInt(kidId) }
    });
  } catch (err) {
    logger.error('Failed to delete kid profile:', err);
    throw new Error('Failed to delete kid profile');
  }
};

/**
 * Assign kid to device (admin - no ownership check)
 * @param {string} deviceId - Device ID (UUID)
 * @param {number|null} kidId - Kid ID or null to unassign
 * @returns {Promise<Object>} Updated device
 */
const assignKidToDeviceAdmin = async (deviceId, kidId) => {
  try {
    const device = await prisma.ai_device.update({
      where: { id: deviceId },
      data: { kid_id: kidId !== null ? BigInt(kidId) : null }
    });

    return device;
  } catch (err) {
    logger.error('Failed to assign kid to device:', err);
    throw new Error('Failed to assign kid to device');
  }
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
