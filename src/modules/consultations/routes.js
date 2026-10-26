'use strict';
const express = require('express');
const { z } = require('zod');
const { validate, asyncH } = require('../../middleware/common');
const { E } = require('../../lib/errors');
const { hmacHex, safeEqual } = require('../../lib/crypto');

const uuid = z.string().uuid();
const id = z.object({ id: uuid });

function consultationRoutes({ consultationService: svc, prescriptionService: rx, authMw, idem, limiter, config }) {
  const r = express.Router();
  const auth = authMw.authenticate();
  const writeLimit = limiter({ scope: 'write', max: config.rateLimit.write, keyFn: (req) => req.user.id });

  r.post('/', auth, authMw.requireRole('patient'), writeLimit, idem(),
    validate({ body: z.object({ slotId: uuid, reason: z.string().trim().max(1000).optional() }).strict() }),
    asyncH(async (req, res) => res.status(201).json(await svc.book(req.user.id, req.body, req))));

  r.get('/', auth, validate({
    query: z.object({
      status: z.enum(['PENDING_PAYMENT', 'CONFIRMED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED', 'EXPIRED', 'NO_SHOW']).optional(),
      limit: z.coerce.number().int().min(1).max(100).default(20), cursor: z.string().max(300).optional(),
    }).strict(),
  }), asyncH(async (req, res) => res.json(await svc.list(req.user, req.query))));

  r.get('/:id', auth, validate({ params: id }), asyncH(async (req, res) => res.json(await svc.get(req.user, req.params.id, req))));

  r.post('/:id/cancel', auth, writeLimit, idem(), validate({ params: id, body: z.object({ reason: z.string().trim().max(300).optional() }).strict() }),
    asyncH(async (req, res) => res.json(await svc.cancel(req.user, req.params.id, req.body.reason, req))));

  r.post('/:id/start', auth, authMw.requireRole('doctor'), writeLimit, validate({ params: id }),
    asyncH(async (req, res) => res.json(await svc.start(req.user, req.params.id, req))));

  r.post('/:id/complete', auth, authMw.requireRole('doctor'), writeLimit, validate({ params: id, body: z.object({ notes: z.string().max(5000).optional() }).strict() }),
    asyncH(async (req, res) => res.json(await svc.complete(req.user, req.params.id, req.body.notes, req))));

  // prescriptions (nested)
  const rxBody = z.object({
    diagnosis: z.string().trim().min(2).max(1000),
    medications: z.array(z.object({
      name: z.string().trim().min(1).max(120), dosage: z.string().trim().min(1).max(60),
      frequency: z.string().trim().min(1).max(60), durationDays: z.number().int().min(1).max(365),
    }).strict()).min(1).max(30),
    instructions: z.string().max(2000).optional(),
  }).strict();
  r.post('/:id/prescription', auth, authMw.requireRole('doctor'), writeLimit, idem(), validate({ params: id, body: rxBody }),
    asyncH(async (req, res) => res.status(201).json(await rx.create(req.user.id, req.params.id, req.body, req))));
  r.get('/:id/prescription', auth, authMw.requireRole('patient', 'doctor'), validate({ params: id }),
    asyncH(async (req, res) => res.json(await rx.get(req.user, req.params.id, req))));
  return r;
}

function prescriptionListRoutes({ prescriptionService: rx, authMw }) {
  const r = express.Router();
  r.get('/', authMw.authenticate(), authMw.requireRole('patient'), validate({ query: z.object({ limit: z.coerce.number().int().min(1).max(100).default(20) }).strict() }),
    asyncH(async (req, res) => res.json({ items: await rx.listForPatient(req.user.id, req.query.limit) })));
  return r;
}

/** Provider webhook: HMAC-SHA256 over `${timestamp}.${rawBody}`, 5-minute tolerance, event-id de-duplication. */
function webhookRoutes({ consultationService: svc, config, metrics }) {
  const r = express.Router();
  r.post('/payments', asyncH(async (req, res) => {
    const ts = req.get('x-webhook-timestamp'); const sig = req.get('x-webhook-signature') || '';
    if (!ts || !req.rawBody || Math.abs(Date.now() / 1000 - Number(ts)) > 300) throw E.unauthorized('Stale or missing webhook timestamp');
    const expected = hmacHex(config.paymentWebhookSecret, `${ts}.${req.rawBody.toString('utf8')}`);
    if (!safeEqual(expected, sig)) { metrics.paymentWebhooks.inc({ type: 'unknown', result: 'bad_signature' }); throw E.unauthorized('Invalid signature'); }
    const evt = z.object({ id: z.string().min(8).max(100), type: z.enum(['payment.succeeded', 'payment.failed']), providerRef: z.string().min(4).max(100) }).strict().parse(req.body);
    const out = await svc.handlePaymentEvent(evt);
    metrics.paymentWebhooks.inc({ type: evt.type, result: out.duplicate ? 'duplicate' : 'applied' });
    res.json({ received: true, duplicate: out.duplicate });
  }));
  return r;
}
module.exports = { consultationRoutes, prescriptionListRoutes, webhookRoutes };
