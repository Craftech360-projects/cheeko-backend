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
    rfid_content_pack: {
      findMany: jest.fn()
    },
    analytics_media_playback: {
      findMany: jest.fn()
    },
    analytics_game_sessions: {
      findMany: jest.fn()
    },
    device_analytics_event: {
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
    },
    rfid_card_mapping: {
      findMany: jest.fn()
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
    prisma.rfid_content_pack.findMany.mockResolvedValue([]);
    prisma.analytics_media_playback.findMany.mockResolvedValue([]);
    prisma.analytics_game_sessions.findMany.mockResolvedValue([]);
    prisma.device_analytics_event.findMany.mockResolvedValue([]);
    prisma.ai_agent_chat_history.findMany.mockResolvedValue([]);
    prisma.ai_agent_chat_history.count.mockResolvedValue(0);
    prisma.rfid_card_tap_log.count.mockResolvedValue(0);
    prisma.rfid_card_tap_log.findMany.mockResolvedValue([]);
    prisma.rfid_card_mapping.findMany.mockResolvedValue([]);
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
    prisma.ai_agent_chat_history.count.mockResolvedValue(88);
    prisma.device_analytics_event.findMany
      .mockResolvedValueOnce([
        { event_name: 'ai_talk_start', duration_ms: null },
        { event_name: 'ai_talk_start', duration_ms: null },
        { event_name: 'ai_talk_start', duration_ms: null }
      ])
      .mockResolvedValueOnce([
        {
          event_name: 'card_session_end',
          duration_ms: 185000,
          rfid_uid: 'DEF456',
          event_timestamp: new Date('2026-05-12T17:33:05.000Z'),
          server_received_at: new Date('2026-05-12T17:33:06.000Z')
        }
      ]);
    prisma.rfid_card_tap_log.findMany.mockResolvedValue([
      {
        id: 99n,
        mac_address: 'AA:BB:CC:DD:EE:FF',
        rfid_uid: 'ABC123',
        card_type: 'content',
        content_pack_id: 5n,
        content_pack_code: 'STORY001',
        content_pack_name: 'Bedtime Story',
        created_at: new Date('2026-05-12T18:00:00.000Z')
      },
      {
        id: 100n,
        mac_address: 'AA:BB:CC:DD:EE:FF',
        rfid_uid: 'ABC123',
        card_type: 'content',
        content_pack_id: 5n,
        content_pack_code: 'STORY001',
        content_pack_name: 'Bedtime Story',
        created_at: new Date('2026-05-12T17:55:00.000Z')
      },
      {
        id: 98n,
        mac_address: 'AA:BB:CC:DD:EE:FF',
        rfid_uid: 'DEF456',
        card_type: 'unknown',
        content_pack_id: null,
        content_pack_code: null,
        content_pack_name: null,
        created_at: new Date('2026-05-12T17:30:00.000Z')
      }
    ]);
    prisma.rfid_card_mapping.findMany.mockResolvedValue([
      {
        rfid_uid: 'DEF456',
        card_type: 'ai',
        pack_code: null,
        action_data: {
          cardName: 'Story AI Card',
          imageUrl: 'https://cdn.example.com/story-ai.png',
          description: 'Starts a story conversation'
        },
        rfid_content_pack: null,
        rfid_question: null,
        rfid_pack: null
      }
    ]);

    const result = await mobileService.getHomepageActivity('firebase-user-1', {
      now: new Date('2026-05-13T10:00:00.000Z')
    });

    expect(prisma.device_analytics_event.findMany).toHaveBeenCalledWith({
      where: {
        mac_address: { in: ['AA:BB:CC:DD:EE:FF'] },
        server_received_at: {
          gte: new Date('2026-05-12T18:30:00.000Z'),
          lte: new Date('2026-05-13T18:29:59.999Z')
        }
      },
      select: {
        event_name: true,
        duration_ms: true
      }
    });
    expect(prisma.device_analytics_event.findMany).toHaveBeenCalledWith({
      where: {
        mac_address: { in: ['AA:BB:CC:DD:EE:FF'] },
        rfid_uid: { in: ['ABC123', 'DEF456'] },
        event_name: 'card_session_end',
        server_received_at: {
          gte: new Date('2026-05-12T17:30:00.000Z'),
          lte: new Date('2026-05-13T10:00:00.000Z')
        }
      },
      orderBy: { server_received_at: 'asc' },
      select: {
        event_name: true,
        duration_ms: true,
        rfid_uid: true,
        event_timestamp: true,
        server_received_at: true
      }
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
    expect(prisma.ai_agent_chat_history.count).not.toHaveBeenCalled();
    expect(result.today_progress.card_tap_count).toBe(0);
    expect(result.today_progress.ai_interaction_count).toBe(3);
    expect(result.today_progress.aiInteractionCount).toBe(3);
    expect(result.todayProgress.aiInteractionCount).toBe(3);
    expect(result.today_progress.date).toBe('2026-05-13');
    expect(prisma.rfid_card_tap_log.findMany).toHaveBeenCalledWith({
      where: {
        OR: [
          { user_id: 1n },
          { mac_address: { in: ['AA:BB:CC:DD:EE:FF'] } }
        ]
      },
      orderBy: { created_at: 'desc' },
      take: 25,
      include: {
        rfid_content_pack: {
          select: {
            name: true,
            pack_code: true,
            description: true,
            thumbnail_url: true
          }
        }
      }
    });
    expect(prisma.rfid_card_mapping.findMany).toHaveBeenCalledWith({
      where: { rfid_uid: { in: ['ABC123', 'DEF456'] } },
      select: {
        rfid_uid: true,
        card_type: true,
        pack_code: true,
        action_data: true,
        rfid_content_pack: {
          select: {
            name: true,
            pack_code: true,
            description: true,
            thumbnail_url: true
          }
        },
        rfid_question: {
          select: {
            title: true,
            prompt_text: true
          }
        },
        rfid_pack: {
          select: {
            pack_name: true,
            pack_code: true,
            description: true
          }
        }
      }
    });
    expect(result.recent_activity.rfid_uid).toBe('ABC123');
    expect(result.recent_activity.content_pack_name).toBe('Bedtime Story');
    expect(result.recent_activities).toHaveLength(2);
    expect(result.recentActivities.map(activity => activity.rfidUid)).toEqual(['ABC123', 'DEF456']);
    expect(result.recentActivities[1].rfidUid).toBe('DEF456');
    expect(result.recentActivities[1].title).toBe('Story AI Card');
    expect(result.recentActivities[1].imageUrl).toBe('https://cdn.example.com/story-ai.png');
    expect(result.recentActivities[1].usageSeconds).toBe(185);
    expect(result.recentActivities[0].description).toContain('Content pack: Bedtime Story');
  });

  it('returns today device usage time and game count from toy analytics events', async () => {
    prisma.sys_user.findUnique.mockResolvedValue({ id: 1n, firebase_uid: 'firebase-user-1' });
    prisma.ai_device.findMany.mockResolvedValue([
      { id: 'device-1', mac_address: 'AA:BB:CC:DD:EE:FF', agent_id: 'agent-1' }
    ]);
    prisma.rfid_card_tap_log.count.mockResolvedValue(2);
    prisma.ai_agent_chat_history.count.mockResolvedValue(1);
    prisma.rfid_card_tap_log.findMany.mockResolvedValue([]);
    prisma.device_analytics_event.findMany.mockResolvedValue([
      { event_name: 'game_start', duration_ms: null },
      { event_name: 'game_end', duration_ms: 125000 },
      { event_name: 'card_session_start', duration_ms: null },
      { event_name: 'card_session_start', duration_ms: null },
      { event_name: 'ai_talk_start', duration_ms: null },
      { event_name: 'ai_talk_start', duration_ms: null },
      { event_name: 'ai_talk_start', duration_ms: null },
      { event_name: 'ai_talk_end', duration_ms: 65000 },
      { event_name: 'radio_end', duration_ms: 10000 },
      { event_name: 'game_start', duration_ms: 0 },
      { event_name: 'game_end', duration_ms: -5000 }
    ]);

    const result = await mobileService.getHomepageActivity('firebase-user-1', {
      now: new Date('2026-05-13T10:00:00.000Z')
    });

    expect(prisma.device_analytics_event.findMany).toHaveBeenCalledWith({
      where: {
        mac_address: { in: ['AA:BB:CC:DD:EE:FF'] },
        server_received_at: {
          gte: new Date('2026-05-12T18:30:00.000Z'),
          lte: new Date('2026-05-13T18:29:59.999Z')
        }
      },
      select: {
        event_name: true,
        duration_ms: true
      }
    });
    expect(result.today_progress.usage_time_seconds).toBe(200);
    expect(result.today_progress.usageTimeSeconds).toBe(200);
    expect(result.todayProgress.usageTimeSeconds).toBe(200);
    expect(result.today_progress.games_played).toBe(2);
    expect(result.today_progress.gamesPlayed).toBe(2);
    expect(result.todayProgress.gamesPlayed).toBe(2);
    expect(result.today_progress.card_tap_count).toBe(2);
    expect(result.today_progress.cardTapCount).toBe(2);
    expect(result.todayProgress.cardTapCount).toBe(2);
    expect(result.today_progress.ai_interaction_count).toBe(3);
    expect(result.today_progress.aiInteractionCount).toBe(3);
    expect(result.todayProgress.aiInteractionCount).toBe(3);
  });

  it('uses today RFID tap logs for card progress when toy analytics card starts are missing', async () => {
    prisma.sys_user.findUnique.mockResolvedValue({ id: 117n, firebase_uid: 'firebase-user-117' });
    prisma.ai_device.findMany.mockResolvedValue([
      { id: 'device-1', mac_address: 'FC:01:2C:CF:EB:54', agent_id: 'agent-1' }
    ]);
    prisma.rfid_card_tap_log.findMany.mockResolvedValue([]);
    prisma.rfid_card_tap_log.count.mockResolvedValue(4);
    prisma.device_analytics_event.findMany.mockResolvedValue([]);

    const result = await mobileService.getHomepageActivity('firebase-user-117', {
      now: new Date('2026-05-19T10:00:00.000Z')
    });

    expect(prisma.rfid_card_tap_log.count).toHaveBeenCalledWith({
      where: {
        OR: [
          { user_id: 117n },
          { mac_address: { in: ['FC:01:2C:CF:EB:54'] } }
        ],
        created_at: {
          gte: new Date('2026-05-18T18:30:00.000Z'),
          lte: new Date('2026-05-19T18:29:59.999Z')
        }
      }
    });
    expect(result.today_progress.card_tap_count).toBe(4);
    expect(result.todayProgress.cardTapCount).toBe(4);
  });

  it('uses today AI RFID tap logs for AI progress when toy analytics AI starts are missing', async () => {
    prisma.sys_user.findUnique.mockResolvedValue({ id: 117n, firebase_uid: 'firebase-user-117' });
    prisma.ai_device.findMany.mockResolvedValue([
      { id: 'device-1', mac_address: 'FC:01:2C:CF:EB:54', agent_id: 'agent-1' }
    ]);
    prisma.rfid_card_tap_log.findMany.mockResolvedValue([]);
    prisma.rfid_card_tap_log.count
      .mockResolvedValueOnce(16)
      .mockResolvedValueOnce(1);
    prisma.device_analytics_event.findMany.mockResolvedValue([]);

    const result = await mobileService.getHomepageActivity('firebase-user-117', {
      now: new Date('2026-05-19T10:00:00.000Z')
    });

    expect(prisma.rfid_card_tap_log.count).toHaveBeenNthCalledWith(2, {
      where: {
        OR: [
          { user_id: 117n },
          { mac_address: { in: ['FC:01:2C:CF:EB:54'] } }
        ],
        card_type: 'ai',
        created_at: {
          gte: new Date('2026-05-18T18:30:00.000Z'),
          lte: new Date('2026-05-19T18:29:59.999Z')
        }
      }
    });
    expect(result.today_progress.card_tap_count).toBe(16);
    expect(result.today_progress.ai_interaction_count).toBe(1);
    expect(result.todayProgress.aiInteractionCount).toBe(1);
  });

  it('normalizes device mac addresses before reading today toy analytics', async () => {
    prisma.sys_user.findUnique.mockResolvedValue({ id: 1n, firebase_uid: 'firebase-user-1' });
    prisma.ai_device.findMany.mockResolvedValue([
      { id: 'device-1', mac_address: 'aa-bb-cc-dd-ee-ff', agent_id: 'agent-1' }
    ]);
    prisma.rfid_card_tap_log.findMany.mockResolvedValue([]);
    prisma.device_analytics_event.findMany.mockResolvedValue([
      { event_name: 'card_session_start', duration_ms: null }
    ]);

    const result = await mobileService.getHomepageActivity('firebase-user-1', {
      now: new Date('2026-05-13T10:00:00.000Z')
    });

    expect(prisma.device_analytics_event.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        mac_address: { in: ['AA:BB:CC:DD:EE:FF'] }
      })
    }));
    expect(result.today_progress.card_tap_count).toBe(1);
  });
});

