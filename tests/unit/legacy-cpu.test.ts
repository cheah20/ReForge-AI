/**
 * tests/unit/legacy-cpu.test.ts
 *
 * accessforge-skeleton task 5.10 (Requirement 2.12): the time handleLegacy
 * takes for each of the three requests, warm, in Node. Fails when the 99th
 * percentile exceeds 2 ms, a fifth of the free-plan 10 ms CPU limit. The
 * figures are printed so they can be recorded in design.md; the deployed
 * reading comes from Workers Logs (task 23.1).
 */

import { describe, it, expect } from 'vitest';
import { performance } from 'node:perf_hooks';
import { handleLegacy } from '../../src/worker/legacy/handler.js';
import { LEGACY_FORM } from '../../src/worker/legacy/form-spec.js';
import { DEPS } from './legacy-helpers.js';

/** A valid body with every text value at its maxlength. */
function maxBody(): string {
  const pairs: Array<[string, string]> = LEGACY_FORM.fields.map((f) => {
    if (f.control === 'text') return [f.name, 'x'.repeat(f.maxLength)];
    if (f.control === 'radio') return [f.name, f.values[1]];
    if (f.control === 'select') return [f.name, f.values[1]];
    return [f.name, f.value];
  });
  return new URLSearchParams(pairs).toString();
}

async function measure(make: () => Request): Promise<{ p50: number; p99: number; status: number }> {
  let status = 0;
  for (let i = 0; i < 50; i++) status = (await handleLegacy(make(), DEPS)).status;
  const times: number[] = [];
  for (let i = 0; i < 500; i++) {
    const req = make();
    const t0 = performance.now();
    const res = await handleLegacy(req, DEPS);
    await res.text();
    times.push(performance.now() - t0);
  }
  times.sort((a, b) => a - b);
  return { p50: times[249]!, p99: times[494]!, status };
}

const BODY = maxBody();
const CASES: Array<[string, () => Request, number]> = [
  ['GET /legacy/', () => new Request('https://reforge.example/legacy/'), 200],
  ['GET /legacy/register', () => new Request('https://reforge.example/legacy/register'), 200],
  [
    'POST /legacy/register (valid, values at maxlength)',
    () => new Request('https://reforge.example/legacy/register', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: BODY }),
    200,
  ],
];

describe('legacy handler time per request (Requirement 2.12)', () => {
  it.each(CASES)('%s: p99 under 2 ms', async (name, make, status) => {
    const r = await measure(make);
    expect(r.status).toBe(status);
    console.log(`legacy-cpu ${name}: p50 ${r.p50.toFixed(3)} ms, p99 ${r.p99.toFixed(3)} ms`);
    expect(r.p99).toBeLessThan(2);
  });
});
