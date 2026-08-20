/**
 * Unbinding is how a toy leaves a household, so it has to leave nothing behind.
 *
 * The next family's pairing runs adoptUnattributedRows, which hands every
 * remaining mac: row to THEIR child. Within one household that is the feature;
 * across two it is one family's child receiving another family's memory,
 * drawings and quiz history.
 */

describe('unbind releases a toy for another family', () => {
  let prisma;
  let tx;
  let deviceService;

  const MAC = '00:16:3E:7A:11:C4';
  const MAC_KEY = 'mac:00:16:3e:7a:11:c4';
  const DEVICE = { id: 'dev-1', user_id: 6n, mac_address: MAC };

  const deleteManySpy = () => jest.fn(async () => ({ count: 0 }));

  beforeEach(() => {
    jest.resetModules();

    tx = {
      ai_device: { delete: jest.fn(), update: jest.fn(), updateMany: jest.fn(async () => ({ count: 0 })), findMany: jest.fn(async () => []) },
      device_kid_assignment: { updateMany: jest.fn(async () => ({ count: 0 })), create: jest.fn(), findFirst: jest.fn(async () => null) },
      quiz_question_answer: { deleteMany: deleteManySpy(), updateMany: jest.fn() },
      riddle_question_answer: { deleteMany: deleteManySpy(), updateMany: jest.fn() },
      // Every table with the kid_id-null + device_mac fallback moves on pairing
      // and is cleared on unbind; a missing mock calls updateMany on undefined.
      math_question_answer: { deleteMany: deleteManySpy(), updateMany: jest.fn() },
      kid_character_state: { deleteMany: deleteManySpy(), updateMany: jest.fn() },
      kid_session_progress: { deleteMany: deleteManySpy(), updateMany: jest.fn() },
      kid_content_seen: { deleteMany: deleteManySpy(), updateMany: jest.fn() },
      device_workspace_artifacts: { deleteMany: deleteManySpy() },
      device_memory_documents: { deleteMany: deleteManySpy() },
      device_memory_chunks: { deleteMany: deleteManySpy() },
      imagine_image: { deleteMany: deleteManySpy(), updateMany: jest.fn() },
    };

    prisma = {
      ai_device: { findFirst: jest.fn(async () => DEVICE) },
      $transaction: jest.fn(async (fn) => fn(tx)),
    };

    jest.doMock('../../src/config/database', () => ({ prisma }));
    jest.doMock('../../src/utils/logger', () => ({ warn: jest.fn(), info: jest.fn(), error: jest.fn() }));
    deviceService = require('../../src/services/device.service');
  });

  test('every unattributed row keyed to the MAC is removed', async () => {
    await deviceService.unbindDevice(6, MAC);

    for (const model of ['device_workspace_artifacts', 'device_memory_documents', 'device_memory_chunks', 'imagine_image']) {
      expect(tx[model].deleteMany).toHaveBeenCalledWith({ where: { owner_key: MAC_KEY } });
    }
  });

  test('answers with no child are removed; a child\'s answers are not', async () => {
    await deviceService.unbindDevice(6, MAC);

    for (const table of ['quiz_question_answer', 'riddle_question_answer']) {
      expect(tx[table].deleteMany).toHaveBeenCalledWith({
        where: { device_mac: { equals: MAC, mode: 'insensitive' }, kid_id: null },
      });
    }
  });

  // The whole point: kid: rows belong to a child, not to the toy.
  test('nothing is deleted by child owner key', async () => {
    await deviceService.unbindDevice(6, MAC);

    const everyDelete = ['device_workspace_artifacts', 'device_memory_documents', 'device_memory_chunks', 'imagine_image']
      .flatMap(model => tx[model].deleteMany.mock.calls.map(c => c[0].where.owner_key));
    expect(everyDelete.every(key => String(key).startsWith('mac:'))).toBe(true);
  });

  test('the row is released to nobody rather than deleted', async () => {
    await deviceService.unbindDevice(6, MAC);

    expect(tx.ai_device.delete).not.toHaveBeenCalled();
    expect(tx.ai_device.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ user_id: null, agent_id: null, kid_id: null }),
    }));
  });

  test('an explicit hard delete still removes the row', async () => {
    await deviceService.unbindDevice(6, MAC, true, { hardDelete: true });

    expect(tx.ai_device.delete).toHaveBeenCalledWith({ where: { id: DEVICE.id } });
  });
});
