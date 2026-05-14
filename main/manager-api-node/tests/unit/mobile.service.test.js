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
    kid_profile: {
      findFirst: jest.fn()
    },
    content_library: {
      findMany: jest.fn()
    },
    analytics_media_playback: {
      findMany: jest.fn()
    },
    analytics_game_sessions: {
      findMany: jest.fn()
    },
    ai_agent_chat_history: {
      count: jest.fn(),
      findMany: jest.fn()
    },
    rfid_card_tap_log: {
      count: jest.fn(),
      findMany: jest.fn(),
      findFirst: jest.fn()
    }
  }
}));

const { prisma } = require('../../src/config/database');
const mobileService = require('../../src/services/mobile.service');

describe('mobile.service parent profile compatibility', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    prisma.kid_profile.findFirst.mockResolvedValue(null);
    prisma.ai_device.findMany.mockResolvedValue([]);
    prisma.content_library.findMany.mockResolvedValue([]);
    prisma.analytics_media_playback.findMany.mockResolvedValue([]);
    prisma.analytics_game_sessions.findMany.mockResolvedValue([]);
    prisma.ai_agent_chat_history.findMany.mockResolvedValue([]);
    prisma.ai_agent_chat_history.count.mockResolvedValue(0);
    prisma.rfid_card_tap_log.findMany.mockResolvedValue([]);
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
      { id: 'device-1', mac_address: 'AA:BB:CC:DD:EE:FF', agent_id: 'agent-1' }
    ]);
    prisma.rfid_card_tap_log.count.mockResolvedValue(0);
    prisma.ai_agent_chat_history.count.mockResolvedValue(3);
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
    expect(prisma.ai_agent_chat_history.count).toHaveBeenCalledWith({
      where: {
        chat_type: 1,
        OR: [
          { mac_address: { in: ['AA:BB:CC:DD:EE:FF'] } },
          { agent_id: { in: ['agent-1'] } }
        ],
        created_at: {
          gte: new Date('2026-05-12T18:30:00.000Z'),
          lte: new Date('2026-05-13T18:29:59.999Z')
        }
      }
    });
    expect(result.today_progress.card_tap_count).toBe(0);
    expect(result.today_progress.ai_interaction_count).toBe(3);
    expect(result.today_progress.aiInteractionCount).toBe(3);
    expect(result.todayProgress.aiInteractionCount).toBe(3);
    expect(result.today_progress.date).toBe('2026-05-13');
    expect(result.recent_activity.rfid_uid).toBe('ABC123');
    expect(result.recent_activity.content_pack_name).toBe('Bedtime Story');
  });
});

