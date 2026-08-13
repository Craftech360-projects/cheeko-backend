/**
 * The parent app browses conversations child → character → session → transcript.
 *
 * The endpoints it had were keyed on the character alone, so two siblings on one
 * account read each other's sessions and a child who changed toys read none of
 * their own. These are keyed on the child, and the character is a filter.
 */

describe('a child\'s chat history', () => {
    let prisma;
    let mobileService;

    const USER = { id: 6n, parent_profile: { timezone: 'Asia/Kolkata' } };

    beforeEach(() => {
        jest.resetModules();
        prisma = {
            sys_user: { findUnique: jest.fn(async () => USER) },
            kid_profile: { findFirst: jest.fn(async () => ({ id: 15n })) },
            ai_device: { findMany: jest.fn(async () => [{ mac_address: '00:16:3E:7A:11:C4', kid_id: 15n }]) },
            ai_agent: { findMany: jest.fn(async () => []) },
            voice_sessions: {
                groupBy: jest.fn(async () => []),
                findMany: jest.fn(async () => []),
                count: jest.fn(async () => 0),
            },
            voice_session_messages: { findMany: jest.fn(async () => []) },
        };
        jest.doMock('../../src/config/database', () => ({ prisma }));
        jest.doMock('../../src/utils/logger', () => ({ warn: jest.fn(), info: jest.fn(), error: jest.fn() }));
        mobileService = require('../../src/services/mobile.service');
    });

    describe('the characters they have talked to', () => {
        test('one entry per character, counted', async () => {
            prisma.voice_sessions.groupBy.mockResolvedValue([
                { agent_id: 'cheeko-id', _count: { _all: 4 }, _max: { started_at: new Date('2026-08-13T09:00:00Z') } },
                { agent_id: 'quizzy-id', _count: { _all: 2 }, _max: { started_at: new Date('2026-08-12T09:00:00Z') } },
                { agent_id: 'nani-id', _count: { _all: 1 }, _max: { started_at: new Date('2026-08-11T09:00:00Z') } },
            ]);
            prisma.ai_agent.findMany.mockResolvedValue([
                { id: 'cheeko-id', agent_name: 'Cheeko' },
                { id: 'quizzy-id', agent_name: 'Quizzy' },
                { id: 'nani-id', agent_name: 'Nani' },
            ]);

            const characters = await mobileService.getKidCharacters('uid-6', '15');

            expect(characters).toHaveLength(3);
            expect(characters[0]).toEqual({
                agentId: 'cheeko-id',
                agentName: 'Cheeko',
                sessionCount: 4,
                lastSessionAt: '2026-08-13T09:00:00.000Z',
            });
            expect(characters.map(c => c.sessionCount)).toEqual([4, 2, 1]);
        });

        // A child who changed toys keeps their conversations: the rows follow the
        // child, and the toy is only a column on them.
        test('asks by child, never by toy', async () => {
            await mobileService.getKidCharacters('uid-6', '15');

            const where = prisma.voice_sessions.groupBy.mock.calls[0][0].where;
            expect(where.kid_id).toBe(15n);
            expect(where.mac_address).toBeUndefined();
        });
    });

    describe('that child\'s sessions with one character', () => {
        test('scoped to the pair, because two siblings share one Quizzy row', async () => {
            prisma.voice_sessions.count.mockResolvedValue(1);
            prisma.voice_sessions.findMany.mockResolvedValue([{
                session_id: 'room-1',
                started_at: new Date('2026-08-13T09:00:00Z'),
                ended_at: new Date('2026-08-13T09:06:00Z'),
                _count: { voice_session_messages: 12 },
                voice_session_summaries: { summary: 'Talked about planets.' },
            }]);

            const page = await mobileService.getKidCharacterSessions('uid-6', '15', 'quizzy-id');

            // agent_id is an `in` list because duplicate rows for one character
            // are read as one character; with no duplicates it holds just this id.
            expect(prisma.voice_sessions.findMany.mock.calls[0][0].where)
                .toEqual({ kid_id: 15n, agent_id: { in: ['quizzy-id'] } });
            expect(page).toEqual({
                total: 1,
                list: [{
                    sessionId: 'room-1',
                    startedAt: '2026-08-13T09:00:00.000Z',
                    endedAt: '2026-08-13T09:06:00.000Z',
                    messageCount: 12,
                    summary: 'Talked about planets.',
                }],
            });
        });

        test('the sibling on the same account resolves to their own child', async () => {
            prisma.kid_profile.findFirst.mockResolvedValue({ id: 16n });

            await mobileService.getKidCharacterSessions('uid-6', '16', 'quizzy-id');

            expect(prisma.voice_sessions.findMany.mock.calls[0][0].where.kid_id).toBe(16n);
        });
    });

    describe('the transcript', () => {
        test('reaches the child through the session, which is what carries them', async () => {
            prisma.voice_session_messages.findMany.mockResolvedValue([
                { sequence: 1, role: 'user', content: 'Hello', created_at: new Date('2026-08-13T09:00:01Z') },
            ]);

            const page = await mobileService.getKidSessionMessages('uid-6', '15', 'room-1');

            const where = prisma.voice_session_messages.findMany.mock.calls[0][0].where;
            expect(where.voice_sessions).toEqual({ kid_id: 15n });
            // A message has no child column and must not gain one.
            expect(where.kid_id).toBeUndefined();
            expect(page.messages).toEqual([
                { sequence: 1, role: 'user', content: 'Hello', createdAt: '2026-08-13T09:00:01.000Z' },
            ]);
            expect(page.hasMore).toBe(false);
        });

        test('pages on the cursor the last page handed back', async () => {
            prisma.voice_session_messages.findMany.mockResolvedValue(
                Array.from({ length: 3 }, (_, i) => ({
                    sequence: i + 1, role: 'user', content: 'x', created_at: new Date('2026-08-13T09:00:00Z'),
                }))
            );

            const page = await mobileService.getKidSessionMessages('uid-6', '15', 'room-1', { limit: 2, cursor: '4' });

            expect(prisma.voice_session_messages.findMany.mock.calls[0][0].where.sequence).toEqual({ gt: 4 });
            expect(page.hasMore).toBe(true);
            expect(page.nextCursor).toBe(2);
            expect(page.messages).toHaveLength(2);
        });
    });

    describe('another family\'s child', () => {
        test('is refused, not answered', async () => {
            prisma.kid_profile.findFirst.mockResolvedValue(null);

            await expect(mobileService.getKidCharacters('uid-6', '999'))
                .rejects.toMatchObject({ statusCode: 404 });
            expect(prisma.voice_sessions.groupBy).not.toHaveBeenCalled();
        });

        test('is refused on the transcript too', async () => {
            prisma.kid_profile.findFirst.mockResolvedValue(null);

            await expect(mobileService.getKidSessionMessages('uid-6', '999', 'room-1'))
                .rejects.toMatchObject({ statusCode: 404 });
            expect(prisma.voice_session_messages.findMany).not.toHaveBeenCalled();
        });

        test('a malformed kid id is refused rather than ignored', async () => {
            await expect(mobileService.getKidCharacters('uid-6', 'not-an-id'))
                .rejects.toMatchObject({ statusCode: 400 });
            expect(prisma.kid_profile.findFirst).not.toHaveBeenCalled();
        });

        test('the child is checked against the caller\'s account', async () => {
            await mobileService.getKidCharacters('uid-6', '15');

            expect(prisma.kid_profile.findFirst).toHaveBeenCalledWith(expect.objectContaining({
                where: { id: 15n, user_id: USER.id },
            }));
        });
    });
});

