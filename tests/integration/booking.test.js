const { boot, reset, auth, idem, uniq, registerPatient, createDoctor, createAdmin, createSlot, inMinutes, webhook, providerRefFor, book } = require('../helpers');
const { MockGateway } = require('../../src/modules/payments/gateway');

let t; let gw;
beforeAll(async () => {
  gw = new MockGateway();
  t = await boot({ gateway: gw });
});
afterAll(async () => { await t.c.close(); });
beforeEach(async () => { await reset(t.c); gw.failRate = 0; });

const statusOf = async (id) => (await t.c.db.query('SELECT status FROM consultations WHERE id=$1', [id])).rows[0].status;
const slotStatus = async (id) => (await t.c.db.query('SELECT status FROM availability_slots WHERE id=$1', [id])).rows[0].status;

describe('slot management', () => {
  test('overlapping slots are rejected by the DB exclusion constraint; creation is atomic', async () => {
    const d = await createDoctor(t.api, t.c);
    await createSlot(t.api, d, 120, 30);
    const r = await t.api.post('/api/v1/doctors/me/slots').set(idem(d.token)).send({ slots: [inMinutes(300), inMinutes(130, 30)] });
    expect(r.status).toBe(409);
    expect(r.body.error.code).toBe('SLOT_OVERLAP');
    const { rows } = await t.c.db.query('SELECT 1 FROM availability_slots WHERE doctor_id=$1', [d.id]);
    expect(rows.length).toBe(1); // the non-overlapping 300-minute slot was rolled back too
  });
  test('past, too-long and too-far slots are rejected', async () => {
    const d = await createDoctor(t.api, t.c);
    for (const s of [inMinutes(-60), inMinutes(60, 500), inMinutes(60 * 24 * 120)]) {
      expect((await t.api.post('/api/v1/doctors/me/slots').set(idem(d.token)).send({ slots: [s] })).status).toBe(400);
    }
  });
  test('only verified doctors are listed / bookable', async () => {
    const d = await createDoctor(t.api, t.c, { verified: false });
    const slot = await createSlot(t.api, d);
    const p = await registerPatient(t.api);
    expect((await t.api.get(`/api/v1/doctors/${d.id}`)).status).toBe(404);
    expect((await book(t.api, p, slot.id)).status).toBe(409);
  });
});

