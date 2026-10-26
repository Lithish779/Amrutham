'use strict';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Exponential backoff with full jitter: delay = random(0, min(max, base * factor^attempt)). */
function backoffDelay(attempt, { baseMs = 100, maxMs = 5000, factor = 2 } = {}) {
  return Math.random() * Math.min(maxMs, baseMs * factor ** attempt);
}

async function retry(fn, opts = {}) {
  const { retries = 3, shouldRetry = () => true, onRetry } = opts;
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn(attempt);
    } catch (err) {
      if (attempt >= retries || !shouldRetry(err)) throw err;
      const delay = backoffDelay(attempt, opts);
      if (onRetry) onRetry(err, attempt + 1, delay);
      await sleep(delay);
    }
  }
}

/** Minimal circuit breaker: opens after N consecutive failures, half-opens after cooldown. */
class CircuitBreaker {
  constructor({ failureThreshold = 5, cooldownMs = 10000, name = 'breaker' } = {}) {
    Object.assign(this, { failureThreshold, cooldownMs, name, failures: 0, openedAt: 0, state: 'closed' });
  }

  async exec(fn) {
    if (this.state === 'open') {
      if (Date.now() - this.openedAt < this.cooldownMs) {
        const e = new Error(`${this.name} circuit open`);
        e.code = 'CIRCUIT_OPEN';
        throw e;
      }
      this.state = 'half-open';
    }
    try {
      const r = await fn();
      this.failures = 0;
      this.state = 'closed';
      return r;
    } catch (err) {
      this.failures += 1;
      if (this.state === 'half-open' || this.failures >= this.failureThreshold) {
        this.state = 'open';
        this.openedAt = Date.now();
      }
      throw err;
    }
  }
}

module.exports = { retry, backoffDelay, sleep, CircuitBreaker };
