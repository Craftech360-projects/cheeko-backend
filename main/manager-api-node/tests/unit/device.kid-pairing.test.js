'use strict';

jest.mock('../../src/config/database', () => {
  const prisma = {
    ai_device: {
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      findMany: jest.fn(),
      update: jest.fn(),
      create: jest.fn(),
      delete: jest.fn(),
    },
    ai_agent: {
      findFirst: jest.fn(),
    },
    kid_profile: {
      findFirst: jest.fn(),
      findMany: jest.fn(),
    },
    device_kid_assignment: {
      findFirst: jest.fn(),
      updateMany: jest.fn(),
      create: jest.fn(),
    },
    quiz_question_answer: { updateMany: jest.fn(), deleteMany: jest.fn(async () => ({ count: 0 })) },
    riddle_question_answer: { updateMany: jest.fn(), deleteMany: jest.fn(async () => ({ count: 0 })) },
    // Every table carrying the kid_id-null + device_mac fallback is adopted on
    // pairing and cleared on unbind; a missing mock here means the real code
    // calls updateMany on undefined.
    math_question_answer: { updateMany: jest.fn(), deleteMany: jest.fn(async () => ({ count: 0 })) },
    kid_character_state: { updateMany: jest.fn(), deleteMany: jest.fn(async () => ({ count: 0 })) },
    kid_session_progress: { updateMany: jest.fn(), deleteMany: jest.fn(async () => ({ count: 0 })) },
    kid_content_seen: { updateMany: jest.fn(), deleteMany: jest.fn(async () => ({ count: 0 })) },
    device_workspace_artifacts: { updateMany: jest.fn(), findMany: jest.fn(), update: jest.fn(), delete: jest.fn(), deleteMany: jest.fn(async () => ({ count: 0 })) },
    device_memory_documents: { updateMany: jest.fn(), findMany: jest.fn(), update: jest.fn(), delete: jest.fn(), deleteMany: jest.fn(async () => ({ count: 0 })) },
    device_memory_chunks: { updateMany: jest.fn(), findMany: jest.fn(), update: jest.fn(), delete: jest.fn(), deleteMany: jest.fn(async () => ({ count: 0 })) },
    imagine_image: { updateMany: jest.fn(), deleteMany: jest.fn(async () => ({ count: 0 })) },
    // Mocked so a stray call is caught rather than throwing on undefined.
    // Nothing on the pairing path may touch these — see the custom pack tests
    // at the bottom of this file.
    rfid_content_pack: { findFirst: jest.fn(), updateMany: jest.fn(), delete: jest.fn(), deleteMany: jest.fn() },
    content_item: { findMany: jest.fn(), deleteMany: jest.fn() },
    $transaction: jest.fn(),
  };
  return { prisma };
});

const { prisma } = require('../../src/config/database');
const deviceService = require('../../src/services/device.service');

const MAC = 'AA:BB:CC:DD:EE:FF';

