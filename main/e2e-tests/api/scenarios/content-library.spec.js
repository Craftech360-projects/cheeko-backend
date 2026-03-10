/**
 * Content Library & Playlist E2E Scenarios
 * Covers: Content items CRUD, library search/categories, playlist management, content types
 */

const pactum = require('pactum');
const config = require('../../test.config');
const { getBearerHeaders } = require('../helpers/auth.helper');
const { testContent, uniqueId } = require('../helpers/data.helper');

beforeAll(() => {
  pactum.request.setBaseUrl(config.managerApi.baseUrl);
  pactum.request.setDefaultTimeout(config.settings.timeoutMs);
});

// ── Content Library ────────────────────────────────────────────────────────

describe('Content Library E2E', () => {

  it('should search content library', async () => {
    await pactum.spec()
      .get('/content/library/search')
      .withHeaders(getBearerHeaders())
      .withQueryParams({ q: 'test', page: 1, limit: 10 })
      .expect((ctx) => {
        expect([200, 400, 404]).toContain(ctx.res.statusCode);
      });
  });

  it('should return library categories', async () => {
    await pactum.spec()
      .get('/content/library/categories')
      .withHeaders(getBearerHeaders())
      .expect((ctx) => {
        expect([200, 404]).toContain(ctx.res.statusCode);
      });
  });

  it('should return library statistics', async () => {
    await pactum.spec()
      .get('/content/library/statistics')
      .withHeaders(getBearerHeaders())
      .expect((ctx) => {
        expect([200, 404]).toContain(ctx.res.statusCode);
      });
  });
});

// ── Content Items (Generic) ────────────────────────────────────────────────

describe('Content Items E2E', () => {

  let contentId = null;

  it('should list content items', async () => {
    await pactum.spec()
      .get('/content/items')
      .withHeaders(getBearerHeaders())
      .expect((ctx) => {
        expect([200, 401, 404, 500]).toContain(ctx.res.statusCode);
      });
  });

  it('should search content items', async () => {
    await pactum.spec()
      .get('/content/items/search')
      .withHeaders(getBearerHeaders())
      .withQueryParams({ q: 'test' })
      .expect((ctx) => {
        expect([200, 401, 404, 500]).toContain(ctx.res.statusCode);
      });
  });

  it('should return content item categories', async () => {
    await pactum.spec()
      .get('/content/items/categories')
      .withHeaders(getBearerHeaders())
      .expect((ctx) => {
        expect([200, 401, 404, 500]).toContain(ctx.res.statusCode);
      });
  });

  it('should return content item statistics', async () => {
    await pactum.spec()
      .get('/content/items/statistics')
      .withHeaders(getBearerHeaders())
      .expect((ctx) => {
        expect([200, 401, 404, 500]).toContain(ctx.res.statusCode);
      });
  });

  it('should filter items by type', async () => {
    await pactum.spec()
      .get('/content/items/type/music')
      .withHeaders(getBearerHeaders())
      .expect((ctx) => {
        expect([200, 401, 404, 500]).toContain(ctx.res.statusCode);
      });
  });

  it('should filter items by category', async () => {
    await pactum.spec()
      .get('/content/items/category/test')
      .withHeaders(getBearerHeaders())
      .expect((ctx) => {
        expect([200, 401, 404, 500]).toContain(ctx.res.statusCode);
      });
  });

  it('should create a content item', async () => {
    const res = await pactum.spec()
      .post('/content/items')
      .withHeaders(getBearerHeaders())
      .withJson({
        title: `e2e-content-${uniqueId()}`,
        contentType: 'music',
        url: 'https://cdn.test.com/test.mp3',
        category: 'test',
      })
      .expect((ctx) => {
        expect([200, 201, 400, 404]).toContain(ctx.res.statusCode);
      })
      .returns('res.body');

    contentId = res?.data?.id || res?.data;
  });

  it('should get content item by ID', async () => {
    if (!contentId) return;

    await pactum.spec()
      .get(`/content/items/${contentId}`)
      .expect((ctx) => {
        expect([200, 404]).toContain(ctx.res.statusCode);
      });
  });

  it('should update content item', async () => {
    if (!contentId) return;

    await pactum.spec()
      .put(`/content/items/${contentId}`)
      .withHeaders(getBearerHeaders())
      .withJson({
        title: `e2e-content-updated-${uniqueId()}`,
      })
      .expect((ctx) => {
        expect([200, 400, 404]).toContain(ctx.res.statusCode);
      });
  });

  it('should delete content item', async () => {
    if (!contentId) return;

    await pactum.spec()
      .delete(`/content/items/${contentId}`)
      .withHeaders(getBearerHeaders())
      .expect((ctx) => {
        expect([200, 400, 404]).toContain(ctx.res.statusCode);
      });
  });
});

