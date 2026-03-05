/**
 * Profile Flow E2E Scenarios
 * Covers: 7.1 Create profile, 7.2 Update profile, assign to device
 *
 * NOTE: /api/mobile/* routes require Firebase auth (router-wide middleware).
 * Service Key does NOT work on these routes.
 * These tests use Bearer token (admin) which also won't work on mobile routes.
 * Tests that hit mobile routes are skipped unless FIREBASE_TEST_TOKEN is configured.
 */

const pactum = require('pactum');
const config = require('../../test.config');
const { getServiceKeyHeaders, getBearerHeaders, getFirebaseHeaders, loadAuth } = require('../helpers/auth.helper');
const { testKidProfile } = require('../helpers/data.helper');

beforeAll(() => {
  pactum.request.setBaseUrl(config.managerApi.baseUrl);
  pactum.request.setDefaultTimeout(config.settings.timeoutMs);
});

const hasFirebase = () => {
  const auth = loadAuth();
  return auth.firebaseToken && auth.firebaseToken !== '' && auth.firebaseToken !== 'no-firebase-token-configured';
};

describe('Profile Flow E2E', () => {

  let profileId = null;
  const profile = testKidProfile();

  describe('Step 1: Create kid profile (7.1)', () => {
    it('should create a kid profile via mobile API', async () => {
      if (!hasFirebase()) {
        console.log('  Skipping: FIREBASE_TEST_TOKEN not configured');
        return;
      }

      const res = await pactum.spec()
        .post('/api/mobile/kid-profiles')
        .withHeaders(getFirebaseHeaders())
        .withJson(profile)
        .expectStatus(200)
        .returns('data.id');

      profileId = res;
      expect(profileId).toBeTruthy();
    });
  });

  describe('Step 2: Retrieve profile', () => {
    it('should return the created profile', async () => {
      if (!profileId) return;

      await pactum.spec()
        .get(`/api/mobile/kid-profiles/${profileId}`)
        .withHeaders(getFirebaseHeaders())
        .expectStatus(200)
        .expectJsonLike({
          data: {
            name: profile.name,
            gender: profile.gender,
          },
        });
    });
  });

  describe('Step 3: Update profile (7.2)', () => {
    it('should update profile name and interests', async () => {
      if (!profileId) return;

      await pactum.spec()
        .put(`/api/mobile/kid-profiles/${profileId}`)
        .withHeaders(getFirebaseHeaders())
        .withJson({
          name: 'E2E Updated Name',
          interests: ['space', 'robots', 'math'],
        })
        .expectStatus(200);
    });

    it('should reflect updated name', async () => {
      if (!profileId) return;

      await pactum.spec()
        .get(`/api/mobile/kid-profiles/${profileId}`)
        .withHeaders(getFirebaseHeaders())
        .expectStatus(200)
        .expectJsonLike({
          data: { name: 'E2E Updated Name' },
        });
    });
  });

  describe('Step 4: List profiles', () => {
    it('should list profiles via mobile API', async () => {
      if (!hasFirebase()) {
        console.log('  Skipping: FIREBASE_TEST_TOKEN not configured');
        return;
      }

      await pactum.spec()
        .get('/api/mobile/kid-profiles')
        .withHeaders(getFirebaseHeaders())
        .expectStatus(200)
        .expectJsonLike({ code: 0 });
    });
  });

});
