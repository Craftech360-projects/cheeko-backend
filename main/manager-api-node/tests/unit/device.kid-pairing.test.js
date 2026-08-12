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
    quiz_question_answer: { updateMany: jest.fn() },
    riddle_question_answer: { updateMany: jest.fn() },
    device_workspace_artifacts: { updateMany: jest.fn(), findMany: jest.fn(), delete: jest.fn() },
    device_memory_documents: { updateMany: jest.fn(), findMany: jest.fn(), delete: jest.fn() },
    device_memory_chunks: { updateMany: jest.fn(), findMany: jest.fn(), delete: jest.fn() },
    imagine_image: { updateMany: jest.fn() },
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

      // Newest wins, matching the migration's rule.
      expect(prisma.device_workspace_artifacts.delete).toHaveBeenCalledWith({ where: { id: 'held' } });
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

      expect(prisma.device_workspace_artifacts.delete).toHaveBeenCalledWith({ where: { id: 'incoming' } });
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
});
