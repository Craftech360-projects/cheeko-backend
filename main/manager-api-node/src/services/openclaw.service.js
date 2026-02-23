/**
 * OpenClaw Service
 *
 * Handles OpenClaw pairing, configuration, and connection testing.
 */

const { supabaseAdmin } = require('../config/database');
const { getPool, tableExists } = require('../config/migrations');
const logger = require('../utils/logger');

let parentProfileTableVerified = false;

/**
 * Ensure the parent_profile table exists, creating it if needed
 */
const ensureParentProfileTable = async () => {
  if (parentProfileTableVerified) return;

  const pool = getPool();
  if (!pool) {
    logger.warn('No direct DB connection — cannot auto-create parent_profile table');
    return;
  }

  try {
    const exists = await tableExists(pool, 'parent_profile');
    if (!exists) {
      logger.info('parent_profile table not found — creating it now');
      await pool.query(`
        CREATE TABLE IF NOT EXISTS "parent_profile" (
          "id" BIGSERIAL PRIMARY KEY,
          "user_id" BIGINT UNIQUE,
          "email" VARCHAR(255),
          "phone_number" VARCHAR(50),
          "display_name" VARCHAR(255),
          "avatar_url" VARCHAR(500),
          "timezone" VARCHAR(100),
          "language" VARCHAR(10) DEFAULT 'en',
          "email_notifications" BOOLEAN DEFAULT true,
          "push_notifications" BOOLEAN DEFAULT true,
          "weekly_report" BOOLEAN DEFAULT true,
          "onboarding_completed" BOOLEAN DEFAULT false,
          "terms_accepted_at" TIMESTAMPTZ(6),
          "terms_version" VARCHAR(20),
          "openclaw_url" TEXT,
          "openclaw_token" TEXT,
          "created_at" TIMESTAMPTZ(6) DEFAULT now(),
          "updated_at" TIMESTAMPTZ(6) DEFAULT now(),
          CONSTRAINT "parent_profile_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "sys_user"("id") ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS "parent_profile_user_id_idx" ON "parent_profile"("user_id");
      `);
      logger.info('parent_profile table created successfully');
    } else {
      // Table exists — make sure openclaw columns are present
      await pool.query(`
        ALTER TABLE "parent_profile" ADD COLUMN IF NOT EXISTS "openclaw_url" TEXT;
        ALTER TABLE "parent_profile" ADD COLUMN IF NOT EXISTS "openclaw_token" TEXT;
      `);
    }

    // Ensure ai_device has openclaw columns too
    await pool.query(`
      ALTER TABLE "ai_device" ADD COLUMN IF NOT EXISTS "openclaw_url" TEXT;
      ALTER TABLE "ai_device" ADD COLUMN IF NOT EXISTS "openclaw_token" TEXT;
    `);

    // Ensure openclaw_pair_tokens table exists
    await pool.query(`
      CREATE TABLE IF NOT EXISTS "openclaw_pair_tokens" (
        "id" BIGSERIAL PRIMARY KEY,
        "user_id" BIGINT NOT NULL,
        "token" VARCHAR(20) NOT NULL UNIQUE,
        "openclaw_url" TEXT,
        "paired" BOOLEAN NOT NULL DEFAULT false,
        "expires_at" TIMESTAMPTZ(6) NOT NULL,
        "created_at" TIMESTAMPTZ(6) DEFAULT now(),
        "updated_at" TIMESTAMPTZ(6) DEFAULT now(),
        CONSTRAINT "fk_pair_token_user" FOREIGN KEY ("user_id") REFERENCES "sys_user"("id") ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS "idx_pair_token" ON "openclaw_pair_tokens"("token");
      CREATE INDEX IF NOT EXISTS "idx_pair_token_user" ON "openclaw_pair_tokens"("user_id");
    `);

    parentProfileTableVerified = true;
  } catch (err) {
    logger.error('Failed to ensure parent_profile table:', err.message);
  } finally {
    try { await pool.end(); } catch (e) { /* ignore */ }
  }
};

/**
 * Generate a short pairing token (e.g. "XK9-2M4")
 * @returns {string} Token string
 */
const generatePairToken = () => {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no I, O, 0, 1 to avoid confusion
  let token = '';
  for (let i = 0; i < 3; i++) token += chars[Math.floor(Math.random() * chars.length)];
  token += '-';
  for (let i = 0; i < 3; i++) token += chars[Math.floor(Math.random() * chars.length)];
  return token;
};

/**
 * Get user's OpenClaw config from parent_profile
 */
const getOpenClawConfig = async (userId) => {
  if (!supabaseAdmin) throw new Error('Database not configured');
  await ensureParentProfileTable();

  const { data, error } = await supabaseAdmin
    .from('parent_profile')
    .select('openclaw_url, openclaw_token')
    .eq('user_id', userId)
    .single();

  if (error || !data) {
    return { openclaw_url: null, openclaw_token: null };
  }

  return data;
};

/**
 * Set user's OpenClaw config on parent_profile and propagate to all devices
 */
