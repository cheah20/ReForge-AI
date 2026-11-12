/**
 * tests/unit/legacy-routes.test.ts
 *
 * accessforge-skeleton task 5.11: the Worker routes /legacy and /legacy/* to
 * the legacy handler before the static assets, serves only the documents of
 * Requirement 1.1, and logs route and status only.
 * Validates: Requirements 1.1, 4.7, 13.5
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { createHandler, type Env } from '../../src/worker/index.js';
import type { LogEntry } from '../../src/worker/http.js';
import { body, DEPS, VALID } from './legacy-helpers.js';

function setup() {
  const logs: LogEntry[] = [];
  const assets: string[] = [];
  const handler = createHandler({ logger: (e) => logs.push(e), requestId: () => 'req-1', now: () => Date.UTC(2026, 10, 17), legacy: DEPS });
  const env: Env = { ASSETS: { fetch: async (r) => (assets.push(new URL(r.url).pathname), new Response('spa')) } };
  const call = (path: string, init: RequestInit = {}) => handler.fetch(new Request(`https://reforge.example${path}`, init), env);
  return { call, logs, assets };
}

describe('legacy routing', () => {
  it('serves the four documents of Requirement 1.1 from the Worker, never from the assets', async () => {
    const { call, assets } = setup();
    const kinds = [
      [await call('/legacy/'), 200, 'home'],
      [await call('/legacy/register'), 200, 'register'],
      [await call('/legacy/register', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: body(VALID) }), 200, 'confirmation'],
      [await call('/legacy/register', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: 'nama=x' }), 422, 'error'],
    ] as const;
    for (const [res, status, page] of kinds) {
      expect(res.status).toBe(status);
      expect(await res.text()).toContain(`<meta name="portal-page" content="${page}">`);
    }
    expect(assets).toEqual([]);
  });

  it('serves no other /legacy/ document: every other path is the not-found document', async () => {
    const { call, assets } = setup();
    for (const path of ['/legacy', '/legacy/index.html', '/legacy/register/', '/legacy/admin', '/legacy/register/confirm', '/legacy/hostile']) {
      const res = await call(path);
      expect(res.status, path).toBe(404);
      expect(await res.text(), path).toContain('<meta name="portal-page" content="not-found">');
    }
    expect(assets).toEqual([]);
  });

  it('other paths still go to the assets, and /api still to the API', async () => {
    const { call, assets } = setup();
    expect(await (await call('/forms/sample')).text()).toBe('spa');
    expect(await (await call('/legacy-assets/portal.css')).text()).toBe('spa');
    expect(assets).toEqual(['/forms/sample', '/legacy-assets/portal.css']);
    expect((await call('/api/nope', { method: 'POST' })).status).toBe(404);
  });

  it('a legacy POST log entry has the allowed items only, with no field name and no value', async () => {
    const { call, logs } = setup();
    const canary = 'CANARY-LOG-61';
    const values = VALID.map(([n, v]): [string, string] => [n, n === 'nama' ? canary : v]);
    await call('/legacy/register', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: body(values) });
    await call('/legacy/register', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: `nama=${canary}` });
    await call('/legacy/register', { method: 'POST', headers: { 'content-type': 'application/json' }, body: `{"nama":"${canary}"}` });
    expect(logs.map((l) => [l.route, l.status, l.errorCode])).toEqual([
      ['/legacy/register', 200, undefined],
      ['/legacy/register', 422, undefined],
      ['/legacy/register', 400, 'BAD_REQUEST'],
    ]);
    const text = JSON.stringify(logs);
    expect(text).not.toContain(canary);
    for (const name of ['nama', 'nokp', 'tlahir', 'jantina', 'tel', 'poskod', 'tujuan', 'akuan']) expect(text).not.toContain(name);
    const allowed = ['requestId', 'route', 'status', 'durationMs', 'errorCode', 'aiMode', 'model', 'attempts', 'promptTokens', 'completionTokens', 'neurons', 'servedFromCache'];
    for (const e of logs) expect(Object.keys(e).every((k) => allowed.includes(k))).toBe(true);
  });

  it('logs other legacy paths under route /legacy/', async () => {
    const { call, logs } = setup();
    await call('/legacy/admin');
    expect(logs).toEqual([{ requestId: 'req-1', route: '/legacy/', status: 404, durationMs: 0 }]);
  });

  it('wrangler.jsonc runs the Worker first for /api/*, /legacy and /legacy/*', () => {
    const config = readFileSync('wrangler.jsonc', 'utf8');
    expect(config).toContain('"run_worker_first": ["/api/*", "/legacy", "/legacy/*"]');
  });
});
