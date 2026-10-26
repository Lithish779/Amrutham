'use strict';
const { sha256, canonicalJson } = require('../lib/crypto');
const { E } = require('../lib/errors');

const KEY_RE = /^[A-Za-z0-9_\-:.]{8,128}$/;
const LOCK_TTL_SEC = 30;

/**
 * Idempotency-Key support for non-safe client writes (Stripe-style semantics):
 *  - same key + same payload  -> original response replayed (header Idempotent-Replayed: true)
 *  - same key + other payload -> 422 IDEMPOTENCY_KEY_REUSED
 *  - same key while first request is running -> 409 REQUEST_IN_PROGRESS (+ Retry-After)
 *  - 5xx responses are not stored, so the client can safely retry the same key.
 * The key space is per authenticated user. Business invariants are additionally protected by DB constraints,
 * so a crashed request that is retried after the lock expires cannot double-apply.
 */
function createIdempotency({ db, metrics }) {
  return function idempotent() {
    return async (req, res, next) => {
      try {
        const key = req.get('idempotency-key');
        if (!key) throw E.badRequest('Idempotency-Key header is required for this operation');
        if (!KEY_RE.test(key)) throw E.badRequest('Idempotency-Key must be 8-128 chars of [A-Za-z0-9_-:.]');
        const userId = req.user.id;
        const hash = sha256(`${req.method} ${req.baseUrl}${req.path} ${canonicalJson(req.body || {})}`);

        const ins = await db.query(
          `INSERT INTO idempotency_keys (user_id, key, request_hash, status) VALUES ($1,$2,$3,'IN_PROGRESS')
           ON CONFLICT (user_id, key) DO NOTHING RETURNING key`, [userId, key, hash]);

        if (ins.rowCount === 0) {
          const { rows: [row] } = await db.query('SELECT * FROM idempotency_keys WHERE user_id=$1 AND key=$2', [userId, key]);
          if (!row) return next(E.conflict('REQUEST_IN_PROGRESS', 'Retry shortly'));
          if (row.request_hash !== hash) throw E.unprocessable('IDEMPOTENCY_KEY_REUSED', 'Idempotency-Key was already used with a different request');
          if (row.status === 'COMPLETED') {
            metrics.idempotentReplays.inc();
            res.setHeader('Idempotent-Replayed', 'true');
            return res.status(row.response_status).json(row.response_body);
          }
          // IN_PROGRESS: try to take over only if the previous attempt's lock is stale (crashed worker)
          const take = await db.query(
            `UPDATE idempotency_keys SET locked_at = now() WHERE user_id=$1 AND key=$2 AND status='IN_PROGRESS'
             AND locked_at < now() - make_interval(secs => $3) RETURNING key`, [userId, key, LOCK_TTL_SEC]);
          if (take.rowCount === 0) {
            res.setHeader('Retry-After', '1');
            throw E.conflict('REQUEST_IN_PROGRESS', 'A request with this Idempotency-Key is still being processed');
          }
        }

        const origJson = res.json.bind(res);
        res.json = (body) => {
          res.json = origJson;
          const status = res.statusCode;
          const persist = status >= 500
            ? db.query('DELETE FROM idempotency_keys WHERE user_id=$1 AND key=$2', [userId, key])
            : db.query(`UPDATE idempotency_keys SET status='COMPLETED', response_status=$3, response_body=$4 WHERE user_id=$1 AND key=$2`,
              [userId, key, status, JSON.stringify(body === undefined ? null : body)]);
          // persist BEFORE responding so a client retry right after the response always sees the stored result
          persist.catch(() => {}).finally(() => origJson(body));
          return res;
        };
        return next();
      } catch (e) { return next(e); }
    };
  };
}
module.exports = { createIdempotency };