describe('booking saga', () => {
  test('happy path: PENDING_PAYMENT -> webhook -> CONFIRMED + slot BOOKED; server decides the price', async () => {
    const d = await createDoctor(t.api, t.c, { fee: 75000 });
    const slot = await createSlot(t.api, d);
    const p = await registerPatient(t.api);
    const r = await book(t.api, p, slot.id, 'fever and headache');
    expect(r.status).toBe(201);
    expect(r.body.consultation.status).toBe('PENDING_PAYMENT');
    expect(r.body.payment.amountPaise).toBe(75000);
    expect(await slotStatus(slot.id)).toBe('HELD');

    const w = await webhook(t.api, t.c, await providerRefFor(t.c, r.body.consultation.id));
    expect(w.status).toBe(200);
    expect(await statusOf(r.body.consultation.id)).toBe('CONFIRMED');
    expect(await slotStatus(slot.id)).toBe('BOOKED');
    const { rows: [pay] } = await t.c.db.query('SELECT status FROM payments WHERE consultation_id=$1', [r.body.consultation.id]);
    expect(pay.status).toBe('SUCCEEDED');
    // reason (PHI) encrypted at rest, visible to the patient
    const { rows: [c] } = await t.c.db.query('SELECT reason_enc FROM consultations WHERE id=$1', [r.body.consultation.id]);
    expect(c.reason_enc).not.toContain('fever');
    const got = await t.api.get(`/api/v1/consultations/${r.body.consultation.id}`).set(auth(p.token));
    expect(got.body.reason).toBe('fever and headache');
  });

  test('free consultation confirms immediately without payment', async () => {
    const d = await createDoctor(t.api, t.c, { fee: 0 });
    const slot = await createSlot(t.api, d);
    const p = await registerPatient(t.api);
    const r = await book(t.api, p, slot.id);
    expect(r.body.consultation.status).toBe('CONFIRMED');
    expect(r.body.payment).toBeNull();
    expect(await slotStatus(slot.id)).toBe('BOOKED');
  });

  test('RACE: 12 patients book the same slot concurrently -> exactly one wins, no double booking', async () => {
    const d = await createDoctor(t.api, t.c);
    const slot = await createSlot(t.api, d);
    const patients = await Promise.all(Array.from({ length: 12 }, () => registerPatient(t.api)));
    const rs = await Promise.all(patients.map((p) => book(t.api, p, slot.id)));
    const wins = rs.filter((r) => r.status === 201);
    expect(wins.length).toBe(1);
    expect(rs.filter((r) => r.status === 409).every((r) => r.body.error.code === 'SLOT_UNAVAILABLE')).toBe(true);
    const { rows } = await t.c.db.query("SELECT 1 FROM consultations WHERE slot_id=$1 AND status IN ('PENDING_PAYMENT','CONFIRMED')", [slot.id]);
    expect(rows.length).toBe(1);
  });

  test('DB constraint is the last line of defence even if the slot CAS were bypassed', async () => {
    const d = await createDoctor(t.api, t.c);
    const slot = await createSlot(t.api, d);
    const p1 = await registerPatient(t.api); const p2 = await registerPatient(t.api);
    const r = await book(t.api, p1, slot.id);
    const ins = (pid) => t.c.db.query(
      `INSERT INTO consultations (patient_id, doctor_id, slot_id, status, scheduled_start, scheduled_end)
       SELECT $1, doctor_id, id, 'PENDING_PAYMENT', start_time, end_time FROM availability_slots WHERE id = $2`, [pid, slot.id]);
    await expect(ins(p2.id)).rejects.toMatchObject({ constraint: 'consult_slot_active_uq' });
    expect(r.status).toBe(201);
  });

  test('a patient cannot hold two overlapping consultations', async () => {
    const d1 = await createDoctor(t.api, t.c); const d2 = await createDoctor(t.api, t.c);
    const s1 = await createSlot(t.api, d1, 120); const s2 = await createSlot(t.api, d2, 120);
    const p = await registerPatient(t.api);
    expect((await book(t.api, p, s1.id)).status).toBe(201);
    const r = await book(t.api, p, s2.id);
    expect(r.status).toBe(409);
    expect(r.body.error.code).toBe('PATIENT_OVERLAP');
    expect(await slotStatus(s2.id)).toBe('AVAILABLE'); // whole transaction rolled back, slot not leaked in HELD
  });

  test('payment failure compensates: consultation cancelled, slot reopened, others can book', async () => {
    const d = await createDoctor(t.api, t.c);
    const slot = await createSlot(t.api, d);
    const p1 = await registerPatient(t.api); const p2 = await registerPatient(t.api);
    const r = await book(t.api, p1, slot.id);
    await webhook(t.api, t.c, await providerRefFor(t.c, r.body.consultation.id), 'payment.failed');
    expect(await statusOf(r.body.consultation.id)).toBe('CANCELLED');
    expect(await slotStatus(slot.id)).toBe('AVAILABLE');
    expect((await book(t.api, p2, slot.id)).status).toBe(201);
  });

  test('payment timeout: sweeper expires the hold and frees the slot; late payment is refunded (saga compensation)', async () => {
    const d = await createDoctor(t.api, t.c);
    const slot = await createSlot(t.api, d);
    const p = await registerPatient(t.api);
    const r = await book(t.api, p, slot.id);
    const id = r.body.consultation.id;
    const ref = await providerRefFor(t.c, id);
    await t.c.db.query("UPDATE consultations SET created_at = now() - interval '1 hour' WHERE id=$1", [id]);
    expect(await t.c.consultationService.expireStaleHolds()).toBe(1);
    expect(await statusOf(id)).toBe('EXPIRED');
    expect(await slotStatus(slot.id)).toBe('AVAILABLE');

    const w = await webhook(t.api, t.c, ref); // money arrives after expiry
    expect(w.status).toBe(200);
    await t.c.jobs.idle();
    const { rows: [pay] } = await t.c.db.query('SELECT status, refund_ref FROM payments WHERE consultation_id=$1', [id]);
    expect(pay.status).toBe('REFUNDED');
    expect(pay.refund_ref).toMatch(/^mock_re_/);
    expect(await statusOf(id)).toBe('EXPIRED');
  });

  test('payment provider outage: bounded retries, saga compensates, user gets 503, slot is released', async () => {
    const d = await createDoctor(t.api, t.c);
    const slot = await createSlot(t.api, d);
    const p = await registerPatient(t.api);
    gw.failRate = 1;
    const r = await book(t.api, p, slot.id);
    expect(r.status).toBe(503);
    expect(await slotStatus(slot.id)).toBe('AVAILABLE');
    const { rows } = await t.c.db.query("SELECT status FROM consultations WHERE slot_id=$1", [slot.id]);
    expect(rows[0].status).toBe('EXPIRED');
    gw.failRate = 0;
  });

  test('transient provider errors are retried transparently', async () => {
    const d = await createDoctor(t.api, t.c);
    const slot = await createSlot(t.api, d);
    const p = await registerPatient(t.api);
    let n = 0;
    const orig = gw.createIntent.bind(gw);
    gw.createIntent = async (a) => { if (++n < 3) { const e = new Error('503'); e.transient = true; throw e; } return orig(a); };
    const r = await book(t.api, p, slot.id);
    expect(r.status).toBe(201);
    expect(n).toBe(3);
    gw.createIntent = orig;
  });
});

