'use strict';
const bcrypt = require('bcryptjs');
const { authenticator } = require('otplib');
const crypto = require('crypto');
const { E } = require('../../lib/errors');
const { sha256, randomToken } = require('../../lib/crypto');

const MAX_FAILS = 5;
const LOCK_MINUTES = 15;
const MFA_REQUIRED_ROLES = ['doctor', 'admin'];
authenticator.options = { window: 1 };

function createAuthService({ db, config, cache, crypto: fieldCrypto, audit, authMw, metrics }) {
  // constant-time-ish defence against user enumeration via response timing
  const dummyHash = bcrypt.hashSync('not-a-real-password', config.bcryptRounds);

  const publicUser = (u) => ({ id: u.id, email: u.email, role: u.role, mfaEnabled: u.mfa_enabled });

  async function issueTokens(user, meta, familyId = crypto.randomUUID()) {
    const refresh = randomToken(48);
    await db.query(
      `INSERT INTO refresh_tokens (user_id, family_id, token_hash, expires_at, ip, user_agent)
       VALUES ($1,$2,$3, now() + make_interval(secs => $4), $5, $6)`,
      [user.id, familyId, sha256(refresh), config.jwt.refreshTtl, meta.ip, (meta.userAgent || '').slice(0, 200)]);
    return {
      accessToken: authMw.signAccess(user), refreshToken: refresh, tokenType: 'Bearer',
      expiresIn: config.jwt.accessTtl, user: publicUser(user),
    };
  }

  async function register({ email, password, fullName, role, doctor }, meta) {
    const hash = await bcrypt.hash(password, config.bcryptRounds);
    const user = await db.tx(async (t) => {
      const { rows: [u] } = await t.query(
        'INSERT INTO users (email, password_hash, role) VALUES ($1,$2,$3) RETURNING *', [email.toLowerCase(), hash, role]);
      await t.query('INSERT INTO profiles (user_id, full_name) VALUES ($1,$2)', [u.id, fullName]);
      if (role === 'doctor') {
        await t.query(
          `INSERT INTO doctors (user_id, display_name, specialization, qualifications, experience_years, consultation_fee_paise, languages, bio)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
          [u.id, fullName, doctor.specialization, doctor.qualifications || null, doctor.experienceYears || 0,
            doctor.consultationFeePaise || 0, doctor.languages || ['en'], doctor.bio || null]);
      }
      return u;
    });
    await audit.log({ actor: { id: user.id, role: user.role }, action: 'USER_REGISTERED', resourceType: 'user', resourceId: user.id, ip: meta.ip });
    return publicUser(user);
  }

  async function login({ email, password }, meta) {
    const { rows: [user] } = await db.query('SELECT * FROM users WHERE lower(email) = lower($1)', [email]);
    const ok = await bcrypt.compare(password, user ? user.password_hash : dummyHash);
    if (!user || user.status !== 'ACTIVE') {
      metrics.authEvents.inc({ event: 'login_failed' });
      throw E.unauthorized('Invalid credentials');
    }
    if (user.locked_until && new Date(user.locked_until) > new Date()) {
      metrics.authEvents.inc({ event: 'login_locked' });
      throw E.unauthorized('Account temporarily locked. Try again later.');
    }
    if (!ok) {
      const { rows: [u] } = await db.query(
        `UPDATE users SET failed_login_count = failed_login_count + 1,
           locked_until = CASE WHEN failed_login_count + 1 >= $2 THEN now() + make_interval(mins => $3) ELSE locked_until END
         WHERE id = $1 RETURNING failed_login_count`, [user.id, MAX_FAILS, LOCK_MINUTES]);
      metrics.authEvents.inc({ event: 'login_failed' });
      await audit.log({ actor: { id: user.id, role: user.role }, action: 'LOGIN_FAILED', resourceType: 'user', resourceId: user.id, ip: meta.ip, metadata: { failures: u.failed_login_count } });
      throw E.unauthorized('Invalid credentials');
    }
    await db.query('UPDATE users SET failed_login_count = 0, locked_until = NULL WHERE id = $1', [user.id]);

    if (user.mfa_enabled) {
      return { mfaRequired: true, challengeToken: authMw.signAccess(user, 'mfa_challenge') };
    }
    if (MFA_REQUIRED_ROLES.includes(user.role)) {
      // privileged roles cannot get a usable session until MFA is enrolled
      return { mfaEnrollmentRequired: true, setupToken: authMw.signAccess(user, 'mfa_setup') };
    }
    await audit.log({ actor: { id: user.id, role: user.role }, action: 'LOGIN_SUCCESS', resourceType: 'user', resourceId: user.id, ip: meta.ip });
    metrics.authEvents.inc({ event: 'login_ok' });
    return issueTokens(user, meta);
  }

  /** Verifies a TOTP (with replay protection) or a one-time recovery code. */
  async function checkMfa(user, code) {
    const secret = fieldCrypto.decrypt(user.mfa_secret_enc, `user:${user.id}:mfa`);
    if (/^\d{6}$/.test(code)) {
      const delta = authenticator.checkDelta(code, secret);
      if (delta === null || delta === undefined) return false;
      const step = Math.floor(Date.now() / 30000) + delta;
      // single-use: only accept if the matched time-step is newer than the last accepted one (atomic)
      const r = await db.query('UPDATE users SET mfa_last_step = $2 WHERE id = $1 AND mfa_last_step < $2', [user.id, step]);
      return r.rowCount === 1;
    }
    const h = sha256(code);
    const r = await db.query(
      'UPDATE users SET mfa_recovery_hashes = array_remove(mfa_recovery_hashes, $2) WHERE id = $1 AND $2 = ANY(mfa_recovery_hashes)', [user.id, h]);
    return r.rowCount === 1;
  }

  async function loginMfa(userId, { code }, meta) {
    const { rows: [user] } = await db.query('SELECT * FROM users WHERE id = $1 AND status = \'ACTIVE\'', [userId]);
    if (!user || !user.mfa_enabled) throw E.unauthorized();
    const { count } = await cache.incr(`mfa-attempts:${userId}`, 60);
    if (count > 5) throw E.tooMany(60);
    if (!(await checkMfa(user, code))) {
      metrics.authEvents.inc({ event: 'mfa_failed' });
      await audit.log({ actor: { id: user.id, role: user.role }, action: 'MFA_FAILED', resourceType: 'user', resourceId: user.id, ip: meta.ip });
      throw E.unauthorized('Invalid MFA code');
    }
    await audit.log({ actor: { id: user.id, role: user.role }, action: 'LOGIN_SUCCESS', resourceType: 'user', resourceId: user.id, ip: meta.ip, metadata: { mfa: true } });
    metrics.authEvents.inc({ event: 'login_ok' });
    return issueTokens(user, meta);
  }
  async function mfaSetup(userId) {
    const { rows: [user] } = await db.query('SELECT * FROM users WHERE id = $1', [userId]);
    if (!user) throw E.unauthorized();
    if (user.mfa_enabled) throw E.conflict('MFA_ALREADY_ENABLED', 'MFA already enabled');
    const secret = authenticator.generateSecret(20);
    await db.query('UPDATE users SET mfa_secret_enc = $2 WHERE id = $1', [userId, fieldCrypto.encrypt(secret, `user:${userId}:mfa`)]);
    return { secret, otpauthUrl: authenticator.keyuri(user.email, 'Amrutam', secret) };
  }

  async function mfaEnable(userId, { code }, meta) {
    const { rows: [user] } = await db.query('SELECT * FROM users WHERE id = $1', [userId]);
    if (!user || !user.mfa_secret_enc) throw E.badRequest('Call /auth/mfa/setup first');
    if (user.mfa_enabled) throw E.conflict('MFA_ALREADY_ENABLED', 'MFA already enabled');
    const secret = fieldCrypto.decrypt(user.mfa_secret_enc, `user:${userId}:mfa`);
    const delta = authenticator.checkDelta(code, secret);
    if (delta === null || delta === undefined) throw E.unauthorized('Invalid MFA code');
    const recovery = Array.from({ length: 8 }, () => randomToken(6));
    await db.query('UPDATE users SET mfa_enabled = true, mfa_last_step = $2, mfa_recovery_hashes = $3 WHERE id = $1',
      [userId, Math.floor(Date.now() / 30000) + delta, recovery.map(sha256)]);
    await audit.log({ actor: { id: user.id, role: user.role }, action: 'MFA_ENABLED', resourceType: 'user', resourceId: user.id, ip: meta.ip });
    const tokens = await issueTokens({ ...user, mfa_enabled: true }, meta);
    return { ...tokens, recoveryCodes: recovery };
  }

  async function refresh(token, meta) {
    const { rows: [t] } = await db.query('SELECT * FROM refresh_tokens WHERE token_hash = $1', [sha256(token)]);
    if (!t) throw E.unauthorized('Invalid refresh token');
    if (t.revoked_at) {
      // reuse of a rotated token => assume theft, kill the whole family
      await db.query('UPDATE refresh_tokens SET revoked_at = now() WHERE family_id = $1 AND revoked_at IS NULL', [t.family_id]);
      await audit.log({ actor: { id: t.user_id }, action: 'REFRESH_TOKEN_REUSE_DETECTED', resourceType: 'user', resourceId: t.user_id, ip: meta.ip, metadata: { familyId: t.family_id } });
      metrics.authEvents.inc({ event: 'refresh_reuse' });
      throw E.unauthorized('Refresh token reuse detected; please sign in again');
    }
    if (new Date(t.expires_at) < new Date()) throw E.unauthorized('Refresh token expired');
    // atomic rotate: only one concurrent caller can revoke this token
    const r = await db.query('UPDATE refresh_tokens SET revoked_at = now() WHERE id = $1 AND revoked_at IS NULL', [t.id]);
    if (r.rowCount === 0) throw E.unauthorized('Refresh token already used');
    const { rows: [user] } = await db.query("SELECT * FROM users WHERE id = $1 AND status = 'ACTIVE'", [t.user_id]);
    if (!user) throw E.unauthorized();
    return issueTokens(user, meta, t.family_id);
  }

  async function logout(token) {
    const { rows: [t] } = await db.query('SELECT family_id FROM refresh_tokens WHERE token_hash = $1', [sha256(token)]);
    if (t) await db.query('UPDATE refresh_tokens SET revoked_at = now() WHERE family_id = $1 AND revoked_at IS NULL', [t.family_id]);
  }

  async function me(userId) {
    const { rows: [r] } = await db.query(
      `SELECT u.id, u.email, u.role, u.mfa_enabled, p.full_name, p.phone_enc, p.dob_enc, p.gender, p.language
       FROM users u JOIN profiles p ON p.user_id = u.id WHERE u.id = $1`, [userId]);
    if (!r) throw E.notFound();
    return {
      id: r.id, email: r.email, role: r.role, mfaEnabled: r.mfa_enabled, fullName: r.full_name, gender: r.gender, language: r.language,
      phone: fieldCrypto.decrypt(r.phone_enc, `profile:${userId}:phone`), dob: fieldCrypto.decrypt(r.dob_enc, `profile:${userId}:dob`),
    };
  }

  async function updateProfile(userId, p) {
    await db.query(
      `UPDATE profiles SET full_name = COALESCE($2, full_name), phone_enc = COALESCE($3, phone_enc), dob_enc = COALESCE($4, dob_enc),
         gender = COALESCE($5, gender), language = COALESCE($6, language), updated_at = now() WHERE user_id = $1`,
      [userId, p.fullName ?? null, p.phone ? fieldCrypto.encrypt(p.phone, `profile:${userId}:phone`) : null,
        p.dob ? fieldCrypto.encrypt(p.dob, `profile:${userId}:dob`) : null, p.gender ?? null, p.language ?? null]);
    return me(userId);
  }

  return { register, login, loginMfa, mfaSetup, mfaEnable, refresh, logout, me, updateProfile };
}
module.exports = { createAuthService };
