-- Separate Supabase database schema for the public device onboarding flow.
-- Run this in the new Supabase project SQL editor after creating the project.

create extension if not exists pgcrypto;

create table if not exists onboarding_users (
  id uuid primary key default gen_random_uuid(),
  username text not null unique,
  email text unique,
  password_hash text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists onboarding_user_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references onboarding_users(id) on delete cascade,
  token text not null unique,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

create index if not exists idx_onboarding_user_tokens_user_id on onboarding_user_tokens(user_id);
create index if not exists idx_onboarding_user_tokens_expires_at on onboarding_user_tokens(expires_at);

create table if not exists onboarding_devices (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references onboarding_users(id) on delete set null,
  mac_address text not null unique,
  activation_code text,
  activation_code_expires_at timestamptz,
  board text,
  app_version text,
  bound_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_onboarding_devices_user_id on onboarding_devices(user_id);
create index if not exists idx_onboarding_devices_activation_code on onboarding_devices(activation_code);

create table if not exists onboarding_device_websocket (
  id uuid primary key default gen_random_uuid(),
  device_id uuid not null unique references onboarding_devices(id) on delete cascade,
  websocket_url text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint onboarding_device_websocket_url_scheme
    check (websocket_url ~* '^wss?://')
);

create index if not exists idx_onboarding_device_websocket_device_id
  on onboarding_device_websocket(device_id);
