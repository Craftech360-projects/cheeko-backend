/**
 * Authentication Service
 *
 * Handles user registration, login, password management via Prisma ORM.
 */

const { prisma } = require('../config/database');
const bcrypt = require('bcryptjs');
const logger = require('../utils/logger');
const { generateRandomString } = require('../utils/helpers');

/**
 * Register a new user
 * @param {Object} userData - User registration data
 * @returns {Promise<Object>} Created user
 */
const register = async ({ username, password, email, phone }) => {
  // Check if username already exists
  const existingUser = await prisma.sys_user.findFirst({
    where: { username },
    select: { id: true },
  });

  if (existingUser) {
    throw new Error('Username already exists');
  }

  // Hash password
  const salt = await bcrypt.genSalt(10);
  const hashedPassword = await bcrypt.hash(password, salt);

  // Create user in sys_user table
  let user;
  try {
    user = await prisma.sys_user.create({
      data: {
        username,
        password: hashedPassword,
        email: email || null,
        status: 1,
        role: 'user',
      },
    });
  } catch (error) {
    logger.error('Failed to create user:', error);
    throw new Error('Failed to create user');
  }

  // Create parent profile if email provided
  if (email) {
    try {
      await prisma.parent_profile.create({
        data: {
          user_id: user.id,
          email,
          phone_number: phone || null,
        },
      });
    } catch (error) {
      logger.error('Failed to create parent profile:', error);
      // Non-fatal: user was created; profile creation failure is logged but not thrown
    }
  }

  // Return user without password
  const { password: _, ...userWithoutPassword } = user;
  return userWithoutPassword;
};

/**
 * Login user
 * @param {string} username - Username
 * @param {string} password - Password
 * @returns {Promise<Object>} User with token
 */
const login = async (username, password) => {
  // Find user by username
  const user = await prisma.sys_user.findFirst({
    where: { username, status: 1 },
  });

  if (!user) {
    throw new Error('Invalid username or password');
  }

  // Verify password
  const isValidPassword = await bcrypt.compare(password, user.password);
  if (!isValidPassword) {
    throw new Error('Invalid username or password');
  }

  // Generate token
  const token = generateRandomString(32); // 32 chars to match Spring Boot MD5 token format
  const expireDate = new Date();
  const expireSeconds = 3600 * 24 * 7; // 7 days in seconds
  expireDate.setSeconds(expireDate.getSeconds() + expireSeconds);

  // Store token
  try {
    await prisma.sys_user_token.create({
      data: {
        user_id: user.id,
        token,
        expire_date: expireDate,
      },
    });
  } catch (error) {
    logger.error('Failed to store token:', error);
    throw new Error('Failed to create session');
  }

  // Return token info matching Spring Boot TokenDTO format
  // Spring Boot returns: {token, expire (int seconds), clientHash}
  return {
    token,
    expire: expireSeconds
  };
};

/**
 * Logout user (invalidate token)
 * @param {string} token - User token
 */
const logout = async (token) => {
  await prisma.sys_user_token.deleteMany({ where: { token } });
};

/**
 * Change password (requires current password)
 * @param {number} userId - User ID
 * @param {string} oldPassword - Current password
 * @param {string} newPassword - New password
 */
const changePassword = async (userId, oldPassword, newPassword) => {
  // Get current user
  const user = await prisma.sys_user.findFirst({
    where: { id: BigInt(userId) },
    select: { password: true },
  });

  if (!user) {
    throw new Error('User not found');
  }

  // Verify old password
  const isValidPassword = await bcrypt.compare(oldPassword, user.password);
  if (!isValidPassword) {
    throw new Error('Current password is incorrect');
  }

  // Hash new password
  const salt = await bcrypt.genSalt(10);
  const hashedPassword = await bcrypt.hash(newPassword, salt);

  // Update password
  try {
    await prisma.sys_user.updateMany({
      where: { id: BigInt(userId) },
      data: {
        password: hashedPassword,
        updated_at: new Date(),
      },
    });
  } catch (error) {
    logger.error('Failed to update password:', error);
    throw new Error('Failed to update password');
  }
};

/**
 * Update password (without old password, for recovery)
 * @param {string} username - Username
 * @param {string} newPassword - New password
 */
