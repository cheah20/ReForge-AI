/**
 * tests/unit/accessforge-scope.test.ts
 *
 * accessforge-skeleton tasks 16.1, 16.2 and 16.17: the frame source is fixed,
 * a foreign address in the URL only raises the scope flag, and the page
 * analysis client aborts on timeout and on a new generation.
 * Validates: Requirements 18.1, 18.2, 3.9, 6.15
 */

import { describe, it, expect } from 'vitest';
import { namesForeignAddress, REVIVAL_FRAME_SRC } from '../../src/lib/accessforge/scope.js';
import { analyzePage, ApiRequestError } from '../../src/frontend/api.js';
import type { PageAnalyzeRequest } from '../../src/shared/page-schemas.js';

const at = (path: string) => new URL(path, 'https://reforge.example');

describe('namesForeignAddress', () => {
  it.each([
    ['an absolute URL in a parameter', '/accessforge?url=https://evil.example/form'],
    ['a protocol-relative URL', '/accessforge?site=//evil.example/form'],
    ['an encoded URL', '/accessforge?u=https%3A%2F%2Fevil.example%2F'],
    ['a double-encoded URL', '/accessforge?u=https%253A%252F%252Fevil.example'],
    ['a bare host name', '/accessforge?page=gov.example.my/register'],
    ['a www address', '/accessforge?x=www.example'],
    ['a javascript: URL', '/accessforge?go=javascript:alert(1)'],
    ['a key-less query', '/accessforge?https://evil.example'],
    ['a hash', '/accessforge#https://evil.example'],
    ['a path segment', '/accessforge/https%3A%2F%2Fevil.example'],
  ])('flags %s', (_label, path) => {
    expect(namesForeignAddress(at(path), '/accessforge')).toBe(true);
  });

  it.each([
    ['no parameters', '/accessforge'],
    ['a language parameter', '/accessforge?lang=zh-Hans'],
    ['a plain word', '/accessforge?step=review'],
    ['a malformed encoding', '/accessforge?x=%E0%A4'],
  ])('does not flag %s', (_label, path) => {
    expect(namesForeignAddress(at(path), '/accessforge')).toBe(false);
  });

  it('keeps the frame source constant whatever the address says', () => {
    expect(REVIVAL_FRAME_SRC).toBe('/legacy/register');
  });
});

describe('analyzePage client', () => {
  const REQUEST = { interfaceLanguage: 'en', pageModel: {} } as unknown as PageAnalyzeRequest;
  /** A fetch that never answers until its signal aborts. */
  const hanging = (seen: { signal?: AbortSignal | null }) => (_input: string, init: RequestInit) =>
    new Promise<Response>((_resolve, reject) => {
      seen.signal = init.signal ?? null;
      init.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
    });

  it('posts to /api/pages/analyze and checks the reply with the schema', async () => {
    const calls: string[] = [];
    const ok = async (input: string) => (calls.push(input), new Response(JSON.stringify({ analysisMode: 'mock', entries: [] }), { headers: { 'x-reforge-ai-mode': 'mock' } }));
    expect(await analyzePage(REQUEST, { fetchFn: ok })).toEqual({ data: { analysisMode: 'mock', entries: [] }, aiMode: 'mock' });
    expect(calls).toEqual(['/api/pages/analyze']);
    const bad = async () => new Response(JSON.stringify({ analysisMode: 'magic', entries: [] }));
    await expect(analyzePage(REQUEST, { fetchFn: bad })).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
  });

  it('gives up with TIMEOUT when no reply comes in time', async () => {
    const seen: { signal?: AbortSignal | null } = {};
    await expect(analyzePage(REQUEST, { fetchFn: hanging(seen), timeoutMs: 20 })).rejects.toMatchObject({ code: 'TIMEOUT' });
    expect(seen.signal?.aborted).toBe(true);
  });

  it('aborts with ABORTED when the generation signal aborts', async () => {
    const gen = new AbortController();
    const seen: { signal?: AbortSignal | null } = {};
    const pending = analyzePage(REQUEST, { fetchFn: hanging(seen), signal: gen.signal, timeoutMs: 10_000 });
    gen.abort();
    const err = await pending.catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiRequestError);
    expect((err as ApiRequestError).code).toBe('ABORTED');
  });
});
