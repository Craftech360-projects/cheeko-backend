'use strict';

jest.mock('../../src/config/database', () => ({
  prisma: {
    sys_user: {
      findUnique: jest.fn()
    },
    parent_profile: {
      upsert: jest.fn(),
      update: jest.fn(),
      findUnique: jest.fn()
    },
    ai_device: {
      findMany: jest.fn(),
      findUnique: jest.fn()
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
      findMany: jest.fn(),
      findFirst: jest.fn()
    },
    device_usage_daily: {
      findMany: jest.fn()
    },
    device_card_taps_daily: {
      findMany: jest.fn()
    },
    device_ai_interactions_daily: {
      findMany: jest.fn()
    },
    device_games_played: {
      findMany: jest.fn(),
      count: jest.fn()
    },
    device_radio_played: {
      findMany: jest.fn(),
      count: jest.fn()
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
    prisma.ai_device.findUnique.mockResolvedValue(null);
    prisma.parent_profile.findUnique.mockResolvedValue(null);
    prisma.rfid_content_pack.findMany.mockResolvedValue([]);
    prisma.analytics_media_playback.findMany.mockResolvedValue([]);
    prisma.analytics_game_sessions.findMany.mockResolvedValue([]);
    prisma.device_analytics_event.findMany.mockResolvedValue([]);
    prisma.device_analytics_event.findFirst.mockResolvedValue(null);
    prisma.device_usage_daily.findMany.mockResolvedValue([]);
    prisma.device_card_taps_daily.findMany.mockResolvedValue([]);
    prisma.device_ai_interactions_daily.findMany.mockResolvedValue([]);
    prisma.device_analytics_event.findMany.mockResolvedValue([]);
    prisma.rfid_card_mapping.findMany.mockResolvedValue([]);
    prisma.device_games_played.findMany.mockResolvedValue([]);
    prisma.device_games_played.count.mockResolvedValue(0);
    prisma.device_radio_played.findMany.mockResolvedValue([]);
    prisma.device_radio_played.count.mockResolvedValue(0);
    prisma.ai_agent_chat_history.findMany.mockResolvedValue([]);
    prisma.ai_agent_chat_history.count.mockResolvedValue(0);
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
    prisma.sys_user.findUnique.mockResolvedValue({
      id: 1n,
      firebase_uid: 'firebase-user-1',
      parent_profile: { timezone: 'UTC' }
    });
    prisma.ai_device.findMany.mockResolvedValue([
      { id: 'device-1', mac_address: 'AA:BB:CC:DD:EE:FF', agent_id: 'agent-1' }
    ]);
    prisma.device_usage_daily.findMany.mockResolvedValue([]);
    prisma.device_card_taps_daily.findMany.mockResolvedValue([]);
    prisma.device_ai_interactions_daily.findMany.mockResolvedValue([
      { ai_interaction_count: 3 }
    ]);
    prisma.device_games_played.count.mockResolvedValue(0);
    prisma.device_analytics_event.findMany.mockResolvedValue([
      {
        id: 'evt-99',
        mac_address: 'AA:BB:CC:DD:EE:FF',
        rfid_uid: 'ABC123',
        content_type: 'content',
        content_id: '5',
        data: {
          content_pack_code: 'STORY001',
          content_pack_name: 'Bedtime Story'
        },
        server_received_at: new Date('2026-05-12T18:00:00.000Z')
      }
    ]);

    const result = await mobileService.getHomepageActivity('firebase-user-1', {
      now: new Date('2026-05-13T10:00:00.000Z')
    });

    expect(prisma.device_ai_interactions_daily.findMany).toHaveBeenCalledWith({
      where: {
        mac_address: { in: ['AA:BB:CC:DD:EE:FF'] },
        date: {
          gte: new Date('2026-05-13T00:00:00.000Z'),
          lte: new Date('2026-05-13T00:00:00.000Z')
        }
      },
      select: {
        ai_interaction_count: true
      }
    });
    expect(prisma.rfid_card_tap_log.findFirst).not.toHaveBeenCalled();
    expect(result.today_progress.card_tap_count).toBe(0);
    expect(result.today_progress.ai_interaction_count).toBe(3);
    expect(result.today_progress.aiInteractionCount).toBe(3);
    expect(result.todayProgress.aiInteractionCount).toBe(3);
    expect(result.today_progress.date).toBe('2026-05-13');
    expect(result.recent_activity.rfid_uid).toBe('ABC123');
    expect(result.recent_activity.content_pack_name).toBe('Bedtime Story');
    expect(result.recent_activities).toHaveLength(1);
  });

  it('returns the latest three unique named card activities', async () => {
    prisma.sys_user.findUnique.mockResolvedValue({
      id: 1n,
      firebase_uid: 'firebase-user-1',
      parent_profile: { timezone: 'UTC' }
    });
    prisma.ai_device.findMany.mockResolvedValue([
      { id: 'device-1', mac_address: 'AA:BB:CC:DD:EE:FF', agent_id: 'agent-1' }
    ]);
    prisma.device_usage_daily.findMany.mockResolvedValue([]);
    prisma.device_card_taps_daily.findMany.mockResolvedValue([]);
    prisma.device_ai_interactions_daily.findMany.mockResolvedValue([]);
    prisma.device_games_played.count.mockResolvedValue(0);
    prisma.device_analytics_event.findMany.mockResolvedValue([
      {
        id: 'evt-4',
        mac_address: 'AA:BB:CC:DD:EE:FF',
        rfid_uid: 'E91c3e0e',
        content_type: 'content',
        data: {},
        server_received_at: new Date('2026-05-13T09:00:00.000Z')
      },
      {
        id: 'evt-3',
        mac_address: 'AA:BB:CC:DD:EE:FF',
        rfid_uid: 'E91C3E0E',
        content_type: 'content',
        data: {},
        server_received_at: new Date('2026-05-13T08:00:00.000Z')
      },
      {
        id: 'evt-2',
        mac_address: 'AA:BB:CC:DD:EE:FF',
        rfid_uid: '59be430e',
        content_type: 'content',
        data: {},
        server_received_at: new Date('2026-05-13T07:00:00.000Z')
      },
      {
        id: 'evt-1',
        mac_address: 'AA:BB:CC:DD:EE:FF',
        rfid_uid: 'CARD789',
        content_type: 'content',
        data: { content_pack_name: 'Fallback Name' },
        server_received_at: new Date('2026-05-13T06:00:00.000Z')
      }
    ]);
    prisma.rfid_card_mapping.findMany.mockResolvedValue([
      {
        rfid_uid: 'e91c3e0e',
        card_type: 'ai',
        action_data: { agent_name: 'Cheeko AI' },
        rfid_content_pack: null,
        rfid_question: null,
        rfid_pack: null
      },
      {
        rfid_uid: '59be430e',
        card_type: 'content',
        action_data: {},
        rfid_content_pack: { name: 'Numbers' },
        rfid_question: null,
        rfid_pack: null
      }
    ]);

    const result = await mobileService.getHomepageActivity('firebase-user-1', {
      now: new Date('2026-05-13T10:00:00.000Z')
    });

    expect(result.recent_activities).toHaveLength(3);
    expect(result.recent_activities.map(activity => activity.content_pack_name)).toEqual([
      'Cheeko AI',
      'Numbers',
      'Fallback Name'
    ]);
    expect(result.recent_activities.map(activity => activity.rfid_uid)).toEqual([
      'E91c3e0e',
      '59be430e',
      'CARD789'
    ]);
    expect(result.recent_activity.content_pack_name).toBe('Cheeko AI');
    const recentActivityQuery = prisma.device_analytics_event.findMany.mock.calls
      .map(call => call[0])
      .find(query => query?.where?.event_name === 'card_session_start' && query?.take);
    expect(recentActivityQuery.take).toBeGreaterThanOrEqual(150);
  });

  it('returns a same-day AI moment chosen from device analytics events', async () => {
    prisma.sys_user.findUnique.mockResolvedValue({
      id: 1n,
      firebase_uid: 'firebase-user-1',
      parent_profile: { timezone: 'UTC' }
    });
    prisma.ai_device.findMany.mockResolvedValue([
      { id: 'device-1', mac_address: 'AA:BB:CC:DD:EE:FF', agent_id: 'agent-1' }
    ]);
    prisma.device_usage_daily.findMany.mockResolvedValue([]);
    prisma.device_card_taps_daily.findMany.mockResolvedValue([]);
    prisma.device_ai_interactions_daily.findMany.mockResolvedValue([
      { ai_interaction_count: 2 }
    ]);
    prisma.device_games_played.count.mockResolvedValue(0);
    prisma.device_analytics_event.findMany.mockImplementation(query => {
      if (query?.where?.event_name === 'card_session_start') {
        return Promise.resolve([
          {
            id: 'card-1',
            mac_address: 'AA:BB:CC:DD:EE:FF',
            rfid_uid: 'CARD-123',
            content_type: 'content',
            data: { content_pack_name: 'Filo in Space' },
            server_received_at: new Date('2026-05-13T09:00:00.000Z')
          }
        ]);
      }
      if (Array.isArray(query?.where?.event_name?.in)) {
        return Promise.resolve([
          {
            mac_address: 'AA:BB:CC:DD:EE:FF',
            event_name: 'ai_talk_start',
            server_received_at: new Date('2026-05-13T08:00:00.000Z'),
            event_timestamp: new Date('2026-05-13T08:00:00.000Z'),
            rfid_uid: 'AI-1',
            data: {
              child_text: 'Hi',
              device_reply: 'Hello there!'
            }
          },
          {
            mac_address: 'AA:BB:CC:DD:EE:FF',
            event_name: 'ai_talk_end',
            server_received_at: new Date('2026-05-13T08:01:00.000Z'),
            event_timestamp: new Date('2026-05-13T08:01:00.000Z'),
            rfid_uid: 'AI-1',
            data: {}
          },
          {
            mac_address: 'AA:BB:CC:DD:EE:FF',
            event_name: 'ai_talk_start',
            server_received_at: new Date('2026-05-13T09:30:00.000Z'),
            event_timestamp: new Date('2026-05-13T09:30:00.000Z'),
            rfid_uid: 'AI-2',
            data: {
              child_text: 'Why is the sky blue?',
              device_reply: 'Because light scatters in the atmosphere and blue light spreads the most.'
            }
          },
          {
            mac_address: 'AA:BB:CC:DD:EE:FF',
            event_name: 'ai_talk_end',
            server_received_at: new Date('2026-05-13T09:31:00.000Z'),
            event_timestamp: new Date('2026-05-13T09:31:00.000Z'),
            rfid_uid: 'AI-2',
            data: {}
          }
        ]);
      }
      return Promise.resolve([]);
    });
    prisma.rfid_card_mapping.findMany.mockResolvedValue([
      {
        rfid_uid: 'AI-1',
        card_type: 'ai',
        thumbnail_url: 'https://cdn.example.com/ai-1.png',
        action_data: { agent_name: 'Cheeko Magic' },
        rfid_content_pack: null,
        rfid_question: null,
        rfid_pack: null
      },
      {
        rfid_uid: 'AI-2',
        card_type: 'ai',
        thumbnail_url: 'https://cdn.example.com/ai-2.png',
        action_data: { agent_name: 'Cheeko Science' },
        rfid_content_pack: null,
        rfid_question: null,
        rfid_pack: null
      }
    ]);

    const result = await mobileService.getHomepageActivity('firebase-user-1', {
      now: new Date('2026-05-13T10:00:00.000Z')
    });

    expect(result.moment_of_the_day.question_text).toBe('Why is the sky blue?');
    expect(result.moment_of_the_day.reply_text).toContain('light scatters');
    expect(result.moment_of_the_day.image_url).toBe('https://cdn.example.com/ai-2.png');
  });

  it('does not fall back the homepage moment to card activity when no AI interaction exists that day', async () => {
    prisma.sys_user.findUnique.mockResolvedValue({
      id: 1n,
      firebase_uid: 'firebase-user-1',
      parent_profile: { timezone: 'UTC' }
    });
    prisma.ai_device.findMany.mockResolvedValue([
      { id: 'device-1', mac_address: 'AA:BB:CC:DD:EE:FF', agent_id: 'agent-1' }
    ]);
    prisma.device_usage_daily.findMany.mockResolvedValue([]);
    prisma.device_card_taps_daily.findMany.mockResolvedValue([
      { card_tap_count: 1 }
    ]);
    prisma.device_ai_interactions_daily.findMany.mockResolvedValue([]);
    prisma.device_games_played.count.mockResolvedValue(0);
    prisma.device_analytics_event.findMany.mockImplementation(query => {
      if (query?.where?.event_name === 'card_session_start') {
        return Promise.resolve([
          {
            id: 'card-1',
            mac_address: 'AA:BB:CC:DD:EE:FF',
            rfid_uid: 'CARD-123',
            content_type: 'content',
            data: { content_pack_name: 'Filo in Space' },
            server_received_at: new Date('2026-05-13T09:00:00.000Z')
          }
        ]);
      }
      if (Array.isArray(query?.where?.event_name?.in)) {
        return Promise.resolve([]);
      }
      return Promise.resolve([]);
    });

    const result = await mobileService.getHomepageActivity('firebase-user-1', {
      now: new Date('2026-05-13T10:00:00.000Z')
    });

    expect(result.recent_activity.content_pack_name).toBe('Filo in Space');
    expect(result.moment_of_the_day).toBeNull();
  });

  it('returns three recent card activities without repeating the same pack title', async () => {
    prisma.sys_user.findUnique.mockResolvedValue({
      id: 1n,
      firebase_uid: 'firebase-user-1',
      parent_profile: { timezone: 'UTC' }
    });
    prisma.ai_device.findMany.mockResolvedValue([
      { id: 'device-1', mac_address: 'AA:BB:CC:DD:EE:FF', agent_id: 'agent-1' }
    ]);
    prisma.device_usage_daily.findMany.mockResolvedValue([]);
    prisma.device_card_taps_daily.findMany.mockResolvedValue([]);
    prisma.device_ai_interactions_daily.findMany.mockResolvedValue([]);
    prisma.device_games_played.count.mockResolvedValue(0);
    prisma.device_analytics_event.findMany.mockResolvedValue([
      {
        id: 'evt-5',
        mac_address: 'AA:BB:CC:DD:EE:FF',
        rfid_uid: 'SLOKA-CARD-2',
        content_type: 'content',
        data: {},
        server_received_at: new Date('2026-05-13T10:00:00.000Z')
      },
      {
        id: 'evt-4',
        mac_address: 'AA:BB:CC:DD:EE:FF',
        rfid_uid: 'SLOKA-CARD-1',
        content_type: 'content',
        data: {},
        server_received_at: new Date('2026-05-13T09:00:00.000Z')
      },
      {
        id: 'evt-3',
        mac_address: 'AA:BB:CC:DD:EE:FF',
        rfid_uid: 'PHONICS-CARD',
        content_type: 'content',
        data: {},
        server_received_at: new Date('2026-05-13T08:00:00.000Z')
      },
      {
        id: 'evt-2',
        mac_address: 'AA:BB:CC:DD:EE:FF',
        rfid_uid: 'SLOKA-CARD-1',
        content_type: 'content',
        data: {},
        server_received_at: new Date('2026-05-13T07:00:00.000Z')
      },
      {
        id: 'evt-1',
        mac_address: 'AA:BB:CC:DD:EE:FF',
        rfid_uid: 'EXTRA-CARD',
        content_type: 'content',
        data: {},
        server_received_at: new Date('2026-05-13T06:00:00.000Z')
      }
    ]);
    prisma.rfid_card_mapping.findMany.mockResolvedValue([
      {
        rfid_uid: 'SLOKA-CARD-2',
        card_type: 'content',
        thumbnail_url: 'https://cdn.example.com/cards/sloka-2.png',
        action_data: {},
        rfid_content_pack: { name: 'Slokas', thumbnail_url: null },
        rfid_question: null,
        rfid_pack: null
      },
      {
        rfid_uid: 'SLOKA-CARD-1',
        card_type: 'content',
        thumbnail_url: 'https://cdn.example.com/cards/sloka-1.png',
        action_data: {},
        rfid_content_pack: { name: 'Slokas', thumbnail_url: null },
        rfid_question: null,
        rfid_pack: null
      },
      {
        rfid_uid: 'PHONICS-CARD',
        card_type: 'content',
        thumbnail_url: null,
        action_data: {},
        rfid_content_pack: { name: 'Phonics', thumbnail_url: null },
        rfid_question: null,
        rfid_pack: null
      },
      {
        rfid_uid: 'EXTRA-CARD',
        card_type: 'content',
        thumbnail_url: null,
        action_data: {},
        rfid_content_pack: { name: 'Extra Card', thumbnail_url: null },
        rfid_question: null,
        rfid_pack: null
      }
    ]);

    const result = await mobileService.getHomepageActivity('firebase-user-1', {
      now: new Date('2026-05-13T11:00:00.000Z')
    });

    expect(result.recent_activities).toHaveLength(3);
    expect(result.recent_activities.map(activity => activity.content_pack_name)).toEqual([
      'Slokas',
      'Phonics',
      'Extra Card'
    ]);
    expect(result.recent_activities.map(activity => activity.rfid_uid)).toEqual([
      'SLOKA-CARD-2',
      'PHONICS-CARD',
      'EXTRA-CARD'
    ]);
  });

  it('returns card images for recent homepage activity from analytics event data', async () => {
    prisma.sys_user.findUnique.mockResolvedValue({
      id: 1n,
      firebase_uid: 'firebase-user-1',
      parent_profile: { timezone: 'UTC' }
    });
    prisma.ai_device.findMany.mockResolvedValue([
      { id: 'device-1', mac_address: 'AA:BB:CC:DD:EE:FF', agent_id: 'agent-1' }
    ]);
    prisma.device_usage_daily.findMany.mockResolvedValue([]);
    prisma.device_card_taps_daily.findMany.mockResolvedValue([]);
    prisma.device_ai_interactions_daily.findMany.mockResolvedValue([]);
    prisma.device_games_played.count.mockResolvedValue(0);
    prisma.device_analytics_event.findMany.mockResolvedValue([
      {
        id: 'evt-card-image',
        mac_address: 'AA:BB:CC:DD:EE:FF',
        rfid_uid: 'CARD-IMG-1',
        content_type: 'content',
        data: {
          content_pack_name: 'Animal Card',
          card_image_url: 'https://cdn.example.com/cards/animal.png'
        },
        server_received_at: new Date('2026-05-13T09:00:00.000Z')
      }
    ]);

    const result = await mobileService.getHomepageActivity('firebase-user-1', {
      now: new Date('2026-05-13T10:00:00.000Z')
    });

    expect(result.recent_activity.image_url).toBe('https://cdn.example.com/cards/animal.png');
    expect(result.recent_activity.imageUrl).toBe('https://cdn.example.com/cards/animal.png');
    expect(result.recent_activity.thumbnail_url).toBe('https://cdn.example.com/cards/animal.png');
    expect(result.recent_activity.thumbnailUrl).toBe('https://cdn.example.com/cards/animal.png');
  });

  it('returns card images for recent homepage activity from RFID mapping thumbnails', async () => {
    prisma.sys_user.findUnique.mockResolvedValue({
      id: 1n,
      firebase_uid: 'firebase-user-1',
      parent_profile: { timezone: 'UTC' }
    });
    prisma.ai_device.findMany.mockResolvedValue([
      { id: 'device-1', mac_address: 'AA:BB:CC:DD:EE:FF', agent_id: 'agent-1' }
    ]);
    prisma.device_usage_daily.findMany.mockResolvedValue([]);
    prisma.device_card_taps_daily.findMany.mockResolvedValue([]);
    prisma.device_ai_interactions_daily.findMany.mockResolvedValue([]);
    prisma.device_games_played.count.mockResolvedValue(0);
    prisma.device_analytics_event.findMany.mockResolvedValue([
      {
        id: 'evt-mapped-card-image',
        mac_address: 'AA:BB:CC:DD:EE:FF',
        rfid_uid: 'CARD-IMG-2',
        content_type: 'content',
        data: {},
        server_received_at: new Date('2026-05-13T09:00:00.000Z')
      }
    ]);
    prisma.rfid_card_mapping.findMany.mockResolvedValue([
      {
        rfid_uid: 'CARD-IMG-2',
        card_type: 'content',
        thumbnail_url: 'https://cdn.example.com/cards/mapped.png',
        action_data: {},
        rfid_content_pack: { name: 'Mapped Animal Card' },
        rfid_question: null,
        rfid_pack: null
      }
    ]);

    const result = await mobileService.getHomepageActivity('firebase-user-1', {
      now: new Date('2026-05-13T10:00:00.000Z')
    });

    expect(result.recent_activity.content_pack_name).toBe('Mapped Animal Card');
    expect(result.recent_activity.image_url).toBe('https://cdn.example.com/cards/mapped.png');
    expect(result.recent_activity.imageUrl).toBe('https://cdn.example.com/cards/mapped.png');
  });

  it('returns today device usage time and game count from toy analytics events', async () => {
    prisma.sys_user.findUnique.mockResolvedValue({
      id: 1n,
      firebase_uid: 'firebase-user-1',
      parent_profile: { timezone: 'UTC' }
    });
    prisma.ai_device.findMany.mockResolvedValue([
      { id: 'device-1', mac_address: 'AA:BB:CC:DD:EE:FF', agent_id: 'agent-1' }
    ]);
    prisma.device_usage_daily.findMany.mockResolvedValue([
      { usage_time_seconds: 200 }
    ]);
    prisma.device_card_taps_daily.findMany.mockResolvedValue([
      { card_tap_count: 2 }
    ]);
    prisma.device_ai_interactions_daily.findMany.mockResolvedValue([
      { ai_interaction_count: 3 }
    ]);
    prisma.device_games_played.count.mockResolvedValue(2);
    prisma.device_analytics_event.findFirst.mockResolvedValue(null);

    const result = await mobileService.getHomepageActivity('firebase-user-1', {
      now: new Date('2026-05-13T10:00:00.000Z')
    });

    expect(result.today_progress.usage_time_seconds).toBe(180);
    expect(result.today_progress.usageTimeSeconds).toBe(180);
    expect(result.todayProgress.usageTimeSeconds).toBe(180);
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

  it('falls back to raw game_start events when games projection is empty', async () => {
    prisma.sys_user.findUnique.mockResolvedValue({
      id: 1n,
      firebase_uid: 'firebase-user-1',
      parent_profile: { timezone: 'UTC' }
    });
    prisma.ai_device.findMany.mockResolvedValue([
      { id: 'device-1', mac_address: 'AA:BB:CC:DD:EE:FF', agent_id: 'agent-1' }
    ]);
    prisma.device_usage_daily.findMany.mockResolvedValue([]);
    prisma.device_card_taps_daily.findMany.mockResolvedValue([]);
    prisma.device_ai_interactions_daily.findMany.mockResolvedValue([]);
    prisma.device_games_played.count.mockResolvedValue(0);
    prisma.device_analytics_event.findMany.mockResolvedValue([
      { server_received_at: new Date('2026-05-13T03:00:00.000Z') },
      { server_received_at: new Date('2026-05-13T07:00:00.000Z') },
      { server_received_at: new Date('2026-05-12T21:00:00.000Z') }
    ]);
    prisma.device_analytics_event.findFirst.mockResolvedValue(null);

    const result = await mobileService.getProgressSummary('firebase-user-1', {
      now: new Date('2026-05-13T10:00:00.000Z')
    });

    expect(result.games_played).toBe(2);
    expect(result.gamesPlayed).toBe(2);
    expect(prisma.device_analytics_event.findMany).toHaveBeenCalledWith({
      where: {
        mac_address: { in: ['AA:BB:CC:DD:EE:FF'] },
        event_name: 'game_start',
        server_received_at: {
          gte: new Date('2026-05-12T00:00:00.000Z'),
          lte: new Date('2026-05-14T00:00:00.000Z')
        }
      },
      select: { server_received_at: true }
    });
  });

  it('counts today card taps from daily projection rows', async () => {
    prisma.sys_user.findUnique.mockResolvedValue({
      id: 1n,
      firebase_uid: 'firebase-user-1',
      parent_profile: { timezone: 'UTC' }
    });
    prisma.ai_device.findMany.mockResolvedValue([
      { id: 'device-1', mac_address: 'AA:BB:CC:DD:EE:FF', agent_id: 'agent-1' }
    ]);
    prisma.device_usage_daily.findMany.mockResolvedValue([]);
    prisma.device_card_taps_daily.findMany.mockResolvedValue([
      { card_tap_count: 11 },
      { card_tap_count: 2 }
    ]);
    prisma.device_ai_interactions_daily.findMany.mockResolvedValue([]);
    prisma.device_games_played.count.mockResolvedValue(0);
    prisma.device_analytics_event.findMany.mockImplementation(query => {
      if (query?.where?.event_name === 'card_session_start') {
        return Promise.resolve([
          { server_received_at: new Date('2026-05-13T03:00:00.000Z'), event_name: 'card_session_start', rfid_uid: 'CARD123' },
          { server_received_at: new Date('2026-05-13T03:00:20.000Z'), event_name: 'card_session_start', rfid_uid: 'CARD123' },
          { server_received_at: new Date('2026-05-13T07:00:00.000Z'), event_name: 'card_session_start', rfid_uid: 'CARD123' },
          { server_received_at: new Date('2026-05-12T21:00:00.000Z'), event_name: 'card_session_start', rfid_uid: 'CARD123' }
        ]);
      }
      return Promise.resolve([]);
    });

    const result = await mobileService.getProgressSummary('firebase-user-1', {
      now: new Date('2026-05-13T10:00:00.000Z')
    });

    expect(result.card_tap_count).toBe(13);
    expect(result.cardTapCount).toBe(13);
  });

  it('counts today card taps from daily projection rows for admin mac summary', async () => {
    prisma.ai_device.findUnique.mockResolvedValue({
      user_id: 1n
    });
    prisma.parent_profile.findUnique.mockResolvedValue({
      timezone: 'UTC'
    });
    prisma.device_usage_daily.findMany.mockResolvedValue([]);
    prisma.device_card_taps_daily.findMany.mockResolvedValue([
      { card_tap_count: 73 }
    ]);
    prisma.device_ai_interactions_daily.findMany.mockResolvedValue([]);
    prisma.device_games_played.count.mockResolvedValue(0);
    prisma.device_analytics_event.findMany.mockImplementation(query => {
      if (query?.where?.event_name === 'card_session_start') {
        return Promise.resolve([
          { server_received_at: new Date('2026-05-13T03:00:00.000Z'), event_name: 'card_session_start', rfid_uid: 'CARD123' },
          { server_received_at: new Date('2026-05-13T03:00:20.000Z'), event_name: 'card_session_start', rfid_uid: 'CARD123' },
          { server_received_at: new Date('2026-05-13T07:00:00.000Z'), event_name: 'card_session_start', rfid_uid: 'CARD123' },
          { server_received_at: new Date('2026-05-12T21:00:00.000Z'), event_name: 'card_session_start', rfid_uid: 'CARD123' }
        ]);
      }
      return Promise.resolve([]);
    });

    const result = await mobileService.getProgressSummaryByMacAdmin('AA:BB:CC:DD:EE:FF', {
      now: new Date('2026-05-13T10:00:00.000Z')
    });

    expect(result.card_tap_count).toBe(73);
    expect(result.cardTapCount).toBe(73);
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
    prisma.device_analytics_event.findFirst.mockResolvedValue(null);
    prisma.device_usage_daily.findMany.mockResolvedValue([]);
    prisma.device_card_taps_daily.findMany.mockResolvedValue([]);
    prisma.device_ai_interactions_daily.findMany.mockResolvedValue([]);
    prisma.device_games_played.findMany.mockResolvedValue([]);
    prisma.device_games_played.count.mockResolvedValue(0);
    prisma.device_radio_played.findMany.mockResolvedValue([]);
    prisma.device_radio_played.count.mockResolvedValue(0);
    prisma.ai_agent_chat_history.findMany.mockResolvedValue([]);
    prisma.ai_agent_chat_history.count.mockResolvedValue(0);
    prisma.rfid_card_tap_log.findMany.mockResolvedValue([]);
    prisma.rfid_card_mapping.findMany.mockResolvedValue([]);
  });

  it.each([
    ['week', new Date('2026-04-30T18:30:00.000Z')],
    ['month', new Date('2025-05-31T18:30:00.000Z')]
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
    expect(result).toEqual(expect.objectContaining({
      metric: 'games',
      period,
      total: 4,
      items: [
        { name: 'Math Tutor', key: 'math_tutor', count: 2 },
        { name: 'Riddle Solver', key: 'riddle_solver', count: 1 },
        { name: 'Animal', key: 'ANIMAL', count: 1 }
      ]
    }));
  });

  it('returns game score details in week sections without changing progress summary', async () => {
    prisma.sys_user.findUnique.mockResolvedValue({ id: 1n, firebase_uid: 'firebase-user-1' });
    prisma.device_analytics_event.findMany.mockResolvedValue([
      {
        event_name: 'game_start',
        game_id: 'math_tutor',
        data: { game_name: 'Math Tutor' },
        server_received_at: new Date('2026-05-04T08:00:00.000Z')
      }
    ]);
    prisma.device_games_played.findMany.mockResolvedValue([
      {
        id: 'row-1',
        mac_address: 'AA:BB:CC:DD:EE:FF',
        game_id: 'math_tutor',
        game_name: 'Math Tutor',
        level: 2,
        difficulty_level: 'easy',
        score: 10,
        duration_ms: 120000,
        played_at: new Date('2026-05-04T08:05:00.000Z')
      }
    ]);

    const result = await mobileService.getHomepageActivityDetails('firebase-user-1', {
      metric: 'games',
      period: 'week',
      now: new Date('2026-05-16T10:00:00.000Z')
    });

    const gameRowsQuery = prisma.device_games_played.findMany.mock.calls[0][0];
    expect(gameRowsQuery).toEqual(expect.objectContaining({
      where: expect.objectContaining({
        mac_address: { in: ['AA:BB:CC:DD:EE:FF'] },
        played_at: expect.objectContaining({
          gte: expect.any(Date),
          lte: new Date('2026-05-16T10:00:00.000Z')
        })
      }),
      orderBy: { played_at: 'desc' }
    }));
    expect(gameRowsQuery.where.activity_date).toBeUndefined();
    expect(result.week_sections[0]).toEqual(expect.objectContaining({
      label: 'Week 2',
      week: 2
    }));
    expect(result.week_sections[0].items).toEqual([
      expect.objectContaining({
        game_name: 'Math Tutor',
        level: 2,
        score: 10,
        difficulty_level: 'easy'
      })
    ]);
  });

  it.each(['week', 'month'])('returns cards detail for period=%s', async (period) => {
    prisma.sys_user.findUnique.mockResolvedValue({ id: 1n, firebase_uid: 'firebase-user-1' });
    prisma.device_analytics_event.findMany.mockResolvedValue([
      { event_name: 'card_session_start', rfid_uid: 'CARD123', content_id: null, data: {}, server_received_at: new Date('2026-05-04T08:00:00.000Z') },
      { event_name: 'card_session_start', rfid_uid: 'CARD123', content_id: null, data: {}, server_received_at: new Date('2026-05-05T08:00:00.000Z') },
      { event_name: 'card_session_start', rfid_uid: 'CARD123', content_id: null, data: {}, server_received_at: new Date('2026-05-05T08:00:20.000Z') },
      { event_name: 'card_session_start', rfid_uid: 'CARD456', content_id: null, data: { card_name: 'Alphabet Card' }, server_received_at: new Date('2026-05-05T09:00:00.000Z') },
      { event_name: 'ai_talk_start', rfid_uid: 'CARD123', data: {}, server_received_at: new Date('2026-05-05T10:00:00.000Z') }
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
      where: {
        rfid_uid: {
          in: expect.arrayContaining(['CARD123', 'card123', 'CARD456', 'card456'])
        }
      },
      select: expect.objectContaining({
        rfid_uid: true,
        card_type: true,
        action_data: true,
        rfid_content_pack: { select: { name: true } },
        rfid_question: { select: { title: true } },
        rfid_pack: { select: { pack_name: true } }
      })
    });
    expect(result).toEqual(expect.objectContaining({
      metric: 'cards',
      period,
      total: 3,
      items: [
        { name: 'Lion Card', key: 'CARD123', count: 2 },
        { name: 'Alphabet Card', key: 'CARD456', count: 1 }
      ]
    }));
    if (period === 'week') {
      expect(result.week_sections).toEqual([
        {
          label: 'Week 2',
          week: 2,
          total: 3,
          items: [
            { name: 'Lion Card', key: 'CARD123', count: 2 },
            { name: 'Alphabet Card', key: 'CARD456', count: 1 }
          ]
        }
      ]);
    } else {
      expect(result.month_sections).toEqual([
        {
          label: 'May, 2026',
          month: '2026-05',
          total: 3,
          items: [
            { name: 'Lion Card', key: 'CARD123', count: 2 },
            { name: 'Alphabet Card', key: 'CARD456', count: 1 }
          ]
        }
      ]);
    }
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

    expect(result).toEqual(expect.objectContaining({
      metric: 'usage',
      period,
      total_seconds: 2100,
      totalSeconds: 2100,
      items: [
        { name: 'Math Tutor', key: 'math_tutor', duration_seconds: 1200, durationSeconds: 1200 },
        { name: 'Lion Card', key: 'CARD123', duration_seconds: 600, durationSeconds: 600 },
        { name: 'Fun Radio', key: 'radio:Fun Radio', duration_seconds: 300, durationSeconds: 300 }
      ]
    }));
  });

  it('uses mapped card names for usage rows even when card id casing differs', async () => {
    prisma.sys_user.findUnique.mockResolvedValue({ id: 1n, firebase_uid: 'firebase-user-1' });
    prisma.device_analytics_event.findMany.mockResolvedValue([
      {
        event_name: 'card_session_end',
        duration_ms: 240000,
        game_id: null,
        rfid_uid: 'e91c3e0e',
        content_id: null,
        station: null,
        data: {},
        server_received_at: new Date('2026-05-16T08:00:00.000Z')
      }
    ]);
    prisma.rfid_card_mapping.findMany.mockResolvedValue([
      {
        rfid_uid: 'E91C3E0E',
        rfid_content_pack: { name: 'Rhymes' },
        rfid_question: null,
        rfid_pack: null
      }
    ]);

    const result = await mobileService.getHomepageActivityDetails('firebase-user-1', {
      metric: 'usage',
      period: 'week',
      now: new Date('2026-05-16T10:00:00.000Z')
    });

    expect(result.items).toEqual([
      expect.objectContaining({
        key: 'e91c3e0e',
        name: 'Rhymes',
        duration_seconds: 240
      })
    ]);
    expect(result.week_sections[0].items[0].name).toBe('Rhymes');
  });

  it('rejects invalid metric', async () => {
    prisma.sys_user.findUnique.mockResolvedValue({ id: 1n, firebase_uid: 'firebase-user-1' });

    await expect(mobileService.getHomepageActivityDetails('firebase-user-1', {
      metric: 'unknown',
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

    expect(result).toEqual(expect.objectContaining({
      metric: 'usage',
      period: 'week',
      total_seconds: 0,
      totalSeconds: 0,
      items: []
    }));
  });
});

describe('mobile.service progress endpoints', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    prisma.sys_user.findUnique.mockResolvedValue({
      id: 1n,
      firebase_uid: 'firebase-user-1',
      parent_profile: { timezone: 'UTC' }
    });
    prisma.ai_device.findMany.mockResolvedValue([
      { id: 'device-1', mac_address: 'AA:BB:CC:DD:EE:FF' }
    ]);
    prisma.device_usage_daily.findMany.mockResolvedValue([]);
    prisma.device_card_taps_daily.findMany.mockResolvedValue([]);
    prisma.device_ai_interactions_daily.findMany.mockResolvedValue([]);
    prisma.device_games_played.findMany.mockResolvedValue([]);
    prisma.device_games_played.count.mockResolvedValue(0);
    prisma.device_radio_played.findMany.mockResolvedValue([]);
    prisma.device_radio_played.count.mockResolvedValue(0);
  });

  it('returns summary for week from projection tables', async () => {
    prisma.device_usage_daily.findMany.mockResolvedValue([
      { usage_time_seconds: 120 },
      { usage_time_seconds: 80 }
    ]);
    prisma.device_card_taps_daily.findMany.mockResolvedValue([
      { card_tap_count: 2 },
      { card_tap_count: 1 }
    ]);
    prisma.device_ai_interactions_daily.findMany.mockResolvedValue([
      { ai_interaction_count: 3 }
    ]);
    prisma.device_games_played.count.mockResolvedValue(4);

    const result = await mobileService.getProgressSummary('firebase-user-1', {
      period: 'week',
      now: new Date('2026-05-16T10:00:00.000Z')
    });

    expect(result).toEqual(expect.objectContaining({
      period: 'week',
      start_date: '2026-05-10',
      end_date: '2026-05-16',
      usage_time_seconds: 180,
      card_tap_count: 3,
      ai_interaction_count: 3,
      games_played: 4
    }));
  });

  it('uses the current calendar month for month summary range', async () => {
    prisma.device_usage_daily.findMany.mockResolvedValue([]);
    prisma.device_card_taps_daily.findMany.mockResolvedValue([]);
    prisma.device_ai_interactions_daily.findMany.mockResolvedValue([]);
    prisma.device_games_played.count.mockResolvedValue(0);

    const result = await mobileService.getProgressSummary('firebase-user-1', {
      period: 'month',
      now: new Date('2026-06-02T10:00:00.000Z')
    });

    expect(result).toEqual(expect.objectContaining({
      period: 'month',
      start_date: '2026-06-01',
      end_date: '2026-06-02'
    }));
    expect(prisma.device_usage_daily.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        date: expect.objectContaining({
          gte: new Date('2026-06-01T00:00:00.000Z'),
          lte: new Date('2026-06-02T00:00:00.000Z')
        })
      })
    }));
  });

  it('returns usage category details', async () => {
    prisma.device_usage_daily.findMany.mockResolvedValue([
      {
        game_usage_seconds: 70,
        card_usage_seconds: 1237,
        ai_talk_usage_seconds: 34,
        radio_usage_seconds: 0
      }
    ]);

    const result = await mobileService.getProgressDetails('firebase-user-1', {
      metric: 'usage',
      period: 'today'
    });

    expect(result).toEqual({
      metric: 'usage',
      period: 'today',
      page: 1,
      limit: 20,
      total_items: 4,
      totalItems: 4,
      total_seconds: 1260,
      totalSeconds: 1260,
      items: [
        { key: 'game', name: 'Game', duration_seconds: 60, durationSeconds: 60 },
        { key: 'card', name: 'Card', duration_seconds: 1200, durationSeconds: 1200 },
        { key: 'ai_talk', name: 'AI Talk', duration_seconds: 0, durationSeconds: 0 },
        { key: 'radio', name: 'Radio', duration_seconds: 0, durationSeconds: 0 }
      ]
    });
  });

  it('returns usage week sections from daily projection rows', async () => {
    prisma.device_usage_daily.findMany
      .mockResolvedValueOnce([
        {
          date: new Date('2026-05-17T00:00:00.000Z'),
          game_usage_seconds: 70,
          card_usage_seconds: 1237,
          ai_talk_usage_seconds: 34,
          radio_usage_seconds: 0
        },
        {
          date: new Date('2026-05-23T00:00:00.000Z'),
          game_usage_seconds: 180,
          card_usage_seconds: 2340,
          ai_talk_usage_seconds: 300,
          radio_usage_seconds: 120
        },
        {
          date: new Date('2026-05-25T00:00:00.000Z'),
          game_usage_seconds: 0,
          card_usage_seconds: 0,
          ai_talk_usage_seconds: 0,
          radio_usage_seconds: 60
        }
      ])
      .mockResolvedValueOnce([
        {
          date: new Date('2026-05-17T00:00:00.000Z'),
          game_usage_seconds: 70,
          card_usage_seconds: 1237,
          ai_talk_usage_seconds: 34,
          radio_usage_seconds: 0
        },
        {
          date: new Date('2026-05-23T00:00:00.000Z'),
          game_usage_seconds: 180,
          card_usage_seconds: 2340,
          ai_talk_usage_seconds: 300,
          radio_usage_seconds: 120
        },
        {
          date: new Date('2026-05-25T00:00:00.000Z'),
          game_usage_seconds: 0,
          card_usage_seconds: 0,
          ai_talk_usage_seconds: 0,
          radio_usage_seconds: 60
        }
      ]);

    const result = await mobileService.getProgressDetails('firebase-user-1', {
      metric: 'usage',
      period: 'week',
      now: new Date('2026-05-25T12:00:00.000Z')
    });

    expect(result.week_sections).toEqual([
      expect.objectContaining({
        label: 'Week 3',
        week: 3,
        total_seconds: 1260,
        items: expect.arrayContaining([
          { key: 'card', name: 'Card', duration_seconds: 1200, durationSeconds: 1200 },
          { key: 'game', name: 'Game', duration_seconds: 60, durationSeconds: 60 },
          { key: 'ai_talk', name: 'AI Talk', duration_seconds: 0, durationSeconds: 0 },
          { key: 'radio', name: 'Radio', duration_seconds: 0, durationSeconds: 0 }
        ])
      }),
      expect.objectContaining({
        label: 'Week 4',
        week: 4,
        total_seconds: 2940,
        items: expect.arrayContaining([
          { key: 'card', name: 'Card', duration_seconds: 2340, durationSeconds: 2340 },
          { key: 'ai_talk', name: 'AI Talk', duration_seconds: 300, durationSeconds: 300 },
          { key: 'game', name: 'Game', duration_seconds: 180, durationSeconds: 180 },
          { key: 'radio', name: 'Radio', duration_seconds: 120, durationSeconds: 120 }
        ])
      }),
      expect.objectContaining({
        label: 'Week 5',
        week: 5,
        total_seconds: 60,
        items: expect.arrayContaining([
          { key: 'radio', name: 'Radio', duration_seconds: 60, durationSeconds: 60 }
        ])
      })
    ]);
    expect(result.items).toEqual([
      { key: 'game', name: 'Game', duration_seconds: 240, durationSeconds: 240 },
      { key: 'card', name: 'Card', duration_seconds: 3540, durationSeconds: 3540 },
      { key: 'ai_talk', name: 'AI Talk', duration_seconds: 300, durationSeconds: 300 },
      { key: 'radio', name: 'Radio', duration_seconds: 180, durationSeconds: 180 }
    ]);
  });

  it('ignores previous-month usage rows for week details when the current month is empty', async () => {
    prisma.device_usage_daily.findMany.mockImplementation(async ({ where }) => {
      const startKey = where?.date?.gte?.toISOString?.().slice(0, 10);
      if (startKey === '2026-05-27') {
        return [
          {
            date: new Date('2026-05-31T00:00:00.000Z'),
            game_usage_seconds: 70,
            card_usage_seconds: 1237,
            ai_talk_usage_seconds: 34,
            radio_usage_seconds: 0
          }
        ];
      }
      return [];
    });

    const result = await mobileService.getProgressDetails('firebase-user-1', {
      metric: 'usage',
      period: 'week',
      now: new Date('2026-06-02T12:00:00.000Z')
    });

    expect(result).toEqual(expect.objectContaining({
      metric: 'usage',
      period: 'week',
      total_seconds: 0,
      totalSeconds: 0,
      items: [
        { key: 'game', name: 'Game', duration_seconds: 0, durationSeconds: 0 },
        { key: 'card', name: 'Card', duration_seconds: 0, durationSeconds: 0 },
        { key: 'ai_talk', name: 'AI Talk', duration_seconds: 0, durationSeconds: 0 },
        { key: 'radio', name: 'Radio', duration_seconds: 0, durationSeconds: 0 }
      ],
      week_sections: []
    }));
  });

  it('returns recent card names instead of daily date rows for card details', async () => {
    prisma.device_analytics_event.findMany.mockResolvedValue([
      {
        event_name: 'card_session_start',
        server_received_at: new Date('2026-05-23T09:00:00.000Z'),
        rfid_uid: 'OLD123',
        content_id: null,
        data: { card_name: 'Older Card' }
      },
      {
        event_name: 'card_session_start',
        server_received_at: new Date('2026-05-23T11:00:00.000Z'),
        rfid_uid: 'NEW123',
        content_id: null,
        data: { card_name: 'Newest Card' }
      }
    ]);

    const result = await mobileService.getProgressDetails('firebase-user-1', {
      metric: 'cards',
      period: 'today',
      now: new Date('2026-05-23T12:00:00.000Z')
    });

    expect(prisma.device_card_taps_daily.findMany).not.toHaveBeenCalled();
    expect(result).toEqual(expect.objectContaining({
      metric: 'cards',
      period: 'today',
      total: 2,
      total_items: 2,
      totalItems: 2,
      items: [
        expect.objectContaining({
          key: 'NEW123',
          name: 'Newest Card',
          count: 1,
          timestamp: new Date('2026-05-23T11:00:00.000Z')
        }),
        expect.objectContaining({
          key: 'OLD123',
          name: 'Older Card',
          count: 1,
          timestamp: new Date('2026-05-23T09:00:00.000Z')
        })
      ]
    }));
  });

  it('uses device event timestamps for card detail debouncing so totals match progress summary counts', async () => {
    prisma.device_analytics_event.findMany.mockResolvedValue([
      {
        event_name: 'card_session_start',
        server_received_at: new Date('2026-06-03T11:29:07.900Z'),
        event_timestamp: new Date('2026-06-03T11:29:07.000Z'),
        rfid_uid: 'CARD123',
        content_id: null,
        data: { card_name: 'Alphabet Card' }
      },
      {
        event_name: 'card_session_start',
        server_received_at: new Date('2026-06-03T11:30:08.547Z'),
        event_timestamp: new Date('2026-06-03T11:30:07.000Z'),
        rfid_uid: 'CARD123',
        content_id: null,
        data: { card_name: 'Alphabet Card' }
      }
    ]);

    const result = await mobileService.getProgressDetails('firebase-user-1', {
      metric: 'cards',
      period: 'today',
      now: new Date('2026-06-03T12:00:00.000Z')
    });

    expect(result).toEqual(expect.objectContaining({
      metric: 'cards',
      period: 'today',
      total: 1,
      total_items: 1,
      totalItems: 1,
      items: [
        expect.objectContaining({
          key: 'CARD123',
          name: 'Alphabet Card',
          count: 1
        })
      ]
    }));
  });

  it('returns week sections for card details without inventing missing weeks', async () => {
    prisma.device_analytics_event.findMany.mockResolvedValue([
      {
        event_name: 'card_session_start',
        server_received_at: new Date('2026-05-09T11:00:00.000Z'),
        rfid_uid: 'WEEK2',
        content_id: null,
        data: { card_name: 'Week 2 Card' }
      },
      {
        event_name: 'card_session_start',
        server_received_at: new Date('2026-05-23T11:00:00.000Z'),
        rfid_uid: 'WEEK4',
        content_id: null,
        data: { card_name: 'Week 4 Card' }
      },
      {
        event_name: 'card_session_start',
        server_received_at: new Date('2026-05-24T11:00:00.000Z'),
        rfid_uid: 'WEEK4',
        content_id: null,
        data: { card_name: 'Week 4 Card' }
      }
    ]);

    const result = await mobileService.getProgressDetails('firebase-user-1', {
      metric: 'cards',
      period: 'week',
      now: new Date('2026-05-25T12:00:00.000Z')
    });

    expect(result.week_sections).toEqual([
      expect.objectContaining({
        label: 'Week 2',
        week: 2,
        total: 1,
        items: [expect.objectContaining({ key: 'WEEK2', name: 'Week 2 Card', count: 1 })]
      }),
      expect.objectContaining({
        label: 'Week 4',
        week: 4,
        total: 2,
        items: [expect.objectContaining({ key: 'WEEK4', name: 'Week 4 Card', count: 2 })]
      })
    ]);
  });

  it('returns month sections for card details only for the selected month activity', async () => {
    prisma.device_analytics_event.findMany.mockResolvedValue([
      {
        event_name: 'card_session_start',
        server_received_at: new Date('2026-03-15T11:00:00.000Z'),
        rfid_uid: 'MARCH1',
        content_id: null,
        data: { card_name: 'March Card' }
      },
      {
        event_name: 'card_session_start',
        server_received_at: new Date('2026-05-20T11:00:00.000Z'),
        rfid_uid: 'MAY1',
        content_id: null,
        data: { card_name: 'May Card' }
      }
    ]);

    const result = await mobileService.getProgressDetails('firebase-user-1', {
      metric: 'cards',
      period: 'month',
      now: new Date('2026-05-25T12:00:00.000Z')
    });

    expect(result.month_sections).toEqual([
      expect.objectContaining({
        label: 'May, 2026',
        month: '2026-05',
        total: 1,
        items: [expect.objectContaining({ key: 'MAY1', name: 'May Card', count: 1 })]
      })
    ]);
  });

  it('returns recent card names instead of daily date rows for ai interaction details', async () => {
    prisma.device_analytics_event.findMany.mockResolvedValue([
      {
        event_name: 'ai_talk_start',
        server_received_at: new Date('2026-05-23T09:00:00.000Z'),
        event_timestamp: new Date('2026-05-23T09:00:00.000Z'),
        rfid_uid: 'OLD123',
        content_id: null,
        data: { card_name: 'Older AI Card' }
      },
      {
        event_name: 'ai_talk_end',
        server_received_at: new Date('2026-05-23T09:00:30.000Z'),
        event_timestamp: new Date('2026-05-23T09:00:30.000Z'),
        rfid_uid: null,
        content_id: null,
        data: { reason: 'channel_closed' }
      },
      {
        event_name: 'ai_talk_start',
        server_received_at: new Date('2026-05-23T11:00:00.000Z'),
        event_timestamp: new Date('2026-05-23T11:00:00.000Z'),
        rfid_uid: 'NEW123',
        content_id: null,
        data: { card_name: 'Newest AI Card' }
      },
      {
        event_name: 'ai_talk_end',
        server_received_at: new Date('2026-05-23T11:00:30.000Z'),
        event_timestamp: new Date('2026-05-23T11:00:30.000Z'),
        rfid_uid: null,
        content_id: null,
        data: { reason: 'channel_closed' }
      }
    ]);

    const result = await mobileService.getProgressDetails('firebase-user-1', {
      metric: 'ai',
      period: 'today',
      now: new Date('2026-05-23T12:00:00.000Z')
    });

    expect(prisma.device_ai_interactions_daily.findMany).not.toHaveBeenCalled();
    expect(result).toEqual(expect.objectContaining({
      metric: 'ai',
      period: 'today',
      total: 2,
      total_items: 2,
      totalItems: 2,
      items: [
        expect.objectContaining({
          key: 'NEW123',
          name: 'Newest AI Card',
          count: 1,
          timestamp: new Date('2026-05-23T11:00:00.000Z')
        }),
        expect.objectContaining({
          key: 'OLD123',
          name: 'Older AI Card',
          count: 1,
          timestamp: new Date('2026-05-23T09:00:00.000Z')
        })
      ]
    }));
  });

  it('counts completed ai sessions once in detail even when duplicate starts happen before an end', async () => {
    prisma.device_analytics_event.findMany.mockResolvedValue([
      {
        event_name: 'card_session_start',
        server_received_at: new Date('2026-05-23T09:00:00.000Z'),
        event_timestamp: new Date('2026-05-23T09:00:00.000Z'),
        mac_address: 'AA:BB:CC:DD:EE:FF',
        rfid_uid: 'CHEEKO123',
        content_id: null,
        data: { card_name: 'Cheeko' }
      },
      {
        event_name: 'ai_talk_start',
        server_received_at: new Date('2026-05-23T09:05:00.000Z'),
        event_timestamp: new Date('2026-05-23T09:05:00.000Z'),
        mac_address: 'AA:BB:CC:DD:EE:FF',
        rfid_uid: null,
        content_id: null,
        data: { source: 'menu' }
      },
      {
        event_name: 'ai_talk_start',
        server_received_at: new Date('2026-05-23T09:05:05.000Z'),
        event_timestamp: new Date('2026-05-23T09:05:05.000Z'),
        mac_address: 'AA:BB:CC:DD:EE:FF',
        rfid_uid: null,
        content_id: null,
        data: { source: 'menu' }
      },
      {
        event_name: 'ai_talk_end',
        server_received_at: new Date('2026-05-23T09:05:40.000Z'),
        event_timestamp: new Date('2026-05-23T09:05:40.000Z'),
        mac_address: 'AA:BB:CC:DD:EE:FF',
        rfid_uid: null,
        content_id: null,
        data: { reason: 'channel_closed' }
      }
    ]);
    prisma.rfid_card_mapping.findMany.mockResolvedValue([
      {
        rfid_uid: 'CHEEKO123',
        card_type: 'ai',
        action_data: { agent_name: 'Cheeko' },
        rfid_content_pack: null,
        rfid_question: null,
        rfid_pack: null
      }
    ]);

    const result = await mobileService.getProgressDetails('firebase-user-1', {
      metric: 'ai',
      period: 'today',
      now: new Date('2026-05-23T12:00:00.000Z')
    });

    expect(result).toEqual(expect.objectContaining({
      metric: 'ai',
      total: 1,
      total_items: 1,
      totalItems: 1,
      items: [
        expect.objectContaining({
          key: 'CHEEKO123',
          name: 'Cheeko',
          count: 1
        })
      ]
    }));
  });

  it('returns week sections for ai interaction details without padding empty weeks', async () => {
    prisma.device_analytics_event.findMany.mockResolvedValue([
      {
        event_name: 'ai_talk_start',
        server_received_at: new Date('2026-05-08T09:00:00.000Z'),
        event_timestamp: new Date('2026-05-08T09:00:00.000Z'),
        rfid_uid: 'AIWEEK2',
        content_id: null,
        data: { card_name: 'Week 2 AI Card' }
      },
      {
        event_name: 'ai_talk_end',
        server_received_at: new Date('2026-05-08T09:01:00.000Z'),
        event_timestamp: new Date('2026-05-08T09:01:00.000Z'),
        rfid_uid: null,
        content_id: null,
        data: { reason: 'channel_closed' }
      },
      {
        event_name: 'ai_talk_start',
        server_received_at: new Date('2026-05-22T09:00:00.000Z'),
        event_timestamp: new Date('2026-05-22T09:00:00.000Z'),
        rfid_uid: 'AIWEEK4',
        content_id: null,
        data: { card_name: 'Week 4 AI Card' }
      },
      {
        event_name: 'ai_talk_end',
        server_received_at: new Date('2026-05-22T09:01:00.000Z'),
        event_timestamp: new Date('2026-05-22T09:01:00.000Z'),
        rfid_uid: null,
        content_id: null,
        data: { reason: 'channel_closed' }
      }
    ]);

    const result = await mobileService.getProgressDetails('firebase-user-1', {
      metric: 'ai',
      period: 'week',
      now: new Date('2026-05-25T12:00:00.000Z')
    });

    expect(result.week_sections).toEqual([
      expect.objectContaining({
        label: 'Week 2',
        week: 2,
        total: 1,
        items: [expect.objectContaining({ key: 'AIWEEK2', name: 'Week 2 AI Card', count: 1 })]
      }),
      expect.objectContaining({
        label: 'Week 4',
        week: 4,
        total: 1,
        items: [expect.objectContaining({ key: 'AIWEEK4', name: 'Week 4 AI Card', count: 1 })]
      })
    ]);
  });

  it('does not use non-ai recent card context when ai interaction events do not include card fields', async () => {
    prisma.device_analytics_event.findMany.mockResolvedValue([
      {
        event_name: 'card_session_start',
        server_received_at: new Date('2026-05-23T09:00:00.000Z'),
        event_timestamp: new Date('2026-05-23T09:00:00.000Z'),
        mac_address: 'AA:BB:CC:DD:EE:FF',
        rfid_uid: 'RHYME123',
        content_id: null,
        data: { card_name: 'Rhymes' }
      },
      {
        event_name: 'ai_talk_start',
        server_received_at: new Date('2026-05-23T09:05:00.000Z'),
        event_timestamp: new Date('2026-05-23T09:05:00.000Z'),
        mac_address: 'AA:BB:CC:DD:EE:FF',
        rfid_uid: null,
        content_id: null,
        data: {}
      },
      {
        event_name: 'ai_talk_end',
        server_received_at: new Date('2026-05-23T09:05:30.000Z'),
        event_timestamp: new Date('2026-05-23T09:05:30.000Z'),
        mac_address: 'AA:BB:CC:DD:EE:FF',
        rfid_uid: null,
        content_id: null,
        data: { reason: 'channel_closed' }
      },
      {
        event_name: 'ai_talk_start',
        server_received_at: new Date('2026-05-23T09:10:00.000Z'),
        event_timestamp: new Date('2026-05-23T09:10:00.000Z'),
        mac_address: 'AA:BB:CC:DD:EE:FF',
        rfid_uid: null,
        content_id: null,
        data: {}
      },
      {
        event_name: 'ai_talk_end',
        server_received_at: new Date('2026-05-23T09:10:20.000Z'),
        event_timestamp: new Date('2026-05-23T09:10:20.000Z'),
        mac_address: 'AA:BB:CC:DD:EE:FF',
        rfid_uid: null,
        content_id: null,
        data: { reason: 'channel_closed' }
      }
    ]);
    prisma.rfid_card_mapping.findMany.mockResolvedValue([
      {
        rfid_uid: 'RHYME123',
        card_type: 'content',
        action_data: {},
        rfid_content_pack: { name: 'Rhymes' },
        rfid_question: null,
        rfid_pack: null
      }
    ]);

    const result = await mobileService.getProgressDetails('firebase-user-1', {
      metric: 'ai',
      period: 'today',
      now: new Date('2026-05-23T12:00:00.000Z')
    });

    expect(result).toEqual(expect.objectContaining({
      metric: 'ai',
      total: 2,
      total_items: 1,
      items: [
        expect.objectContaining({
          key: 'unknown_ai_card',
          name: 'Unknown Ai Card',
          count: 2
        })
      ]
    }));
  });

  it('uses recent ai card context when ai interaction events do not include card fields', async () => {
    prisma.device_analytics_event.findMany.mockResolvedValue([
      {
        event_name: 'card_session_start',
        server_received_at: new Date('2026-05-23T09:00:00.000Z'),
        mac_address: 'AA:BB:CC:DD:EE:FF',
        rfid_uid: 'AI123',
        content_id: null,
        data: { card_name: 'AI Buddy' }
      },
      {
        event_name: 'ai_talk_start',
        server_received_at: new Date('2026-05-23T09:05:00.000Z'),
        event_timestamp: new Date('2026-05-23T09:05:00.000Z'),
        mac_address: 'AA:BB:CC:DD:EE:FF',
        rfid_uid: null,
        content_id: null,
        data: {}
      },
      {
        event_name: 'ai_talk_end',
        server_received_at: new Date('2026-05-23T09:05:40.000Z'),
        event_timestamp: new Date('2026-05-23T09:05:40.000Z'),
        mac_address: 'AA:BB:CC:DD:EE:FF',
        rfid_uid: null,
        content_id: null,
        data: { reason: 'channel_closed' }
      }
    ]);
    prisma.rfid_card_mapping.findMany.mockResolvedValue([
      {
        rfid_uid: 'AI123',
        card_type: 'ai',
        action_data: { agent_name: 'AI Buddy' },
        rfid_content_pack: null,
        rfid_question: null,
        rfid_pack: null
      }
    ]);

    const result = await mobileService.getProgressDetails('firebase-user-1', {
      metric: 'ai',
      period: 'today',
      now: new Date('2026-05-23T12:00:00.000Z')
    });

    expect(result).toEqual(expect.objectContaining({
      metric: 'ai',
      total: 1,
      total_items: 1,
      items: [
        expect.objectContaining({
          key: 'AI123',
          name: 'AI Buddy',
          count: 1
        })
      ]
    }));
  });

  it('uses recent Cheeko card context as ai context even when card type is unknown', async () => {
    prisma.device_analytics_event.findMany.mockResolvedValue([
      {
        event_name: 'card_session_start',
        server_received_at: new Date('2026-05-23T09:00:00.000Z'),
        event_timestamp: new Date('2026-05-23T09:00:00.000Z'),
        mac_address: 'AA:BB:CC:DD:EE:FF',
        rfid_uid: 'CHEEKO123',
        content_id: null,
        data: { card_name: 'Cheeko' }
      },
      {
        event_name: 'ai_talk_start',
        server_received_at: new Date('2026-05-23T09:05:00.000Z'),
        event_timestamp: new Date('2026-05-23T09:05:00.000Z'),
        mac_address: 'AA:BB:CC:DD:EE:FF',
        rfid_uid: null,
        content_id: null,
        data: {}
      },
      {
        event_name: 'ai_talk_end',
        server_received_at: new Date('2026-05-23T09:05:35.000Z'),
        event_timestamp: new Date('2026-05-23T09:05:35.000Z'),
        mac_address: 'AA:BB:CC:DD:EE:FF',
        rfid_uid: null,
        content_id: null,
        data: { reason: 'channel_closed' }
      }
    ]);
    prisma.rfid_card_mapping.findMany.mockResolvedValue([
      {
        rfid_uid: 'CHEEKO123',
        card_type: 'unknown',
        action_data: {},
        rfid_content_pack: { name: 'Cheeko' },
        rfid_question: null,
        rfid_pack: null
      }
    ]);

    const result = await mobileService.getProgressDetails('firebase-user-1', {
      metric: 'ai',
      period: 'today',
      now: new Date('2026-05-23T12:00:00.000Z')
    });

    expect(result).toEqual(expect.objectContaining({
      metric: 'ai',
      total: 1,
      total_items: 1,
      items: [
        expect.objectContaining({
          key: 'CHEEKO123',
          name: 'Cheeko',
          count: 1
        })
      ]
    }));
  });

  it('uses the card context from when each ai interaction happened, not the latest card of the day', async () => {
    prisma.device_analytics_event.findMany.mockResolvedValue([
      {
        event_name: 'card_session_start',
        server_received_at: new Date('2026-05-23T09:00:00.000Z'),
        event_timestamp: new Date('2026-05-23T09:00:00.000Z'),
        mac_address: 'AA:BB:CC:DD:EE:FF',
        rfid_uid: 'CHEEKO123',
        content_id: null,
        data: { card_name: 'Cheeko' }
      },
      {
        event_name: 'ai_talk_start',
        server_received_at: new Date('2026-05-23T09:05:00.000Z'),
        event_timestamp: new Date('2026-05-23T09:05:00.000Z'),
        mac_address: 'AA:BB:CC:DD:EE:FF',
        rfid_uid: null,
        content_id: null,
        data: {}
      },
      {
        event_name: 'ai_talk_end',
        server_received_at: new Date('2026-05-23T09:05:25.000Z'),
        event_timestamp: new Date('2026-05-23T09:05:25.000Z'),
        mac_address: 'AA:BB:CC:DD:EE:FF',
        rfid_uid: null,
        content_id: null,
        data: { reason: 'channel_closed' }
      },
      {
        event_name: 'card_session_start',
        server_received_at: new Date('2026-05-23T10:00:00.000Z'),
        event_timestamp: new Date('2026-05-23T10:00:00.000Z'),
        mac_address: 'AA:BB:CC:DD:EE:FF',
        rfid_uid: 'SLOKAS123',
        content_id: null,
        data: { card_name: 'slokas' }
      }
    ]);
    prisma.rfid_card_mapping.findMany.mockResolvedValue([
      {
        rfid_uid: 'CHEEKO123',
        card_type: 'unknown',
        action_data: {},
        rfid_content_pack: { name: 'Cheeko' },
        rfid_question: null,
        rfid_pack: null
      },
      {
        rfid_uid: 'SLOKAS123',
        card_type: 'content',
        action_data: {},
        rfid_content_pack: { name: 'slokas' },
        rfid_question: null,
        rfid_pack: null
      }
    ]);

    const result = await mobileService.getProgressDetails('firebase-user-1', {
      metric: 'ai',
      period: 'today',
      now: new Date('2026-05-23T12:00:00.000Z')
    });

    expect(result).toEqual(expect.objectContaining({
      metric: 'ai',
      total: 1,
      total_items: 1,
      items: [
        expect.objectContaining({
          key: 'CHEEKO123',
          name: 'Cheeko',
          count: 1
        })
      ]
    }));
  });

  it('labels menu-started ai interactions as Cheeko instead of unknown ai card', async () => {
    prisma.device_analytics_event.findMany.mockResolvedValue([
      {
        event_name: 'card_session_start',
        server_received_at: new Date('2026-05-23T09:00:00.000Z'),
        mac_address: 'AA:BB:CC:DD:EE:FF',
        rfid_uid: 'CHEEKO123',
        content_id: null,
        data: { card_name: 'Cheeko' }
      },
      {
        event_name: 'ai_talk_start',
        server_received_at: new Date('2026-05-23T09:05:00.000Z'),
        event_timestamp: new Date('2026-05-23T09:05:00.000Z'),
        mac_address: 'AA:BB:CC:DD:EE:FF',
        rfid_uid: null,
        content_id: null,
        data: { source: 'rfid_card' }
      },
      {
        event_name: 'ai_talk_end',
        server_received_at: new Date('2026-05-23T09:05:40.000Z'),
        event_timestamp: new Date('2026-05-23T09:05:40.000Z'),
        mac_address: 'AA:BB:CC:DD:EE:FF',
        rfid_uid: null,
        content_id: null,
        data: { reason: 'channel_closed' }
      },
      {
        event_name: 'card_session_start',
        server_received_at: new Date('2026-05-23T09:10:00.000Z'),
        mac_address: 'AA:BB:CC:DD:EE:FF',
        rfid_uid: 'RHYME123',
        content_id: null,
        data: { card_name: 'Rhymes' }
      },
      {
        event_name: 'ai_talk_start',
        server_received_at: new Date('2026-05-23T09:15:00.000Z'),
        event_timestamp: new Date('2026-05-23T09:15:00.000Z'),
        mac_address: 'AA:BB:CC:DD:EE:FF',
        rfid_uid: null,
        content_id: null,
        data: { source: 'menu' }
      },
      {
        event_name: 'ai_talk_end',
        server_received_at: new Date('2026-05-23T09:15:45.000Z'),
        event_timestamp: new Date('2026-05-23T09:15:45.000Z'),
        mac_address: 'AA:BB:CC:DD:EE:FF',
        rfid_uid: null,
        content_id: null,
        data: { reason: 'channel_closed' }
      }
    ]);
    prisma.rfid_card_mapping.findMany.mockResolvedValue([
      {
        rfid_uid: 'CHEEKO123',
        card_type: 'ai',
        action_data: { agent_name: 'Cheeko' },
        rfid_content_pack: null,
        rfid_question: null,
        rfid_pack: null
      },
      {
        rfid_uid: 'RHYME123',
        card_type: 'content',
        action_data: {},
        rfid_content_pack: { name: 'Rhymes' },
        rfid_question: null,
        rfid_pack: null
      }
    ]);

    const result = await mobileService.getProgressDetails('firebase-user-1', {
      metric: 'ai',
      period: 'today',
      now: new Date('2026-05-23T12:00:00.000Z')
    });

    expect(result).toEqual(expect.objectContaining({
      metric: 'ai',
      total: 2,
      total_items: 1,
      items: [
        expect.objectContaining({
          key: 'CHEEKO123',
          name: 'Cheeko',
          count: 2
        })
      ]
    }));
  });

  it('returns paginated games detail rows', async () => {
    prisma.device_games_played.count.mockResolvedValue(3);
    prisma.device_games_played.findMany.mockResolvedValue([
      {
        id: 'row-1',
        mac_address: 'AA:BB:CC:DD:EE:FF',
        game_id: 'math_tutor',
        game_name: 'Math Tutor',
        level: '2',
        difficulty_level: 'easy',
        score: 10,
        duration_ms: 120000,
        played_at: new Date('2026-05-16T08:00:00.000Z'),
        source_event_id: 'evt-1'
      }
    ]);

    const result = await mobileService.getProgressDetails('firebase-user-1', {
      metric: 'games',
      period: 'month',
      page: 2,
      limit: 1
    });

    expect(result.totalItems).toBe(3);
    expect(result.items).toEqual([
      expect.objectContaining({
        id: 'row-1',
        game_id: 'math_tutor',
        game_name: 'Math Tutor',
        difficulty_level: 'easy',
        duration_ms: 120000
      })
    ]);
  });

  it('returns trend points for all days in range', async () => {
    prisma.device_usage_daily.findMany.mockResolvedValue([
      {
        date: new Date('2026-05-15T00:00:00.000Z'),
        usage_time_seconds: 100,
        game_usage_seconds: 70,
        card_usage_seconds: 1237,
        ai_talk_usage_seconds: 34,
        radio_usage_seconds: 0
      }
    ]);
    prisma.device_card_taps_daily.findMany.mockResolvedValue([
      { date: new Date('2026-05-15T00:00:00.000Z'), card_tap_count: 2 }
    ]);
    prisma.device_ai_interactions_daily.findMany.mockResolvedValue([
      { date: new Date('2026-05-15T00:00:00.000Z'), ai_interaction_count: 1 }
    ]);
    prisma.device_games_played.findMany.mockResolvedValue([
      { activity_date: new Date('2026-05-15T00:00:00.000Z') }
    ]);

    const result = await mobileService.getProgressTrend('firebase-user-1', {
      period: 'week',
      now: new Date('2026-05-16T10:00:00.000Z')
    });

    expect(result.period).toBe('week');
    expect(result.points).toHaveLength(16);
    expect(result.points[0].date).toBe('2026-05-01');
    expect(result.points[result.points.length - 1].date).toBe('2026-05-16');
    expect(result.points).toContainEqual(expect.objectContaining({
      date: '2026-05-15',
      usage_time_seconds: 1260,
      card_tap_count: 2,
      ai_interaction_count: 1,
      games_played: 1
    }));
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

  it('returns first-time preference-based content cards without AI cards', async () => {
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
      })
    ]));
    expect(result.items.some(item => item.itemType === 'ai')).toBe(false);
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

  it('does not include AI recommendations when recent card history indicates AI usage', async () => {
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

    expect(result.items.some(item => item.itemType === 'ai')).toBe(false);
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

  it('returns safe default backend content cards when there is no history and no preferences', async () => {
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
      })
    ]));
    expect(result.items.some(item => item.itemType === 'ai')).toBe(false);
  });

  it('returns only content cards in default recommendations when content fills the limit', async () => {
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
    expect(result.items.some(item => item.itemType === 'ai')).toBe(false);
  });
});
