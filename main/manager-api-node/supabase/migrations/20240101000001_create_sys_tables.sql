-- Migration: Create System Tables
-- Description: Core system tables for users, params, and dictionaries

-- =============================================
-- sys_user - User accounts
-- =============================================
CREATE TABLE IF NOT EXISTS sys_user (
    id BIGSERIAL PRIMARY KEY,
    username VARCHAR(100) UNIQUE NOT NULL,
    password VARCHAR(255) NOT NULL,
    super_admin SMALLINT DEFAULT 0,
    status SMALLINT DEFAULT 1,
    creator BIGINT,
    create_date TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updater BIGINT,
    update_date TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_sys_user_username ON sys_user(username);
CREATE INDEX idx_sys_user_status ON sys_user(status);

COMMENT ON TABLE sys_user IS 'System user accounts';
COMMENT ON COLUMN sys_user.super_admin IS '0=normal user, 1=super admin';
COMMENT ON COLUMN sys_user.status IS '0=disabled, 1=enabled';

-- =============================================
-- sys_user_token - Authentication tokens
-- =============================================
CREATE TABLE IF NOT EXISTS sys_user_token (
    id BIGSERIAL PRIMARY KEY,
    user_id BIGINT NOT NULL REFERENCES sys_user(id) ON DELETE CASCADE,
    token VARCHAR(500) NOT NULL,
    expire_date TIMESTAMP WITH TIME ZONE NOT NULL,
    create_date TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    update_date TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_sys_user_token_user_id ON sys_user_token(user_id);
CREATE INDEX idx_sys_user_token_token ON sys_user_token(token);
CREATE INDEX idx_sys_user_token_expire ON sys_user_token(expire_date);

COMMENT ON TABLE sys_user_token IS 'User authentication tokens';

-- =============================================
-- sys_params - System parameters
-- =============================================
CREATE TABLE IF NOT EXISTS sys_params (
    id BIGSERIAL PRIMARY KEY,
    param_code VARCHAR(100) UNIQUE NOT NULL,
    param_value TEXT,
    value_type VARCHAR(50) DEFAULT 'string',
    param_type SMALLINT DEFAULT 1,
    remark VARCHAR(500),
    creator BIGINT,
    create_date TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updater BIGINT,
    update_date TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_sys_params_code ON sys_params(param_code);

COMMENT ON TABLE sys_params IS 'System configuration parameters';
COMMENT ON COLUMN sys_params.value_type IS 'string, number, boolean, array';
COMMENT ON COLUMN sys_params.param_type IS '0=system (read-only), 1=configurable';

-- =============================================
-- sys_dict_type - Dictionary types
-- =============================================
CREATE TABLE IF NOT EXISTS sys_dict_type (
    id BIGSERIAL PRIMARY KEY,
    dict_type VARCHAR(100) UNIQUE NOT NULL,
    dict_name VARCHAR(255) NOT NULL,
    remark VARCHAR(500),
    sort INTEGER DEFAULT 0,
    creator BIGINT,
    create_date TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updater BIGINT,
    update_date TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_sys_dict_type_type ON sys_dict_type(dict_type);

COMMENT ON TABLE sys_dict_type IS 'Dictionary type definitions';

-- =============================================
-- sys_dict_data - Dictionary values
-- =============================================
CREATE TABLE IF NOT EXISTS sys_dict_data (
    id BIGSERIAL PRIMARY KEY,
    dict_type_id BIGINT NOT NULL REFERENCES sys_dict_type(id) ON DELETE CASCADE,
    dict_label VARCHAR(255) NOT NULL,
    dict_value VARCHAR(255) NOT NULL,
    remark VARCHAR(500),
    sort INTEGER DEFAULT 0,
    creator BIGINT,
    create_date TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updater BIGINT,
    update_date TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_sys_dict_data_type_id ON sys_dict_data(dict_type_id);

COMMENT ON TABLE sys_dict_data IS 'Dictionary values';

-- =============================================
-- parent_profiles - Parent/Guardian profiles (merged mobile + backend)
-- =============================================
CREATE TABLE IF NOT EXISTS parent_profiles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID,
    sys_user_id BIGINT REFERENCES sys_user(id) ON DELETE SET NULL,
    parent_name TEXT,
    display_name VARCHAR(255),
    email VARCHAR(255),
    phone_number VARCHAR(50),
    avatar_url VARCHAR(500),
    preferred_language VARCHAR(10) DEFAULT 'en',
    timezone VARCHAR(100) DEFAULT 'UTC',
    notification_preferences JSONB DEFAULT '{"push": true, "email": true, "daily_summary": true}',
    email_notifications BOOLEAN DEFAULT true,
    push_notifications BOOLEAN DEFAULT true,
    weekly_report BOOLEAN DEFAULT true,
    onboarding_completed BOOLEAN DEFAULT FALSE,
    terms_accepted_at TIMESTAMP WITH TIME ZONE,
    terms_version VARCHAR(20),
    privacy_policy_accepted_at TIMESTAMP WITH TIME ZONE,
    java_user_id INTEGER,
    java_token TEXT,
    generated_password_hash TEXT,
    fcm_token TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT parent_profiles_user_id_key UNIQUE(user_id)
);

CREATE INDEX idx_parent_profiles_user_id ON parent_profiles(user_id);
CREATE INDEX idx_parent_profiles_sys_user_id ON parent_profiles(sys_user_id);
CREATE INDEX idx_parent_profiles_email ON parent_profiles(email);
CREATE INDEX idx_parent_profiles_created_at ON parent_profiles(created_at DESC);

COMMENT ON TABLE parent_profiles IS 'Parent/Guardian profile information (merged mobile + backend)';

-- =============================================
-- kid_profile - Child profiles
-- =============================================
CREATE TABLE IF NOT EXISTS kid_profile (
    id BIGSERIAL PRIMARY KEY,
    user_id BIGINT REFERENCES sys_user(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    date_of_birth DATE,
    gender VARCHAR(20),
    interests JSONB DEFAULT '[]',
    avatar_url VARCHAR(500),
    primary_language VARCHAR(10) DEFAULT 'en',
    additional_notes TEXT,
    creator BIGINT,
    create_date TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updater BIGINT,
    update_date TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_kid_profile_user_id ON kid_profile(user_id);

COMMENT ON TABLE kid_profile IS 'Child profile information';
COMMENT ON COLUMN kid_profile.gender IS 'male, female, other';
COMMENT ON COLUMN kid_profile.interests IS 'JSON array of interests';
