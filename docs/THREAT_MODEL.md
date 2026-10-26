# Threat Model (STRIDE) and Attack Surface

## Assets and data classification
| Class | Data | Controls |
|---|---|---|
| **Restricted (PHI)** | diagnosis, medications, instructions, consultation reason & notes | AES-256-GCM field encryption, participant-only access, every read audited, never cached or logged |
| **Confidential (PII)** | email, phone, DOB, full name | phone/DOB encrypted; email only to owner/admin; redacted in logs |
| **Secrets** | password hashes, refresh tokens (hashed), TOTP secrets (encrypted), JWT/webhook/encryption keys | bcrypt/SHA-256, KMS/Secrets Manager, rotation procedure |
| **Financial** | payment amounts/status (no card data: provider-hosted) | PCI scope minimised: PAN never touches our systems |
| **Internal** | doctor catalogue, slots, analytics | RBAC |
| **Integrity-critical** | audit log, slot/booking state | append-only, hash chain, DB constraints |

## Trust boundaries and attack surface
1. Internet → LB/WAF → API (`/auth/*`, public `/doctors*`, authenticated APIs)
2. Payment provider → `/webhooks/payments` (only unauthenticated write endpoint, signature-protected)
3. API/worker → Postgres, Redis, payment provider, OTel collector
4. Operators/CI → registry, cluster, secrets store
5. Admin console users (highest privilege; MFA mandatory)

## STRIDE
| Threat | Example | Mitigation |
|---|---|---|
| **S**poofing | Credential stuffing, stolen token, forged webhook | Lockout + rate limit + MFA; short-lived JWT; refresh reuse detection; HMAC + timestamp on webhooks |
| **T**ampering | Edit another's booking, tamper audit rows, replay payment events, price manipulation | Ownership checks; server-side pricing; event-id de-dup; append-only trigger + hash chain verifier; AAD-bound ciphertext |
| **R**epudiation | "I never cancelled / prescribed" | Audit trail with actor, IP, request id, immutable and chained |
| **I**nformation disclosure | IDOR on prescriptions, SQLi, PHI in logs/cache, user enumeration | 404 on foreign objects, parameterised SQL, redaction, no PHI caching, uniform auth errors, field encryption |
| **D**enial of service | Search flooding, slot-hogging (hold without paying), huge bodies | Rate limits, pagination caps, 100 KB body limit, hold TTL + sweeper, HPA, Redis fail-open caching |
| **E**levation of privilege | Register as admin, role in body, token scope abuse, `alg:none` | Role not accepted from client, strict schemas, scoped tokens, pinned algorithm |

## Business-logic abuse
| Abuse | Defence |
|---|---|
| Double booking / race | CAS + unique partial index + exclusion constraints |
| Slot hoarding without paying | 10-min hold, auto-release, per-user write rate limit |
| Replay of "payment succeeded" | Signed + timestamped + de-duplicated events; payment row locked `FOR UPDATE` |
| Late payment after expiry | Automatic refund saga |
| Refund abuse (cancel after use) | State machine: only `CONFIRMED` cancellable; refund policy by time-to-start; no double refunds (status guard + provider idempotency key) |
| Fake doctors | Admin verification gate before listing/booking |

## Residual risks and next steps
JWT access tokens remain valid ≤15 min after theft unless user is disabled (revocation list covers admin actions); add device binding / step-up auth for sensitive reads. Move HS256 to asymmetric keys (RS256/EdDSA) with JWKS rotation when multiple services verify tokens. Add envelope encryption with per-tenant data keys from KMS (`GenerateDataKey`) in place of an env keyring when moving off a single secret store. Add WAF bot rules and anomaly detection on audit stream.
