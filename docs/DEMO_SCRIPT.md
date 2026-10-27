<div align="center">

# Amrutam
### 5-Minute Technical Evaluation & Demo Walkthrough Script
**Step-by-Step Guide for Evaluators & Video Demonstration Recording**

[![Demo Duration](https://img.shields.io/badge/Duration-05%3A00%20Minutes-2563eb?style=for-the-badge)](docs/DEMO_SCRIPT.md)
[![Setup Effort](https://img.shields.io/badge/Setup-One--Command%20Docker-059669?style=for-the-badge)](docs/DEMO_SCRIPT.md)
[![Test Suite](https://img.shields.io/badge/Test%20Suite-71%20Tests%20Passing-7c3aed?style=for-the-badge)](docs/DEMO_SCRIPT.md)
[![Coverage](https://img.shields.io/badge/Scope-Full%20Saga%20%2B%20Chaos-0891b2?style=for-the-badge)](docs/DEMO_SCRIPT.md)

**Evaluator Objective:** Demonstrate race-free booking saga, AES-256-GCM PHI encryption, TOTP MFA, tamper-evident audit logs, and distributed observability within 5 minutes.

</div>

---

## Contents
- [01 — Pre-Demo Preparation & Environment Setup](#01--pre-demo-preparation--environment-setup)
- [02 — 5-Minute Evaluation Timeline](#02--5-minute-evaluation-timeline)
- [03 — Step-by-Step Demonstration Walkthrough](#03--step-by-step-demonstration-walkthrough)
- [04 — Quick Evaluation Verification Commands](#04--quick-evaluation-verification-commands)

---

## 01 — Pre-Demo Preparation & Environment Setup

> **Preparation Time:** ~2 minutes before starting the recording.

### 1. Launch All Services (One Command)
```bash
docker compose up -d --build
docker compose exec api node scripts/seed.js
```

### 2. Pre-Open Browser Tabs
Arrange your browser windows side-by-side or in tabs:
- **Interactive Web Portal:** `http://localhost:8080/`
- **Swagger OpenAPI Documentation:** `http://localhost:8080/docs`
- **Grafana Observability Dashboard:** `http://localhost:3000` *(admin/admin)*
- **Jaeger Distributed Tracing:** `http://localhost:16686`

---

## 02 — 5-Minute Evaluation Timeline

| Timestamp | Phase | What to Show on Screen | What to Say / Architectural Highlight |
|:---:|---|---|---|
| **0:00 – 0:30** | **System Architecture** | `docs/ARCHITECTURE.md` + Infographic | "Amrutam is a production-grade telemedicine backend engineered for 100k daily consultations. Built as a modular monolith with pure dependency injection, PostgreSQL source-of-truth, and best-effort Redis caching." |
| **0:30 – 1:15** | **Auth, Roles & MFA** | Swagger `/auth/register` & `/auth/login` | "Patients authenticate via JWT. Privileged doctor and admin roles mandate TOTP MFA (RFC 6238). Notice the `mfaEnrollmentRequired` challenge preventing unauthorized access until TOTP is verified." |
| **1:15 – 1:45** | **Doctor Catalog & Search** | Web Portal or `GET /doctors` | "Doctors are unlisted until verified by an admin. Search uses PostgreSQL Trigram and GIN indexing with keyset pagination and single-flight Redis cache stampede protection." |
| **1:45 – 2:15** | **Slot Availability & Overlaps** | `POST /doctors/me/slots` | "Doctors publish availability slots. PostgreSQL exclusion constraints (`EXCLUDE USING gist`) physically prevent overlapping slots, throwing an instant 409 Conflict if an overlap is attempted." |
| **2:15 – 3:00** | **Race-Free Booking Saga** | Web Portal Booking Modal or curl | "When booking, the atomic compare-and-set claims the slot and initiates a 10-minute hold window. Replaying the same `Idempotency-Key` returns `Idempotent-Replayed: true` without double charging." |
| **3:00 – 3:30** | **Payment Webhook & Deduplication** | `node scripts/simulate-webhook.js` | "Payment webhooks are HMAC-signed and verified. The handler deduplicates events via `payment_events(event_id)`, transitioning the consultation to `CONFIRMED` and slot to `BOOKED`." |
| **3:30 – 4:00** | **Prescription & AES-256-GCM** | Web Portal "🔒 Decrypt PHI" button | "Prescriptions are encrypted at rest using AES-256-GCM with row-bound AAD. Admins cannot see PHI. Only the consulting doctor and patient hold access to decrypted clinical formulations." |
| **4:00 – 4:30** | **Tamper-Evident Audit Chain** | Web Portal Security Tab or `/verify` | "All system events are recorded in an append-only, SHA-256 linear hash-chained audit log. Simulating a database-level edit immediately triggers a cryptographic hash mismatch alert." |
| **4:30 – 5:00** | **Observability & Test Suite** | Grafana, Jaeger, and terminal `npm test` | "Live RED metrics in Prometheus, SLO burn-rate alerts, OpenTelemetry distributed traces in Jaeger, and a comprehensive 71-test CI suite covering concurrency and security." |

---

## 03 — Step-by-Step Demonstration Walkthrough

### Phase 1: Architecture & Engineering Overview (0:00 – 0:30)
- **Visual:** Display [`docs/ARCHITECTURE.md`](ARCHITECTURE.md) and the system architecture diagram.
- **Script:** *"Amrutam is designed for 100k daily consultations with sub-200ms read and sub-500ms write p95 latencies. The architecture follows a modular monolith pattern with explicit constructor dependency injection in `src/container.js`. PostgreSQL is our authoritative source of truth, while Redis handles caching and async worker queues."*

---

### Phase 2: User Lifecycle & Mandatory Doctor TOTP MFA (0:30 – 1:15)
- **Visual:** In Swagger UI (`http://localhost:8080/docs`) or Terminal:
  ```bash
  # Attempt login with seeded doctor credentials
  curl -s -X POST http://localhost:8080/api/v1/auth/login \
    -H "Content-Type: application/json" \
    -d '{"email":"doctor@amrutam.co.in","password":"ChangeMe-Str0ng-Pass"}' | jq
  ```
- **Result:** Response returns `{ "mfaRequired": true, "challengeToken": "..." }`.
- **Script:** *"Notice that privileged doctor and admin accounts are strictly barred from receiving an active session until two-factor authentication is satisfied. The TOTP secret is stored encrypted at rest, and refresh tokens feature family reuse detection."*

---

### Phase 3: Verified Doctor Catalog & Keyset Search (1:15 – 1:45)
- **Visual:** Open Web Portal at `http://localhost:8080/` under **Find Doctors**.
- **Action:** Type "Ayurveda" into the search bar, filter by "Panchakarma", and observe instant filtered results.
- **Script:** *"Doctors must undergo administrative verification before appearing in catalog searches. The search engine leverages PostgreSQL GIN and Trigram indexes with versioned Redis invalidation (`bump('search')`), completely avoiding slow key scans."*

---

### Phase 4: Availability Slots & Overlap Prevention (1:45 – 2:15)
- **Visual:** Show doctor availability slots on doctor cards.
- **Script:** *"Availability slots are governed by PostgreSQL range exclusion constraints. If a doctor attempts to publish overlapping appointment windows, the database engine enforces physical exclusion, returning an HTTP 409 Conflict."*

---

### Phase 5: Race-Free Booking Saga & Idempotency (2:15 – 3:00)
- **Visual:** Click **"Book Appointment"** on Dr. Asha Verma's card. Enter symptoms and click **"Confirm & Hold Slot (Saga)"**.
- **Action:** In terminal, demonstrate replay protection:
  ```bash
  IDEM_KEY=$(uuidgen)
  # First write attempt: Holds slot & returns 201 Created
  curl -i -X POST http://localhost:8080/api/v1/consultations \
    -H "Authorization: Bearer $TOKEN" \
    -H "Idempotency-Key: $IDEM_KEY" \
    -H "Content-Type: application/json" \
    -d '{"slotId":"slot-1030","reason":"Chronic migraine"}'
  
  # Replay same Idempotency-Key: Returns identical result with replay header
  curl -i -X POST http://localhost:8080/api/v1/consultations \
    -H "Authorization: Bearer $TOKEN" \
    -H "Idempotency-Key: $IDEM_KEY" \
    -H "Content-Type: application/json" \
    -d '{"slotId":"slot-1030","reason":"Chronic migraine"}'
  ```
- **Script:** *"Our booking flow uses a distributed saga. Notice the `Idempotent-Replayed: true` header on the second call. If two patients attempt to book the same slot simultaneously, only one succeeds; the second receives a clean 409 Conflict."*

---

### Phase 6: Payment Webhook & Exactly-Once Processing (3:00 – 3:30)
- **Visual:** Run the webhook simulation script:
  ```bash
  node scripts/simulate-webhook.js pay_mock_98214 succeeded
  ```
- **Script:** *"The payment gateway calls back via HMAC-SHA256 signed webhooks. The handler validates the signature and deduplicates the transaction against `payment_events(event_id)`, atomically transitioning the consultation to `CONFIRMED`."*

---

### Phase 7: Encrypted Prescriptions & PHI Decryption (3:30 – 4:00)
- **Visual:** Navigate to the **Consultations & Rx** tab on the Web Portal.
- **Action:** Point out the PostgreSQL encrypted ciphertext `enc:v1:aes-256-gcm:...`. Click **"🔒 Decrypt PHI"** to reveal the clinical prescription and herbal formulations.
- **Script:** *"Medical data is protected using AES-256-GCM authenticated encryption. Notice the row-level AAD tag preventing swap attacks. Administrators have zero access to PHI, satisfying strict HIPAA and DPDP compliance requirements."*

---

### Phase 8: Tamper-Evident SHA-256 Audit Trail (4:00 – 4:30)
- **Visual:** Navigate to the **Security & Audit** tab.
- **Action:** Click **"✓ Verify SHA-256 Chain"** (shows 100% integrity). Next, click **"⚠ Simulate Tampering Test"** to show instant detection of modified records.
- **Script:** *"Every security event is anchored in a linear cryptographic hash chain. Database triggers prohibit `UPDATE` and `DELETE`. When an unauthorized database edit occurs, our audit verifier immediately pinpoints the exact tampered block."*

---

### Phase 9: Observability, Alerts & Automated CI (4:30 – 5:00)
- **Visual:** 
  1. Show **Grafana** dashboard (`http://localhost:3000`) with latency percentiles and RED metrics.
  2. Show **Jaeger** UI (`http://localhost:16686`) displaying a distributed trace across HTTP, PostgreSQL, and Redis.
  3. Run the automated test suite in terminal:
     ```bash
     npm run test:unit
     ```
- **Script:** *"Full observability is built-in with Prometheus metrics, Jaeger distributed tracing, and SLO burn-rate alerts. The test suite validates concurrent booking races, cryptography, and saga compensations. Amrutam is completely production-ready."*

---

## 04 — Quick Evaluation Verification Commands

```bash
# 1. Verify unit tests pass
npm run test:unit

# 2. Verify online key rotation script
npm run rotate-keys -- --check

# 3. Verify health probe
curl -s http://localhost:8080/healthz | jq

# 4. View raw Prometheus metrics
curl -s http://localhost:8080/metrics | head -n 25
```

---

<div align="center">

### Demonstration Standard

**Excellence through Transparency · Verifiable Invariants · Production Readiness**

*Amrutam Telemedicine Backend · Technical Demonstration Guide*

</div>
