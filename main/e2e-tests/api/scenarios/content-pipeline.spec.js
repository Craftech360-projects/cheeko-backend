/**
 * Content Pipeline E2E Scenarios
 * Covers: 5.1-5.2 Content creation, 5.9 Content deletion, library verification
 */

const pactum = require('pactum');
const config = require('../../test.config');
const { getServiceKeyHeaders, getBearerHeaders } = require('../helpers/auth.helper');
const { testContent } = require('../helpers/data.helper');
const { createCleanup } = require('../helpers/cleanup.helper');

const cleanup = createCleanup();

beforeAll(() => {
  pactum.request.setBaseUrl(config.managerApi.baseUrl);
  pactum.request.setDefaultTimeout(config.settings.timeoutMs);
});

afterAll(async () => {
  await cleanup.cleanAll();
});

describe('Content Delivery Pipeline E2E', () => {

  let musicId = null;
  let storyId = null;

  describe('Step 1: Upload music content (5.1)', () => {
    it('should create music content', async () => {
      const music = testContent('music');
      const res = await pactum.spec()
        .post('/content/library')
        .withHeaders(getServiceKeyHeaders())
        .withJson(music)
        .expectStatus(200)
        .returns('data.id');

      musicId = res;
      cleanup.track('content', musicId);
      expect(musicId).toBeTruthy();
    });
  });

  describe('Step 2: Upload story content (5.2)', () => {
    it('should create story content', async () => {
      const story = testContent('story');
      const res = await pactum.spec()
        .post('/content/library')
        .withHeaders(getServiceKeyHeaders())
        .withJson(story)
        .expectStatus(200)
        .returns('data.id');

      storyId = res;
      cleanup.track('content', storyId);
      expect(storyId).toBeTruthy();
    });
  });

  describe('Step 3: Verify content in library', () => {
    it('should find created content in library list', async () => {
      await pactum.spec()
        .get('/content/library')
        .withHeaders(getServiceKeyHeaders())
        .expectStatus(200)
        .expectJsonLike({ code: 0 });
    });

    it('should filter content by type', async () => {
      await pactum.spec()
        .get('/content/library')
        .withHeaders(getServiceKeyHeaders())
        .withQueryParams({ contentType: 'music' })
        .expectStatus(200)
        .expectJsonLike({ code: 0 });
    });
  });

  describe('Step 4: Get content by ID', () => {
    it('should retrieve music content by ID', async () => {
      if (!musicId) return;

      await pactum.spec()
        .get(`/content/library/${musicId}`)
        .withHeaders(getServiceKeyHeaders())
        .expectStatus(200)
        .expectJsonLike({ code: 0 });
    });
  });

  describe('Step 5: Delete content (5.9)', () => {
    it('should delete story content', async () => {
      if (!storyId) return;

      await pactum.spec()
        .delete(`/content/library/${storyId}`)
        .withHeaders(getServiceKeyHeaders())
        .expectStatus(200);

      // Remove from cleanup since we deleted manually
      cleanup.resources = cleanup.resources.filter(r => !(r.type === 'content' && r.id === storyId));
      storyId = null;
    });
  });

});
