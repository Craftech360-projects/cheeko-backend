/**
 * Onboarding Database Configuration
 *
 * Separate Supabase project used by the lightweight device onboarding UI.
 * The existing manager/admin database remains untouched.
 */

const { createClient } = require('@supabase/supabase-js');
const logger = require('../utils/logger');

const ONBOARDING_SUPABASE_URL = process.env.ONBOARDING_SUPABASE_URL;
const ONBOARDING_SUPABASE_ANON_KEY = process.env.ONBOARDING_SUPABASE_ANON_KEY;
const ONBOARDING_SUPABASE_SERVICE_ROLE_KEY = process.env.ONBOARDING_SUPABASE_SERVICE_ROLE_KEY;

const isOnboardingDbConfigured = () => Boolean(
  ONBOARDING_SUPABASE_URL &&
  ONBOARDING_SUPABASE_ANON_KEY &&
  ONBOARDING_SUPABASE_SERVICE_ROLE_KEY
);

let onboardingSupabase = null;
let onboardingSupabaseAdmin = null;

if (isOnboardingDbConfigured()) {
  onboardingSupabase = createClient(ONBOARDING_SUPABASE_URL, ONBOARDING_SUPABASE_ANON_KEY, {
    auth: { autoRefreshToken: false, persistSession: false }
  });

  onboardingSupabaseAdmin = createClient(ONBOARDING_SUPABASE_URL, ONBOARDING_SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false }
  });

  logger.info('Onboarding Supabase client initialized');
} else {
  logger.warn('Onboarding Supabase is not configured. Set ONBOARDING_SUPABASE_URL, ONBOARDING_SUPABASE_ANON_KEY, and ONBOARDING_SUPABASE_SERVICE_ROLE_KEY.');
}

module.exports = {
  onboardingSupabase,
  onboardingSupabaseAdmin,
  isOnboardingDbConfigured
};
