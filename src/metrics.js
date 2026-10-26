'use strict';
const client = require('prom-client');

function createMetrics() {
  const registry = new client.Registry();
  client.collectDefaultMetrics({ register: registry });
  const m = {
    registry,
    httpDuration: new client.Histogram({
      name: 'http_request_duration_seconds', help: 'HTTP latency', labelNames: ['method', 'route', 'status'],
      buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.2, 0.3, 0.5, 1, 2.5, 5], registers: [registry],
    }),
    dbDuration: new client.Histogram({
      name: 'db_query_duration_seconds', help: 'DB latency', labelNames: ['pool'],
      buckets: [0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1], registers: [registry],
    }),
    dbRetries: new client.Counter({ name: 'db_tx_retries_total', help: 'Serialization/deadlock retries', registers: [registry] }),
    bookings: new client.Counter({ name: 'bookings_total', help: 'Booking attempts by result', labelNames: ['result'], registers: [registry] }),
    sagaCompensations: new client.Counter({ name: 'saga_compensations_total', help: 'Saga compensations', labelNames: ['reason'], registers: [registry] }),
    idempotentReplays: new client.Counter({ name: 'idempotent_replays_total', help: 'Replayed idempotent responses', registers: [registry] }),
    rateLimited: new client.Counter({ name: 'rate_limited_total', help: 'Rejected by rate limiter', labelNames: ['scope'], registers: [registry] }),
    authEvents: new client.Counter({ name: 'auth_events_total', help: 'Auth outcomes', labelNames: ['event'], registers: [registry] }),
    auditFailures: new client.Counter({ name: 'audit_write_failures_total', help: 'Audit write failures', registers: [registry] }),
    jobs: new client.Counter({ name: 'jobs_processed_total', help: 'Async jobs', labelNames: ['name', 'result'], registers: [registry] }),
    paymentWebhooks: new client.Counter({ name: 'payment_webhooks_total', help: 'Webhooks', labelNames: ['type', 'result'], registers: [registry] }),
    cacheOps: new client.Counter({ name: 'cache_ops_total', help: 'Cache hits/misses', labelNames: ['result'], registers: [registry] }),
  };
  return m;
}
module.exports = { createMetrics };