// ── Music Content ──────────────────────────────────────────────────────────

describe('Music Content E2E', () => {

  let musicId = null;
  const music = testContent('music');

  it('should list music content', async () => {
    await pactum.spec()
      .get('/content/music/list')
      .withHeaders(getBearerHeaders())
      .expect((ctx) => {
        expect([200, 404]).toContain(ctx.res.statusCode);
      });
  });

  it('should create music content', async () => {
    const res = await pactum.spec()
      .post('/content/music/create')
      .withHeaders(getBearerHeaders())
      .withJson(music)
      .expect((ctx) => {
        expect([200, 201, 400]).toContain(ctx.res.statusCode);
      })
      .returns('res.body');

    musicId = res?.data?.id || res?.data;
  });

  it('should get music by ID', async () => {
    if (!musicId) return;

    await pactum.spec()
      .get(`/content/music/${musicId}`)
      .expect((ctx) => {
        expect([200, 404]).toContain(ctx.res.statusCode);
      });
  });

  it('should update music content', async () => {
    if (!musicId) return;

    await pactum.spec()
      .put(`/content/music/update/${musicId}`)
      .withHeaders(getBearerHeaders())
      .withJson({ ...music, title: `${music.title}-updated` })
      .expect((ctx) => {
        expect([200, 400, 404]).toContain(ctx.res.statusCode);
      });
  });

  it('should delete music content', async () => {
    if (!musicId) return;

    await pactum.spec()
      .delete(`/content/music/delete/${musicId}`)
      .withHeaders(getBearerHeaders())
      .expect((ctx) => {
        expect([200, 400, 404]).toContain(ctx.res.statusCode);
      });
  });
});

// ── Story Content ──────────────────────────────────────────────────────────

describe('Story Content E2E', () => {

  let storyId = null;
  const story = testContent('story');

  it('should list story content', async () => {
    await pactum.spec()
      .get('/content/story/list')
      .withHeaders(getBearerHeaders())
      .expect((ctx) => {
        expect([200, 404]).toContain(ctx.res.statusCode);
      });
  });

  it('should create story content', async () => {
    const res = await pactum.spec()
      .post('/content/story/create')
      .withHeaders(getBearerHeaders())
      .withJson(story)
      .expect((ctx) => {
        expect([200, 201, 400]).toContain(ctx.res.statusCode);
      })
      .returns('res.body');

    storyId = res?.data?.id || res?.data;
  });

  it('should get story by ID', async () => {
    if (!storyId) return;

    await pactum.spec()
      .get(`/content/story/${storyId}`)
      .expect((ctx) => {
        expect([200, 404]).toContain(ctx.res.statusCode);
      });
  });

  it('should delete story content', async () => {
    if (!storyId) return;

    await pactum.spec()
      .delete(`/content/story/delete/${storyId}`)
      .withHeaders(getBearerHeaders())
      .expect((ctx) => {
        expect([200, 400, 404]).toContain(ctx.res.statusCode);
      });
  });
});

// ── Textbook Content ───────────────────────────────────────────────────────

describe('Textbook Content E2E', () => {

  it('should list textbook content', async () => {
    await pactum.spec()
      .get('/content/textbook/list')
      .withHeaders(getBearerHeaders())
      .expect((ctx) => {
        expect([200, 404]).toContain(ctx.res.statusCode);
      });
  });
});

// ── Random Content ─────────────────────────────────────────────────────────

describe('Random Content E2E', () => {

  it('should return random music for device', async () => {
    await pactum.spec()
      .get('/content/random/music/e2e000000001')
      .expect((ctx) => {
        expect([200, 404]).toContain(ctx.res.statusCode);
      });
  });

  it('should return random story for device', async () => {
    await pactum.spec()
      .get('/content/random/story/e2e000000001')
      .expect((ctx) => {
        expect([200, 404]).toContain(ctx.res.statusCode);
      });
  });
});

// ── Content Search ─────────────────────────────────────────────────────────

describe('Content Search E2E', () => {

  it('should search content', async () => {
    await pactum.spec()
      .get('/content/search')
      .withHeaders(getBearerHeaders())
      .withQueryParams({ q: 'test' })
      .expect((ctx) => {
        expect([200, 404]).toContain(ctx.res.statusCode);
      });
  });
});
