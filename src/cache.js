'use strict';
const Redis = require('ioredis');

const INCR_LUA = `local c = redis.call('INCR', KEYS[1])
if c == 1 then redis.call('PEXPIRE', KEYS[1], ARGV[1]) end
return {c, redis.call('PTTL', KEYS[1])}`;

/**
 * Cache + counters. Redis when REDIS_URL is set, otherwise a bounded in-memory map (dev/test, single node).
 * The cache is best-effort: every Redis failure degrades to a miss (fail-open) and never fails a request.
 */
function createCache({ redisUrl, metrics, logger }) {
  let redis = null;
  const mem = new Map();
  const inflight = new Map();
  const MAX = 10000;

  if (redisUrl) {
    redis = new Redis(redisUrl, { maxRetriesPerRequest: 1, enableOfflineQueue: false, lazyConnect: false });
    redis.on('error', (e) => logger.warn({ err: e.message }, 'redis error'));
  }

  const memGet = (k) => {
    const e = mem.get(k);
    if (!e) return null;
    if (e.exp <= Date.now()) { mem.delete(k); return null; }
    return e;
  };
  const memSet = (k, v, ttlMs) => {
    if (mem.size >= MAX) mem.delete(mem.keys().next().value);
    mem.set(k, { v, exp: Date.now() + ttlMs });
  };

  async function get(key) {
    try {
      const raw = redis ? await redis.get(key) : (memGet(key) || {}).v;
      return raw ? JSON.parse(raw) : null;
    } catch (e) { logger.warn({ err: e.message }, 'cache get failed'); return null; }
  }
  async function set(key, value, ttlSec) {
    try {
      const raw = JSON.stringify(value);
      if (redis) await redis.set(key, raw, 'EX', ttlSec); else memSet(key, raw, ttlSec * 1000);
    } catch (e) { logger.warn({ err: e.message }, 'cache set failed'); }
  }
  async function del(key) {
    try { if (redis) await redis.del(key); else mem.delete(key); } catch (e) { logger.warn({ err: e.message }, 'cache del failed'); }
  }
  /** Atomic counter with TTL set on first increment. Returns { count, ttlMs }. Fails open. */
  async function incr(key, ttlSec) {
    try {
      if (redis) {
        const [count, ttlMs] = await redis.eval(INCR_LUA, 1, key, ttlSec * 1000);
        return { count, ttlMs };
      }
      const e = memGet(key);
      if (!e) { memSet(key, 1, ttlSec * 1000); return { count: 1, ttlMs: ttlSec * 1000 }; }
      e.v += 1;
      return { count: e.v, ttlMs: e.exp - Date.now() };
    } catch (e) { logger.warn({ err: e.message }, 'cache incr failed (fail-open)'); return { count: 0, ttlMs: 0 }; }
  }
  /** Read-through with single-flight (stampede protection) and TTL jitter (+-10%). */
  async function wrap(key, ttlSec, loader) {
    const hit = await get(key);
    if (hit !== null) { metrics.cacheOps.inc({ result: 'hit' }); return hit; }
    metrics.cacheOps.inc({ result: 'miss' });
    if (inflight.has(key)) return inflight.get(key);
    const p = (async () => {
      const value = await loader();
      await set(key, value, Math.max(1, Math.round(ttlSec * (0.9 + Math.random() * 0.2))));
      return value;
    })().finally(() => inflight.delete(key));
    inflight.set(key, p);
    return p;
  }
  /** Version counters give O(1) "invalidate everything for X" without key scans. */
  async function version(name) {
    const v = await get(`ver:${name}`);
    return v || 0;
  }
  async function bump(name) {
    await set(`ver:${name}`, Date.now(), 86400);
  }
  async function ping() { if (redis) await redis.ping(); }
  async function close() { if (redis) await redis.quit().catch(() => {}); }
  return { get, set, del, incr, wrap, version, bump, ping, close, enabled: !!redis, raw: () => redis };
}
module.exports = { createCache };