describe('device pairing to a child', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    prisma.$transaction.mockImplementation((fn) => fn(prisma));
    prisma.device_kid_assignment.findFirst.mockResolvedValue(null);
    prisma.device_kid_assignment.updateMany.mockResolvedValue({ count: 0 });
    prisma.device_kid_assignment.create.mockResolvedValue({ id: 1n });
    prisma.quiz_question_answer.updateMany.mockResolvedValue({ count: 0 });
    prisma.riddle_question_answer.updateMany.mockResolvedValue({ count: 0 });
    prisma.ai_device.findMany.mockResolvedValue([]);
    for (const m of ['device_workspace_artifacts', 'device_memory_documents', 'device_memory_chunks']) {
      prisma[m].findMany.mockResolvedValue([]);
      prisma[m].updateMany.mockResolvedValue({ count: 0 });
      prisma[m].update.mockResolvedValue({});
    }
  });

  describe('pairing adopts what the device wrote before it had a child', () => {
    it('claims unattributed quiz and riddle answers for the incoming child', async () => {
      prisma.kid_profile.findFirst.mockResolvedValue({ id: 9n });
      prisma.ai_device.findFirst.mockResolvedValue({
        id: 'device-1', mac_address: MAC, kid_id: null,
      });
      prisma.ai_device.update.mockResolvedValue({ id: 'device-1', kid_id: 9n });

      await deviceService.assignKidByMac(MAC, '9', 12n);

      const expected = {
        where: { device_mac: { equals: MAC, mode: 'insensitive' }, kid_id: null },
        data: { kid_id: 9n },
      };
      expect(prisma.quiz_question_answer.updateMany).toHaveBeenCalledWith(expected);
      expect(prisma.riddle_question_answer.updateMany).toHaveBeenCalledWith(expected);
    });

    it('cannot steal rows already attributed to a sibling', async () => {
      prisma.kid_profile.findFirst.mockResolvedValue({ id: 9n });
      prisma.ai_device.findFirst.mockResolvedValue({
        id: 'device-1', mac_address: MAC, kid_id: 7n,
      });
      prisma.ai_device.update.mockResolvedValue({ id: 'device-1', kid_id: 9n });

      await deviceService.assignKidByMac(MAC, '9', 12n);

      // The guard is in the where clause, not in a caller remembering to check.
      expect(prisma.quiz_question_answer.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ kid_id: null }) }),
      );
    });

    it('moves the workspace and memory out of the MAC namespace into the child', async () => {
      prisma.kid_profile.findFirst.mockResolvedValue({ id: 9n });
      prisma.ai_device.findFirst.mockResolvedValue({
        id: 'device-1', mac_address: MAC, kid_id: null,
      });
      prisma.ai_device.update.mockResolvedValue({ id: 'device-1', kid_id: 9n });
      // One provisional file on this toy, nothing of the child's to clash with.
      prisma.device_workspace_artifacts.findMany
        .mockResolvedValueOnce([{ id: 'a1', relative_path: 'USER.md', updated_at: new Date(1) }])
        .mockResolvedValueOnce([]);

      await deviceService.assignKidByMac(MAC, '9', 12n);

      const expected = {
        where: { owner_key: 'mac:aa:bb:cc:dd:ee:ff' },
        data: { owner_key: 'kid:9' },
      };
      expect(prisma.device_workspace_artifacts.updateMany).toHaveBeenCalledWith(expected);
      expect(prisma.device_workspace_artifacts.delete).not.toHaveBeenCalled();
    });

    it('resolves a collision instead of failing the whole pairing', async () => {
      prisma.kid_profile.findFirst.mockResolvedValue({ id: 9n });
      prisma.ai_device.findFirst.mockResolvedValue({
        id: 'device-1', mac_address: MAC, kid_id: null,
      });
      prisma.ai_device.update.mockResolvedValue({ id: 'device-1', kid_id: 9n });
      // The toy has a MEMORY.md and so does the child: a blanket update would
      // violate (owner_key, relative_path) and roll the pairing back.
      prisma.device_workspace_artifacts.findMany
        .mockResolvedValueOnce([{ id: 'incoming', relative_path: 'MEMORY.md', updated_at: new Date(2000) }])
        .mockResolvedValueOnce([{ id: 'held', relative_path: 'MEMORY.md', updated_at: new Date(1000) }]);

      await deviceService.assignKidByMac(MAC, '9', 12n);

      // Newest wins over what is SERVED. The loser is retired to a namespace no
      // reader asks for, not deleted: these are two different files that happen
      // to share a name, and one of them is a child's memory.
      expect(prisma.device_workspace_artifacts.delete).not.toHaveBeenCalled();
      expect(prisma.device_workspace_artifacts.update).toHaveBeenCalledWith({
        where: { id: 'held' },
        data: { owner_key: 'superseded:kid:9:held' },
      });
      expect(prisma.device_workspace_artifacts.updateMany).toHaveBeenCalled();
    });

    it('keeps the child copy when the one on the toy is older', async () => {
      prisma.kid_profile.findFirst.mockResolvedValue({ id: 9n });
      prisma.ai_device.findFirst.mockResolvedValue({
        id: 'device-1', mac_address: MAC, kid_id: null,
      });
      prisma.ai_device.update.mockResolvedValue({ id: 'device-1', kid_id: 9n });
      prisma.device_workspace_artifacts.findMany
        .mockResolvedValueOnce([{ id: 'incoming', relative_path: 'MEMORY.md', updated_at: new Date(1000) }])
        .mockResolvedValueOnce([{ id: 'held', relative_path: 'MEMORY.md', updated_at: new Date(2000) }]);

      await deviceService.assignKidByMac(MAC, '9', 12n);

      expect(prisma.device_workspace_artifacts.delete).not.toHaveBeenCalled();
      expect(prisma.device_workspace_artifacts.update).toHaveBeenCalledWith({
        where: { id: 'incoming' },
        data: { owner_key: 'superseded:kid:9:incoming' },
      });
    });

    // The bug this pair of tests exists for. A parent lost 67 memory documents
    // and 71 sessions because the loser was deleted, and the child's file from
    // their old toy is always the older one — so it was always the casualty.
    it('never destroys a memory document on a collision', async () => {
      prisma.kid_profile.findFirst.mockResolvedValue({ id: 9n });
      prisma.ai_device.findFirst.mockResolvedValue({
        id: 'device-1', mac_address: MAC, kid_id: null,
      });
      prisma.ai_device.update.mockResolvedValue({ id: 'device-1', kid_id: 9n });
      prisma.device_memory_documents.findMany
        .mockResolvedValueOnce([{ id: 'toy-doc', document_key: 'MEMORY.md', updated_at: new Date(2000) }])
        .mockResolvedValueOnce([{ id: 'child-doc', document_key: 'MEMORY.md', updated_at: new Date(1000) }]);

      await deviceService.assignKidByMac(MAC, '9', 12n);

      expect(prisma.device_memory_documents.delete).not.toHaveBeenCalled();
      expect(prisma.device_memory_documents.update).toHaveBeenCalledWith({
        where: { id: 'child-doc' },
        data: { owner_key: 'superseded:kid:9:child-doc' },
      });
    });

    it('still deletes a colliding memory CHUNK, because those are identical', async () => {
      prisma.kid_profile.findFirst.mockResolvedValue({ id: 9n });
      prisma.ai_device.findFirst.mockResolvedValue({
        id: 'device-1', mac_address: MAC, kid_id: null,
      });
      prisma.ai_device.update.mockResolvedValue({ id: 'device-1', kid_id: 9n });
      // Chunks collide on content_hash, so the two rows are byte-identical by
      // definition and keeping the duplicate preserves nothing. Retiring it
      // instead would grow the table forever for no recoverable content.
      prisma.device_memory_chunks.findMany
        .mockResolvedValueOnce([{ id: 'incoming', content_hash: 'abc123', created_at: new Date(2000) }])
        .mockResolvedValueOnce([{ id: 'held', content_hash: 'abc123', created_at: new Date(1000) }]);

      await deviceService.assignKidByMac(MAC, '9', 12n);

      expect(prisma.device_memory_chunks.delete).toHaveBeenCalledWith({ where: { id: 'held' } });
      expect(prisma.device_memory_chunks.update).not.toHaveBeenCalled();
    });

    it('releases the child from any other toy, so one child is never on two', async () => {
      prisma.kid_profile.findFirst.mockResolvedValue({ id: 9n });
      prisma.ai_device.findFirst.mockResolvedValue({
        id: 'device-1', mac_address: MAC, kid_id: null,
      });
      // The child is already sitting on a different toy.
      prisma.ai_device.findMany.mockResolvedValue([{ mac_address: '11:22:33:44:55:66' }]);
      prisma.ai_device.update.mockResolvedValue({ id: 'device-1', kid_id: 9n });

      await deviceService.assignKidByMac(MAC, '9', 12n);

      expect(prisma.ai_device.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { kid_id: 9n, mac_address: { not: MAC } },
        }),
      );
      // The old toy is unpaired in the same transaction as the new pairing.
      expect(prisma.ai_device.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { mac_address: '11:22:33:44:55:66' },
          data: expect.objectContaining({ kid_id: null }),
        }),
      );
    });

    it('does not release anything when the child has no other toy', async () => {
      prisma.kid_profile.findFirst.mockResolvedValue({ id: 9n });
      prisma.ai_device.findFirst.mockResolvedValue({
        id: 'device-1', mac_address: MAC, kid_id: null,
      });
      prisma.ai_device.findMany.mockResolvedValue([]);
      prisma.ai_device.update.mockResolvedValue({ id: 'device-1', kid_id: 9n });

      await deviceService.assignKidByMac(MAC, '9', 12n);

      expect(prisma.ai_device.update).toHaveBeenCalledTimes(1);
    });

    it('adopts nothing when unpairing', async () => {
      prisma.ai_device.findFirst.mockResolvedValue({
        id: 'device-1', mac_address: MAC, kid_id: 7n,
      });
      prisma.ai_device.update.mockResolvedValue({ id: 'device-1', kid_id: null });

      await deviceService.assignKidByMac(MAC, null, 12n);

      expect(prisma.quiz_question_answer.updateMany).not.toHaveBeenCalled();
    });
  });

  describe('bindDevice auto-pairs when the owner has exactly one child', () => {
    const AGENT = 'agent-1';

    beforeEach(() => {
      prisma.ai_agent.findFirst.mockResolvedValue({ id: AGENT });
    });

    it('pairs the sole child of the owner', async () => {
      prisma.ai_device.findUnique.mockResolvedValue({
        id: 'device-1', mac_address: MAC, user_id: 12n, kid_id: null,
      });
      prisma.kid_profile.findMany.mockResolvedValue([{ id: 7n }]);
      prisma.ai_device.update.mockResolvedValue({ id: 'device-1', kid_id: 7n });

      await deviceService.bindDevice(12, AGENT, MAC);

      expect(prisma.ai_device.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ kid_id: 7n }) }),
      );
      expect(prisma.device_kid_assignment.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ mac_address: MAC, kid_id: 7n }),
      });
    });

    it('leaves kid_id null when the owner has no children', async () => {
      prisma.ai_device.findUnique.mockResolvedValue({
        id: 'device-1', mac_address: MAC, user_id: 12n, kid_id: null,
      });
      prisma.kid_profile.findMany.mockResolvedValue([]);
      prisma.ai_device.update.mockResolvedValue({ id: 'device-1', kid_id: null });

      await deviceService.bindDevice(12, AGENT, MAC);

      const data = prisma.ai_device.update.mock.calls[0][0].data;
      expect(data.kid_id).toBeUndefined();
      expect(prisma.device_kid_assignment.create).not.toHaveBeenCalled();
    });

    it('leaves kid_id null when the owner has several children, for the picker', async () => {
      prisma.ai_device.findUnique.mockResolvedValue({
        id: 'device-1', mac_address: MAC, user_id: 12n, kid_id: null,
      });
      prisma.kid_profile.findMany.mockResolvedValue([{ id: 7n }, { id: 9n }]);
      prisma.ai_device.update.mockResolvedValue({ id: 'device-1', kid_id: null });

      await deviceService.bindDevice(12, AGENT, MAC);

      const data = prisma.ai_device.update.mock.calls[0][0].data;
      expect(data.kid_id).toBeUndefined();
    });

    it('pairs the child the app sent, even when the owner has several', async () => {
      prisma.ai_device.findUnique.mockResolvedValue({
        id: 'device-1', mac_address: MAC, user_id: 12n, kid_id: null,
      });
      prisma.kid_profile.findFirst.mockResolvedValue({ id: 9n });
      prisma.ai_device.update.mockResolvedValue({ id: 'device-1', kid_id: 9n });

      await deviceService.bindDevice(12, AGENT, MAC, '9');

      expect(prisma.ai_device.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ kid_id: 9n }) }),
      );
      expect(prisma.kid_profile.findMany).not.toHaveBeenCalled();
    });

    it('refuses a child the binding user does not own', async () => {
      prisma.ai_device.findUnique.mockResolvedValue({
        id: 'device-1', mac_address: MAC, user_id: 12n, kid_id: null,
      });
      prisma.kid_profile.findFirst.mockResolvedValue(null);

      await expect(
        deviceService.bindDevice(12, AGENT, MAC, '9'),
      ).rejects.toThrow('Kid profile not found');

      expect(prisma.ai_device.update).not.toHaveBeenCalled();
    });

    it('falls back to the sole child when the app sends no kid id', async () => {
      prisma.ai_device.findUnique.mockResolvedValue({
        id: 'device-1', mac_address: MAC, user_id: 12n, kid_id: null,
      });
      prisma.kid_profile.findMany.mockResolvedValue([{ id: 7n }]);
      prisma.ai_device.update.mockResolvedValue({ id: 'device-1', kid_id: 7n });

      await deviceService.bindDevice(12, AGENT, MAC);

      expect(prisma.kid_profile.findMany).toHaveBeenCalled();
      expect(prisma.ai_device.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ kid_id: 7n }) }),
      );
    });

    it('re-pairs an already-paired device when the app sends an explicit kid id', async () => {
      prisma.ai_device.findUnique.mockResolvedValue({
        id: 'device-1', mac_address: MAC, user_id: 12n, kid_id: 3n,
      });
      prisma.kid_profile.findFirst.mockResolvedValue({ id: 9n });
      prisma.ai_device.update.mockResolvedValue({ id: 'device-1', kid_id: 9n });

      await deviceService.bindDevice(12, AGENT, MAC, '9');

      expect(prisma.ai_device.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ kid_id: 9n }) }),
      );
    });

    it('does not overwrite a device that is already paired', async () => {
      prisma.ai_device.findUnique.mockResolvedValue({
        id: 'device-1', mac_address: MAC, user_id: 12n, kid_id: 3n,
      });
      prisma.kid_profile.findMany.mockResolvedValue([{ id: 7n }]);
      prisma.ai_device.update.mockResolvedValue({ id: 'device-1', kid_id: 3n });

      await deviceService.bindDevice(12, AGENT, MAC);

      const data = prisma.ai_device.update.mock.calls[0][0].data;
      expect(data.kid_id).toBeUndefined();
      expect(prisma.kid_profile.findMany).not.toHaveBeenCalled();
    });
  });

  describe('assignKidByMac re-pairs instead of refusing', () => {
    it('re-pairs a device that already has a different child', async () => {
      prisma.kid_profile.findFirst.mockResolvedValue({ id: 9n });
      prisma.ai_device.findFirst.mockResolvedValue({
        id: 'device-1', mac_address: MAC, kid_id: 7n,
      });
      prisma.ai_device.update.mockResolvedValue({ id: 'device-1', kid_id: 9n });

      await expect(
        deviceService.assignKidByMac(MAC, '9', 12n),
      ).resolves.toEqual({ id: 'device-1', kid_id: 9n });

      expect(prisma.ai_device.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ kid_id: 9n }) }),
      );
    });

    it('closes the outgoing child assignment and opens one for the incoming child', async () => {
      prisma.kid_profile.findFirst.mockResolvedValue({ id: 9n });
      prisma.ai_device.findFirst.mockResolvedValue({
        id: 'device-1', mac_address: MAC, kid_id: 7n,
      });
      prisma.device_kid_assignment.findFirst.mockResolvedValue({ id: 5n, kid_id: 7n });
      prisma.ai_device.update.mockResolvedValue({ id: 'device-1', kid_id: 9n });

      await deviceService.assignKidByMac(MAC, '9', 12n);

      expect(prisma.device_kid_assignment.updateMany).toHaveBeenCalledWith({
        where: { mac_address: MAC, ended_at: null },
        data: { ended_at: expect.any(Date) },
      });
      expect(prisma.device_kid_assignment.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ mac_address: MAC, kid_id: 9n }),
      });
    });

    it('leaves the open assignment alone when the same child is re-saved', async () => {
      prisma.kid_profile.findFirst.mockResolvedValue({ id: 7n });
      prisma.ai_device.findFirst.mockResolvedValue({
        id: 'device-1', mac_address: MAC, kid_id: 7n,
      });
      prisma.device_kid_assignment.findFirst.mockResolvedValue({ id: 5n, kid_id: 7n });
      prisma.ai_device.update.mockResolvedValue({ id: 'device-1', kid_id: 7n });

      await deviceService.assignKidByMac(MAC, '7', 12n);

      expect(prisma.device_kid_assignment.updateMany).not.toHaveBeenCalled();
      expect(prisma.device_kid_assignment.create).not.toHaveBeenCalled();
    });

    it('closes the open assignment when the child is cleared', async () => {
      prisma.ai_device.findFirst.mockResolvedValue({
        id: 'device-1', mac_address: MAC, kid_id: 7n,
      });
      prisma.device_kid_assignment.findFirst.mockResolvedValue({ id: 5n, kid_id: 7n });
      prisma.ai_device.update.mockResolvedValue({ id: 'device-1', kid_id: null });

      await deviceService.assignKidByMac(MAC, null, 12n);

      expect(prisma.device_kid_assignment.updateMany).toHaveBeenCalled();
      expect(prisma.device_kid_assignment.create).not.toHaveBeenCalled();
    });
  });

  describe('assignKidByMac scopes to the caller', () => {
    it('refuses without a user id rather than pairing any device by MAC', async () => {
      await expect(
        deviceService.assignKidByMac(MAC, '9'),
      ).rejects.toThrow(/user/i);

      expect(prisma.ai_device.update).not.toHaveBeenCalled();
    });

    it('does not find a device belonging to someone else', async () => {
      prisma.kid_profile.findFirst.mockResolvedValue({ id: 9n });
      prisma.ai_device.findFirst.mockResolvedValue(null);

      await expect(
        deviceService.assignKidByMac(MAC, '9', 12n),
      ).rejects.toThrow('Device not found');

      expect(prisma.ai_device.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ user_id: 12n }),
        }),
      );
    });
  });

  describe('unbinding', () => {
    it('closes the open assignment and clears kid_id', async () => {
      prisma.ai_device.findFirst.mockResolvedValue({
        id: 'device-1', mac_address: MAC, user_id: 12n,
      });
      prisma.device_kid_assignment.findFirst.mockResolvedValue({ id: 5n, kid_id: 7n });
      prisma.ai_device.update.mockResolvedValue({ id: 'device-1' });

      await deviceService.unbindDevice(12, MAC);

      expect(prisma.ai_device.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ kid_id: null }) }),
      );
      expect(prisma.device_kid_assignment.updateMany).toHaveBeenCalledWith({
        where: { mac_address: MAC, ended_at: null },
        data: { ended_at: expect.any(Date) },
      });
    });

    it('closes the assignment on a hard delete too', async () => {
      prisma.ai_device.findFirst.mockResolvedValue({
        id: 'device-1', mac_address: MAC, user_id: 12n,
      });
      prisma.device_kid_assignment.findFirst.mockResolvedValue({ id: 5n, kid_id: 7n });
      prisma.ai_device.delete.mockResolvedValue({ id: 'device-1' });

      await deviceService.unbindDevice(12, MAC, false, { hardDelete: true });

      expect(prisma.device_kid_assignment.updateMany).toHaveBeenCalled();
      expect(prisma.ai_device.delete).toHaveBeenCalled();
    });

    it('does nothing to assignments when the device was never paired', async () => {
      prisma.ai_device.findFirst.mockResolvedValue({
        id: 'device-1', mac_address: MAC, user_id: 12n,
      });
      prisma.ai_device.update.mockResolvedValue({ id: 'device-1' });

      await deviceService.unbindDevice(12, MAC);

      expect(prisma.device_kid_assignment.updateMany).not.toHaveBeenCalled();
      expect(prisma.device_kid_assignment.create).not.toHaveBeenCalled();
    });
  });

  // A custom card pack is keyed on the child (CUSTOM_KID_<id>), so it needs no
  // handover: the recordings follow the child to the new toy by construction.
  // These assertions are the guarantee that rests on — the day something starts
  // moving packs on pairing is the day the binding quietly reverts to the toy.
  describe('custom card packs are not part of the handover', () => {
    const expectPacksUntouched = () => {
      expect(prisma.rfid_content_pack.findFirst).not.toHaveBeenCalled();
      expect(prisma.rfid_content_pack.updateMany).not.toHaveBeenCalled();
      expect(prisma.rfid_content_pack.delete).not.toHaveBeenCalled();
      expect(prisma.rfid_content_pack.deleteMany).not.toHaveBeenCalled();
      expect(prisma.content_item.deleteMany).not.toHaveBeenCalled();
    };

    it('pairing a child to a toy leaves every pack alone', async () => {
      prisma.kid_profile.findFirst.mockResolvedValue({ id: 9n });
      prisma.ai_device.findFirst.mockResolvedValue({
        id: 'device-1', mac_address: MAC, kid_id: null,
      });
      prisma.ai_device.update.mockResolvedValue({ id: 'device-1', kid_id: 9n });

      await deviceService.assignKidByMac(MAC, '9', 12n);

      expectPacksUntouched();
    });

    it('moving a child to a different toy leaves their pack where it is', async () => {
      prisma.kid_profile.findFirst.mockResolvedValue({ id: 9n });
      prisma.ai_device.findFirst.mockResolvedValue({
        id: 'device-2', mac_address: MAC, kid_id: null,
      });
      prisma.ai_device.findMany.mockResolvedValue([{ mac_address: 'FF:EE:DD:CC:BB:AA' }]);
      prisma.ai_device.update.mockResolvedValue({ id: 'device-2', kid_id: 9n });

      await deviceService.assignKidByMac(MAC, '9', 12n);

      // The old toy is released, the pack is not — that is the whole point.
      expect(prisma.ai_device.update).toHaveBeenCalled();
      expectPacksUntouched();
    });

    it('unbinding a toy leaves the child\'s pack intact', async () => {
      prisma.ai_device.findFirst.mockResolvedValue({
        id: 'device-1', mac_address: MAC, user_id: 12n, kid_id: 9n,
      });
      prisma.device_kid_assignment.findFirst.mockResolvedValue({ id: 5n, kid_id: 9n });
      prisma.ai_device.update.mockResolvedValue({ id: 'device-1' });

      await deviceService.unbindDevice(12, MAC);

      expectPacksUntouched();
    });
  });
});
