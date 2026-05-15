'use strict';

jest.mock('@supabase/supabase-js', () => ({
  createClient: jest.fn(() => ({ auth: { onAuthStateChange: jest.fn() } })),
}));

jest.mock('ws', () => function MockWebSocket() {});

jest.mock('pg', () => ({
  Pool: jest.fn(() => ({ on: jest.fn() })),
}));

jest.mock('@prisma/adapter-pg', () => ({
  PrismaPg: jest.fn(),
}));

jest.mock('@prisma/client', () => ({
  PrismaClient: jest.fn(() => ({
    $queryRaw: jest.fn(),
  })),
}));

jest.mock('../../src/utils/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
}));

describe('database Supabase clients', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = {
      ...originalEnv,
      DATABASE_URL: 'postgresql://user:pass@example.com:5432/db',
      SUPABASE_URL: 'https://example.supabase.co',
      SUPABASE_ANON_KEY: 'anon-key',
      SUPABASE_SERVICE_ROLE_KEY: 'service-key',
    };
  });

  afterEach(() => {
    process.env = originalEnv;
    jest.clearAllMocks();
  });

  it('passes ws transport to all Supabase realtime clients on Node 20', () => {
    const { createClient } = require('@supabase/supabase-js');
    const WebSocket = require('ws');
    const { getClientWithAuth } = require('../../src/config/database');

    getClientWithAuth('user-token');

    expect(createClient).toHaveBeenCalledTimes(3);
    for (const call of createClient.mock.calls) {
      expect(call[2]).toEqual(expect.objectContaining({
        realtime: { transport: WebSocket },
      }));
    }
  });
});
