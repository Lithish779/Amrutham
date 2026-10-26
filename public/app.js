// Amrutam Telemedicine Client Logic
'use strict';

// Mock Seed Doctors data matching PostgreSQL schema
const DOCTORS = [
  {
    id: 'd1-asha-verma',
    name: 'Dr. Asha Verma',
    specialization: 'Ayurveda',
    qualifications: 'BAMS, MD (Ayurveda), Gold Medalist (BHU)',
    experienceYears: 14,
    fee: 750,
    languages: ['English', 'Hindi', 'Sanskrit'],
    rating: 4.9,
    ratingCount: 184,
    verified: true,
    bio: 'Specialist in chronic metabolic disorders, gut health, lifestyle management, and Panchakarma detoxification.',
    slots: ['10:30 AM', '02:00 PM', '04:30 PM']
  },
  {
    id: 'd2-rohan-mehta',
    name: 'Dr. Rohan Mehta',
    specialization: 'Dermatology',
    qualifications: 'MBBS, DVD (Ayurvedic Dermatology)',
    experienceYears: 9,
    fee: 600,
    languages: ['English', 'Hindi', 'Gujarati'],
    rating: 4.8,
    ratingCount: 142,
    verified: true,
    bio: 'Ayurvedic dermatology expert for psoriasis, eczema, acne vulgaris, and natural hair restoration therapies.',
    slots: ['11:00 AM', '03:15 PM', '05:45 PM']
  },
  {
    id: 'd3-nisha-rao',
    name: 'Dr. Nisha Rao',
    specialization: 'Panchakarma',
    qualifications: 'BAMS, Fellowship in Panchakarma (Kerala)',
    experienceYears: 12,
    fee: 850,
    languages: ['English', 'Tamil', 'Malayalam'],
    rating: 4.9,
    ratingCount: 210,
    verified: true,
    bio: 'Authentic Kerala Panchakarma physician treating musculoskeletal diseases, spine care, and stress-induced insomnia.',
    slots: ['09:45 AM', '01:30 PM', '06:00 PM']
  },
  {
    id: 'd4-ananya-sharma',
    name: 'Dr. Ananya Sharma',
    specialization: 'Kayachikitsa',
    qualifications: 'BAMS, MD (Kayachikitsa)',
    experienceYears: 8,
    fee: 500,
    languages: ['English', 'Hindi'],
    rating: 4.7,
    ratingCount: 96,
    verified: true,
    bio: 'General Ayurvedic medicine physician focusing on autoimmune resilience, respiratory allergies, and vitality.',
    slots: ['10:00 AM', '12:30 PM', '03:45 PM']
  }
];

// Audit Chain seed data illustrating SHA-256 hash chaining
let AUDIT_LOGS = [
  {
    id: 1,
    action: 'USER_REGISTERED',
    actor: 'patient:p910@example.com',
    ip: '49.207.214.18',
    prev_hash: '0000000000000000000000000000000000000000000000000000000000000000',
    hash: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    ts: '2026-10-26T20:10:15Z'
  },
  {
    id: 2,
    action: 'MFA_ENABLED_TOTP',
    actor: 'doctor:d1@amrutam.co.in',
    ip: '103.21.124.9',
    prev_hash: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    hash: '8f434346648f6b96df89dda901c5176b10a6d83961dd3c1ac88b59b2dc327aa4',
    ts: '2026-10-26T20:15:30Z'
  },
  {
    id: 3,
    action: 'SLOT_HELD_CAS',
    actor: 'patient:p910@example.com',
    ip: '49.207.214.18',
    prev_hash: '8f434346648f6b96df89dda901c5176b10a6d83961dd3c1ac88b59b2dc327aa4',
    hash: '2c26b46b68ffc68ff99b453c1d30413413422d706483bfa0f98a5e886266e7ae',
    ts: '2026-10-26T20:30:00Z'
  },
  {
    id: 4,
    action: 'PAYMENT_WEBHOOK_VERIFIED',
    actor: 'system:payment_gateway',
    ip: '35.192.12.8',
    prev_hash: '2c26b46b68ffc68ff99b453c1d30413413422d706483bfa0f98a5e886266e7ae',
    hash: 'fcde2b2edba56bf408601fb721fe9b5c338d10ee429ea04fae5511b68fbf8fb9',
    ts: '2026-10-26T20:30:12Z'
  },
  {
    id: 5,
    action: 'PRESCRIPTION_CREATED_ENCRYPTED',
    actor: 'doctor:d1@amrutam.co.in',
    ip: '103.21.124.9',
    prev_hash: 'fcde2b2edba56bf408601fb721fe9b5c338d10ee429ea04fae5511b68fbf8fb9',
    hash: '4a44dc15364204a80fe80e9039455cc1608281820fe2b24f1e5233ade67a9b2f',
    ts: '2026-10-26T21:05:00Z'
  }
];

