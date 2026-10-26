const { createCrypto, canonicalJson, safeEqual } = require('../../src/lib/crypto');

const k = (n) => Buffer.alloc(32, n).toString('base64');

describe('field encryption', () => {
  const c1 = createCrypto({ keys: { 1: k(1) }, activeKeyId: '1' });

  test('round-trips and never leaks plaintext', () => {
    const ct = c1.encrypt('hypertension', 'rx:1');
    expect(ct).not.toContain('hypertension');
    expect(c1.decrypt(ct, 'rx:1')).toBe('hypertension');
  });
  test('ciphertexts are randomised (fresh IV)', () => {
    expect(c1.encrypt('x')).not.toBe(c1.encrypt('x'));
  });
  test('AAD binds ciphertext to its row (swap attack fails)', () => {
    const ct = c1.encrypt('secret', 'rx:A');
    expect(() => c1.decrypt(ct, 'rx:B')).toThrow();
  });
  test('tampering is detected (GCM tag)', () => {
    const parts = c1.encrypt('secret').split('.');
    parts[4] = Buffer.from('AAAA').toString('base64url');
    expect(() => c1.decrypt(parts.join('.'))).toThrow();
  });
  test('key rotation: old ciphertext readable, re-encrypted under new active key', () => {
    const old = c1.encrypt('phi', 'a');
    const c2 = createCrypto({ keys: { 1: k(1), 2: k(2) }, activeKeyId: '2' });
    expect(c2.decrypt(old, 'a')).toBe('phi');
    const re = c2.reencrypt(old, 'a');
    expect(c2.keyIdOf(re)).toBe('2');
    expect(c2.decrypt(re, 'a')).toBe('phi');
    expect(c2.reencrypt(re, 'a')).toBe(re); // idempotent
  });
  test('JSON helpers and null passthrough', () => {
    expect(c1.decryptJson(c1.encryptJson([{ a: 1 }], 'x'), 'x')).toEqual([{ a: 1 }]);
    expect(c1.encrypt(null)).toBeNull();
    expect(c1.decrypt(null)).toBeNull();
  });
});

test('canonicalJson is key-order independent; safeEqual constant-time compare', () => {
  expect(canonicalJson({ b: 1, a: { d: 2, c: 3 } })).toBe(canonicalJson({ a: { c: 3, d: 2 }, b: 1 }));
  expect(safeEqual('abc', 'abc')).toBe(true);
  expect(safeEqual('abc', 'abd')).toBe(false);
  expect(safeEqual('abc', 'abcd')).toBe(false);
});
