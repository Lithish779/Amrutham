'use strict';
const { E } = require('../lib/errors');

/** Fixed-window limiter on atomic Redis counters (in-memory fallback). keyFn selects the principal. */
function createRateLimiter({ cache, metrics }) {
  return function limit({ scope, windowSec = 60, max, keyFn = (req) => req.ip }) {
    return async (req, res, next) => {
      try {
        const key = `rl:${scope}:${keyFn(req)}`;
        const { count, ttlMs } = await cache.incr(key, windowSec);
        res.setHeader('RateLimit-Limit', String(max));
        res.setHeader('RateLimit-Remaining', String(Math.max(0, max - count)));
        if (count > max) {
          metrics.rateLimited.inc({ scope });
          throw E.tooMany(Math.max(1, Math.ceil(ttlMs / 1000)));
        }
        next();
      } catch (e) { next(e); }
    };
  };
}
module.exports = { createRateLimiter };
