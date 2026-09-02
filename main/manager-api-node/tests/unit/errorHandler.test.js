/**
 * What the global error handler puts in `data`.
 *
 * An ApiError may carry a body — a 412 answers with the card the caller is
 * behind on. Nothing else may: an error thrown by an SDK or HTTP client can
 * carry a `data` of its own, and that is internal detail the app must not see.
 */

'use strict';

jest.mock('../../src/utils/logger', () => ({ error: jest.fn(), warn: jest.fn(), info: jest.fn() }));

const { ApiError, errorHandler } = require('../../src/middleware/errorHandler');

const respond = (err) => {
  const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
  errorHandler(err, { requestId: 'r1', originalUrl: '/x', method: 'GET', ip: '::1' }, res, () => {});
  return { status: res.status.mock.calls[0][0], body: res.json.mock.calls[0][0] };
};

describe('errorHandler data', () => {
  it('passes an ApiError body through', () => {
    const err = new ApiError('Someone else updated this card.', 412);
    err.data = { kidId: '42', contentPack: { version: '5' } };

    const { status, body } = respond(err);

    expect(status).toBe(412);
    expect(body).toEqual({ code: 412, msg: 'Someone else updated this card.', data: err.data });
  });

  it('drops the data of an error it did not throw itself', () => {
    const err = new Error('connect ECONNRESET');
    err.data = { response: 'from an sdk', endpoint: 'https://internal.example' };

    const { status, body } = respond(err);

    expect(status).toBe(500);
    expect(body.data).toBeNull();
  });

  it('answers null data for a plain ApiError with no body', () => {
    const { body } = respond(new ApiError('That child could not be found.', 404));
    expect(body.data).toBeNull();
  });
});
