'use strict';
const context = require('./lib/context');
const { sha256, canonicalJson } = require('./lib/crypto');

/**
 * Tamper-evident audit trail: every row stores hash = sha256(prev_hash | fields). The chain head row is locked
 * for the duration of a very short transaction so the chain is strictly ordered. DB triggers forbid UPDATE/DELETE.
 * Never put PHI in metadata - ids and outcomes only.
 */
function createAudit({ db, metrics, logger }) {
  const compute = (prev, r) => sha256([prev, r.id, r.ts, r.actor_id || '', r.actor_role || '', r.action,
    r.resource_type || '', r.resource_id || '', canonicalJson(r.metadata || {})].join('|'));

  async function log(evt, req) {
    const ctx = context.get();
    const actor = evt.actor || (req && req.user && { id: req.user.id, role: req.user.role }) || {};
    const rec = {
      ts: new Date().toISOString(),
      actor_id: actor.id || null,
      actor_role: actor.role || null,
      action: evt.action,
      resource_type: evt.resourceType || null,
      resource_id: evt.resourceId ? String(evt.resourceId) : null,
      metadata: evt.metadata || {},
    };
    const ip = (req && req.ip) || evt.ip || null;
    const requestId = ctx.requestId || null;
    try {
      await db.tx(async (t) => {
        const head = (await t.query('SELECT last_hash FROM audit_chain_head WHERE singleton FOR UPDATE')).rows[0];
        const id = (await t.query("SELECT nextval('audit_logs_id_seq') AS id")).rows[0].id;
        const row = { ...rec, id };
        const hash = compute(head.last_hash, row);
        await t.query(
          `INSERT INTO audit_logs (id, ts, actor_id, actor_role, action, resource_type, resource_id, ip, request_id, metadata, prev_hash, hash)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
          [id, rec.ts, rec.actor_id, rec.actor_role, rec.action, rec.resource_type, rec.resource_id, ip, requestId,
            JSON.stringify(rec.metadata), head.last_hash, hash],
        );
        await t.query('UPDATE audit_chain_head SET last_id = $1, last_hash = $2 WHERE singleton', [id, hash]);
      });
    } catch (err) {
      metrics.auditFailures.inc();
      logger.error({ err, action: evt.action }, 'AUDIT WRITE FAILED');
      if (evt.critical) throw err; // fail closed for security-critical actions
    }
  }

  /** Re-computes the chain from `afterId` and reports the first inconsistency. */
  async function verify({ afterId = 0, limit = 5000 } = {}) {
    const { rows } = await db.query(
      'SELECT id, ts, actor_id, actor_role, action, resource_type, resource_id, metadata, prev_hash, hash FROM audit_logs WHERE id > $1 ORDER BY id LIMIT $2',
      [afterId, limit],
    );
    let prev = null;
    if (afterId > 0) {
      const p = await db.query('SELECT hash FROM audit_logs WHERE id = $1', [afterId]);
      prev = p.rows[0] ? p.rows[0].hash : null;
    } else prev = '0'.repeat(64);
    for (const r of rows) {
      const row = { ...r, id: r.id, ts: new Date(r.ts).toISOString() };
      if (prev !== null && r.prev_hash !== prev) return { ok: false, checked: rows.length, brokenAt: r.id, reason: 'prev_hash mismatch' };
      if (compute(r.prev_hash, row) !== r.hash) return { ok: false, checked: rows.length, brokenAt: r.id, reason: 'hash mismatch' };
      prev = r.hash;
    }
    return { ok: true, checked: rows.length, lastId: rows.length ? rows[rows.length - 1].id : afterId };
  }

  return { log, verify };
}
module.exports = { createAudit };