describe('mobile.service homepage recommendations', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    prisma.sys_user.findUnique.mockResolvedValue({ id: 1n, firebase_uid: 'firebase-user-1' });
    prisma.kid_profile.findFirst.mockResolvedValue({
      id: 10n,
      user_id: 1n,
      name: 'Aditi',
      birth_date: new Date('2022-05-14T00:00:00.000Z'),
      interests: ['Animals', 'Rhymes'],
      language: 'en',
      preferences: { aiModes: ['story'], contentTypes: ['music'] }
    });
    prisma.ai_device.findMany.mockResolvedValue([
      { id: 'device-1', mac_address: 'FC:01:2C:CF:EB:54', agent_id: 'agent-1', kid_id: 10n }
    ]);
    prisma.analytics_media_playback.findMany.mockResolvedValue([]);
    prisma.analytics_game_sessions.findMany.mockResolvedValue([]);
    prisma.ai_agent_chat_history.findMany.mockResolvedValue([]);
    prisma.rfid_card_tap_log.findMany.mockResolvedValue([]);
    prisma.content_library.findMany.mockResolvedValue([]);
  });

  it('denies recommendations when the kid does not belong to the parent', async () => {
    prisma.kid_profile.findFirst.mockResolvedValue(null);

    await expect(mobileService.getHomepageRecommendations('firebase-user-1', {
      kidId: '999',
      limit: 8
    })).rejects.toMatchObject({
      statusCode: 403,
      message: 'Access denied'
    });
  });

  it('returns first-time preference-based content and AI cards', async () => {
    prisma.content_library.findMany.mockResolvedValue([
      {
        id: 1n,
        title: 'Animal Song',
        content_type: 'music',
        category: 'Animals',
        thumbnail_url: 'https://example.com/animal.png',
        duration_seconds: 120,
        language: 'en',
        tags: ['animal'],
        age_min: 3,
        age_max: 6,
        status: 1,
        created_at: new Date('2026-05-10T00:00:00.000Z')
      },
      {
        id: 2n,
        title: 'Space Facts',
        content_type: 'story',
        category: 'Space',
        thumbnail_url: null,
        duration_seconds: 180,
        language: 'en',
        tags: [],
        age_min: 7,
        age_max: 10,
        status: 1,
        created_at: new Date('2026-05-09T00:00:00.000Z')
      }
    ]);

    const result = await mobileService.getHomepageRecommendations('firebase-user-1', {
      kidId: '10',
      limit: 4
    });

    expect(result.items).toEqual(expect.arrayContaining([
      expect.objectContaining({
        itemType: 'content',
        id: '1',
        contentId: '1',
        title: 'Animal Song',
        subtitle: expect.any(String),
        contentType: 'music',
        category: 'Animals',
        formattedDuration: '02:00'
      }),
      expect.objectContaining({
        itemType: 'ai',
        id: 'ai-story-mode',
        title: 'Story AI',
        aiMode: 'story',
        routeName: 'aiStoryMode',
        category: 'AI',
        subtitle: expect.any(String)
      })
    ]));
    expect(result.items[0].title).toBe('Animal Song');
  });

  it('uses recent card taps to rank similar content first', async () => {
    prisma.rfid_card_tap_log.findMany.mockResolvedValue([
      {
        content_pack_name: 'Animal Adventure Pack',
        content_pack_code: 'ANIMAL001',
        card_type: 'story',
        rfid_uid: 'ABC123',
        created_at: new Date('2026-05-14T08:00:00.000Z')
      }
    ]);
    prisma.content_library.findMany.mockResolvedValue([
      {
        id: 1n,
        title: 'Counting Numbers',
        content_type: 'music',
        category: 'Numbers',
        language: 'en',
        tags: [],
        duration_seconds: 90,
        status: 1,
        created_at: new Date('2026-05-13T00:00:00.000Z')
      },
      {
        id: 2n,
        title: 'Jungle Animals Story',
        content_type: 'story',
        category: 'Animals',
        language: 'en',
        tags: ['jungle', 'animal'],
        duration_seconds: 180,
        status: 1,
        created_at: new Date('2026-05-12T00:00:00.000Z')
      }
    ]);

    const result = await mobileService.getHomepageRecommendations('firebase-user-1', {
      kidId: '10',
      limit: 3
    });

    expect(result.items[0]).toEqual(expect.objectContaining({
      itemType: 'content',
      id: '2',
      title: 'Jungle Animals Story'
    }));
    expect(result.items[0].reason).toContain('Animal');
  });

  it('uses old rhyme card taps to rank rhyme content first even when the tap is not from today', async () => {
    prisma.rfid_card_tap_log.findMany.mockResolvedValue([
      {
        content_pack_name: 'Rhyme Starter Pack',
        content_pack_code: 'RHYME001',
        card_type: 'rhyme',
        rfid_uid: 'RHYME-CARD-1',
        created_at: new Date('2026-05-12T08:00:00.000Z')
      }
    ]);
    prisma.content_library.findMany.mockResolvedValue([
      {
        id: 1n,
        title: 'Animal Story',
        content_type: 'story',
        category: 'Animals',
        language: 'en',
        tags: ['animal'],
        duration_seconds: 180,
        status: 1,
        created_at: new Date('2026-05-14T00:00:00.000Z')
      },
      {
        id: 2n,
        title: 'Rhyme Time',
        content_type: 'rhyme',
        category: 'Rhymes',
        language: 'en',
        tags: ['rhyme'],
        metadata: { contentPackCode: 'RHYME001' },
        duration_seconds: 60,
        status: 1,
        created_at: new Date('2026-05-10T00:00:00.000Z')
      }
    ]);

    const result = await mobileService.getHomepageRecommendations('firebase-user-1', {
      kidId: '10',
      limit: 2
    });

    expect(result.items[0]).toEqual(expect.objectContaining({
      itemType: 'content',
      id: '2',
      title: 'Rhyme Time',
      contentType: 'rhyme',
      subtitle: expect.stringContaining('RHYME001')
    }));
  });

  it('includes AI recommendations when recent card history indicates AI usage', async () => {
    prisma.rfid_card_tap_log.findMany.mockResolvedValue([
      {
        content_pack_name: 'Story AI Card',
        content_pack_code: 'AI-STORY',
        card_type: 'ai',
        rfid_uid: 'AI-CARD-1',
        created_at: new Date('2026-05-14T08:00:00.000Z')
      }
    ]);

    const result = await mobileService.getHomepageRecommendations('firebase-user-1', {
      kidId: '10',
      limit: 4
    });

    expect(result.items).toEqual(expect.arrayContaining([
      expect.objectContaining({
        itemType: 'ai',
        id: 'ai-story-mode',
        routeName: 'aiStoryMode',
        subtitle: 'Because child used an AI card'
      })
    ]));
  });

  it('deduplicates content and respects limit', async () => {
    prisma.content_library.findMany.mockResolvedValue([
      { id: 1n, title: 'Animal Song', content_type: 'music', category: 'Animals', language: 'en', status: 1 },
      { id: 1n, title: 'Animal Song', content_type: 'music', category: 'Animals', language: 'en', status: 1 },
      { id: 2n, title: 'Animal Song', content_type: 'music', category: 'Animals', language: 'en', status: 1 },
      { id: 3n, title: 'Rhyme Time', content_type: 'music', category: 'Rhymes', language: 'en', status: 1 }
    ]);

    const result = await mobileService.getHomepageRecommendations('firebase-user-1', {
      kidId: '10',
      limit: 2
    });

    expect(result.items).toHaveLength(2);
    expect(result.items.map(item => item.id)).toEqual(['1', '3']);
  });

  it('returns safe default backend content when there is no history and no preferences', async () => {
    prisma.kid_profile.findFirst.mockResolvedValue({
      id: 10n,
      user_id: 1n,
      name: 'Aditi',
      birth_date: null,
      interests: [],
      language: null,
      preferences: {}
    });
    prisma.content_library.findMany.mockResolvedValue([
      {
        id: 44n,
        title: 'Bedtime Story',
        content_type: 'story',
        category: 'Stories',
        language: 'en',
        duration_seconds: 180,
        status: 1,
        created_at: new Date('2026-05-11T00:00:00.000Z')
      }
    ]);

    const result = await mobileService.getHomepageRecommendations('firebase-user-1', {
      kidId: '10',
      limit: 8
    });

    expect(result.items).toEqual([
      expect.objectContaining({
        itemType: 'content',
        id: '44',
        title: 'Bedtime Story',
        subtitle: 'Popular content from the library'
      })
    ]);
  });
});