const updatePassword = async (username, newPassword) => {
  // Find user
  const user = await prisma.sys_user.findFirst({
    where: { username },
    select: { id: true },
  });

  if (!user) {
    throw new Error('User not found');
  }

  // Hash new password
  const salt = await bcrypt.genSalt(10);
  const hashedPassword = await bcrypt.hash(newPassword, salt);

  // Update password
  try {
    await prisma.sys_user.updateMany({
      where: { id: user.id },
      data: {
        password: hashedPassword,
        updated_at: new Date(),
      },
    });
  } catch (error) {
    logger.error('Failed to update password:', error);
    throw new Error('Failed to update password');
  }
};

/**
 * Delete user account
 * @param {string} username - Username
 * @param {string} password - Password for verification
 */
const deleteAccount = async (username, password) => {
  // Find user
  const user = await prisma.sys_user.findFirst({
    where: { username },
  });

  if (!user) {
    throw new Error('User not found');
  }

  // Verify password
  const isValidPassword = await bcrypt.compare(password, user.password);
  if (!isValidPassword) {
    throw new Error('Invalid password');
  }

  // Delete user tokens
  await prisma.sys_user_token.deleteMany({ where: { user_id: user.id } });

  // Delete user (cascades to profiles)
  try {
    await prisma.sys_user.deleteMany({ where: { id: user.id } });
  } catch (error) {
    logger.error('Failed to delete account:', error);
    throw new Error('Failed to delete account');
  }
};

/**
 * Get user by token
 * @param {string} token - User token
 * @returns {Promise<Object|null>} User or null
 */
const getUserByToken = async (token) => {
  // Find valid token
  const tokenData = await prisma.sys_user_token.findFirst({
    where: { token },
    select: { user_id: true, expire_date: true },
  });

  if (!tokenData) {
    return null;
  }

  // Check expiration
  if (new Date(tokenData.expire_date) < new Date()) {
    // Token expired, delete it
    await prisma.sys_user_token.deleteMany({ where: { token } });
    return null;
  }

  // Get user
  const user = await prisma.sys_user.findFirst({
    where: { id: tokenData.user_id, status: 1 },
    select: { id: true, username: true, role: true, status: true, created_at: true },
  });

  return user || null;
};

// In-memory captcha storage (in production, use Redis)
const captchaStore = new Map();

// Clean up expired captchas every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [uuid, data] of captchaStore.entries()) {
    if (now > data.expireAt) {
      captchaStore.delete(uuid);
    }
  }
}, 5 * 60 * 1000);

/**
 * Generate CAPTCHA image
 * @param {string} uuid - Unique identifier for this captcha
 * @returns {Object} CAPTCHA data with SVG image
 */
const generateCaptcha = (uuid) => {
  const svgCaptcha = require('svg-captcha');

  const captcha = svgCaptcha.create({
    size: 5, // 5 characters
    noise: 2, // noise lines
    color: true,
    background: '#f0f0f0',
    width: 150,
    height: 40,
    fontSize: 40
  });

  // Store captcha code with 5-minute expiry
  captchaStore.set(uuid, {
    code: captcha.text,
    expireAt: Date.now() + 5 * 60 * 1000
  });

  return {
    uuid,
    svg: captcha.data // SVG string
  };
};

/**
 * Validate CAPTCHA
 * @param {string} uuid - Captcha UUID
 * @param {string} code - User input code
 * @returns {boolean} Whether captcha is valid
 */
const validateCaptcha = (uuid, code) => {
  if (!uuid || !code) return false;

  // Allow bypass for mobile app testing
  if (code === 'MOBILE_APP_BYPASS') {
    return true;
  }

  const stored = captchaStore.get(uuid);
  if (!stored) return false;

  // Delete after validation attempt
  captchaStore.delete(uuid);

  // Check expiry
  if (Date.now() > stored.expireAt) return false;

  // Case-insensitive comparison
  return stored.code.toLowerCase() === code.toLowerCase();
};

/**
 * Get public configuration
 * Matches Spring Boot format for frontend compatibility
 * @returns {Object} Public config
 */
