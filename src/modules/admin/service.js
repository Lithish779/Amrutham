'use strict';
const { E } = require('../../lib/errors');
const { encodeCursor, decodeCursor } = require('../../lib/pagination');

function createAdminService({ db, cache, audit, config }) {
  async function overview({ from, to }) {
    const key = `analytics:overview:${from.toISOString().slice(0, 13)}:${to.toISOString().slice(0, 13)}`;
    return cache.wrap(key, 60, async () => {
      const args = [from, to];
      const [byStatus, daily, revenue, topDoctors, users, bySpec] = await Promise.all([
        db.read('SELECT status, count(*)::int AS n FROM consultations WHERE created_at >= $1 AND created_at < $2 GROUP BY status', args),
        db.read(`SELECT date_trunc('day', created_at AT TIME ZONE 'UTC')::date AS day, count(*)::int AS booked,
                   count(*) FILTER (WHERE status = 'COMPLETED')::int AS completed, count(*) FILTER (WHERE status IN ('CANCELLED','EXPIRED'))::int AS cancelled
                 FROM consultations WHERE created_at >= $1 AND created_at < $2 GROUP BY 1 ORDER BY 1`, args),
        db.read(`SELECT coalesce(sum(amount_paise) FILTER (WHERE status IN ('SUCCEEDED','REFUND_PENDING','REFUNDED')),0)::bigint AS gross,
                   coalesce(sum(amount_paise) FILTER (WHERE status = 'REFUNDED'),0)::bigint AS refunded,
                   count(*) FILTER (WHERE status = 'SUCCEEDED')::int AS paid_count
                 FROM payments WHERE created_at >= $1 AND created_at < $2`, args),
        db.read(`SELECT d.user_id, d.display_name, count(*)::int AS completed FROM consultations c JOIN doctors d ON d.user_id = c.doctor_id
                 WHERE c.status = 'COMPLETED' AND c.created_at >= $1 AND c.created_at < $2 GROUP BY 1,2 ORDER BY completed DESC LIMIT 10`, args),
        db.read(`SELECT role::text, count(*)::int AS n FROM users WHERE created_at >= $1 AND created_at < $2 GROUP BY role`, args),
        db.read(`SELECT d.specialization, count(*)::int AS n FROM consultations c JOIN doctors d ON d.user_id = c.doctor_id
                 WHERE c.created_at >= $1 AND c.created_at < $2 GROUP BY 1 ORDER BY n DESC LIMIT 10`, args),
      ]);
      const gross = Number(revenue.rows[0].gross); const refunded = Number(revenue.rows[0].refunded);
      return {
        range: { from, to },
        consultationsByStatus: Object.fromEntries(byStatus.rows.map((r) => [r.status, r.n])),
        daily: daily.rows,
        revenue: { grossPaise: gross, refundedPaise: refunded, netPaise: gross - refunded, paidConsultations: revenue.rows[0].paid_count },
        topDoctors: topDoctors.rows.map((r) => ({ doctorId: r.user_id, name: r.display_name, completed: r.completed })),
        newUsersByRole: Object.fromEntries(users.rows.map((r) => [r.role, r.n])),
        bySpecialization: bySpec.rows,
      };
    });
  }

  async function verifyDoctor(adminId, doctorId, verified) {
    const { rows: [d] } = await db.query('UPDATE doctors SET is_verified = $2, updated_at = now() WHERE user_id = $1 RETURNING user_id', [doctorId, verified]);
    if (!d) throw E.notFound('Doctor not found');
    await cache.bump('search');
    await audit.log({ actor: { id: adminId, role: 'admin' }, action: verified ? 'DOCTOR_VERIFIED' : 'DOCTOR_UNVERIFIED', resourceType: 'doctor', resourceId: doctorId, critical: true });
    return { id: doctorId, verified };
  }

  async function setUserStatus(adminId, userId, status) {
    if (adminId === userId) throw E.badRequest('You cannot change your own status');
    const { rows: [u] } = await db.query('UPDATE users SET status = $2, updated_at = now() WHERE id = $1 RETURNING id, status', [userId, status]);
    if (!u) throw E.notFound('User not found');
    if (status === 'DISABLED') {
      await db.query('UPDATE refresh_tokens SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL', [userId]);
      await cache.set(`revoked:${userId}`, 1, config.jwt.accessTtl); // kills live access tokens immediately
    } else await cache.del(`revoked:${userId}`);
    await audit.log({ actor: { id: adminId, role: 'admin' }, action: `USER_${status}`, resourceType: 'user', resourceId: userId, critical: true });
    return { id: u.id, status: u.status };
  }

  async function listUsers({ role, limit, cursor }) {
    const p = []; const w = [];
    if (role) { p.push(role); w.push(`role = $${p.length}`); }
    const cur = decodeCursor(cursor);
    if (cur) { p.push(cur[0], cur[1]); w.push(`(created_at, id) < ($${p.length - 1}::timestamptz, $${p.length}::uuid)`); }
    p.push(limit + 1);
    const { rows } = await db.read(
      `SELECT id, email, role, status, mfa_enabled, created_at,
         to_char(created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS cts
       FROM users ${w.length ? `WHERE ${w.join(' AND ')}` : ''} ORDER BY created_at DESC, id DESC LIMIT $${p.length}`, p);
    const page = rows.slice(0, limit); const last = page[page.length - 1];
    return {
      items: page.map((u) => ({ id: u.id, email: u.email, role: u.role, status: u.status, mfaEnabled: u.mfa_enabled, createdAt: u.created_at })),
      nextCursor: rows.length > limit ? encodeCursor([last.cts, last.id]) : null,
    };
  }

  async function listAudit({ actorId, action, resourceType, resourceId, from, to, limit, cursor }, adminReq) {
    const p = []; const w = [];
    const add = (v) => { p.push(v); return `$${p.length}`; };
    if (actorId) w.push(`actor_id = ${add(actorId)}`);
    if (action) w.push(`action = ${add(action)}`);
    if (resourceType) w.push(`resource_type = ${add(resourceType)}`);
    if (resourceId) w.push(`resource_id = ${add(resourceId)}`);
    if (from) w.push(`ts >= ${add(from)}`);
    if (to) w.push(`ts < ${add(to)}`);
    const cur = decodeCursor(cursor);
    if (cur) w.push(`id < ${add(cur[0])}::bigint`);
    const lim = add(limit + 1);
    const { rows } = await db.read(
      `SELECT id, ts, actor_id, actor_role, action, resource_type, resource_id, ip, request_id, metadata, hash
       FROM audit_logs ${w.length ? `WHERE ${w.join(' AND ')}` : ''} ORDER BY id DESC LIMIT ${lim}`, p);
    const page = rows.slice(0, limit);
    await audit.log({ action: 'AUDIT_LOG_QUERIED', resourceType: 'audit_log' }, adminReq);
    return {
      items: page.map((r) => ({ id: r.id, ts: r.ts, actorId: r.actor_id, actorRole: r.actor_role, action: r.action, resourceType: r.resource_type, resourceId: r.resource_id, ip: r.ip, requestId: r.request_id, metadata: r.metadata, hash: r.hash })),
      nextCursor: rows.length > limit ? encodeCursor([page[page.length - 1].id]) : null,
    };
  }
  return { overview, verifyDoctor, setUserStatus, listUsers, listAudit, verifyAudit: (o) => audit.verify(o) };
}
module.exports = { createAdminService };
