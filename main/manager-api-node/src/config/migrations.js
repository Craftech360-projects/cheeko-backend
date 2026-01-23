/**
 * Database Migrations
 *
 * Auto-runs migrations on server startup.
 * Checks if tables exist and creates them if not.
 */

const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');
const logger = require('../utils/logger');

// Get database connection pool
const getPool = () => {
  // Option 1: Direct DATABASE_URL (recommended)
  if (process.env.DATABASE_URL) {
    logger.info('Using DATABASE_URL for PostgreSQL connection');
    return new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.DATABASE_SSL === 'false' ? false : { rejectUnauthorized: false }
    });
  }

  // Option 2: Supabase connection string components
  const supabaseUrl = process.env.SUPABASE_URL;
  const dbPassword = process.env.SUPABASE_DB_PASSWORD;

  if (supabaseUrl && dbPassword) {
    // Extract project ref from Supabase URL
    const match = supabaseUrl.match(/https:\/\/([^.]+)\.supabase\.co/);
    if (match) {
      const projectRef = match[1];
      // Try different Supabase regions
      const regions = ['aws-0-ap-south-1', 'aws-0-us-east-1', 'aws-0-eu-west-1', 'aws-0-ap-southeast-1'];
      const region = process.env.SUPABASE_REGION || regions[0];

      const connectionString = `postgresql://postgres.${projectRef}:${encodeURIComponent(dbPassword)}@${region}.pooler.supabase.com:6543/postgres`;
      logger.info(`Using Supabase pooler connection (${region})`);

      return new Pool({
        connectionString,
        ssl: { rejectUnauthorized: false }
      });
    }
  }

  // Option 3: Individual connection parameters
  if (process.env.DB_HOST && process.env.DB_PASSWORD) {
    logger.info('Using individual DB parameters');
    return new Pool({
      host: process.env.DB_HOST,
      port: parseInt(process.env.DB_PORT || '5432'),
      database: process.env.DB_NAME || 'postgres',
      user: process.env.DB_USER || 'postgres',
      password: process.env.DB_PASSWORD,
      ssl: process.env.DATABASE_SSL === 'false' ? false : { rejectUnauthorized: false }
    });
  }

  return null;
};

/**
 * Check database status via Supabase JS client (when direct connection unavailable)
 */
const checkViaSupabase = async () => {
  const { supabaseAdmin } = require('./database');

  if (!supabaseAdmin) {
    logger.warn('═══════════════════════════════════════════════════════════');
    logger.warn('Supabase not configured. Database features will not work.');
    logger.warn('Add SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY to .env');
    logger.warn('═══════════════════════════════════════════════════════════');
    return false;
  }

  try {
    // Try to query sys_user table
    const { data, error } = await supabaseAdmin.from('sys_user').select('id').limit(1);

    if (error) {
      // Check if table doesn't exist
      if (error.code === 'PGRST205' || error.code === '42P01' ||
          error.message.includes('does not exist') ||
          error.message.includes('schema cache')) {

        logger.warn('═══════════════════════════════════════════════════════════');
        logger.warn('Database tables do not exist yet!');
        logger.warn('');
        logger.warn('To set up the database:');
        logger.warn('  1. Run: node scripts/setup-database.js');
        logger.warn('  2. Copy database-setup.sql content');
        logger.warn('  3. Paste in Supabase Dashboard > SQL Editor');
        logger.warn('  4. Click "Run" to create tables');
        logger.warn('');
        logger.warn('Or open directly:');

        const match = process.env.SUPABASE_URL?.match(/([^.]+)\.supabase\.co/);
        if (match) {
          logger.warn(`  https://supabase.com/dashboard/project/${match[1]}/sql`);
        }
        logger.warn('═══════════════════════════════════════════════════════════');
        return false;
      }
      throw error;
    }

    logger.info('Database tables verified via Supabase');
    return true;

  } catch (error) {
    logger.error('Supabase check failed:', error.message);
    return false;
  }
};

/**
 * Check if a table exists
 */
