'use strict';
// Forward-only SQL migrations with an advisory lock (safe to run from every pod / a K8s Job).
const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

async function migrate(url = process.env.DATABASE_URL || 'postgres://amrutam:amrutam@localhost:5432/amrutam') {
  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    await client.query('SELECT pg_advisory_lock(727274)');
    await client.query('CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())');
    const dir = path.join(__dirname, '..', 'migrations');
    const done = new Set((await client.query('SELECT name FROM schema_migrations')).rows.map((r) => r.name));
    for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.sql')).sort()) {
      if (done.has(f)) continue;
      await client.query('BEGIN');
      try {
        await client.query(fs.readFileSync(path.join(dir, f), 'utf8'));
        await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [f]);
        await client.query('COMMIT');
        console.log(`applied ${f}`);
      } catch (e) { await client.query('ROLLBACK'); throw new Error(`${f}: ${e.message}`); }
    }
  } finally {
    await client.query('SELECT pg_advisory_unlock(727274)').catch(() => {});
    await client.end();
  }
}
if (require.main === module) migrate().then(() => console.log('migrations up to date')).catch((e) => { console.error(e); process.exit(1); });
module.exports = { migrate };
