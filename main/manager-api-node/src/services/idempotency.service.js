/**
 * Idempotency for retried writes.
 *
 * A mobile network drops a multipart request after the body has been sent but
 * before the response arrives, and the app retries. The first call already
 * landed, so the retry appends a second recording, or bumps the pack version a
 * second time and sends every toy holding that card off to re-download content
 * that has not changed.
 *
 * A client that sends `Idempotency-Key` gets the first call's response back
 * instead. What is stored is the body and status, not a "seen" flag: a replay
 * has to answer with the same card the original did, or the app adopts a card
 * that never existed.
 *
 * Scoping. The key is namespaced by parent, endpoint and item, so a guessed key
 * can only ever replay the caller's own response.
 *
 * Degradation. Every failure here — a missing table on a database that has not
 * caught up with its migrations, most likely — logs and lets the request run
 * unprotected. Refusing an edit because a de-duplication table is absent would
 * be a worse outcome than the duplicate it prevents.
 */

'use strict';

const { prisma } = require('../config/database');
const logger = require('../utils/logger');

// After this a replay is an ordinary new request.
const TTL_MS = 24 * 60 * 60 * 1000;

const expiryCutoff = () => new Date(Date.now() - TTL_MS);

/**
 * Claim the key for this request.
 *
 * @returns {Promise<{replay?: {statusCode: number, body: *}, inFlight?: boolean,
 *   commit?: (statusCode: number, body: *) => Promise<void>,
 *   release?: () => Promise<void>}>}
 *   `replay` — the first call's answer, to return verbatim.
 *   `inFlight` — the first call has not answered yet; the caller should 409.
 *   `commit` — record this request's response. `release` — drop the claim so a
 *   failed request can be retried rather than replaying its own error.
 *   An empty object means idempotency is unavailable: carry on unprotected.
 */
const begin = async (scope, key) => {
  if (!key) return {};

  try {
    // Best-effort sweep of anything past its TTL, so the table cannot grow
    // without bound. Indexed on create_date, and a failure is not worth
    // reporting — the row it missed expires on the next pass.
    await prisma.idempotency_record.deleteMany({ where: { create_date: { lt: expiryCutoff() } } });

    await prisma.idempotency_record.create({ data: { scope, idem_key: key } });
    return {
      commit: (statusCode, body) => finish(scope, key, statusCode, body),
      release: () => discard(scope, key)
    };
  } catch (error) {
    // P2002: the unique index fired, so someone claimed this key first.
    if (error.code !== 'P2002') {
      logger.warn(`[IDEMPOTENCY] Unavailable for ${scope}: ${error.message}`);
      return {};
    }
  }

  const existing = await prisma.idempotency_record
    .findUnique({ where: { scope_idem_key: { scope, idem_key: key } } })
    .catch(() => null);

  if (!existing) return {};
  if (existing.status === 'done') {
    return { replay: { statusCode: existing.status_code || 200, body: existing.response_body } };
  }
  // Still running. A second write is exactly what this exists to prevent, so the
  // caller is told to wait rather than being let through.
  return { inFlight: true };
};

const finish = async (scope, key, statusCode, body) => {
  try {
    await prisma.idempotency_record.update({
      where: { scope_idem_key: { scope, idem_key: key } },
      data: { status: 'done', status_code: statusCode, response_body: body }
    });
  } catch (error) {
    // The write itself succeeded; only the ability to replay it is lost.
    logger.warn(`[IDEMPOTENCY] Could not record the response for ${scope}: ${error.message}`);
  }
};

const discard = async (scope, key) => {
  try {
    await prisma.idempotency_record.delete({
      where: { scope_idem_key: { scope, idem_key: key } }
    });
  } catch {
    // Nothing to release, or it is already gone. Either way it expires on its
    // own, and a failed request that cannot clear its claim is at worst retried
    // as an in-flight conflict.
  }
};

module.exports = { begin, TTL_MS };