describe('idempotency', () => {
  test('same key + same body replays the original response; only one consultation exists', async () => {
    const d = await createDoctor(t.api, t.c);
    const slot = await createSlot(t.api, d);
    const p = await registerPatient(t.api);
    const key = uniq('book');
    const a = await book(t.api, p, slot.id, undefined, key);
    const b = await book(t.api, p, slot.id, undefined, key);
    expect(a.status).toBe(201);
    expect(b.status).toBe(201);
    expect(b.headers['idempotent-replayed']).toBe('true');
    expect(b.body).toEqual(a.body);
    const { rows } = await t.c.db.query('SELECT 1 FROM consultations WHERE slot_id=$1', [slot.id]);
    expect(rows.length).toBe(1);
  });
  test('same key + different body -> 422', async () => {
    const d = await createDoctor(t.api, t.c);
    const s1 = await createSlot(t.api, d, 120); const s2 = await createSlot(t.api, d, 240);
    const p = await registerPatient(t.api);
    const key = uniq('book');
    await book(t.api, p, s1.id, undefined, key);
    const r = await book(t.api, p, s2.id, undefined, key);
    expect(r.status).toBe(422);
    expect(r.body.error.code).toBe('IDEMPOTENCY_KEY_REUSED');
  });
  test('missing or malformed key -> 400', async () => {
    const p = await registerPatient(t.api);
    const slotId = '00000000-0000-4000-8000-000000000000';
    expect((await t.api.post('/api/v1/consultations').set(auth(p.token)).send({ slotId })).status).toBe(400);
    expect((await t.api.post('/api/v1/consultations').set({ ...auth(p.token), 'Idempotency-Key': 'x' }).send({ slotId })).status).toBe(400);
  });
  test('concurrent duplicates with one key: one execution, the rest replay or get 409 in-progress', async () => {
    const d = await createDoctor(t.api, t.c);
    const slot = await createSlot(t.api, d);
    const p = await registerPatient(t.api);
    const key = uniq('race');
    const rs = await Promise.all(Array.from({ length: 6 }, () => book(t.api, p, slot.id, undefined, key)));
    expect(rs.every((r) => [201, 409].includes(r.status))).toBe(true);
    expect(rs.filter((r) => r.status === 201).length).toBeGreaterThanOrEqual(1);
    const { rows } = await t.c.db.query('SELECT 1 FROM consultations WHERE slot_id=$1', [slot.id]);
    expect(rows.length).toBe(1);
  });
  test('keys are scoped per user', async () => {
    const d = await createDoctor(t.api, t.c, { fee: 0 });
    const s1 = await createSlot(t.api, d, 120); const s2 = await createSlot(t.api, d, 240);
    const p1 = await registerPatient(t.api); const p2 = await registerPatient(t.api);
    const key = uniq('shared');
    expect((await book(t.api, p1, s1.id, undefined, key)).status).toBe(201);
    expect((await book(t.api, p2, s2.id, undefined, key)).status).toBe(201);
  });
});

