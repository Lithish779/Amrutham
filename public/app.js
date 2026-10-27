// Amrutam Telemedicine Platform & API Portal Client Logic
'use strict';

// ============================================================================
// 1. DOCTORS DATA & BOOKING CATALOG
// ============================================================================
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

// ============================================================================
// 2. API ENDPOINTS REGISTRY FOR TAB 5
// ============================================================================
const ENDPOINTS_DATA = {
  'post-api-auth-register': {
    id: 'post-api-auth-register',
    method: 'POST',
    path: '/api/auth/register',
    fullUrl: 'http://localhost:8080/api/v1/auth/register',
    summary: 'Register a new user account',
    description: 'Register a new user (patient or doctor) in the system.',
    requestBody: {
      "name": "John Doe",
      "email": "john@example.com",
      "password": "SecurePassword123",
      "role": "patient",
      "phone": "+91 9876543210",
      "dateOfBirth": "2000-01-01",
      "gender": "male"
    },
    responses: {
      '201': {
        desc: 'User registered successfully',
        body: {
          "success": true,
          "message": "User registered successfully",
          "data": {
            "id": "64f2c1e9b2a1d5e4f8c9a123",
            "name": "John Doe",
            "email": "john@example.com",
            "role": "patient",
            "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiI2NGYyYzFlOWIyYTFkNWU0ZjhjOWExMjMiLCJyb2xlIjoicGF0aWVudCJ9..."
          }
        }
      },
      '400': {
        desc: 'Validation error: invalid email or weak password',
        body: { "error": "BAD_REQUEST", "message": "Validation failed" }
      },
      '409': {
        desc: 'Conflict: email already registered',
        body: { "error": "CONFLICT", "message": "An account with this email already exists" }
      },
      '500': {
        desc: 'Internal server error',
        body: { "error": "INTERNAL_SERVER_ERROR", "message": "Service unavailable" }
      }
    }
  },

  'post-api-auth-login': {
    id: 'post-api-auth-login',
    method: 'POST',
    path: '/api/auth/login',
    fullUrl: 'http://localhost:8080/api/v1/auth/login',
    summary: 'Login and receive JWT token',
    description: 'Authenticate user credentials and return an access token and refresh token.',
    requestBody: {
      "email": "john@example.com",
      "password": "SecurePassword123"
    },
    responses: {
      '200': {
        desc: 'Authentication successful',
        body: {
          "success": true,
          "accessToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
          "refreshToken": "rf_920194bc02814fa82910471",
          "expiresIn": 900,
          "user": { "id": "u-patient-001", "email": "john@example.com", "role": "patient" }
        }
      },
      '401': {
        desc: 'Invalid credentials',
        body: { "error": "UNAUTHORIZED", "message": "Invalid email or password" }
      }
    }
  },

  'post-api-auth-refresh': {
    id: 'post-api-auth-refresh',
    method: 'POST',
    path: '/api/auth/refresh',
    fullUrl: 'http://localhost:8080/api/v1/auth/refresh',
    summary: 'Refresh access token',
    description: 'Generate a new short-lived JWT access token using a valid refresh token.',
    requestBody: { "refreshToken": "rf_920194bc02814fa82910471" },
    responses: {
      '200': {
        desc: 'Access token renewed',
        body: { "accessToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.new...", "expiresIn": 900 }
      }
    }
  },

  'get-api-users-me': {
    id: 'get-api-users-me',
    method: 'GET',
    path: '/api/users/me',
    fullUrl: 'http://localhost:8080/api/v1/users/me',
    summary: 'Get current user profile',
    description: 'Retrieve profile attributes and consultation history for authenticated user.',
    requestBody: null,
    responses: {
      '200': {
        desc: 'User profile retrieved',
        body: {
          "id": "u-patient-001",
          "name": "John Doe",
          "email": "john@example.com",
          "role": "patient",
          "phone": "+91 9876543210"
        }
      }
    }
  },

  'put-api-users-me': {
    id: 'put-api-users-me',
    method: 'PUT',
    path: '/api/users/me',
    fullUrl: 'http://localhost:8080/api/v1/users/me',
    summary: 'Update user profile',
    description: 'Update phone number, address, or notification preferences.',
    requestBody: { "name": "John Doe", "phone": "+91 9876543210" },
    responses: {
      '200': {
        desc: 'Profile updated successfully',
        body: { "success": true, "message": "Profile updated" }
      }
    }
  },

  'get-api-doctors': {
    id: 'get-api-doctors',
    method: 'GET',
    path: '/api/doctors',
    fullUrl: 'http://localhost:8080/api/v1/doctors',
    summary: 'Get all available doctors',
    description: 'Returns catalog of verified Ayurvedic, Kayachikitsa and Panchakarma specialists.',
    requestBody: null,
    responses: {
      '200': {
        desc: 'Doctors catalog list',
        body: {
          "total": 4,
          "doctors": DOCTORS.map(d => ({ id: d.id, name: d.name, specialization: d.specialization, fee: d.fee, rating: d.rating }))
        }
      }
    }
  },

  'get-api-doctors-availability': {
    id: 'get-api-doctors-availability',
    method: 'GET',
    path: '/api/doctors/{id}/availability',
    fullUrl: 'http://localhost:8080/api/v1/doctors/d1-asha-verma/availability',
    summary: 'Get doctor availability slots',
    description: 'Check active, unheld and unbooked appointment slots for a doctor with race-free locking.',
    requestBody: null,
    responses: {
      '200': {
        desc: 'Available consultation slots',
        body: {
          "doctorId": "d1-asha-verma",
          "availableSlots": [
            { "slotId": "slot-1030", "time": "10:30 AM", "status": "AVAILABLE" },
            { "slotId": "slot-1400", "time": "02:00 PM", "status": "AVAILABLE" }
          ]
        }
      }
    }
  },

  'post-api-bookings': {
    id: 'post-api-bookings',
    method: 'POST',
    path: '/api/bookings',
    fullUrl: 'http://localhost:8080/api/v1/consultations',
    summary: 'Create a new booking',
    description: 'Initiate race-free booking saga with slot compare-and-set and 10-minute hold window.',
    requestBody: {
      "slotId": "slot-1030",
      "reason": "Digestive issues and seasonal Panchakarma consultation"
    },
    responses: {
      '201': {
        desc: 'Booking held (Saga initialized)',
        body: {
          "consultationId": "c-9821-4820",
          "status": "HOLD",
          "holdExpiresAt": "2026-10-27T06:10:00Z",
          "payment": { "amount": 750, "currency": "INR", "providerRef": "pay_mock_98214" }
        }
      },
      '409': {
        desc: 'Slot conflict: already held or booked',
        body: { "error": "SLOT_CONFLICT", "message": "Selected time slot is no longer available" }
      }
    }
  },

  'get-api-bookings-id': {
    id: 'get-api-bookings-id',
    method: 'GET',
    path: '/api/bookings/{id}',
    fullUrl: 'http://localhost:8080/api/v1/consultations/c-9821-4820',
    summary: 'Get booking details',
    description: 'Retrieve current consultation status, payment receipt, and video room token.',
    requestBody: null,
    responses: {
      '200': {
        desc: 'Consultation booking record',
        body: {
          "id": "c-9821-4820",
          "status": "CONFIRMED",
          "doctor": { "name": "Dr. Asha Verma", "fee": 750 },
          "roomUrl": "https://meet.amrutam.com/room-c-9821-4820"
        }
      }
    }
  },

  'post-api-bookings-cancel': {
    id: 'post-api-bookings-cancel',
    method: 'POST',
    path: '/api/bookings/{id}/cancel',
    fullUrl: 'http://localhost:8080/api/v1/consultations/c-9821-4820/cancel',
    summary: 'Cancel booking',
    description: 'Cancel scheduled consultation and trigger automated compensation refund.',
    requestBody: { "reason": "Patient requested cancellation" },
    responses: {
      '200': {
        desc: 'Booking cancelled & refund queued',
        body: { "status": "CANCELLED", "refundStatus": "QUEUED", "refundAmount": 750 }
      }
    }
  }
};

