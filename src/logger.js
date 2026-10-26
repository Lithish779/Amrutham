'use strict';
const pino = require('pino');
const context = require('./lib/context');
let otel;
try { otel = require('@opentelemetry/api'); } catch { /* optional */ }

function createLogger(level = 'info') {
  return pino({
    level,
    base: { service: 'amrutam-api' },
    timestamp: pino.stdTimeFunctions.isoTime,
    // never log credentials / PHI
    redact: {
      paths: ['req.headers.authorization', 'req.headers.cookie', '*.password', '*.refreshToken', '*.accessToken',
        '*.mfaCode', '*.diagnosis', '*.medications', '*.notes', '*.phone', '*.dob'],
      censor: '[REDACTED]',
    },
    mixin() {
      const ctx = context.get();
      const span = otel && otel.trace.getActiveSpan();
      const sc = span && span.spanContext();
      return { requestId: ctx.requestId, userId: ctx.userId, traceId: sc && sc.traceId, spanId: sc && sc.spanId };
    },
  });
}
module.exports = { createLogger };