describe('mobile.service homepage activity details', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    prisma.kid_profile.findFirst.mockResolvedValue(null);
    prisma.ai_device.findMany.mockResolvedValue([
      { id: 'device-1', mac_address: 'AA:BB:CC:DD:EE:FF', agent_id: 'agent-1' }
    ]);
    prisma.rfid_content_pack.findMany.mockResolvedValue([]);
    prisma.analytics_media_playback.findMany.mockResolvedValue([]);
    prisma.analytics_game_sessions.findMany.mockResolvedValue([]);
    prisma.device_analytics_event.findMany.mockResolvedValue([]);
    prisma.ai_agent_chat_history.findMany.mockResolvedValue([]);
    prisma.ai_agent_chat_history.count.mockResolvedValue(0);
    prisma.rfid_card_tap_log.findMany.mockResolvedValue([]);
    prisma.rfid_card_mapping.findMany.mockResolvedValue([]);
  });

  it.each([
    ['week', (() => {
      const start = new Date('2026-05-16T10:00:00.000Z');
      start.setDate(1);
      start.setHours(0, 0, 0, 0);
      return start;
    })()],
    ['month', (() => {
      const start = new Date('2026-05-16T10:00:00.000Z');
      start.setDate(1);
      start.setHours(0, 0, 0, 0);
      start.setMonth(start.getMonth() - 11);
      return start;
    })()]
  ])('returns games detail for period=%s', async (period, expectedStart) => {
    prisma.sys_user.findUnique.mockResolvedValue({ id: 1n, firebase_uid: 'firebase-user-1' });
    prisma.device_analytics_event.findMany.mockResolvedValue([
      { event_name: 'game_start', game_id: 'math_tutor', data: { game_name: 'Math Tutor' } },
      { event_name: 'game_start', game_id: 'math_tutor', data: { game_name: 'Math Tutor' } },
      { event_name: 'game_start', game_id: 'riddle_solver', data: {} },
      { event_name: 'game_start', game_id: 'ANIMAL', data: { game_id: 'ANIMAL' } },
      { event_name: 'game_end', game_id: 'math_tutor', data: {} }
    ]);

    const result = await mobileService.getHomepageActivityDetails('firebase-user-1', {
      metric: 'games',
      period,
      now: new Date('2026-05-16T10:00:00.000Z')
    });

    expect(prisma.device_analytics_event.findMany).toHaveBeenCalledWith({
      where: {
        mac_address: { in: ['AA:BB:CC:DD:EE:FF'] },
        server_received_at: {
          gte: expectedStart,
          lte: new Date('2026-05-16T10:00:00.000Z')
        }
      },
      select: expect.objectContaining({
        event_name: true,
        game_id: true,
        data: true
      }),
      orderBy: { server_received_at: 'asc' },
      take: 5000
    });
    expect(result).toMatchObject({
      metric: 'games',
      period,
      total: 4,
      items: [
        { name: 'Math Tutor', key: 'math_tutor', count: 2 },
        { name: 'Riddle Solver', key: 'riddle_solver', count: 1 },
        { name: 'Animal', key: 'ANIMAL', count: 1 }
      ]
    });
  });

  it.each(['week', 'month'])('returns cards detail for period=%s', async (period) => {
    prisma.sys_user.findUnique.mockResolvedValue({ id: 1n, firebase_uid: 'firebase-user-1' });
    prisma.device_analytics_event.findMany.mockResolvedValue([
      { event_name: 'card_session_start', rfid_uid: 'CARD123', content_id: null, data: {} },
      { event_name: 'card_session_start', rfid_uid: 'CARD123', content_id: null, data: {} },
      { event_name: 'card_session_start', rfid_uid: 'CARD456', content_id: null, data: { card_name: 'Alphabet Card' } },
      { event_name: 'ai_talk_start', rfid_uid: 'CARD123', data: {} }
    ]);
    prisma.rfid_card_mapping.findMany.mockResolvedValue([
      {
        rfid_uid: 'CARD123',
        rfid_content_pack: { name: 'Lion Card' },
        rfid_question: null,
        rfid_pack: null
      }
    ]);

    const result = await mobileService.getHomepageActivityDetails('firebase-user-1', {
      metric: 'cards',
      period,
      now: new Date('2026-05-16T10:00:00.000Z')
    });

    expect(prisma.rfid_card_mapping.findMany).toHaveBeenCalledWith({
      where: { rfid_uid: { in: ['CARD123', 'CARD456'] } },
      select: {
        rfid_uid: true,
        rfid_content_pack: { select: { name: true } },
        rfid_question: { select: { title: true } },
        rfid_pack: { select: { pack_name: true } }
      }
    });
    expect(result).toMatchObject({
      metric: 'cards',
      period,
      total: 3,
      items: [
        { name: 'Lion Card', key: 'CARD123', count: 2 },
        { name: 'Alphabet Card', key: 'CARD456', count: 1 }
      ]
    });
  });

  it.each(['week', 'month'])('returns ai interaction detail for period=%s', async (period) => {
    prisma.sys_user.findUnique.mockResolvedValue({ id: 1n, firebase_uid: 'firebase-user-1' });
    prisma.device_analytics_event.findMany.mockResolvedValue([
      { event_name: 'ai_talk_start', rfid_uid: 'AI123', data: {} },
      { event_name: 'ai_talk_start', rfid_uid: 'AI123', data: {} },
      { event_name: 'ai_talk_start', rfid_uid: 'AI456', data: { card_name: 'Story AI' } },
      { event_name: 'ai_talk_end', rfid_uid: 'AI123', data: {} },
      { event_name: 'card_session_start', rfid_uid: 'AI123', data: {} }
    ]);
    prisma.rfid_card_mapping.findMany.mockResolvedValue([
      {
        rfid_uid: 'AI123',
        rfid_content_pack: { name: 'Cheeko Chat' },
        rfid_question: null,
        rfid_pack: null
      }
    ]);

    const result = await mobileService.getHomepageActivityDetails('firebase-user-1', {
      metric: 'ai_interaction',
      period,
      now: new Date('2026-05-16T10:00:00.000Z')
    });

    expect(prisma.rfid_card_mapping.findMany).toHaveBeenCalledWith({
      where: { rfid_uid: { in: ['AI123', 'AI456'] } },
      select: {
        rfid_uid: true,
        rfid_content_pack: { select: { name: true } },
        rfid_question: { select: { title: true } },
        rfid_pack: { select: { pack_name: true } }
      }
    });
    expect(result).toMatchObject({
      metric: 'ai_interaction',
      period,
      total: 3,
      items: [
        { name: 'Cheeko Chat', key: 'AI123', count: 2 },
        { name: 'Story AI', key: 'AI456', count: 1 }
      ]
    });
  });

  it('returns month sections from current month backwards', async () => {
    prisma.sys_user.findUnique.mockResolvedValue({ id: 1n, firebase_uid: 'firebase-user-1' });
    prisma.device_analytics_event.findMany.mockResolvedValue([
      {
        event_name: 'card_session_start',
        rfid_uid: 'MAY123',
        server_received_at: new Date('2026-05-10T08:00:00.000Z'),
        data: {}
      },
      {
        event_name: 'card_session_start',
        rfid_uid: 'APR123',
        server_received_at: new Date('2026-04-10T08:00:00.000Z'),
        data: {}
      },
      {
        event_name: 'card_session_start',
        rfid_uid: 'MAY123',
        server_received_at: new Date('2026-05-11T08:00:00.000Z'),
        data: {}
      }
    ]);
    prisma.rfid_card_mapping.findMany.mockResolvedValue([
      {
        rfid_uid: 'MAY123',
        rfid_content_pack: { name: 'May Card' },
        rfid_question: null,
        rfid_pack: null
      },
      {
        rfid_uid: 'APR123',
        rfid_content_pack: { name: 'April Card' },
        rfid_question: null,
        rfid_pack: null
      }
    ]);

    const result = await mobileService.getHomepageActivityDetails('firebase-user-1', {
      metric: 'cards',
      period: 'month',
      now: new Date('2026-05-16T10:00:00.000Z')
    });

    expect(result.month_sections).toEqual([
      {
        label: 'May, 2026',
        month: '2026-05',
        total: 2,
        items: [
          { name: 'May Card', key: 'MAY123', count: 2 }
        ]
      },
      {
        label: 'April, 2026',
        month: '2026-04',
        total: 1,
        items: [
          { name: 'April Card', key: 'APR123', count: 1 }
        ]
      }
    ]);
    expect(result.monthSections).toEqual(result.month_sections);
  });

  it('returns current month week sections for period=week', async () => {
    prisma.sys_user.findUnique.mockResolvedValue({ id: 1n, firebase_uid: 'firebase-user-1' });
    prisma.device_analytics_event.findMany.mockResolvedValue([
      {
        event_name: 'card_session_start',
        rfid_uid: 'WEEK1',
        server_received_at: new Date('2026-05-02T08:00:00.000Z'),
        data: {}
      },
      {
        event_name: 'card_session_start',
        rfid_uid: 'WEEK2',
        server_received_at: new Date('2026-05-09T08:00:00.000Z'),
        data: {}
      },
      {
        event_name: 'card_session_start',
        rfid_uid: 'WEEK2',
        server_received_at: new Date('2026-05-10T08:00:00.000Z'),
        data: {}
      },
      {
        event_name: 'card_session_start',
        rfid_uid: 'APRIL',
        server_received_at: new Date('2026-04-30T08:00:00.000Z'),
        data: {}
      }
    ]);
    prisma.rfid_card_mapping.findMany.mockResolvedValue([
      {
        rfid_uid: 'WEEK1',
        rfid_content_pack: { name: 'Week One Card' },
        rfid_question: null,
        rfid_pack: null
      },
      {
        rfid_uid: 'WEEK2',
        rfid_content_pack: { name: 'Week Two Card' },
        rfid_question: null,
        rfid_pack: null
      }
    ]);

    const result = await mobileService.getHomepageActivityDetails('firebase-user-1', {
      metric: 'cards',
      period: 'week',
      now: new Date('2026-05-16T10:00:00.000Z')
    });

    expect(prisma.device_analytics_event.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        server_received_at: {
          gte: expect.any(Date),
          lte: new Date('2026-05-16T10:00:00.000Z')
        }
      })
    }));
    expect(prisma.device_analytics_event.findMany.mock.calls[0][0].where.server_received_at.gte.getDate()).toBe(1);
    expect(result.period_label).toBe('May, 2026');
    expect(result.periodLabel).toBe('May, 2026');
    expect(result.week_sections).toEqual([
      {
        label: 'Week 1',
        week: 1,
        total: 1,
        items: [
          { name: 'Week One Card', key: 'WEEK1', count: 1 }
        ]
      },
      {
        label: 'Week 2',
        week: 2,
        total: 2,
        items: [
          { name: 'Week Two Card', key: 'WEEK2', count: 2 }
        ]
      }
    ]);
    expect(result.weekSections).toEqual(result.week_sections);
  });

  it('returns enabled month tiles from first activity month through current month', async () => {
    prisma.sys_user.findUnique.mockResolvedValue({ id: 1n, firebase_uid: 'firebase-user-1' });
    prisma.device_analytics_event.findMany.mockResolvedValue([
      {
        event_name: 'card_session_start',
        rfid_uid: 'MAY123',
        server_received_at: new Date('2026-05-11T08:00:00.000Z'),
        data: {}
      },
      {
        event_name: 'card_session_start',
        rfid_uid: 'JUN123',
        server_received_at: new Date('2026-06-01T08:00:00.000Z'),
        data: {}
      }
    ]);

    const result = await mobileService.getHomepageActivityDetails('firebase-user-1', {
      metric: 'cards',
      period: 'month',
      now: new Date('2026-06-01T10:00:00.000Z')
    });

    expect(result.year).toBe(2026);
    expect(result.first_activity_month).toBe('2026-05');
    expect(result.current_month).toBe('2026-06');
    expect(result.months).toHaveLength(12);
    expect(result.months[0]).toMatchObject({
      label: 'January',
      month: '2026-01',
      enabled: false,
      is_current: false,
      isCurrent: false
    });
    expect(result.months[4]).toMatchObject({
      label: 'May',
      month: '2026-05',
      enabled: true,
      is_current: false,
      isCurrent: false
    });
    expect(result.months[5]).toMatchObject({
      label: 'June',
      month: '2026-06',
      enabled: true,
      is_current: true,
      isCurrent: true
    });
    expect(result.months[6]).toMatchObject({
      label: 'July',
      month: '2026-07',
      enabled: false,
      is_current: false,
      isCurrent: false
    });
  });

  it('returns week sections for the selected month', async () => {
    prisma.sys_user.findUnique.mockResolvedValue({ id: 1n, firebase_uid: 'firebase-user-1' });
    prisma.device_analytics_event.findMany.mockResolvedValue([
      {
        event_name: 'card_session_start',
        rfid_uid: 'MAY123',
        server_received_at: new Date('2026-05-11T08:00:00.000Z'),
        data: {}
      }
    ]);
    prisma.rfid_card_mapping.findMany.mockResolvedValue([
      {
        rfid_uid: 'MAY123',
        rfid_content_pack: { name: 'May Card' },
        rfid_question: null,
        rfid_pack: null
      }
    ]);

    const result = await mobileService.getHomepageActivityDetails('firebase-user-1', {
      metric: 'cards',
      period: 'week',
      month: '2026-05',
      now: new Date('2026-07-01T10:00:00.000Z')
    });

    const range = prisma.device_analytics_event.findMany.mock.calls[0][0].where.server_received_at;
    expect(range.gte.getFullYear()).toBe(2026);
    expect(range.gte.getMonth()).toBe(4);
    expect(range.gte.getDate()).toBe(1);
    expect(range.gte.getHours()).toBe(0);
    expect(range.lte.getFullYear()).toBe(2026);
    expect(range.lte.getMonth()).toBe(4);
    expect(range.lte.getDate()).toBe(31);
    expect(range.lte.getHours()).toBe(23);
    expect(result.period_label).toBe('May, 2026');
    expect(result.week_sections).toEqual([
      {
        label: 'Week 2',
        week: 2,
        total: 1,
        items: [
          { name: 'May Card', key: 'MAY123', count: 1 }
        ]
      }
    ]);
  });

  it.each(['week', 'month'])('returns usage detail for period=%s', async (period) => {
    prisma.sys_user.findUnique.mockResolvedValue({ id: 1n, firebase_uid: 'firebase-user-1' });
    prisma.device_analytics_event.findMany.mockResolvedValue([
      { event_name: 'game_end', duration_ms: 1200000, game_id: 'math_tutor', rfid_uid: null, content_id: null, station: null, data: {} },
      { event_name: 'card_session_end', duration_ms: 600000, game_id: null, rfid_uid: 'CARD123', content_id: null, station: null, data: {} },
      { event_name: 'radio_end', duration_ms: 300000, game_id: null, rfid_uid: null, content_id: null, station: 'Fun Radio', data: {} },
      { event_name: 'ai_talk_end', duration_ms: 0, game_id: null, rfid_uid: null, content_id: null, station: null, data: {} },
      { event_name: 'game_end', duration_ms: -1000, game_id: 'riddle_solver', rfid_uid: null, content_id: null, station: null, data: {} }
    ]);
    prisma.rfid_card_mapping.findMany.mockResolvedValue([
      {
        rfid_uid: 'CARD123',
        rfid_content_pack: { name: 'Lion Card' },
        rfid_question: null,
        rfid_pack: null
      }
    ]);

    const result = await mobileService.getHomepageActivityDetails('firebase-user-1', {
      metric: 'usage',
      period,
      now: new Date('2026-05-16T10:00:00.000Z')
    });

    expect(result).toMatchObject({
      metric: 'usage',
      period,
      total_seconds: 2100,
      totalSeconds: 2100,
      items: [
        { name: 'Math Tutor', key: 'math_tutor', duration_seconds: 1200, durationSeconds: 1200 },
        { name: 'Lion Card', key: 'CARD123', duration_seconds: 600, durationSeconds: 600 },
        { name: 'Fun Radio', key: 'radio:Fun Radio', duration_seconds: 300, durationSeconds: 300 }
      ]
    });
  });

  it('rejects invalid metric', async () => {
    prisma.sys_user.findUnique.mockResolvedValue({ id: 1n, firebase_uid: 'firebase-user-1' });

    await expect(mobileService.getHomepageActivityDetails('firebase-user-1', {
      metric: 'ai',
      period: 'week'
    })).rejects.toMatchObject({ statusCode: 400, message: 'metric must be one of: games, usage, cards, ai_interaction' });
  });

  it('rejects invalid period', async () => {
    prisma.sys_user.findUnique.mockResolvedValue({ id: 1n, firebase_uid: 'firebase-user-1' });

    await expect(mobileService.getHomepageActivityDetails('firebase-user-1', {
      metric: 'games',
      period: 'year'
    })).rejects.toMatchObject({ statusCode: 400, message: 'period must be one of: week, month' });
  });

  it('rejects unauthorized user', async () => {
    prisma.sys_user.findUnique.mockResolvedValue(null);

    await expect(mobileService.getHomepageActivityDetails('firebase-user-1', {
      metric: 'games',
      period: 'week'
    })).rejects.toMatchObject({ statusCode: 403, message: 'Access denied' });
  });

  it('rejects a device mac not owned by the user', async () => {
    prisma.sys_user.findUnique.mockResolvedValue({ id: 1n, firebase_uid: 'firebase-user-1' });
    prisma.ai_device.findMany.mockResolvedValue([
      { id: 'device-1', mac_address: 'AA:BB:CC:DD:EE:FF', agent_id: 'agent-1' }
    ]);

    await expect(mobileService.getHomepageActivityDetails('firebase-user-1', {
      metric: 'games',
      period: 'week',
      mac: '11:22:33:44:55:66'
    })).rejects.toMatchObject({ statusCode: 404, message: 'Device not found' });
  });

  it('returns empty totals when there are no analytics events', async () => {
    prisma.sys_user.findUnique.mockResolvedValue({ id: 1n, firebase_uid: 'firebase-user-1' });
    prisma.device_analytics_event.findMany.mockResolvedValue([]);

    const result = await mobileService.getHomepageActivityDetails('firebase-user-1', {
      metric: 'usage',
      period: 'week',
      now: new Date('2026-05-16T10:00:00.000Z')
    });

    expect(result).toMatchObject({
      metric: 'usage',
      period: 'week',
      total_seconds: 0,
      totalSeconds: 0,
      items: []
    });
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
    prisma.rfid_content_pack.findMany.mockResolvedValue([]);
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

  it('uses RFID content-card packs instead of music content library cards', async () => {
    prisma.content_library.findMany.mockResolvedValue([
      {
        id: 99n,
        title: 'Music Library Song',
        content_type: 'music',
        category: 'Songs',
        status: 1
      }
    ]);
    prisma.rfid_content_pack.findMany.mockResolvedValue([
      {
        id: 7n,
        pack_code: 'ANIMAL-CARD',
        name: 'Animal Content Card',
        description: 'RFID content card pack',
        content_type: 'story',
        thumbnail_url: 'https://example.com/content-card.png',
        total_items: 3,
        language: 'en',
        active: true,
        status: 'active',
        create_date: new Date('2026-05-10T00:00:00.000Z')
      }
    ]);

    const result = await mobileService.getHomepageRecommendations('firebase-user-1', {
      kidId: '10',
      limit: 4
    });

    expect(prisma.content_library.findMany).not.toHaveBeenCalled();
    expect(result.items).toEqual(expect.arrayContaining([
      expect.objectContaining({
        itemType: 'content',
        id: '7',
        contentId: '7',
        title: 'Animal Content Card',
        contentType: 'story',
        category: 'RFID Content Card',
        packCode: 'ANIMAL-CARD'
      })
    ]));
    expect(result.items.map(item => item.title)).not.toContain('Music Library Song');
  });

  it('returns first-time preference-based content and AI cards', async () => {
    prisma.rfid_content_pack.findMany.mockResolvedValue([
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
    expect(result.recommendationSource).toBe('profile');
  });

  it('rewrites stale Supabase thumbnail hosts to the configured project host', async () => {
    const previousSupabaseUrl = process.env.SUPABASE_URL;
    process.env.SUPABASE_URL = 'https://uprqkyiwuqribhfxzwhd.supabase.co';
    prisma.rfid_content_pack.findMany.mockResolvedValue([
      {
        id: 1n,
        title: 'Learning ABC',
        content_type: 'music',
        category: 'Alphabet',
        thumbnail_url: 'https://popppjirsdedxhetcphs.supabase.co/storage/v1/object/public/songs_thumbnails/learning%20abc.png',
        duration_seconds: 120,
        language: 'en',
        tags: ['abc'],
        age_min: 3,
        age_max: 6,
        status: 1,
        created_at: new Date('2026-05-10T00:00:00.000Z')
      }
    ]);

    try {
      const result = await mobileService.getHomepageRecommendations('firebase-user-1', {
        kidId: '10',
        limit: 1
      });

      expect(result.items[0].thumbnailUrl).toBe(
        'https://uprqkyiwuqribhfxzwhd.supabase.co/storage/v1/object/public/songs_thumbnails/learning%20abc.png'
      );
    } finally {
      process.env.SUPABASE_URL = previousSupabaseUrl;
    }
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
    prisma.rfid_content_pack.findMany.mockResolvedValue([
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
    expect(result.recommendationSource).toBe('personalized');
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
    prisma.rfid_content_pack.findMany.mockResolvedValue([
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
    prisma.rfid_content_pack.findMany.mockResolvedValue([
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

  it('returns safe default backend content and AI cards when there is no history and no preferences', async () => {
    prisma.kid_profile.findFirst.mockResolvedValue({
      id: 10n,
      user_id: 1n,
      name: 'Aditi',
      birth_date: null,
      interests: [],
      language: null,
      preferences: {}
    });
    prisma.rfid_content_pack.findMany.mockResolvedValue([
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

    expect(result.recommendationSource).toBe('default');
    expect(result.items).toEqual(expect.arrayContaining([
      expect.objectContaining({
        itemType: 'content',
        id: '44',
        title: 'Bedtime Story',
        subtitle: 'Popular content card'
      }),
      expect.objectContaining({
        itemType: 'ai',
        subtitle: 'Try a Cheeko AI experience'
      })
    ]));
  });

  it('keeps an AI card in default recommendations even when content fills the limit', async () => {
    prisma.kid_profile.findFirst.mockResolvedValue({
      id: 10n,
      user_id: 1n,
      name: 'Aditi',
      birth_date: null,
      interests: [],
      language: null,
      preferences: {}
    });
    prisma.rfid_content_pack.findMany.mockResolvedValue(
      Array.from({ length: 10 }, (_, index) => ({
        id: BigInt(index + 1),
        title: `Default Content ${index + 1}`,
        content_type: 'music',
        category: 'General',
        language: 'en',
        status: 1,
        created_at: new Date(`2026-05-${String(index + 1).padStart(2, '0')}T00:00:00.000Z`)
      }))
    );

    const result = await mobileService.getHomepageRecommendations('firebase-user-1', {
      kidId: '10',
      limit: 8
    });

    expect(result.items).toHaveLength(8);
    expect(result.recommendationSource).toBe('default');
    expect(result.items.some(item => item.itemType === 'content')).toBe(true);
    expect(result.items.some(item => item.itemType === 'ai')).toBe(true);
  });
});
