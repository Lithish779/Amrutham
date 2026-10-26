'use strict';
const { Pool } = require('pg');
const { retry } = require('./lib/retry');

function createDb({ config, metrics, logger }) {
  const opts = (url) => ({
    connectionString: url,
    max: config.dbPoolMax,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000,
    statement_timeout: 15000,
    idle_in_transaction_session_timeout: 30000,
    application_name: 'amrutam-api',
  });
  const primary = new Pool(opts(config.databaseUrl));
  const replica = config.databaseReadUrl ? new Pool(opts(config.databaseReadUrl)) : primary;
  [primary, replica].forEach((p) => p.on('error', (e) => logger.error({ err: e }, 'idle pg client error')));

  async function timed(pool, label, text, params) {
    const end = metrics.dbDuration.startTimer({ pool: label });
    try {
      return await pool.query(text, params);
    } finally {
      end();
    }
  }

  /** Writes and read-your-writes queries -> primary. */
  const query = (text, params) => timed(primary, 'primary', text, params);
  /** Staleness-tolerant reads (search, analytics) -> replica when configured. */
  const read = (text, params) => timed(replica, replica === primary ? 'primary' : 'replica', text, params);

  /**
   * Runs fn inside a transaction. Retries serialization failures (40001) and deadlocks (40P01)
   * with jittered exponential backoff. `fn` must only perform DB work (no external calls).
   */
  async function tx(fn, { isolation, retries = 3 } = {}) {
    return retry(async () => {
      const client = await primary.connect();
      try {
        await client.query(`BEGIN${isolation ? ` ISOLATION LEVEL ${isolation}` : ''}`);
        const result = await fn({ query: (t, p) => client.query(t, p) });
        await client.query('COMMIT');
        return result;
      } catch (err) {
        try { await client.query('ROLLBACK'); } catch { /* connection may be dead */ }
        throw err;
      } finally {
        client.release();
      }
    }, {
      retries, baseMs: 20, maxMs: 300,
      shouldRetry: (e) => e.code === '40001' || e.code === '40P01',
      onRetry: () => metrics.dbRetries.inc(),
    });
  }

  async function ping() {
    await primary.query('SELECT 1');
    if (replica !== primary) await replica.query('SELECT 1');
  }
  async function close() {
    await primary.end();
    if (replica !== primary) await replica.end();
  }
  return { query, read, tx, ping, close, pool: primary };
}
module.exports = { createDb };
