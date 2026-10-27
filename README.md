# 🌿 Amrutam — Enterprise Telemedicine Platform

<div align="center">
  <p><i>Ancient Ayurvedic Wisdom Meets Fault-Tolerant Modern Engineering.</i></p>

  [![OpenAPI](https://img.shields.io/badge/OpenAPI-3.0.3-85EA2D?style=for-the-badge&logo=swagger&logoColor=black)](http://localhost:8080/docs)
  [![Docker](https://img.shields.io/badge/Docker-Containerized-2496ED?style=for-the-badge&logo=docker&logoColor=white)](docker-compose.yml)
  [![PostgreSQL](https://img.shields.io/badge/PostgreSQL-16%20Multi--AZ-4169E1?style=for-the-badge&logo=postgresql&logoColor=white)](migrations/001_init.sql)
  [![Node.js](https://img.shields.io/badge/Node.js-v22+-339933?style=for-the-badge&logo=nodedotjs&logoColor=white)](package.json)
  [![License](https://img.shields.io/badge/License-MIT-059669?style=for-the-badge)](LICENSE)
</div>

---

## 🚀 Languages and Tools...

<p align="left">
  <img src="https://img.shields.io/badge/Node.js-339933?style=for-the-badge&logo=nodedotjs&logoColor=white" />
  <img src="https://img.shields.io/badge/Express.js-000000?style=for-the-badge&logo=express&logoColor=white" />
  <img src="https://img.shields.io/badge/PostgreSQL-4169E1?style=for-the-badge&logo=postgresql&logoColor=white" />
  <img src="https://img.shields.io/badge/Redis-DC382D?style=for-the-badge&logo=redis&logoColor=white" />
  <img src="https://img.shields.io/badge/BullMQ-FF4500?style=for-the-badge&logo=redis&logoColor=white" />
  <img src="https://img.shields.io/badge/Docker-2496ED?style=for-the-badge&logo=docker&logoColor=white" />
  <img src="https://img.shields.io/badge/Kubernetes-326CE5?style=for-the-badge&logo=kubernetes&logoColor=white" />
  <img src="https://img.shields.io/badge/Terraform-7B42BC?style=for-the-badge&logo=terraform&logoColor=white" />
</p>

<p align="left">
  <img src="https://img.shields.io/badge/OpenTelemetry-000000?style=for-the-badge&logo=opentelemetry&logoColor=white" />
  <img src="https://img.shields.io/badge/Prometheus-E6522C?style=for-the-badge&logo=prometheus&logoColor=white" />
  <img src="https://img.shields.io/badge/Grafana-F46800?style=for-the-badge&logo=grafana&logoColor=white" />
  <img src="https://img.shields.io/badge/Jaeger-60D0E4?style=for-the-badge&logo=jaeger&logoColor=black" />
  <img src="https://img.shields.io/badge/JWT-000000?style=for-the-badge&logo=json-web-tokens&logoColor=white" />
  <img src="https://img.shields.io/badge/Zod-3E67B1?style=for-the-badge&logo=zod&logoColor=white" />
  <img src="https://img.shields.io/badge/Jest-C21325?style=for-the-badge&logo=jest&logoColor=white" />
  <img src="https://img.shields.io/badge/Git-F05032?style=for-the-badge&logo=git&logoColor=white" />
  <img src="https://img.shields.io/badge/npm-CB3837?style=for-the-badge&logo=npm&logoColor=white" />
</p>

---

## ✨ Features

### ⚡ Race-Free Booking Saga
- **Zero Double-Booking Guarantee**: Atomic slot compare-and-set (`UPDATE ... WHERE status='AVAILABLE'`), partial unique index, and PostgreSQL exclusion constraints (`EXCLUDE USING gist`) prevent overlapping schedules.
- **Distributed Saga with Compensation**: Orchestrates `AVAILABLE` → `HELD (10m)` → `PENDING_PAYMENT` → `CONFIRMED`. Automatically rolls back slots on payment gateway failures or hold expirations.
- **Strict Idempotency**: Required `Idempotency-Key` headers on state-changing writes with replay detection and atomic deduplication.

### 🛡️ Zero-Knowledge Security & Compliance
- **AES-256-GCM PHI Encryption**: Clinical prescriptions, consultation notes, and patient records are encrypted at rest with row-level Additional Authenticated Data (AAD) to prevent ciphertext swapping.
- **Zero-Downtime Key Rotation**: Keyring versioning with automated batch re-encryption script (`npm run rotate-keys`).
- **MFA Enforcement**: Mandatory TOTP (RFC 6238) for doctors and administrators before granting API access.
- **Refresh Token Family Revocation**: Cryptographically hashes refresh tokens with automatic tree-revocation upon replay detection.

### 📜 Tamper-Evident Audit Trail
- **Cryptographic SHA-256 Hash Chain**: Every audit event links to its predecessor via `prev_hash`. Database triggers strictly prohibit `UPDATE` or `DELETE`.
- **Online Verification**: Instant validation endpoint detects any administrative or database-level tampering.
- **Monthly Partitioning**: Pre-created monthly PostgreSQL partitions with automated retention pruning.

### 🩺 Ayurvedic Clinical Care
- **Specialist Catalog**: High-speed Trigram & GIN indexed doctor search across Ayurveda, Dermatology, Panchakarma, and Kayachikitsa.
- **Digital Prescriptions**: Structured herbal formulations, dosages, duration, and lifestyle instructions linked to consultations.

### 📊 Observability & Telemetry
- **Prometheus Metrics**: Pre-configured RED metrics (Rate, Errors, Duration) per route at `/metrics`.
- **OpenTelemetry & Jaeger**: Distributed end-to-end tracing across HTTP handlers, PostgreSQL queries, and Redis calls.
- **Grafana & Alerts**: Production dashboard and SLO burn-rate alerts configured for 99.95% availability.

---

## 🛠️ Installation & Setup

### Prerequisites
- Node.js (v20+)
- Docker & Docker Compose (optional for local containerized run)
- PostgreSQL 16 (or AWS RDS)
- Redis 7 (optional; app includes in-memory graceful fallback)

### Quick Start (Docker — One Command)
```bash
# Clone the repository
git clone https://github.com/Lithish779/Amrutham.git
cd Amrutham

# Launch backend, PostgreSQL, Redis, Prometheus, Grafana, Jaeger & OTel Collector
docker compose up -d --build

# Run database migrations and seed default doctors/admin
docker compose exec api node scripts/seed.js

# Access endpoints
open http://localhost:8080/       # Interactive Web Portal & Booking UI
open http://localhost:8080/docs   # OpenAPI / Swagger UI
open http://localhost:3000        # Grafana Dashboard (admin/admin)
open http://localhost:16686       # Jaeger Tracing UI
```

### Local Development Setup
1. **Install dependencies:**
   ```bash
   npm install
   ```

2. **Configure environment:**
   ```bash
   cp .env.example .env
   ```

3. **Database setup:**
   ```bash
   createdb amrutam
   npm run migrate
   npm run seed
   ```

4. **Start development server:**
   ```bash
   npm run dev
   ```

---

## ⚙️ Environment Variables

Create your `.env` configuration file based on `.env.example`:

```env
NODE_ENV=development
PORT=8080
DATABASE_URL=postgres://amrutam:amrutam@localhost:5432/amrutam
DATABASE_READ_URL=postgres://amrutam:amrutam@localhost:5432/amrutam
REDIS_URL=redis://localhost:6379

# Cryptographic Secrets (Must be at least 32 random characters in production)
JWT_ACCESS_SECRET=dev-only-access-secret-change-me-0123456789
ENCRYPTION_KEYS={"1":"MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY="}
ENCRYPTION_ACTIVE_KEY_ID=1
PAYMENT_WEBHOOK_SECRET=change-me-webhook-secret

SLOT_HOLD_SECONDS=600
BCRYPT_ROUNDS=12
CORS_ORIGINS=http://localhost:3000
```

---

## 🧪 Testing & Verification

```bash
# Run unit test suite (AES-256-GCM crypto & backoff circuit breaker)
npm run test:unit

# Run full integration test suite (requires PostgreSQL test database)
npm test

# Run integration tests against real Redis & BullMQ
TEST_REDIS_URL=redis://localhost:6379 npm test

# Run zero-downtime cryptographic key rotation test
npm run rotate-keys -- --check

# Execute k6 load test for 100k daily consultations throughput
k6 run scripts/load/booking.js
```

---

## 📁 Project Structure

```text
├── docs/                     # Architectural & Security Deliverables
│   ├── ARCHITECTURE.md       # High-Level Architecture, Sequence & ER Diagrams
│   ├── SECURITY.md           # OWASP Top 10 Mitigations & HIPAA Compliance Checklist
│   ├── THREAT_MODEL.md       # STRIDE Threat Analysis & Data Classification
│   └── DEMO_SCRIPT.md        # 5-minute Walkthrough Script for Video Demo
├── infra/                    # Infrastructure as Code
│   ├── k8s/                  # Kubernetes Manifests (Deployment, HPA, PDB, NetworkPolicy)
│   └── terraform/            # Terraform AWS Modules (RDS Multi-AZ, ElastiCache, KMS)
├── migrations/               # PostgreSQL Database Schema
│   └── 001_init.sql          # Partitioned Tables, Exclusion Constraints, Triggers
├── observability/            # Telemetry Configurations
│   ├── alerts.yml            # Prometheus Alerting Rules & SLO Burn Rates
│   ├── grafana/              # Provisioned Dashboards
│   ├── otel-collector.yml    # OpenTelemetry Collector Pipeline
│   └── prometheus.yml        # Metrics Scrape Configurations
├── public/                   # Interactive Web Portal & API Explorer
│   ├── index.html            # Single Page Application
│   ├── style.css             # Modern Light-Theme Stylesheet
│   └── app.js                # Doctor Booking & API Playground Logic
├── scripts/                  # Operations & Maintenance Scripts
│   ├── migrate.js            # Database Migration Runner
│   ├── seed.js               # Seed Admin, Patient & Verified Doctors
│   ├── rotate-keys.js        # Online Zero-Downtime Key Rotation
│   └── simulate-webhook.js   # HMAC-Signed Webhook Test Tool
├── src/                      # Application Source Code
│   ├── config.js             # Zod Schema Configuration
│   ├── container.js          # Composition Root (Dependency Injection)
│   ├── app.js                # Express Application Router
│   ├── server.js             # HTTP Server & Graceful Shutdown
│   ├── db.js                 # PostgreSQL Connection Pool & Replica Routing
│   ├── cache.js              # Redis Caching with Single-Flight Stampede Defense
│   ├── audit.js              # Append-Only SHA-256 Hash Chaining
│   ├── metrics.js            # Prometheus Client Collectors
│   ├── lib/                  # Cryptography (AES-GCM), Retry, Errors, Pagination
│   ├── middleware/           # Auth (JWT/RBAC), Idempotency, Rate Limit
│   └── modules/              # Core Modules (auth, doctors, consultations, prescriptions, search, admin)
├── openapi.yaml              # Complete OpenAPI 3.0.3 Contract
├── Dockerfile                # Production Multi-Stage Distroless Docker Build
└── docker-compose.yml        # Full Local Cloud Stack Composition
```

---

## 📚 Deliverables Reference Guide

| Requirement | Documentation Link | Code Implementation |
|---|---|---|
| **System Architecture** | [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | `src/container.js`, `src/app.js` |
| **Double-Booking Prevention** | [docs/ARCHITECTURE.md § 2](docs/ARCHITECTURE.md) | `migrations/001_init.sql`, `src/modules/consultations/` |
| **Security & OWASP** | [docs/SECURITY.md](docs/SECURITY.md) | `src/lib/crypto.js`, `src/middleware/auth.js` |
| **STRIDE Threat Model** | [docs/THREAT_MODEL.md](docs/THREAT_MODEL.md) | `src/audit.js`, `src/middleware/idempotency.js` |
| **OpenAPI Specification** | [openapi.yaml](openapi.yaml) | Served live at `/docs` |
| **Kubernetes & Terraform** | [infra/k8s/](infra/k8s/), [infra/terraform/](infra/terraform/) | Multi-AZ RDS, KMS Keyring, HPA Autoscaler |
| **5-Minute Demo Script** | [docs/DEMO_SCRIPT.md](docs/DEMO_SCRIPT.md) | Full evaluation walkthrough |

---

<div align="center">
  <p>Built with ❤️ for fault-tolerant Ayurvedic healthcare.</p>
  <b><a href="https://github.com/Lithish779/Amrutham">GitHub Repo</a> • <a href="http://localhost:8080/">Web Portal</a> • <a href="http://localhost:8080/docs">Swagger UI</a></b>
</div>
