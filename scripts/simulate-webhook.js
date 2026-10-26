'use strict';
// Simulates the payment provider calling our webhook:  node scripts/simulate-webhook.js <providerRef> [succeeded|failed]
const crypto = require('crypto');
const [providerRef, outcome = 'succeeded'] = process.argv.slice(2);
if (!providerRef) { console.error('usage: simulate-webhook.js <providerRef> [succeeded|failed]'); process.exit(1); }
const secret = process.env.PAYMENT_WEBHOOK_SECRET || 'dev-webhook-secret-0123456789';
const base = process.env.API_URL || 'http://localhost:8080';
const body = JSON.stringify({ id: `evt_${crypto.randomBytes(8).toString('hex')}`, type: `payment.${outcome}`, providerRef });
const ts = Math.floor(Date.now() / 1000);
const sig = crypto.createHmac('sha256', secret).update(`${ts}.${body}`).digest('hex');
fetch(`${base}/api/v1/webhooks/payments`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-webhook-timestamp': String(ts), 'x-webhook-signature': sig }, body })
  .then(async (r) => console.log(r.status, await r.text()));
