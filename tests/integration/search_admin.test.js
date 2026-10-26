const SwaggerParser = require('@apidevtools/swagger-parser');
const path = require('path');
const { boot, reset, auth, idem, registerPatient, createDoctor, createAdmin, createSlot, webhook, providerRefFor, book } = require('../helpers');

let t;
beforeAll(async () => { t = await boot(); });
afterAll(async () => { await t.c.close(); });
beforeEach(async () => { await reset(t.c); });

describe('doctor search', () => {
  async function seed() {
    const a = await createDoctor(t.api, t.c, { name: 'Dr. Asha Verma', specialization: 'ayurveda', fee: 80000, languages: ['en', 'hi'], rating: 4.8 });
    const b = await createDoctor(t.api, t.c, { name: 'Dr. Rohan Mehta', specialization: 'dermatology', fee: 60000, languages: ['en'], rating: 4.5 });
    const c = await createDoctor(t.api, t.c, { name: 'Dr. Nisha Rao', specialization: 'ayurveda', fee: 30000, languages: ['en', 'ta'], rating: 4.2 });
    await createDoctor(t.api, t.c, { name: 'Dr. Hidden', specialization: 'ayurveda', verified: false });
    return { a, b, c };
  }
  test('filters: specialization, language, rating, fee; unverified doctors never appear; no PII leaked', async () => {
    const { a, c } = await seed();
    const all = await t.api.get('/api/v1/doctors');
    expect(all.body.items).toHaveLength(3);
    expect(JSON.stringify(all.body)).not.toMatch(/@test\.dev/);
    expect((await t.api.get('/api/v1/doctors?specialization=Ayurveda')).body.items.map((x) => x.id).sort()).toEqual([a.id, c.id].sort());
    expect((await t.api.get('/api/v1/doctors?language=ta')).body.items.map((x) => x.id)).toEqual([c.id]);
    expect((await t.api.get('/api/v1/doctors?minRating=4.6')).body.items.map((x) => x.id)).toEqual([a.id]);
    expect((await t.api.get('/api/v1/doctors?maxFee=40000')).body.items.map((x) => x.id)).toEqual([c.id]);
  });
  test('text search and sort orders', async () => {
    const { b } = await seed();
    expect((await t.api.get('/api/v1/doctors?q=rohan')).body.items.map((x) => x.id)).toEqual([b.id]);
    const byFee = (await t.api.get('/api/v1/doctors?sort=fee_asc')).body.items.map((x) => x.consultationFeePaise);
    expect(byFee).toEqual([30000, 60000, 80000]);
    const byRating = (await t.api.get('/api/v1/doctors?sort=rating')).body.items.map((x) => x.rating);
    expect(byRating).toEqual([4.8, 4.5, 4.2]);
  });
  test('keyset pagination returns every doctor exactly once', async () => {
    await seed();
    const seen = [];
    let cursor;
    for (let i = 0; i < 5; i++) {
      const r = await t.api.get(`/api/v1/doctors?limit=2&sort=fee_asc${cursor ? `&cursor=${cursor}` : ''}`);
      seen.push(...r.body.items.map((x) => x.id));
      cursor = r.body.nextCursor;
      if (!cursor) break;
    }
    expect(new Set(seen).size).toBe(3);
    expect(seen).toHaveLength(3);
  });
  test('availability filter and slot listing reflect bookings (cache invalidated on booking)', async () => {
    const { a, b } = await seed();
    const slot = await createSlot(t.api, a, 120);
    const from = new Date().toISOString(); const to = new Date(Date.now() + 86400000).toISOString();
    const q = `/api/v1/doctors?availableFrom=${from}&availableTo=${to}`;
    expect((await t.api.get(q)).body.items.map((x) => x.id)).toEqual([a.id]);
    expect((await t.api.get(`/api/v1/doctors/${a.id}/slots`)).body.items).toHaveLength(1);
    const p = await registerPatient(t.api);
    await book(t.api, p, slot.id);
    expect((await t.api.get(q)).body.items).toHaveLength(0);
    expect((await t.api.get(`/api/v1/doctors/${a.id}/slots`)).body.items).toHaveLength(0);
    expect(b.id).toBeTruthy();
  });
  test('invalid params rejected (injection-shaped input is only ever a bound parameter)', async () => {
    await seed();
    expect((await t.api.get('/api/v1/doctors?limit=9999')).status).toBe(400);
    expect((await t.api.get('/api/v1/doctors?sort=name;DROP TABLE users')).status).toBe(400);
    expect((await t.api.get('/api/v1/doctors?cursor=%%%')).status).toBe(400);
    const r = await t.api.get("/api/v1/doctors?q=' OR 1=1 --");
    expect(r.status).toBe(200);
    expect(r.body.items).toHaveLength(0);
  });
});