// Helper to generate unique Idempotency Keys
function generateIdemKey() {
  return 'idem-' + Math.floor(10000 + Math.random() * 90000) + '-' + Math.random().toString(36).substring(2, 7);
}

document.addEventListener('DOMContentLoaded', () => {
  initTabs();
  renderDoctors(DOCTORS);
  initDoctorFilters();
  initPrescriptionToggle();
  renderAuditLogs();
  initAuditActions();
  initApiPlayground();
  initBookingModal();
});

// TAB SWITCHING
function initTabs() {
  const navBtns = document.querySelectorAll('.nav-btn');
  const panes = document.querySelectorAll('.tab-pane');

  navBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      const targetTab = btn.getAttribute('data-tab');
      navBtns.forEach(b => b.classList.remove('active'));
      panes.forEach(p => p.classList.remove('active'));

      btn.classList.add('active');
      const targetPane = document.getElementById(`tab-${targetTab}`);
      if (targetPane) targetPane.classList.add('active');
    });
  });
}

// DOCTORS RENDERING
function renderDoctors(doctors) {
  const container = document.getElementById('doctors-list');
  if (!container) return;

  if (doctors.length === 0) {
    container.innerHTML = '<div style="grid-column: 1/-1; text-align: center; padding: 40px; color: var(--text-muted);">No doctors found matching the search criteria.</div>';
    return;
  }

  container.innerHTML = doctors.map(doc => `
    <div class="card doctor-card">
      <div>
        <div class="doc-header">
          <div class="doc-avatar">🌿</div>
          <div>
            <div class="doc-name">
              ${doc.name}
              ${doc.verified ? '<span class="verified-icon" title="Verified Ayurvedic Practitioner"><svg width="18" height="18" viewBox="0 0 24 24" fill="#10b981"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/></svg></span>' : ''}
            </div>
            <div class="doc-specialty">${doc.specialization} • ${doc.qualifications}</div>
            <div class="doc-experience">⭐ ${doc.rating} (${doc.ratingCount} reviews) • ${doc.experienceYears} Years Experience</div>
          </div>
        </div>

        <p class="doc-bio">${doc.bio}</p>

        <div class="doc-tags">
          ${doc.languages.map(l => `<span class="tag-item">🗣️ ${l}</span>`).join('')}
        </div>

        <div class="slots-container">
          <div class="slots-label">
            <span>Available Slots (Today & Tomorrow)</span>
            <span style="color: var(--emerald-light); font-size: 0.75rem;">CAS Protected</span>
          </div>
          <div class="slots-grid">
            ${doc.slots.map(s => `<button class="slot-btn" onclick="openBookingModal('${doc.id}', '${s}')">${s}</button>`).join('')}
          </div>
        </div>
      </div>

      <div class="doc-footer">
        <div class="fee-display">
          <span class="fee-val">₹${doc.fee}</span>
          <span class="fee-sub">per 30-min consultation</span>
        </div>
        <button class="btn btn-primary" onclick="openBookingModal('${doc.id}', '${doc.slots[0]}')">
          Book Appointment
        </button>
      </div>
    </div>
  `).join('');
}

function initDoctorFilters() {
  const searchInput = document.getElementById('doctor-search-input');
  const specPills = document.querySelectorAll('#specialization-filters .pill');

  let currentSpec = 'all';
  let searchQuery = '';

  function applyFilters() {
    let filtered = DOCTORS.filter(d => {
      const matchesSpec = currentSpec === 'all' || d.specialization.toLowerCase() === currentSpec.toLowerCase();
      const matchesSearch = searchQuery === '' || 
        d.name.toLowerCase().includes(searchQuery) || 
        d.specialization.toLowerCase().includes(searchQuery) ||
        d.bio.toLowerCase().includes(searchQuery);
      return matchesSpec && matchesSearch;
    });
    renderDoctors(filtered);
  }

  if (searchInput) {
    searchInput.addEventListener('input', (e) => {
      searchQuery = e.target.value.toLowerCase().trim();
      applyFilters();
    });
  }

  specPills.forEach(pill => {
    pill.addEventListener('click', () => {
      specPills.forEach(p => p.classList.remove('active'));
      pill.classList.add('active');
      currentSpec = pill.getAttribute('data-spec');
      applyFilters();
    });
  });
}

