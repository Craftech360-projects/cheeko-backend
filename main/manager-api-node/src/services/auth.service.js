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

  // Create parent profile if email provided
  if (email) {
    await supabaseAdmin
      .from('parent_profile')
      .insert({
        user_id: user.id,
        email,
        phone_number: phone
      });
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
  const token = generateRandomString(64);
  const expireDate = new Date();
  expireDate.setDate(expireDate.getDate() + 7); // 7 days expiry

  // Store token
  await supabaseAdmin
    .from('sys_user_token')
    .insert({
      user_id: user.id,
      token,
      expire_date: expireDate.toISOString()
    });

  // Return user without password
  const { password: _, ...userWithoutPassword } = user;
  return {
    ...userWithoutPassword,
    token,
    expire: expireDate.toISOString()
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

/**
 * Generate CAPTCHA (placeholder - returns random string)
 * @returns {Object} CAPTCHA data
 */
const generateCaptcha = () => {
  const code = Math.random().toString(36).substring(2, 8).toUpperCase();
  const uuid = generateRandomString(16);

  // In production, you would generate an actual image
  // For now, return the code directly (for testing)
  return {
    uuid,
    code, // In production, don't return this
    image: `data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" width="120" height="40"><text x="10" y="30" font-size="24">${code}</text></svg>`
  };
};

/**
 * Get public configuration
 * @returns {Object} Public config
 */
const getPublicConfig = async () => {
  const config = {
    appName: 'Cheeko',
    version: '1.0.0',
    features: {
      registration: true,
      smsVerification: false, // Deferred
      socialLogin: false
    }
  };

  // Try to get config from database
  if (supabaseAdmin) {
    const { data: params } = await supabaseAdmin
      .from('sys_params')
      .select('param_code, param_value')
      .in('param_code', ['APP_NAME', 'APP_VERSION', 'FEATURE_SMS']);

    if (params) {
      params.forEach(p => {
        if (p.param_code === 'APP_NAME') config.appName = p.param_value;
        if (p.param_code === 'APP_VERSION') config.version = p.param_value;
        if (p.param_code === 'FEATURE_SMS') config.features.smsVerification = p.param_value === 'true';
      });
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
  getPublicConfig
};
