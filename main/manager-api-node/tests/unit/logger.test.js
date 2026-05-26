'use strict';

describe('logger console metadata formatting', () => {
  afterEach(() => {
    jest.resetModules();
  });

  it('prints metadata fields even when default service metadata exists', () => {
    const logger = require('../../src/utils/logger');

    const formatted = logger.formatConsoleMetaForTest({
      service: 'manager-api-node',
      path: '/toy/api/mobile/homepage-activity',
      ip: '127.0.0.1',
      limit: 100,
      remaining: 0
    });

    expect(formatted).toContain('"path":"/toy/api/mobile/homepage-activity"');
    expect(formatted).toContain('"ip":"127.0.0.1"');
    expect(formatted).toContain('"limit":100');
    expect(formatted).toContain('"remaining":0');
    expect(formatted).not.toContain('manager-api-node');
  });
});