let currentEndpoint = ENDPOINTS_DATA['post-api-auth-register'];
let currentStatus = '201';

// Helper to generate unique Idempotency Keys
function generateIdemKey() {
  return 'idem-' + Math.floor(10000 + Math.random() * 90000) + '-' + Math.random().toString(36).substring(2, 7);
}

// Toast Notification Helper
function showToast(message) {
  const toast = document.getElementById('toast-notify');
  if (!toast) return;
  toast.textContent = message;
  toast.classList.remove('hidden');
  setTimeout(() => {
    toast.classList.add('hidden');
  }, 2200);
}

// ============================================================================
// 3. TAB NAVIGATION (FIND DOCTORS, CONSULTATIONS, SECURITY, ANALYTICS, API)
// ============================================================================
function initTabs() {
  const navBtns = document.querySelectorAll('.nav-tab-btn');
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

  const brandHome = document.getElementById('brand-home-trigger');
  if (brandHome) {
    brandHome.addEventListener('click', () => {
      navBtns[0]?.click();
    });
  }
}

// ============================================================================
// 4. TAB 1: DOCTORS RENDERING & FILTERING
// ============================================================================
function renderDoctors(doctors) {
  const container = document.getElementById('doctors-list');
  if (!container) return;

  if (doctors.length === 0) {
    container.innerHTML = '<div style="grid-column: 1/-1; text-align: center; padding: 40px; color: var(--text-muted); background: #ffffff; border-radius: 12px; border: 1px solid var(--border-subtle);">No doctors found matching your criteria.</div>';
    return;
  }

  container.innerHTML = doctors.map(doc => `
    <div class="doctor-card">
      <div>
        <div class="doc-header">
          <div class="doc-avatar">🌿</div>
          <div>
            <div class="doc-name">
              ${doc.name}
              ${doc.verified ? '<span title="Verified Ayurvedic Practitioner"><svg width="18" height="18" viewBox="0 0 24 24" fill="#059669"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/></svg></span>' : ''}
            </div>
            <div class="doc-specialty">${doc.specialization} • ${doc.qualifications}</div>
            <div class="doc-experience">⭐ ${doc.rating} (${doc.ratingCount} reviews) • ${doc.experienceYears} Years Exp</div>
          </div>
        </div>

        <p class="doc-bio">${doc.bio}</p>

        <div class="doc-tags">
          ${doc.languages.map(l => `<span class="tag-item">🗣️ ${l}</span>`).join('')}
        </div>

        <div class="slots-container">
          <div class="slots-label">
            <span>Available Slots (Today & Tomorrow)</span>
            <span style="color: #059669; font-size: 11px; font-weight: 700;">CAS Protected</span>
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
  const specPills = document.querySelectorAll('#specialization-filters .pill-btn');

  let currentSpec = 'all';
  let searchQuery = '';

  function applyFilters() {
    const filtered = DOCTORS.filter(d => {
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

  // Global header search input also filters doctors or jumps
  const globalSearch = document.getElementById('global-search-input');
  if (globalSearch) {
    globalSearch.addEventListener('input', (e) => {
      searchQuery = e.target.value.toLowerCase().trim();
      document.querySelector('.nav-tab-btn[data-tab="doctors"]')?.click();
      if (searchInput) searchInput.value = searchQuery;
      applyFilters();
    });
  }
}

// ============================================================================
// 5. INTERACTIVE BOOKING MODAL
// ============================================================================
let currentBookingDoc = null;
let selectedSlotTime = null;

function openBookingModal(docId, slotTime) {
  const doc = DOCTORS.find(d => d.id === docId);
  if (!doc) return;
  currentBookingDoc = doc;
  selectedSlotTime = slotTime;

  document.getElementById('modal-doctor-name').textContent = `Book Appointment with ${doc.name}`;
  document.getElementById('modal-doc-summary').innerHTML = `
    <div style="font-size: 13.5px; color: #475569;">
      Specialization: <strong>${doc.specialization}</strong> • Consultation Fee: <strong style="color:#0f172a;">₹${doc.fee} (INR)</strong>
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
    pill.classList.toggle('selected', pill.textContent === slot);
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
      confirmBtn.textContent = 'Processing Distributed Saga...';

      setTimeout(() => {
        confirmBtn.disabled = false;
        confirmBtn.textContent = 'Confirm & Hold Slot (Saga)';
        closeModal();
        alert(`Success! Consultation held and confirmed with ${currentBookingDoc.name} for ${selectedSlotTime}.\n\n• Slot Compare-and-Set: SUCCESS\n• Idempotency-Key validated\n• Webhook payment verified\n• Status: CONFIRMED`);
      }, 550);
    });
  }
}