/**
 * Duplicate agent rows existed before the create path was deduped, so the read
 * must merge them or Kishore keeps seeing Cheeko three times: 71 sessions under
 * one row, 1 under each of two others.
 */
describe('a child whose account holds duplicate character rows', () => {
    let prisma;
    let mobileService;

    const USER = { id: 6n, parent_profile: { timezone: 'Asia/Kolkata' } };

    beforeEach(() => {
        jest.resetModules();
        prisma = {
            sys_user: { findUnique: jest.fn(async () => USER) },
            kid_profile: { findFirst: jest.fn(async () => ({ id: 15n })) },
            ai_device: { findMany: jest.fn(async () => [{ mac_address: '00:16:3E:7A:11:C4', kid_id: 15n }]) },
            ai_agent: { findMany: jest.fn(async () => []) },
            voice_sessions: {
                groupBy: jest.fn(async () => []),
                findMany: jest.fn(async () => []),
                count: jest.fn(async () => 0),
            },
            voice_session_messages: { findMany: jest.fn(async () => []) },
        };
        jest.doMock('../../src/config/database', () => ({ prisma }));
        jest.doMock('../../src/utils/logger', () => ({ warn: jest.fn(), info: jest.fn(), error: jest.fn() }));
        mobileService = require('../../src/services/mobile.service');
    });

    const threeCheekos = () => {
        prisma.voice_sessions.groupBy.mockResolvedValue([
            { agent_id: 'cheeko-a', _count: { _all: 71 }, _max: { started_at: new Date('2026-08-07T14:18:00Z') } },
            { agent_id: 'cheeko-b', _count: { _all: 1 }, _max: { started_at: new Date('2026-08-13T08:40:00Z') } },
            { agent_id: 'cheeko-c', _count: { _all: 1 }, _max: { started_at: new Date('2026-08-03T06:40:00Z') } },
            { agent_id: 'nani-id', _count: { _all: 1 }, _max: { started_at: new Date('2026-08-13T15:05:00Z') } },
        ]);
        prisma.ai_agent.findMany.mockResolvedValue([
            { id: 'cheeko-a', agent_name: 'Cheeko' },
            { id: 'cheeko-b', agent_name: 'Cheeko' },
            { id: 'cheeko-c', agent_name: 'cheeko 2' },
            { id: 'nani-id', agent_name: 'NANI' },
        ]);
    };

    test('one entry per character, with the counts summed', async () => {
        threeCheekos();

        const characters = await mobileService.getKidCharacters('uid', '15');

        expect(characters).toHaveLength(2);
        const cheeko = characters.find(c => c.agentName.toLowerCase() === 'cheeko');
        expect(cheeko.sessionCount).toBe(73);
        // The newest of the three, not whichever row happened to sort first.
        expect(cheeko.lastSessionAt).toBe(new Date('2026-08-13T08:40:00Z').toISOString());
    });

    test('the entry names an agentId the sessions endpoint can be called with', async () => {
        threeCheekos();

        const characters = await mobileService.getKidCharacters('uid', '15');
        const cheeko = characters.find(c => c.agentName.toLowerCase() === 'cheeko');

        expect(['cheeko-a', 'cheeko-b', 'cheeko-c']).toContain(cheeko.agentId);
    });

    test('asking for one duplicate returns the sessions of all of them', async () => {
        threeCheekos();

        await mobileService.getKidCharacterSessions('uid', '15', 'cheeko-b');

        const where = prisma.voice_sessions.findMany.mock.calls[0][0].where;
        expect(where.kid_id).toBe(15n);
        expect(where.agent_id.in.sort()).toEqual(['cheeko-a', 'cheeko-b', 'cheeko-c']);
    });

    test('a character with one row is unaffected', async () => {
        threeCheekos();

        await mobileService.getKidCharacterSessions('uid', '15', 'nani-id');

        const where = prisma.voice_sessions.findMany.mock.calls[0][0].where;
        expect(where.agent_id.in).toEqual(['nani-id']);
    });
});
