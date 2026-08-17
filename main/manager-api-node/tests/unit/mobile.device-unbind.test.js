/**
 * DELETE /api/mobile/devices/:mac — removing one toy.
 *
 * The mobile API used to expose no way to remove a toy. Its only destructive
 * route was DELETE /agents/:agentId, which deletes the account's shared CHARACTER
 * and clears the owner, the agent link and the child from every toy attached to
 * it. A parent removing one toy had nothing else to reach for.
 *
 * These tests pin the two properties that make this the right operation instead:
 * the toy leaves the account, and the CHILD keeps everything they own.
 */

const mockUnbindDevice = jest.fn();

// The real router is mounted, not a copy of the handler. A test that re-declares
// the route it is checking passes just as happily when the route is deleted.
// Everything mobile.routes.js pulls in is stubbed; only the module under test and
// its error translation are real.
jest.mock('../../src/middleware/firebaseAuth', () => ({
  requireFirebaseAuth: (req, _res, next) => {
    req.mobileUser = { id: 6 };
    req.firebaseUser = { uid: 'test-uid' };
    next();
  },
}));
jest.mock('../../src/services/device.service', () => ({ unbindDevice: (...a) => mockUnbindDevice(...a) }));
jest.mock('../../src/services/mobile.service', () => ({}));
jest.mock('../../src/services/agent.service', () => ({}));
jest.mock('../../src/services/deviceSettings.service', () => ({}));
jest.mock('../../src/services/deviceAnalytics.service', () => ({}));
jest.mock('../../src/services/upload.service', () => ({}));
jest.mock('../../src/services/customCard.service', () => ({}));
jest.mock('../../src/config/database', () => ({ prisma: {} }));
jest.mock('../../src/utils/logger', () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }));

const request = require('supertest');
const express = require('express');
const { errorHandler } = require('../../src/middleware/errorHandler');

const buildApp = () => {
  const app = express();
  app.use(express.json());
  app.use('/', require('../../src/routes/mobile.routes'));
  app.use(errorHandler);
  return app;
};

const MAC = '00:16:3E:AC:B5:38';

beforeEach(() => {
  jest.clearAllMocks();
  mockUnbindDevice.mockResolvedValue(undefined);
});

describe('DELETE /devices/:mac', () => {
  it('unbinds the toy for the calling parent', async () => {
    await request(buildApp()).delete(`/devices/${MAC}`).expect(200);

    expect(mockUnbindDevice).toHaveBeenCalledWith(6, MAC, false);
  });

  it('never forwards hardDelete, however the client asks', async () => {
    await request(buildApp())
      .delete(`/devices/${MAC}`)
      .send({ hardDelete: true })
      .expect(200);

    // Third argument is isSuperAdmin; there is deliberately no fourth. Passing
    // options through would let a parent destroy the assignment history and the
    // analytics keyed on this MAC, which "remove this toy" never asked for.
    expect(mockUnbindDevice).toHaveBeenCalledWith(6, MAC, false);
    expect(mockUnbindDevice.mock.calls[0]).toHaveLength(3);
  });

  it('answers 403 for another account\'s toy', async () => {
    mockUnbindDevice.mockRejectedValue(new Error("You don't have permission to unbind this device"));

    const res = await request(buildApp()).delete(`/devices/${MAC}`).expect(403);

    expect(res.body.msg).toMatch(/another account/i);
  });

  it('answers 404 for a toy that does not exist', async () => {
    mockUnbindDevice.mockRejectedValue(new Error('Device not found'));

    await request(buildApp()).delete(`/devices/${MAC}`).expect(404);
  });

  it('answers 404 for a malformed address too', async () => {
    // Following 761f47ed: from the caller's side there is no difference between a
    // toy that never existed and an address that could not name one.
    mockUnbindDevice.mockRejectedValue(new Error('Device not found'));

    await request(buildApp()).delete('/devices/not-a-mac').expect(404);
  });

  it('does not swallow an unexpected failure as a 404', async () => {
    mockUnbindDevice.mockRejectedValue(new Error('connection terminated unexpectedly'));

    await request(buildApp()).delete(`/devices/${MAC}`).expect(500);
  });
});
