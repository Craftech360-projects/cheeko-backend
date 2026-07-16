const mockPrisma = {
  device_subscriptions: { findUnique: jest.fn() }
};

jest.mock('../../src/config/database', () => ({ prisma: mockPrisma }));

const service = require('../../src/services/subscription.service');

const MAC = 'AA:BB:CC:DD:EE:FF';

describe('getSessionVerdict', () => {
  const originalFlag = process.env.ENFORCEMENT_ENABLED;

  beforeEach(() => jest.clearAllMocks());
  afterEach(() => { process.env.ENFORCEMENT_ENABLED = originalFlag; });

  describe('kill-switch off (default)', () => {
    beforeEach(() => { delete process.env.ENFORCEMENT_ENABLED; });

    test('unknown MAC is allowed and the DB is never consulted', async () => {
      const verdict = await service.getSessionVerdict('FF:FF:FF:FF:FF:FF');

      expect(verdict.allowed).toBe(true);
      expect(verdict.reason).toBe('ok');
      expect(mockPrisma.device_subscriptions.findUnique).not.toHaveBeenCalled();
    });

    test('a lapsed device is still allowed', async () => {
      mockPrisma.device_subscriptions.findUnique.mockResolvedValue({ status: 'lapsed' });

      expect((await service.getSessionVerdict(MAC)).allowed).toBe(true);
    });

    test('ENFORCEMENT_ENABLED=false short-circuits to allowed', async () => {
      process.env.ENFORCEMENT_ENABLED = 'false';
      mockPrisma.device_subscriptions.findUnique.mockResolvedValue({ status: 'lapsed' });

      expect((await service.getSessionVerdict(MAC)).allowed).toBe(true);
    });
  });

  describe('kill-switch on', () => {
    beforeEach(() => { process.env.ENFORCEMENT_ENABLED = 'true'; });

    test.each(['trial', 'active', 'grace'])('status %s may start a session', async (status) => {
      mockPrisma.device_subscriptions.findUnique.mockResolvedValue({ status });

      const verdict = await service.getSessionVerdict(MAC);
      expect(verdict.allowed).toBe(true);
      expect(verdict.reason).toBe('ok');
    });

    test.each(['lapsed', 'cancelled'])('status %s is refused', async (status) => {
      mockPrisma.device_subscriptions.findUnique.mockResolvedValue({ status });

      const verdict = await service.getSessionVerdict(MAC);
      expect(verdict.allowed).toBe(false);
      expect(verdict.reason).toBe('no_plan');
    });

    test('unknown MAC is refused with no_plan', async () => {
      mockPrisma.device_subscriptions.findUnique.mockResolvedValue(null);

      const verdict = await service.getSessionVerdict(MAC);
      expect(verdict.allowed).toBe(false);
      expect(verdict.reason).toBe('no_plan');
    });

    test('malformed MAC is refused without hitting the DB', async () => {
      const verdict = await service.getSessionVerdict('not-a-mac');

      expect(verdict.allowed).toBe(false);
      expect(mockPrisma.device_subscriptions.findUnique).not.toHaveBeenCalled();
    });

    test('MAC is normalised before lookup', async () => {
      mockPrisma.device_subscriptions.findUnique.mockResolvedValue({ status: 'active' });

      await service.getSessionVerdict('aa-bb-cc-dd-ee-ff');

      expect(mockPrisma.device_subscriptions.findUnique).toHaveBeenCalledWith(
        expect.objectContaining({ where: { mac_address: MAC } })
      );
    });
  });

  test('remaining is unknown, not zero — SUB-3 computes the real buckets', async () => {
    delete process.env.ENFORCEMENT_ENABLED;

    expect((await service.getSessionVerdict(MAC)).remaining).toEqual({
      questions_month: null,
      questions_today: null,
      minutes_today: null,
      images_today: null,
    });
  });
});
