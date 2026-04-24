describe('agent memory consolidation helpers', () => {
  let agentService;

  beforeEach(() => {
    jest.resetModules();

    jest.doMock('../../src/config/database', () => ({
      prisma: {}
    }));
    jest.doMock('../../src/services/integrations/mem0.service', () => ({
      isAvailable: jest.fn(() => false),
      searchMemories: jest.fn(),
      formatForPrompt: jest.fn(() => '')
    }));
    jest.doMock('../../src/utils/logger', () => ({
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn()
    }));

    agentService = require('../../src/services/agent.service');
  });

  afterEach(() => {
    jest.dontMock('../../src/config/database');
    jest.dontMock('../../src/services/integrations/mem0.service');
    jest.dontMock('../../src/utils/logger');
  });

  it('builds rolling memory without transcript excerpts or repeated labels', () => {
    const noisyExisting = [
      'Overall memory:',
      '- Rahul is the child using this device.',
      '- Rahul expects Cheeko to remember previous conversations.',
      '- Session summary:',
      'Cheeko greeted Rahul.',
      '',
      'Transcript excerpt:',
      'User: [System Event] The user has successfully connected.',
      'Assistant: Hello Rahul!'
    ].join('\n');

    const latestSummary = 'Rahul asked whether Cheeko remembered yesterday. Cheeko corrected from IPL to space facts and octopuses.';

    const result = agentService.__testables.buildRollingOverallMemory({
      existingMemory: noisyExisting,
      latestSummary
    });

    expect(result).toContain('Rahul is the child using this device.');
    expect(result).toContain('Rahul expects Cheeko to remember previous conversations.');
    expect(result).not.toContain('Transcript excerpt');
    expect(result).not.toContain('Session summary:');
    expect(result).not.toContain('[System Event]');
    expect(result.match(/Overall memory:/g)).toHaveLength(1);
  });

  it('builds episode memory from summary only and omits raw transcript', () => {
    const result = agentService.__testables.buildSessionEpisodeMemoryContent({
      summary: 'Rahul asked about octopuses and Venus acid rain.',
      messages: [
        { role: 'user', content: 'Tell me everything again' },
        { role: 'assistant', content: 'Long assistant answer' }
      ]
    });

    expect(result).toContain('Session summary:');
    expect(result).toContain('Rahul asked about octopuses and Venus acid rain.');
    expect(result).not.toContain('Transcript excerpt');
    expect(result).not.toContain('Tell me everything again');
    expect(result).not.toContain('Long assistant answer');
  });
});
