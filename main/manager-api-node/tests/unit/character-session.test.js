describe('character session contract (getCharacterSession / getCurrentCharacter)', () => {
  let prisma;
  let agentService;
  const ORIGINAL_DEFAULT = process.env.LIVEKIT_DEFAULT_AGENT;

  beforeEach(() => {
    jest.resetModules();
    delete process.env.LIVEKIT_DEFAULT_AGENT; // exercise the cheeko-agent hard default

    prisma = {
      ai_device: { findUnique: jest.fn() },
      ai_agent: { findUnique: jest.fn() },
      // default: no template -> getCharacterSession falls back to the instance's own fields
      ai_agent_template: { findFirst: jest.fn().mockResolvedValue(null) },
    };

    jest.doMock('../../src/config/database', () => ({ prisma }));
    jest.doMock('../../src/services/integrations/mem0.service', () => ({
      isAvailable: jest.fn(() => false),
      searchMemories: jest.fn(),
      formatForPrompt: jest.fn(() => ''),
    }));
    jest.doMock('../../src/utils/logger', () => ({
      debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn(),
    }));

    agentService = require('../../src/services/agent.service');
  });

  afterEach(() => {
    jest.dontMock('../../src/config/database');
    jest.dontMock('../../src/services/integrations/mem0.service');
    jest.dontMock('../../src/utils/logger');
    if (ORIGINAL_DEFAULT === undefined) delete process.env.LIVEKIT_DEFAULT_AGENT;
    else process.env.LIVEKIT_DEFAULT_AGENT = ORIGINAL_DEFAULT;
  });

  const character = {
    id: 'char-uuid',
    agent_name: 'Cheeko',
    runtime_agent_name: null,
    system_prompt: 'Be kind.',
    soul: 'I am warm.',
    language: 'English',
  };

  it('getCharacterSession resolves the full contract, NULL runtime -> default', async () => {
    prisma.ai_agent.findUnique.mockResolvedValue(character);
    const result = await agentService.getCharacterSession('char-uuid');
    expect(result).toEqual({
      characterId: 'char-uuid',
      characterName: 'Cheeko',
      runtimeAgentName: 'cheeko-agent',
      language: 'English',
      systemPrompt: 'Be kind.',
      soul: 'I am warm.',
    });
  });

  it('getCharacterSession applies a language override', async () => {
    prisma.ai_agent.findUnique.mockResolvedValue(character);
    const result = await agentService.getCharacterSession('char-uuid', { language: 'German' });
    expect(result.language).toBe('German');
  });

  it('getCharacterSession sources persona from the template (single source), overriding the instance', async () => {
    prisma.ai_agent.findUnique.mockResolvedValue(character); // instance: 'Be kind.' / 'I am warm.'
    prisma.ai_agent_template.findFirst.mockResolvedValue({
      system_prompt: 'TEMPLATE PROMPT', soul: 'TEMPLATE SOUL', runtime_agent_name: null,
    });
    const result = await agentService.getCharacterSession('char-uuid');
    expect(result.systemPrompt).toBe('TEMPLATE PROMPT');
    expect(result.soul).toBe('TEMPLATE SOUL');
    expect(prisma.ai_agent_template.findFirst).toHaveBeenCalled();
  });

  it('getCharacterSession throws when the character is missing', async () => {
    prisma.ai_agent.findUnique.mockResolvedValue(null);
    await expect(agentService.getCharacterSession('nope')).rejects.toThrow('Character not found');
  });

  it('getCurrentCharacter returns the contract additively alongside legacy fields', async () => {
    prisma.ai_device.findUnique.mockResolvedValue({ id: 'd', mac_address: 'AA', agent_id: 'char-uuid' });
    prisma.ai_agent.findUnique.mockResolvedValue({ ...character, agent_code: 'cheeko', runtime_agent_name: 'math-tutor' });
    const result = await agentService.getCurrentCharacter('aa');
    // legacy fields preserved
    expect(result).toMatchObject({ agentId: 'char-uuid', agentName: 'Cheeko', agentCode: 'cheeko' });
    // contract added
    expect(result).toMatchObject({
      characterId: 'char-uuid',
      characterName: 'Cheeko',
      runtimeAgentName: 'math-tutor',
      language: 'English',
      systemPrompt: 'Be kind.',
      soul: 'I am warm.',
    });
  });
});
