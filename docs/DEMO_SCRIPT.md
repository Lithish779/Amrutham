# 5-minute demo video script

**Setup (before recording):** `docker compose up -d --build && docker compose exec api node scripts/seed.js`, open Swagger (`:8080/docs`), Grafana (`:3000`), Jaeger (`:16686`). Use `curl`/Swagger or `scripts/demo.sh`.

| Time | Show | Say |
|---|---|---|
| 0:00 | Repo tree + architecture diagram (docs/ARCHITECTURE.md) | Modular monolith, Postgres source of truth, Redis optional, workers, observability |
| 0:30 | Register patient, doctor → doctor forced into MFA enrolment → TOTP | MFA mandatory for doctor/admin, refresh rotation |
| 1:15 | Admin verifies doctor; search with filters | Verified-only listing, keyset pagination, cache |
| 1:45 | Doctor creates slots (overlap → 409) | DB exclusion constraint |
| 2:15 | Patient books; replay same `Idempotency-Key` → `Idempotent-Replayed: true`; second patient → 409 | Idempotency, CAS + unique index |
| 3:00 | `node scripts/simulate-webhook.js <ref>` → CONFIRMED; send twice → duplicate | HMAC, event de-dup, saga |
| 3:30 | Doctor starts/completes, issues prescription; DB shows ciphertext (`psql`) | Field encryption, PHI audit |
| 4:00 | Admin analytics + audit log + `/audit-logs/verify`; tamper demo from tests | Hash-chained audit |
| 4:30 | Grafana dashboard + a trace in Jaeger; CI pipeline page; `npm test` (71 tests) | SLO alerts, CI/CD, security scans |
