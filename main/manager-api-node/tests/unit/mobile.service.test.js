'use strict';

jest.mock('../../src/config/database', () => ({
  prisma: {
    sys_user: {
      findUnique: jest.fn()
    },
    parent_profile: {
      upsert: jest.fn(),
      update: jest.fn()
    },
    ai_device: {
      findMany: jest.fn()
    },
    rfid_card_tap_log: {
      count: jest.fn(),
      findFirst: jest.fn()
    }
  }
}));

const { prisma } = require('../../src/config/database');
const mobileService = require('../../src/services/mobile.service');

describe('mobile.service parent profile compatibility', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns mobile-friendly aliases for saved parent profile fields', async () => {
    prisma.sys_user.findUnique.mockResolvedValue({
      id: 1n,
      parent_profile: {
        id: 10n,
        user_id: 1n,
        display_name: 'Aditi Parent',
        phone_number: '+919876543210'
      }
    });

    const profile = await mobileService.getParentProfile('firebase-user-1');

    expect(profile.display_name).toBe('Aditi Parent');
    expect(profile.phone_number).toBe('+919876543210');
    expect(profile.parent_name).toBe('Aditi Parent');
    expect(profile.fullName).toBe('Aditi Parent');
    expect(profile.phoneNumber).toBe('+919876543210');
  });

  it('saves push notification toggle from the mobile app', async () => {
    prisma.sys_user.findUnique.mockResolvedValue({
      id: 1n,
      email: 'parent@example.com'
    });
    prisma.parent_profile.upsert.mockResolvedValue({
      id: 10n,
      user_id: 1n,
      push_notifications: false
    });

    const profile = await mobileService.updateParentProfile('firebase-user-1', {
      push_notifications: false
    });

    expect(prisma.parent_profile.upsert).toHaveBeenCalledWith({
      where: { user_id: 1n },
      create: {
        user_id: 1n,
        email: 'parent@example.com',
        push_notifications: false
      },
      update: {
        push_notifications: false
      }
    });
    expect(profile.push_notifications).toBe(false);
    expect(profile.pushNotifications).toBe(false);
  });

  it('saves and returns the parent country/region field', async () => {
    prisma.sys_user.findUnique.mockResolvedValue({
      id: 1n,
      email: 'parent@example.com'
    });
    prisma.parent_profile.upsert.mockResolvedValue({
      id: 10n,
      user_id: 1n,
      country_region: 'IN'
    });

    const profile = await mobileService.updateParentProfile('firebase-user-1', {
      country_region: 'IN'
    });

    expect(prisma.parent_profile.upsert).toHaveBeenCalledWith({
      where: { user_id: 1n },
      create: {
        user_id: 1n,
        email: 'parent@example.com',
        country_region: 'IN'
      },
      update: {
        country_region: 'IN'
      }
    });
    expect(profile.country_region).toBe('IN');
  });

  it('stores and clears the mobile FCM token on the parent profile', async () => {
    prisma.sys_user.findUnique.mockResolvedValue({
      id: 1n,
      email: 'parent@example.com'
    });
    prisma.parent_profile.upsert.mockResolvedValueOnce({
      id: 10n,
      user_id: 1n,
      fcm_token: 'fcm-token-123'
    });
    prisma.parent_profile.upsert.mockResolvedValueOnce({
      id: 10n,
      user_id: 1n,
      fcm_token: null
    });

    const saved = await mobileService.updateFcmToken('firebase-user-1', 'fcm-token-123');
    const cleared = await mobileService.clearFcmToken('firebase-user-1');

    expect(saved.fcmToken).toBe('fcm-token-123');
    expect(cleared.fcmToken).toBeNull();
  });

  it('saves legal consent fields and notification values from parent profile create/update', async () => {
    prisma.sys_user.findUnique.mockResolvedValue({
      id: 1n,
      email: 'parent@example.com'
    });
    prisma.parent_profile.upsert.mockResolvedValue({
      id: 10n,
      user_id: 1n,
      terms_version: 'v1.0',
      terms_accepted_at: new Date('2026-05-09T07:30:00.000Z'),
      privacy_policy_accepted_at: new Date('2026-05-09T07:31:00.000Z'),
      consent_accepted_at: new Date('2026-05-09T07:32:00.000Z'),
      push_notifications: true,
      email_notifications: false,
      fcm_token: 'fcm-token-456'
    });

    await mobileService.updateParentProfile('firebase-user-1', {
      terms_version: 'v1.0',
      terms_accepted_at: '2026-05-09T07:30:00.000Z',
      privacy_policy_accepted_at: '2026-05-09T07:31:00.000Z',
      consent_accepted_at: '2026-05-09T07:32:00.000Z',
      push_notifications: true,
      email_notifications: false,
      fcm_token: 'fcm-token-456'
    });

    expect(prisma.parent_profile.upsert).toHaveBeenCalledWith({
      where: { user_id: 1n },
      create: {
        user_id: 1n,
        email: 'parent@example.com',
        terms_version: 'v1.0',
        terms_accepted_at: new Date('2026-05-09T07:30:00.000Z'),
        privacy_policy_accepted_at: new Date('2026-05-09T07:31:00.000Z'),
        consent_accepted_at: new Date('2026-05-09T07:32:00.000Z'),
        push_notifications: true,
        email_notifications: false,
        fcm_token: 'fcm-token-456'
      },
      update: {
        terms_version: 'v1.0',
        terms_accepted_at: new Date('2026-05-09T07:30:00.000Z'),
        privacy_policy_accepted_at: new Date('2026-05-09T07:31:00.000Z'),
        consent_accepted_at: new Date('2026-05-09T07:32:00.000Z'),
        push_notifications: true,
        email_notifications: false,
        fcm_token: 'fcm-token-456'
      }
    });
  });

  it('separates today-only card progress from latest card activity across all time', async () => {
    prisma.sys_user.findUnique.mockResolvedValue({ id: 1n, firebase_uid: 'firebase-user-1' });
    prisma.ai_device.findMany.mockResolvedValue([
      { id: 'device-1', mac_address: 'AA:BB:CC:DD:EE:FF' }
    ]);
    prisma.rfid_card_tap_log.count.mockResolvedValue(0);
    prisma.rfid_card_tap_log.findFirst.mockResolvedValue({
      id: 99n,
      mac_address: 'AA:BB:CC:DD:EE:FF',
      rfid_uid: 'ABC123',
      card_type: 'content',
      content_pack_id: 5n,
      content_pack_code: 'STORY001',
      content_pack_name: 'Bedtime Story',
      created_at: new Date('2026-05-12T18:00:00.000Z')
    });

    const result = await mobileService.getHomepageActivity('firebase-user-1', {
      now: new Date('2026-05-13T10:00:00.000Z')
    });

    expect(prisma.rfid_card_tap_log.count).toHaveBeenCalledWith({
      where: {
        OR: [
          { user_id: 1n },
          { mac_address: { in: ['AA:BB:CC:DD:EE:FF'] } }
        ],
        created_at: {
          gte: new Date('2026-05-12T18:30:00.000Z'),
          lte: new Date('2026-05-13T18:29:59.999Z')
        }
      }
    });
    expect(result.today_progress.card_tap_count).toBe(0);
    expect(result.today_progress.date).toBe('2026-05-13');
    expect(result.recent_activity.rfid_uid).toBe('ABC123');
    expect(result.recent_activity.content_pack_name).toBe('Bedtime Story');
  });
});