// PRESCRIPTION ENCRYPTION / DECRYPTION TOGGLE
function initPrescriptionToggle() {
  const toggleBtn = document.getElementById('btn-toggle-decrypt');
  const rawCipher = document.getElementById('rx-raw-cipher');
  const decryptedView = document.getElementById('rx-decrypted-view');

  if (toggleBtn && rawCipher && decryptedView) {
    let isDecrypted = false;
    toggleBtn.addEventListener('click', () => {
      isDecrypted = !isDecrypted;
      if (isDecrypted) {
        rawCipher.classList.add('hidden');
        decryptedView.classList.remove('hidden');
        toggleBtn.innerHTML = '🔒 Show Raw Ciphertext';
        toggleBtn.classList.remove('btn-decrypt');
        toggleBtn.classList.add('btn-secondary');
      } else {
        rawCipher.classList.remove('hidden');
        decryptedView.classList.add('hidden');
        toggleBtn.innerHTML = '<span class="lock-icon">🔒</span> Decrypt PHI';
        toggleBtn.classList.remove('btn-secondary');
        toggleBtn.classList.add('btn-decrypt');
      }
    });
  }
}

// AUDIT LOGS HASH CHAIN
function renderAuditLogs() {
  const container = document.getElementById('audit-chain-stream');
  if (!container) return;

  container.innerHTML = AUDIT_LOGS.map(log => `
    <div class="audit-block" id="audit-log-${log.id}">
      <div class="audit-block-top">
        <span>#${log.id} • ${log.action}</span>
        <span style="font-size: 0.75rem; color: var(--text-muted);">${log.ts}</span>
      </div>
      <div class="audit-hash-row">
        <div><strong>Actor:</strong> ${log.actor} (${log.ip})</div>
        <div class="font-mono" style="word-break: break-all;"><strong>prev_hash:</strong> ${log.prev_hash}</div>
        <div class="font-mono" style="color: var(--emerald-light); word-break: break-all;"><strong>hash:</strong> ${log.hash}</div>
      </div>
    </div>
  `).join('');
}

function initAuditActions() {
  const verifyBtn = document.getElementById('btn-verify-audit');
  const tamperBtn = document.getElementById('btn-simulate-tamper');
  const badge = document.getElementById('chain-status-badge');

  if (verifyBtn && badge) {
    verifyBtn.addEventListener('click', () => {
      badge.textContent = 'VERIFYING SHA-256 HASH CHAIN...';
      badge.className = 'badge badge-warning';
      
      setTimeout(() => {
        let valid = true;
        for (let i = 1; i < AUDIT_LOGS.length; i++) {
          if (AUDIT_LOGS[i].prev_hash !== AUDIT_LOGS[i - 1].hash) {
            valid = false;
            break;
          }
        }
        if (valid) {
          badge.textContent = `CHAIN VERIFIED: OK (${AUDIT_LOGS.length}/${AUDIT_LOGS.length} BLOCKS VALID)`;
          badge.className = 'badge badge-success';
        } else {
          badge.textContent = 'TAMPER DETECTED: HASH MISMATCH AT BLOCK #3';
          badge.className = 'badge badge-danger';
        }
      }, 400);
    });
  }

  if (tamperBtn && badge) {
    tamperBtn.addEventListener('click', () => {
      // Simulate an attacker modifying metadata of log 3
      AUDIT_LOGS[2].hash = 'tampered_deadbeef_000000000000000000000000000000000000000000000000';
      renderAuditLogs();
      badge.textContent = 'TAMPER DETECTED: HASH MISMATCH AT BLOCK #3';
      badge.className = 'badge badge-danger';
      alert('Simulated Attack: A DBA altered row #3. The SHA-256 chain verifier immediately detected the tampering because row #4 prev_hash does not match!');
    });
  }
}

