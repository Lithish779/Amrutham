'use strict';
// Dedicated worker process (scale independently from the API): BullMQ consumers + schedulers.
const { createContainer } = require('./container');

async function main() {
  const c = createContainer();
  await c.jobs.start();
  c.logger.info({ redis: c.cache.enabled }, 'worker started');
  const stop = async () => { await c.close(); process.exit(0); };
  ['SIGTERM', 'SIGINT'].forEach((s) => process.on(s, stop));
}
main().catch((e) => { console.error(e); process.exit(1); });
