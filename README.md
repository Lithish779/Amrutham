# Amrutam Telemedicine Backend

Production-grade telemedicine backend: **auth + MFA + RBAC**, doctor availability, **race-free booking saga**, consultations & encrypted prescriptions, search, **hash-chained audit trail**, admin analytics, with metrics/logs/traces, CI/CD and infrastructure as code.

Stack: Node.js 22 · Express · PostgreSQL 16 · Redis/BullMQ (optional) · Zod · OpenTelemetry · Prometheus/Grafana · Docker/Kubernetes/Terraform.

| Deliverable | Where |
|---|---|
| Code | `src/` (modules: auth, doctors, consultations, prescriptions, search, admin, payments) |
| Infra as code | `Dockerfile`, `docker-compose.yml`, `infra/k8s/`, `infra/terraform/` |
| API schema | `openapi.yaml` (Swagger UI at `/docs`) |
| Architecture doc, diagrams (HLD, sequence, ER, saga, DR) | `docs/ARCHITECTURE.md` |
| Tests + CI | `tests/` (71 tests), `.github/workflows/` |
| Observability | `observability/` (Prometheus, alerts/SLO burn rates, Grafana dashboard, OTel collector) |
| Security checklist + threat model | `docs/SECURITY.md`, `docs/THREAT_MODEL.md` |
| Demo script | `docs/DEMO_SCRIPT.md` |

## Quick start (Docker, one command)
```bash
docker compose up -d --build
docker compose exec api node scripts/seed.js     # admin, patient, 4 verified doctors
open http://localhost:8080/docs                  # Swagger UI
# Grafana http://localhost:3000 · Prometheus :9090 · Jaeger :16686
```

## Local development
```bash
npm install
cp .env.example .env              # dev has safe fallbacks; production REQUIRES real secrets
createdb amrutam && npm run migrate && npm run seed
npm run dev                       # API on :8080 (Redis optional; in-memory fallback)
npm test                          # needs Postgres: TEST_DATABASE_URL (default postgres://amrutam:amrutam@localhost:5432/amrutam_test)
TEST_REDIS_URL=redis://localhost:6379 npm test   # same suite on the real Redis/BullMQ path
```
Seeded logins use `ChangeMe-Str0ng-Pass`. Admin/doctor logins return `mfaEnrollmentRequired` → call `/auth/mfa/setup` then `/auth/mfa/enable` with a TOTP from any authenticator app.

## Try the booking flow
```bash
API=http://localhost:8080/api/v1
# patient registers/logs in, picks a doctor/slot, books with an Idempotency-Key
curl -X POST $API/consultations -H "Authorization: Bearer $TOKEN" -H "Idempotency-Key: $(uuidgen)" \
  -H 'content-type: application/json' -d '{"slotId":"<slot>","reason":"fever"}'
# simulate the payment provider calling back (HMAC-signed)
node scripts/simulate-webhook.js <payment.providerRef from DB or logs> succeeded
```

## Configuration (env vars)
See `.env.example`. Key ones: `DATABASE_URL`, `DATABASE_READ_URL` (replica for search/analytics), `REDIS_URL`, `JWT_ACCESS_SECRET`, `ENCRYPTION_KEYS` (versioned keyring) + `ENCRYPTION_ACTIVE_KEY_ID`, `PAYMENT_WEBHOOK_SECRET`, `SLOT_HOLD_SECONDS`, `OTEL_EXPORTER_OTLP_ENDPOINT`. Secrets come **only** from the environment; the app refuses to boot in production without them.

**Key rotation:** add key `2` to `ENCRYPTION_KEYS`, set `ENCRYPTION_ACTIVE_KEY_ID=2`, deploy, run `npm run rotate-keys`, confirm `npm run rotate-keys -- --check` reports 0, then retire key `1`.

## Design highlights
* **No double booking, provably:** slot compare-and-set + partial unique index + exclusion constraints; 12-way concurrent test.
* **Idempotency everywhere it matters:** `Idempotency-Key` on client writes (replay / 422 / 409-in-progress), de-duplicated payment webhooks, idempotent refund calls, one-prescription-per-consultation constraint.
* **Saga with compensation:** hold → pay → confirm; gateway failure, payment failure, timeout and late payment all converge to a consistent state.
* **PHI protection:** AES-256-GCM field encryption with AAD + key rotation; participant-only access; every PHI read audited; admins never see PHI.
* **Tamper-evident audit log:** append-only trigger + SHA-256 hash chain + verification endpoint + monthly partitions.
* **Performance:** keyset pagination, partial/GIN/trigram indexes, replica reads, Redis cache with version-based invalidation and single-flight. Load test: `k6 run scripts/load/booking.js`.

## Project layout
```
src/{config,container,app,server,worker,db,cache,audit,metrics,logger,tracing}.js
src/lib/        crypto (AES-GCM), retry (backoff + circuit breaker), errors, pagination, context
src/middleware/ auth (JWT/RBAC), idempotency, rateLimit, validation + error handling
src/modules/    auth · doctors · consultations (saga) · prescriptions · search · admin · payments (gateway port)
src/jobs/       BullMQ queue/worker with in-process fallback
migrations/     SQL migrations (partitioned audit log, constraints)
```
