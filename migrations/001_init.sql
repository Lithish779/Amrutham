-- Amrutam telemedicine schema (PostgreSQL 14+)
CREATE EXTENSION IF NOT EXISTS btree_gist;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE TYPE user_role AS ENUM ('patient', 'doctor', 'admin');

CREATE TABLE users (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email               text NOT NULL,
  password_hash       text NOT NULL,
  role                user_role NOT NULL,
  status              text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','DISABLED')),
  mfa_enabled         boolean NOT NULL DEFAULT false,
  mfa_secret_enc      text,
  mfa_last_step       bigint NOT NULL DEFAULT 0,
  mfa_recovery_hashes text[] NOT NULL DEFAULT '{}',
  failed_login_count  int NOT NULL DEFAULT 0,
  locked_until        timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX users_email_lower_uq ON users (lower(email));

CREATE TABLE refresh_tokens (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  family_id   uuid NOT NULL,
  token_hash  text NOT NULL UNIQUE,
  expires_at  timestamptz NOT NULL,
  revoked_at  timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now(),
  ip          text,
  user_agent  text
);
CREATE INDEX refresh_tokens_user_idx ON refresh_tokens (user_id);
CREATE INDEX refresh_tokens_family_idx ON refresh_tokens (family_id);

CREATE TABLE profiles (
  user_id     uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  full_name   text NOT NULL,
  phone_enc   text,                -- PHI/PII: AES-256-GCM
  dob_enc     text,                -- PHI/PII: AES-256-GCM
  gender      text,
  language    text DEFAULT 'en',
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE doctors (
  user_id              uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  display_name         text NOT NULL,
  specialization       text NOT NULL DEFAULT 'general',
  qualifications       text,
  experience_years     int NOT NULL DEFAULT 0 CHECK (experience_years >= 0),
  consultation_fee_paise int NOT NULL DEFAULT 0 CHECK (consultation_fee_paise >= 0),
  languages            text[] NOT NULL DEFAULT '{en}',
  bio                  text,
  rating_avg           numeric(3,2) NOT NULL DEFAULT 0,
  rating_count         int NOT NULL DEFAULT 0,
  is_verified          boolean NOT NULL DEFAULT false,
  search_tsv           tsvector GENERATED ALWAYS AS (
    to_tsvector('simple', coalesce(display_name,'') || ' ' || coalesce(specialization,'') || ' ' || coalesce(bio,''))
  ) STORED,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX doctors_search_gin ON doctors USING gin (search_tsv);
CREATE INDEX doctors_name_trgm ON doctors USING gin (display_name gin_trgm_ops);
CREATE INDEX doctors_spec_idx ON doctors (specialization) WHERE is_verified;
CREATE INDEX doctors_languages_gin ON doctors USING gin (languages);
CREATE INDEX doctors_rating_idx ON doctors (rating_avg DESC, user_id DESC) WHERE is_verified;

CREATE TABLE availability_slots (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  doctor_id       uuid NOT NULL REFERENCES doctors(user_id) ON DELETE CASCADE,
  start_time      timestamptz NOT NULL,
  end_time        timestamptz NOT NULL,
  status          text NOT NULL DEFAULT 'AVAILABLE' CHECK (status IN ('AVAILABLE','HELD','BOOKED','CANCELLED')),
  hold_expires_at timestamptz,
  version         int NOT NULL DEFAULT 0,
  created_at      timestamptz NOT NULL DEFAULT now(),
  CHECK (end_time > start_time),
  -- a doctor can never have two overlapping live slots
  CONSTRAINT slots_no_overlap EXCLUDE USING gist (
    doctor_id WITH =, tstzrange(start_time, end_time) WITH &&
  ) WHERE (status <> 'CANCELLED')
);
CREATE INDEX slots_doctor_start_avail_idx ON availability_slots (doctor_id, start_time) WHERE status = 'AVAILABLE';
CREATE INDEX slots_start_avail_idx ON availability_slots (start_time) WHERE status = 'AVAILABLE';

CREATE TABLE consultations (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id      uuid NOT NULL REFERENCES users(id),
  doctor_id       uuid NOT NULL REFERENCES doctors(user_id),
  slot_id         uuid NOT NULL REFERENCES availability_slots(id),
  status          text NOT NULL CHECK (status IN
                   ('PENDING_PAYMENT','CONFIRMED','IN_PROGRESS','COMPLETED','CANCELLED','EXPIRED','NO_SHOW')),
  scheduled_start timestamptz NOT NULL,
  scheduled_end   timestamptz NOT NULL,
  reason_enc      text,            -- PHI: patient-reported reason, AES-256-GCM
  notes_enc       text,            -- PHI: doctor's consultation notes, AES-256-GCM
  cancel_reason   text,
  cancelled_by    uuid,
  started_at      timestamptz,
  ended_at        timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  -- one active consultation per slot (double-booking guard #2, after the slot CAS)
  -- patient cannot hold two overlapping active consultations
  CONSTRAINT consult_patient_no_overlap EXCLUDE USING gist (
    patient_id WITH =, tstzrange(scheduled_start, scheduled_end) WITH &&
  ) WHERE (status IN ('PENDING_PAYMENT','CONFIRMED','IN_PROGRESS'))
);
CREATE UNIQUE INDEX consult_slot_active_uq ON consultations (slot_id)
  WHERE status IN ('PENDING_PAYMENT','CONFIRMED','IN_PROGRESS','COMPLETED');
CREATE INDEX consult_patient_idx ON consultations (patient_id, created_at DESC, id DESC);
CREATE INDEX consult_doctor_idx ON consultations (doctor_id, created_at DESC, id DESC);
CREATE INDEX consult_pending_idx ON consultations (created_at) WHERE status = 'PENDING_PAYMENT';
CREATE INDEX consult_confirmed_end_idx ON consultations (scheduled_end) WHERE status = 'CONFIRMED';

CREATE TABLE prescriptions (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  consultation_id  uuid NOT NULL UNIQUE REFERENCES consultations(id),
  doctor_id        uuid NOT NULL REFERENCES doctors(user_id),
  patient_id       uuid NOT NULL REFERENCES users(id),
  diagnosis_enc    text NOT NULL,   -- PHI
  medications_enc  text NOT NULL,   -- PHI (JSON)
  instructions_enc text,            -- PHI
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX prescriptions_patient_idx ON prescriptions (patient_id, created_at DESC);

CREATE TABLE payments (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  consultation_id  uuid NOT NULL REFERENCES consultations(id),
  patient_id       uuid NOT NULL REFERENCES users(id),
  amount_paise     int NOT NULL CHECK (amount_paise > 0),
  currency         text NOT NULL DEFAULT 'INR',
  status           text NOT NULL CHECK (status IN ('INITIATED','SUCCEEDED','FAILED','REFUND_PENDING','REFUNDED')),
  provider         text NOT NULL DEFAULT 'mock',
  provider_ref     text,
  refund_ref       text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX payments_consultation_idx ON payments (consultation_id);
CREATE UNIQUE INDEX payments_live_per_consultation_uq ON payments (consultation_id)
  WHERE status IN ('INITIATED','SUCCEEDED');
CREATE UNIQUE INDEX payments_provider_ref_uq ON payments (provider, provider_ref) WHERE provider_ref IS NOT NULL;

-- webhook de-duplication (at-least-once delivery -> exactly-once effect)
CREATE TABLE payment_events (
  event_id     text PRIMARY KEY,
  payment_id   uuid,
  type         text NOT NULL,
  received_at  timestamptz NOT NULL DEFAULT now()
);

-- HTTP idempotency for client writes
CREATE TABLE idempotency_keys (
  user_id        uuid NOT NULL,
  key            text NOT NULL,
  request_hash   text NOT NULL,
  status         text NOT NULL CHECK (status IN ('IN_PROGRESS','COMPLETED')),
  response_status int,
  response_body  jsonb,
  locked_at      timestamptz NOT NULL DEFAULT now(),
  created_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, key)
);
CREATE INDEX idempotency_created_idx ON idempotency_keys (created_at);

-- Append-only, hash-chained audit log, range-partitioned by month
CREATE SEQUENCE audit_logs_id_seq;
CREATE TABLE audit_logs (
  id            bigint NOT NULL DEFAULT nextval('audit_logs_id_seq'),
  ts            timestamptz NOT NULL,
  actor_id      uuid,
  actor_role    text,
  action        text NOT NULL,
  resource_type text,
  resource_id   text,
  ip            text,
  request_id    text,
  metadata      jsonb NOT NULL DEFAULT '{}',
  prev_hash     text NOT NULL,
  hash          text NOT NULL,
  PRIMARY KEY (id, ts)
) PARTITION BY RANGE (ts);
CREATE INDEX audit_actor_idx ON audit_logs (actor_id, ts DESC);
CREATE INDEX audit_resource_idx ON audit_logs (resource_type, resource_id, ts DESC);
CREATE INDEX audit_action_idx ON audit_logs (action, ts DESC);

CREATE FUNCTION audit_logs_immutable() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'audit_logs is append-only';
END; $$ LANGUAGE plpgsql;
CREATE TRIGGER audit_logs_no_update BEFORE UPDATE OR DELETE ON audit_logs
  FOR EACH ROW EXECUTE FUNCTION audit_logs_immutable();

CREATE TABLE audit_logs_default PARTITION OF audit_logs DEFAULT;

CREATE FUNCTION ensure_audit_partitions(months_ahead int DEFAULT 3) RETURNS void AS $$
DECLARE
  m date; nm date; pname text;
BEGIN
  FOR i IN -1..months_ahead LOOP
    m  := (date_trunc('month', now() AT TIME ZONE 'UTC') + make_interval(months => i))::date;
    nm := (m + interval '1 month')::date;
    pname := 'audit_logs_' || to_char(m, 'YYYY_MM');
    IF to_regclass(pname) IS NULL THEN
      BEGIN
        EXECUTE format('CREATE TABLE %I PARTITION OF audit_logs FOR VALUES FROM (%L) TO (%L)',
                       pname, m::timestamptz, nm::timestamptz);
      EXCEPTION WHEN invalid_object_definition THEN
        -- rows already sit in the default partition for this range; skip, ops can move them
        RAISE NOTICE 'partition % skipped (overlaps default rows)', pname;
      END;
    END IF;
  END LOOP;
END; $$ LANGUAGE plpgsql;
SELECT ensure_audit_partitions(3);

-- Single-row chain head: serialises audit appends for hash chaining (short transactions only)
CREATE TABLE audit_chain_head (
  singleton  boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  last_id    bigint NOT NULL DEFAULT 0,
  last_hash  text NOT NULL
);
INSERT INTO audit_chain_head (last_hash) VALUES (repeat('0', 64));
