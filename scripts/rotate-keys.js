'use strict';
/**
 * Key rotation: 1) add new key to ENCRYPTION_KEYS, set ENCRYPTION_ACTIVE_KEY_ID to it, deploy (old key still decrypts)
 * 2) run `npm run rotate-keys` to re-encrypt all PHI in batches  3) once `--check` reports 0 rows on old keys, retire the old key.
 */
const { load } = require('../src/config');
const { createCrypto } = require('../src/lib/crypto');
const { Pool } = require('pg');

const TARGETS = [
  { table: 'users', pk: 'id', col: 'mfa_secret_enc', aad: (r) => `user:${r.id}:mfa` },
  { table: 'profiles', pk: 'user_id', col: 'phone_enc', aad: (r) => `profile:${r.user_id}:phone` },
  { table: 'profiles', pk: 'user_id', col: 'dob_enc', aad: (r) => `profile:${r.user_id}:dob` },
  { table: 'consultations', pk: 'id', col: 'reason_enc', aad: (r) => `consult:${r.id}:reason` },
  { table: 'consultations', pk: 'id', col: 'notes_enc', aad: (r) => `consult:${r.id}:notes` },
  { table: 'prescriptions', pk: 'consultation_id', col: 'diagnosis_enc', aad: (r) => `rx:${r.consultation_id}` },
  { table: 'prescriptions', pk: 'consultation_id', col: 'medications_enc', aad: (r) => `rx:${r.consultation_id}` },
  { table: 'prescriptions', pk: 'consultation_id', col: 'instructions_enc', aad: (r) => `rx:${r.consultation_id}` },
];

async function rotate({ check = false } = {}) {
  const config = load();
  const fc = createCrypto(config.encryption);
  const pool = new Pool({ connectionString: config.databaseUrl });
  let total = 0;
  for (const t of TARGETS) {
    const prefix = `v1.${fc.activeKeyId}.`;
    for (;;) {
      const { rows } = await pool.query(
        `SELECT ${t.pk}, ${t.col} FROM ${t.table} WHERE ${t.col} IS NOT NULL AND ${t.col} NOT LIKE $1 LIMIT 500`, [`${prefix}%`]);
      if (!rows.length) break;
      if (check) { console.log(`${t.table}.${t.col}: ${rows.length}+ rows on old key`); total += rows.length; break; }
      for (const r of rows) {
        await pool.query(`UPDATE ${t.table} SET ${t.col} = $2 WHERE ${t.pk} = $1`, [r[t.pk], fc.reencrypt(r[t.col], t.aad(r))]);
        total += 1;
      }
    }
  }
  await pool.end();
  return total;
}
if (require.main === module) {
  rotate({ check: process.argv.includes('--check') }).then((n) => console.log(`${process.argv.includes('--check') ? 'rows on old keys' : 're-encrypted'}: ${n}`)).catch((e) => { console.error(e); process.exit(1); });
}
module.exports = { rotate };
