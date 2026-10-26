'use strict';
const { sha256, canonicalJson } = require('../../lib/crypto');
const { encodeCursor, decodeCursor } = require('../../lib/pagination');

const SORTS = {
  rating: { col: 'd.rating_avg', dir: 'DESC' },
  fee_asc: { col: 'd.consultation_fee_paise', dir: 'ASC' },
  experience: { col: 'd.experience_years', dir: 'DESC' },
};

function createSearchService({ db, cache }) {
  async function searchDoctors(q) {
    const ver = await cache.version('search');
    const key = `search:${ver}:${sha256(canonicalJson(q))}`;
    return cache.wrap(key, 30, () => run(q));
  }

  async function run(q) {
    const p = []; const w = ['d.is_verified'];
    const add = (v) => { p.push(v); return `$${p.length}`; };
    if (q.q) w.push(`(d.search_tsv @@ plainto_tsquery('simple', ${add(q.q)}) OR d.display_name ILIKE '%' || ${add(q.q)} || '%')`);
    if (q.specialization) w.push(`lower(d.specialization) = lower(${add(q.specialization)})`);
    if (q.language) w.push(`${add(q.language)} = ANY(d.languages)`);
    if (q.minRating !== undefined) w.push(`d.rating_avg >= ${add(q.minRating)}`);
    if (q.minFee !== undefined) w.push(`d.consultation_fee_paise >= ${add(q.minFee)}`);
    if (q.maxFee !== undefined) w.push(`d.consultation_fee_paise <= ${add(q.maxFee)}`);
    if (q.availableFrom || q.availableTo) {
      const from = add(q.availableFrom || new Date()); const to = add(q.availableTo || new Date(Date.now() + 7 * 86400_000));
      w.push(`EXISTS (SELECT 1 FROM availability_slots s WHERE s.doctor_id = d.user_id AND s.status = 'AVAILABLE' AND s.start_time >= ${from} AND s.start_time < ${to})`);
    }
    const s = SORTS[q.sort];
    const cur = decodeCursor(q.cursor);
    if (cur) {
      const op = s.dir === 'DESC' ? '<' : '>';
      w.push(`(${s.col}, d.user_id) ${op} (${add(cur[0])}::numeric, ${add(cur[1])}::uuid)`);
    }
    const lim = add(q.limit + 1);
    const { rows } = await db.read(
      `SELECT d.user_id, d.display_name, d.specialization, d.qualifications, d.experience_years, d.consultation_fee_paise,
              d.languages, d.bio, d.rating_avg, d.rating_count, ${s.col}::text AS sort_value
       FROM doctors d WHERE ${w.join(' AND ')} ORDER BY ${s.col} ${s.dir}, d.user_id ${s.dir} LIMIT ${lim}`, p);
    const page = rows.slice(0, q.limit);
    const last = page[page.length - 1];
    return {
      items: page.map((d) => ({
        id: d.user_id, name: d.display_name, specialization: d.specialization, qualifications: d.qualifications,
        experienceYears: d.experience_years, consultationFeePaise: d.consultation_fee_paise, languages: d.languages,
        bio: d.bio, rating: Number(d.rating_avg), ratingCount: d.rating_count,
      })),
      nextCursor: rows.length > q.limit ? encodeCursor([last.sort_value, last.user_id]) : null,
    };
  }
  return { searchDoctors };
}
module.exports = { createSearchService, SORTS };
