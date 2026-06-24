const {
  resolveRuntimeAgentName,
  resolveSessionForCharacter,
} = require('../../src/services/character-resolver');

describe('resolveRuntimeAgentName', () => {
  const ORIGINAL = process.env.LIVEKIT_DEFAULT_AGENT;
  afterEach(() => {
    if (ORIGINAL === undefined) delete process.env.LIVEKIT_DEFAULT_AGENT;
    else process.env.LIVEKIT_DEFAULT_AGENT = ORIGINAL;
  });

  it('returns the explicit runtime_agent_name when set', () => {
    expect(resolveRuntimeAgentName({ runtime_agent_name: 'math-tutor' })).toBe('math-tutor');
  });

  it('falls back to LIVEKIT_DEFAULT_AGENT when runtime_agent_name is null', () => {
    process.env.LIVEKIT_DEFAULT_AGENT = 'cheeko-agent2';
    expect(resolveRuntimeAgentName({ runtime_agent_name: null })).toBe('cheeko-agent2');
  });

  it('falls back to cheeko-agent when neither field nor env is set', () => {
    delete process.env.LIVEKIT_DEFAULT_AGENT;
    expect(resolveRuntimeAgentName({})).toBe('cheeko-agent');
  });
});

describe('resolveSessionForCharacter', () => {
  const character = {
    id: 'char-uuid',
    agent_name: 'Cheeko',
    runtime_agent_name: null,
    system_prompt: 'Be kind and playful.',
    soul: 'I am warm and curious.',
    language: 'English',
  };

  it('returns the full worker session contract with no hashes', () => {
    delete process.env.LIVEKIT_DEFAULT_AGENT;
    expect(resolveSessionForCharacter(character, {})).toEqual({
      characterId: 'char-uuid',
      characterName: 'Cheeko',
      runtimeAgentName: 'cheeko-agent',
      language: 'English',
      systemPrompt: 'Be kind and playful.',
      soul: 'I am warm and curious.',
    });
  });

  it('lets an explicit language override the character default', () => {
    expect(resolveSessionForCharacter(character, { language: 'German' }).language).toBe('German');
  });

  it('null soul/systemPrompt pass through as null, not undefined', () => {
    const bare = { id: 'x', agent_name: 'N', runtime_agent_name: 'word-ladder' };
    expect(resolveSessionForCharacter(bare, {})).toMatchObject({
      runtimeAgentName: 'word-ladder',
      language: null,
      systemPrompt: null,
      soul: null,
    });
  });
});
