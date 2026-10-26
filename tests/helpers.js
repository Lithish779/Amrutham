'use strict';
const request = require('supertest');
const crypto = require('crypto');
const { authenticator } = require('otplib');
const { createContainer } = require('../src/container');
const { createApp } = require('../src/app');

const PASSWORD = 'Str0ngPassw0rd!';
let seq = 0;
const uniq = (p = 'k') => `${p}-${Date.now()}-${++seq}-${crypto.randomBytes(4).toString('hex')}`;

async function boot(overrides) {
  const c = createContainer(overrides);
  const app = createApp(c);
  if (c.config.redisUrl) await c.jobs.start(); // exercise the real BullMQ worker when Redis is available
  return { c, app, api: request(app) };
}

async function reset(c) {
  const r = c.cache.raw();
  if (r) { // isolate shared Redis between tests (wait for the connection first)
    for (let i = 0; i < 50 && r.status !== 'ready'; i++) await new Promise((x) => setTimeout(x, 100));
    await r.flushdb();
  }
  await c.db.query(`TRUNCATE users, refresh_tokens, profiles, doctors, availability_slots, consultations, prescriptions,
    payments, payment_events, idempotency_keys, audit_logs RESTART IDENTITY CASCADE`);
  await c.db.query("UPDATE audit_chain_head SET last_id = 0, last_hash = repeat('0', 64)");
  await c.db.query('ALTER SEQUENCE audit_logs_id_seq RESTART WITH 1');
}

const auth = (t) => ({ Authorization: `Bearer ${t}` });
const idem = (t, k = uniq('idem')) => ({ ...auth(t), 'Idempotency-Key': k });

async function registerPatient(api, email = `${uniq('p')}@test.dev`) {
  const r = await api.post('/api/v1/auth/register').send({ email, password: PASSWORD, fullName: 'Test Patient' });
  if (r.status !== 201) throw new Error(`register failed ${r.status} ${JSON.stringify(r.body)}`);
  const l = await api.post('/api/v1/auth/login').send({ email, password: PASSWORD });
  return { id: r.body.id, email, token: l.body.accessToken, refreshToken: l.body.refreshToken };
}

/** Real MFA enrolment flow (doctors/admins cannot get a session without it). */
async function enrollMfa(api, email, password = PASSWORD) {
  const l = await api.post('/api/v1/auth/login').send({ email, password });
  if (!l.body.setupToken) throw new Error(`expected enrolment: ${JSON.stringify(l.body)}`);
  const s = await api.post('/api/v1/auth/mfa/setup').set(auth(l.body.setupToken));
  const e = await api.post('/api/v1/auth/mfa/enable').set(auth(l.body.setupToken)).send({ code: authenticator.generate(s.body.secret) });
  if (e.status !== 200) throw new Error(`enable failed ${e.status} ${JSON.stringify(e.body)}`);
  return { secret: s.body.secret, token: e.body.accessToken, refreshToken: e.body.refreshToken, recoveryCodes: e.body.recoveryCodes, id: e.body.user.id };
}

async function createDoctor(api, c, { fee = 50000, specialization = 'ayurveda', name = 'Dr. Test', languages = ['en'], rating, verified = true } = {}) {
  const email = `${uniq('d')}@test.dev`;
  const r = await api.post('/api/v1/auth/register').send({
    email, password: PASSWORD, fullName: name, role: 'doctor',
    doctor: { specialization, consultationFeePaise: fee, languages, experienceYears: 5 },
  });
  if (r.status !== 201) throw new Error(`doctor register failed ${JSON.stringify(r.body)}`);
  if (verified) await c.db.query('UPDATE doctors SET is_verified = true WHERE user_id = $1', [r.body.id]);
  if (rating !== undefined) await c.db.query('UPDATE doctors SET rating_avg = $2 WHERE user_id = $1', [r.body.id, rating]);
  const m = await enrollMfa(api, email);
  return { ...m, email, id: r.body.id };
}

async function createAdmin(api, c) {
  const email = `${uniq('a')}@test.dev`;
  const bcrypt = require('bcryptjs');
  const { rows: [u] } = await c.db.query("INSERT INTO users (email, password_hash, role) VALUES ($1,$2,'admin') RETURNING id", [email, bcrypt.hashSync(PASSWORD, 4)]);
  await c.db.query("INSERT INTO profiles (user_id, full_name) VALUES ($1,'Admin')", [u.id]);
  return { ...(await enrollMfa(api, email)), email };
}

const inMinutes = (m, len = 30) => ({ startTime: new Date(Date.now() + m * 60000).toISOString(), endTime: new Date(Date.now() + (m + len) * 60000).toISOString() });

async function createSlot(api, doctor, minutesFromNow = 120, len = 30) {
  const r = await api.post('/api/v1/doctors/me/slots').set(idem(doctor.token)).send({ slots: [inMinutes(minutesFromNow, len)] });
  if (r.status !== 201) throw new Error(`slot failed ${r.status} ${JSON.stringify(r.body)}`);
  return r.body.items[0];
}

function webhook(api, c, providerRef, type = 'payment.succeeded', id = `evt_${uniq()}`) {
  const body = JSON.stringify({ id, type, providerRef });
  const ts = Math.floor(Date.now() / 1000);
  const sig = crypto.createHmac('sha256', c.config.paymentWebhookSecret).update(`${ts}.${body}`).digest('hex');
  return api.post('/api/v1/webhooks/payments').set('content-type', 'application/json')
    .set('x-webhook-timestamp', String(ts)).set('x-webhook-signature', sig).send(body);
}

async function providerRefFor(c, consultationId) {
  return (await c.db.query('SELECT provider_ref FROM payments WHERE consultation_id = $1', [consultationId])).rows[0].provider_ref;
}

async function book(api, patient, slotId, reason, key) {
  return api.post('/api/v1/consultations').set(idem(patient.token, key)).send({ slotId, ...(reason ? { reason } : {}) });
}

/** TOTP for the NEXT time-step (the current one is consumed at enrolment: replay protection). */
function nextTotp(secret, stepsAhead = 1) {
  authenticator.options = { epoch: Date.now() + 30000 * stepsAhead };
  const code = authenticator.generate(secret);
  authenticator.resetOptions();
  authenticator.options = { window: 1 }; // same setting the service uses
  return code;
}

module.exports = { boot, reset, auth, idem, uniq, PASSWORD, registerPatient, enrollMfa, createDoctor, createAdmin, createSlot, inMinutes, webhook, providerRefFor, book, nextTotp };
