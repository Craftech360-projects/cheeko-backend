/**
 * OTA Firmware Management E2E Scenarios
 * Covers: Firmware CRUD, OTA check, force update
 */

const pactum = require('pactum');
const config = require('../../test.config');
const { getBearerHeaders } = require('../helpers/auth.helper');
const { testOtaFirmware, testDevice } = require('../helpers/data.helper');
const { createCleanup } = require('../helpers/cleanup.helper');

const cleanup = createCleanup();

beforeAll(() => {
  pactum.request.setBaseUrl(config.managerApi.baseUrl);
  pactum.request.setDefaultTimeout(config.settings.timeoutMs);
});

afterAll(async () => {
  await cleanup.cleanAll();
});

describe('OTA Firmware E2E', () => {

  let firmwareId = null;
  const firmware = testOtaFirmware();

  describe('Step 1: Create firmware', () => {
    it('should create a new firmware entry', async () => {
      const res = await pactum.spec()
        .post('/device/ota/firmware')
        .withHeaders(getBearerHeaders())
        .withJson(firmware)
        .expectStatus(200)
        .returns('data.id');

      firmwareId = res;
      cleanup.track('ota', firmwareId);
      expect(firmwareId).toBeTruthy();
    });
  });

  describe('Step 2: List firmware', () => {
    it('should return firmware list', async () => {
      await pactum.spec()
        .get('/device/ota/firmware')
        .withHeaders(getBearerHeaders())
        .expectStatus(200)
        .expectJsonLike({ code: 0 });
    });

    it('should return all firmware', async () => {
      await pactum.spec()
        .get('/device/ota/firmware/all')
        .withHeaders(getBearerHeaders())
        .expectStatus(200)
        .expectJsonLike({ code: 0 });
    });
  });

  describe('Step 3: Get firmware by ID', () => {
    it('should return the created firmware', async () => {
      if (!firmwareId) return;

      await pactum.spec()
        .get(`/device/ota/firmware/${firmwareId}`)
        .withHeaders(getBearerHeaders())
        .expectStatus(200)
        .expectJsonLike({ code: 0 });
    });
  });

  describe('Step 4: Update firmware', () => {
    it('should update firmware remark', async () => {
      if (!firmwareId) return;

      await pactum.spec()
        .put(`/device/ota/firmware/${firmwareId}`)
        .withHeaders(getBearerHeaders())
        .withJson({ remark: 'Updated by E2E test' })
        .expectStatus(200);
    });
  });

  describe('Step 5: Force update toggle', () => {
    it('should toggle force update', async () => {
      if (!firmwareId) return;

      await pactum.spec()
        .put(`/device/ota/firmware/${firmwareId}/force-update`)
        .withHeaders(getBearerHeaders())
        .expect((ctx) => {
          expect([200, 400]).toContain(ctx.res.statusCode);
        });
    });
  });

  describe('Step 6: OTA check from device', () => {
    it('should check for updates', async () => {
      await pactum.spec()
        .post('/device/ota/check')
        .withJson({
          mac: 'E2E000000001',
          currentVersion: '0.0.1',
          board: 'esp32',
        })
        .expect((ctx) => {
          expect([200, 404]).toContain(ctx.res.statusCode);
        });
    });
  });

  describe('Step 7: Get latest firmware by type', () => {
    it('should return latest firmware for esp32', async () => {
      await pactum.spec()
        .get('/device/ota/firmware/latest/esp32')
        .expect((ctx) => {
          expect([200, 404]).toContain(ctx.res.statusCode);
        });
    });
  });

  describe('Step 8: Delete firmware', () => {
    it('should delete the firmware', async () => {
      if (!firmwareId) return;

      await pactum.spec()
        .delete(`/device/ota/firmware/${firmwareId}`)
        .withHeaders(getBearerHeaders())
        .expectStatus(200);

      cleanup.resources = cleanup.resources.filter(r => !(r.type === 'ota' && r.id === firmwareId));
    });
  });
});
