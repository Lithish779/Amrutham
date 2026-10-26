const { boot, reset, auth, PASSWORD, registerPatient, createDoctor, createAdmin, enrollMfa, nextTotp, uniq } = require('../helpers');

let t;
beforeAll(async () => { t = await boot(); });
afterAll(async () => { await t.c.close(); });
beforeEach(async () => { await reset(t.c); });

describe('registration & validation', () => {
  test('registers patient; stores only a bcrypt hash', async () => {
    const p = await registerPatient(t.api, 'a@test.dev');
    const { rows: [u] } = await t.c.db.query('SELECT password_hash FROM users WHERE id=$1', [p.id]);
    expect(u.password_hash).toMatch(/^\$2[aby]\$/);
    expect(u.password_hash).not.toContain(PASSWORD);
  });
  test('rejects weak passwords, bad email, unknown fields (mass-assignment) and self-service admin', async () => {
    const base = { email: 'x@test.dev', password: PASSWORD, fullName: 'X Y' };
    expect((await t.api.post('/api/v1/auth/register').send({ ...base, password: 'short' })).status).toBe(400);
    expect((await t.api.post('/api/v1/auth/register').send({ ...base, password: 'alllowercase123' })).status).toBe(400);
    expect((await t.api.post('/api/v1/auth/register').send({ ...base, email: 'nope' })).status).toBe(400);
    expect((await t.api.post('/api/v1/auth/register').send({ ...base, isAdmin: true })).status).toBe(400);
    expect((await t.api.post('/api/v1/auth/register').send({ ...base, role: 'admin' })).status).toBe(400);
  });
  test('duplicate email (case-insensitive) -> 409', async () => {
    await registerPatient(t.api, 'dup@test.dev');
    const r = await t.api.post('/api/v1/auth/register').send({ email: 'DUP@test.dev', password: PASSWORD, fullName: 'Dup' });
    expect(r.status).toBe(409);
    expect(r.body.error.code).toBe('EMAIL_TAKEN');
  });
  test('malformed JSON -> 400 not 500; error carries request id', async () => {
    const r = await t.api.post('/api/v1/auth/login').set('content-type', 'application/json').send('{bad');
    expect(r.status).toBe(400);
    expect(r.body.error.requestId).toBeTruthy();
  });
});

describe('login, lockout, refresh rotation', () => {
  test('wrong password and unknown user give the same response', async () => {
    await registerPatient(t.api, 'v@test.dev');
    const a = await t.api.post('/api/v1/auth/login').send({ email: 'v@test.dev', password: 'WrongPassw0rd!' });
    const b = await t.api.post('/api/v1/auth/login').send({ email: 'ghost@test.dev', password: 'WrongPassw0rd!' });
    expect(a.status).toBe(401);
    expect(b.status).toBe(401);
    expect(a.body.error.message).toBe(b.body.error.message);
  });
  test('account locks after 5 failures even with the right password', async () => {
    await registerPatient(t.api, 'lock@test.dev');
    for (let i = 0; i < 5; i++) await t.api.post('/api/v1/auth/login').send({ email: 'lock@test.dev', password: 'WrongPassw0rd!' });
    const r = await t.api.post('/api/v1/auth/login').send({ email: 'lock@test.dev', password: PASSWORD });
    expect(r.status).toBe(401);
    expect(r.body.error.message).toMatch(/locked/i);
  });
  test('refresh rotates; re-using the old refresh token revokes the whole family', async () => {
    const p = await registerPatient(t.api);
    const r1 = await t.api.post('/api/v1/auth/refresh').send({ refreshToken: p.refreshToken });
    expect(r1.status).toBe(200);
    expect(r1.body.refreshToken).not.toBe(p.refreshToken);
    const replay = await t.api.post('/api/v1/auth/refresh').send({ refreshToken: p.refreshToken });
    expect(replay.status).toBe(401);
    const afterTheft = await t.api.post('/api/v1/auth/refresh').send({ refreshToken: r1.body.refreshToken });
    expect(afterTheft.status).toBe(401); // legit holder is also logged out
    const { rows } = await t.c.db.query("SELECT 1 FROM audit_logs WHERE action = 'REFRESH_TOKEN_REUSE_DETECTED'");
    expect(rows.length).toBeGreaterThanOrEqual(1);
  });
  test('concurrent refresh with the same token: exactly one winner', async () => {
    const p = await registerPatient(t.api);
    const rs = await Promise.all(Array.from({ length: 5 }, () => t.api.post('/api/v1/auth/refresh').send({ refreshToken: p.refreshToken })));
    expect(rs.filter((r) => r.status === 200).length).toBe(1);
  });
  test('logout revokes refresh token', async () => {
    const p = await registerPatient(t.api);
    expect((await t.api.post('/api/v1/auth/logout').send({ refreshToken: p.refreshToken })).status).toBe(204);
    expect((await t.api.post('/api/v1/auth/refresh').send({ refreshToken: p.refreshToken })).status).toBe(401);
  });
});

