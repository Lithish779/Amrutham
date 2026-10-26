'use strict';
// Seeds an admin (MFA enrolment required on first login), verified doctors and a patient for demos.
const bcrypt = require('bcryptjs');
const { Pool } = require('pg');
const { migrate } = require('./migrate');

const url = process.env.DATABASE_URL || 'postgres://amrutam:amrutam@localhost:5432/amrutam';
const ADMIN_EMAIL = process.env.SEED_ADMIN_EMAIL || 'admin@amrutam.local';
const PASSWORD = process.env.SEED_PASSWORD || 'ChangeMe-Str0ng-Pass';

const doctors = [
  ['Dr. Asha Verma', 'ayurveda', 800_00, ['en', 'hi'], 12, 4.8], ['Dr. Rohan Mehta', 'dermatology', 600_00, ['en', 'hi'], 8, 4.5],
  ['Dr. Nisha Rao', 'general', 0, ['en', 'ta'], 5, 4.2], ['Dr. Karan Singh', 'pediatrics', 700_00, ['en', 'pa'], 15, 4.9],
];

(async () => {
  await migrate(url);
  const pool = new Pool({ connectionString: url });
  const hash = await bcrypt.hash(PASSWORD, 12);
  const up = async (email, role, name) => {
    const { rows: [u] } = await pool.query(
      `INSERT INTO users (email, password_hash, role) VALUES ($1,$2,$3) ON CONFLICT (lower(email)) DO UPDATE SET email = users.email RETURNING id`, [email, hash, role]);
    await pool.query('INSERT INTO profiles (user_id, full_name) VALUES ($1,$2) ON CONFLICT DO NOTHING', [u.id, name]);
    return u.id;
  };
  await up(ADMIN_EMAIL, 'admin', 'Platform Admin');
  await up('patient@amrutam.local', 'patient', 'Demo Patient');
  for (const [name, spec, fee, langs, exp, rating] of doctors) {
    const id = await up(`${name.toLowerCase().replace(/[^a-z]+/g, '.')}@amrutam.local`, 'doctor', name);
    await pool.query(
      `INSERT INTO doctors (user_id, display_name, specialization, experience_years, consultation_fee_paise, languages, rating_avg, rating_count, is_verified, bio)
       VALUES ($1,$2,$3,$4,$5,$6,$7,50,true,$8) ON CONFLICT DO NOTHING`, [id, name, spec, exp, fee, langs, rating, `${spec} specialist with ${exp} years of experience`]);
  }
  console.log(`seeded. admin=${ADMIN_EMAIL} patient=patient@amrutam.local password=${PASSWORD} (doctors/admin must enrol MFA on first login)`);
  await pool.end();
})().catch((e) => { console.error(e); process.exit(1); });