describe('payment webhook security', () => {
  test('rejects bad signature, stale timestamp and unknown fields; duplicates have no second effect', async () => {
    const d = await createDoctor(t.api, t.c);
    const slot = await createSlot(t.api, d);
    const p = await registerPatient(t.api);
    const r = await book(t.api, p, slot.id);
    const ref = await providerRefFor(t.c, r.body.consultation.id);
    const body = JSON.stringify({ id: 'evt_forged_1', type: 'payment.succeeded', providerRef: ref });
    const bad = await t.api.post('/api/v1/webhooks/payments').set('content-type', 'application/json')
      .set('x-webhook-timestamp', String(Math.floor(Date.now() / 1000))).set('x-webhook-signature', 'deadbeef').send(body);
    expect(bad.status).toBe(401);
    expect(await statusOf(r.body.consultation.id)).toBe('PENDING_PAYMENT');
    const stale = await t.api.post('/api/v1/webhooks/payments').set('content-type', 'application/json')
      .set('x-webhook-timestamp', '1000').set('x-webhook-signature', 'x').send(body);
    expect(stale.status).toBe(401);

    const eid = uniq('evt_dup');
    const w1 = await webhook(t.api, t.c, ref, 'payment.succeeded', eid);
    const w2 = await webhook(t.api, t.c, ref, 'payment.succeeded', eid);
    expect(w1.body.duplicate).toBe(false);
    expect(w2.body.duplicate).toBe(true);
    const { rows } = await t.c.db.query("SELECT 1 FROM audit_logs WHERE action = 'PAYMENT_EVENT_payment.succeeded'");
    expect(rows.length).toBe(1);
  });
  test('unknown payment -> 404 and the dedupe row is rolled back (provider can redeliver)', async () => {
    const eid = uniq('evt_unknown');
    const w = await webhook(t.api, t.c, 'mock_pi_missing', 'payment.succeeded', eid);
    expect(w.status).toBe(404);
    expect((await t.c.db.query('SELECT 1 FROM payment_events WHERE event_id=$1', [eid])).rowCount).toBe(0);
  });
});

