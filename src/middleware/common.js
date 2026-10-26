'use strict';
const crypto = require('crypto');
const { ZodError } = require('zod');
const context = require('../lib/context');
const { AppError, E } = require('../lib/errors');

/** Assigns/propagates X-Request-Id and opens the async context used by logs and audit. */
function requestContext() {
  return (req, res, next) => {
    const inbound = req.get('x-request-id');
    const id = inbound && /^[\w-]{8,64}$/.test(inbound) ? inbound : crypto.randomUUID();
    res.setHeader('X-Request-Id', id);
    req.id = id;
    context.run({ requestId: id }, next);
  };
}

function httpMetrics(metrics) {
  return (req, res, next) => {
    const end = metrics.httpDuration.startTimer();
    res.on('finish', () => {
      const route = req.route ? `${req.baseUrl || ''}${req.route.path}` : 'unmatched';
      end({ method: req.method, route, status: res.statusCode });
    });
    next();
  };
}

/** Zod validation for params/query/body. Unknown body keys are rejected by the schemas (.strict()). */
const validate = (schemas) => (req, res, next) => {
  try {
    for (const part of ['params', 'query', 'body']) {
      if (schemas[part]) req[part] = schemas[part].parse(req[part] === undefined ? {} : req[part]);
    }
    next();
  } catch (e) { next(e); }
};

const PG_CONSTRAINTS = {
  slots_no_overlap: ['SLOT_OVERLAP', 'Slot overlaps an existing slot'],
  consult_patient_no_overlap: ['PATIENT_OVERLAP', 'You already have a consultation at this time'],
  consult_slot_active_uq: ['SLOT_UNAVAILABLE', 'Slot is no longer available'],
  users_email_lower_uq: ['EMAIL_TAKEN', 'Email already registered'],
  prescriptions_consultation_id_key: ['PRESCRIPTION_EXISTS', 'Prescription already issued for this consultation'],
};

function errorHandler({ logger, config }) {
  return (err, req, res, next) => {
    let status = 500;
    let body = { code: 'INTERNAL', message: 'Internal server error' };
    if (err instanceof ZodError) {
      status = 400;
      body = { code: 'VALIDATION_ERROR', message: 'Invalid request', details: err.issues.map((i) => ({ path: i.path.join('.'), message: i.message })) };
    } else if (err instanceof AppError) {
      status = err.status;
      body = { code: err.code, message: err.message, details: err.details };
      if (err.retryAfter) res.setHeader('Retry-After', String(err.retryAfter));
    } else if (err.type === 'entity.parse.failed') {
      status = 400; body = { code: 'INVALID_JSON', message: 'Malformed JSON body' };
    } else if (err.type === 'entity.too.large') {
      status = 413; body = { code: 'PAYLOAD_TOO_LARGE', message: 'Request body too large' };
    } else if (err.code === '23505' || err.code === '23P01') {
      const m = PG_CONSTRAINTS[err.constraint];
      status = 409; body = { code: m ? m[0] : 'CONFLICT', message: m ? m[1] : 'Conflict with existing resource' };
    } else if (err.code === '22P02') {
      status = 400; body = { code: 'BAD_REQUEST', message: 'Malformed identifier' };
    } else if (err.code === 'CIRCUIT_OPEN') {
      status = 503; body = { code: 'SERVICE_UNAVAILABLE', message: 'Upstream temporarily unavailable' };
    }
    if (status >= 500) logger.error({ err, path: req.path }, 'unhandled error');
    body.requestId = req.id;
    if (!config.isProd && status >= 500) body.debug = err.message;
    res.status(status).json({ error: body });
  };
}

const asyncH = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

module.exports = { requestContext, httpMetrics, validate, errorHandler, asyncH, E };
