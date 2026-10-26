'use strict';
const { z } = require('zod');

const env = process.env;
const isProd = env.NODE_ENV === 'production';
const isTest = env.NODE_ENV === 'test';

// Dev/test-only fallbacks. In production every secret MUST come from the environment (K8s Secret / Vault / SSM).
const dev = (value) => (isProd ? undefined : value);

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().default(8080),
  LOG_LEVEL: z.string().default('info'),
  DATABASE_URL: z.string().min(1),
  DATABASE_READ_URL: z.string().optional(),
  DB_POOL_MAX: z.coerce.number().default(20),
  REDIS_URL: z.string().optional(),
  JWT_ACCESS_SECRET: z.string().min(32),
  JWT_ISSUER: z.string().default('amrutam-api'),
  JWT_AUDIENCE: z.string().default('amrutam-clients'),
  ACCESS_TTL_SEC: z.coerce.number().default(900),
  REFRESH_TTL_SEC: z.coerce.number().default(60 * 60 * 24 * 14),
  BCRYPT_ROUNDS: z.coerce.number().min(4).max(15).default(12),
  // Keyring for field-level encryption: {"1":"<base64 32 bytes>","2":"..."}; newest id is used to encrypt.
  ENCRYPTION_KEYS: z.string().min(1),
  ENCRYPTION_ACTIVE_KEY_ID: z.string().default('1'),
  PAYMENT_WEBHOOK_SECRET: z.string().min(16),
  SLOT_HOLD_SECONDS: z.coerce.number().default(600),
  MIN_BOOKING_LEAD_MINUTES: z.coerce.number().default(5),
  CORS_ORIGINS: z.string().default(''),
  RATE_LIMIT_GLOBAL_PER_MIN: z.coerce.number().default(600),
  RATE_LIMIT_AUTH_PER_MIN: z.coerce.number().default(10),
  RATE_LIMIT_WRITE_PER_MIN: z.coerce.number().default(60),
  METRICS_TOKEN: z.string().optional(),
  RUN_WORKER_IN_API: z.enum(['true', 'false']).default(isProd ? 'false' : 'true'),
  PAYMENT_GATEWAY: z.enum(['mock']).default('mock'),
  MOCK_GATEWAY_FAIL_RATE: z.coerce.number().default(0),
  TRUST_PROXY: z.coerce.number().default(isProd ? 1 : 0),
  ENABLE_DOCS: z.enum(['true', 'false']).default('true'),
});

function load() {
  const raw = {
    ...env,
    DATABASE_URL: env.DATABASE_URL || dev('postgres://amrutam:amrutam@localhost:5432/amrutam'),
    JWT_ACCESS_SECRET: env.JWT_ACCESS_SECRET || dev('dev-only-access-secret-change-me-0123456789'),
    ENCRYPTION_KEYS: env.ENCRYPTION_KEYS || dev(JSON.stringify({ 1: Buffer.alloc(32, 7).toString('base64') })),
    PAYMENT_WEBHOOK_SECRET: env.PAYMENT_WEBHOOK_SECRET || dev('dev-webhook-secret-0123456789'),
  };
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    const msg = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`Invalid configuration: ${msg}`);
  }
  const c = parsed.data;
  const keys = JSON.parse(c.ENCRYPTION_KEYS);
  for (const [id, k] of Object.entries(keys)) {
    if (Buffer.from(k, 'base64').length !== 32) throw new Error(`Encryption key ${id} must be 32 bytes (base64)`);
  }
  if (!keys[c.ENCRYPTION_ACTIVE_KEY_ID]) throw new Error('ENCRYPTION_ACTIVE_KEY_ID not in keyring');
  return {
    env: c.NODE_ENV,
    isProd,
    isTest,
    port: c.PORT,
    logLevel: c.LOG_LEVEL,
    databaseUrl: c.DATABASE_URL,
    databaseReadUrl: c.DATABASE_READ_URL,
    dbPoolMax: c.DB_POOL_MAX,
    redisUrl: c.REDIS_URL,
    jwt: { secret: c.JWT_ACCESS_SECRET, issuer: c.JWT_ISSUER, audience: c.JWT_AUDIENCE, accessTtl: c.ACCESS_TTL_SEC, refreshTtl: c.REFRESH_TTL_SEC },
    bcryptRounds: c.BCRYPT_ROUNDS,
    encryption: { keys, activeKeyId: c.ENCRYPTION_ACTIVE_KEY_ID },
    paymentWebhookSecret: c.PAYMENT_WEBHOOK_SECRET,
    slotHoldSeconds: c.SLOT_HOLD_SECONDS,
    minBookingLeadMinutes: c.MIN_BOOKING_LEAD_MINUTES,
    corsOrigins: c.CORS_ORIGINS.split(',').map((s) => s.trim()).filter(Boolean),
    rateLimit: { global: c.RATE_LIMIT_GLOBAL_PER_MIN, auth: c.RATE_LIMIT_AUTH_PER_MIN, write: c.RATE_LIMIT_WRITE_PER_MIN },
    metricsToken: c.METRICS_TOKEN,
    runWorkerInApi: c.RUN_WORKER_IN_API === 'true',
    mockGatewayFailRate: c.MOCK_GATEWAY_FAIL_RATE,
    trustProxy: c.TRUST_PROXY,
    docsEnabled: c.ENABLE_DOCS === 'true',
  };
}

module.exports = { load };
