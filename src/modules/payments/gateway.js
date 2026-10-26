'use strict';
const crypto = require('crypto');
const { retry, CircuitBreaker } = require('../../lib/retry');

/**
 * Payment provider port. `MockGateway` stands in for Razorpay/Stripe; swap by implementing
 * createIntent/refund with the same contract. Both calls are idempotent on `idempotencyKey` at the provider.
 */
class MockGateway {
  constructor({ failRate = 0 } = {}) { this.failRate = failRate; this.intents = new Map(); this.refunds = new Map(); }

  async createIntent({ paymentId, amountPaise, currency, idempotencyKey }) {
    if (Math.random() < this.failRate) { const e = new Error('mock gateway 503'); e.transient = true; throw e; }
    if (this.intents.has(idempotencyKey)) return this.intents.get(idempotencyKey);
    const out = { providerRef: `mock_pi_${crypto.randomBytes(8).toString('hex')}`, clientSecret: `mock_secret_${paymentId}`, amountPaise, currency };
    this.intents.set(idempotencyKey, out);
    return out;
  }

  async refund({ providerRef, amountPaise, idempotencyKey }) {
    if (Math.random() < this.failRate) { const e = new Error('mock gateway 503'); e.transient = true; throw e; }
    if (this.refunds.has(idempotencyKey)) return this.refunds.get(idempotencyKey);
    const out = { refundRef: `mock_re_${crypto.randomBytes(8).toString('hex')}`, providerRef, amountPaise };
    this.refunds.set(idempotencyKey, out);
    return out;
  }
}

/** Resilience wrapper: bounded retries with jittered backoff + circuit breaker, so a provider outage fails fast. */
function withResilience(gw, { logger }) {
  const breaker = new CircuitBreaker({ name: 'payment-gateway', failureThreshold: 5, cooldownMs: 15000 });
  const call = (fn) => breaker.exec(() => retry(fn, {
    retries: 3, baseMs: 100, maxMs: 1500, shouldRetry: (e) => e.transient === true,
    onRetry: (e, n, d) => logger.warn({ attempt: n, delayMs: Math.round(d) }, 'payment gateway retry'),
  }));
  return {
    createIntent: (a) => call(() => gw.createIntent(a)),
    refund: (a) => call(() => gw.refund(a)),
    breaker,
  };
}
module.exports = { MockGateway, withResilience };