describe('lifecycle, cancellation and refunds', () => {
  async function confirmed({ fee = 50000, minutes = 120 } = {}) {
    const d = await createDoctor(t.api, t.c, { fee });
    const slot = await createSlot(t.api, d, minutes);
    const p = await registerPatient(t.api);
    const r = await book(t.api, p, slot.id);
    if (fee) await webhook(t.api, t.c, await providerRefFor(t.c, r.body.consultation.id));
    return { d, p, slot, id: r.body.consultation.id };
  }

  test('patient cancels >=2h before: slot reopens and full refund is issued', async () => {
    const { p, slot, id } = await confirmed({ minutes: 240 });
    const r = await t.api.post(`/api/v1/consultations/${id}/cancel`).set(idem(p.token)).send({ reason: 'cannot attend' });
    expect(r.status).toBe(200);
    expect(r.body.status).toBe('CANCELLED');
    await t.c.jobs.idle();
    expect(await slotStatus(slot.id)).toBe('AVAILABLE');
    expect((await t.c.db.query('SELECT status FROM payments WHERE consultation_id=$1', [id])).rows[0].status).toBe('REFUNDED');
  });
  test('late patient cancellation (<2h) gets no refund; doctor cancellation always refunds and closes the slot', async () => {
    const a = await confirmed({ minutes: 60 });
    await t.api.post(`/api/v1/consultations/${a.id}/cancel`).set(idem(a.p.token)).send({});
    await t.c.jobs.idle();
    expect((await t.c.db.query('SELECT status FROM payments WHERE consultation_id=$1', [a.id])).rows[0].status).toBe('SUCCEEDED');
    const b = await confirmed({ minutes: 60 });
    await t.api.post(`/api/v1/consultations/${b.id}/cancel`).set(idem(b.d.token)).send({});
    await t.c.jobs.idle();
    expect((await t.c.db.query('SELECT status FROM payments WHERE consultation_id=$1', [b.id])).rows[0].status).toBe('REFUNDED');
    expect(await slotStatus(b.slot.id)).toBe('CANCELLED');
  });
  test('cancelling twice does not double-refund (state machine guard)', async () => {
    const { p, id } = await confirmed({ minutes: 240 });
    await t.api.post(`/api/v1/consultations/${id}/cancel`).set(idem(p.token)).send({});
    const again = await t.api.post(`/api/v1/consultations/${id}/cancel`).set(idem(p.token)).send({});
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe('INVALID_STATE_TRANSITION');
  });
  test('stranger cannot see or cancel a consultation (404, not 403)', async () => {
    const { id } = await confirmed();
    const other = await registerPatient(t.api);
    expect((await t.api.get(`/api/v1/consultations/${id}`).set(auth(other.token))).status).toBe(404);
    expect((await t.api.post(`/api/v1/consultations/${id}/cancel`).set(idem(other.token)).send({})).status).toBe(404);
  });
  test('doctor start/complete with encrypted notes; early start blocked', async () => {
    const early = await confirmed({ minutes: 120 });
    const e = await t.api.post(`/api/v1/consultations/${early.id}/start`).set(auth(early.d.token));
    expect(e.status).toBe(409);
    expect(e.body.error.code).toBe('TOO_EARLY');

    const { d, p, id } = await confirmed({ minutes: 6 });
    expect((await t.api.post(`/api/v1/consultations/${id}/complete`).set(auth(d.token)).send({})).status).toBe(409); // not started
    expect((await t.api.post(`/api/v1/consultations/${id}/start`).set(auth(p.token))).status).toBe(403);
    expect((await t.api.post(`/api/v1/consultations/${id}/start`).set(auth(d.token))).body.status).toBe('IN_PROGRESS');
    const done = await t.api.post(`/api/v1/consultations/${id}/complete`).set(auth(d.token)).send({ notes: 'viral fever, rest advised' });
    expect(done.body.status).toBe('COMPLETED');
    const { rows: [row] } = await t.c.db.query('SELECT notes_enc FROM consultations WHERE id=$1', [id]);
    expect(row.notes_enc).not.toContain('viral');
    const got = await t.api.get(`/api/v1/consultations/${id}`).set(auth(d.token));
    expect(got.body.notes).toBe('viral fever, rest advised');
  });
  test('no-show sweeper', async () => {
    const { id } = await confirmed();
    await t.c.db.query("UPDATE consultations SET scheduled_end = now() - interval '1 hour', scheduled_start = now() - interval '90 minutes' WHERE id=$1", [id]);
    expect(await t.c.consultationService.markNoShows()).toBe(1);
    expect(await statusOf(id)).toBe('NO_SHOW');
  });
  test('listing is role-scoped with keyset pagination', async () => {
    const d = await createDoctor(t.api, t.c, { fee: 0 });
    const p = await registerPatient(t.api);
    for (let i = 0; i < 5; i++) await book(t.api, p, (await createSlot(t.api, d, 120 + i * 60)).id);
    const other = await registerPatient(t.api);
    expect((await t.api.get('/api/v1/consultations').set(auth(other.token))).body.items).toHaveLength(0);
    const p1 = await t.api.get('/api/v1/consultations?limit=2').set(auth(p.token));
    expect(p1.body.items).toHaveLength(2);
    const p2 = await t.api.get(`/api/v1/consultations?limit=2&cursor=${p1.body.nextCursor}`).set(auth(p.token));
    const p3 = await t.api.get(`/api/v1/consultations?limit=2&cursor=${p2.body.nextCursor}`).set(auth(p.token));
    const ids = [...p1.body.items, ...p2.body.items, ...p3.body.items].map((x) => x.id);
    expect(new Set(ids).size).toBe(5);
    expect(p3.body.nextCursor).toBeNull();
  });
});

