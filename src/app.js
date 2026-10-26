'use strict';
const fs = require('fs');
const path = require('path');
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const pinoHttp = require('pino-http');
const YAML = require('yaml');
const swaggerUi = require('swagger-ui-express');
const { requestContext, httpMetrics, errorHandler } = require('./middleware/common');
const { authRoutes, userRoutes } = require('./modules/auth/routes');
const { doctorRoutes } = require('./modules/doctors/routes');
const { searchRoutes } = require('./modules/search/routes');
const { consultationRoutes, prescriptionListRoutes, webhookRoutes } = require('./modules/consultations/routes');
const { adminRoutes } = require('./modules/admin/routes');
const { E } = require('./lib/errors');

function createApp(c) {
  const { config, logger, metrics } = c;
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', config.trustProxy);

  app.use(requestContext());

  // health + metrics are mounted first: cheap, no auth/rate-limit/log noise
  app.get('/healthz', (req, res) => res.json({ status: 'ok' }));
  app.get('/readyz', async (req, res) => {
    try { await c.db.ping(); await c.cache.ping(); res.json({ status: 'ready' }); }
    catch (e) { res.status(503).json({ status: 'unready', reason: e.message }); }
  });
  app.get('/metrics', async (req, res) => {
    if (config.metricsToken && req.get('authorization') !== `Bearer ${config.metricsToken}`) return res.status(401).end();
    res.set('Content-Type', metrics.registry.contentType);
    return res.end(await metrics.registry.metrics());
  });

  if (config.docsEnabled) {
    const specPath = path.join(__dirname, '..', 'openapi.yaml');
    const spec = YAML.parse(fs.readFileSync(specPath, 'utf8'));
    app.get('/openapi.yaml', (req, res) => res.type('text/yaml').send(fs.readFileSync(specPath, 'utf8')));
    app.use('/docs', swaggerUi.serve, swaggerUi.setup(spec));
  }

  app.use(helmet({
    hsts: { maxAge: 31536000, includeSubDomains: true },
    referrerPolicy: { policy: 'no-referrer' },
    contentSecurityPolicy: false,
  }));
  app.use(cors({ origin: config.corsOrigins.length ? config.corsOrigins : false, credentials: false, maxAge: 600 }));
  app.use(pinoHttp({
    logger, genReqId: (req) => req.id,
    customLogLevel: (req, res, err) => (err || res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info'),
    serializers: { req: (r) => ({ id: r.id, method: r.method, url: r.url.split('?')[0] }), res: (r) => ({ statusCode: r.statusCode }) },
  }));
  app.use(httpMetrics(metrics));
  app.use(c.limiter({ scope: 'global', max: config.rateLimit.global }));
  app.use(express.json({ limit: '100kb', verify: (req, res, buf) => { req.rawBody = buf; } }));

  const v1 = express.Router();
  v1.use('/auth', authRoutes(c));
  v1.use('/users', userRoutes(c));
  const doctors = doctorRoutes(c);
  v1.use('/doctors/me', doctors.doctorMe);
  v1.use('/doctors', searchRoutes(c), doctors.public);
  v1.use('/consultations', consultationRoutes(c));
  v1.use('/prescriptions', prescriptionListRoutes(c));
  v1.use('/admin', adminRoutes(c));
  v1.use('/webhooks', webhookRoutes(c));
  app.use('/api/v1', v1);

  // Serve modern interactive telemedicine web portal
  app.use(express.static(path.join(__dirname, '../public')));

  app.use((req, res, next) => next(E.notFound('Route not found')));
  app.use(errorHandler({ logger, config }));
  return app;
}
module.exports = { createApp };
