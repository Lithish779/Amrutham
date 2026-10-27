<div align="center">

# Amrutam
### Telemedicine Backend Architecture
**Scalable · Secure · Reliable · Observable**

[![Architecture Status](https://img.shields.io/badge/Architecture-Modular%20Monolith-2563eb?style=for-the-badge)](docs/ARCHITECTURE.md)
[![Availability](https://img.shields.io/badge/Availability-99.95%25-16a34a?style=for-the-badge)](docs/ARCHITECTURE.md)
[![Read Latency](https://img.shields.io/badge/p95%20Reads-%3C%20200ms-0891b2?style=for-the-badge)](docs/ARCHITECTURE.md)
[![Write Latency](https://img.shields.io/badge/p95%20Writes-%3C%20500ms-7c3aed?style=for-the-badge)](docs/ARCHITECTURE.md)

**Design goals:** 100k consultations/day · AES-256-GCM Encryption · TOTP MFA · RBAC · End-to-end Observability

<br/>

<img src="architecture-diagram.jpg" alt="Amrutam Backend System Architecture Overview" width="100%" />

</div>

---

## Contents
- [01 — Architecture at a glance](#01--architecture-at-a-glance)
- [02 — Booking flow and saga compensation](#02--booking-flow-and-saga-compensation)
- [03 — Data model](#03--data-model)
- [04 — API contract](#04--api-contract)
- [05 — Resilience and retry policy](#05--resilience-and-retry-policy)
- [06 — Data partitioning and scale](#06--data-partitioning-and-scale)
- [07 — Caching and concurrency](#07--caching-and-concurrency)
- [08 — Transactions and sagas](#08--transactions-and-sagas)
- [09 — Backup and disaster recovery](#09--backup-and-disaster-recovery)
- [10 — Observability and operations](#10--observability-and-operations)
- [Security principles](#security-principles)

---

## 01 — Architecture at a glance

> **Core decision:** PostgreSQL is the source of truth. Redis improves performance but is optional and must never be required for business correctness.

```mermaid
flowchart LR
    C["Web / Mobile clients"] -->|"HTTPS + JWT"| WAF["Load balancer / WAF"]
    PSP["Payment provider"] -->|"Signed webhook"| WAF
    WAF --> API["Stateless API pods<br/>Node.js / Express<br/>6–40 replicas"]

    API -->|"Writes + read-your-writes"| PG[("PostgreSQL primary<br/>Multi-AZ")]
    PG -. "Streaming replication" .-> RO[("Read replica<br/>Search / analytics")]
    API <--> R[("Redis<br/>Cache · rate limits · BullMQ")]
    R <--> WK["Worker pods<br/>Async jobs"]
    WK --> PG
    WK -->|"Retry + backoff + breaker"| PSP

    API --> OTEL["OpenTelemetry collector"]
    WK --> OTEL
    OTEL --> TRACE["Jaeger / Tempo"]
    API --> MET["Prometheus metrics"]
    WK --> MET
    MET --> GRAF["Grafana + Alertmanager"]
    API --> LOG["Structured JSON log pipeline"]
    WK --> LOG

    classDef client fill:#eff6ff,stroke:#60a5fa,color:#1e3a8a
    classDef api fill:#ecfdf5,stroke:#34d399,color:#065f46
    classDef data fill:#f5f3ff,stroke:#a78bfa,color:#4c1d95
    classDef ops fill:#fff7ed,stroke:#fb923c,color:#9a3412
    class C,WAF client
    class API,WK api
    class PG,RO,R data
    class OTEL,TRACE,MET,GRAF,LOG ops
```

### Component responsibilities

| Component | Responsibility | Design choice |
|---|---|---|
| **API** | Auth, doctors, consultations, prescriptions, search, admin, payments | Modular monolith with explicit dependency injection |
| **PostgreSQL** | Durable business state and invariants | Primary is authoritative; constraints enforce correctness |
| **Read replica** | Search and analytics reads | Route only replica-safe reads; preserve read-your-writes on primary |
| **Redis** | Cache, rate limits, BullMQ queue | Best-effort; degrade safely if unavailable |
| **Workers** | Refunds, notifications, hold expiry, no-show sweep, maintenance | Separate worker deployment; retries and failed-job inspection |
| **Observability** | Metrics, logs, traces, alerts | Correlate requests with `requestId` and `traceId` |

**Dependency injection:** `src/container.js` wires modules using manual constructor injection. Tests can replace the payment gateway, configuration, and other dependencies with fakes.

**Redis outage behavior:** Caching and Redis-backed rate limiting fail open gracefully; DB-driven sweepers provide a fallback for scheduled work. A separate edge/WAF protection limit prevents abuse during fail-open intervals.

---

## 02 — Booking flow and saga compensation

```mermaid
sequenceDiagram
    autonumber
    actor P as Patient
    participant A as API
    participant DB as PostgreSQL
    participant G as Payment gateway
    participant W as Worker

    P->>A: POST /api/v1/consultations + Idempotency-Key
    A->>DB: Claim scoped idempotency key
    A->>DB: TX: CAS slot AVAILABLE → HELD
    A->>DB: Insert consultation PENDING_PAYMENT + payment INITIATED
    alt Slot taken or patient overlap
        DB-->>A: Conflict / constraint violation
        A-->>P: 409 Conflict
    else Slot held
        A->>G: Create payment intent (outside DB transaction)
        alt Gateway unavailable
            A->>DB: Compensate: expire consultation, release slot, mark payment failed
            A-->>P: 503 Service Unavailable
        else Payment intent created
            A-->>P: 201 Created + clientSecret
        end
    end

    G->>A: payment.succeeded webhook
    A->>DB: TX: dedupe event, mark payment succeeded
    A->>DB: Confirm consultation and book slot
    A->>W: Enqueue notification
    Note over W,DB: Periodic sweeper expires stale holds using SKIP LOCKED

    G->>A: Late success after hold expiry
    A->>DB: Mark REFUND_PENDING
    W->>G: Idempotent refund request
    G-->>W: Refund result
    W->>DB: Mark REFUNDED
```

### Double-booking defence in depth
1. **Atomic compare-and-set:** Update a slot only when its status is `AVAILABLE`.
2. **Database uniqueness:** Partial unique index prevents multiple active consultations for one slot.
3. **Doctor overlap prevention:** PostgreSQL exclusion constraint (`EXCLUDE USING gist`) protects against overlapping slot ranges.
4. **Patient overlap prevention:** Exclusion constraint prevents overlapping active consultations for a patient.
5. **Concurrency test:** Exercised via a 12-way concurrent booking test proving only 1 booking succeeds and 11 fail cleanly with HTTP 409.

> The database is the final authority on booking invariants. Application-level checks improve error messages but cannot replace constraints.

---

## 03 — Data model

```mermaid
erDiagram
    users ||--|| profiles : has
    users ||--o| doctors : "doctor role"
    users ||--o{ refresh_tokens : owns
    doctors ||--o{ availability_slots : publishes
    availability_slots ||--o| consultations : "booked as"
    users ||--o{ consultations : patient
    doctors ||--o{ consultations : doctor
    consultations ||--o| prescriptions : yields
    consultations ||--o{ payments : paid_by
    payments ||--o{ payment_events : receives
    users ||--o{ idempotency_keys : scopes
    users ||--o{ audit_logs : actor

    users {
      uuid id PK
      text email UK
      text role
      boolean mfa_enabled
      text mfa_secret_enc
    }
    profiles {
      uuid id PK
      uuid user_id FK
      text name
      text phone
      text address_enc
    }
    doctors {
      uuid user_id PK,FK
      text specialization
      int consultation_fee_paise
      boolean is_verified
      tsvector search_tsv
    }
    availability_slots {
      uuid id PK
      uuid doctor_id FK
      tstzrange window
      text status
    }
    consultations {
      uuid id PK
      uuid slot_id FK
      uuid patient_id FK
      uuid doctor_id FK
      text status
      text reason_enc
      text notes_enc
    }
    prescriptions {
      uuid id PK
      uuid consultation_id UK
      text diagnosis_enc
      text medications_enc
    }
    payments {
      uuid id PK
      uuid consultation_id FK
      int amount_paise
      text status
      text provider_ref UK
    }
    payment_events {
      uuid id PK
      uuid payment_id FK
      text event_id UK
      text event_type
      jsonb payload
    }
    idempotency_keys {
      uuid id PK
      uuid user_id FK
      text key
      text request_hash
      text status
    }
    audit_logs {
      bigint id
      timestamptz ts
      text hash
      text prev_hash
    }
```

### Data integrity notes
- Foreign keys, `NOT NULL`, `CHECK`, unique indexes, and exclusion constraints guarantee system invariants.
- Payment amounts are strictly integers in paise (avoiding floating-point currency rounding).
- Field-level AES-256-GCM encryption protects sensitive clinical and medical data.
- Idempotency keys are scoped by user and operation, validated with SHA-256 payload hashes.
- Audit logs are range-partitioned by timestamp and cryptographically chained via SHA-256.

---

## 04 — API contract

**Base path:** `/api/v1`  
**Documentation:** `openapi.yaml`, served through Swagger UI at `/docs`  
**Validation:** Zod schemas at every input boundary; reject unknown fields.  
**Pagination:** Keyset/cursor pagination for large result sets.  
**Errors:** Consistent RFC 7807 error envelopes containing a correlation `requestId`.

| Method | Endpoint | Purpose |
|---|---|---|
| `POST` | `/auth/register` | Register patient or doctor |
| `POST` | `/auth/login` | Authenticate and issue tokens |
| `POST` | `/auth/refresh` | Rotate refresh token with reuse detection |
| `GET` | `/doctors` | Search and filter verified doctors |
| `GET` | `/doctors/:id/availability` | Retrieve available slots |
| `POST` | `/consultations` | Create a booking attempt (Saga) |
| `GET` | `/consultations/:id` | Read consultation details & status |
| `POST` | `/consultations/:id/cancel` | Cancel booking & trigger compensation |
| `GET` | `/prescriptions/:id` | Retrieve an authorized prescription (AES-256-GCM) |
| `POST` | `/payments/webhook` | Process signed payment events (HMAC-SHA256) |
| `GET` | `/admin/audit-logs/verify` | Verify cryptographic audit-chain integrity |

---

## 05 — Resilience and retry policy

| Operation | Policy | Safety requirement |
|---|---|---|
| **Payment gateway** | 3 retries with full jitter, 100 ms → 1.5 s; breaker opens after 5 consecutive failures, 15 s cooldown | Retry transient failures only; idempotent provider operation |
| **Database transaction** | Up to 3 retries for `40001` (serialization failure) and `40P01` (deadlock), 20–300 ms jitter | Retry the entire atomic transaction |
| **BullMQ jobs** | 5 attempts, exponential backoff starting at 1 s | Failed jobs retained in dead-letter set for inspection |
| **Inbound webhooks** | Provider redelivery on non-2xx | Dedupe by provider event ID; commit dedupe and business change atomically |
| **Client writes** | `Idempotency-Key` (8–128 chars) | Same key and request returns the same logical result |

**Operational rule:** Never hold a database transaction open while waiting for an external payment provider.

---

## 06 — Data partitioning and scale

### Capacity assumptions

| Measure | Planning estimate |
|---|---|
| Consultations/day | 100,000 |
| Average consultation rate | ~1.2/sec |
| Peak consultation rate | ~15/sec |
| Estimated combined writes including payments/audit | ~50–100/sec |
| Annual consultation growth | ~36 million rows/year |

### Storage strategy
- **Audit logs:** Range-partitioned monthly (`audit_logs_yYYYYmMM`); pre-created by background jobs and archived to S3 WORM storage.
- **Consultations:** Indexed on patient/doctor access paths and hot statuses; evaluated for quarterly range partitioning when rows exceed 200M.
- **Search and availability:** Partial indexes for verified doctors, available slots, and pending-payment records.
- **Read scaling:** Replica routing for search and analytics queries; consistency-sensitive reads routed to primary.

---

## 07 — Caching and concurrency

| Data / operation | Strategy |
|---|---|
| Doctor search | 30 s TTL |
| Availability lists | 15 s TTL |
| Cache expiry | ±10% TTL jitter to avoid synchronized expirations |
| Cache stampede control | Single-flight request coalescing |
| Invalidation | Version counters (`bump('search')`); avoid O(N) key scans |
| Sensitive clinical data | **Never** cached in shared Redis |
| Slot booking | Atomic compare-and-set + database constraints |
| Webhook/cancel paths | Row-level locking (`FOR UPDATE`) |
| Expiry sweepers | `FOR UPDATE SKIP LOCKED` for concurrent conflict-free workers |
| Refresh tokens | Atomic rotation and replay detection |

---

## 08 — Transactions and sagas

Each local database transition uses an ACID transaction. The payment flow is an orchestrated saga spanning PostgreSQL and the external payment provider.

| Saga stage | Success transition | Compensation / recovery |
|---|---|---|
| **Hold slot** | Slot `AVAILABLE → HELD` | Release hold if later step fails |
| **Create payment intent** | Payment `INITIATED` | Mark failed and release slot when safe |
| **Payment success** | Payment `SUCCEEDED`; consultation `CONFIRMED`; slot `BOOKED` | If hold expired, mark `REFUND_PENDING` |
| **Refund** | Provider refund succeeds | Retry idempotently; retain failure for operations review |
| **Notify user** | Notification job completes | Retry asynchronously; do not undo a confirmed booking |

---

## 09 — Backup and disaster recovery

| Scenario | Mechanism | Target |
|---|---|---|
| **Intra-region availability** | RDS Multi-AZ synchronous standby and automatic failover | RPO 0; RTO ~2 min |
| **Accidental deletion/corruption** | Continuous WAL archiving and 14-day point-in-time recovery | RPO ≤ 5 min |
| **Region loss** | Cross-region encrypted backups and infrastructure redeployment | RPO ≤ 15 min; RTO ≤ 60 min |
| **Redis loss** | Treat cache/queue as recoverable; rebuild derived state from PostgreSQL | No business-state loss |
| **Audit retention** | Hash-chain verification and S3 Object Lock for archived partitions | Tamper-evident archive |
| **Validation** | Quarterly restore tests and chaos game days | Proof of recovery viability |

### Availability budget
**99.95% availability ≈ 21.6 minutes of downtime per 30-day month.**  
Protected through multi-AZ deployments, readiness probes, graceful connection draining (`server.keepAliveTimeout = 65000`), rolling updates with `maxUnavailable: 0`, and SLO burn-rate alerts.

---

## 10 — Observability and operations

```mermaid
flowchart LR
    API["API + Workers"] --> MET["Metrics<br/>Prometheus"]
    API --> LOG["Structured logs<br/>Pino → log pipeline"]
    API --> TR["Traces<br/>OpenTelemetry"]
    MET --> G["Grafana dashboards"]
    LOG --> SEARCH["Log search"]
    TR --> J["Jaeger / Tempo"]
    G --> ALERT["Alertmanager"]
```

### Golden signals and domain metrics
- **Traffic:** Requests/sec by route and HTTP status.
- **Errors:** 4xx/5xx rates, payment gateway failures, and webhook verification failures.
- **Duration:** p50/p95/p99 latency histograms; PostgreSQL connection pool wait time.
- **Saturation:** Node.js event-loop lag, memory, and database pool utilization.
- **Booking integrity:** Expired holds, slot conflicts, and saga compensations.
- **Audit & Security:** Authentication failures, MFA attempts, refresh token reuse incidents, and SHA-256 chain verification status.

---

## Security principles
- **Identity:** Mandatory TOTP MFA for doctors/admins; short-lived JWT access tokens (15m) and family-tracked refresh tokens.
- **Authorization:** Deny by default; enforce strict RBAC and object ownership checks.
- **Data Protection:** TLS in transit, AES-256-GCM field encryption with row AAD for PHI, and KMS key rotation.
- **Input Hardening:** Strict Zod validation schemas, 100 KB payload limits, rate limiting, and CORS allow-lists.
- **Integrity:** SHA-256 hash-chained immutable audit log with database triggers blocking modifications.

---

<div align="center">

### Design Principle

**Correctness in PostgreSQL · Resilience through idempotency · Performance through measured optimization · Trust through observability**

*Amrutam Telemedicine Backend · Architecture & Engineering Design*

</div>