const tableExists = async (pool, tableName) => {
  try {
    const result = await pool.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables
        WHERE table_schema = 'public'
        AND table_name = $1
      );
    `, [tableName]);
    return result.rows[0].exists;
  } catch (error) {
    logger.error(`Error checking table ${tableName}:`, error.message);
    return false;
  }
};

/**
 * Run a single migration file
 */
const runMigrationFile = async (pool, filePath) => {
  const sql = fs.readFileSync(filePath, 'utf8');
  const fileName = path.basename(filePath);

  try {
    await pool.query(sql);
    logger.info(`✓ Migration: ${fileName}`);
    return true;
  } catch (error) {
    // Ignore "already exists" errors
    if (error.code === '42P07' || error.code === '42710') {
      logger.info(`○ Migration: ${fileName} (already applied)`);
      return true;
    }
    logger.error(`✗ Migration: ${fileName} - ${error.message}`);
    return false;
  }
};

/**
 * Run all migrations
 */
const runMigrations = async () => {
  const pool = getPool();

  // If no direct connection, check via Supabase JS client
  if (!pool) {
    return await checkViaSupabase();
  }

  try {
    // Test connection
    await pool.query('SELECT 1');
    logger.info('Database connected. Checking migrations...');

    // Check if main table exists
    const hasMainTable = await tableExists(pool, 'sys_user');

    if (hasMainTable) {
      logger.info('Database tables already exist. Skipping migrations.');
      await pool.end();
      return true;
    }

    logger.info('Running database migrations...');

    // Get migration files
    const migrationsDir = path.join(__dirname, '../../supabase/migrations');

    if (!fs.existsSync(migrationsDir)) {
      logger.warn('Migrations directory not found. Creating inline...');
      await runInlineMigrations(pool);
    } else {
      const files = fs.readdirSync(migrationsDir)
        .filter(f => f.endsWith('.sql'))
        .sort();

      for (const file of files) {
        await runMigrationFile(pool, path.join(migrationsDir, file));
      }
    }

    // Run seed data
    await runSeedData(pool);

    logger.info('Migrations completed successfully!');
    await pool.end();
    return true;

  } catch (error) {
    // Provide helpful error messages
    if (error.code === 'ENOTFOUND') {
      logger.error('Database host not found. Check your connection settings.');
    } else if (error.code === 'ECONNREFUSED') {
      logger.error('Connection refused. Is the database running?');
    } else if (error.code === '28P01' || error.message.includes('password')) {
      logger.error('Authentication failed. Check your database password.');
    } else if (error.code === '3D000') {
      logger.error('Database does not exist. Check your database name.');
    } else {
      logger.error('Migration failed:', error.message);
    }

    try {
      await pool.end();
    } catch (e) {
      // Ignore
    }
    return false;
  }
};

/**
 * Run inline migrations (if migration files don't exist)
 */
const runInlineMigrations = async (pool) => {
  // Core tables SQL
  const coreTables = `
    -- System Users Table
    CREATE TABLE IF NOT EXISTS sys_user (
      id BIGSERIAL PRIMARY KEY,
      username VARCHAR(100) UNIQUE,
      password VARCHAR(255),
      email VARCHAR(255) UNIQUE,
      phone VARCHAR(50),
      nickname VARCHAR(100),
      avatar VARCHAR(500),
      gender INTEGER DEFAULT 0,
      status INTEGER DEFAULT 1,
      role VARCHAR(50) DEFAULT 'user',
      last_login_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );

    -- AI Models Table
    CREATE TABLE IF NOT EXISTS ai_model (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      model_type VARCHAR(50) NOT NULL,
      model_name VARCHAR(200) NOT NULL,
      model_code VARCHAR(100),
      provider VARCHAR(100),
      api_key TEXT,
      api_url VARCHAR(500),
      config JSONB DEFAULT '{}',
      description TEXT,
      sort INTEGER DEFAULT 0,
      status INTEGER DEFAULT 1,
      creator BIGINT,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );

    -- TTS Voices Table
    CREATE TABLE IF NOT EXISTS ai_tts_voice (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      tts_model_id UUID REFERENCES ai_model(id),
      voice_name VARCHAR(200) NOT NULL,
      voice_code VARCHAR(100) NOT NULL,
      gender VARCHAR(20),
      language VARCHAR(50),
      accent VARCHAR(100),
      age_group VARCHAR(50),
      style VARCHAR(100),
      preview_url VARCHAR(500),
      config JSONB DEFAULT '{}',
      sort INTEGER DEFAULT 0,
      status INTEGER DEFAULT 1,
      creator BIGINT,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );

    -- AI Agents Table
    CREATE TABLE IF NOT EXISTS ai_agent (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id BIGINT REFERENCES sys_user(id),
      agent_code VARCHAR(100),
      agent_name VARCHAR(200) NOT NULL,
      asr_model_id UUID,
      vad_model_id UUID,
      llm_model_id UUID,
      vllm_model_id UUID,
      tts_model_id UUID,
      tts_voice_id UUID,
      mem_model_id UUID,
      intent_model_id UUID,
      chat_history_conf INTEGER DEFAULT 0,
      system_prompt TEXT,
      summary_memory TEXT,
      lang_code VARCHAR(10) DEFAULT 'en',
      language VARCHAR(50) DEFAULT 'English',
      sort INTEGER DEFAULT 0,
      status INTEGER DEFAULT 1,
      creator BIGINT,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );

    -- Kid Profiles Table
    CREATE TABLE IF NOT EXISTS kid_profile (
      id BIGSERIAL PRIMARY KEY,
      user_id BIGINT REFERENCES sys_user(id),
      name VARCHAR(100) NOT NULL,
      nickname VARCHAR(100),
      avatar_url VARCHAR(500),
      birth_date DATE,
      gender VARCHAR(20),
      grade VARCHAR(50),
      school VARCHAR(200),
      interests TEXT[],
      language VARCHAR(10) DEFAULT 'en',
      timezone VARCHAR(50),
      preferences JSONB DEFAULT '{}',
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );

    -- AI Devices Table
    CREATE TABLE IF NOT EXISTS ai_device (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      mac_address VARCHAR(20) NOT NULL UNIQUE,
      user_id BIGINT REFERENCES sys_user(id),
      agent_id UUID REFERENCES ai_agent(id),
      kid_id BIGINT REFERENCES kid_profile(id),
      alias VARCHAR(200),
      board VARCHAR(100),
      app_version VARCHAR(50),
      mode VARCHAR(50) DEFAULT 'conversation',
      device_mode VARCHAR(50) DEFAULT 'auto',
      auto_update INTEGER DEFAULT 1,
      last_connected_at TIMESTAMPTZ,
      create_date TIMESTAMPTZ DEFAULT NOW(),
      update_date TIMESTAMPTZ DEFAULT NOW()
    );

    -- Chat History Table
    CREATE TABLE IF NOT EXISTS ai_agent_chat_history (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      mac_address VARCHAR(20),
      agent_id UUID REFERENCES ai_agent(id),
      session_id VARCHAR(100) NOT NULL,
      chat_type INTEGER NOT NULL,
      content TEXT,
      audio_id VARCHAR(100),
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    -- Music Table
    CREATE TABLE IF NOT EXISTS ai_music (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      title VARCHAR(300) NOT NULL,
      artist VARCHAR(200),
      album VARCHAR(200),
      category VARCHAR(100),
      language VARCHAR(50),
      duration INTEGER,
      file_url VARCHAR(500),
      cover_url VARCHAR(500),
      lyrics TEXT,
      sort INTEGER DEFAULT 0,
      status INTEGER DEFAULT 1,
      creator BIGINT,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );

    -- Story Table
    CREATE TABLE IF NOT EXISTS ai_story (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      title VARCHAR(300) NOT NULL,
      author VARCHAR(200),
      category VARCHAR(100),
      language VARCHAR(50),
      age_group VARCHAR(50),
      duration INTEGER,
      content TEXT,
      audio_url VARCHAR(500),
      cover_url VARCHAR(500),
      sort INTEGER DEFAULT 0,
      status INTEGER DEFAULT 1,
      creator BIGINT,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );

    -- Textbook Table
    CREATE TABLE IF NOT EXISTS ai_textbook (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      title VARCHAR(300) NOT NULL,
      subject VARCHAR(100),
      grade VARCHAR(50),
      language VARCHAR(50),
      publisher VARCHAR(200),
      cover_url VARCHAR(500),
      description TEXT,
      sort INTEGER DEFAULT 0,
      status INTEGER DEFAULT 1,
      creator BIGINT,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );

    -- Textbook Chapters Table
    CREATE TABLE IF NOT EXISTS ai_textbook_chapter (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      textbook_id UUID REFERENCES ai_textbook(id) ON DELETE CASCADE,
      title VARCHAR(300) NOT NULL,
      content TEXT,
      audio_url VARCHAR(500),
      sort INTEGER DEFAULT 0,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    -- RFID Tags Table
    CREATE TABLE IF NOT EXISTS ai_rfid_tag (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      uid VARCHAR(50) NOT NULL UNIQUE,
      name VARCHAR(200),
      description TEXT,
      content_type VARCHAR(50),
      content_id UUID,
      action_type VARCHAR(50),
      action_params JSONB,
      device_mac VARCHAR(20),
      status INTEGER DEFAULT 1,
      creator BIGINT,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );

    -- RFID Scan Log Table
    CREATE TABLE IF NOT EXISTS ai_rfid_scan_log (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      mac_address VARCHAR(20),
      rfid_uid VARCHAR(50),
      tag_id UUID REFERENCES ai_rfid_tag(id),
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    -- Kid Learning Progress Table
    CREATE TABLE IF NOT EXISTS kid_learning_progress (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      kid_id BIGINT REFERENCES kid_profile(id),
      subject VARCHAR(100) NOT NULL,
      topic VARCHAR(200) NOT NULL,
      score INTEGER,
      time_spent INTEGER,
      completed BOOLEAN DEFAULT FALSE,
      metadata JSONB DEFAULT '{}',
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(kid_id, subject, topic)
    );

    -- Kid Activity Log Table
    CREATE TABLE IF NOT EXISTS kid_activity_log (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      kid_id BIGINT REFERENCES kid_profile(id),
      activity_type VARCHAR(50) NOT NULL,
      content_type VARCHAR(50),
      content_id UUID,
      duration INTEGER,
      metadata JSONB DEFAULT '{}',
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    -- Create indexes
    CREATE INDEX IF NOT EXISTS idx_ai_device_mac ON ai_device(mac_address);
    CREATE INDEX IF NOT EXISTS idx_ai_device_user ON ai_device(user_id);
    CREATE INDEX IF NOT EXISTS idx_ai_agent_user ON ai_agent(user_id);
    CREATE INDEX IF NOT EXISTS idx_chat_history_session ON ai_agent_chat_history(session_id);
    CREATE INDEX IF NOT EXISTS idx_chat_history_agent ON ai_agent_chat_history(agent_id);
    CREATE INDEX IF NOT EXISTS idx_rfid_uid ON ai_rfid_tag(uid);
    CREATE INDEX IF NOT EXISTS idx_kid_profile_user ON kid_profile(user_id);
  `;

  try {
    await pool.query(coreTables);
    logger.info('✓ Core tables created');
  } catch (error) {
    if (error.code !== '42P07') {
      throw error;
    }
  }
};

/**
 * Run seed data
 */
const runSeedData = async (pool) => {
  logger.info('Adding seed data...');

  try {
    // Check if seed data already exists
    const { rows } = await pool.query('SELECT COUNT(*) FROM ai_model');
    if (parseInt(rows[0].count) > 0) {
      logger.info('○ Seed data already exists');
      return;
    }

    // Insert default AI models
    await pool.query(`
      INSERT INTO ai_model (model_type, model_name, model_code, provider, description, sort) VALUES
      -- ASR Models
      ('asr', 'Deepgram Nova-2', 'nova-2', 'deepgram', 'Deepgram Nova-2 speech recognition', 1),
      ('asr', 'Whisper Large V3', 'whisper-large-v3', 'groq', 'OpenAI Whisper via Groq', 2),
      ('asr', 'Google Speech-to-Text', 'google-stt', 'google', 'Google Cloud Speech-to-Text', 3),

      -- VAD Models
      ('vad', 'Silero VAD', 'silero', 'silero', 'Silero Voice Activity Detection', 1),

      -- LLM Models
      ('llm', 'GPT-4o Mini', 'gpt-4o-mini', 'openai', 'OpenAI GPT-4o Mini', 1),
      ('llm', 'Claude 3.5 Sonnet', 'claude-3-5-sonnet-20241022', 'anthropic', 'Anthropic Claude 3.5 Sonnet', 2),
      ('llm', 'Llama 3.3 70B', 'llama-3.3-70b-versatile', 'groq', 'Meta Llama 3.3 via Groq', 3),
      ('llm', 'Gemini 2.0 Flash', 'gemini-2.0-flash-exp', 'google', 'Google Gemini 2.0 Flash', 4),

      -- TTS Models
      ('tts', 'ElevenLabs', 'elevenlabs', 'elevenlabs', 'ElevenLabs Text-to-Speech', 1),
      ('tts', 'Edge TTS', 'edge-tts', 'microsoft', 'Microsoft Edge TTS (Free)', 2),
      ('tts', 'Google TTS', 'google-tts', 'google', 'Google Cloud Text-to-Speech', 3),

      -- Memory Models
      ('mem', 'Mem0', 'mem0', 'mem0', 'Mem0 Memory System', 1)

      ON CONFLICT DO NOTHING;
    `);

    // Get TTS model ID for voices
    const { rows: ttsModels } = await pool.query(
      "SELECT id FROM ai_model WHERE model_code = 'elevenlabs' LIMIT 1"
    );

    if (ttsModels.length > 0) {
      const ttsModelId = ttsModels[0].id;

      // Insert default TTS voices
      await pool.query(`
        INSERT INTO ai_tts_voice (tts_model_id, voice_name, voice_code, gender, language, age_group, style, sort) VALUES
        ($1, 'Rachel', 'rachel', 'female', 'en', 'adult', 'friendly', 1),
        ($1, 'Josh', 'josh', 'male', 'en', 'adult', 'casual', 2),
        ($1, 'Bella', 'bella', 'female', 'en', 'young', 'cheerful', 3),
        ($1, 'Adam', 'adam', 'male', 'en', 'adult', 'professional', 4)
        ON CONFLICT DO NOTHING;
      `, [ttsModelId]);
    }

    // Create a demo user
    await pool.query(`
      INSERT INTO sys_user (username, email, password, nickname, role) VALUES
      ('demo', 'demo@cheeko.ai', '$2b$10$demo.password.hash', 'Demo User', 'admin')
      ON CONFLICT DO NOTHING;
    `);

    // Get demo user ID
    const { rows: users } = await pool.query(
      "SELECT id FROM sys_user WHERE username = 'demo' LIMIT 1"
    );

    if (users.length > 0) {
      const userId = users[0].id;

      // Create a default agent
      await pool.query(`
        INSERT INTO ai_agent (user_id, agent_code, agent_name, system_prompt, lang_code, language, creator) VALUES
        ($1, 'cheeko', 'Cheeko',
         'You are Cheeko, a friendly AI companion for children. You are warm, encouraging, and educational. You help children learn through conversation, stories, and games. Always be age-appropriate, patient, and supportive.',
         'en', 'English', $1)
        ON CONFLICT DO NOTHING;
      `, [userId]);
    }

    logger.info('✓ Seed data added');

  } catch (error) {
    logger.error('Seed data error:', error.message);
    // Don't fail on seed errors
  }
};

module.exports = {
  runMigrations,
  tableExists,
  getPool
};
