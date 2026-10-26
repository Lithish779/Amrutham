'use strict';
const { E } = require('../../lib/errors');

function createDoctorService({ db, cache, audit, config }) {
  const slotRow = (s) => ({ id: s.id, doctorId: s.doctor_id, startTime: s.start_time, endTime: s.end_time, status: s.status });

  async function getProfile(doctorId) {
    const { rows: [d] } = await db.read(
      `SELECT user_id, display_name, specialization, qualifications, experience_years, consultation_fee_paise,
              languages, bio, rating_avg, rating_count, is_verified FROM doctors WHERE user_id = $1`, [doctorId]);
    if (!d || !d.is_verified) throw E.notFound('Doctor not found');
    return publicDoctor(d);
  }

  const publicDoctor = (d) => ({
    id: d.user_id, name: d.display_name, specialization: d.specialization, qualifications: d.qualifications,
    experienceYears: d.experience_years, consultationFeePaise: d.consultation_fee_paise, languages: d.languages,
    bio: d.bio, rating: Number(d.rating_avg), ratingCount: d.rating_count,
  });

  async function updateProfile(doctorId, p) {
    const { rows: [d] } = await db.query(
      `UPDATE doctors SET specialization = COALESCE($2, specialization), qualifications = COALESCE($3, qualifications),
         experience_years = COALESCE($4, experience_years), consultation_fee_paise = COALESCE($5, consultation_fee_paise),
         languages = COALESCE($6, languages), bio = COALESCE($7, bio), updated_at = now()
       WHERE user_id = $1 RETURNING *`,
      [doctorId, p.specialization ?? null, p.qualifications ?? null, p.experienceYears ?? null, p.consultationFeePaise ?? null,
        p.languages ?? null, p.bio ?? null]);
    if (!d) throw E.notFound();
    await audit.log({ action: 'DOCTOR_PROFILE_UPDATED', resourceType: 'doctor', resourceId: doctorId, actor: { id: doctorId, role: 'doctor' } });
    return { ...publicDoctor(d), verified: d.is_verified };
  }

  async function createSlots(doctorId, slots) {
    const now = Date.now();
    const horizon = now + 90 * 86400_000;
    for (const s of slots) {
      const st = Date.parse(s.startTime); const en = Date.parse(s.endTime);
      const mins = (en - st) / 60000;
      if (st < now + config.minBookingLeadMinutes * 60000) throw E.badRequest('Slot must start in the future');
      if (st > horizon) throw E.badRequest('Slots can be created at most 90 days ahead');
      if (mins < 10 || mins > 120) throw E.badRequest('Slot duration must be between 10 and 120 minutes');
    }
    const created = await db.tx(async (t) => {
      const out = [];
      for (const s of slots) {
        const { rows: [r] } = await t.query(
          'INSERT INTO availability_slots (doctor_id, start_time, end_time) VALUES ($1,$2,$3) RETURNING *', [doctorId, s.startTime, s.endTime]);
        out.push(slotRow(r));
      }
      return out;
    });
    await cache.bump(`doctor:${doctorId}:slots`);
    await cache.bump('search');
    await audit.log({ action: 'SLOTS_CREATED', resourceType: 'doctor', resourceId: doctorId, actor: { id: doctorId, role: 'doctor' }, metadata: { count: created.length } });
    return created;
  }

  async function cancelSlot(doctorId, slotId) {
    const { rows: [s] } = await db.query(
      `UPDATE availability_slots SET status = 'CANCELLED', version = version + 1
       WHERE id = $1 AND doctor_id = $2 AND status = 'AVAILABLE' RETURNING *`, [slotId, doctorId]);
    if (!s) {
      const { rows: [ex] } = await db.query('SELECT status FROM availability_slots WHERE id=$1 AND doctor_id=$2', [slotId, doctorId]);
      if (!ex) throw E.notFound('Slot not found');
      throw E.conflict('SLOT_NOT_CANCELLABLE', `Slot is ${ex.status}; cancel the consultation instead`);
    }
    await cache.bump(`doctor:${doctorId}:slots`);
    await cache.bump('search');
    await audit.log({ action: 'SLOT_CANCELLED', resourceType: 'slot', resourceId: slotId, actor: { id: doctorId, role: 'doctor' } });
  }

  /** Public availability: AVAILABLE slots only; cached per doctor with version-based invalidation. */
  async function listSlots(doctorId, { from, to }) {
    const ver = await cache.version(`doctor:${doctorId}:slots`);
    const key = `slots:${doctorId}:${ver}:${from.toISOString()}:${to.toISOString()}`;
    return cache.wrap(key, 15, async () => {
      const { rows } = await db.read(
        `SELECT * FROM availability_slots WHERE doctor_id = $1 AND status = 'AVAILABLE' AND start_time >= GREATEST($2, now())
         AND start_time < $3 ORDER BY start_time LIMIT 500`, [doctorId, from, to]);
      return rows.map(slotRow);
    });
  }

  async function listOwnSlots(doctorId, { from, to }) {
    const { rows } = await db.query(
      'SELECT * FROM availability_slots WHERE doctor_id = $1 AND start_time >= $2 AND start_time < $3 ORDER BY start_time LIMIT 500', [doctorId, from, to]);
    return rows.map(slotRow);
  }

  return { getProfile, updateProfile, createSlots, cancelSlot, listSlots, listOwnSlots };
}
module.exports = { createDoctorService };
