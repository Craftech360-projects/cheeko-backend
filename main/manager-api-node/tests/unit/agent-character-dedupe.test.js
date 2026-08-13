/**
 * One character, one row.
 *
 * The parent app models a toy as an agent, so it POSTs a new one per activation
 * with a name it makes unique itself ("Cheeko 2", "Cheeko 3"). The server strips
 * that suffix so the persona resolves and the name is not spoken aloud as "Cheeko
 * two" — which left the account holding four rows all called Cheeko, and one
 * child's per-character screen showing Cheeko three times.
 *
 * Creating a character the account already has returns the existing row.
 */

describe('creating a character that already exists', () => {
    let prisma;
    let agentService;

    beforeEach(() => {
        jest.resetModules();
        prisma = {
            ai_agent_template: { findFirst: jest.fn(async () => ({ agent_name: 'Cheeko', system_prompt: 'p', soul: 's', runtime_agent_name: 'cheeko-agent' })) },
            ai_agent: {
                findFirst: jest.fn(async () => null),
                create: jest.fn(async ({ data }) => ({ id: 'new-id', ...data })),
            },
        };
        jest.doMock('../../src/config/database', () => ({ prisma }));
        jest.doMock('../../src/utils/logger', () => ({ warn: jest.fn(), info: jest.fn(), error: jest.fn() }));
        agentService = require('../../src/services/agent.service');
    });

    test('returns the existing row instead of a second one', async () => {
        prisma.ai_agent.findFirst.mockResolvedValue({ id: 'existing-cheeko', agent_name: 'Cheeko' });

        const agent = await agentService.createAgent(6, { agentName: 'Cheeko' });

        expect(agent.id).toBe('existing-cheeko');
        expect(prisma.ai_agent.create).not.toHaveBeenCalled();
    });

    test('the app\'s numbered name matches the row it already has', async () => {
        // "Cheeko 2" normalises to "Cheeko", so the lookup must use the normalised
        // name — matching on the raw one would miss and create a duplicate, which
        // is exactly how the four rows appeared.
        prisma.ai_agent.findFirst.mockResolvedValue({ id: 'existing-cheeko', agent_name: 'Cheeko' });

        const agent = await agentService.createAgent(6, { agentName: 'Cheeko 2' });

        expect(agent.id).toBe('existing-cheeko');
        expect(prisma.ai_agent.create).not.toHaveBeenCalled();
        const lookup = prisma.ai_agent.findFirst.mock.calls[0][0];
        expect(lookup.where.agent_name.equals).toBe('Cheeko');
        expect(lookup.where.agent_name.mode).toBe('insensitive');
        expect(String(lookup.where.user_id)).toBe('6');
    });

    test('a character the account does not have is still created', async () => {
        const agent = await agentService.createAgent(6, { agentName: 'Nani' });

        expect(prisma.ai_agent.create).toHaveBeenCalled();
        expect(agent.agent_name).toBe('Cheeko'); // canonical name from the mocked template
    });

    test('the lookup is scoped to the account, never global', async () => {
        await agentService.createAgent(6, { agentName: 'Cheeko' });

        const lookup = prisma.ai_agent.findFirst.mock.calls[0][0];
        expect(lookup.where.user_id).toBeDefined();
    });
});