describe('admin: verification, analytics, audit trail', () => {
  test('admin verifies a doctor, who then becomes searchable', async () => {
    const admin = await createAdmin(t.api, t.c);
    const d = await createDoctor(t.api, t.c, { verified: false });
    expect((await t.api.get('/api/v1/doctors')).body.items).toHaveLength(0);
    const r = await t.api.post(`/api/v1/admin/doctors/${d.id}/verification`).set(idem(admin.token)).send({ verified: true });
    expect(r.status).toBe(200);
    expect((await t.api.get('/api/v1/doctors')).body.items).toHaveLength(1);
  });
  test('only admins can access admin APIs', async () => {
    const d = await createDoctor(t.api, t.c);
    const p = await registerPatient(t.api);
    for (const tok of [d.token, p.token]) {
      expect((await t.api.get('/api/v1/admin/analytics/overview').set(auth(tok))).status).toBe(403);
      expect((await t.api.get('/api/v1/admin/audit-logs').set(auth(tok))).status).toBe(403);
    }
  });
  test('analytics overview aggregates consultations and net revenue', async () => {
    const admin = await createAdmin(t.api, t.c);
    const d = await createDoctor(t.api, t.c, { fee: 50000 });
    const p1 = await registerPatient(t.api); const p2 = await registerPatient(t.api);
    const s1 = await createSlot(t.api, d, 300); const s2 = await createSlot(t.api, d, 400);
    const c1 = (await book(t.api, p1, s1.id)).body.consultation.id;
    const c2 = (await book(t.api, p2, s2.id)).body.consultation.id;
    await webhook(t.api, t.c, await providerRefFor(t.c, c1));
    await webhook(t.api, t.c, await providerRefFor(t.c, c2));
    await t.api.post(`/api/v1/consultations/${c2}/cancel`).set(idem(p2.token)).send({});
    await t.c.jobs.idle();
    const r = await t.api.get('/api/v1/admin/analytics/overview').set(auth(admin.token));
    expect(r.status).toBe(200);
    expect(r.body.consultationsByStatus).toMatchObject({ CONFIRMED: 1, CANCELLED: 1 });
    expect(r.body.revenue).toMatchObject({ grossPaise: 100000, refundedPaise: 50000, netPaise: 50000 });
    expect(r.body.daily.length).toBeGreaterThan(0);
  });
  test('audit trail records security-relevant actions and its hash chain verifies', async () => {
    const admin = await createAdmin(t.api, t.c);
    const d = await createDoctor(t.api, t.c, { fee: 0 });
    const p = await registerPatient(t.api);
    await book(t.api, p, (await createSlot(t.api, d)).id);
    const logs = await t.api.get('/api/v1/admin/audit-logs?limit=100').set(auth(admin.token));
    const actions = logs.body.items.map((i) => i.action);
    expect(actions).toEqual(expect.arrayContaining(['USER_REGISTERED', 'MFA_ENABLED', 'CONSULTATION_BOOKED', 'SLOTS_CREATED', 'LOGIN_SUCCESS']));
    expect(JSON.stringify(logs.body)).not.toMatch(/password|diagnosis/i);
    const v = await t.api.get('/api/v1/admin/audit-logs/verify').set(auth(admin.token));
    expect(v.body.ok).toBe(true);
    expect(v.body.checked).toBeGreaterThan(5);
  });
  test('audit log is immutable (trigger) and tampering is detected by the chain verifier', async () => {
    const admin = await createAdmin(t.api, t.c);
    await registerPatient(t.api);
    await expect(t.c.db.query("UPDATE audit_logs SET action = 'HACKED'")).rejects.toThrow(/append-only/);
    await expect(t.c.db.query('DELETE FROM audit_logs')).rejects.toThrow(/append-only/);
    // a DBA bypassing triggers (replica role) still cannot hide it
    const client = await t.c.db.pool.connect();
    try {
      await client.query('SET session_replication_role = replica');
      await client.query("UPDATE audit_logs SET metadata = '{\"tampered\":true}' WHERE id = (SELECT min(id) FROM audit_logs)");
      await client.query('SET session_replication_role = DEFAULT');
    } finally { client.release(); }
    const v = await t.api.get('/api/v1/admin/audit-logs/verify').set(auth(admin.token));
    expect(v.body.ok).toBe(false);
    expect(v.body.reason).toBe('hash mismatch');
  });
  test('concurrent audit writes keep a single linear chain', async () => {
    await Promise.all(Array.from({ length: 15 }, (_, i) => t.c.audit.log({ actor: { role: 'system' }, action: `BULK_${i}` })));
    const v = await t.c.audit.verify({});
    expect(v).toMatchObject({ ok: true, checked: 15 });
  });
});

describe('platform', () => {
  test('health, readiness, metrics and security headers', async () => {
    expect((await t.api.get('/healthz')).body.status).toBe('ok');
    expect((await t.api.get('/readyz')).status).toBe(200);
    await t.api.get('/api/v1/doctors');
    const m = await t.api.get('/metrics');
    expect(m.text).toContain('http_request_duration_seconds_bucket');
    expect(m.text).toContain('db_query_duration_seconds');
    const r = await t.api.get('/api/v1/doctors');
    expect(r.headers['x-content-type-options']).toBe('nosniff');
    expect(r.headers['strict-transport-security']).toBeDefined();
    expect(r.headers['x-powered-by']).toBeUndefined();
    expect(r.headers['x-request-id']).toBeDefined();
    expect((await t.api.get('/api/v1/nope')).status).toBe(404);
  });
  test('OpenAPI document is a valid OpenAPI 3 spec', async () => {
    const api = await SwaggerParser.validate(path.join(__dirname, '..', '..', 'openapi.yaml'));
    expect(api.openapi).toMatch(/^3\./);
    expect(Object.keys(api.paths).length).toBeGreaterThan(20);
  });
});