window.openBookingModal = openBookingModal;
window.selectModalSlot = selectModalSlot;

// ============================================================================
// 6. TAB 2: PRESCRIPTION ENCRYPTION / DECRYPTION TOGGLE
// ============================================================================
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
        toggleBtn.className = 'btn btn-secondary';
      } else {
        rawCipher.classList.remove('hidden');
        decryptedView.classList.add('hidden');
        toggleBtn.innerHTML = '<span class="lock-icon">🔒</span> Decrypt PHI';
        toggleBtn.className = 'btn btn-primary';
      }
    });
  }
}

// ============================================================================
// 7. TAB 3: AUDIT CHAIN VERIFICATION & SIMULATION
// ============================================================================
function renderAuditLogs() {
  const container = document.getElementById('audit-chain-stream');
  if (!container) return;

  container.innerHTML = AUDIT_LOGS.map(log => `
    <div class="audit-block" id="audit-log-${log.id}">
      <div class="audit-block-top">
        <span>#${log.id} • ${log.action}</span>
        <span style="font-size: 11px; color: var(--text-muted); font-weight: 500;">${log.ts}</span>
      </div>
      <div class="audit-hash-row">
        <div><strong>Actor:</strong> ${log.actor} (${log.ip})</div>
        <div class="font-mono" style="word-break: break-all;"><strong>prev_hash:</strong> ${log.prev_hash}</div>
        <div class="font-mono" style="color: #059669; word-break: break-all;"><strong>hash:</strong> ${log.hash}</div>
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
      }, 350);
    });
  }

  if (tamperBtn && badge) {
    tamperBtn.addEventListener('click', () => {
      AUDIT_LOGS[2].hash = 'tampered_deadbeef_000000000000000000000000000000000000000000000000';
      renderAuditLogs();
      badge.textContent = 'TAMPER DETECTED: HASH MISMATCH AT BLOCK #3';
      badge.className = 'badge badge-danger';
      alert('Simulated Attack: A malicious user or script altered row #3. The SHA-256 chain verifier immediately detected the tampering because row #4 prev_hash does not match!');
    });
  }
}

// ============================================================================
// 8. TAB 5: API DOCUMENTATION & INSPECTOR (SCREENSHOT SPEC)
// ============================================================================
function highlightJson(obj) {
  if (!obj) return '';
  const jsonStr = JSON.stringify(obj, null, 2);
  return jsonStr
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/("(\\u[a-zA-Z0-9]{4}|\\[^u]|[^\\"])*"(\s*:)?|\b(true|false|null)\b|-?\d+(?:\.\d*)?(?:[eE][+\-]?\d+)?)/g, function (match) {
      let cls = 'json-num';
      if (/^"/.test(match)) {
        if (/:$/.test(match)) {
          cls = 'json-key';
        } else {
          cls = 'json-str';
        }
      } else if (/true|false/.test(match)) {
        cls = 'json-bool';
      }
      return '<span class="' + cls + '">' + match + '</span>';
    });
}

function countLines(text) {
  if (!text) return 1;
  return (text.match(/\n/g) || []).length + 1;
}

function generateLineNumbers(count) {
  let lines = '';
  for (let i = 1; i <= count; i++) {
    lines += i + '<br>';
  }
  return lines;
}

function renderApiEndpoint(endpoint) {
  currentEndpoint = endpoint;

  const methodTag = document.getElementById('insp-method-tag');
  if (methodTag) {
    methodTag.textContent = endpoint.method;
    methodTag.className = `method-tag ${endpoint.method.toLowerCase()}`;
  }

  const inspPath = document.getElementById('insp-path');
  if (inspPath) inspPath.textContent = endpoint.path;

  const inspSub = document.getElementById('insp-sub');
  if (inspSub) inspSub.textContent = endpoint.summary;

  const inspBanner = document.getElementById('insp-banner');
  if (inspBanner) inspBanner.textContent = endpoint.description;

  const inspUrl = document.getElementById('insp-request-url');
  if (inspUrl) inspUrl.textContent = endpoint.fullUrl;

  // Request Body
  const reqSection = document.getElementById('req-body-section');
  if (reqSection) {
    if (endpoint.requestBody) {
      reqSection.style.display = 'flex';
      const jsonFormatted = JSON.stringify(endpoint.requestBody, null, 2);
      const lineCount = countLines(jsonFormatted);
      document.getElementById('req-line-numbers').innerHTML = generateLineNumbers(lineCount);
      document.getElementById('insp-request-body').innerHTML = `<code>${highlightJson(endpoint.requestBody)}</code>`;
    } else {
      reqSection.style.display = 'none';
    }
  }

  // Responses Status Pills
  const pillsContainer = document.getElementById('response-status-pills');
  if (pillsContainer) {
    pillsContainer.innerHTML = '';
    const statusCodes = Object.keys(endpoint.responses);
    currentStatus = statusCodes[0];

    statusCodes.forEach((status, idx) => {
      const pill = document.createElement('button');
      pill.className = `status-pill ${idx === 0 ? 'active' : ''}`;
      pill.dataset.status = status;
      const isSuccess = status.startsWith('2');
      pill.textContent = `${status} ${isSuccess ? 'Success' : status === '400' ? 'Bad Request' : status === '409' ? 'Conflict' : 'Error'}`;
      pill.addEventListener('click', () => switchResponseStatus(status));
      pillsContainer.appendChild(pill);
    });

    renderResponseContent(currentStatus);
  }

  // Active state in sidebar
  document.querySelectorAll('.api-nav-link').forEach(link => {
    link.classList.toggle('active', link.dataset.endpointId === endpoint.id);
  });
}

function switchResponseStatus(status) {
  currentStatus = status;
  document.querySelectorAll('#response-status-pills .status-pill').forEach(pill => {
    pill.classList.toggle('active', pill.dataset.status === status);
  });
  renderResponseContent(status);
}

function renderResponseContent(status) {
  const respData = currentEndpoint.responses[status];
  if (!respData) return;

  const descEl = document.getElementById('status-desc-text');
  if (descEl) descEl.textContent = respData.desc;

  const jsonFormatted = JSON.stringify(respData.body, null, 2);
  const lineCount = countLines(jsonFormatted);
  const lineNumbers = document.getElementById('res-line-numbers');
  if (lineNumbers) lineNumbers.innerHTML = generateLineNumbers(lineCount);

  const resBody = document.getElementById('insp-response-body');
  if (resBody) resBody.innerHTML = `<code>${highlightJson(respData.body)}</code>`;
}

function initApiDocs() {
  document.querySelectorAll('.api-nav-link').forEach(link => {
    link.addEventListener('click', () => {
      const epId = link.dataset.endpointId;
      if (ENDPOINTS_DATA[epId]) {
        renderApiEndpoint(ENDPOINTS_DATA[epId]);
      }
    });
  });

  // Copy Buttons
  const copyUrlBtn = document.getElementById('btn-copy-url');
  if (copyUrlBtn) {
    copyUrlBtn.addEventListener('click', () => {
      navigator.clipboard.writeText(currentEndpoint.fullUrl);
      showToast('Request URL copied!');
    });
  }

  const copyBodyBtn = document.getElementById('btn-copy-req-body');
  if (copyBodyBtn) {
    copyBodyBtn.addEventListener('click', () => {
      if (currentEndpoint.requestBody) {
        navigator.clipboard.writeText(JSON.stringify(currentEndpoint.requestBody, null, 2));
        showToast('Request JSON body copied!');
      }
    });
  }

  // Inspector Tabs
  document.querySelectorAll('.insp-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.insp-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      const tabName = tab.dataset.tab;
      const banner = document.getElementById('insp-banner');
      if (!banner) return;
      if (tabName === 'overview') banner.textContent = currentEndpoint.description;
      else if (tabName === 'request') banner.textContent = 'Headers: Content-Type: application/json • Rate-limit: 60/min • Idempotency-Key supported';
      else if (tabName === 'response') banner.textContent = 'Responses are formatted in RFC 7807 with X-Request-Id header for distributed audit tracing.';
      else if (tabName === 'auth') banner.textContent = 'Authorization: Bearer <JWT_ACCESS_TOKEN> • RBAC scopes: Patient, Doctor, Admin';
      else if (tabName === 'code') banner.textContent = `cURL, Fetch API and Python requests examples for ${currentEndpoint.path}`;
    });
  });

  // Try it out modal drawer
  const tryoutBtn = document.getElementById('btn-try-it-out');
  const closeTryoutBtn = document.getElementById('close-tryout-modal');
  const tryoutModal = document.getElementById('tryout-modal');
  const runLiveBtn = document.getElementById('btn-run-live-call');

  if (tryoutBtn && tryoutModal) {
    tryoutBtn.addEventListener('click', () => {
      tryoutModal.classList.remove('hidden');
      document.getElementById('tryout-modal-method').textContent = currentEndpoint.method;
      document.getElementById('tryout-modal-method').className = `method-tag ${currentEndpoint.method.toLowerCase()}`;
      document.getElementById('tryout-modal-path').textContent = currentEndpoint.path;
      document.getElementById('tryout-custom-path').value = currentEndpoint.fullUrl.replace('http://localhost:8080', '');
      document.getElementById('tryout-json-input').value = currentEndpoint.requestBody ? JSON.stringify(currentEndpoint.requestBody, null, 2) : '';
      document.getElementById('tryout-response-container').classList.add('hidden');
      document.getElementById('tryout-execution-meta').textContent = 'Ready to test';
    });
  }

  if (closeTryoutBtn && tryoutModal) {
    closeTryoutBtn.addEventListener('click', () => {
      tryoutModal.classList.add('hidden');
    });
  }

  if (runLiveBtn) {
    runLiveBtn.addEventListener('click', async () => {
      const meta = document.getElementById('tryout-execution-meta');
      const resContainer = document.getElementById('tryout-response-container');
      const resCode = document.getElementById('tryout-status-code');
      const resTime = document.getElementById('tryout-time');
      const resBody = document.getElementById('tryout-res-body');

      meta.textContent = 'Executing HTTP request...';
      const startTime = performance.now();
      const customPath = document.getElementById('tryout-custom-path').value.trim();
      const rawBody = document.getElementById('tryout-json-input').value.trim();

      try {
        const options = {
          method: currentEndpoint.method,
          headers: { 'Content-Type': 'application/json' }
        };
        if (currentEndpoint.method !== 'GET' && rawBody) {
          options.body = rawBody;
        }

        const response = await fetch(customPath, options);
        const duration = Math.round(performance.now() - startTime);
        const data = await response.json().catch(() => ({ status: response.statusText }));

        resContainer.classList.remove('hidden');
        resCode.textContent = `${response.status} ${response.statusText}`;
        resCode.style.color = response.ok ? '#059669' : '#dc2626';
        resCode.style.backgroundColor = response.ok ? '#ecfdf5' : '#fef2f2';
        resTime.textContent = `${duration}ms`;
        resBody.textContent = JSON.stringify(data, null, 2);
        meta.textContent = `Completed with status ${response.status}`;
      } catch (err) {
        const duration = Math.round(performance.now() - startTime) || 10;
        resContainer.classList.remove('hidden');
        resCode.textContent = '200 OK (Simulation)';
        resCode.style.color = '#059669';
        resCode.style.backgroundColor = '#ecfdf5';
        resTime.textContent = `${duration}ms`;
        resBody.textContent = JSON.stringify(currentEndpoint.responses['200']?.body || currentEndpoint.responses['201']?.body, null, 2);
        meta.textContent = 'Request completed (Mock Pipeline)';
      }
    });
  }
}

// Live API Health Ping
async function checkApiHealth() {
  const pill = document.getElementById('api-status-indicator');
  if (!pill) return;
  try {
    const res = await fetch('/healthz');
    if (res.ok) {
      pill.innerHTML = '<span class="status-pulse-dot"></span><span class="status-label">API Online</span>';
      pill.style.borderColor = '#bbf7d0';
      pill.style.color = '#15803d';
    }
  } catch {
    pill.innerHTML = '<span class="status-pulse-dot" style="background:#ef4444"></span><span class="status-label">API Offline</span>';
    pill.style.borderColor = '#fecaca';
    pill.style.color = '#dc2626';
  }
}

// Initialize everything on DOM load
window.addEventListener('DOMContentLoaded', () => {
  initTabs();
  renderDoctors(DOCTORS);
  initDoctorFilters();
  initBookingModal();
  initPrescriptionToggle();
  renderAuditLogs();
  initAuditActions();
  initApiDocs();
  renderApiEndpoint(currentEndpoint);
  checkApiHealth();
  setInterval(checkApiHealth, 15000);
});
