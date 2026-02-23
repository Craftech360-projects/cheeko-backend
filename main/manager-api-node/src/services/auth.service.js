/**
 * Authentication Service
 *
 * Handles user registration, login, password management via Supabase Auth.
 */

const { supabaseAdmin } = require('../config/database');
const bcrypt = require('bcryptjs');
const logger = require('../utils/logger');
const { generateRandomString } = require('../utils/helpers');

/**
 * Register a new user
 * @param {Object} userData - User registration data
 * @returns {Promise<Object>} Created user
 */
const register = async ({ username, password, email, phone }) => {
  if (!supabaseAdmin) {
    throw new Error('Database not configured');
  }

  // Check if username already exists
  const { data: existingUser } = await supabaseAdmin
    .from('sys_user')
    .select('id')
    .eq('username', username)
    .single();

  if (existingUser) {
    throw new Error('Username already exists');
  }

  // Hash password
  const salt = await bcrypt.genSalt(10);
  const hashedPassword = await bcrypt.hash(password, salt);

  // Create user in sys_user table
  const { data: user, error } = await supabaseAdmin
    .from('sys_user')
    .insert({
      username,
      password: hashedPassword,
      email: email || null,
      phone: phone || null,
      status: 1,
      role: 'user'
    })
    .select()
    .single();

  if (error) {
    logger.error('Failed to create user:', error);
    throw new Error('Failed to create user');
  }

  // Always create parent profile for new users
  await supabaseAdmin
    .from('parent_profile')
    .insert({
      user_id: user.id,
      email: email || null,
      phone_number: phone || null
    });

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
  if (!supabaseAdmin) {
    throw new Error('Database not configured');
  }

  // Find user by username
  const { data: user, error } = await supabaseAdmin
    .from('sys_user')
    .select('*')
    .eq('username', username)
    .eq('status', 1)
    .single();

  if (error || !user) {
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
  const { error: tokenError } = await supabaseAdmin
    .from('sys_user_token')
    .insert({
      user_id: user.id,
      token,
      expire_date: expireDate.toISOString()
    });

  if (tokenError) {
    logger.error('Failed to store token:', tokenError);
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
  if (!supabaseAdmin) {
    throw new Error('Database not configured');
  }

  await supabaseAdmin
    .from('sys_user_token')
    .delete()
    .eq('token', token);
};

/**
 * Change password (requires current password)
 * @param {number} userId - User ID
 * @param {string} oldPassword - Current password
 * @param {string} newPassword - New password
 */
const changePassword = async (userId, oldPassword, newPassword) => {
  if (!supabaseAdmin) {
    throw new Error('Database not configured');
  }

  // Get current user
  const { data: user } = await supabaseAdmin
    .from('sys_user')
    .select('password')
    .eq('id', userId)
    .single();

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
  const { error } = await supabaseAdmin
    .from('sys_user')
    .update({
      password: hashedPassword,
      updated_at: new Date().toISOString()
    })
    .eq('id', userId);

  if (error) {
    throw new Error('Failed to update password');
  }
};

/**
 * Update password (without old password, for recovery)
 * @param {string} username - Username
 * @param {string} newPassword - New password
 */
const updatePassword = async (username, newPassword) => {
  if (!supabaseAdmin) {
    throw new Error('Database not configured');
  }

  // Find user
  const { data: user } = await supabaseAdmin
    .from('sys_user')
    .select('id')
    .eq('username', username)
    .single();

  if (!user) {
    throw new Error('User not found');
  }

  // Hash new password
  const salt = await bcrypt.genSalt(10);
  const hashedPassword = await bcrypt.hash(newPassword, salt);

  // Update password
  const { error } = await supabaseAdmin
    .from('sys_user')
    .update({
      password: hashedPassword,
      updated_at: new Date().toISOString()
    })
    .eq('id', user.id);

  if (error) {
    throw new Error('Failed to update password');
  }
};

/**
 * Delete user account
 * @param {string} username - Username
 * @param {string} password - Password for verification
 */
const deleteAccount = async (username, password) => {
  if (!supabaseAdmin) {
    throw new Error('Database not configured');
  }

  // Find user
  const { data: user } = await supabaseAdmin
    .from('sys_user')
    .select('*')
    .eq('username', username)
    .single();

  if (!user) {
    throw new Error('User not found');
  }

  // Verify password
  const isValidPassword = await bcrypt.compare(password, user.password);
  if (!isValidPassword) {
    throw new Error('Invalid password');
  }

  // Delete user tokens
  await supabaseAdmin
    .from('sys_user_token')
    .delete()
    .eq('user_id', user.id);

  // Delete user (cascades to profiles)
  const { error } = await supabaseAdmin
    .from('sys_user')
    .delete()
    .eq('id', user.id);

  if (error) {
    throw new Error('Failed to delete account');
  }
};

/**
 * Get user by token
 * @param {string} token - User token
 * @returns {Promise<Object|null>} User or null
 */
const getUserByToken = async (token) => {
  if (!supabaseAdmin) {
    return null;
  }

  // Find valid token
  const { data: tokenData } = await supabaseAdmin
    .from('sys_user_token')
    .select('user_id, expire_date')
    .eq('token', token)
    .single();

  if (!tokenData) {
    return null;
  }

  // Check expiration
  if (new Date(tokenData.expire_date) < new Date()) {
    // Token expired, delete it
    await supabaseAdmin
      .from('sys_user_token')
      .delete()
      .eq('token', token);
    return null;
  }

  // Get user
  const { data: user } = await supabaseAdmin
    .from('sys_user')
    .select('id, username, role, status, created_at')
    .eq('id', tokenData.user_id)
    .eq('status', 1)
    .single();

  return user;
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
  if (supabaseAdmin) {
    // Get system params
    const { data: params } = await supabaseAdmin
      .from('sys_params')
      .select('param_code, param_value')
      .in('param_code', [
        'SERVER_NAME',
        'SERVER_VERSION',
        'SERVER_ENABLE_MOBILE_REGISTER',
        'ALLOW_USER_REGISTER',
        'BEIAN_ICP_NUM',
        'BEIAN_GA_NUM'
      ]);

    if (params) {
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
    const { data: dictData } = await supabaseAdmin
      .from('sys_dict_data')
      .select('dict_label, dict_value, sort')
      .eq('dict_type_id', 'MOBILE_AREA')
      .order('sort', { ascending: true });

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