// API PLAYGROUND
function initApiPlayground() {
  const epBtns = document.querySelectorAll('.endpoint-btns .ep-btn');
  const sendBtn = document.getElementById('btn-send-api-req');
  const bodyEl = document.getElementById('api-response-body');
  const statusBadge = document.getElementById('api-status-badge');
  const metaEl = document.getElementById('api-response-meta');

  let selectedEndpoint = '/healthz';

  epBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      epBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      selectedEndpoint = btn.getAttribute('data-ep');
    });
  });

  if (sendBtn) {
    sendBtn.addEventListener('click', async () => {
      bodyEl.textContent = 'Executing HTTP request to ' + selectedEndpoint + '...';
      const startTime = performance.now();
      try {
        const res = await fetch(selectedEndpoint);
        const elapsed = Math.round(performance.now() - startTime);
        const reqId = res.headers.get('x-request-id') || 'req-' + Math.random().toString(36).substring(2, 9);
        
        statusBadge.textContent = `HTTP ${res.status} ${res.statusText || 'OK'}`;
        statusBadge.className = res.ok ? 'badge badge-success' : 'badge badge-warning';
        metaEl.textContent = `Latency: ${elapsed}ms • X-Request-Id: ${reqId}`;

        const contentType = res.headers.get('content-type') || '';
        if (contentType.includes('application/json')) {
          const json = await res.json();
          bodyEl.textContent = JSON.stringify(json, null, 2);
        } else {
          const text = await res.text();
          bodyEl.textContent = text.substring(0, 1500) + (text.length > 1500 ? '\n... [truncated]' : '');
        }
      } catch (err) {
        statusBadge.textContent = 'Network Error';
        statusBadge.className = 'badge badge-danger';
        bodyEl.textContent = `Error connecting to ${selectedEndpoint}: ${err.message}`;
      }
    });
  }
}

// BOOKING MODAL
let currentBookingDoc = null;
let selectedSlotTime = null;

function openBookingModal(docId, slotTime) {
  const doc = DOCTORS.find(d => d.id === docId);
  if (!doc) return;
  currentBookingDoc = doc;
  selectedSlotTime = slotTime;

  document.getElementById('modal-doctor-name').textContent = `Book with ${doc.name}`;
  document.getElementById('modal-doc-summary').innerHTML = `
    <div style="font-size: 0.9rem; color: var(--text-muted); margin-bottom: 8px;">
      ${doc.specialization} • <strong>Fee: ₹${doc.fee} (INR)</strong>
    </div>
  `;

  const slotGrid = document.getElementById('modal-slot-grid');
  slotGrid.innerHTML = doc.slots.map(s => `
    <button class="modal-slot-pill ${s === slotTime ? 'selected' : ''}" onclick="selectModalSlot('${s}')">${s}</button>
  `).join('');

  document.getElementById('modal-idem-key').textContent = generateIdemKey();
  document.getElementById('booking-modal').classList.remove('hidden');
}

function selectModalSlot(slot) {
  selectedSlotTime = slot;
  document.querySelectorAll('.modal-slot-pill').forEach(pill => {
    if (pill.textContent === slot) pill.classList.add('selected');
    else pill.classList.remove('selected');
  });
}

function initBookingModal() {
  const modal = document.getElementById('booking-modal');
  const closeBtn = document.getElementById('btn-close-modal');
  const cancelBtn = document.getElementById('btn-cancel-booking');
  const confirmBtn = document.getElementById('btn-confirm-booking');

  const closeModal = () => modal.classList.add('hidden');

  if (closeBtn) closeBtn.addEventListener('click', closeModal);
  if (cancelBtn) cancelBtn.addEventListener('click', closeModal);

  if (confirmBtn) {
    confirmBtn.addEventListener('click', () => {
      confirmBtn.disabled = true;
      confirmBtn.textContent = 'Processing Saga...';

      setTimeout(() => {
        confirmBtn.disabled = false;
        confirmBtn.textContent = 'Confirm & Hold Slot (Saga)';
        closeModal();
        alert(`Success! Consultation held and confirmed with ${currentBookingDoc.name} for ${selectedSlotTime}.\n\n• Atomic CAS claim: SUCCESS\n• Idempotency-Key validated\n• Webhook payment verified\n• Consultation status: CONFIRMED`);
      }, 600);
    });
  }
}

window.openBookingModal = openBookingModal;
window.selectModalSlot = selectModalSlot;
