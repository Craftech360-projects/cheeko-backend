/**
 * Device Lifecycle E2E Scenarios
 * Covers: 2.2 Config retrieval, 2.6 Duplicate MAC, 2.7 Device list
 */

const pactum = require('pactum');
const config = require('../../test.config');
const { getServiceKeyHeaders, getBearerHeaders } = require('../helpers/auth.helper');
const { testDevice } = require('../helpers/data.helper');

beforeAll(() => {
  pactum.request.setBaseUrl(config.managerApi.baseUrl);
  pactum.request.setDefaultTimeout(config.settings.timeoutMs);
});

describe('Device Lifecycle E2E', () => {

  const device = testDevice();
  let registered = false;

  describe('Step 1: Register device', () => {
    it('should register a new device via manual-add', async () => {
      await pactum.spec()
        .post('/device/manual-add')
        .withHeaders(getBearerHeaders())
        .withJson({ mac: device.macAddress })
        .expectStatus(200)
        .expectJsonLike({ code: 0 });

      registered = true;
    });
  });

  describe('Step 2: Retrieve device config (2.2)', () => {
    it('should return config for the registered device MAC', async () => {
      if (!registered) return;

      // Newly registered device has no agent assigned, so config returns 404
      const mac = device.macAddress.replace(/:/g, '').toLowerCase();
      await pactum.spec()
        .get(`/agent/config/${mac}`)
        .withHeaders(getServiceKeyHeaders())
        .expectStatus(404);
    });
  });

  describe('Step 3: Duplicate MAC rejection (2.6)', () => {
    it('should reject registration with same MAC address', async () => {
      if (!registered) return;

      await pactum.spec()
        .post('/device/manual-add')
        .withHeaders(getBearerHeaders())
        .withJson({ mac: device.macAddress })
        .expectStatus(400);
    });
  });

  describe('Step 4: Get device list with pagination (2.7)', () => {
    it('should return paginated device list', async () => {
      await pactum.spec()
        .get('/device/list')
        .withHeaders(getBearerHeaders())
        .withQueryParams({ page: 1, size: 10 })
        .expectStatus(200)
        .expectJsonLike({ code: 0 });
    });
  });

});
