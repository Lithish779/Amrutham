'use strict';
const express = require('express');
const { z } = require('zod');
const { validate, asyncH } = require('../../middleware/common');

const password = z.string().min(10).max(128)
  .refine((p) => /[a-z]/.test(p) && /[A-Z]/.test(p) && /\d/.test(p), 'Password needs upper, lower case and a digit');

const registerSchema = z.object({
  email: z.string().email().max(254),
  password,
  fullName: z.string().trim().min(2).max(120),
  role: z.enum(['patient', 'doctor']).default('patient'), // admin accounts are never self-service
  doctor: z.object({
    specialization: z.string().trim().min(2).max(60),
    qualifications: z.string().max(300).optional(),
    experienceYears: z.number().int().min(0).max(70).optional(),
    consultationFeePaise: z.number().int().min(0).max(10_000_00).optional(),
    languages: z.array(z.string().min(2).max(20)).max(10).optional(),
    bio: z.string().max(2000).optional(),
  }).strict().optional(),
}).strict().refine((b) => b.role !== 'doctor' || b.doctor, { message: 'doctor details required', path: ['doctor'] });

function authRoutes({ authService, authMw, limiter, config }) {
  const r = express.Router();
  const meta = (req) => ({ ip: req.ip, userAgent: req.get('user-agent') });
  const authLimit = limiter({ scope: 'auth', max: config.rateLimit.auth });

  r.post('/register', authLimit, validate({ body: registerSchema }), asyncH(async (req, res) => {
    res.status(201).json(await authService.register(req.body, meta(req)));
  }));

  r.post('/login', authLimit, validate({ body: z.object({ email: z.string().email(), password: z.string().min(1).max(128) }).strict() }),
    asyncH(async (req, res) => res.json(await authService.login(req.body, meta(req)))));

  r.post('/mfa/login', authLimit, authMw.authenticate(['mfa_challenge']),
    validate({ body: z.object({ code: z.string().min(6).max(16) }).strict() }),
    asyncH(async (req, res) => res.json(await authService.loginMfa(req.user.id, req.body, meta(req)))));

  r.post('/mfa/setup', authMw.authenticate(['mfa_setup', 'full']), asyncH(async (req, res) => res.json(await authService.mfaSetup(req.user.id))));

  r.post('/mfa/enable', authLimit, authMw.authenticate(['mfa_setup', 'full']),
    validate({ body: z.object({ code: z.string().regex(/^\d{6}$/) }).strict() }),
    asyncH(async (req, res) => res.json(await authService.mfaEnable(req.user.id, req.body, meta(req)))));

  r.post('/refresh', authLimit, validate({ body: z.object({ refreshToken: z.string().min(20).max(200) }).strict() }),
    asyncH(async (req, res) => res.json(await authService.refresh(req.body.refreshToken, meta(req)))));

  r.post('/logout', validate({ body: z.object({ refreshToken: z.string().min(20).max(200) }).strict() }),
    asyncH(async (req, res) => { await authService.logout(req.body.refreshToken); res.status(204).end(); }));

  return r;
}

function userRoutes({ authService, authMw }) {
  const r = express.Router();
  r.get('/me', authMw.authenticate(), asyncH(async (req, res) => res.json(await authService.me(req.user.id))));
  r.patch('/me', authMw.authenticate(), validate({
    body: z.object({
      fullName: z.string().trim().min(2).max(120).optional(),
      phone: z.string().regex(/^\+?[0-9]{8,15}$/).optional(),
      dob: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      gender: z.enum(['female', 'male', 'other', 'undisclosed']).optional(),
      language: z.string().min(2).max(10).optional(),
    }).strict(),
  }), asyncH(async (req, res) => res.json(await authService.updateProfile(req.user.id, req.body))));
  return r;
}
module.exports = { authRoutes, userRoutes };
