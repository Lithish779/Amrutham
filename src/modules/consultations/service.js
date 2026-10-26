'use strict';
const { E } = require('../../lib/errors');
const { encodeCursor, decodeCursor } = require('../../lib/pagination');

const TS = `to_char(c.created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;

function createConsultationService({ db, config, cache, audit, jobs, gateway, metrics, logger, crypto: fc }) {
  const dto = (c, { phi = false } = {}) => ({
    id: c.id, patientId: c.patient_id, doctorId: c.doctor_id, slotId: c.slot_id, status: c.status,
    scheduledStart: c.scheduled_start, scheduledEnd: c.scheduled_end, cancelReason: c.cancel_reason,
    startedAt: c.started_at, endedAt: c.ended_at, createdAt: c.created_at,
    ...(phi ? { reason: fc.decrypt(c.reason_enc, `consult:${c.id}:reason`), notes: fc.decrypt(c.notes_enc, `consult:${c.id}:notes`) } : {}),
  });

  /* ------------------------------------------------------------------ booking saga
   * Step 1  (tx)   CAS slot AVAILABLE->HELD, insert consultation PENDING_PAYMENT, insert payment INITIATED
   * Step 2  (call) create payment intent at provider (retry+backoff+circuit breaker)   -- outside any DB tx
   * Step 3  (hook) webhook payment.succeeded -> CONFIRMED + slot BOOKED   |   payment.failed / timeout -> compensate
   * Compensation   consultation EXPIRED/CANCELLED, slot HELD->AVAILABLE, payment FAILED (idempotent, guarded by status)
   * ----------------------------------------------------------------------------------------------- */
  async function book(patientId, { slotId, reason }, req) {
    let created;
    try {
      created = await db.tx(async (t) => {
        const { rows: [slot] } = await t.query(
          `UPDATE availability_slots s SET status = 'HELD', hold_expires_at = now() + make_interval(secs => $2), version = version + 1
           FROM doctors d
           WHERE s.id = $1 AND d.user_id = s.doctor_id AND d.is_verified AND s.status = 'AVAILABLE'
             AND s.start_time > now() + make_interval(mins => $3)
           RETURNING s.*, d.consultation_fee_paise AS fee`, [slotId, config.slotHoldSeconds, config.minBookingLeadMinutes]);
        if (!slot) {
          const { rows: [ex] } = await t.query('SELECT status, start_time FROM availability_slots WHERE id = $1', [slotId]);
          if (!ex) throw E.notFound('Slot not found');
          throw E.conflict('SLOT_UNAVAILABLE', 'Slot is no longer available');
        }
        const free = slot.fee === 0;
        const id = (await t.query('SELECT gen_random_uuid() AS id')).rows[0].id;
        const { rows: [c] } = await t.query(
          `INSERT INTO consultations (id, patient_id, doctor_id, slot_id, status, scheduled_start, scheduled_end, reason_enc)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
          [id, patientId, slot.doctor_id, slot.id, free ? 'CONFIRMED' : 'PENDING_PAYMENT', slot.start_time, slot.end_time,
            reason ? fc.encrypt(reason, `consult:${id}:reason`) : null]);
        let payment = null;
        if (free) {
          await t.query("UPDATE availability_slots SET status = 'BOOKED', hold_expires_at = NULL WHERE id = $1", [slot.id]);
        } else {
          payment = (await t.query(
            `INSERT INTO payments (consultation_id, patient_id, amount_paise, status) VALUES ($1,$2,$3,'INITIATED') RETURNING *`,
            [c.id, patientId, slot.fee])).rows[0];
        }
        return { c, payment };
      });
    } catch (e) {
      metrics.bookings.inc({ result: e.code === 'SLOT_UNAVAILABLE' ? 'slot_unavailable' : 'rejected' });
      throw e;
    }

    let intent = null;
    if (created.payment) {
      try {
        intent = await gateway.createIntent({
          paymentId: created.payment.id, amountPaise: created.payment.amount_paise, currency: created.payment.currency,
          idempotencyKey: `intent-${created.payment.id}`,
        });
        await db.query('UPDATE payments SET provider_ref = $2, updated_at = now() WHERE id = $1', [created.payment.id, intent.providerRef]);
      } catch (err) {
        logger.error({ err, consultationId: created.c.id }, 'payment intent failed; compensating');
        await db.tx((t) => compensateTx(t, created.c.id, 'EXPIRED', 'PAYMENT_INIT_FAILED'));
        metrics.bookings.inc({ result: 'payment_init_failed' });
        throw E.unavailable('Payment provider unavailable; slot released, please retry');
      }
    }
    await cache.bump('search');
    await cache.bump(`doctor:${created.c.doctor_id}:slots`);
    metrics.bookings.inc({ result: created.payment ? 'pending_payment' : 'confirmed' });
    await audit.log({ action: 'CONSULTATION_BOOKED', resourceType: 'consultation', resourceId: created.c.id, metadata: { slotId, doctorId: created.c.doctor_id } }, req);
    if (!created.payment) await jobs.enqueue('send-notification', { type: 'BOOKING_CONFIRMED', consultationId: created.c.id });
    return {
      consultation: dto(created.c),
      payment: created.payment && {
        id: created.payment.id, status: 'INITIATED', amountPaise: created.payment.amount_paise, currency: created.payment.currency,
        clientSecret: intent.clientSecret, expiresInSeconds: config.slotHoldSeconds,
      },
    };
  }

  /** Must run inside a tx. Idempotent: only acts while the consultation is still PENDING_PAYMENT. */
  async function compensateTx(t, consultationId, newStatus, reason) {
    const { rows: [c] } = await t.query('SELECT * FROM consultations WHERE id = $1 FOR UPDATE', [consultationId]);
    if (!c || c.status !== 'PENDING_PAYMENT') return false;
    await t.query('UPDATE consultations SET status=$2, cancel_reason=$3, updated_at=now() WHERE id=$1', [consultationId, newStatus, reason]);
    await t.query("UPDATE availability_slots SET status='AVAILABLE', hold_expires_at=NULL, version=version+1 WHERE id=$1 AND status='HELD'", [c.slot_id]);
    await t.query("UPDATE payments SET status='FAILED', updated_at=now() WHERE consultation_id=$1 AND status='INITIATED'", [consultationId]);
    metrics.sagaCompensations.inc({ reason });
    return true;
  }

  /* ------------------------------------------------------------------ payment webhook (at-least-once -> exactly-once effect) */
  async function handlePaymentEvent(evt) {
    const outcome = await db.tx(async (t) => {
      const ins = await t.query('INSERT INTO payment_events (event_id, type) VALUES ($1,$2) ON CONFLICT DO NOTHING', [evt.id, evt.type]);
      if (ins.rowCount === 0) return { duplicate: true };
      const { rows: [p] } = await t.query('SELECT * FROM payments WHERE provider = $1 AND provider_ref = $2 FOR UPDATE', ['mock', evt.providerRef]);
      if (!p) throw E.notFound('Unknown payment'); // rolls back the dedupe row too, provider will redeliver
      await t.query('UPDATE payment_events SET payment_id = $2 WHERE event_id = $1', [evt.id, p.id]);
      const effects = [];
      if (evt.type === 'payment.succeeded') {
        if (p.status === 'SUCCEEDED' || p.status === 'REFUNDED' || p.status === 'REFUND_PENDING') return { effects };
        const { rows: [c] } = await t.query('SELECT * FROM consultations WHERE id = $1 FOR UPDATE', [p.consultation_id]);
        if (c.status === 'PENDING_PAYMENT') {
          await t.query("UPDATE payments SET status='SUCCEEDED', updated_at=now() WHERE id=$1", [p.id]);
          await t.query("UPDATE consultations SET status='CONFIRMED', updated_at=now() WHERE id=$1", [c.id]);
          await t.query("UPDATE availability_slots SET status='BOOKED', hold_expires_at=NULL, version=version+1 WHERE id=$1", [c.slot_id]);
          effects.push(['send-notification', { type: 'BOOKING_CONFIRMED', consultationId: c.id }]);
        } else {
          // money arrived after the hold expired/cancelled -> compensate by refunding
          await t.query("UPDATE payments SET status='REFUND_PENDING', updated_at=now() WHERE id=$1", [p.id]);
          metrics.sagaCompensations.inc({ reason: 'LATE_PAYMENT_REFUND' });
          effects.push(['refund-payment', { paymentId: p.id }]);
        }
      } else if (evt.type === 'payment.failed') {
        if (p.status === 'INITIATED') await compensateTx(t, p.consultation_id, 'CANCELLED', 'PAYMENT_FAILED');
      }
      return { effects, consultationId: p.consultation_id };
    });
    for (const [name, data] of outcome.effects || []) await jobs.enqueue(name, data);
    if (!outcome.duplicate) await audit.log({ actor: { role: 'system' }, action: `PAYMENT_EVENT_${evt.type}`, resourceType: 'consultation', resourceId: outcome.consultationId, metadata: { eventId: evt.id } });
    await cache.bump('search');
    return { duplicate: !!outcome.duplicate };
  }

  /* ------------------------------------------------------------------ lifecycle */
  async function fetchAuthorized(actor, id, t = db) {
    const { rows: [c] } = await t.query('SELECT * FROM consultations WHERE id = $1', [id]);
    if (!c) throw E.notFound('Consultation not found');
    const mine = c.patient_id === actor.id || c.doctor_id === actor.id;
    if (!mine && actor.role !== 'admin') throw E.notFound('Consultation not found'); // do not leak existence
    return { c, mine };
  }

  async function cancel(actor, id, reason, req) {
    const result = await db.tx(async (t) => {
      const { rows: [c] } = await t.query('SELECT * FROM consultations WHERE id = $1 FOR UPDATE', [id]);
      if (!c || (c.patient_id !== actor.id && c.doctor_id !== actor.id && actor.role !== 'admin')) throw E.notFound('Consultation not found');
      if (c.status === 'PENDING_PAYMENT') {
        await compensateTx(t, id, 'CANCELLED', reason || 'CANCELLED_BY_USER');
        await t.query('UPDATE consultations SET cancelled_by=$2 WHERE id=$1', [id, actor.id]);
        return { effects: [] };
      }
      if (c.status !== 'CONFIRMED') throw E.conflict('INVALID_STATE_TRANSITION', `Cannot cancel a ${c.status} consultation`);
      const byProvider = actor.id === c.doctor_id || actor.role === 'admin';
      await t.query("UPDATE consultations SET status='CANCELLED', cancel_reason=$2, cancelled_by=$3, updated_at=now() WHERE id=$1", [id, reason || 'CANCELLED_BY_USER', actor.id]);
      await t.query('UPDATE availability_slots SET status=$2, hold_expires_at=NULL, version=version+1 WHERE id=$1',
        [c.slot_id, byProvider ? 'CANCELLED' : 'AVAILABLE']);
      const effects = [['send-notification', { type: 'BOOKING_CANCELLED', consultationId: id }]];
      const { rows: [p] } = await t.query("SELECT * FROM payments WHERE consultation_id=$1 AND status='SUCCEEDED' FOR UPDATE", [id]);
      if (p) {
        const hoursLeft = (new Date(c.scheduled_start) - Date.now()) / 3600_000;
        if (byProvider || hoursLeft >= 2) {
          await t.query("UPDATE payments SET status='REFUND_PENDING', updated_at=now() WHERE id=$1", [p.id]);
          effects.push(['refund-payment', { paymentId: p.id }]);
        }
      }
      return { effects };
    });
    for (const [name, data] of result.effects) await jobs.enqueue(name, data);
    await cache.bump('search');
    await audit.log({ action: 'CONSULTATION_CANCELLED', resourceType: 'consultation', resourceId: id }, req);
    return dto((await fetchAuthorized(actor, id)).c);
  }

  async function transition(actor, id, from, to, extraSql, params, action, req) {
    const { rows: [c] } = await db.query(
      `UPDATE consultations SET status = $3, updated_at = now() ${extraSql} WHERE id = $1 AND doctor_id = $2 AND status = $4 RETURNING *`,
      [id, actor.id, to, from, ...params]);
    if (!c) {
      const { rows: [ex] } = await db.query('SELECT doctor_id, status FROM consultations WHERE id = $1', [id]);
      if (!ex || ex.doctor_id !== actor.id) throw E.notFound('Consultation not found');
      throw E.conflict('INVALID_STATE_TRANSITION', `Cannot move ${ex.status} -> ${to}`);
    }
    await audit.log({ action, resourceType: 'consultation', resourceId: id }, req);
    return c;
  }

  async function start(actor, id, req) {
    const { rows: [pre] } = await db.query('SELECT scheduled_start, scheduled_end, doctor_id FROM consultations WHERE id=$1', [id]);
    if (!pre || pre.doctor_id !== actor.id) throw E.notFound('Consultation not found');
    const now = Date.now();
    if (now < new Date(pre.scheduled_start) - 10 * 60000) throw E.conflict('TOO_EARLY', 'Consultation can be started 10 minutes before the slot');
    if (now > new Date(pre.scheduled_end)) throw E.conflict('SLOT_ENDED', 'Slot has ended');
    return dto(await transition(actor, id, 'CONFIRMED', 'IN_PROGRESS', ', started_at = now()', [], 'CONSULTATION_STARTED', req));
  }

  async function complete(actor, id, notes, req) {
    const enc = notes ? fc.encrypt(notes, `consult:${id}:notes`) : null;
    const c = await transition(actor, id, 'IN_PROGRESS', 'COMPLETED', ', ended_at = now(), notes_enc = COALESCE($5, notes_enc)', [enc], 'CONSULTATION_COMPLETED', req);
    return dto(c);
  }

  /* ------------------------------------------------------------------ reads */
  async function get(actor, id, req) {
    const { c, mine } = await fetchAuthorized(actor, id);
    if (mine) await audit.log({ action: 'CONSULTATION_PHI_READ', resourceType: 'consultation', resourceId: id }, req);
    return dto(c, { phi: mine }); // admins see lifecycle metadata, never PHI
  }

  async function list(actor, { status, limit, cursor }) {
    const params = []; const where = [];
    if (actor.role === 'patient') { params.push(actor.id); where.push(`c.patient_id = $${params.length}`); }
    if (actor.role === 'doctor') { params.push(actor.id); where.push(`c.doctor_id = $${params.length}`); }
    if (status) { params.push(status); where.push(`c.status = $${params.length}`); }
    const cur = decodeCursor(cursor);
    if (cur) { params.push(cur[0], cur[1]); where.push(`(c.created_at, c.id) < ($${params.length - 1}::timestamptz, $${params.length}::uuid)`); }
    params.push(limit + 1);
    const { rows } = await db.query(
      `SELECT c.*, ${TS} AS cursor_ts FROM consultations c ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
       ORDER BY c.created_at DESC, c.id DESC LIMIT $${params.length}`, params);
    const page = rows.slice(0, limit);
    const last = page[page.length - 1];
    return { items: page.map((c) => dto(c)), nextCursor: rows.length > limit ? encodeCursor([last.cursor_ts, last.id]) : null };
  }

  /* ------------------------------------------------------------------ background jobs */
  async function expireStaleHolds() {
    const { rows: [r] } = await db.query(
      `WITH stale AS (
         SELECT id FROM consultations WHERE status = 'PENDING_PAYMENT' AND created_at < now() - make_interval(secs => $1)
         ORDER BY created_at LIMIT 200 FOR UPDATE SKIP LOCKED),
       upd AS (UPDATE consultations c SET status = 'EXPIRED', cancel_reason = 'PAYMENT_TIMEOUT', updated_at = now()
               FROM stale WHERE c.id = stale.id RETURNING c.id, c.slot_id),
       sl AS (UPDATE availability_slots s SET status = 'AVAILABLE', hold_expires_at = NULL, version = version + 1
              FROM upd WHERE s.id = upd.slot_id AND s.status = 'HELD' RETURNING s.id),
       pay AS (UPDATE payments p SET status = 'FAILED', updated_at = now() FROM upd
               WHERE p.consultation_id = upd.id AND p.status = 'INITIATED' RETURNING p.id)
       SELECT (SELECT count(*) FROM upd)::int AS expired`, [config.slotHoldSeconds]);
    if (r.expired) { metrics.sagaCompensations.inc({ reason: 'PAYMENT_TIMEOUT' }, r.expired); await cache.bump('search'); }
    return r.expired;
  }

  async function markNoShows() {
    const r = await db.query(
      `UPDATE consultations SET status = 'NO_SHOW', updated_at = now() WHERE id IN (
         SELECT id FROM consultations WHERE status = 'CONFIRMED' AND scheduled_end < now() - interval '15 minutes'
         ORDER BY scheduled_end LIMIT 500 FOR UPDATE SKIP LOCKED)`);
    return r.rowCount;
  }

  async function processRefund(paymentId) {
    const { rows: [p] } = await db.query('SELECT * FROM payments WHERE id = $1', [paymentId]);
    if (!p || p.status !== 'REFUND_PENDING') return 'skipped';
    const out = await gateway.refund({ providerRef: p.provider_ref, amountPaise: p.amount_paise, idempotencyKey: `refund-${p.id}` });
    await db.query("UPDATE payments SET status='REFUNDED', refund_ref=$2, updated_at=now() WHERE id=$1 AND status='REFUND_PENDING'", [p.id, out.refundRef]);
    await audit.log({ actor: { role: 'system' }, action: 'PAYMENT_REFUNDED', resourceType: 'payment', resourceId: p.id });
    return 'refunded';
  }

  return { book, cancel, start, complete, get, list, handlePaymentEvent, expireStaleHolds, markNoShows, processRefund };
}
module.exports = { createConsultationService };
