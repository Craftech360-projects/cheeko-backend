describe('kid data service', () => {
  let prisma;
  let tx;
  let upload;
  let service;
  let calls;

  // A tx whose every model records "<model>.<op>" and answers like Prisma.
  const recordingModels = () => new Proxy({}, {
    get: (target, model) => {
      if (!target[model]) {
        target[model] = {
          deleteMany: jest.fn(async (args) => { calls.push(`${model}.deleteMany`); return { count: 1, args }; }),
          updateMany: jest.fn(async (args) => { calls.push(`${model}.updateMany`); return { count: 1, args }; }),
          findMany: jest.fn(async () => { calls.push(`${model}.findMany`); return []; }),
          delete: jest.fn(async () => { calls.push(`${model}.delete`); return {}; })
        };
      }
      return target[model];
    }
  });

  beforeEach(() => {
    jest.resetModules();
    calls = [];
    tx = recordingModels();
    prisma = recordingModels();
    prisma.$transaction = jest.fn(async (arg) => (typeof arg === 'function' ? arg(tx) : Promise.all(arg)));
    prisma.kid_profile.findUnique = jest.fn(async () => ({ avatar_url: 'https://cdn.test/avatars/42.png' }));
    upload = {
      deleteImagineObject: jest.fn(async () => {}),
      deleteKidAvatarByUrl: jest.fn(async () => {}),
      deleteCustomCardObject: jest.fn(async () => {})
    };
    jest.doMock('../../src/config/database', () => ({ prisma }));
    jest.doMock('../../src/utils/logger', () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }));
    jest.doMock('../../src/services/upload.service', () => upload);
    jest.doMock('../../src/services/mobile.service', () => ({
      deleteCustomPackForKid: jest.fn(async () => { calls.push('custom-pack'); return ['https://cdn.test/customcard_kid42/a.mp3']; })
    }));
    service = require('../../src/services/kid-data.service');
  });

  afterEach(() => {
    delete process.env.CHILD_DATA_RETENTION_DAYS;
  });

  it('deletes every kid-owned table, detaches counters and sessions, and returns the pictures to sweep', async () => {
    tx.imagine_image.findMany = jest.fn(async () => [{ s3_key: 'imagine/aa/1.jpg' }]);

    const result = await service.purgeKidData(tx, 42);

    for (const model of service.KID_OWNED_TABLES) {
      expect(tx[model].deleteMany).toHaveBeenCalledWith({ where: { kid_id: 42n } });
    }
    for (const model of service.KID_OWNER_KEY_TABLES) {
      expect(tx[model].deleteMany).toHaveBeenCalledWith({ where: { owner_key: 'kid:42' } });
    }
    for (const model of service.KID_TAGGED_COUNTERS) {
      expect(tx[model].updateMany).toHaveBeenCalledWith({ where: { kid_id: 42n }, data: { kid_id: null } });
    }
    // What the child said goes; the session row (usage accounting) stays, unlinked.
    expect(tx.voice_session_messages.deleteMany).toHaveBeenCalledWith({ where: { voice_sessions: { kid_id: 42n } } });
    expect(tx.voice_sessions.updateMany).toHaveBeenCalledWith({ where: { kid_id: 42n }, data: { kid_id: null } });
    expect(tx.voice_sessions.deleteMany).not.toHaveBeenCalled();
    expect(tx.imagine_image.deleteMany).toHaveBeenCalledWith({ where: { owner_key: 'kid:42' } });
    expect(result).toEqual({ imagineKeys: ['imagine/aa/1.jpg'] });
  });

  it('deleteKidCompletely purges before the profile row and sweeps storage after the commit', async () => {
    await service.deleteKidCompletely(42);

    expect(calls.indexOf('child_facts.deleteMany')).toBeLessThan(calls.indexOf('kid_profile.delete'));
    expect(calls.indexOf('custom-pack')).toBeLessThan(calls.indexOf('kid_profile.delete'));
    expect(upload.deleteKidAvatarByUrl).toHaveBeenCalledWith('https://cdn.test/avatars/42.png');
    expect(upload.deleteCustomCardObject).toHaveBeenCalledWith('customcard_kid42/a.mp3');
  });

  it('refuses an unknown child without touching anything', async () => {
    prisma.kid_profile.findUnique = jest.fn(async () => null);

    await expect(service.deleteKidCompletely(42)).rejects.toThrow('Kid profile not found');
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('expires nothing while no retention window is set', async () => {
    const result = await service.expireOldChildData();

    expect(result).toEqual({ days: null, deleted: {} });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('expires conversation data older than the window, keeping sessions and progress', async () => {
    process.env.CHILD_DATA_RETENTION_DAYS = '90';
    const now = new Date('2026-09-18T00:00:00Z');
    const cutoff = new Date('2026-06-20T00:00:00Z');

    const result = await service.expireOldChildData({ now });

    expect(result.days).toBe(90);
    expect(prisma.voice_session_messages.deleteMany).toHaveBeenCalledWith({ where: { created_at: { lt: cutoff } } });
    expect(prisma.voice_session_summaries.deleteMany).toHaveBeenCalledWith({ where: { updated_at: { lt: cutoff } } });
    expect(prisma.child_facts.deleteMany).toHaveBeenCalledWith({ where: { last_seen: { lt: cutoff } } });
    expect(prisma.question_attempt.updateMany).toHaveBeenCalledWith({
      where: { answered_at: { lt: cutoff }, transcript: { not: null } },
      data: { transcript: null }
    });
    expect(prisma.voice_sessions.deleteMany).not.toHaveBeenCalled();
    expect(prisma.quiz_question_answer.deleteMany).not.toHaveBeenCalled();
  });
});
