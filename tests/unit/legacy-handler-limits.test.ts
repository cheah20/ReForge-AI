// @vitest-environment jsdom
/**
 * tests/unit/legacy-handler-limits.test.ts
 *
 * accessforge-skeleton task 5.7: limits, headers and the not-found document.
 * Validates: Requirements 1.10, 2.6, 2.7, 2.8, 4.2
 */

import { describe, it, expect } from 'vitest';
import { LEGACY_CSP } from '../../src/worker/legacy/respond.js';
import { LEGACY_BODY_LIMIT } from '../../src/worker/legacy/handler.js';
import { body, get, parseHtml, post, VALID } from './legacy-helpers.js';

/** A valid body padded to exactly `bytes` with one extra field (which validation then rejects as unknown). */
function sized(bytes: number): string {
  const base = body(VALID);
  const pad = bytes - base.length - '&pad='.length;
  return `${base}&pad=${'x'.repeat(pad)}`;
}

describe('body size limit (16,384 bytes)', () => {
  it('16,384 bytes reach the handler (it then rejects the extra field); 16,385 are refused before parsing', async () => {
    const at = sized(LEGACY_BODY_LIMIT);
    expect(new TextEncoder().encode(at).length).toBe(16_384);
    const ok = await post(at);
    expect(ok.status).toBe(422); // parsed and validated: "pad" is unknown
    const over = await post(sized(LEGACY_BODY_LIMIT + 1));
    expect(over.status).toBe(413);
    expect(await over.json()).toEqual({ error: { code: 'PAYLOAD_TOO_LARGE', message: 'The request is too large.' } });
  });

  it('a declared content-length over the limit is refused without reading', async () => {
    const res = await post(body(VALID), { headers: { 'content-length': '999999' } });
    expect(res.status).toBe(413);
  });
});

describe('rejections (Requirement 2.8)', () => {
  it('a JSON body is rejected with the shared error shape', async () => {
    const res = await post(JSON.stringify(Object.fromEntries(VALID)), { contentType: 'application/json' });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('BAD_REQUEST');
  });

  it.each(['PUT', 'DELETE', 'PATCH'])('%s is rejected', async (method) => {
    const res = await get('/legacy/register', method);
    expect(res.status).toBe(405);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('METHOD_NOT_ALLOWED');
  });

  it('no rejection carries a reference number', async () => {
    for (const res of [await post('{}', { contentType: 'application/json' }), await get('/legacy/register', 'PUT'), await post(sized(LEGACY_BODY_LIMIT + 1))]) {
      expect(await res.text()).not.toMatch(/SR-DEMO-/);
    }
  });
});

describe('headers on every response kind (Requirements 2.6, 4.2)', () => {
  const kinds = async () => [
    ['home', await get('/legacy/')],
    ['register', await get('/legacy/register')],
    ['confirmation', await post(body(VALID))],
    ['error page', await post(body([['nama', 'x']]))],
    ['not found', await get('/legacy/admin')],
    ['JSON 400', await post('{}', { contentType: 'application/json' })],
    ['JSON 405', await get('/legacy/register', 'DELETE')],
    ['JSON 413', await post(sized(LEGACY_BODY_LIMIT + 1))],
  ] as Array<[string, Response]>;

  it('CSP, no-store and the other legacy headers', async () => {
    for (const [kind, res] of await kinds()) {
      expect(res.headers.get('content-security-policy'), kind).toBe(LEGACY_CSP);
      expect(res.headers.get('cache-control'), kind).toBe('no-store');
      expect(res.headers.get('x-content-type-options'), kind).toBe('nosniff');
      expect(res.headers.get('referrer-policy'), kind).toBe('no-referrer');
      expect(res.headers.get('x-frame-options'), kind).toBe('SAMEORIGIN');
    }
  });

  it('the CSP has every directive of Requirement 4.2', () => {
    for (const d of ["default-src 'none'", "style-src 'self'", "img-src 'self'", "base-uri 'none'", "form-action 'self'", "frame-ancestors 'self'"]) expect(LEGACY_CSP).toContain(d);
    expect(LEGACY_CSP).not.toContain('unsafe-inline');
  });

  it('no response header contains a submitted value', async () => {
    const canary = 'CANARYHEADER55';
    for (const res of [await post(body(VALID.map(([n, v]) => [n, n === 'nama' ? canary : v]))), await post(body([['nama', canary]]))]) {
      for (const [k, v] of res.headers) expect(`${k}: ${v}`).not.toContain(canary);
      expect(res.headers.get('location')).toBeNull();
    }
  });
});

describe('the not-found document (Requirement 1.10)', () => {
  it.each(['/legacy/x', '/legacy/register/', '/legacy/admin', '/legacy', '/legacy/legacy-assets/portal.css'])('%s gives 404 with the banner, no form control and one link to /legacy/', async (path) => {
    const res = await get(path);
    expect(res.status).toBe(404);
    const d = parseHtml(await res.text());
    expect(d.body.firstElementChild!.className).toBe('banner');
    expect(d.querySelectorAll('form, input, select, button, textarea').length).toBe(0);
    expect([...d.querySelectorAll('a')].map((a) => a.getAttribute('href'))).toEqual(['/legacy/']);
  });
});
