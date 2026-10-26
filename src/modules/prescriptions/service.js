'use strict';
const { E } = require('../../lib/errors');

function createPrescriptionService({ db, audit, crypto: fc }) {
  const aad = (cid) => `rx:${cid}`;

  async function create(doctorId, consultationId, body, req) {
    const { rows: [c] } = await db.query('SELECT id, doctor_id, patient_id, status FROM consultations WHERE id = $1', [consultationId]);
    if (!c || c.doctor_id !== doctorId) throw E.notFound('Consultation not found');
    if (!['IN_PROGRESS', 'COMPLETED'].includes(c.status)) throw E.conflict('INVALID_STATE_TRANSITION', 'Prescriptions can only be issued for started consultations');
    const { rows: [p] } = await db.query(
      `INSERT INTO prescriptions (consultation_id, doctor_id, patient_id, diagnosis_enc, medications_enc, instructions_enc)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING id, created_at`,
      [consultationId, doctorId, c.patient_id, fc.encrypt(body.diagnosis, aad(consultationId)),
        fc.encryptJson(body.medications, aad(consultationId)), body.instructions ? fc.encrypt(body.instructions, aad(consultationId)) : null]);
    await audit.log({ action: 'PRESCRIPTION_CREATED', resourceType: 'prescription', resourceId: p.id, metadata: { consultationId } }, req);
    return { id: p.id, consultationId, createdAt: p.created_at, ...body };
  }

  async function get(actor, consultationId, req) {
    const { rows: [p] } = await db.query('SELECT * FROM prescriptions WHERE consultation_id = $1', [consultationId]);
    if (!p || (p.patient_id !== actor.id && p.doctor_id !== actor.id)) throw E.notFound('Prescription not found');
    await audit.log({ action: 'PRESCRIPTION_READ', resourceType: 'prescription', resourceId: p.id }, req);
    return {
      id: p.id, consultationId, doctorId: p.doctor_id, patientId: p.patient_id, createdAt: p.created_at,
      diagnosis: fc.decrypt(p.diagnosis_enc, aad(consultationId)), medications: fc.decryptJson(p.medications_enc, aad(consultationId)),
      instructions: fc.decrypt(p.instructions_enc, aad(consultationId)),
    };
  }

  async function listForPatient(patientId, limit) {
    const { rows } = await db.query('SELECT id, consultation_id, doctor_id, created_at FROM prescriptions WHERE patient_id = $1 ORDER BY created_at DESC LIMIT $2', [patientId, limit]);
    return rows.map((r) => ({ id: r.id, consultationId: r.consultation_id, doctorId: r.doctor_id, createdAt: r.created_at }));
  }
  return { create, get, listForPatient };
}
module.exports = { createPrescriptionService };
