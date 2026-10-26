'use strict';
const express = require('express');
const { z } = require('zod');
const { validate, asyncH } = require('../../middleware/common');

const uuid = z.string().uuid();
function adminRoutes({ adminService: svc, authMw, idem }) {
  const r = express.Router();
  r.use(authMw.authenticate(), authMw.requireRole('admin'));

  r.get('/analytics/overview', validate({
    query: z.object({
      from: z.coerce.date().default(() => new Date(Date.now() - 30 * 86400_000)), to: z.coerce.date().default(() => new Date()),
    }).strict().refine((q) => q.to > q.from && q.to - q.from <= 366 * 86400_000, { message: 'range must be within 1 year' }),
  }), asyncH(async (req, res) => res.json(await svc.overview(req.query))));

  r.get('/users', validate({ query: z.object({ role: z.enum(['patient', 'doctor', 'admin']).optional(), limit: z.coerce.number().int().min(1).max(100).default(25), cursor: z.string().max(300).optional() }).strict() }),
    asyncH(async (req, res) => res.json(await svc.listUsers(req.query))));
  r.patch('/users/:id/status', idem(), validate({ params: z.object({ id: uuid }), body: z.object({ status: z.enum(['ACTIVE', 'DISABLED']) }).strict() }),
    asyncH(async (req, res) => res.json(await svc.setUserStatus(req.user.id, req.params.id, req.body.status))));
  r.post('/doctors/:id/verification', idem(), validate({ params: z.object({ id: uuid }), body: z.object({ verified: z.boolean() }).strict() }),
    asyncH(async (req, res) => res.json(await svc.verifyDoctor(req.user.id, req.params.id, req.body.verified))));

  r.get('/audit-logs', validate({
    query: z.object({
      actorId: uuid.optional(), action: z.string().max(80).optional(), resourceType: z.string().max(40).optional(), resourceId: z.string().max(80).optional(),
      from: z.coerce.date().optional(), to: z.coerce.date().optional(), limit: z.coerce.number().int().min(1).max(200).default(50), cursor: z.string().max(100).optional(),
    }).strict(),
  }), asyncH(async (req, res) => res.json(await svc.listAudit(req.query, req))));
  r.get('/audit-logs/verify', validate({ query: z.object({ afterId: z.coerce.number().int().min(0).default(0), limit: z.coerce.number().int().min(1).max(20000).default(5000) }).strict() }),
    asyncH(async (req, res) => res.json(await svc.verifyAudit(req.query))));
  return r;
}
module.exports = { adminRoutes };