const getPublicConfig = async () => {
  // Default config matching Spring Boot format
  const config = {
    enableMobileRegister: false,
    version: '1.0.0',
    year: `©${new Date().getFullYear()}`,
    allowUserRegister: true,
    mobileAreaList: [],
    beianIcpNum: '',
    beianGaNum: '',
    name: 'cheeko-manager-api'
  };

  // Try to get config from database
  try {
    // Get system params
    const params = await prisma.sys_params.findMany({
      where: {
        param_code: {
          in: [
            'SERVER_NAME',
            'SERVER_VERSION',
            'SERVER_ENABLE_MOBILE_REGISTER',
            'ALLOW_USER_REGISTER',
            'BEIAN_ICP_NUM',
            'BEIAN_GA_NUM'
          ],
        },
      },
      select: { param_code: true, param_value: true },
    });

    if (params && params.length > 0) {
      params.forEach(p => {
        switch (p.param_code) {
        case 'SERVER_NAME':
          config.name = p.param_value || config.name;
          break;
        case 'SERVER_VERSION':
          config.version = p.param_value || config.version;
          break;
        case 'SERVER_ENABLE_MOBILE_REGISTER':
          config.enableMobileRegister = p.param_value === 'true';
          break;
        case 'ALLOW_USER_REGISTER':
          config.allowUserRegister = p.param_value !== 'false';
          break;
        case 'BEIAN_ICP_NUM':
          config.beianIcpNum = p.param_value || '';
          break;
        case 'BEIAN_GA_NUM':
          config.beianGaNum = p.param_value || '';
          break;
        }
      });
    }

    // Get mobile area list from dictionary
    const dictData = await prisma.sys_dict_data.findMany({
      where: { dict_type_id: 'MOBILE_AREA' },
      select: { dict_label: true, dict_value: true, sort: true },
      orderBy: { sort: 'asc' },
    });

    if (dictData && dictData.length > 0) {
      config.mobileAreaList = dictData.map(d => ({
        name: d.dict_label,
        key: d.dict_value
      }));
    } else {
      // Default mobile area list if not configured in DB
      config.mobileAreaList = [
        { name: 'China', key: '+86' },
        { name: 'Hong Kong', key: '+852' },
        { name: 'Macau', key: '+853' },
        { name: 'Taiwan', key: '+886' },
        { name: 'USA/Canada', key: '+1' },
        { name: 'United Kingdom', key: '+44' },
        { name: 'France', key: '+33' },
        { name: 'Italy', key: '+39' },
        { name: 'Germany', key: '+49' },
        { name: 'Poland', key: '+48' },
        { name: 'Switzerland', key: '+41' },
        { name: 'Spain', key: '+34' },
        { name: 'Denmark', key: '+45' },
        { name: 'Malaysia', key: '+60' },
        { name: 'Australia', key: '+61' },
        { name: 'Indonesia', key: '+62' },
        { name: 'Philippines', key: '+63' },
        { name: 'New Zealand', key: '+64' },
        { name: 'Singapore', key: '+65' },
        { name: 'Thailand', key: '+66' },
        { name: 'Japan', key: '+81' },
        { name: 'South Korea', key: '+82' },
        { name: 'Vietnam', key: '+84' },
        { name: 'India', key: '+91' },
        { name: 'Pakistan', key: '+92' },
        { name: 'Nigeria', key: '+234' },
        { name: 'Bangladesh', key: '+880' },
        { name: 'Saudi Arabia', key: '+966' },
        { name: 'UAE', key: '+971' },
        { name: 'Brazil', key: '+55' },
        { name: 'Mexico', key: '+52' },
        { name: 'Chile', key: '+56' },
        { name: 'Argentina', key: '+54' },
        { name: 'Egypt', key: '+20' },
        { name: 'South Africa', key: '+27' },
        { name: 'Kenya', key: '+254' },
        { name: 'Tanzania', key: '+255' },
        { name: 'Russia', key: '+7' }
      ];
    }
  } catch (error) {
    logger.error('Failed to fetch public config from database:', error);
    // Return defaults if DB queries fail
  }

  return config;
};

module.exports = {
  register,
  login,
  logout,
  changePassword,
  updatePassword,
  deleteAccount,
  getUserByToken,
  generateCaptcha,
  validateCaptcha,
  getPublicConfig
};
