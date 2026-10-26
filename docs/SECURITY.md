# Security Checklist

Legend: ✅ implemented and covered by tests · 🧩 provided as configuration/IaC.

## Authentication & session
- ✅ bcrypt password hashing (cost 12), password policy, constant-time-ish login (dummy hash) → no user enumeration
- ✅ Account lockout: 5 failures → 15 min; per-user MFA attempt throttle
- ✅ **MFA (TOTP RFC 6238)**, mandatory for `doctor` and `admin` (no usable session until enrolled); replay protection (single-use time-step), 8 single-use hashed recovery codes; TOTP secret encrypted at rest
- ✅ JWT HS256 pinned (`alg:none`/confusion rejected), issuer/audience checked, 15-min access tokens, scoped tokens (`mfa_challenge`, `mfa_setup` cannot call the API)
- ✅ Refresh-token rotation with **reuse detection** (whole family revoked), tokens stored only as SHA-256
- ✅ Immediate session kill on user disable (revocation key + refresh revocation)

## Authorization
- ✅ RBAC (`patient`, `doctor`, `admin`), deny-by-default middleware; object-level checks (ownership) on every resource: strangers receive 404, not 403
- ✅ Least privilege: admins see consultation lifecycle but **never PHI**; prescriptions readable only by the two participants
- ✅ Privilege escalation blocked: admin accounts cannot self-register; strict schemas reject extra fields (mass assignment); price is always server-side
- ✅ Doctors are invisible and unbookable until an admin verifies them

## Data protection
- ✅ **Field-level AES-256-GCM** for PHI (prescriptions, consultation reason/notes, phone, DOB, MFA secrets) with per-row AAD (ciphertext cannot be swapped between rows)
- ✅ **Key rotation**: versioned keyring, `npm run rotate-keys` re-encrypts online, `--check` proves completion
- 🧩 TLS everywhere (HSTS header set; terminate at LB), RDS/ElastiCache/EBS encryption with KMS CMK + auto-rotation (Terraform)
- ✅ Secrets only via environment (K8s `ExternalSecret` → AWS Secrets Manager); production refuses to start without them; no secrets in repo (gitleaks in CI)
- ✅ Log redaction for credentials and PHI fields; audit metadata contains ids only

## Input & API hardening (OWASP)
| OWASP 2021 | Mitigation |
|---|---|
| A01 Broken access control | RBAC + ownership checks + tests for IDOR (stranger, other doctor, admin) |
| A02 Cryptographic failures | AES-GCM, bcrypt, SHA-256, HMAC, TLS/HSTS, KMS |
| A03 Injection | 100% parameterised SQL; zod validation; sort fields from allow-list; test with SQLi payloads |
| A04 Insecure design | Saga + constraints, idempotency, threat model (docs/THREAT_MODEL.md) |
| A05 Misconfiguration | helmet headers, CORS allow-list, no `x-powered-by`, non-root read-only container, config validated at boot |
| A06 Vulnerable components | `npm audit` gate, Dependabot, Trivy image scan, CodeQL |
| A07 Auth failures | MFA, lockout, rate limits, token rotation |
| A08 Integrity failures | HMAC-signed webhooks with timestamp + event de-dup; pinned CI actions; hash-chained audit log |
| A09 Logging & monitoring | Immutable audit trail, security metrics + alerts (auth failures, refresh reuse, audit write failures) |
| A10 SSRF | No user-controlled outbound URLs |
- ✅ Rate limiting: global per IP, strict on auth, per-user on writes (Redis-atomic, 429 + `Retry-After`)
- ✅ Body size limit 100 KB, JSON-only, uniform errors with no stack traces in production

## Idempotency & integrity (critical)
- ✅ `Idempotency-Key` required on all state-creating writes; replay/422/409-in-progress semantics; 5xx not cached
- ✅ Webhook exactly-once effect; DB constraints prevent double booking and double prescription

## Compliance & audit
- ✅ Append-only audit log (DB trigger blocks UPDATE/DELETE), SHA-256 hash chain, verification endpoint (tamper test included), monthly partitions + retention policy
- ✅ PHI reads (consultation detail, prescription) are audited with actor and request id
- 🧩 Data classification and retention table in THREAT_MODEL.md; DPDP-Act / HIPAA-style controls mapped (access logging, encryption, minimisation, breach alerts)

## Supply chain & operations
- ✅ CI: lint, tests (in-memory and Redis/BullMQ matrix), `npm audit`, gitleaks, Trivy, CodeQL; production deploy behind manual approval
- 🧩 Network policy default-deny, DB reachable only from app SG, PDB/HPA, read-only root filesystem