describe('MFA', () => {
  test('doctors cannot get a session without MFA enrolment; challenge flow + replay protection + recovery codes', async () => {
    const d = await createDoctor(t.api, t.c); // runs the real enrolment flow
    expect(d.recoveryCodes).toHaveLength(8);
    const l = await t.api.post('/api/v1/auth/login').send({ email: d.email, password: PASSWORD });
    expect(l.body.mfaRequired).toBe(true);
    expect(l.body.accessToken).toBeUndefined();
    // a challenge token must not work as an API token
    expect((await t.api.get('/api/v1/users/me').set(auth(l.body.challengeToken))).status).toBe(401);
    const code = nextTotp(d.secret);
    const ok = await t.api.post('/api/v1/auth/mfa/login').set(auth(l.body.challengeToken)).send({ code });
    expect(ok.status).toBe(200);
    expect((await t.api.get('/api/v1/users/me').set(auth(ok.body.accessToken))).status).toBe(200);
    // same code again (replay) is rejected
    const l2 = await t.api.post('/api/v1/auth/login').send({ email: d.email, password: PASSWORD });
    expect((await t.api.post('/api/v1/auth/mfa/login').set(auth(l2.body.challengeToken)).send({ code })).status).toBe(401);
    // recovery code is single-use
    const rc = d.recoveryCodes[0];
    expect((await t.api.post('/api/v1/auth/mfa/login').set(auth(l2.body.challengeToken)).send({ code: rc })).status).toBe(200);
    expect((await t.api.post('/api/v1/auth/mfa/login').set(auth(l2.body.challengeToken)).send({ code: rc })).status).toBe(401);
  });
  test('TOTP secret is encrypted at rest', async () => {
    const d = await createDoctor(t.api, t.c);
    const { rows: [u] } = await t.c.db.query('SELECT mfa_secret_enc FROM users WHERE id=$1', [d.id]);
    expect(u.mfa_secret_enc).not.toContain(d.secret);
    expect(u.mfa_secret_enc.startsWith('v1.')).toBe(true);
  });
  test('admin login requires enrolment', async () => {
    const bcrypt = require('bcryptjs');
    const email = `${uniq('a')}@test.dev`;
    const { rows: [u] } = await t.c.db.query("INSERT INTO users (email, password_hash, role) VALUES ($1,$2,'admin') RETURNING id", [email, bcrypt.hashSync(PASSWORD, 4)]);
    await t.c.db.query("INSERT INTO profiles (user_id, full_name) VALUES ($1,'A')", [u.id]);
    const l = await t.api.post('/api/v1/auth/login').send({ email, password: PASSWORD });
    expect(l.body.mfaEnrollmentRequired).toBe(true);
    expect(l.body.accessToken).toBeUndefined();
    expect((await t.api.get('/api/v1/admin/users').set(auth(l.body.setupToken))).status).toBe(401);
    await enrollMfa(t.api, email);
  });
});

describe('RBAC & token handling', () => {
  test('401 without token, 401 with garbage / wrong-alg token, 403 for wrong role', async () => {
    const p = await registerPatient(t.api);
    expect((await t.api.get('/api/v1/users/me')).status).toBe(401);
    expect((await t.api.get('/api/v1/users/me').set(auth('garbage'))).status).toBe(401);
    const none = `${Buffer.from('{"alg":"none","typ":"JWT"}').toString('base64url')}.${Buffer.from(JSON.stringify({ sub: p.id, role: 'admin', scope: 'full' })).toString('base64url')}.`;
    expect((await t.api.get('/api/v1/admin/users').set(auth(none))).status).toBe(401);
    expect((await t.api.get('/api/v1/admin/users').set(auth(p.token))).status).toBe(403);
    expect((await t.api.post('/api/v1/doctors/me/slots').set(auth(p.token)).send({})).status).toBe(403);
  });
  test('disabling a user kills live sessions immediately', async () => {
    const admin = await createAdmin(t.api, t.c);
    const p = await registerPatient(t.api);
    expect((await t.api.get('/api/v1/users/me').set(auth(p.token))).status).toBe(200);
    const r = await t.api.patch(`/api/v1/admin/users/${p.id}/status`).set({ ...auth(admin.token), 'Idempotency-Key': uniq('k1234') }).send({ status: 'DISABLED' });
    expect(r.status).toBe(200);
    expect((await t.api.get('/api/v1/users/me').set(auth(p.token))).status).toBe(401);
    expect((await t.api.post('/api/v1/auth/login').send({ email: p.email, password: PASSWORD })).status).toBe(401);
    expect((await t.api.post('/api/v1/auth/refresh').send({ refreshToken: p.refreshToken })).status).toBe(401);
  });
  test('PHI profile fields encrypted at rest, decrypted for the owner', async () => {
    const p = await registerPatient(t.api);
    const r = await t.api.patch('/api/v1/users/me').set(auth(p.token)).send({ phone: '+919876543210', dob: '1995-04-12' });
    expect(r.body.phone).toBe('+919876543210');
    const { rows: [row] } = await t.c.db.query('SELECT phone_enc, dob_enc FROM profiles WHERE user_id=$1', [p.id]);
    expect(row.phone_enc).not.toContain('9876543210');
    expect(row.dob_enc).not.toContain('1995');
  });
});

describe('rate limiting', () => {
  test('auth endpoints are throttled with 429 + Retry-After', async () => {
    const { createContainer } = require('../../src/container');
    const { createApp } = require('../../src/app');
    const request = require('supertest');
    const { load } = require('../../src/config');
    const cfg = load(); cfg.rateLimit.auth = 3;
    const c2 = createContainer({ config: cfg });
    await reset(c2);
    const api2 = request(createApp(c2));
    const codes = [];
    for (let i = 0; i < 5; i++) codes.push((await api2.post('/api/v1/auth/login').send({ email: 'x@test.dev', password: 'whatever12345' })).status);
    expect(codes.slice(0, 3)).toEqual([401, 401, 401]);
    const r = await api2.post('/api/v1/auth/login').send({ email: 'x@test.dev', password: 'whatever12345' });
    expect(r.status).toBe(429);
    expect(r.headers['retry-after']).toBeDefined();
    await c2.close();
  });
});
