'use strict';
const crypto = require('crypto');

/**
 * Field-level encryption (AES-256-GCM) with a versioned keyring so keys can be rotated
 * without downtime: new writes use the active key id, old ciphertexts stay readable
 * until `scripts/rotate-keys.js` re-encrypts them.
 * Format: v1.<keyId>.<iv b64url>.<tag b64url>.<ciphertext b64url>
 */
function createCrypto({ keys, activeKeyId }) {
  const ring = Object.fromEntries(Object.entries(keys).map(([id, k]) => [id, Buffer.from(k, 'base64')]));

  function encrypt(plain, aad = '') {
    if (plain === null || plain === undefined) return null;
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', ring[activeKeyId], iv);
    cipher.setAAD(Buffer.from(aad));
    const ct = Buffer.concat([cipher.update(String(plain), 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return ['v1', activeKeyId, iv.toString('base64url'), tag.toString('base64url'), ct.toString('base64url')].join('.');
  }

  function keyIdOf(blob) {
    return blob ? blob.split('.')[1] : null;
  }

  function decrypt(blob, aad = '') {
    if (blob === null || blob === undefined) return null;
    const [ver, keyId, iv, tag, ct] = blob.split('.');
    if (ver !== 'v1' || !ring[keyId]) throw new Error('Unknown ciphertext version or key id');
    const d = crypto.createDecipheriv('aes-256-gcm', ring[keyId], Buffer.from(iv, 'base64url'));
    d.setAAD(Buffer.from(aad));
    d.setAuthTag(Buffer.from(tag, 'base64url'));
    return Buffer.concat([d.update(Buffer.from(ct, 'base64url')), d.final()]).toString('utf8');
  }

  const encryptJson = (obj, aad) => encrypt(JSON.stringify(obj), aad);
  const decryptJson = (blob, aad) => (blob ? JSON.parse(decrypt(blob, aad)) : null);
  const reencrypt = (blob, aad) => (blob && keyIdOf(blob) !== activeKeyId ? encrypt(decrypt(blob, aad), aad) : blob);

  return { encrypt, decrypt, encryptJson, decryptJson, reencrypt, keyIdOf, activeKeyId };
}

const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');
const randomToken = (bytes = 48) => crypto.randomBytes(bytes).toString('base64url');
const hmacHex = (secret, payload) => crypto.createHmac('sha256', secret).update(payload).digest('hex');
const safeEqual = (a, b) => {
  const ab = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  return ab.length === bb.length && crypto.timingSafeEqual(ab, bb);
};
function canonicalJson(v) {
  if (Array.isArray(v)) return `[${v.map(canonicalJson).join(',')}]`;
  if (v && typeof v === 'object') {
    return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canonicalJson(v[k])}`).join(',')}}`;
  }
  return JSON.stringify(v);
}

module.exports = { createCrypto, sha256, randomToken, hmacHex, safeEqual, canonicalJson };