const setOpenClawConfig = async (userId, { openclaw_url, openclaw_token }) => {
  if (!supabaseAdmin) throw new Error('Database not configured');
  await ensureParentProfileTable();

  // Validate URL format
  if (openclaw_url && !openclaw_url.startsWith('ws://') && !openclaw_url.startsWith('wss://')) {
    throw new Error('openclaw_url must start with ws:// or wss://');
  }

  // Update parent_profile
  const { data: existing } = await supabaseAdmin
    .from('parent_profile')
    .select('id')
    .eq('user_id', userId)
    .single();

  if (existing) {
    const { error: updateError } = await supabaseAdmin
      .from('parent_profile')
      .update({
        openclaw_url: openclaw_url || null,
        openclaw_token: openclaw_token || null,
        updated_at: new Date().toISOString()
      })
      .eq('user_id', userId);

    if (updateError) {
      logger.error('Failed to update parent_profile openclaw config:', updateError);
      throw new Error('Failed to save OpenClaw config');
    }
  } else {
    // Create parent_profile if it doesn't exist
    const { error: insertError } = await supabaseAdmin
      .from('parent_profile')
      .insert({
        user_id: userId,
        openclaw_url: openclaw_url || null,
        openclaw_token: openclaw_token || null
      });

    if (insertError) {
      logger.error('Failed to insert parent_profile openclaw config:', insertError);
      throw new Error('Failed to save OpenClaw config');
    }
  }

  // Propagate to all existing devices for this user
  const { error: deviceError } = await supabaseAdmin
    .from('ai_device')
    .update({
      openclaw_url: openclaw_url || null,
      openclaw_token: openclaw_token || null,
      update_date: new Date().toISOString()
    })
    .eq('user_id', userId);

  if (deviceError) {
    logger.warn('Failed to propagate openclaw config to devices:', deviceError);
    // Don't throw - profile was saved, device propagation is secondary
  }

  return { openclaw_url, openclaw_token };
};

/**
 * Generate a pairing token for a user
 */
const generatePairingToken = async (userId) => {
  if (!supabaseAdmin) throw new Error('Database not configured');
  await ensureParentProfileTable();

  // Clean up any existing unexpired tokens for this user
  await supabaseAdmin
    .from('openclaw_pair_tokens')
    .delete()
    .eq('user_id', userId)
    .eq('paired', false);

  const token = generatePairToken();
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

  const { error } = await supabaseAdmin
    .from('openclaw_pair_tokens')
    .insert({
      user_id: userId,
      token,
      paired: false,
      expires_at: expiresAt.toISOString()
    });

  if (error) {
    logger.error('Failed to create pairing token:', error);
    throw new Error('Failed to generate pairing token');
  }

  logger.info(`Generated pairing token ${token} for user ${userId}`);

  return {
    token,
    expiresIn: 600 // seconds
  };
};

/**
 * Complete pairing - called by the OpenClaw plugin
 */
const completePairing = async ({ token, url, localIp }) => {
  if (!supabaseAdmin) throw new Error('Database not configured');
  await ensureParentProfileTable();

  // Look up the token
  const { data: pairRecord, error } = await supabaseAdmin
    .from('openclaw_pair_tokens')
    .select('*')
    .eq('token', token)
    .single();

  if (error || !pairRecord) {
    throw new Error('Invalid pairing token');
  }

  // Check if expired
  if (new Date(pairRecord.expires_at) < new Date()) {
    throw new Error('Pairing token has expired');
  }

  // Check if already used
  if (pairRecord.paired) {
    throw new Error('Pairing token has already been used');
  }

  // Validate URL format
  if (!url || (!url.startsWith('ws://') && !url.startsWith('wss://'))) {
    throw new Error('Invalid OpenClaw URL format');
  }

  // Mark token as paired
  await supabaseAdmin
    .from('openclaw_pair_tokens')
    .update({
      paired: true,
      openclaw_url: url,
      updated_at: new Date().toISOString()
    })
    .eq('id', pairRecord.id);

  // Save openclaw_url to user's parent_profile
  await setOpenClawConfig(pairRecord.user_id, {
    openclaw_url: url,
    openclaw_token: null
  });

  logger.info(`Pairing completed for user ${pairRecord.user_id}: ${url}`);

  return { ok: true };
};

/**
 * Check pairing status - polled by frontend
 */
const getPairingStatus = async (token) => {
  if (!supabaseAdmin) throw new Error('Database not configured');
  await ensureParentProfileTable();

  const { data: pairRecord, error } = await supabaseAdmin
    .from('openclaw_pair_tokens')
    .select('paired, openclaw_url, expires_at')
    .eq('token', token)
    .single();

  if (error || !pairRecord) {
    return { paired: false, expired: true };
  }

  // Check if expired
  if (new Date(pairRecord.expires_at) < new Date()) {
    return { paired: false, expired: true };
  }

  if (pairRecord.paired) {
    return { paired: true, url: pairRecord.openclaw_url };
  }

  return { paired: false, expired: false };
};

/**
 * Test OpenClaw connection by attempting a WebSocket ping
 */
const testConnection = async (url) => {
  if (!url || (!url.startsWith('ws://') && !url.startsWith('wss://'))) {
    throw new Error('Invalid URL format');
  }

  const WebSocket = require('ws');
  const startTime = Date.now();

  return new Promise((resolve) => {
    const ws = new WebSocket(url, { handshakeTimeout: 5000 });
    const timeout = setTimeout(() => {
      ws.terminate();
      resolve({ ok: false, error: 'Connection timed out' });
    }, 5000);

    ws.on('open', () => {
      clearTimeout(timeout);
      const latencyMs = Date.now() - startTime;
      ws.close();
      resolve({ ok: true, latencyMs });
    });

    ws.on('error', (err) => {
      clearTimeout(timeout);
      resolve({ ok: false, error: err.message || 'Connection failed' });
    });
  });
};

module.exports = {
  getOpenClawConfig,
  setOpenClawConfig,
  generatePairingToken,
  completePairing,
  getPairingStatus,
  testConnection
};
