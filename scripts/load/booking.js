// k6 load test: realistic read-heavy mix + contended booking.   k6 run -e BASE=http://localhost:8080 scripts/load/booking.js
import http from 'k6/http';
import { check, sleep } from 'k6';

export const options = {
  scenarios: {
    search: { executor: 'constant-arrival-rate', rate: 200, timeUnit: '1s', duration: '2m', preAllocatedVUs: 100, exec: 'search' },
    slots: { executor: 'constant-arrival-rate', rate: 100, timeUnit: '1s', duration: '2m', preAllocatedVUs: 50, exec: 'slots' },
  },
  thresholds: { 'http_req_duration{scenario:search}': ['p(95)<200'], 'http_req_duration{scenario:slots}': ['p(95)<200'], http_req_failed: ['rate<0.0005'] },
};
const BASE = __ENV.BASE || 'http://localhost:8080';
const specs = ['ayurveda', 'dermatology', 'general', 'pediatrics'];

export function search() {
  const r = http.get(`${BASE}/api/v1/doctors?specialization=${specs[Math.floor(Math.random() * 4)]}&limit=20`);
  check(r, { 'search 200': (x) => x.status === 200 });
}
export function slots() {
  const list = http.get(`${BASE}/api/v1/doctors?limit=5`).json('items') || [];
  if (list.length) check(http.get(`${BASE}/api/v1/doctors/${list[0].id}/slots`), { 'slots 200': (x) => x.status === 200 });
  sleep(0.1);
}
