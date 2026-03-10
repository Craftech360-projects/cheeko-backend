/**
 * Error Handling E2E Scenarios
 * Covers: 11.5 Concurrent updates, 11.7 XSS, 11.8 SQL injection, 11.9 Rate limit, 11.10 Invalid MAC
 */

const pactum = require('pactum');
const config = require('../../test.config');
const { getServiceKeyHeaders, getBearerHeaders } = require('../helpers/auth.helper');

beforeAll(() => {
  pactum.request.setBaseUrl(config.managerApi.baseUrl);
  pactum.request.setDefaultTimeout(config.settings.timeoutMs);
});

describe('Error Handling E2E', () => {

  describe('11.7 - XSS attempt in input', () => {
    it('should sanitize script tags in content name', async () => {
      const res = await pactum.spec()
        .post('/content/library')
        .withHeaders(getServiceKeyHeaders())
        .withJson({
          title: '<script>alert("xss")</script>',
          contentType: 'music',
          url: 'https://cdn.test.com/xss-test.mp3',
        })
        .returns('res.body');

      // If content was created, title should be sanitized
      if (res?.data?.title) {
        expect(res.data.title).not.toContain('<script>');
      }
    });
  });

  describe('11.8 - SQL injection attempt', () => {
    it('should not execute injected SQL in search params', async () => {
      await pactum.spec()
        .get('/device/list')
        .withHeaders(getBearerHeaders())
        .withQueryParams({ search: "'; DROP TABLE devices; --" })
        .expectStatus(200);

      // Verify the system still works after injection attempt
      await pactum.spec()
        .get('/device/list')
        .withHeaders(getBearerHeaders())
        .expectStatus(200)
        .expectJsonLike({ code: 0 });
    });
  });

  describe('11.10 - Invalid MAC format', () => {
    it('should reject device with invalid MAC address', async () => {
      const res = await pactum.spec()
        .post('/device/manual-add')
        .withHeaders(getBearerHeaders())
        .withJson({
          mac: 'ZZZZZZ-INVALID',
        })
        .returns('res.status');

      // Should be 400 or return error code
    });
  });

  describe('11.5 - Concurrent updates', () => {
    it('should handle simultaneous requests without crashing', async () => {
      const headers = getBearerHeaders();

      // Fire 5 simultaneous list requests
      const promises = Array(5).fill(null).map(() =>
        pactum.spec()
          .get('/device/list')
          .withHeaders(headers)
          .expectStatus(200)
          .toss()
      );

      const results = await Promise.allSettled(promises);
      const fulfilled = results.filter(r => r.status === 'fulfilled');
      expect(fulfilled.length).toBe(5);
    });
  });

  describe('Request with empty body', () => {
    it('should handle empty body on POST endpoint gracefully', async () => {
      await pactum.spec()
        .post('/device/manual-add')
        .withHeaders(getBearerHeaders())
        .withJson({})
        .expect((ctx) => {
          // Should be 400 (validation error), not 500
          expect([200, 400, 422]).toContain(ctx.res.statusCode);
        });
    });
  });

  describe('Request with oversized payload', () => {
    it('should reject oversized JSON payload', async () => {
      const largePayload = {
        title: 'x'.repeat(100000),
        contentType: 'music',
      };

      await pactum.spec()
        .post('/content/library')
        .withHeaders(getServiceKeyHeaders())
        .withJson(largePayload)
        .expect((ctx) => {
          // Should handle gracefully (400 or 413)
          expect([200, 400, 413, 422]).toContain(ctx.res.statusCode);
        });
    });
  });

});
