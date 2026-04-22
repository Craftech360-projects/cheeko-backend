const {
  buildVoiceSessionRecord,
  buildVoiceMessageRecords,
  buildDbConnectionString,
  chatTypeToRole
} = require('../../scripts/backfill-ai-agent-chat-history-to-voice-sessions');

describe('legacy chat history backfill helpers', () => {
  const legacyRows = [
    {
      id: 'legacy-1',
      session_id: 'session-1',
      mac_address: 'AA:BB:CC:DD:EE:FF',
      agent_id: 'agent-id',
      chat_type: 1,
      content: 'Hello',
      audio_id: null,
      created_at: new Date('2026-04-22T08:01:00.000Z')
    },
    {
      id: 'legacy-2',
      session_id: 'session-1',
      mac_address: 'AA:BB:CC:DD:EE:FF',
      agent_id: 'agent-id',
      chat_type: 2,
      content: 'Hi!',
      audio_id: 'audio-1',
      created_at: new Date('2026-04-22T08:02:00.000Z')
    }
  ];

  it('maps legacy chat types to canonical roles', () => {
    expect(chatTypeToRole(1)).toBe('user');
    expect(chatTypeToRole(2)).toBe('assistant');
    expect(chatTypeToRole(99)).toBe('unknown');
  });

  it('normalizes sslmode from Postgres URLs for the pg adapter', () => {
    expect(buildDbConnectionString('postgres://u:p@localhost:5432/db?sslmode=require'))
      .toBe('postgres://u:p@localhost:5432/db');
    expect(buildDbConnectionString('postgres://u:p@localhost:5432/db?foo=1&sslmode=require'))
      .toBe('postgres://u:p@localhost:5432/db?foo=1');
  });

  it('builds one voice session record from ordered legacy rows', () => {
    expect(buildVoiceSessionRecord('session-1', legacyRows)).toEqual({
      session_id: 'session-1',
      mac_address: 'AA:BB:CC:DD:EE:FF',
      agent_id: 'agent-id',
      status: 'ended',
      started_at: new Date('2026-04-22T08:01:00.000Z'),
      ended_at: new Date('2026-04-22T08:02:00.000Z'),
      last_event_at: new Date('2026-04-22T08:02:00.000Z'),
      metadata: {
        backfill: {
          source: 'ai_agent_chat_history',
          rowCount: 2
        }
      }
    });
  });

  it('builds idempotent voice message rows with stable sequence numbers', () => {
    expect(buildVoiceMessageRecords(legacyRows)).toEqual([
      {
        session_id: 'session-1',
        mac_address: 'AA:BB:CC:DD:EE:FF',
        agent_id: 'agent-id',
        sequence: 1,
        role: 'user',
        content: 'Hello',
        provider_message: null,
        audio_id: null,
        created_at: new Date('2026-04-22T08:01:00.000Z'),
        idempotency_key: 'legacy:ai_agent_chat_history:legacy-1'
      },
      {
        session_id: 'session-1',
        mac_address: 'AA:BB:CC:DD:EE:FF',
        agent_id: 'agent-id',
        sequence: 2,
        role: 'assistant',
        content: 'Hi!',
        provider_message: null,
        audio_id: 'audio-1',
        created_at: new Date('2026-04-22T08:02:00.000Z'),
        idempotency_key: 'legacy:ai_agent_chat_history:legacy-2'
      }
    ]);
  });
});