describe('prescriptions & PHI access control', () => {
  async function started() {
    const d = await createDoctor(t.api, t.c, { fee: 0 });
    const slot = await createSlot(t.api, d, 6);
    const p = await registerPatient(t.api);
    const r = await book(t.api, p, slot.id);
    const id = r.body.consultation.id;
    await t.api.post(`/api/v1/consultations/${id}/start`).set(auth(d.token));
    return { d, p, id };
  }
  const rx = { diagnosis: 'Acute pharyngitis', medications: [{ name: 'Paracetamol', dosage: '500mg', frequency: 'TID', durationDays: 3 }], instructions: 'Warm fluids' };

  test('issue, read, encrypted at rest, one per consultation, idempotent retry', async () => {
    const { d, p, id } = await started();
    const key = uniq('rx');
    const a = await t.api.post(`/api/v1/consultations/${id}/prescription`).set(idem(d.token, key)).send(rx);
    expect(a.status).toBe(201);
    const replay = await t.api.post(`/api/v1/consultations/${id}/prescription`).set(idem(d.token, key)).send(rx);
    expect(replay.status).toBe(201);
    expect(replay.headers['idempotent-replayed']).toBe('true');
    const dup = await t.api.post(`/api/v1/consultations/${id}/prescription`).set(idem(d.token)).send(rx);
    expect(dup.status).toBe(409);
    expect(dup.body.error.code).toBe('PRESCRIPTION_EXISTS');

    const { rows: [row] } = await t.c.db.query('SELECT diagnosis_enc, medications_enc FROM prescriptions WHERE consultation_id=$1', [id]);
    expect(row.diagnosis_enc).not.toContain('pharyngitis');
    expect(row.medications_enc).not.toContain('Paracetamol');

    const got = await t.api.get(`/api/v1/consultations/${id}/prescription`).set(auth(p.token));
    expect(got.body.diagnosis).toBe('Acute pharyngitis');
    expect(got.body.medications[0].name).toBe('Paracetamol');
    const { rows: audits } = await t.c.db.query("SELECT actor_id FROM audit_logs WHERE action='PRESCRIPTION_READ'");
    expect(audits[0].actor_id).toBe(p.id);
  });
  test('other patients, other doctors and admins cannot read a prescription', async () => {
    const { d, id } = await started();
    await t.api.post(`/api/v1/consultations/${id}/prescription`).set(idem(d.token)).send(rx);
    const stranger = await registerPatient(t.api);
    const otherDoc = await createDoctor(t.api, t.c);
    const admin = await createAdmin(t.api, t.c);
    expect((await t.api.get(`/api/v1/consultations/${id}/prescription`).set(auth(stranger.token))).status).toBe(404);
    expect((await t.api.get(`/api/v1/consultations/${id}/prescription`).set(auth(otherDoc.token))).status).toBe(404);
    expect((await t.api.get(`/api/v1/consultations/${id}/prescription`).set(auth(admin.token))).status).toBe(403);
    expect((await t.api.post(`/api/v1/consultations/${id}/prescription`).set(idem(otherDoc.token)).send(rx)).status).toBe(404);
  });
  test('admin sees consultation lifecycle metadata but never PHI', async () => {
    const { id, p } = await started();
    await t.c.db.query("UPDATE consultations SET reason_enc = $2 WHERE id=$1", [id, t.c.crypto.encrypt('private symptom', `consult:${id}:reason`)]);
    const admin = await createAdmin(t.api, t.c);
    const r = await t.api.get(`/api/v1/consultations/${id}`).set(auth(admin.token));
    expect(r.status).toBe(200);
    expect(r.body.reason).toBeUndefined();
    expect(r.body.notes).toBeUndefined();
    expect((await t.api.get(`/api/v1/consultations/${id}`).set(auth(p.token))).body.reason).toBe('private symptom');
  });
  test('prescriptions cannot be issued before the consultation has started', async () => {
    const d = await createDoctor(t.api, t.c, { fee: 0 });
    const slot = await createSlot(t.api, d, 120);
    const p = await registerPatient(t.api);
    const r = await book(t.api, p, slot.id);
    expect((await t.api.post(`/api/v1/consultations/${r.body.consultation.id}/prescription`).set(idem(d.token)).send(rx)).status).toBe(409);
  });
});
