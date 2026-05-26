'use strict';

jest.mock('../../src/config/database', () => ({
  prisma: {
    device_settings: {
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn()
    },
    device_runtime_state: {
      findUnique: jest.fn(),
      upsert: jest.fn()
    },
    device_sync_event: {
      create: jest.fn(),
      findMany: jest.fn(),
      findFirst: jest.fn()
    },
    ai_device: {
      findFirst: jest.fn()
    }
  }
}));

const { prisma } = require('../../src/config/database');
const deviceSettingsService = require('../../src/services/deviceSettings.service');

describe('deviceSettings.service runtime state freshness', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('marks a stale runtime state offline even when the stored online flag is true', async () => {
    const staleSeenAt = new Date(Date.now() - (3 * 60 * 1000));
    prisma.device_runtime_state.findUnique.mockResolvedValue({
      mac_address: 'AA:BB:CC:DD:EE:FF',
      online: true,
      last_seen_at: staleSeenAt,
      settings_version: 4
    });

    const state = await deviceSettingsService.getRuntimeStateByMac('AA:BB:CC:DD:EE:FF');

    expect(state.online).toBe(false);
    expect(state.last_seen_at).toBe(staleSeenAt);
  });

  it('keeps a fresh runtime state online', async () => {
    const freshSeenAt = new Date(Date.now() - (30 * 1000));
    prisma.device_runtime_state.findUnique.mockResolvedValue({
      mac_address: 'AA:BB:CC:DD:EE:FF',
      online: true,
      last_seen_at: freshSeenAt,
      settings_version: 4
    });

    const state = await deviceSettingsService.getRuntimeStateByMac('AA:BB:CC:DD:EE:FF');

    expect(state.online).toBe(true);
  });
});
