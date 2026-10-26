'use strict';
const jwt = require('jsonwebtoken');
const context = require('../lib/context');
const { E } = require('../lib/errors');

function createAuthMiddleware({ config, cache }) {
  const sign = (payload, ttlSec) => jwt.sign(payload, config.jwt.secret, {
    algorithm: 'HS256', expiresIn: ttlSec, issuer: config.jwt.issuer, audience: config.jwt.audience,
  });

  /** scope: 'full' (normal API), 'mfa_challenge' (password ok, TOTP pending), 'mfa_setup' (must enrol MFA first) */
  const signAccess = (user, scope = 'full') => sign({ sub: user.id, role: user.role, scope },
    scope === 'full' ? config.jwt.accessTtl : 300);

  function authenticate(scopes = ['full']) {
    return async (req, res, next) => {
      try {
        const h = req.get('authorization') || '';
        const m = /^Bearer (.+)$/.exec(h);
        if (!m) throw E.unauthorized();
        let p;
        try {
          p = jwt.verify(m[1], config.jwt.secret, { algorithms: ['HS256'], issuer: config.jwt.issuer, audience: config.jwt.audience });
        } catch { throw E.unauthorized('Invalid or expired token'); }
        if (!scopes.includes(p.scope)) throw E.unauthorized('Token not valid for this operation');
        if (await cache.get(`revoked:${p.sub}`)) throw E.unauthorized('Session revoked');
        req.user = { id: p.sub, role: p.role, scope: p.scope };
        context.get().userId = p.sub;
        next();
      } catch (e) { next(e); }
    };
  }

  /** RBAC guard. Always combine with authenticate(). Deny by default. */
  const requireRole = (...roles) => (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) return next(E.forbidden('Insufficient role'));
    return next();
  };

  return { signAccess, authenticate, requireRole };
}
module.exports = { createAuthMiddleware };
