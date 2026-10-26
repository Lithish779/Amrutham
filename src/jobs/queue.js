'use strict';
const { Queue, Worker } = require('bullmq');
const IORedis = require('ioredis');
const { retry } = require('../lib/retry');

/**
 * Async job runner. BullMQ/Redis in production (durable, retries with exponential backoff, dead-letter via failed set);
 * in-process fallback with identical semantics for local dev/tests when REDIS_URL is not set.
 */
function createJobs({ redisUrl, logger, metrics }) {
  const handlers = {};
  const schedules = [];
  const pending = new Set();
  const timers = [];
  let queue; let worker; let conn;
  const ATTEMPTS = 5;

  const register = (name, fn) => { handlers[name] = fn; };

  async function run(name, data) {
    const h = handlers[name];
    if (!h) throw new Error(`No handler for job ${name}`);
    try {
      const r = await h(data);
      metrics.jobs.inc({ name, result: 'ok' });
      return r;
    } catch (e) {
      metrics.jobs.inc({ name, result: 'error' });
      throw e;
    }
  }

  if (redisUrl) {
    conn = new IORedis(redisUrl, { maxRetriesPerRequest: null });
    conn.on('error', (e) => logger.warn({ err: e.message }, 'jobs redis error'));
    queue = new Queue('amrutam', { connection: conn, prefix: 'amrutam' });
  }

  async function enqueue(name, data = {}, { delayMs = 0, jobId } = {}) {
    if (queue) {
      return queue.add(name, data, {
        attempts: ATTEMPTS, backoff: { type: 'exponential', delay: 1000 }, delay: delayMs, jobId,
        removeOnComplete: 1000, removeOnFail: 5000,
      });
    }
    const p = (async () => {
      if (delayMs) await new Promise((r) => setTimeout(r, delayMs));
      await retry(() => run(name, data), { retries: ATTEMPTS - 1, baseMs: 200, maxMs: 3000 });
    })().catch((e) => logger.error({ err: e, job: name }, 'job permanently failed'))
      .finally(() => pending.delete(p));
    pending.add(p);
    return undefined;
  }

  const schedule = (name, everyMs) => schedules.push({ name, everyMs });

  async function start() {
    if (queue) {
      worker = new Worker('amrutam', (job) => run(job.name, job.data), { connection: new IORedis(redisUrl, { maxRetriesPerRequest: null }), prefix: 'amrutam', concurrency: 10 });
      worker.on('failed', (job, err) => logger.error({ err, job: job && job.name, attempts: job && job.attemptsMade }, 'job failed'));
      for (const s of schedules) {
        if (queue.upsertJobScheduler) await queue.upsertJobScheduler(`sched:${s.name}`, { every: s.everyMs }, { name: s.name, data: {} });
        else await queue.add(s.name, {}, { repeat: { every: s.everyMs }, jobId: `sched:${s.name}` });
      }
    } else {
      for (const s of schedules) {
        const t = setInterval(() => enqueue(s.name, {}), s.everyMs);
        t.unref();
        timers.push(t);
      }
    }
  }

  /** Resolves when all in-process jobs have settled (tests / graceful shutdown). */
  async function idle() {
    while (pending.size) await Promise.allSettled([...pending]);
    if (queue) { // BullMQ mode: wait until nothing is waiting/active (scheduled repeats are 'delayed', ignored)
      for (let i = 0; i < 100; i++) {
        const n = await queue.getJobCounts('waiting', 'active');
        if (n.waiting + n.active === 0) return;
        await new Promise((r) => setTimeout(r, 100));
      }
    }
  }

  async function close() {
    timers.forEach(clearInterval);
    await idle();
    if (worker) await worker.close();
    if (queue) await queue.close();
    if (conn) await conn.quit().catch(() => {});
  }
  return { register, enqueue, schedule, start, idle, close, run };
}
module.exports = { createJobs };
