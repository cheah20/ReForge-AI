/**
 * tests/unit/legacy-helpers.ts
 *
 * Shared inputs for the legacy handler tests: the synthetic registration and
 * request builders. Not a test file itself.
 */

import { handleLegacy, type LegacyDeps } from '../../src/worker/legacy/handler.js';

export const DEPS: LegacyDeps = { now: () => new Date(Date.UTC(2026, 10, 17, 23, 59, 0)), randomDigits: () => '042137' };

/** The synthetic registration, in form order. */
export const VALID: Array<[string, string]> = [
  ['nama', 'LIN MEI TEST'],
  ['nokp', '900101101234'],
  ['tlahir', '01/01/1990'],
  ['jantina', 'P'],
  ['tel', '011-2345 6789'],
  ['poskod', '43000'],
  ['tujuan', 'PERIKSA'],
  ['akuan', 'YA'],
];

export const body = (pairs: Array<[string, string]>) => new URLSearchParams(pairs).toString();

export function post(payload: string, init: { contentType?: string; path?: string; headers?: Record<string, string> } = {}) {
  return handleLegacy(
    new Request(`https://reforge.example${init.path ?? '/legacy/register'}`, {
      method: 'POST',
      headers: { 'content-type': init.contentType ?? 'application/x-www-form-urlencoded', ...(init.headers ?? {}) },
      body: payload,
    }),
    DEPS,
  );
}

export const get = (path: string, method = 'GET') => handleLegacy(new Request(`https://reforge.example${path}`, { method }), DEPS);

export const parseHtml = (html: string) => new DOMParser().parseFromString(html, 'text/html');
