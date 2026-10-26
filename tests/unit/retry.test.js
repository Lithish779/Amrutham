const { retry, backoffDelay, CircuitBreaker } = require('../../src/lib/retry');

describe('retry with exponential backoff + jitter', () => {
  test('retries transient failures then succeeds', async () => {
    let n = 0;
    const r = await retry(async () => { if (++n < 3) throw new Error('transient'); return 'ok'; }, { retries: 3, baseMs: 1, maxMs: 2 });
    expect(r).toBe('ok');
    expect(n).toBe(3);
  });
  test('gives up after max retries and rethrows', async () => {
    let n = 0;
    await expect(retry(async () => { n++; throw new Error('down'); }, { retries: 2, baseMs: 1 })).rejects.toThrow('down');
    expect(n).toBe(3);
  });
  test('does not retry non-retryable errors', async () => {
    let n = 0;
    await expect(retry(async () => { n++; throw new Error('bad'); }, { retries: 5, baseMs: 1, shouldRetry: () => false })).rejects.toThrow();
    expect(n).toBe(1);
  });
  test('delay is bounded by the exponential cap and jittered', () => {
    for (let a = 0; a < 10; a++) {
      const d = backoffDelay(a, { baseMs: 100, maxMs: 1000, factor: 2 });
      expect(d).toBeGreaterThanOrEqual(0);
      expect(d).toBeLessThanOrEqual(Math.min(1000, 100 * 2 ** a));
    }
  });
});

describe('circuit breaker', () => {
  test('opens after threshold, fails fast, half-opens after cooldown', async () => {
    const cb = new CircuitBreaker({ failureThreshold: 2, cooldownMs: 30 });
    const fail = () => cb.exec(async () => { throw new Error('x'); });
    await expect(fail()).rejects.toThrow('x');
    await expect(fail()).rejects.toThrow('x');
    await expect(cb.exec(async () => 'never')).rejects.toMatchObject({ code: 'CIRCUIT_OPEN' });
    await new Promise((r) => setTimeout(r, 40));
    await expect(cb.exec(async () => 'healed')).resolves.toBe('healed');
    expect(cb.state).toBe('closed');
  });
});
