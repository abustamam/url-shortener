/**
 * k6 load test for the URL shortener.
 *
 * Usage:
 *   k6 run --env BASE_URL=https://yourdomain.com --env SLUG=abc123 scripts/load-test.js
 *
 * Optional env vars:
 *   VUS       — number of virtual users (default: 50)
 *   DURATION  — test duration (default: 30s)
 *
 * At the end of the run k6 prints a summary including p50/p95/p99 for
 * http_req_duration. Copy those numbers into your blog post / phase notes.
 */

import http from 'k6/http';
import { check } from 'k6';

const BASE_URL = __ENV.BASE_URL || 'http://localhost:3000';
const SLUG = __ENV.SLUG;

if (!SLUG) {
  throw new Error('Set --env SLUG=<your-slug> before running');
}

export const options = {
  vus: parseInt(__ENV.VUS || '50', 10),
  duration: __ENV.DURATION || '30s',
  summaryTrendStats: ['avg', 'min', 'med', 'max', 'p(90)', 'p(95)', 'p(99)'],
};

export default function () {
  const res = http.get(`${BASE_URL}/${SLUG}`, { redirects: 0 });
  check(res, { 'status is 301 or 302': (r) => r.status === 301 || r.status === 302 });
}
