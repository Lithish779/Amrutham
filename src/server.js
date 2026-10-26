'use strict';
const { createContainer } = require('./container');
const { createApp } = require('./app');

async function main() {
  const c = createContainer();
  const app = createApp(c);
  if (c.config.runWorkerInApi) await c.jobs.start();
  const server = app.listen(c.config.port, () => c.logger.info({ port: c.config.port, env: c.config.env }, 'api listening'));
  // keep-alive above typical LB idle timeouts (60s) to avoid sporadic 502s
  server.keepAliveTimeout = 65_000;
  server.headersTimeout = 66_000;

  let closing = false;
  async function shutdown(signal) {
    if (closing) return;
    closing = true;
    c.logger.info({ signal }, 'shutting down: draining connections');
    const force = setTimeout(() => process.exit(1), 25_000);
    force.unref();
    server.close(async () => {
      await c.close();
      process.exit(0);
    });
  }
  ['SIGTERM', 'SIGINT'].forEach((s) => process.on(s, () => shutdown(s)));
  process.on('unhandledRejection', (e) => c.logger.error({ err: e }, 'unhandledRejection'));
}
main().catch((e) => { console.error(e); process.exit(1); });
