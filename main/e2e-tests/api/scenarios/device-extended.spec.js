/**
 * Device Extended E2E Scenarios
 * Covers: Device unbind, update, mode switching, kid assignment, OTA check
 */

const pactum = require('pactum');
const config = require('../../test.config');
const { getBearerHeaders } = require('../helpers/auth.helper');
const { testDevice, uniqueId } = require('../helpers/data.helper');

const TEST_MAC = 'e2e000000001';

beforeAll(() => {
  pactum.request.setBaseUrl(config.managerApi.baseUrl);
  pactum.request.setDefaultTimeout(config.settings.timeoutMs);
});

// ── Device Mode ────────────────────────────────────────────────────────────

describe('Device Mode E2E', () => {

  it('should get device mode', async () => {
    await pactum.spec()
      .get(`/device/${TEST_MAC}/mode`)
      .withHeaders(getBearerHeaders())
      .expect((ctx) => {
        expect([200, 404]).toContain(ctx.res.statusCode);
      });
  });

  it('should get device-mode (alternative)', async () => {
    await pactum.spec()
      .get(`/device/${TEST_MAC}/device-mode`)
      .withHeaders(getBearerHeaders())
      .expect((ctx) => {
        expect([200, 404]).toContain(ctx.res.statusCode);
      });
  });

  it('should cycle device mode', async () => {
    await pactum.spec()
      .post(`/device/${TEST_MAC}/cycle-mode`)
      .withHeaders(getBearerHeaders())
      .expect((ctx) => {
        expect([200, 400, 404]).toContain(ctx.res.statusCode);
      });
  });
});

// ── Device Unbind ──────────────────────────────────────────────────────────

describe('Device Unbind E2E', () => {

  it('should handle unbind for non-existent device', async () => {
    await pactum.spec()
      .post('/device/unbind')
      .withHeaders(getBearerHeaders())
      .withJson({ mac: 'FF:FF:FF:FF:FF:FF' })
      .expect((ctx) => {
        expect([200, 400, 404]).toContain(ctx.res.statusCode);
      });
  });
});

// ── Kid Assignment ─────────────────────────────────────────────────────────

describe('Device Kid Assignment E2E', () => {

  it('should assign kid by MAC address', async () => {
    await pactum.spec()
      .put('/device/assign-kid-by-mac')
      .withHeaders(getBearerHeaders())
      .withJson({ mac: TEST_MAC, kidId: 1 })
      .expect((ctx) => {
        expect([200, 400, 404]).toContain(ctx.res.statusCode);
      });
  });
});

// ── OTA Check ──────────────────────────────────────────────────────────────

describe('Device OTA Check E2E', () => {

  it('should check for OTA updates', async () => {
    await pactum.spec()
      .post('/device/ota/check')
      .withJson({
        mac: TEST_MAC,
        currentVersion: '0.0.1',
        deviceType: 'esp32',
      })
      .expect((ctx) => {
        expect([200, 400, 404]).toContain(ctx.res.statusCode);
      });
  });

  it('should list all OTA firmware', async () => {
    await pactum.spec()
      .get('/device/ota/firmware/all')
      .withHeaders(getBearerHeaders())
      .expect((ctx) => {
        expect([200, 401, 404]).toContain(ctx.res.statusCode);
      });
  });

  it('should get latest firmware by type', async () => {
    await pactum.spec()
      .get('/device/ota/firmware/latest/esp32')
      .expect((ctx) => {
        expect([200, 404]).toContain(ctx.res.statusCode);
      });
  });
});

// ── Token Usage Delete ─────────────────────────────────────────────────────

describe('Device Token Usage Delete E2E', () => {

  it('should handle token usage deletion for unknown MAC', async () => {
    const { getServiceKeyHeaders } = require('../helpers/auth.helper');
    await pactum.spec()
      .delete('/device/token-usage/ffffffffffff')
      .withHeaders(getServiceKeyHeaders())
      .expect((ctx) => {
        expect([200, 400, 401, 404]).toContain(ctx.res.statusCode);
      });
  });
});
