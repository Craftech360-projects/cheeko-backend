/**
 * SUB-13 comms script: dry-run default sends nothing; --apply dedupes tokens
 * and sends one push per parent.
 */

const mockPrisma = {
  parent_profile: { findMany: jest.fn() },
  $disconnect: jest.fn(),
};
jest.mock('../../src/config/database', () => ({ prisma: mockPrisma }));

const mockSend = jest.fn().mockResolvedValue(true);
jest.mock('../../src/services/pushNotification.service', () => ({
  sendPushNotification: (...a) => mockSend(...a),
}));

const { main, PUSH } = require('../../scripts/send-launch-announcement');

describe('send-launch-announcement', () => {
  let argv;
  beforeEach(() => {
    jest.clearAllMocks();
    argv = process.argv;
    mockPrisma.parent_profile.findMany.mockResolvedValue([
      { fcm_token: 'tok-a' },
      { fcm_token: 'tok-a' }, // same parent surfacing twice → deduped
      { fcm_token: 'tok-b' },
    ]);
  });
  afterEach(() => {
    process.argv = argv;
  });

  test('dry run (default) sends nothing', async () => {
    process.argv = ['node', 'send-launch-announcement.js'];
    await main();
    expect(mockSend).not.toHaveBeenCalled();
  });

  test('--apply sends once per unique token with the announcement copy', async () => {
    process.argv = ['node', 'send-launch-announcement.js', '--apply'];
    await main();
    expect(mockSend).toHaveBeenCalledTimes(2);
    expect(mockSend).toHaveBeenCalledWith('tok-a', PUSH.title, PUSH.body, {
      type: 'launch_announcement',
    });
  });
});
