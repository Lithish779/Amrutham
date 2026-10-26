'use strict';
const { load } = require('./config');
const { createLogger } = require('./logger');
const { createMetrics } = require('./metrics');
const { createDb } = require('./db');
const { createCache } = require('./cache');
const { createAudit } = require('./audit');
const { createJobs } = require('./jobs/queue');
const { createCrypto } = require('./lib/crypto');
const { createAuthMiddleware } = require('./middleware/auth');
const { createRateLimiter } = require('./middleware/rateLimit');
const { createIdempotency } = require('./middleware/idempotency');
const { MockGateway, withResilience } = require('./modules/payments/gateway');
const { createAuthService } = require('./modules/auth/service');
const { createDoctorService } = require('./modules/doctors/service');
const { createConsultationService } = require('./modules/consultations/service');
const { createPrescriptionService } = require('./modules/prescriptions/service');
const { createSearchService } = require('./modules/search/service');
const { createAdminService } = require('./modules/admin/service');

/** Composition root: the only place where concrete implementations are wired together (manual DI, easy to override in tests). */
function createContainer(overrides = {}) {
  const config = overrides.config || load();
  const logger = overrides.logger || createLogger(config.isTest && !process.env.LOG_LEVEL ? 'silent' : config.logLevel);
  const metrics = createMetrics();
  const db = createDb({ config, metrics, logger });
  const cache = createCache({ redisUrl: config.redisUrl, metrics, logger });
  const crypto = createCrypto(config.encryption);
  const audit = createAudit({ db, metrics, logger });
  const jobs = createJobs({ redisUrl: config.redisUrl, logger, metrics });
  const gateway = withResilience(overrides.gateway || new MockGateway({ failRate: config.mockGatewayFailRate }), { logger });

  const authMw = createAuthMiddleware({ config, cache });
  const limiter = createRateLimiter({ cache, metrics });
  const idem = createIdempotency({ db, metrics });

  const authService = createAuthService({ db, config, cache, crypto, audit, authMw, metrics });
  const doctorService = createDoctorService({ db, cache, audit, config });
  const consultationService = createConsultationService({ db, config, cache, audit, jobs, gateway, metrics, logger, crypto });
  const prescriptionService = createPrescriptionService({ db, audit, crypto });
  const searchService = createSearchService({ db, cache });
  const adminService = createAdminService({ db, cache, audit, config });

  // ---- async job handlers
  jobs.register('send-notification', async (d) => { logger.info({ notification: d.type, consultationId: d.consultationId }, 'notification dispatched'); });
  jobs.register('refund-payment', (d) => consultationService.processRefund(d.paymentId));
  jobs.register('expire-holds', () => consultationService.expireStaleHolds());
  jobs.register('mark-no-shows', () => consultationService.markNoShows());
  jobs.register('ensure-partitions', () => db.query('SELECT ensure_audit_partitions(3)'));
  jobs.register('purge-idempotency', () => db.query("DELETE FROM idempotency_keys WHERE created_at < now() - interval '48 hours'"));
  jobs.schedule('expire-holds', 30_000);
  jobs.schedule('mark-no-shows', 5 * 60_000);
  jobs.schedule('ensure-partitions', 6 * 3600_000);
  jobs.schedule('purge-idempotency', 3600_000);

  async function close() {
    await jobs.close();
    await cache.close();
    await db.close();
  }

  return {
    config, logger, metrics, db, cache, crypto, audit, jobs, gateway, authMw, limiter, idem,
    authService, doctorService, consultationService, prescriptionService, searchService, adminService, close,
  };
}
module.exports = { createContainer };
