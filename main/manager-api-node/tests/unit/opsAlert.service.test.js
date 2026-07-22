const service = require('../../src/services/opsAlert.service');

describe('sendOpsAlert', () => {
  const origFetch = global.fetch;
  const origEnv = { ...process.env };

  beforeEach(() => {
    service._resetDedupe();
    global.fetch = jest.fn().mockResolvedValue({ ok: true });
    process.env.SLACK_ALERT_WEBHOOK_URL = 'https://hooks.slack.test/x';
    delete process.env.ALERT_EMAIL_TO;
  });
  afterEach(() => {
    global.fetch = origFetch;
    process.env = { ...origEnv };
  });

  test('posts to the Slack webhook with the type-tagged text', async () => {
    const ok = await service.sendOpsAlert('fail_open', 'enforcement down');
    expect(ok).toBe(true);
    const [url, opts] = global.fetch.mock.calls[0];
    expect(url).toBe('https://hooks.slack.test/x');
    expect(JSON.parse(opts.body).text).toContain('[fail_open] enforcement down');
  });

  test('oncePerDay key dedupes within the same day and re-arms next day', async () => {
    const day1 = new Date('2026-07-22T05:00:00Z');
    expect(await service.sendOpsAlert('billing_spike', 'x', { oncePerDayKey: 'k', now: day1 })).toBe(true);
    expect(await service.sendOpsAlert('billing_spike', 'x', { oncePerDayKey: 'k', now: day1 })).toBe(false);
    expect(global.fetch).toHaveBeenCalledTimes(1);

    const day2 = new Date('2026-07-23T05:00:00Z');
    expect(await service.sendOpsAlert('billing_spike', 'x', { oncePerDayKey: 'k', now: day2 })).toBe(true);
  });

  test('no channels configured → false, and never throws', async () => {
    delete process.env.SLACK_ALERT_WEBHOOK_URL;
    expect(await service.sendOpsAlert('rc_webhook', 'y')).toBe(false);
  });

  test('a failing channel is swallowed', async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error('down'));
    expect(await service.sendOpsAlert('rc_webhook', 'y')).toBe(false);
  });
});
