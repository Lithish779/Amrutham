'use strict';
const express = require('express');
const { z } = require('zod');
const { validate, asyncH } = require('../../middleware/common');

const uuid = z.string().uuid();
const isoDate = z.string().datetime({ offset: true });
const range = z.object({
  from: z.coerce.date().default(() => new Date()),
  to: z.coerce.date().default(() => new Date(Date.now() + 14 * 86400_000)),
}).strict().refine((r) => r.to > r.from && r.to - r.from <= 31 * 86400_000, { message: 'range must be 0-31 days' });

function doctorRoutes({ doctorService, authMw, idem, limiter, config }) {
  const r = express.Router();
  const writeLimit = limiter({ scope: 'write', max: config.rateLimit.write, keyFn: (req) => req.user.id });
  const isDoctor = [authMw.authenticate(), authMw.requireRole('doctor')];

  r.get('/:id', validate({ params: z.object({ id: uuid }) }), asyncH(async (req, res) => res.json(await doctorService.getProfile(req.params.id))));
  r.get('/:id/slots', validate({ params: z.object({ id: uuid }), query: range }),
    asyncH(async (req, res) => res.json({ items: await doctorService.listSlots(req.params.id, req.query) })));
  return { public: r, doctorMe: me(doctorService, isDoctor, writeLimit, idem) };
}

function me(doctorService, isDoctor, writeLimit, idem) {
  const r = express.Router();
  r.patch('/profile', ...isDoctor, writeLimit, validate({
    body: z.object({
      specialization: z.string().trim().min(2).max(60).optional(), qualifications: z.string().max(300).optional(),
      experienceYears: z.number().int().min(0).max(70).optional(), consultationFeePaise: z.number().int().min(0).max(10_000_00).optional(),
      languages: z.array(z.string().min(2).max(20)).max(10).optional(), bio: z.string().max(2000).optional(),
    }).strict(),
  }), asyncH(async (req, res) => res.json(await doctorService.updateProfile(req.user.id, req.body))));

  r.get('/slots', ...isDoctor, validate({ query: range }), asyncH(async (req, res) => res.json({ items: await doctorService.listOwnSlots(req.user.id, req.query) })));

  r.post('/slots', ...isDoctor, writeLimit, idem(), validate({
    body: z.object({ slots: z.array(z.object({ startTime: isoDate, endTime: isoDate }).strict()).min(1).max(50) }).strict(),
  }), asyncH(async (req, res) => res.status(201).json({ items: await doctorService.createSlots(req.user.id, req.body.slots) })));

  r.delete('/slots/:id', ...isDoctor, writeLimit, validate({ params: z.object({ id: uuid }) }),
    asyncH(async (req, res) => { await doctorService.cancelSlot(req.user.id, req.params.id); res.status(204).end(); }));
  return r;
}
module.exports = { doctorRoutes };
